/**
 * Émulateur Discord intégré : exécute le vrai moteur sur le brouillon, dans le navigateur,
 * avec des joueurs fictifs et une horloge accélérable. Rien n'est envoyé au serveur.
 */
import { Engine, entrancePanel, parseEnter, validateRendered, type RenderedMessage, type RTopLevel, type RButton, type RSelect, type WorldDef } from '../../../packages/engine/src/index.ts';
import { h, clear, esc } from './ui.ts';

const NAMES = ['Perceval', 'Guenièvre', 'Bohort', 'Iseult'];

function md(src: string, names: Map<string, string>): string {
  const inline = (s: string) =>
    s
      .replace(/&lt;@([\w-]+)&gt;/g, (_, id: string) => `<span class="d-mention">@${esc(names.get(id) ?? id)}</span>`)
      .replace(/&lt;t:(\d+):?\w?&gt;/g, (_, t: string) => `<span class="d-ts">${new Date(Number(t) * 1000).toLocaleTimeString('fr-FR')}</span>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/__([^_]+)__/g, '<u>$1</u>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  return esc(src)
    .split('\n')
    .map((line) => {
      const m = /^(#{1,3}) (.*)$/.exec(line);
      return m ? `<span class="d-h${m[1]!.length}">${inline(m[2]!)}</span>` : inline(line);
    })
    .join('\n');
}

/** Dessine un message Components V2. onAct(customId, values) est appelé au clic. */
export function renderMessage(msg: RenderedMessage, onAct: (id: string, values: string[]) => void, names = new Map<string, string>()): HTMLElement {
  const button = (b: RButton) =>
    h('button', { class: `d-btn ${b.style}`, type: 'button', onclick: () => onAct(b.customId, []) }, (b.emoji ? b.emoji + ' ' : '') + b.label);
  const select = (s: RSelect) => {
    const sel = h(
      'select',
      { class: 'd-select', 'aria-label': s.placeholder, onchange: (e: Event) => onAct(s.customId, [(e.target as HTMLSelectElement).value]) },
      h('option', { value: '', disabled: true, selected: !s.options.some((o) => o.default) }, s.placeholder),
      s.options.map((o) => h('option', { value: o.value, selected: !!o.default }, `${o.emoji ? o.emoji + ' ' : ''}${o.label}${o.description ? ' — ' + o.description : ''}`)),
    );
    return sel;
  };
  const comp = (c: RTopLevel): HTMLElement => {
    switch (c.type) {
      case 'text':
        return h('div', { class: 'd-text', html: md(c.content, names) });
      case 'separator':
        return h('hr', { class: c.large ? 'd-sep lg' : 'd-sep' });
      case 'section':
        return h('div', { class: 'd-section' }, h('div', { class: 'd-text', html: md(c.texts.map((t) => t.content).join('\n'), names) }), button(c.accessory));
      case 'row':
        return h('div', { class: 'd-row' }, (c.items as (RButton | RSelect)[]).map((i) => (i.type === 'button' ? button(i) : select(i))));
      case 'container':
        return h(
          'div',
          { class: 'd-container', style: c.accent !== undefined ? `--accent:#${c.accent.toString(16).padStart(6, '0')}` : '' },
          c.children.map((x) => comp(x as RTopLevel)),
        );
    }
  };
  return h('div', { class: 'd-message' }, msg.components.map(comp));
}

/** Émulateur complet : joueurs fictifs, horloge, état inspectable. */
export class Emulator {
  private engine!: Engine;
  private offset = 0;
  private players: { id: string; name: string; sessions: Record<string, string> }[] = [];
  private current = 0;
  private building: string;
  private notice: string | null = null;
  private timer?: number;
  readonly el = h('div', { class: 'emulator' });
  private world: WorldDef;

  constructor(world: WorldDef, building?: string) {
    this.world = world;
    this.building = building ?? world.buildings[0]?.id ?? '';
    this.reset();
  }

