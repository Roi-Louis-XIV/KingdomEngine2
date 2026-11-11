/**
 * Quêtes personnelles : propositions tirées selon le niveau, une quête à la fois,
 * étapes (visiter, livrer, compter), récompenses, jamais deux fois la même.
 * Tout passe par le Ctx d'une transaction : un échec annule tout.
 */
import type { CompareOp, Id, QuestDef, QuestLevel, QuestStep } from './model.ts';
import { type Ctx, RuleError, applyAction, evaluate, itemName, pickText } from './rules.ts';

export const STARS = ['', '★', '★★', '★★★'] as const;

export function questLevel(ctx: Ctx, xp?: number): QuestLevel | undefined {
  const sys = ctx.world.quests;
  if (!sys) return undefined;
  const value = xp ?? ctx.player.stats[sys.xpStat] ?? 0;
  const sorted = [...sys.levels].sort((a, b) => a.minXp - b.minXp);
  let level = sorted[0];
  for (const l of sorted) if (value >= l.minXp) level = l;
  return level;
}

export function nextLevel(ctx: Ctx): QuestLevel | undefined {
  const sys = ctx.world.quests;
  if (!sys) return undefined;
  const xp = ctx.player.stats[sys.xpStat] ?? 0;
  return [...sys.levels].sort((a, b) => a.minXp - b.minXp).find((l) => l.minXp > xp);
}

export const findQuest = (ctx: Ctx, id: Id | undefined) => (id ? ctx.world.quests?.quests.find((q) => q.id === id) : undefined);

/** Quête proposable à ce joueur, maintenant. */
export function questAvailable(ctx: Ctx, q: QuestDef): boolean {
  const p = ctx.player;
  if (p.questsDone.includes(q.id) || p.quest?.id === q.id) return false;
  if (!evaluate(ctx, q.when).ok) return false;
  if (q.unique) for (const [id, other] of Object.entries(ctx.state.players)) if (id !== ctx.playerId && other.quest?.id === q.id) return false;
  return true;
}

/** Hasard reproductible : les propositions restent les mêmes tant que rien ne change. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Propositions du panneau, pondérées par le niveau (la quête « en vedette » d'abord).
 * Elles changent après une quête réussie, un abandon ou un nouveau tirage, et quand l'une n'est plus disponible.
 */
export function currentOffers(ctx: Ctx): QuestDef[] {
  const sys = ctx.world.quests;
  if (!sys) return [];
  const p = ctx.player;
  const pool = sys.quests.filter((q) => questAvailable(ctx, q)).sort((a, b) => a.id.localeCompare(b.id));
  const random = seeded(`${ctx.playerId}|${p.questDraws ?? 0}|${p.questsDone.length}|${pool.map((q) => q.id).join(',')}`);
  const out: QuestDef[] = pool.filter((q) => q.featured).slice(0, sys.offers);
  const weights = questLevel(ctx)?.weights ?? [1, 1, 1];
  let rest = pool.filter((q) => !out.includes(q));
  while (out.length < sys.offers && rest.length) {
    // Une difficulté au hasard selon le niveau, parmi celles qui ont encore des quêtes.
    const tiers = ([1, 2, 3] as const).filter((d) => rest.some((q) => q.difficulty === d) && weights[d - 1] > 0);
    const total = tiers.reduce((s, d) => s + weights[d - 1], 0);
    if (!tiers.length || total <= 0) break; // le niveau n'autorise aucune des difficultés restantes
    let x = random() * total;
    let pick: 1 | 2 | 3 = tiers.at(-1)!;
    for (const d of tiers) {
      x -= weights[d - 1];
      if (x < 0) {
        pick = d;
        break;
      }
    }
    const candidates = rest.filter((q) => q.difficulty === pick);
    const q = candidates[Math.floor(random() * candidates.length)]!;
    out.push(q);
    rest = rest.filter((x) => x !== q);
  }
  return out;
}

export function acceptQuest(ctx: Ctx, id: Id): QuestDef {
  const p = ctx.player;
  if (p.quest) throw new RuleError('Tu as déjà une quête en cours : termine-la ou abandonne-la.');
  const q = currentOffers(ctx).find((x) => x.id === id);
  if (!q) throw new RuleError('Cette quête n’est plus proposée.');
  p.quest = { id, since: ctx.now, progress: {} };
  p.questDraws = (p.questDraws ?? 0) + 1; // nouvelles propositions au prochain passage
  // Une étape déjà remplie par la situation (visiter ce lieu) compte tout de suite.
  questVisit(ctx, ctx.building.id);
  return q;
}

export function abandonQuest(ctx: Ctx): QuestDef | undefined {
  const q = findQuest(ctx, ctx.player.quest?.id);
  ctx.player.quest = undefined;
  ctx.player.questDraws = (ctx.player.questDraws ?? 0) + 1;
  return q;
}

export function rerollOffers(ctx: Ctx) {
  const sys = ctx.world.quests;
  const p = ctx.player;
  const until = (p.questRerollAt ?? 0) + (sys?.rerollMinutes ?? 0) * 60_000;
  if (p.questRerollAt && ctx.now < until) throw new RuleError(`Nouveau tirage possible dans ${Math.ceil((until - ctx.now) / 60_000)} min.`);
  p.questRerollAt = ctx.now;
  p.questDraws = (p.questDraws ?? 0) + 1;
}

