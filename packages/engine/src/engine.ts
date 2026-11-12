/**
 * Moteur d'exécution. Pur et synchrone : aucune dépendance à Discord, au réseau ou au disque.
 * Le même code tourne dans le bot et dans l'émulateur du Studio.
 *
 * Atomicité : chaque interaction travaille sur une copie de l'état, validée seulement si
 * toutes les actions réussissent. Comme les méthodes sont synchrones, deux interactions
 * ne peuvent jamais s'entrelacer.
 */
import type { Action, Block, ButtonDef, Id, Rule, ScreenDef, WorldDef, BuildingDef } from './model.ts';
import type { RButton, RContainer, RenderedMessage, RTopLevel } from './components.ts';
import { createInitialState, newPlayer, syncStructure, type SessionState, type WorldState } from './state.ts';
import { type Ctx, type EngineEvent, RuleError, applyAction, describeChanges, evaluate, pickText } from './rules.ts';
import { handleWidget, renderWidget, text, type WidgetEnv } from './widgets.ts';
import { DEFAULT_TZ, describeSchedule, nextRun, rollWeather } from './clock.ts';
import { dropExpiredQuest, questVisit } from './quests.ts';
import type { EventDef } from './model.ts';
import type { EventRunState } from './state.ts';

export type EventCommand = 'start' | 'stop' | 'pause' | 'resume' | 'restart';

export interface LiveStatus {
  timezone: string;
  now: number;
  weather: null | { variable: string; value: string; label: string; since: number; until: number; auto: boolean };
  events: {
    id: string;
    name: string;
    emoji: string;
    description: string;
    schedule: string;
    manual: boolean;
    status: EventRunState['status'];
    auto: boolean;
    elapsedMs: number;
    durationMs: number;
    startedAt: number | null;
    nextRunAt: number | null;
    runs: number;
    stepsDone: number;
    steps: { name: string; afterMinutes: number }[];
    lastError: string | null;
  }[];
}

export interface EngineOptions {
  now?: () => number;
  random?: () => number;
  newId?: () => string;
}

export interface InteractionResult {
  ok: boolean;
  /** Message de retour affiché au joueur (succès ou refus), utile pour le journal d'activité. */
  notice?: string;
  /** Effets externes déclenchés (audio…). */
  events?: EngineEvent[];
  /** Message destiné uniquement à l'auteur du clic (interface d'un autre joueur, session expirée…). */
  private?: string;
  message?: RenderedMessage;
}

export interface View {
  message: RenderedMessage;
  /** Instant (ms) auquel l'affichage changera de lui-même (minuteur), sinon null. */
  wakeAt: number | null;
}

const SEP = '|';

export class Engine {
  readonly world: WorldDef;
  private state: WorldState;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly newId: () => string;

