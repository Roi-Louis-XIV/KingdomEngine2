/** Conditions expliquées, textes conditionnels, actions transactionnelles. */
import type { Action, CompareOp, Condition, Id, Text, WorldDef, ModuleDef, BuildingDef } from './model.ts';
import type { PlayerState, WorldState } from './state.ts';
import { scopeKey } from './state.ts';

/** Tout ce dont une règle a besoin : monde, état (brouillon en transaction), joueur, bâtiment, horloge. */
export interface Ctx {
  world: WorldDef;
  state: WorldState;
  playerId: Id;
  player: PlayerState;
  building: BuildingDef;
  now: number;
  /** Changements accumulés pendant la transaction (pour les messages « avant → après »). */
  changes: Change[];
  /** Effets externes à transmettre aux adaptateurs (audio…), émis seulement si la transaction est validée. */
  events: EngineEvent[];
  /** Hasard (tirage de la météo par weather.set sans durée). */
  random?: () => number;
}

export type EngineEvent =
  | { type: 'audio.play'; building: Id; sound: Id; player: Id }
  /** Annonce publique (événement, météo) à diffuser dans le salon d'annonces. */
  | { type: 'announce'; text: string; source: string };

export type Change =
  | { kind: 'stat'; stat: Id; before: number; after: number }
  | { kind: 'item'; item: Id; delta: number; inventory?: Id }
  | { kind: 'modifier'; modifier: Id; durationSec: number; replaced?: Id }
  | { kind: 'job'; job: Id; joined: boolean }
  | { kind: 'xp'; job: Id; amount: number; levelBefore: number; levelAfter: number }
  | { kind: 'variable'; variable: Id; value: string | number }
  | { kind: 'tool'; item: Id; before: number; after: number; max: number };

/** Refus métier : annule la transaction et affiche un message (avec redirection éventuelle). */
export class RuleError extends Error {
  readonly goto?: Id;
  constructor(message: string, goto?: Id) {
    super(message);
    this.name = 'RuleError';
    this.goto = goto;
  }
}

// ---------------------------------------------------------------------------
// Recherches
// ---------------------------------------------------------------------------

export const findStat = (w: WorldDef, id: Id) => w.stats.find((s) => s.id === id);
export const findItem = (w: WorldDef, id: Id) => w.items.find((i) => i.id === id);
export const findJob = (w: WorldDef, id: Id) => w.jobs.find((j) => j.id === id);
export const findModifier = (w: WorldDef, id: Id) => w.modifiers.find((m) => m.id === id);
export const findVariable = (w: WorldDef, id: Id) => w.variables.find((v) => v.id === id);

export function findModule<T extends ModuleDef['type']>(
  b: BuildingDef,
  id: Id,
  type: T,
): Extract<ModuleDef, { type: T }> {
  const m = b.modules.find((x) => x.id === id);
  if (!m || m.type !== type) throw new RuleError(`Module ${type} « ${id} » introuvable dans ${b.id}`);
  return m as Extract<ModuleDef, { type: T }>;
}

export const itemName = (w: WorldDef, id: Id) => {
  const it = findItem(w, id);
  return it ? `${it.emoji ? it.emoji + ' ' : ''}${it.name}` : id;
};

export function jobProgress(p: PlayerState, job: Id) {
  return p.jobs[job] ?? { xp: 0, level: 1 };
}

export function activeModifiers(p: PlayerState, now: number) {
  return p.modifiers.filter((m) => m.expiresAt > now);
}

/** Inventaire ciblé : celui du joueur, ou un inventaire du bâtiment courant. */
export function inventoryOf(ctx: Ctx, inventory?: Id): Record<Id, number> {
  if (!inventory) return ctx.player.items;
  findModule(ctx.building, inventory, 'inventory');
  const key = scopeKey(ctx.building.id, inventory);
  return (ctx.state.inventories[key] ??= {});
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const OPS: Record<CompareOp, (a: number | string, b: number | string) => boolean> = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};
const OP_LABEL: Record<CompareOp, string> = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };

export interface Verdict {
  ok: boolean;
  /** Explication lisible par un créateur (diagnostic du Studio). */
  reason: string;
}

