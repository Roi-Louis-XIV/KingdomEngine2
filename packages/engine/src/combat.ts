/**
 * Combat au tour par tour (module générique `combat`, widget `combat.arena`).
 *
 * - Chasse : le joueur cherche un adversaire parmi les rencontres du module, puis attaque, se défend,
 *   utilise un objet ou fuit. Chaque action du joueur est suivie de la riposte de la créature.
 *   Les points de vie du joueur sont une statistique (santé) : ils restent entamés après le combat.
 * - Duels : un joueur défie un autre joueur présent dans le bâtiment (interface ouverte). Chaque duelliste
 *   a une jauge propre au duel : on ne risque pas sa santé. Les tours alternent ; qui ne joue pas à temps abandonne.
 *
 * Tout le hasard est tiré côté moteur, dans la transaction.
 */
import type { Action, CombatModule, CombatSounds, CreatureDef, Id } from './model.ts';
import type { RButton, RContainer, RSelect, RTopLevel } from './components.ts';
import type { DuelState, WorldState } from './state.ts';
import { type Ctx, RuleError, applyAction, evaluate, findItem, findStat, itemName, pickText } from './rules.ts';
import { questTag } from './quests.ts';

/** Ce dont le combat a besoin de l'environnement d'un widget (voir WidgetEnv). */
export interface CombatEnv {
  ctx: Ctx;
  id(verb: string, arg?: string): string;
  wake(at: number): void;
  random(): number;
}

/** Tours précédents gardés sous « Ce qui vient de se passer ». */
const LOG_LINES = 4;
const PENDING_MS = 2 * 60_000;

