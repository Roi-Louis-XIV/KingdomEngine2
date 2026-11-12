/** Petit simulateur de joueur : cliquer sur un bouton par son libellé, choisir dans un menu. */
import { readFileSync } from 'node:fs';
import { Engine, type RenderedMessage, type RTopLevel, type RButton, type RSelect, type WorldDef } from '../src/index.ts';

export const loadWorld = (): WorldDef =>
  JSON.parse(readFileSync(new URL('../../../content/le-royaume/world.json', import.meta.url), 'utf8'));

export class Clock {
  t = Date.UTC(2026, 10, 9, 12, 0, 0);
  now = () => this.t;
  advance(sec: number) {
    this.t += sec * 1000;
  }
}

/** Générateur pseudo-aléatoire déterministe. */
export function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

export function makeEngine(world = loadWorld()) {
  const clock = new Clock();
  let n = 0;
  const engine = new Engine(world, undefined, { now: clock.now, random: seeded(), newId: () => `s${++n}` });
  return { engine, clock, world };
}

function walk(msg: RenderedMessage) {
  const buttons: RButton[] = [];
  const selects: RSelect[] = [];
  const texts: string[] = [];
  const visit = (c: RTopLevel | { type: 'text'; content: string }) => {
    if (c.type === 'text') texts.push(c.content);
    else if (c.type === 'container') c.children.forEach(visit);
    else if (c.type === 'section') {
      c.texts.forEach(visit);
      buttons.push(c.accessory);
    } else if (c.type === 'row')
      for (const i of c.items as (RButton | RSelect)[]) i.type === 'button' ? buttons.push(i) : selects.push(i);
  };
  msg.components.forEach(visit);
  return { buttons, selects, text: texts.join('\n') };
}

export class Player {
  sessionId: string;
  message: RenderedMessage;
  lastPrivate?: string;
  readonly engine: Engine;
  readonly id: string;
  constructor(engine: Engine, id: string, building = 'taverne', name?: string) {
    this.engine = engine;
    this.id = id;
    const { sessionId, view } = engine.openSession(id, building, name);
    this.sessionId = sessionId;
    this.message = view.message;
  }
  get text() {
    return walk(this.message).text;
  }
  get buttons() {
    return walk(this.message).buttons.map((b) => b.label);
  }
  refresh() {
    this.message = this.engine.view(this.sessionId).message;
    return this;
  }
  button(label: string | RegExp): RButton {
    const all = walk(this.message).buttons;
    const b = all.find((x) => (typeof label === 'string' ? x.label === label : label.test(x.label)));
    if (!b) throw new Error(`Bouton « ${label} » introuvable. Disponibles : ${all.map((x) => x.label).join(' | ')}`);
    return b;
  }
  click(label: string | RegExp) {
    const r = this.engine.interact(this.id, this.button(label).customId);
    this.lastPrivate = r.private;
    if (r.message) this.message = r.message;
    return this;
  }
  hasSelect(placeholder: RegExp) {
    return walk(this.message).selects.some((s) => placeholder.test(s.placeholder));
  }
  options(placeholder: RegExp) {
    const s = walk(this.message).selects.find((x) => placeholder.test(x.placeholder));
    if (!s) throw new Error(`Menu ${placeholder} introuvable. Texte :\n${this.text}`);
    return s.options;
  }
  choose(placeholder: RegExp, value: string) {
    const s = walk(this.message).selects.find((x) => placeholder.test(x.placeholder));
    if (!s) throw new Error(`Menu ${placeholder} introuvable. Texte :\n${this.text}`);
    if (!s.options.some((o) => o.value === value)) throw new Error(`Option ${value} absente : ${s.options.map((o) => o.value)}`);
    const r = this.engine.interact(this.id, s.customId, [value]);
    if (r.message) this.message = r.message;
    return this;
  }
  get screen() {
    return this.engine.snapshot().sessions[this.sessionId]!.screen;
  }
  get state() {
    return this.engine.player(this.id)!;
  }
}