export function evaluate(ctx: Ctx, c: Condition | undefined): Verdict {
  if (!c) return { ok: true, reason: 'aucune condition' };
  const w = ctx.world;
  const p = ctx.player;
  switch (c.type) {
    case 'all': {
      for (const sub of c.conditions) {
        const v = evaluate(ctx, sub);
        if (!v.ok) return v;
      }
      return { ok: true, reason: 'toutes les conditions sont remplies' };
    }
    case 'any': {
      const reasons: string[] = [];
      for (const sub of c.conditions) {
        const v = evaluate(ctx, sub);
        if (v.ok) return v;
        reasons.push(v.reason);
      }
      return { ok: false, reason: `aucune alternative remplie (${reasons.join(' ; ')})` };
    }
    case 'not': {
      const v = evaluate(ctx, c.condition);
      return { ok: !v.ok, reason: v.ok ? `refusé car ${v.reason}` : `accepté car ${v.reason}` };
    }
    case 'stat': {
      const value = p.stats[c.stat] ?? findStat(w, c.stat)?.initial ?? 0;
      const ok = OPS[c.op](value, c.value);
      const name = findStat(w, c.stat)?.name ?? c.stat;
      return { ok, reason: `${name} = ${value} (attendu ${OP_LABEL[c.op]} ${c.value})` };
    }
    case 'hasJob': {
      if (!c.job) {
        const ok = p.activeJobs.length > 0;
        return { ok, reason: ok ? `métier actif : ${p.activeJobs.join(', ')}` : 'aucun métier actif' };
      }
      const ok = p.activeJobs.includes(c.job);
      const name = findJob(w, c.job)?.name ?? c.job;
      return { ok, reason: ok ? `exerce le métier ${name}` : `n'exerce pas le métier ${name}` };
    }
    case 'jobLevel': {
      const level = jobProgress(p, c.job).level;
      const ok = OPS[c.op](level, c.value);
      return { ok, reason: `niveau ${findJob(w, c.job)?.name ?? c.job} = ${level} (attendu ${OP_LABEL[c.op]} ${c.value})` };
    }
    case 'variable': {
      const value = ctx.state.variables[c.variable];
      const ok = value !== undefined && OPS[c.op](value, c.value);
      return { ok, reason: `${findVariable(w, c.variable)?.name ?? c.variable} = ${value} (attendu ${OP_LABEL[c.op]} ${c.value})` };
    }
    case 'item': {
      const qty = inventoryOf(ctx, c.inventory)[c.item] ?? 0;
      const ok = OPS[c.op](qty, c.value);
      const where = c.inventory ? `stock ${c.inventory}` : 'inventaire du joueur';
      return { ok, reason: `${itemName(w, c.item)} : ${qty} dans ${where} (attendu ${OP_LABEL[c.op]} ${c.value})` };
    }
    case 'modifierActive': {
      const active = activeModifiers(p, ctx.now);
      const ok = c.modifier ? active.some((m) => m.id === c.modifier) : active.length > 0;
      return { ok, reason: ok ? 'bonus actif' : 'aucun bonus correspondant actif' };
    }
    case 'tool': {
      const name = itemName(w, c.item);
      if ((p.items[c.item] ?? 0) < 1) return { ok: false, reason: `${name} requis(e)` };
      const dur = p.tools?.[c.item] ?? findItem(w, c.item)?.tool?.maxDurability ?? 0;
      const min = c.minDurability ?? 1;
      return dur >= min ? { ok: true, reason: `${name} : ${dur} de durabilité` } : { ok: false, reason: dur <= 0 ? `${name} cassé(e) : fais-le réparer` : `${name} trop usé(e) (${dur}/${min})` };
    }
  }
}

// ---------------------------------------------------------------------------
// Textes
// ---------------------------------------------------------------------------

export function pickText(ctx: Ctx, t: Text | undefined): string {
  if (t === undefined) return '';
  if (typeof t === 'string') return interpolate(ctx, t);
  for (const c of t.cases) if (evaluate(ctx, c.when).ok) return interpolate(ctx, c.text);
  return '';
}

/**
 * Variables disponibles dans les textes :
 * {player} {player.stat.<id>} {player.job} {player.level.<job>} {player.xp.<job>}
 * {var.<id>} {var.<id>.label} {building.name} {npc.name}
 * {stock.<inventaire>.<objet>} {production.<module>.free|cooking|ready}
 */