const text = (content: string) => ({ type: 'text' as const, content });
/** Encadré en plusieurs parties séparées par un trait (les parties vides sont ignorées). */
const panel = (parts: string[], accent?: number): RContainer => {
  const children: RContainer['children'] = [];
  for (const p of parts.filter((x) => x.trim())) {
    if (children.length) children.push({ type: 'separator' });
    children.push(text(p));
  }
  return { type: 'container', accent, children };
};
const button = (customId: string, label: string, style: RButton['style'] = 'secondary'): RButton => ({ type: 'button', customId, label, style });
const rows = (items: RButton[]): RTopLevel[] => {
  const out: RTopLevel[] = [];
  for (let i = 0; i < items.length; i += 5) out.push({ type: 'row', items: items.slice(i, i + 5) });
  return out;
};
const gauge = (value: number, max: number) => {
  // Toujours au moins un carré tant qu'il reste des points de vie.
  const filled = value <= 0 ? 0 : Math.max(1, Math.min(10, Math.floor((value / Math.max(1, max)) * 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};
const secs = (ms: number) => `${Math.max(0, Math.ceil(ms / 1000))} s`;

export const combatKey = (building: Id, module: Id) => `${building}/${module}`;

// ---------------------------------------------------------------------------
// Caractéristiques et coups
// ---------------------------------------------------------------------------

/** Attaque et défense totales (meilleur objet de chaque emplacement). */
export function equipmentTotals(ctx: Ctx): { attack: number; defense: number } {
  const best = new Map<string, { attack: number; defense: number }>();
  for (const [id, q] of Object.entries(ctx.player.items)) {
    const eq = q > 0 ? findItem(ctx.world, id)?.equipment : undefined;
    if (!eq) continue;
    const cur = best.get(eq.slot) ?? { attack: 0, defense: 0 };
    best.set(eq.slot, { attack: Math.max(cur.attack, eq.attack ?? 0), defense: Math.max(cur.defense, eq.defense ?? 0) });
  }
  return [...best.values()].reduce((s, v) => ({ attack: s.attack + v.attack, defense: s.defense + v.defense }), { attack: 0, defense: 0 });
}

export interface Fighter {
  attack: number;
  defense: number;
  dodge: number;
}

/** Caractéristiques d'un joueur dans un module de combat (base + équipement). */
export function fighterOf(ctx: Ctx, mod: CombatModule): Fighter {
  const eq = equipmentTotals(ctx);
  return { attack: mod.base.attack + eq.attack, defense: mod.base.defense + eq.defense, dodge: Math.min(0.9, Math.max(0, mod.base.dodge ?? 0.05)) };
}

export interface Blow {
  damage: number;
  dodged: boolean;
  crit: boolean;
}

/**
 * Un coup : esquive possible, dégâts = attaque × (0,8 à 1,2) − la moitié de la défense (au moins 1),
 * critique (10 %) ×1,5, cible en garde : dégâts ×0,4.
 */
export function strike(random: () => number, attacker: Fighter, defender: Fighter, guarded = false): Blow {
  if (random() < defender.dodge) return { damage: 0, dodged: true, crit: false };
  let raw = attacker.attack * (0.8 + random() * 0.4);
  const crit = random() < 0.1;
  if (crit) raw *= 1.5;
  let damage = Math.max(1, Math.round(raw - defender.defense * 0.5));
  if (guarded) damage = Math.max(1, Math.round(damage * 0.4));
  return { damage, dodged: false, crit };
}

const creatureFighter = (c: CreatureDef): Fighter => ({ attack: c.attack, defense: c.defense, dodge: Math.min(0.9, Math.max(0, c.dodge ?? 0)) });
const findCreature = (ctx: Ctx, id: Id) => (ctx.world.creatures ?? []).find((c) => c.id === id);
const cname = (c: CreatureDef) => `${c.emoji ?? '👾'} ${c.name}`;

function healthOf(ctx: Ctx, mod: CombatModule): { value: number; max: number; name: string; emoji: string } {
  const def = findStat(ctx.world, mod.health);
  const value = ctx.player.stats[mod.health] ?? def?.initial ?? 0;
  return { value, max: def?.max ?? Math.max(100, value), name: def?.name ?? 'Santé', emoji: def?.emoji ?? '❤️' };
}

function setHealth(ctx: Ctx, mod: CombatModule, value: number) {
  applyAction(ctx, { type: 'stat.set', stat: mod.health, value: Math.max(0, Math.round(value)) });
}

/** Applique des actions sans bloquer : une perte impossible (bourse vide) est simplement ignorée. */
function soft(ctx: Ctx, actions: Action[] = []) {
  for (const a of actions) {
    try {
      applyAction(ctx, a);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
    }
  }
}

/** Nouveau tour : l'ancien « dernier tour » passe dans l'historique (résumé en une ligne). */
function newTurn(st: { last?: string[]; log: string[] }, lines: string[]) {
  if (st.last?.length) {
    st.log.push(st.last.join(' '));
    while (st.log.length > LOG_LINES) st.log.shift();
  }
  st.last = lines;
}

/** Joue un son dans le salon vocal du bâtiment (sans effet s'il n'est pas configuré). */
function sfx(ctx: Ctx, sound: Id | undefined) {
  if (sound) ctx.events.push({ type: 'audio.play', building: ctx.building.id, sound, player: ctx.playerId });
}
const blowSound = (s: CombatSounds | undefined, b: Blow) => (b.dodged ? s?.miss : b.crit ? (s?.crit ?? s?.hit) : s?.hit);

/** Rapidité estimée d'un combat : nombre de coups moyens pour mettre l'autre à terre. */
function hitsToKill(attacker: Fighter, defender: Fighter, hp: number) {
  const avg = Math.max(1, attacker.attack - defender.defense * 0.5) * (1 - defender.dodge);
  return Math.ceil(hp / Math.max(0.5, avg));
}
/** Pastille de difficulté d'une créature pour ce joueur. */
function danger(me: Fighter, myHp: number, c: CreatureDef): string {
  const mine = hitsToKill(me, creatureFighter(c), c.hp);
  const theirs = hitsToKill(creatureFighter(c), me, Math.max(1, myHp));
  if (theirs <= mine) return '🔴 dangereux pour toi';
  if (theirs <= mine * 2) return '🟡 coriace';
  return '🟢 à ta portée';
}

/** Objets consommables du joueur qui rendent de la santé. */
function healingItems(ctx: Ctx, mod: CombatModule): { id: Id; qty: number; amount: number }[] {
  const out: { id: Id; qty: number; amount: number }[] = [];
  for (const [id, qty] of Object.entries(ctx.player.items)) {
    const fx = qty > 0 ? findItem(ctx.world, id)?.consumable?.effects : undefined;
    const amount = (fx ?? []).reduce((s, a) => s + (a.type === 'stat.add' && a.stat === mod.health && a.amount > 0 ? a.amount : 0), 0);
    if (amount > 0) out.push({ id, qty, amount });
  }
  return out;
}

const cooldownKey = (key: string) => `${key}/combat`;

/** Rencontres possibles maintenant (selon leurs conditions). */
function encountersNow(ctx: Ctx, mod: CombatModule) {
  return mod.encounters.filter((e) => e.weight > 0 && findCreature(ctx, e.creature) && evaluate(ctx, e.when).ok);
}

// ---------------------------------------------------------------------------
// Duels : état partagé
// ---------------------------------------------------------------------------

const duelsOf = (state: WorldState) => (state.duels ??= {});

/** Duel (proposé ou en cours) auquel ce joueur participe dans ce module. */
function duelOf(ctx: Ctx, key: string, player: Id): DuelState | undefined {
  return Object.values(ctx.state.duels ?? {}).find((d) => d.key === key && (d.challenger === player || d.target === player));
}

/** Le joueur est-il occupé (combat ou duel, n'importe où) ? */
function busy(state: WorldState, player: Id): boolean {
  if (state.players[player]?.fight) return true;
  return Object.values(state.duels ?? {}).some((d) => d.status === 'active' && (d.challenger === player || d.target === player));
}

/** Joueurs présents dans le bâtiment (interface ouverte), avec leur nom. */
function presentPlayers(ctx: Ctx): { id: Id; name: string }[] {
  const seen = new Map<Id, string>();
  for (const s of Object.values(ctx.state.sessions))
    if (s.building === ctx.building.id && s.player !== ctx.playerId && ctx.state.players[s.player]) seen.set(s.player, s.name ?? seen.get(s.player) ?? '');
  return [...seen].map(([id, name]) => ({ id, name: name || `Joueur ${id.slice(-4)}` }));
}

function nameOf(state: WorldState, player: Id): string {
  const s = Object.values(state.sessions).find((x) => x.player === player && x.name);
  return s?.name ?? `<@${player}>`;
}

/** Contexte d'un autre joueur (récompenses du vainqueur d'un duel). */
function ctxFor(ctx: Ctx, player: Id): Ctx {
  return { ...ctx, playerId: player, player: ctx.state.players[player]!, changes: [], notes: [] };
}

/** Fin d'un duel : récompenses du vainqueur, annonce dans le journal. */
function finishDuel(ctx: Ctx, mod: CombatModule, d: DuelState, winner: Id, reason: string) {
  const loser = winner === d.challenger ? d.target : d.challenger;
  delete duelsOf(ctx.state)[d.id];
  if (!ctx.state.players[winner]) return;
  const wctx = winner === ctx.playerId ? ctx : ctxFor(ctx, winner);
  soft(wctx, mod.duels?.rewards);
  questTag(wctx, 'duel:win');
  const lctx = loser === ctx.playerId ? ctx : ctx.state.players[loser] ? ctxFor(ctx, loser) : undefined;
  if (lctx) questTag(lctx, 'duel:fought');
  questTag(wctx, 'duel:fought');
  sfx(ctx, mod.sounds?.duelWin);
  const result = `🏆 **${nameOf(ctx.state, winner)}** remporte le duel contre **${nameOf(ctx.state, loser)}** ${reason}.`;
  // Le dernier résultat reste visible pour les deux duellistes.
  for (const p of [winner, loser]) {
    const pl = ctx.state.players[p];
    if (pl) pl.lastDuel = result;
  }
}

/**
 * Délais des duels : un défi sans réponse expire, un duelliste qui ne joue pas à temps abandonne.
 * Appelé par Engine.tick() (et avant chaque interaction d'arène).
 */
export function expireDuels(ctx: Ctx, now: number): boolean {
  let changed = false;
  for (const d of Object.values(ctx.state.duels ?? {})) {
    const [b, m] = d.key.split('/');
    const mod = ctx.world.buildings.find((x) => x.id === b)?.modules.find((x) => x.id === m);
    if (!mod || mod.type !== 'combat' || !mod.duels) {
      delete ctx.state.duels![d.id];
      changed = true;
      continue;
    }
    if (d.status === 'pending' && now - d.createdAt >= PENDING_MS) {
      delete ctx.state.duels![d.id];
      changed = true;
    } else if (d.status === 'active' && now >= d.deadline) {
      const winner = d.turn === d.challenger ? d.target : d.challenger;
      finishDuel({ ...ctx, building: ctx.world.buildings.find((x) => x.id === b)! }, mod, d, winner, '(l’adversaire n’a pas joué à temps)');
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Rendu : en haut l'état des combattants, puis « ce qui vient de se passer », puis les actions.
// ---------------------------------------------------------------------------

const bar = (label: string, value: number, max: number, extra = '') => `${label}\n\`${gauge(value, max)}\` **${value}**/${max}${extra}`;

function happened(st: { last?: string[]; log: string[] }, empty: string): string {
  const lines = ['**Ce qui vient de se passer**', ...(st.last?.length ? st.last : [empty])];
  // Les tours précédents en petit et en gris, du plus récent au plus ancien.
  for (const old of [...st.log].reverse()) lines.push(`-# ${old}`);
  return lines.join('\n');
}

export function renderCombat(env: CombatEnv, mod: CombatModule, accent?: number): RTopLevel[] {
  const { ctx } = env;
  const p = ctx.player;
  const key = combatKey(ctx.building.id, mod.id);
  const me = fighterOf(ctx, mod);
  const hp = healthOf(ctx, mod);
  const myStats = ` · ⚔️ ${me.attack} · 🛡️ ${me.defense}`;
  const out: RTopLevel[] = [];

  // 1. Combat en cours contre une créature (ici).
  const fight = p.fight?.key === key ? p.fight : undefined;
  const creature = fight ? findCreature(ctx, fight.creature) : undefined;
  if (fight && creature) {
    const them = creatureFighter(creature);
    out.push(
      panel(
        [
          `### ⚔️ Combat contre ${cname(creature)}\n-# Tour ${fight.round + 1} · à toi de jouer`,
          [bar(`${cname(creature)}`, fight.hp, creature.hp, ` · ⚔️ ${them.attack} · 🛡️ ${them.defense}`), bar(`${hp.emoji} **Toi**`, hp.value, hp.max, myStats)].join('\n\n'),
          happened(fight, `👀 ${cname(creature)} te fait face.${creature.description ? ` *${creature.description}*` : ''}`),
        ],
        accent ?? 0x7a2e2e,
      ),
    );
    out.push(...rows([button(env.id('attack'), '⚔️ Attaquer', 'danger'), button(env.id('guard'), '🛡️ Se défendre', 'primary'), button(env.id('flee'), `🏃 Fuir (${Math.round((mod.fleeChance ?? 0.6) * 100)} %)`)]));
    const heals = healingItems(ctx, mod);
    if (heals.length) {
      const sel: RSelect = {
        type: 'select',
        customId: env.id('use'),
        placeholder: '🧪 Se soigner avec un objet (prend ton tour)…',
        options: heals.slice(0, 25).map((h) => ({ label: `${findItem(ctx.world, h.id)!.name} ×${h.qty}`.slice(0, 100), value: h.id, description: `+${h.amount} ${hp.name}`, emoji: findItem(ctx.world, h.id)!.emoji })),
      };
      out.push({ type: 'row', items: [sel] });
    }
    out.push(text('-# 🛡️ Se défendre : tu encaisses beaucoup moins, et tu ripostes parfois.'));
    return out;
  }
  if (p.fight && p.fight.key !== key) {
    const [b] = p.fight.key.split('/');
    out.push(panel([`### ⚔️ ${mod.name}`, `⚠️ Tu es déjà en plein combat ailleurs (**${ctx.world.buildings.find((x) => x.id === b)?.name ?? b}**). Retournes-y pour le terminer.`], accent));
    return out;
  }

  // 2. Duel en cours.
  const duel = mod.duels ? duelOf(ctx, key, ctx.playerId) : undefined;
  if (duel?.status === 'active') {
    const other = duel.challenger === ctx.playerId ? duel.target : duel.challenger;
    const max = mod.duels!.hp;
    const mine = duel.turn === ctx.playerId;
    const left = secs(duel.deadline - ctx.now);
    env.wake(duel.deadline);
    out.push(
      panel(
        [
          `### 🤺 Duel contre ${nameOf(ctx.state, other)}\n${mine ? `🟢 **À toi de jouer !** Il te reste ${left}.` : `⏳ **${nameOf(ctx.state, other)}** réfléchit… (${left})`}`,
          [bar(`🤺 **${nameOf(ctx.state, other)}**${duel.guard[other] ? ' 🛡️ en garde' : ''}`, duel.hp[other] ?? 0, max), bar(`🤺 **Toi**${duel.guard[ctx.playerId] ? ' 🛡️ en garde' : ''}`, duel.hp[ctx.playerId] ?? 0, max, myStats)].join('\n\n'),
          happened(duel, '*Les duellistes se saluent.*'),
        ],
        accent ?? 0x885c34,
      ),
    );
    out.push(...rows([...(mine ? [button(env.id('dattack', duel.id), '⚔️ Attaquer', 'danger'), button(env.id('dguard', duel.id), '🛡️ Se garder', 'primary')] : []), button(env.id('yield', duel.id), '🏳️ Abandonner')]));
    out.push(text(`-# Un duel ne coûte pas de santé. Qui ne joue pas dans les ${mod.duels!.turnSec ?? 90} s perd le duel.`));
    return out;
  }

  // 3. Accueil de l'arène : mon état, ce qui rôde ici, le repos.
  const desc = pickText(ctx, mod.description);
  const head = [`### ${mod.name}${desc ? `\n*${desc}*` : ''}`, '', bar(`${hp.emoji} **Toi**`, hp.value, hp.max, myStats)];
  if (hp.value <= 0) head.push(`⚠️ Tu es trop mal en point pour chasser : soigne-toi d’abord.`);
  const parts = [head.join('\n')];
  if (mod.encounters.length) {
    const lock = evaluate(ctx, mod.when);
    const hunt: string[] = ['**Ce qui rôde ici**'];
    if (!lock.ok) hunt.push(`🔒 ${pickText(ctx, mod.lockedText) || lock.reason}`);
    else {
      const enc = encountersNow(ctx, mod);
      if (!enc.length) hunt.push('*Rien pour l’instant.*');
      for (const e of enc) {
        const c = findCreature(ctx, e.creature)!;
        hunt.push(`${cname(c)} — ❤️ ${c.hp} · ⚔️ ${c.attack} · 🛡️ ${c.defense} · ${danger(me, hp.value, c)}`);
      }
      const cost = (mod.costs ?? []).map((a) => (a.type === 'stat.add' && a.amount < 0 ? `${-a.amount} ${findStat(ctx.world, a.stat)?.name ?? a.stat}` : '')).filter(Boolean);
      if (cost.length) hunt.push(`-# Chercher un adversaire coûte ${cost.join(' et ')}. Le hasard choisit parmi ces bêtes.`);
    }
    const cd = p.cooldowns[cooldownKey(key)];
    if (cd && cd > ctx.now) {
      hunt.push(`⏳ Reprends ton souffle : encore ${secs(cd - ctx.now)}.`);
      env.wake(cd);
    }
    parts.push(hunt.join('\n'));
  }
  out.push(panel(parts, accent));

  const actions: RButton[] = [];
  if (mod.encounters.length) actions.push(button(env.id('hunt'), '🔎 Chercher un adversaire', 'success'));
  if (mod.heal && hp.value < hp.max) {
    const cost = (hp.max - hp.value) * mod.heal.costPerPoint;
    actions.push(button(env.id('heal'), `🩹 ${mod.heal.label ?? 'Se faire soigner'} : ${cost} ${findStat(ctx.world, mod.heal.currency)?.unit ?? ''}`.trim(), 'primary'));
  }
  out.push(...rows(actions));

  // 4. Duels : défis reçus, défi envoyé, duels en cours ici (pour les spectateurs), choix d'un adversaire.
  if (mod.duels && evaluate(ctx, mod.duels.when).ok) {
    const here = Object.values(ctx.state.duels ?? {}).filter((d) => d.key === key);
    const lines = ['**🤺 Duels**', `-# Défie un joueur présent : ${mod.duels.hp} points de vie chacun, sans risque pour ta santé.`];
    const watching = here.filter((d) => d.status === 'active');
    for (const d of watching.slice(0, 3))
      lines.push(`⚔️ **${nameOf(ctx.state, d.challenger)}** (${d.hp[d.challenger]}/${mod.duels.hp}) contre **${nameOf(ctx.state, d.target)}** (${d.hp[d.target]}/${mod.duels.hp})`);
    if (p.lastDuel) lines.push(p.lastDuel);
    const outgoing = duel?.status === 'pending' && duel.challenger === ctx.playerId ? duel : undefined;
    if (outgoing) lines.push(`⏳ Tu as défié **${nameOf(ctx.state, outgoing.target)}** : en attente de sa réponse (${secs(outgoing.createdAt + PENDING_MS - ctx.now)}).`);
    const incoming = here.filter((d) => d.status === 'pending' && d.target === ctx.playerId).slice(0, 2);
    for (const d of incoming) lines.push(`📣 **${nameOf(ctx.state, d.challenger)}** te défie en duel ! (${secs(d.createdAt + PENDING_MS - ctx.now)} pour répondre)`);
    out.push(panel([lines.join('\n')], accent));
    for (const d of [...incoming, ...(outgoing ? [outgoing] : [])]) env.wake(d.createdAt + PENDING_MS);
    for (const d of incoming)
      out.push({ type: 'row', items: [button(env.id('accept', d.id), `✅ Accepter le duel de ${nameOf(ctx.state, d.challenger)}`.slice(0, 80), 'success'), button(env.id('refuse', d.id), '❌ Refuser', 'danger')] });
    if (outgoing) out.push({ type: 'row', items: [button(env.id('cancel', outgoing.id), 'Annuler mon défi')] });
    else {
      const others = presentPlayers(ctx).filter((o) => !busy(ctx.state, o.id));
      if (others.length)
        out.push({ type: 'row', items: [{ type: 'select', customId: env.id('challenge'), placeholder: '🤺 Défier un joueur présent…', options: others.slice(0, 25).map((o) => ({ label: o.name.slice(0, 100), value: o.id })) }] });
      else out.push(text('-# Personne d’autre n’est libre ici pour un duel.'));
    }
  }
  return out;
}

/**
 * Résumé pour l'accueil d'un bâtiment : ce qui se passe dans l'arène pour ce joueur
 * (combat en cours, défi reçu, duel en cours, bêtes qui rôdent, duels à regarder) et un bouton pour y aller.
 */
export function renderCombatSummary(env: CombatEnv, mod: CombatModule, label: string | undefined): RTopLevel[] {
  const { ctx } = env;
  const p = ctx.player;
  const key = combatKey(ctx.building.id, mod.id);
  const go = (text: string, buttonLabel: string, style: RButton['style'] = 'secondary'): RTopLevel[] => [
    // Une simple ligne avec son bouton (sans encadré : l'accueil est souvent déjà chargé).
    { type: 'section', texts: [{ type: 'text', content: text }], accessory: button(env.id('open'), buttonLabel, style) },
  ];
  const title = `**${mod.name}**`;

  const fight = p.fight?.key === key ? p.fight : undefined;
  const creature = fight ? findCreature(ctx, fight.creature) : undefined;
  if (fight && creature) {
    const hp = healthOf(ctx, mod);
    return go(`${title}\n⚠️ **Combat en cours** contre ${cname(creature)} (${creature.hp ? `${fight.hp}/${creature.hp}` : ''}) · ${hp.emoji} toi ${hp.value}/${hp.max}`, '⚔️ Reprendre le combat', 'danger');
  }
  const duel = mod.duels ? duelOf(ctx, key, ctx.playerId) : undefined;
  if (duel?.status === 'active') {
    const other = duel.challenger === ctx.playerId ? duel.target : duel.challenger;
    env.wake(duel.deadline);
    return go(`${title}\n⚠️ **Duel en cours** contre ${nameOf(ctx.state, other)} · ${duel.turn === ctx.playerId ? `**à toi de jouer** (${secs(duel.deadline - ctx.now)})` : 'à son tour'}`, '🤺 Retourner au duel', 'danger');
  }
  const incoming = Object.values(ctx.state.duels ?? {}).find((d) => d.key === key && d.status === 'pending' && d.target === ctx.playerId);
  if (incoming) {
    env.wake(incoming.createdAt + PENDING_MS);
    return go(`${title}\n📣 **${nameOf(ctx.state, incoming.challenger)} te défie en duel !** (${secs(incoming.createdAt + PENDING_MS - ctx.now)} pour répondre)`, '🤺 Répondre', 'success');
  }

  const lines = [title];
  if (mod.encounters.length) {
    const lock = evaluate(ctx, mod.when);
    if (!lock.ok) lines.push(`🔒 ${pickText(ctx, mod.lockedText) || lock.reason}`);
    else {
      const enc = encountersNow(ctx, mod);
      lines.push(enc.length ? `Rôdent ici : ${enc.map((e) => cname(findCreature(ctx, e.creature)!)).join(' · ')}` : '*Rien ne rôde par ici pour l’instant.*');
    }
  }
  if (mod.duels && evaluate(ctx, mod.duels.when).ok) {
    const active = Object.values(ctx.state.duels ?? {}).filter((d) => d.key === key && d.status === 'active');
    lines.push(
      active.length
        ? `🤺 ${active.slice(0, 2).map((d) => `**${nameOf(ctx.state, d.challenger)}** contre **${nameOf(ctx.state, d.target)}**`).join(' · ')}${active.length > 2 ? ` (+${active.length - 2})` : ''} : duel en cours !`
        : '🤺 Défie un autre habitant présent ici.',
    );
  }
  return go(lines.join('\n'), label ?? 'Y aller', 'danger');
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

/** Victoire sur une créature : récompenses, butin, repères de quête. */
function victory(env: CombatEnv, mod: CombatModule, creature: CreatureDef, lines: string[]): { notice: string } {
  const { ctx } = env;
  const p = ctx.player;
  delete p.fight;
  p.cooldowns[cooldownKey(combatKey(ctx.building.id, mod.id))] = ctx.now + (mod.cooldownSec ?? 0) * 1000;
  const before = ctx.changes.length;
  soft(ctx, creature.rewards);
  const loot: string[] = [];
  for (const l of creature.loot ?? [])
    if (env.random() < l.chance) {
      applyAction(ctx, { type: 'item.give', item: l.item, qty: l.qty });
      loot.push(`${itemName(ctx.world, l.item)} ×${l.qty}`);
    }
  questTag(ctx, 'combat:win');
  questTag(ctx, `combat:win:${creature.id}`);
  sfx(ctx, creature.sounds?.death);
  sfx(ctx, mod.sounds?.victory);
  const gains = ctx.changes
    .slice(before)
    .flatMap((c) => (c.kind === 'stat' && c.after > c.before ? [`+${c.after - c.before} ${findStat(ctx.world, c.stat)?.unit ?? findStat(ctx.world, c.stat)?.name ?? c.stat}`] : []))
    .join(' · ');
  const summary = `🏆 **Victoire contre ${cname(creature)} !**${gains ? ` ${gains}` : ''}${loot.length ? `\n🎁 Butin : ${loot.join(', ')}` : ''}`;
  return { notice: [...lines, summary].join('\n') };
}

export function handleCombat(env: CombatEnv, mod: CombatModule, verb: string, arg: string, values: string[]): { notice?: string; goto?: Id } {
  const { ctx } = env;
  const p = ctx.player;
  const key = combatKey(ctx.building.id, mod.id);
  const hp = () => healthOf(ctx, mod);
  expireDuels(ctx, ctx.now);

  switch (verb) {
    case 'hunt': {
      if (p.fight) throw new RuleError('⚔️ Tu es déjà en plein combat.');
      if (busy(ctx.state, ctx.playerId)) throw new RuleError('🤺 Termine d’abord ton duel.');
      const lock = evaluate(ctx, mod.when);
      if (!lock.ok) throw new RuleError(`🔒 ${pickText(ctx, mod.lockedText) || lock.reason}`);
      const cd = p.cooldowns[cooldownKey(key)];
      if (cd && cd > ctx.now) throw new RuleError(`⏳ Reprends ton souffle : encore ${secs(cd - ctx.now)}.`);
      if (hp().value <= 0) throw new RuleError(`${hp().emoji} Tu es trop mal en point pour te battre. Soigne-toi d’abord.`);
      const enc = encountersNow(ctx, mod);
      if (!enc.length) throw new RuleError('Rien ne rôde par ici pour l’instant.');
      for (const c of mod.costs ?? []) applyAction(ctx, c);
      const total = enc.reduce((s, e) => s + e.weight, 0);
      let x = env.random() * total;
      const pick = enc.find((e) => (x -= e.weight) < 0) ?? enc[enc.length - 1]!;
      const creature = findCreature(ctx, pick.creature)!;
      p.fight = { key, creature: creature.id, hp: creature.hp, round: 0, last: [`👀 **${cname(creature)}** surgit devant toi !${creature.description ? ` *${creature.description}*` : ''}`], log: [] };
      sfx(ctx, creature.sounds?.appear ?? mod.sounds?.appear);
      return {};
    }

    case 'attack':
    case 'guard':
    case 'flee':
    case 'use': {
      const fight = p.fight;
      if (!fight || fight.key !== key) throw new RuleError('Aucun combat en cours ici.');
      const creature = findCreature(ctx, fight.creature);
      if (!creature) {
        delete p.fight;
        throw new RuleError('Cette créature a disparu (contenu modifié).');
      }
      const me = fighterOf(ctx, mod);
      const them = creatureFighter(creature);
      const lines: string[] = [];
      let guarded = false;
      fight.round += 1;
      if (verb === 'attack') {
        const b = strike(env.random, me, them);
        fight.hp = Math.max(0, fight.hp - b.damage);
        lines.push(b.dodged ? `💨 ${cname(creature)} esquive ton attaque.` : `${b.crit ? '💥 **Coup critique !** ' : '⚔️ '}Tu infliges **${b.damage}** à ${cname(creature)}.`);
        sfx(ctx, blowSound(mod.sounds, b));
      } else if (verb === 'guard') {
        guarded = true;
        lines.push('🛡️ Tu te mets en garde.');
        sfx(ctx, mod.sounds?.guard);
      } else if (verb === 'flee') {
        if (env.random() < (mod.fleeChance ?? 0.6)) {
          delete p.fight;
          p.cooldowns[cooldownKey(key)] = ctx.now + (mod.cooldownSec ?? 0) * 1000;
          sfx(ctx, mod.sounds?.flee);
          return { notice: `🏃 Tu t’enfuis à toutes jambes : ${cname(creature)} ne te suit pas.` };
        }
        lines.push('🏃 Tu tentes de fuir… mais la créature te barre la route !');
      } else {
        const id = values[0] ?? arg;
        const h = healingItems(ctx, mod).find((x) => x.id === id);
        if (!h) throw new RuleError('⚠️ Objet absent de ton inventaire.');
        applyAction(ctx, { type: 'item.take', item: id, qty: 1 });
        const before = hp().value;
        for (const e of findItem(ctx.world, id)!.consumable!.effects) applyAction(ctx, e);
        questTag(ctx, `consume:${id}`);
        lines.push(`🧪 ${itemName(ctx.world, id)} : +${hp().value - before} ${hp().name}.`);
        sfx(ctx, mod.sounds?.heal);
      }

      if (fight.hp <= 0) return victory(env, mod, creature, lines);

      // Riposte de la créature.
      const b = strike(env.random, them, me, guarded);
      const after = Math.max(0, hp().value - b.damage);
      setHealth(ctx, mod, after);
      const taunt = creature.taunts?.length && env.random() < 0.35 ? ` *« ${creature.taunts[Math.floor(env.random() * creature.taunts.length)]} »*` : '';
      lines.push(b.dodged ? `💨 Tu esquives l’attaque de ${cname(creature)}.` : `${b.crit ? '💥 **Coup critique !** ' : '🩸 '}${cname(creature)} t’inflige **${b.damage}**${guarded ? ' (amorti par ta garde)' : ''}.${taunt}`);
      if (!b.dodged) sfx(ctx, creature.sounds?.attack ?? mod.sounds?.hurt);
      if (guarded && !b.dodged && env.random() < 0.35) {
        const r = strike(env.random, { ...me, attack: Math.max(1, Math.round(me.attack / 2)) }, { ...them, dodge: 0 });
        fight.hp = Math.max(0, fight.hp - r.damage);
        lines.push(`↩️ Riposte ! Tu infliges **${r.damage}** à ${cname(creature)}.`);
      }
      newTurn(fight, lines);

      if (fight.hp <= 0) return victory(env, mod, creature, lines);
      if (after <= 0) {
        // Défaite.
        delete p.fight;
        p.cooldowns[cooldownKey(key)] = ctx.now + (mod.cooldownSec ?? 0) * 1000;
        setHealth(ctx, mod, mod.defeat?.health ?? 1);
        const before = ctx.changes.length;
        soft(ctx, mod.defeat?.actions);
        questTag(ctx, 'combat:lose');
        const lost = ctx.changes
          .slice(before)
          .filter((c) => c.kind === 'stat' && c.after < c.before)
          .map((c) => (c.kind === 'stat' ? `−${c.before - c.after} ${findStat(ctx.world, c.stat)?.unit ?? findStat(ctx.world, c.stat)?.name ?? c.stat}` : ''))
          .join(' · ');
        sfx(ctx, mod.sounds?.defeat);
        const summary = `☠️ **${cname(creature)} t’a mis à terre.** ${pickText(ctx, mod.defeat?.text) || 'Tu te réveilles un peu plus tard, endolori(e).'}${lost ? ` (${lost})` : ''}`;
        return { notice: summary };
      }
      return {};
    }

    case 'heal': {
      if (!mod.heal) throw new RuleError('Pas de soins ici.');
      if (p.fight) throw new RuleError('Pas en plein combat !');
      const h = hp();
      const missing = h.max - h.value;
      if (missing <= 0) throw new RuleError('Tu es déjà en pleine forme.');
      applyAction(ctx, { type: 'stat.add', stat: mod.heal.currency, amount: -missing * mod.heal.costPerPoint });
      setHealth(ctx, mod, h.max);
      sfx(ctx, mod.sounds?.heal);
      return { notice: `🩹 Te voilà soigné(e) : ${h.emoji} ${h.max}/${h.max}.` };
    }

    case 'challenge': {
      if (!mod.duels) throw new RuleError('Pas de duels ici.');
      const w = evaluate(ctx, mod.duels.when);
      if (!w.ok) throw new RuleError(`🔒 Pas de duel pour l’instant (${w.reason}).`);
      const target = values[0] ?? '';
      if (!target || target === ctx.playerId) throw new RuleError('Choisis un adversaire.');
      if (!presentPlayers(ctx).some((o) => o.id === target)) throw new RuleError('Ce joueur n’est plus là.');
      if (busy(ctx.state, ctx.playerId) || busy(ctx.state, target)) throw new RuleError('L’un de vous est déjà en plein combat.');
      if (duelOf(ctx, key, ctx.playerId)) throw new RuleError('Tu as déjà un duel en attente.');
      if (duelOf(ctx, key, target)) throw new RuleError('Ce joueur a déjà un duel en attente.');
      const id = `d${ctx.now.toString(36)}${Math.floor(env.random() * 1e6).toString(36)}`;
      duelsOf(ctx.state)[id] = { id, key, challenger: ctx.playerId, target, status: 'pending', createdAt: ctx.now, turn: target, deadline: ctx.now + PENDING_MS, hp: {}, guard: {}, log: [] };
      delete p.lastDuel;
      sfx(ctx, mod.sounds?.challenge);
      return {}; // le panneau des duels affiche le défi en attente
    }

    case 'cancel':
    case 'refuse': {
      const d = ctx.state.duels?.[arg];
      if (!d || d.status !== 'pending' || (verb === 'cancel' ? d.challenger : d.target) !== ctx.playerId) throw new RuleError('Ce défi n’existe plus.');
      delete ctx.state.duels![arg];
      return { notice: verb === 'cancel' ? 'Défi annulé.' : `Tu as décliné le défi de **${nameOf(ctx.state, d.challenger)}**.` };
    }

    case 'accept': {
      const d = ctx.state.duels?.[arg];
      if (!d || d.status !== 'pending' || d.target !== ctx.playerId) throw new RuleError('Ce défi n’existe plus.');
      if (busy(ctx.state, d.challenger) || busy(ctx.state, d.target)) throw new RuleError('L’un de vous est déjà en plein combat.');
      const max = mod.duels!.hp;
      d.status = 'active';
      d.hp = { [d.challenger]: max, [d.target]: max };
      d.guard = {};
      // Celui qui a été défié frappe en premier.
      d.turn = d.target;
      d.deadline = ctx.now + (mod.duels!.turnSec ?? 90) * 1000;
      d.last = [`🤺 **${nameOf(ctx.state, d.target)}** relève le défi de **${nameOf(ctx.state, d.challenger)}** !`];
      d.log = [];
      delete p.lastDuel;
      sfx(ctx, mod.sounds?.duelStart);
      return {};
    }

    case 'dattack':
    case 'dguard':
    case 'yield': {
      const d = ctx.state.duels?.[arg];
      if (!d || d.status !== 'active' || (d.challenger !== ctx.playerId && d.target !== ctx.playerId)) throw new RuleError('Ce duel est terminé.');
      const other = d.challenger === ctx.playerId ? d.target : d.challenger;
      if (verb === 'yield') {
        finishDuel(ctx, mod, d, other, '(abandon)');
        return { notice: '🏳️ Tu as abandonné le duel.' };
      }
      if (d.turn !== ctx.playerId) throw new RuleError('⏳ Ce n’est pas ton tour.');
      const meName = nameOf(ctx.state, ctx.playerId);
      const otherName = nameOf(ctx.state, other);
      if (verb === 'dguard') {
        d.guard[ctx.playerId] = true;
        newTurn(d, [`🛡️ **${meName}** se met en garde.`]);
        sfx(ctx, mod.sounds?.guard);
      } else {
        const me = fighterOf(ctx, mod);
        const otherCtx = ctxFor(ctx, other);
        const them = ctx.state.players[other] ? fighterOf(otherCtx, mod) : { attack: 1, defense: 0, dodge: 0 };
        const guardedBefore = !!d.guard[other];
        const b = strike(env.random, me, them, guardedBefore);
        d.guard[other] = false;
        d.hp[other] = Math.max(0, (d.hp[other] ?? 0) - b.damage);
        newTurn(d, [b.dodged ? `💨 **${otherName}** esquive le coup de **${meName}**.` : `${b.crit ? '💥 ' : '⚔️ '}**${meName}** touche **${otherName}** : **−${b.damage}**${b.crit ? ' (critique !)' : ''}${guardedBefore ? ' (amorti par sa garde)' : ''}.`]);
        sfx(ctx, blowSound(mod.sounds, b));
        if (d.hp[other]! <= 0) {
          finishDuel(ctx, mod, d, ctx.playerId, `(${otherName} est à terre)`);
          return { notice: `🏆 **Victoire !** ${otherName} met un genou à terre.` };
        }
      }
      d.guard[ctx.playerId] = verb === 'dguard';
      d.turn = other;
      d.deadline = ctx.now + (mod.duels!.turnSec ?? 90) * 1000;
      return {};
    }
  }
  return {};
}