  constructor(world: WorldDef, state?: WorldState, opts: EngineOptions = {}) {
    this.world = world;
    this.state = state ? structuredClone(state) : createInitialState(world);
    syncStructure(world, this.state);
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.newId = opts.newId ?? (() => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10));
  }

  /** Copie sérialisable de l'état (à persister après chaque interaction). */
  snapshot(): WorldState {
    return structuredClone(this.state);
  }

  /** Révision : augmente à chaque modification validée (utile pour rafraîchir les autres interfaces). */
  get revision(): number {
    return this.state.revision;
  }

  get variables(): Readonly<Record<Id, string | number>> {
    return this.state.variables;
  }

  player(id: Id) {
    return this.state.players[id];
  }

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  /** Exécute fn sur une copie ; valide si aucune exception. */
  private transact<T>(fn: (draft: WorldState) => T): T {
    const draft = structuredClone(this.state);
    const result = fn(draft);
    draft.revision += 1;
    this.state = draft;
    return result;
  }

  private building(id: Id | undefined): BuildingDef {
    if (id === undefined) return this.world.buildings[0] ?? NO_BUILDING;
    const b = this.world.buildings.find((x) => x.id === id);
    if (!b) throw new Error(`Bâtiment inconnu : ${id}`);
    return b;
  }

  private screen(b: BuildingDef, id: Id): ScreenDef {
    return b.screens.find((s) => s.id === id) ?? b.screens.find((s) => s.id === b.homeScreen) ?? b.screens[0]!;
  }

  private ctx(draft: WorldState, session: SessionState): Ctx {
    const player = (draft.players[session.player] ??= newPlayer(this.world));
    return {
      world: this.world,
      state: draft,
      playerId: session.player,
      player,
      building: this.building(session.building),
      now: this.now(),
      changes: [],
      events: [],
      notes: [],
      random: this.random,
    };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /** Ouvre l'interface d'un bâtiment pour un joueur (un message Discord). */
  openSession(playerId: Id, buildingId: Id): { sessionId: Id; view: View } {
    const b = this.building(buildingId);
    const sessionId = this.transact((draft) => {
      draft.players[playerId] ??= newPlayer(this.world);
      const id = this.newId();
      const session: SessionState = { id, player: playerId, building: b.id, screen: b.homeScreen, ui: {}, createdAt: this.now() };
      draft.sessions[id] = session;
      // Entrer dans un lieu fait avancer les quêtes « visiter ».
      const ctx = this.ctx(draft, session);
      dropExpiredQuest(ctx);
      questVisit(ctx, b.id);
      if (ctx.notes?.length) session.notice = ctx.notes.join('\n\n');
      return id;
    });
    return { sessionId, view: this.view(sessionId) };
  }

  closeSession(sessionId: Id): void {
    if (this.state.sessions[sessionId]) this.transact((d) => void delete d.sessions[sessionId]);
  }

  /** Joueur et bâtiment d'une interface ouverte. */
  session(sessionId: Id): { player: Id; building: Id } | undefined {
    const s = this.state.sessions[sessionId];
    return s ? { player: s.player, building: s.building } : undefined;
  }

  /** Ferme toutes les interfaces d'un joueur dans un bâtiment (sortie du salon vocal). Renvoie les sessions fermées. */
  closeSessionsOf(playerId: Id, buildingId?: Id): Id[] {
    const ids = Object.values(this.state.sessions)
      .filter((s) => s.player === playerId && (!buildingId || s.building === buildingId))
      .map((s) => s.id);
    if (ids.length) this.transact((d) => ids.forEach((id) => delete d.sessions[id]));
    return ids;
  }

  /**
   * Intervention d'administration / de test : applique des actions à un joueur, de façon atomique.
   * buildingId n'est nécessaire que pour les actions visant un inventaire de bâtiment.
   */
  adminApply(playerId: Id, buildingId: Id | undefined, actions: Action[]): string {
    return this.transact((draft) => {
      draft.players[playerId] ??= newPlayer(this.world);
      const ctx = this.ctx(draft, { id: '', player: playerId, building: buildingId ?? this.world.buildings[0]?.id ?? '', screen: '', ui: {}, createdAt: 0 });
      for (const a of actions) applyAction(ctx, a);
      return describeChanges(ctx);
    });
  }

  /**
   * Serment d'arrivée : marque le joueur et verse la dotation une seule fois.
   * Renvoie le message de confirmation et si c'était la première fois.
   */
  acceptOath(playerId: Id): { first: boolean; message: string; gains: string } {
    const ob = this.world.onboarding;
    return this.transact((draft) => {
      const p = (draft.players[playerId] ??= newPlayer(this.world));
      const ctx = this.ctx(draft, { id: '', player: playerId, building: this.world.buildings[0]?.id ?? '', screen: '', ui: {}, createdAt: 0 });
      const message = pickText(ctx, ob?.confirmation) || 'Bienvenue !';
      if (p.oathAt) return { first: false, message, gains: '' };
      p.oathAt = this.now();
      for (const a of ob?.actions ?? []) applyAction(ctx, a);
      // Les écus ne sont pas listés par describeChanges (dépenses annoncées à part) : on les ajoute ici.
      const money = ctx.changes
        .filter((c) => c.kind === 'stat' && c.after > c.before && this.world.stats.find((x) => x.id === c.stat)?.kind === 'currency')
        .map((c) => {
          const def = c.kind === 'stat' ? this.world.stats.find((x) => x.id === c.stat) : undefined;
          return c.kind === 'stat' ? `${def?.emoji ?? ''} +${c.after - c.before} ${def?.unit ?? def?.name ?? ''}`.trim() : '';
        });
      return { first: true, message, gains: [...money, describeChanges(ctx)].filter(Boolean).join(' · ') };
    });
  }

  // -------------------------------------------------------------------------
  // Horloge du monde : météo et événements
  // -------------------------------------------------------------------------

  private get tz() {
    return this.world.settings.timezone || DEFAULT_TZ;
  }

  /** Contexte d'action « monde » : aucun joueur réel n'est créé. */
  private worldCtx(draft: WorldState): Ctx {
    return {
      world: this.world,
      state: draft,
      playerId: '__monde__',
      player: newPlayer(this.world),
      building: this.building(undefined),
      now: this.now(),
      changes: [],
      events: [],
      random: this.random,
    };
  }

  /** Applique des actions « monde » ; une action en échec est consignée sans bloquer les autres. */
  private runWorldActions(ctx: Ctx, actions: Parameters<typeof applyAction>[1][], st?: EventRunState) {
    for (const a of actions) {
      try {
        applyAction(ctx, a);
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
        if (st) st.lastError = e.message;
      }
    }
  }

  private announce(ctx: Ctx, t: Parameters<typeof pickText>[1], source: string) {
    const msg = pickText(ctx, t);
    if (msg) ctx.events.push({ type: 'announce', text: msg, source });
  }

  private elapsed(st: EventRunState, now: number) {
    return st.elapsedMs + (st.status === 'running' && st.resumedAt !== undefined ? now - st.resumedAt : 0);
  }

  private startEvent(ctx: Ctx, ev: EventDef, st: EventRunState) {
    Object.assign(st, { status: 'running', startedAt: ctx.now, elapsedMs: 0, resumedAt: ctx.now, stepsDone: 0, nextRunAt: null, lastError: undefined });
    st.runs += 1;
    this.runWorldActions(ctx, ev.onStart, st);
    this.announce(ctx, ev.announce?.start, ev.name);
    this.advanceEvent(ctx, ev, st);
  }

  private advanceEvent(ctx: Ctx, ev: EventDef, st: EventRunState) {
    if (st.status !== 'running') return;
    const el = this.elapsed(st, ctx.now);
    const steps = [...ev.steps].sort((a, b) => a.afterMinutes - b.afterMinutes);
    while (st.stepsDone < steps.length && steps[st.stepsDone]!.afterMinutes * 60_000 <= el) {
      const step = steps[st.stepsDone]!;
      this.runWorldActions(ctx, step.actions, st);
      this.announce(ctx, step.announce, ev.name);
      st.stepsDone += 1;
    }
    if (ev.durationMinutes > 0 && el >= ev.durationMinutes * 60_000) this.endEvent(ctx, ev, st);
  }

  private endEvent(ctx: Ctx, ev: EventDef, st: EventRunState) {
    st.elapsedMs = this.elapsed(st, ctx.now);
    st.resumedAt = undefined;
    this.runWorldActions(ctx, ev.onEnd, st);
    this.announce(ctx, ev.announce?.end, ev.name);
    st.status = 'finished';
    st.lastEndedAt = ctx.now;
    st.nextRunAt = st.auto ? nextRun(ev.schedule, ctx.now, this.tz, st.startedAt) : null;
  }

  /**
   * Fait avancer le temps du monde : météo automatique, étapes et fins d'événements,
   * déclenchements programmés. À appeler régulièrement (le serveur le fait toutes les quelques secondes).
   * Ne crée une nouvelle révision que si quelque chose a changé.
   */
  tick(): EngineEvent[] {
    const draft = structuredClone(this.state);
    const ctx = this.worldCtx(draft);
    const before = JSON.stringify(draft);
    const wdef = this.world.weather;
    if (wdef && wdef.states.length) {
      const cur = draft.weather;
      if (!cur || (cur.auto && ctx.now >= cur.until)) {
        const roll = rollWeather(wdef, cur?.value ?? (draft.variables[wdef.variable] as string | undefined), this.random);
        if (roll) {
          applyAction(ctx, { type: 'weather.set', value: roll.state.value, minutes: roll.minutes });
          if (cur) draft.weather!.auto = cur.auto;
        }
      }
    }
    for (const ev of this.world.events ?? []) {
      const st = (draft.events[ev.id] ??= { status: 'idle', auto: ev.schedule.type !== 'manual', elapsedMs: 0, stepsDone: 0, nextRunAt: null, runs: 0 });
      if (st.status === 'running') this.advanceEvent(ctx, ev, st);
      if (st.status === 'running' || st.status === 'paused') continue;
      if (!st.auto || ev.schedule.type === 'manual') {
        st.nextRunAt = null;
        continue;
      }
      if (st.nextRunAt === null) st.nextRunAt = nextRun(ev.schedule, ctx.now - 1, this.tz, st.startedAt);
      if (st.nextRunAt !== null && ctx.now >= st.nextRunAt) this.startEvent(ctx, ev, st);
    }
    const changed = before !== JSON.stringify(draft);
    if (changed || ctx.events.length) {
      draft.revision += 1;
      this.state = draft;
    }
    return ctx.events;
  }

  /** Pilotage manuel d'un événement. */
  eventControl(id: Id, cmd: EventCommand): EngineEvent[] {
    const ev = (this.world.events ?? []).find((e) => e.id === id);
    if (!ev) throw new RuleError('Événement inconnu.');
    return this.transact((draft) => {
      const ctx = this.worldCtx(draft);
      const st = (draft.events[id] ??= { status: 'idle', auto: ev.schedule.type !== 'manual', elapsedMs: 0, stepsDone: 0, nextRunAt: null, runs: 0 });
      const active = st.status === 'running' || st.status === 'paused';
      switch (cmd) {
        case 'start':
          if (active) throw new RuleError('L’événement est déjà en cours.');
          this.startEvent(ctx, ev, st);
          break;
        case 'pause':
          if (st.status !== 'running') throw new RuleError('L’événement n’est pas en cours.');
          st.elapsedMs = this.elapsed(st, ctx.now);
          st.resumedAt = undefined;
          st.status = 'paused';
          break;
        case 'resume':
          if (st.status !== 'paused') throw new RuleError('L’événement n’est pas en pause.');
          st.status = 'running';
          st.resumedAt = ctx.now;
          this.advanceEvent(ctx, ev, st);
          break;
        case 'stop':
          if (!active) throw new RuleError('L’événement n’est pas en cours.');
          this.endEvent(ctx, ev, st);
          break;
        case 'restart':
          if (active) this.endEvent(ctx, ev, st);
          this.startEvent(ctx, ev, st);
          break;
      }
      return ctx.events;
    });
  }

  /** Active ou coupe la programmation automatique d'un événement. */
  setEventAuto(id: Id, auto: boolean): void {
    const ev = (this.world.events ?? []).find((e) => e.id === id);
    if (!ev) throw new RuleError('Événement inconnu.');
    if (auto && ev.schedule.type === 'manual') throw new RuleError('Cet événement n’a pas de programmation : il se lance à la main.');
    this.transact((draft) => {
      const st = (draft.events[id] ??= { status: 'idle', auto, elapsedMs: 0, stepsDone: 0, nextRunAt: null, runs: 0 });
      st.auto = auto;
      st.nextRunAt = auto && st.status !== 'running' && st.status !== 'paused' ? nextRun(ev.schedule, this.now(), this.tz, st.startedAt) : null;
    });
  }

  /** Impose une météo (minutes facultatives). */
  setWeather(value: string, minutes?: number): EngineEvent[] {
    return this.transact((draft) => {
      const ctx = this.worldCtx(draft);
      applyAction(ctx, { type: 'weather.set', value, minutes });
      return ctx.events;
    });
  }

  /** Active ou suspend les changements automatiques de météo. */
  setWeatherAuto(auto: boolean): void {
    if (!this.world.weather) throw new RuleError('Aucune météo configurée.');
    this.transact((draft) => {
      if (draft.weather) {
        draft.weather.auto = auto;
        // À la reprise, la météo actuelle reste au moins le temps prévu.
        if (auto && draft.weather.until < this.now()) draft.weather.until = this.now();
      }
    });
  }

  /** État en direct de la météo et des événements (supervision). */
  live(): LiveStatus {
    const now = this.now();
    const wdef = this.world.weather;
    const w = this.state.weather;
    const label = (value: string) => this.world.variables.find((v) => v.id === wdef?.variable)?.options?.find((o) => o.value === value)?.label ?? value;
    return {
      timezone: this.tz,
      now,
      weather: wdef && w ? { variable: wdef.variable, value: w.value, label: label(w.value), since: w.since, until: w.until, auto: w.auto } : null,
      events: (this.world.events ?? []).map((ev) => {
        const st = this.state.events[ev.id] ?? { status: 'idle' as const, auto: ev.schedule.type !== 'manual', elapsedMs: 0, stepsDone: 0, nextRunAt: null, runs: 0 };
        return {
          id: ev.id,
          name: ev.name,
          emoji: ev.emoji ?? '📅',
          description: ev.description ?? '',
          schedule: describeSchedule(ev.schedule),
          manual: ev.schedule.type === 'manual',
          status: st.status,
          auto: st.auto,
          elapsedMs: this.elapsed(st, now),
          durationMs: ev.durationMinutes * 60_000,
          startedAt: st.startedAt ?? null,
          nextRunAt: st.nextRunAt,
          runs: st.runs,
          stepsDone: st.stepsDone,
          steps: [...ev.steps].sort((a, b) => a.afterMinutes - b.afterMinutes).map((s) => ({ name: s.name ?? `Étape à ${s.afterMinutes} min`, afterMinutes: s.afterMinutes })),
          lastError: st.lastError ?? null,
        };
      }),
    };
  }

  /** Modifie une variable du monde (phase du scénario…). */
  setVariable(variable: Id, value: string | number): void {
    const def = this.world.variables.find((v) => v.id === variable);
    if (!def) throw new RuleError(`Variable inconnue : ${variable}`);
    if (def.options && !def.options.some((o) => o.value === value))
      throw new RuleError(`Valeur invalide pour ${def.name} : ${value}`);
    this.transact((draft) => {
      draft.variables[variable] = value;
    });
  }

  /** Identifiants des joueurs connus. */
  playerIds(): Id[] {
    return Object.keys(this.state.players);
  }

  /** Son d'ambiance actuel d'un bâtiment (selon les variables du monde), ou undefined. */
  ambienceFor(buildingId: Id): Id | undefined {
    const b = this.world.buildings.find((x) => x.id === buildingId);
    const choice = b?.audio?.ambience;
    if (!choice) return undefined;
    if (typeof choice === 'string') return choice;
    const draft = structuredClone(this.state);
    const ctx = this.ctx(draft, { id: '', player: '__ambience__', building: buildingId, screen: '', ui: {}, createdAt: 0 });
    return choice.cases.find((c) => evaluate(ctx, c.when).ok)?.sound;
  }

  /** Rendu actuel d'une session (applique les redirections d'accès si nécessaire). */
  /** Fermeture du monde (world.closure) : le texte à afficher, ou undefined si le monde est ouvert. */
  private closureText(ctx: Ctx): string | undefined {
    const c = this.world.closure;
    if (!c || !evaluate(ctx, c.when).ok) return undefined;
    return pickText(ctx, c.text) || '🔒 Le monde est fermé.';
  }

  view(sessionId: Id): View {
    const session = this.state.sessions[sessionId];
    if (!session) return { message: { components: [text('⌛ Cette interface a expiré. Relance la commande.')] }, wakeAt: null };
    // Garde d'accès évaluée à chaque affichage (ex. démission pendant qu'on est en cuisine).
    const b = this.building(session.building);
    const screen = this.screen(b, session.screen);
    if (screen.guard) {
      const probe = this.ctx(structuredClone(this.state), session);
      if (!evaluate(probe, screen.guard.when).ok) {
        this.transact((draft) => {
          const s = draft.sessions[sessionId]!;
          const c = this.ctx(draft, s);
          this.enter(s, screen.guard!.redirect);
          s.notice = pickText(c, screen.guard!.notice) || undefined;
        });
      }
    }
    return this.renderSession(sessionId);
  }

  private renderSession(sessionId: Id): View {
    // Rendu sur une copie : les initialisations d'état d'interface ne sont pas persistées.
    const draft = structuredClone(this.state);
    const session = draft.sessions[sessionId]!;
    const ctx = this.ctx(draft, session);
    const b = ctx.building;
    const closed = this.closureText(ctx);
    if (closed !== undefined) return { message: { components: [{ type: 'container', accent: b.accentColor, children: [text(closed)] }] }, wakeAt: null };
    const screen = this.screen(b, session.screen);
    let wakeAt: number | null = null;
    const components: RTopLevel[] = [];
    let noticeShown = false;

    const renderBlocks = (blocks: Block[], prefix: string, into: RTopLevel[] | RContainer['children'], nested: boolean) => {
      blocks.forEach((block, i) => {
        const path = prefix ? `${prefix}.${i}` : String(i);
        if (!evaluate(ctx, block.visibleIf).ok) return;
        switch (block.type) {
          case 'text': {
            const content = pickText(ctx, block.text);
            if (content.trim()) into.push(text(content));
            break;
          }
          case 'notice':
            if (session.notice) into.push(text(session.notice));
            noticeShown = true;
            break;
          case 'separator':
            into.push({ type: 'separator', large: block.large });
            break;
          case 'container': {
            if (nested) break; // pas d'encadré dans un encadré (refusé par le validateur)
            const children: RContainer['children'] = [];
            renderBlocks(block.children, path, children, true);
            if (children.length) (into as RTopLevel[]).push({ type: 'container', accent: block.accent ?? b.accentColor, children });
            break;
          }
          case 'section':
            if (evaluate(ctx, block.button.visibleIf).ok)
              into.push({
                type: 'section',
                texts: [text(pickText(ctx, block.text) || ' ')],
                accessory: this.renderButton(ctx, block.button, `${sessionId}${SEP}b${SEP}${screen.id}${SEP}${path}`),
              });
            else {
              const content = pickText(ctx, block.text);
              if (content.trim()) into.push(text(content));
            }
            break;
          case 'buttons': {
            const btns = block.buttons
              .map((bd, j) => ({ bd, j }))
              .filter(({ bd }) => evaluate(ctx, bd.visibleIf).ok)
              .map(({ bd, j }) => this.renderButton(ctx, bd, `${sessionId}${SEP}b${SEP}${screen.id}${SEP}${path}.${j}`));
            for (let k = 0; k < btns.length; k += 5) into.push({ type: 'row', items: btns.slice(k, k + 5) });
            break;
          }
          case 'widget': {
            if (nested) break; // les widgets sont toujours au premier niveau
            const env = this.widgetEnv(ctx, session, screen.id, path, (t) => {
              wakeAt = wakeAt === null ? t : Math.min(wakeAt, t);
            });
            (into as RTopLevel[]).push(...renderWidget(env, block.widget));
            break;
          }
        }
      });
    };
    renderBlocks(screen.blocks, '', components, false);
    if (session.notice && !noticeShown) components.splice(Math.min(1, components.length), 0, text(session.notice));
    return { message: { components }, wakeAt };
  }

  private renderButton(ctx: Ctx, bd: ButtonDef, customId: string): RButton {
    return { type: 'button', label: pickText(ctx, bd.label) || ' ', emoji: bd.emoji, style: bd.style ?? 'secondary', customId };
  }

  private widgetEnv(ctx: Ctx, session: SessionState, screenId: Id, path: string, wake: (t: number) => void): WidgetEnv {
    return {
      ctx,
      session,
      screenId,
      path,
      id: (verb, arg = '') => [session.id, 'w', screenId, path, verb, arg].join(SEP),
      ui: <T extends object>(key: string, init: () => T) => (session.ui[key] ??= init()) as T,
      local: <T extends object>(init: () => T) => (session.ui[`@${screenId}:${path}`] ??= init()) as T,
      wake,
      random: this.random,
    };
  }

  /** Changement d'écran : l'état local des widgets de l'écran d'arrivée est réinitialisé. */
  private enter(session: SessionState, screenId: Id) {
    if (session.screen !== screenId)
      for (const key of Object.keys(session.ui)) if (key.startsWith(`@${screenId}:`)) delete session.ui[key];
    session.screen = screenId;
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  /**
   * Traite un clic ou une sélection. customId est autonome (session, écran, chemin du bloc) :
   * les interfaces restent fonctionnelles après un redémarrage du bot.
   */
  interact(playerId: Id, customId: string, values: string[] = []): InteractionResult {
    const [sessionId, kind, screenId, path, verb = '', arg = ''] = customId.split(SEP);
    const session = sessionId ? this.state.sessions[sessionId] : undefined;
    if (!session) return { ok: false, private: '⌛ Cette interface a expiré. Relance la commande.' };
    if (session.player !== playerId) return { ok: false, private: "🔒 Cette interface appartient à un autre joueur. Ouvre la tienne." };
    const b = this.building(session.building);
    const closed = this.closureText(this.ctx(structuredClone(this.state), session));
    if (closed !== undefined) return { ok: false, private: closed };
    const screen = b.screens.find((s) => s.id === screenId);
    if (!screen || !path) return { ok: false, private: 'Interaction inconnue.' };

    let events: EngineEvent[] = [];
    try {
      events = this.transact((draft) => {
        const s = draft.sessions[sessionId!]!;
        const ctx = this.ctx(draft, s);
        s.notice = undefined;
        dropExpiredQuest(ctx);
        if (kind === 'b') this.runButton(ctx, s, screen, path);
        else if (kind === 'w') {
          const block = locate(screen.blocks, path);
          if (!block || block.type !== 'widget') throw new RuleError('Élément introuvable (contenu modifié ?).');
          const env = this.widgetEnv(ctx, s, screen.id, path, () => {});
          const r = handleWidget(env, block.widget, verb, arg, values);
          if (r.goto) this.enter(s, r.goto);
          if (r.notice) s.notice = r.notice;
        } else throw new RuleError('Interaction inconnue.');
        if (ctx.notes?.length) s.notice = [s.notice, ...ctx.notes].filter(Boolean).join('\n\n');
        return ctx.events;
      });
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      // Échec : rien n'est modifié, sauf le message de retour (et la redirection éventuelle).
      this.transact((draft) => {
        const s = draft.sessions[sessionId!]!;
        if (e.goto) this.enter(s, e.goto);
        s.notice = e.message;
      });
    }
    const notice = this.state.sessions[sessionId!]?.notice;
    return { ok: true, message: this.view(sessionId!).message, notice, events };
  }

  private runButton(ctx: Ctx, s: SessionState, screen: ScreenDef, path: string) {
    const parts = path.split('.');
    // Bouton d'une rangée : dernier segment = index du bouton ; bouton de section : chemin du bloc.
    let bd: ButtonDef | undefined;
    const block = locate(screen.blocks, path);
    if (block?.type === 'section') bd = block.button;
    else {
      const row = locate(screen.blocks, parts.slice(0, -1).join('.'));
      if (row?.type === 'buttons') bd = row.buttons[Number(parts.at(-1))];
    }
    if (!bd) throw new RuleError('Bouton introuvable (contenu modifié ?).');
    if (!evaluate(ctx, bd.visibleIf).ok) throw new RuleError("Cette action n'est plus disponible.");
    this.runRule(ctx, s, bd.rule);
  }

  private runRule(ctx: Ctx, s: SessionState, rule: Rule) {
    const verdict = evaluate(ctx, rule.when);
    const fail = (reason: string): never => {
      throw new RuleError(pickText(ctx, rule.onFailure?.notice) || `⚠️ ${reason}`, rule.onFailure?.goto);
    };
    if (!verdict.ok) fail(verdict.reason);
    try {
      for (const a of rule.actions ?? []) applyAction(ctx, a);
    } catch (e) {
      if (e instanceof RuleError) fail(e.message.replace(/^⚠️ /, ''));
      throw e;
    }
    if (rule.onSuccess?.goto) this.enter(s, rule.onSuccess.goto);
    const notice = pickText(ctx, rule.onSuccess?.notice);
    if (notice) s.notice = notice.replace('{changes}', describeChanges(ctx));
  }
}

const NO_BUILDING: BuildingDef = { id: '', name: '', modules: [], screens: [{ id: 'vide', name: 'Vide', blocks: [] }], homeScreen: 'vide' };

/** Retrouve un bloc par son chemin (« 3 », « 2.1 »). */
export function locate(blocks: Block[], path: string): Block | undefined {
  let list: Block[] | undefined = blocks;
  let found: Block | undefined;
  for (const seg of path.split('.')) {
    if (!list) return undefined;
    found = list[Number(seg)];
    list = found?.type === 'container' ? found.children : undefined;
  }
  return found;
}