  /** Recharge le monde (après modification) en conservant l'état simulé. */
  update(world: WorldDef) {
    const snap = this.engine.snapshot();
    this.world = structuredClone(world);
    try {
      this.engine = new Engine(this.world, snap, { now: () => Date.now() + this.offset });
    } catch {
      this.reset();
    }
    if (!this.world.buildings.some((b) => b.id === this.building)) this.building = this.world.buildings[0]?.id ?? '';
    this.render();
  }

  reset() {
    this.offset = 0;
    this.engine = new Engine(structuredClone(this.world), undefined, { now: () => Date.now() + this.offset });
    this.players = NAMES.slice(0, 2).map((name, i) => ({ id: `essai-${i + 1}`, name, sessions: {} }));
    this.current = 0;
    this.notice = null;
    this.render();
  }

  mount(into: HTMLElement) {
    into.append(this.el);
    this.timer = window.setInterval(() => (this.engine.tick(), this.render(true)), 1000);
    return this;
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.el.remove();
  }

  /** Interface ouverte du joueur dans ce bâtiment (null : il est devant l'entrée). */
  private session(): string | null {
    const p = this.players[this.current]!;
    const sid = this.building ? p.sessions[this.building] : undefined;
    if (sid && this.engine.session(sid)) return sid;
    if (this.building) delete p.sessions[this.building];
    return null;
  }

  /** Comme sur Discord : on entre par le bouton du panneau, on sort en quittant le salon vocal. */
  private enter() {
    const p = this.players[this.current]!;
    this.engine.closeSessionsOf(p.id, this.building);
    p.sessions[this.building] = this.engine.openSession(p.id, this.building).sessionId;
    this.notice = null;
    this.render();
  }

  private leave() {
    const p = this.players[this.current]!;
    this.engine.closeSessionsOf(p.id, this.building);
    delete p.sessions[this.building];
    this.notice = null;
    this.render();
  }

