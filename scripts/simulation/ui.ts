// Outils d'interface pour les joueurs virtuels : naviguer vers n'importe quel écran, lire et cliquer.
import { Engine } from '../../packages/engine/src/index.ts';
export type Btn = { label: string; customId: string; disabled?: boolean; section?: string };
export type Sel = { placeholder: string; customId: string; options: { value: string; label: string }[] };

export function walk(msg: any) {
  const buttons: Btn[] = []; const selects: Sel[] = []; const texts: string[] = [];
  const visit = (c: any) => {
    if (c.type === 'text') texts.push(c.content);
    else if (c.type === 'container') c.children.forEach(visit);
    else if (c.type === 'section') { const t = c.texts.map((x: any) => x.content).join('\n'); texts.push(t); if (c.accessory?.type === 'button') buttons.push({ ...c.accessory, section: t }); }
    else if (c.type === 'row') for (const i of c.items) i.type === 'button' ? buttons.push(i) : selects.push(i);
  };
  msg.components.forEach(visit);
  return { buttons, selects, text: texts.join('\n') };
}

/** Chemins de tous les boutons d'un écran (comme le moteur les numérote). */
function buttonPaths(blocks: any[], prefix = ''): { path: string; def: any }[] {
  const out: { path: string; def: any }[] = [];
  blocks.forEach((b, i) => {
    const p = prefix ? `${prefix}.${i}` : String(i);
    if (b.type === 'buttons') b.buttons.forEach((bd: any, j: number) => out.push({ path: `${p}.${j}`, def: bd }));
    else if (b.type === 'section' && b.button) out.push({ path: p, def: b.button });
    if (b.blocks) out.push(...buttonPaths(b.blocks, p));
    if (b.children) out.push(...buttonPaths(b.children, p));
  });
  return out;
}

const ROUTES = new Map<string, string[]>();
export class Bot {
  sid = ''; building = ''; msg: any; notice = '';
  e: Engine; id: string; name: string;
  constructor(e: Engine, id: string, name: string) { this.e = e; this.id = id; this.name = name; }
  get st() { return this.e.player(this.id)!; }
  get screen() { return (this.e as any).state.sessions[this.sid]?.screen; }
  open(building: string) {
    if (this.building === building && this.sid && (this.e as any).state.sessions[this.sid]) return;
    if (this.sid) try { this.e.closeSession(this.sid); } catch {}
    const r = this.e.openSession(this.id, building, this.name);
    this.sid = r.sessionId; this.building = building; this.msg = r.view.message;
  }
  refresh() { this.msg = this.e.view(this.sid).message; return this; }
  get ui() { return walk(this.msg); }
  /** Va sur un écran du bâtiment en cliquant (virtuellement) un bouton qui y mène, où qu'il soit. */
  goto(building: string, screen: string): boolean {
    this.open(building);
    if (this.screen === screen) { this.refresh(); return true; }
    const key = building + '/' + screen;
    let cands = ROUTES.get(key);
    if (!cands) {
      cands = [];
      const b = (this.e as any).world.buildings.find((x: any) => x.id === building);
      for (const s of b.screens) for (const { path, def } of buttonPaths(s.blocks)) if (def.rule?.onSuccess?.goto === screen) cands.push(`${s.id}|${path}`);
      ROUTES.set(key, cands);
    }
    for (let i = 0; i < cands.length; i++) {
      const r = this.e.interact(this.id, `${this.sid}|b|${cands[i]}`);
      if (r.message) this.msg = r.message;
      if (this.screen === screen) { if (i) cands.unshift(cands.splice(i, 1)[0]!); return true; }
    }
    return false;
  }
  click(label: RegExp, sectionMatch?: RegExp): boolean {
    const b = this.ui.buttons.find((x) => label.test(x.label) && !x.disabled && (!sectionMatch || sectionMatch.test(x.section ?? '')));
    if (!b) return false;
    const r = this.e.interact(this.id, b.customId);
    if (r.message) this.msg = r.message;
    this.notice = r.notice ?? '';
    return true;
  }
  choose(ph: RegExp, value: string): boolean {
    const s = this.ui.selects.find((x) => ph.test(x.placeholder));
    if (!s || !s.options.some((o) => o.value === value)) return false;
    const r = this.e.interact(this.id, s.customId, [value]);
    if (r.message) this.msg = r.message;
    return true;
  }
}