export function interpolate(ctx: Ctx, s: string): string {
  return s.replace(/\{([a-zA-Z0-9_.\-]+)\}/g, (whole, path: string) => {
    const v = resolvePath(ctx, path.split('.'));
    return v === undefined ? whole : String(v);
  });
}

function resolvePath(ctx: Ctx, parts: string[]): string | number | undefined {
  const [head, a, b] = parts;
  const p = ctx.player;
  switch (head) {
    case 'player':
      if (!a) return `<@${ctx.playerId}>`;
      if (a === 'stat' && b) return p.stats[b];
      if (a === 'job')
        return p.activeJobs.length ? p.activeJobs.map((j) => findJob(ctx.world, j)?.name ?? j).join(', ') : 'aucun';
      if (a === 'level' && b) return jobProgress(p, b).level;
      if (a === 'xp' && b) return jobProgress(p, b).xp;
      return undefined;
    case 'var': {
      if (!a) return undefined;
      const value = ctx.state.variables[a];
      if (b === 'label') return findVariable(ctx.world, a)?.options?.find((o) => o.value === value)?.label ?? value;
      return value;
    }
    case 'building':
      return a === 'name' ? ctx.building.name : undefined;
    case 'npc':
      return a === 'name' ? ctx.building.npc?.name : a === 'title' ? ctx.building.npc?.title : undefined;
    case 'stock':
      if (!a || !b) return undefined;
      return inventoryOf(ctx, a)[b] ?? 0;
    case 'production': {
      if (!a || !b) return undefined;
      const counts = stationCounts(ctx, a);
      return counts[b as keyof typeof counts];
    }
  }
  return undefined;
}