  private lastJson = '';
  private render(tick = false) {
    const sid = this.session();
    const p = this.players[this.current]!;
    const names = new Map(this.players.map((x) => [x.id, x.name]));
    const view = sid ? this.engine.view(sid) : null;
    const b = this.world.buildings.find((x) => x.id === this.building);
    const shown = view?.message ?? (b ? entrancePanel(b) : null);
    const json = JSON.stringify(shown) + this.notice + this.current + this.building + this.engine.revision;
    if (tick && json === this.lastJson) return;
    this.lastJson = json;
    const issues = shown ? validateRendered(shown) : [];
    const ps = this.engine.player(p.id);
    clear(
      this.el,
      h(
        'div',
        { class: 'emu-bar' },
        h(
          'div',
          { class: 'emu-players', role: 'tablist', 'aria-label': 'Joueur simulé' },
          this.players.map((x, i) =>
            h('button', { class: `chip${i === this.current ? ' on' : ''}`, role: 'tab', 'aria-selected': String(i === this.current), onclick: () => ((this.current = i), (this.notice = null), this.render()) }, x.name),
          ),
          this.players.length < NAMES.length
            ? h('button', { class: 'chip ghost', onclick: () => (this.players.push({ id: `essai-${this.players.length + 1}`, name: NAMES[this.players.length]!, sessions: {} }), (this.current = this.players.length - 1), this.render()), title: 'Ajouter un joueur simulé' }, '+')
            : null,
        ),
        this.world.buildings.length > 1
          ? h(
              'select',
              { class: 'emu-building', 'aria-label': 'Bâtiment', onchange: (e: Event) => ((this.building = (e.target as HTMLSelectElement).value), this.render()) },
              this.world.buildings.map((b) => h('option', { value: b.id, selected: b.id === this.building }, `${b.emoji ?? ''} ${b.name}`)),
            )
          : null,
        h(
          'div',
          { class: 'emu-time' },
          h('button', { class: 'chip', onclick: () => this.advance(1), title: 'Avancer le temps d’une minute' }, '+1 min'),
          h('button', { class: 'chip', onclick: () => this.advance(10), title: 'Avancer le temps de dix minutes' }, '+10 min'),
          this.eventControls(),
          h('button', { class: 'chip', onclick: () => this.reset(), title: 'Repartir de zéro' }, 'Réinitialiser'),
        ),
      ),
      h(
        'div',
        { class: 'emu-screen' },
        h('div', { class: 'd-author' }, h('span', { class: 'd-avatar' }, this.world.buildings.find((b) => b.id === this.building)?.emoji ?? '🏰'), h('b', null, this.world.name), h('span', { class: 'd-app' }, 'APP')),
        view ? h('div', { class: 'd-ephemeral-head' }, '👁️ Interface personnelle — seul·e ', p.name, ' la voit') : b ? h('div', { class: 'd-ephemeral-head' }, '🔊 ', p.name, ' est dans le salon vocal : il voit l’entrée du bâtiment') : null,
        shown ? renderMessage(shown, (id, values) => (parseEnter(id) ? this.enter() : this.act(id, values)), names) : h('p', { class: 'muted' }, 'Aucun bâtiment à afficher.'),
        view ? h('button', { class: 'chip', onclick: () => this.leave(), title: 'Simule la sortie du salon vocal : l’interface disparaît' }, '🚶 Quitter le salon vocal') : null,
        this.notice ? h('div', { class: 'd-ephemeral' }, '👁️ Seul·e toi peux voir ceci — ', this.notice) : null,
        issues.length ? h('div', { class: 'd-limit' }, '⚠️ Limites Discord dépassées : ', issues.join(' · ')) : null,
      ),
      ps
        ? h(
            'div',
            { class: 'emu-state' },
            this.world.stats.map((s) => h('span', null, `${s.emoji ?? ''} ${s.name} `, h('b', null, String(ps.stats[s.id] ?? s.initial)))),
            ps.activeJobs.map((j) => h('span', null, `⚒️ ${this.world.jobs.find((x) => x.id === j)?.name ?? j} niv. `, h('b', null, String(ps.jobs[j]?.level ?? 1)))),
            this.offset ? h('span', { class: 'muted' }, `Horloge +${Math.round(this.offset / 60000)} min`) : null,
          )
        : null,
    );
  }

  /** Avance l'horloge simulée minute par minute en faisant tourner le monde (météo, événements). */
  private advance(minutes: number) {
    for (let i = 0; i < minutes; i++) {
      this.offset += 60_000;
      this.engine.tick();
    }
    this.render();
  }

  /** Lancer / arrêter un événement manuel (scénario) directement dans l'essai. */
  private eventControls() {
    const manual = (this.world.events ?? []).filter((e) => e.schedule.type === 'manual');
    if (!manual.length) return null;
    const live = this.engine.live().events;
    return manual.map((ev) => {
      const st = live.find((x) => x.id === ev.id);
      const running = st?.status === 'running' || st?.status === 'paused';
      const mins = st ? Math.floor(st.elapsedMs / 60_000) : 0;
      return h(
        'button',
        {
          class: `chip${running ? ' on' : ''}`,
          title: running ? 'Arrêter cet événement' : 'Lancer cet événement dans l’essai',
          onclick: () => {
            try {
              this.engine.eventControl(ev.id, running ? 'stop' : 'start');
              this.engine.tick();
            } catch (e) {
              this.notice = (e as Error).message;
            }
            this.render();
          },
        },
        running ? `■ ${ev.emoji ?? ''} T+${mins}` : `▶ ${ev.emoji ?? ''} ${ev.name}`,
      );
    });
  }

  private act(customId: string, values: string[]) {
    const p = this.players[this.current]!;
    try {
      const r = this.engine.interact(p.id, customId, values);
      this.notice = r.private ?? null;
    } catch (e) {
      this.notice = `Erreur du moteur : ${(e as Error).message}`;
    }
    this.render();
  }
}
