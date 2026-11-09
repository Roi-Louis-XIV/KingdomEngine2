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
      draft.sessions[id] = { id, player: playerId, building: b.id, screen: b.homeScreen, ui: {}, createdAt: this.now() };
      return id;
    });
    return { sessionId, view: this.view(sessionId) };
  }

  closeSession(sessionId: Id): void {
    if (this.state.sessions[sessionId]) this.transact((d) => void delete d.sessions[sessionId]);
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
    const screen = b.screens.find((s) => s.id === screenId);
    if (!screen || !path) return { ok: false, private: 'Interaction inconnue.' };

    let events: EngineEvent[] = [];
    try {
      events = this.transact((draft) => {
        const s = draft.sessions[sessionId!]!;
        const ctx = this.ctx(draft, s);
        s.notice = undefined;
        if (kind === 'b') this.runButton(ctx, s, screen, path);
        else if (kind === 'w') {
          const block = locate(screen.blocks, path);
          if (!block || block.type !== 'widget') throw new RuleError('Élément introuvable (contenu modifié ?).');
          const env = this.widgetEnv(ctx, s, screen.id, path, () => {});
          const r = handleWidget(env, block.widget, verb, arg, values);
          if (r.goto) this.enter(s, r.goto);
          if (r.notice) s.notice = r.notice;
        } else throw new RuleError('Interaction inconnue.');
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