export function stationCounts(ctx: Ctx, production: Id) {
  const stations = ctx.state.stations[scopeKey(ctx.building.id, production)] ?? [];
  const counts = { free: 0, cooking: 0, ready: 0 };
  for (const s of stations) {
    if (!s) counts.free++;
    else if (ctx.now < s.endsAt) counts.cooking++;
    else counts.ready++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Actions (dans une transaction : une erreur annule tout)
// ---------------------------------------------------------------------------

function clampStat(ctx: Ctx, stat: Id, value: number) {
  const def = findStat(ctx.world, stat);
  if (!def) throw new RuleError(`Statistique inconnue : ${stat}`);
  return Math.min(def.max ?? Infinity, Math.max(def.min, value));
}

export function applyAction(ctx: Ctx, a: Action): void {
  const w = ctx.world;
  const p = ctx.player;
  switch (a.type) {
    case 'stat.add': {
      const def = findStat(w, a.stat);
      if (!def) throw new RuleError(`Statistique inconnue : ${a.stat}`);
      const before = p.stats[a.stat] ?? def.initial;
      // Une dépense impossible échoue (bourse insuffisante) ; un gain est simplement plafonné.
      if (a.amount < 0 && before + a.amount < def.min)
        throw new RuleError(`${def.emoji ?? ''} ${def.name} insuffisant(e) : il manque ${def.min - (before + a.amount)}`.trim());
      const after = clampStat(ctx, a.stat, before + a.amount);
      p.stats[a.stat] = after;
      ctx.changes.push({ kind: 'stat', stat: a.stat, before, after });
      return;
    }
    case 'stat.set': {
      const before = p.stats[a.stat] ?? 0;
      const after = clampStat(ctx, a.stat, a.value);
      p.stats[a.stat] = after;
      ctx.changes.push({ kind: 'stat', stat: a.stat, before, after });
      return;
    }
    case 'item.give': {
      const def = findItem(w, a.item);
      if (!def) throw new RuleError(`Objet inconnu : ${a.item}`);
      const inv = inventoryOf(ctx, a.inventory);
      // Un outil reçu par un joueur qui n'en avait pas arrive neuf.
      if (!a.inventory && def.tool && (inv[a.item] ?? 0) === 0) p.tools[a.item] = def.tool.maxDurability;
      inv[a.item] = (inv[a.item] ?? 0) + a.qty;
      ctx.changes.push({ kind: 'item', item: a.item, delta: a.qty, inventory: a.inventory });
      return;
    }
    case 'item.take': {
      const inv = inventoryOf(ctx, a.inventory);
      const have = inv[a.item] ?? 0;
      if (have < a.qty) throw new RuleError(`${itemName(w, a.item)} : ${have}/${a.qty} disponible(s)`);
      inv[a.item] = have - a.qty;
      if (inv[a.item] === 0) {
        delete inv[a.item];
        if (!a.inventory) delete p.tools[a.item];
      }
      ctx.changes.push({ kind: 'item', item: a.item, delta: -a.qty, inventory: a.inventory });
      return;
    }
    case 'job.join': {
      const job = findJob(w, a.job);
      if (!job) throw new RuleError(`Métier inconnu : ${a.job}`);
      if (p.activeJobs.includes(a.job)) throw new RuleError(`Tu exerces déjà le métier ${job.name}.`);
      if (p.activeJobs.length >= w.settings.maxActiveJobs)
        throw new RuleError(
          w.settings.maxActiveJobs === 1 ? 'Tu exerces déjà un métier.' : `Maximum ${w.settings.maxActiveJobs} métiers simultanés.`,
        );
      p.activeJobs.push(a.job);
      p.jobs[a.job] ??= { xp: 0, level: 1 };
      ctx.changes.push({ kind: 'job', job: a.job, joined: true });
      return;
    }
    case 'job.leave': {
      const target = a.job ?? p.activeJobs[0];
      if (!target || !p.activeJobs.includes(target)) throw new RuleError("Tu n'exerces pas ce métier.");
      // La progression (XP, niveau) est conservée.
      p.activeJobs = p.activeJobs.filter((j) => j !== target);
      ctx.changes.push({ kind: 'job', job: target, joined: false });
      return;
    }
    case 'job.xp': {
      const job = findJob(w, a.job);
      if (!job) throw new RuleError(`Métier inconnu : ${a.job}`);
      const prog = (p.jobs[a.job] ??= { xp: 0, level: 1 });
      const levelBefore = prog.level;
      prog.xp += a.amount;
      const computed = 1 + Math.floor(prog.xp / Math.max(1, job.xpPerLevel));
      // Le niveau ne redescend jamais.
      prog.level = Math.min(job.maxLevel ?? Infinity, Math.max(prog.level, computed));
      ctx.changes.push({ kind: 'xp', job: a.job, amount: a.amount, levelBefore, levelAfter: prog.level });
      return;
    }
    case 'job.setLevel': {
      const job = findJob(w, a.job);
      if (!job) throw new RuleError(`Métier inconnu : ${a.job}`);
      const prog = (p.jobs[a.job] ??= { xp: 0, level: 1 });
      const levelBefore = prog.level;
      prog.level = a.level;
      prog.xp = (a.level - 1) * job.xpPerLevel;
      ctx.changes.push({ kind: 'xp', job: a.job, amount: 0, levelBefore, levelAfter: a.level });
      return;
    }
    case 'modifier.apply': {
      const mod = findModifier(w, a.modifier);
      if (!mod) throw new RuleError(`Bonus inconnu : ${a.modifier}`);
      let replaced: Id | undefined;
      p.modifiers = p.modifiers.filter((m) => {
        if (m.expiresAt <= ctx.now) return false; // nettoyage des bonus expirés
        const other = findModifier(w, m.id);
        const sameSlot = m.id === mod.id || (mod.exclusiveGroup && other?.exclusiveGroup === mod.exclusiveGroup);
        if (sameSlot && m.id !== mod.id) replaced = m.id;
        return !sameSlot;
      });
      p.modifiers.push({ id: mod.id, expiresAt: ctx.now + a.durationSec * 1000 });
      ctx.changes.push({ kind: 'modifier', modifier: mod.id, durationSec: a.durationSec, replaced });
      return;
    }
    case 'tool.wear': {
      const def = findItem(w, a.item);
      if (!def?.tool) throw new RuleError(`${itemName(w, a.item)} n'est pas un outil.`);
      if ((p.items[a.item] ?? 0) < 1) throw new RuleError(`${itemName(w, a.item)} requis(e).`);
      const before = p.tools[a.item] ?? def.tool.maxDurability;
      if (before <= 0) throw new RuleError(`${itemName(w, a.item)} est cassé(e) : fais-le réparer.`);
      p.tools[a.item] = Math.max(0, before - a.amount);
      ctx.changes.push({ kind: 'tool', item: a.item, before, after: p.tools[a.item]!, max: def.tool.maxDurability });
      return;
    }
    case 'tool.repair': {
      const def = findItem(w, a.item);
      if (!def?.tool) throw new RuleError(`${itemName(w, a.item)} n'est pas un outil.`);
      if ((p.items[a.item] ?? 0) < 1) throw new RuleError(`${itemName(w, a.item)} absent(e) de l'inventaire.`);
      const before = p.tools[a.item] ?? def.tool.maxDurability;
      if (before >= def.tool.maxDurability) throw new RuleError(`${itemName(w, a.item)} est déjà en parfait état.`);
      p.tools[a.item] = Math.min(def.tool.maxDurability, before + (a.amount ?? def.tool.maxDurability));
      ctx.changes.push({ kind: 'tool', item: a.item, before, after: p.tools[a.item]!, max: def.tool.maxDurability });
      return;
    }
    case 'weather.set': {
      const def = w.weather;
      if (!def) throw new RuleError('Aucune météo configurée dans ce monde.');
      const st = def.states.find((s) => s.value === a.value);
      if (!st) throw new RuleError(`Météo inconnue : ${a.value}`);
      const minutes = a.minutes ?? Math.round((st.minMinutes + st.maxMinutes) / 2);
      const prev = ctx.state.weather;
      ctx.state.weather = { value: st.value, since: ctx.now, until: ctx.now + Math.max(1, minutes) * 60_000, auto: prev?.auto ?? true };
      ctx.state.variables[def.variable] = st.value;
      ctx.changes.push({ kind: 'variable', variable: def.variable, value: st.value });
      const text = pickText(ctx, st.announce);
      if (text) ctx.events.push({ type: 'announce', text, source: 'météo' });
      return;
    }
    case 'audio.play': {
      if (!a.sound) throw new RuleError('Son non défini.');
      ctx.events.push({ type: 'audio.play', building: ctx.building.id, sound: a.sound, player: ctx.playerId });
      return;
    }
    case 'variable.set': {
      if (!findVariable(w, a.variable)) throw new RuleError(`Variable inconnue : ${a.variable}`);
      ctx.state.variables[a.variable] = a.value;
      ctx.changes.push({ kind: 'variable', variable: a.variable, value: a.value });
      return;
    }
  }
}

/** Résumé lisible des changements (« ⚡ Énergie 70 → 100 · ✨ … activé 10 min »). */
export function describeChanges(ctx: Ctx, changes: Change[] = ctx.changes): string {
  const parts: string[] = [];
  for (const c of changes) {
    switch (c.kind) {
      case 'stat': {
        const def = findStat(ctx.world, c.stat);
        if (def?.kind === 'currency') continue; // la dépense est annoncée séparément
        if (c.before !== c.after)
          parts.push(`${def?.emoji ?? ''} ${def?.name ?? c.stat} **${c.before} → ${c.after}${def?.max ? '/' + def.max : ''}**`.trim());
        break;
      }
      case 'modifier': {
        const m = findModifier(ctx.world, c.modifier);
        let s = `✨ **${m?.emoji ?? ''} ${m?.name ?? c.modifier}** activé pour ${Math.round(c.durationSec / 60)} min`;
        if (c.replaced) s += ' (bonus précédent remplacé)';
        parts.push(s);
        break;
      }
      case 'tool':
        parts.push(`${itemName(ctx.world, c.item)} **${c.before} → ${c.after}/${c.max}**${c.after === 0 ? ' (cassé·e !)' : ''}`);
        break;
      case 'item':
        if (!c.inventory && c.delta > 0) parts.push(`+${c.delta} ${itemName(ctx.world, c.item)}`);
        break;
      case 'xp':
        if (c.amount) parts.push(`+${c.amount} XP ${findJob(ctx.world, c.job)?.name ?? c.job}`);
        if (c.levelAfter > c.levelBefore) parts.push(`🎉 Niveau ${c.levelAfter} atteint !`);
        break;
      default:
        break;
    }
  }
  return parts.join(' · ');
}