/** Quête en cours devenue indisponible (fin de sa fenêtre) : rendue sans pénalité. */
export function dropExpiredQuest(ctx: Ctx): QuestDef | undefined {
  if (!ctx.player.quest) return undefined;
  const q = findQuest(ctx, ctx.player.quest.id);
  if (q && evaluate(ctx, q.when).ok) return undefined;
  ctx.player.quest = undefined;
  if (q) ctx.notes?.push(`📜 La quête **${q.name}** n’est plus d’actualité. Passe au panneau des quêtes de la Place pour en choisir une autre.`);
  return q;
}

// ---------------------------------------------------------------------------
// Avancement
// ---------------------------------------------------------------------------

export function stepTarget(s: QuestStep): number {
  return s.kind === 'visit' ? (s.building ? 1 : (s.count ?? 1)) : s.kind === 'deliver' ? s.qty : s.target;
}

export function stepDone(ctx: Ctx, s: QuestStep): boolean {
  return (ctx.player.quest?.progress[s.id] ?? 0) >= stepTarget(s);
}

/** Étapes qui acceptent de l'avancement maintenant (la première non faite si la quête est ordonnée). */
function openSteps(ctx: Ctx, q: QuestDef): QuestStep[] {
  const pending = q.steps.filter((s) => !stepDone(ctx, s));
  return q.ordered ? pending.slice(0, 1) : pending;
}

function bump(ctx: Ctx, s: QuestStep, n: number) {
  const prog = ctx.player.quest!.progress;
  prog[s.id] = Math.min(stepTarget(s), (prog[s.id] ?? 0) + n);
}

export function questVisit(ctx: Ctx, building: Id) {
  const q = findQuest(ctx, ctx.player.quest?.id);
  if (!q) return;
  let moved = false;
  for (const s of openSteps(ctx, q)) {
    if (s.kind !== 'visit') continue;
    if (s.building) {
      if (s.building === building) bump(ctx, s, 1), (moved = true);
    } else {
      const seen = ((ctx.player.quest!.seen ??= {})[s.id] ??= []);
      if (!seen.includes(building)) {
        seen.push(building);
        bump(ctx, s, 1);
        moved = true;
      }
    }
  }
  if (moved) completeIfDone(ctx, q);
}

export function questTag(ctx: Ctx, tag: string, amount = 1) {
  const q = findQuest(ctx, ctx.player.quest?.id);
  if (!q || amount <= 0) return;
  let moved = false;
  for (const s of openSteps(ctx, q))
    if (s.kind === 'count' && s.tags.includes(tag)) {
      bump(ctx, s, amount);
      moved = true;
    }
  if (moved) completeIfDone(ctx, q);
}

/** Livraison d'une étape « livrer », dans le bon bâtiment. */
export function questDeliver(ctx: Ctx, stepId: Id): string {
  const q = findQuest(ctx, ctx.player.quest?.id);
  const s = q?.steps.find((x) => x.id === stepId);
  if (!q || !s || s.kind !== 'deliver') throw new RuleError('Rien à livrer pour ta quête.');
  if (!openSteps(ctx, q).includes(s)) throw new RuleError(stepDone(ctx, s) ? 'Cette livraison est déjà faite.' : 'Termine d’abord l’étape précédente.');
  if (s.building !== ctx.building.id) throw new RuleError('Ce n’est pas ici qu’il faut livrer.');
  const missing = s.qty - (ctx.player.quest!.progress[s.id] ?? 0);
  const qty = Math.min(missing, ctx.player.items[s.item] ?? 0);
  if (qty <= 0) throw new RuleError(`Il te faut ${itemName(ctx.world, s.item)} pour cette livraison.`);
  applyAction(ctx, { type: 'item.take', item: s.item, qty });
  bump(ctx, s, qty);
  const note = `📦 Livré : ${qty} ${itemName(ctx.world, s.item)}.`;
  completeIfDone(ctx, q);
  return note;
}

function completeIfDone(ctx: Ctx, q: QuestDef) {
  if (!q.steps.every((s) => stepDone(ctx, s))) return;
  const p = ctx.player;
  const sys = ctx.world.quests!;
  const before = ctx.changes.length;
  p.quest = undefined;
  p.questsDone.push(q.id);
  p.questDraws = (p.questDraws ?? 0) + 1;
  for (const a of [...(sys.rewards?.[String(q.difficulty) as '1' | '2' | '3'] ?? []), ...q.rewards]) applyAction(ctx, a);
  const gains = ctx.changes
    .slice(before)
    .map((c) => (c.kind === 'stat' ? `+${c.after - c.before} ${ctx.world.stats.find((x) => x.id === c.stat)?.name ?? c.stat}` : c.kind === 'item' && c.delta > 0 && !c.inventory ? `+${c.delta} ${itemName(ctx.world, c.item)}` : ''))
    .filter(Boolean);
  const msg = pickText(ctx, q.success);
  ctx.notes?.push(`🏆 **Quête réussie : ${q.name}** ${STARS[q.difficulty]}${msg ? `\n${msg}` : ''}${gains.length ? `\n${gains.join(' · ')}` : ''}\nRetourne au panneau des quêtes de la Place pour en choisir une nouvelle.`);
}

export const compare = (op: CompareOp, a: number, b: number) =>
  op === 'eq' ? a === b : op === 'neq' ? a !== b : op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
