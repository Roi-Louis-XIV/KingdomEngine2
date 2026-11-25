/**
 * Duel de dés entre joueurs présents dans le même bâtiment (interface ouverte = dans le salon vocal).
 *
 * 1. Un joueur choisit un adversaire parmi les présents et une mise (rien n'est prélevé à ce moment).
 * 2. L'adversaire voit le défi (sur l'écran du jeu, et en bannière sur les autres écrans du bâtiment) :
 *    il accepte ou refuse. À l'acceptation, les deux mises sont prélevées ensemble, dans la même transaction
 *    que le lancer : un duel annulé avant (refus, expiration, départ, bourse vide) ne coûte rien.
 * 3. Chacun lance ses dés (tirés par le serveur) ; le plus gros total remporte les deux mises.
 *    Égalité : chacun relance, sans changer les mises. Tout est réglé à l'acceptation (argent compris).
 * 4. Panneau en direct, visible de tous les joueurs présents dans le bâtiment (écrans portant le widget du module,
 *    bannière « Regarder » ailleurs) : deux cases côte à côte, compte à rebours de 3 s, puis les dés, chaque
 *    égalité montrée avant la relance, et le vainqueur. Les interfaces se redessinent seules (`wakeAt`).
 * Un défi sans réponse expire (`expireSec`, 30 s par défaut), de même si l'un des deux quitte le bâtiment.
 * Ce n'est pas un travail : il ne compte pas dans `settings.maxActivities`.
 */
import type { DiceDuelModule, Id } from './model.ts';
import type { RButton, RContainer, RTopLevel } from './components.ts';
import type { DiceDuelState, WorldState } from './state.ts';
import { type Ctx, RuleError, applyAction, findStat } from './rules.ts';
import { questTag } from './quests.ts';

export interface DiceDuelEnv {
  ctx: Ctx;
  id(verb: string, arg?: string): string;
  local<T extends object>(init: () => T): T;
  wake(at: number): void;
  random(): number;
}

/** Délai de réponse à un défi (défaut). */
const DEFAULT_EXPIRE_SEC = 30;
const pendingMs = (mod: DiceDuelModule) => (mod.expireSec ?? DEFAULT_EXPIRE_SEC) * 1000;
/** Durée pendant laquelle le dernier résultat reste affiché. */
const RESULT_MS = 10 * 60_000;
/** Compte à rebours avant le lancer, durée d'affichage de chaque égalité, et du résultat dans le panneau en direct. */
export const COUNTDOWN_MS = 3000;
/** Égalité affichée avant le nouveau compte à rebours. */
const TIE_MS = 2500;
/** Un lancer : compte à rebours puis dévoilement ; après une égalité, on recommence (affichage de l'égalité + compte à rebours). */
const ROUND_MS = TIE_MS + COUNTDOWN_MS;
/** Moment où le lancer n° i est dévoilé. */
const revealAt = (d: DiceDuelState, i: number) => (d.acceptedAt ?? 0) + COUNTDOWN_MS + i * ROUND_MS;
const SHOW_MS = 45_000;
/** Fin du spectacle : compte à rebours, puis chaque égalité montrée avant la relance. */
export const finalAt = (d: DiceDuelState) => revealAt(d, (d.rounds?.length ?? 1) - 1);
const DEFAULT_STAKES = [5, 10, 20, 50];

const text = (content: string) => ({ type: 'text' as const, content });
const box = (content: string, accent?: number): RContainer => ({ type: 'container', accent, children: [text(content)] });
const button = (customId: string, label: string, style: RButton['style'] = 'secondary', emoji?: string): RButton => ({ type: 'button', customId, label, style, emoji });
const secs = (ms: number) => `${Math.max(0, Math.ceil(ms / 1000))} s`;
const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const dieFace = (n: number) => (DIE[n] ? `${DIE[n]} ${n}` : String(n));

export const diceDuelKey = (building: Id, module: Id) => `${building}/${module}`;
const duelsOf = (state: WorldState) => (state.diceDuels ??= {});

/** Joueurs présents dans le bâtiment (interface ouverte), sans soi-même. */
export function presentOthers(state: WorldState, building: Id, self: Id): { id: Id; name: string }[] {
  const seen = new Map<Id, string>();
  for (const s of Object.values(state.sessions)) if (s.building === building && s.player !== self && state.players[s.player]) seen.set(s.player, s.name ?? seen.get(s.player) ?? '');
  return [...seen].map(([id, name]) => ({ id, name: name || `Joueur ${id.slice(-4)}` }));
}

const present = (state: WorldState, building: Id, player: Id) => Object.values(state.sessions).some((s) => s.building === building && s.player === player);

function nameOf(state: WorldState, player: Id): string {
  const s = Object.values(state.sessions).find((x) => x.player === player && x.name);
  return s?.name ?? `<@${player}>`;
}

/** Pris dans un duel : défi en attente, ou duel dont les dés n'ont pas encore fini de rouler. */
const involved = (state: WorldState, player: Id, now: number) =>
  Object.values(state.diceDuels ?? {}).find((d) => (d.challenger === player || d.target === player) && (d.status !== 'live' || now < finalAt(d)));
const isPending = (d: DiceDuelState) => d.status !== 'live';

/** Contexte d'un autre joueur (pour lui rendre ou lui verser des écus). */
const ctxFor = (ctx: Ctx, player: Id): Ctx => (player === ctx.playerId ? ctx : { ...ctx, playerId: player, player: ctx.state.players[player]!, changes: [], notes: [] });

function money(ctx: Ctx, stat: Id, n: number): string {
  const def = findStat(ctx.world, stat);
  return `${n} ${def?.unit ?? def?.name ?? stat}`.trim();
}

function pay(ctx: Ctx, player: Id, stat: Id, amount: number) {
  if (!ctx.state.players[player] || !amount) return;
  applyAction(ctxFor(ctx, player), { type: 'stat.add', stat, amount });
}

/** Défi annulé (refus, expiration, départ) : rien n'avait été prélevé. */
function dropDuel(ctx: Ctx, d: DiceDuelState) {
  delete duelsOf(ctx.state)[d.id];
}

/** Défis expirés ou dont un joueur est parti. Appelé par Engine.tick() et avant chaque action du jeu. */
export function expireDiceDuels(ctx: Ctx, now: number): void {
  for (const d of Object.values(ctx.state.diceDuels ?? {})) {
    const [b, m] = d.key.split('/');
    const mod = ctx.world.buildings.find((x) => x.id === b)?.modules.find((x) => x.id === m);
    if (!mod || mod.type !== 'diceDuel') {
      delete ctx.state.diceDuels![d.id];
      continue;
    }
    if (d.status === 'live') {
      // Duel joué : le panneau en direct reste un moment, puis disparaît.
      if (now >= finalAt(d) + SHOW_MS) delete ctx.state.diceDuels![d.id];
      continue;
    }
    const timeout = now - d.createdAt >= pendingMs(mod);
    if (timeout || !present(ctx.state, b!, d.challenger) || !present(ctx.state, b!, d.target)) {
      const pl = ctx.state.players[d.challenger];
      if (pl) pl.lastDiceDuel = { text: timeout ? `⌛ **${nameOf(ctx.state, d.target)}** n’a pas répondu à temps : défi expiré, rien n’a été prélevé.` : `🚪 Défi annulé : l’un de vous a quitté les lieux. Rien n’a été prélevé.`, at: now };
      dropDuel(ctx, d);
    }
  }
}

/** Défi reçu par ce joueur dans ce bâtiment (pour la bannière des autres écrans). */
export function incomingDiceDuel(state: WorldState, building: Id, mod: DiceDuelModule, player: Id, now: number): { from: string; stake: number; until: number } | undefined {
  const key = diceDuelKey(building, mod.id);
  const d = Object.values(state.diceDuels ?? {}).find((x) => isPending(x) && x.target === player && x.key === key && now - x.createdAt < pendingMs(mod));
  return d ? { from: nameOf(state, d.challenger), stake: d.stake, until: d.createdAt + pendingMs(mod) } : undefined;
}

/** Duels en direct dans ce bâtiment (dés qui roulent, ou résultat encore affiché). */
export function liveDiceDuels(state: WorldState, building: Id, mod: DiceDuelModule, now: number): DiceDuelState[] {
  const key = diceDuelKey(building, mod.id);
  return Object.values(state.diceDuels ?? {}).filter((d) => d.key === key && d.status === 'live' && now < finalAt(d) + SHOW_MS);
}

/** Bannière des autres écrans : un duel dont les dés roulent encore. */
export function rollingDiceDuel(state: WorldState, building: Id, mod: DiceDuelModule, now: number): { a: string; b: string; pot: number; until: number } | undefined {
  const d = liveDiceDuels(state, building, mod, now).find((x) => now < finalAt(x));
  return d ? { a: nameOf(state, d.challenger), b: nameOf(state, d.target), pot: d.stake * 2, until: finalAt(d) } : undefined;
}

const total = (x: number[]) => x.reduce((a, b) => a + b, 0);
/** Dé en grand : chiffre encadré (1️⃣ … 9️⃣), sinon le nombre en gras. */
const face = (n: number) => (n >= 0 && n <= 9 ? `${n}️⃣` : `**${n}**`);

/**
 * Panneau en direct d'un duel : un bandeau (titre, mise, cagnotte, compte à rebours ou verdict),
 * puis une case par joueur, l'une sous l'autre (Discord n'a pas de colonnes) : nom, dés en grand, total.
 * La case du vainqueur passe en or.
 */
function livePanel(env: DiceDuelEnv, mod: DiceDuelModule, d: DiceDuelState): RTopLevel[] {
  const { ctx } = env;
  const now = ctx.now;
  const rounds = d.rounds ?? [];
  const names = [nameOf(ctx.state, d.challenger), nameOf(ctx.state, d.target)] as const;
  const head = `### 🔴 EN DIRECT · ${mod.emoji ?? '🎲'} ${mod.name}\n**${names[0]}** ⚔️ **${names[1]}**\n-# Mise ${money(ctx, mod.currency, d.stake)} chacun · 💰 Cagnotte ${money(ctx, mod.currency, d.stake * 2)}`;
  const RED = 0xc0392b;
  const GOLD = 0xe0b04f;
  const GREY = 0x4f545c;
  const BLUE = 0x3b6ea5;
  const card = (i: 0 | 1, dice: string, sum: string, accent: number, tag = '') => ({
    type: 'container' as const,
    accent,
    children: [text(`${i === 0 ? '🟥' : '🟦'} **${names[i]}**${tag}\n# ${dice}\n${sum}`)],
  });
  const dice = (x: number[]) => x.map(face).join(' ');
  // Lancer en cours de dévoilement : le dernier dont le moment est passé (ou le premier, pendant son compte à rebours).
  let i = 0;
  while (i < rounds.length - 1 && now >= revealAt(d, i) + TIE_MS) i++;
  const reveal = revealAt(d, i);
  if (now < reveal) {
    // Compte à rebours, une image par seconde (au début, et après chaque égalité).
    const left = Math.ceil((reveal - now) / 1000);
    env.wake(reveal - (left - 1) * 1000);
    const hidden = Array.from({ length: mod.dice }, () => '🎲').join(' ');
    const again = i > 0 ? `\n-# Égalité au lancer précédent (${total(rounds[i - 1]!.a)} partout) : on relance !` : '';
    return [
      { type: 'container', accent: RED, children: [text(`${head}${again}\n# ⏳ ${left}…`)] },
      card(0, hidden, '-# Les dés roulent…', RED),
      card(1, hidden, '-# Les dés roulent…', BLUE),
    ];
  }
  const r = rounds[i]!;
  if (i < rounds.length - 1) {
    env.wake(reveal + TIE_MS);
    return [
      { type: 'container', accent: RED, children: [text(`${head}\n## 🤝 Égalité à ${total(r.a)} ! On relance…`)] },
      card(0, dice(r.a), `**Total : ${total(r.a)}**`, GREY),
      card(1, dice(r.b), `**Total : ${total(r.b)}**`, GREY),
    ];
  }
  env.wake(finalAt(d) + SHOW_MS);
  const aWins = d.winner === d.challenger;
  const ties = rounds.length - 1;
  const winner = names[aWins ? 0 : 1];
  const verdict = `## 🏆 ${winner} remporte ${money(ctx, mod.currency, d.stake * 2)} !${ties ? `\n-# Après ${ties} égalité${ties > 1 ? 's' : ''} et relance${ties > 1 ? 's' : ''}.` : ''}`;
  return [
    { type: 'container', accent: GOLD, children: [text(`${head.replace('🔴 EN DIRECT', '🏁 TERMINÉ')}\n${verdict}`)] },
    card(0, dice(r.a), `**Total : ${total(r.a)}**${aWins ? ' · 👑 **Vainqueur**' : ''}`, aWins ? GOLD : GREY, aWins ? ' 🏆' : ''),
    card(1, dice(r.b), `**Total : ${total(r.b)}**${aWins ? '' : ' · 👑 **Vainqueur**'}`, aWins ? GREY : GOLD, aWins ? '' : ' 🏆'),
  ];
}

/** Panneaux en direct seuls (écran des jeux : les spectateurs suivent le duel). */
export function renderDiceDuelLive(env: DiceDuelEnv, mod: DiceDuelModule, _accent?: number): RTopLevel[] {
  return liveDiceDuels(env.ctx.state, env.ctx.building.id, mod, env.ctx.now)
    .slice(0, 2)
    .flatMap((d) => livePanel(env, mod, d));
}

export function renderDiceDuel(env: DiceDuelEnv, mod: DiceDuelModule, accent?: number): RTopLevel[] {
  const { ctx } = env;
  const p = ctx.player;
  const key = diceDuelKey(ctx.building.id, mod.id);
  const balance = p.stats[mod.currency] ?? findStat(ctx.world, mod.currency)?.initial ?? 0;
  const st = env.local(() => ({ opponent: '', stake: 0 }));
  const out: RTopLevel[] = [];
  const lives = liveDiceDuels(ctx.state, ctx.building.id, mod, ctx.now).slice(0, 2);
  out.push(...lives.flatMap((d) => livePanel(env, mod, d)));
  const watching = lives.some((d) => d.challenger === ctx.playerId || d.target === ctx.playerId);
  const rules = `### ${mod.emoji ?? '⚔️'} ${mod.name}\nChacun mise la même somme et lance ${mod.dice} dé${mod.dice > 1 ? 's' : ''} : le plus gros total remporte les deux mises. En cas d’égalité, on relance.\n-# Les mises sont prélevées seulement quand l’adversaire accepte.`;
  const lines = [rules];
  // Dernier résultat personnel (pas pendant que son propre duel est encore à l'écran en direct).
  if (!watching && p.lastDiceDuel && ctx.now >= p.lastDiceDuel.at && ctx.now - p.lastDiceDuel.at < RESULT_MS) lines.push('', p.lastDiceDuel.text);
  out.push(box(lines.join('\n'), accent));

  const live = (d: DiceDuelState) => isPending(d) && d.key === key && ctx.now - d.createdAt < pendingMs(mod);
  const incoming = Object.values(ctx.state.diceDuels ?? {}).filter((d) => live(d) && d.target === ctx.playerId);
  const outgoing = Object.values(ctx.state.diceDuels ?? {}).find((d) => live(d) && d.challenger === ctx.playerId);
  for (const d of [...incoming, ...(outgoing ? [outgoing] : [])]) env.wake(d.createdAt + pendingMs(mod));

  if (incoming.length) {
    for (const d of incoming.slice(0, 3)) {
      const can = balance >= d.stake;
      out.push(box(`📣 **${nameOf(ctx.state, d.challenger)}** te défie au ${mod.name} ! Mise : **${money(ctx, mod.currency, d.stake)}** chacun.\n-# ${secs(d.createdAt + pendingMs(mod) - ctx.now)} pour répondre${can ? '' : ` · il te manque ${money(ctx, mod.currency, d.stake - balance)} pour suivre`}`, 0xc9a227));
      out.push({ type: 'row', items: [{ ...button(env.id('accept', d.id), `Accepter le duel · miser ${money(ctx, mod.currency, d.stake)}`.slice(0, 80), 'success', '🎲'), disabled: !can }, button(env.id('refuse', d.id), 'Refuser', 'danger', '✖️')] });
    }
    return out;
  }
  if (outgoing) {
    out.push(text(`⏳ Tu as défié **${nameOf(ctx.state, outgoing.target)}** pour **${money(ctx, mod.currency, outgoing.stake)}**. En attente de sa réponse… (${secs(outgoing.createdAt + pendingMs(mod) - ctx.now)})\n-# Rien n’est prélevé tant qu’il n’a pas accepté.`));
    out.push({ type: 'row', items: [button(env.id('cancel', outgoing.id), 'Annuler mon défi', 'secondary', '↩️')] });
    return out;
  }

  const others = presentOthers(ctx.state, ctx.building.id, ctx.playerId);
  if (!others.length) {
    out.push(text(`🔒 **Personne d’autre n’est ici.** Pour jouer au ${mod.name}, il faut être au moins deux dans le salon vocal de ce lieu (et ton adversaire doit avoir ouvert son interface).`));
    return out;
  }
  if (involved(ctx.state, ctx.playerId, ctx.now)) {
    out.push(text('🎲 Les dés roulent… Résultat dans un instant.'));
    return out;
  }
  const free = others.filter((o) => !involved(ctx.state, o.id, ctx.now));
  if (!free.length) {
    out.push(text('⏳ Tout le monde ici est déjà pris dans un duel. Attends un peu.'));
    return out;
  }
  if (!free.some((o) => o.id === st.opponent)) st.opponent = '';
  const stakes = (mod.stakes?.length ? mod.stakes : DEFAULT_STAKES).filter((n) => n > 0);
  const affordable = stakes.filter((n) => n <= balance);
  if (!affordable.includes(st.stake)) st.stake = 0;
  out.push({
    type: 'row',
    items: [{ type: 'select', customId: env.id('opponent'), placeholder: '1. Contre qui jouer ?', options: free.slice(0, 25).map((o) => ({ label: o.name.slice(0, 100), value: o.id, emoji: '🎲', default: o.id === st.opponent })) }],
  });
  if (!affordable.length) {
    out.push(text(`💸 Il te faut au moins ${money(ctx, mod.currency, Math.min(...stakes))} pour miser.`));
    return out;
  }
  out.push({
    type: 'row',
    items: [{ type: 'select', customId: env.id('stake'), placeholder: '2. Combien miser ?', options: affordable.slice(0, 25).map((n) => ({ label: money(ctx, mod.currency, n), value: String(n), emoji: '💰', default: n === st.stake })) }],
  });
  const ready = !!st.opponent && st.stake > 0;
  out.push({ type: 'row', items: [{ ...button(env.id('challenge'), ready ? `Défier ${free.find((o) => o.id === st.opponent)!.name} pour ${money(ctx, mod.currency, st.stake)}`.slice(0, 80) : 'Défier', 'primary', '⚔️'), disabled: !ready }] });
  return out;
}

export function handleDiceDuel(env: DiceDuelEnv, mod: DiceDuelModule, verb: string, arg: string, values: string[]): { notice?: string } {
  const { ctx } = env;
  const key = diceDuelKey(ctx.building.id, mod.id);
  const st = env.local(() => ({ opponent: '', stake: 0 }));
  const sfx = (sound?: Id) => sound && ctx.events.push({ type: 'audio.play', building: ctx.building.id, sound, player: ctx.playerId });
  expireDiceDuels(ctx, ctx.now);
  switch (verb) {
    case 'opponent':
      st.opponent = values[0] ?? '';
      return {};
    case 'stake':
      st.stake = Number(values[0] ?? 0) || 0;
      return {};
    case 'challenge': {
      const target = st.opponent;
      const stake = st.stake;
      const stakes = mod.stakes?.length ? mod.stakes : DEFAULT_STAKES;
      if (!target || !stake) throw new RuleError('Choisis un adversaire et une mise.');
      if (!stakes.includes(stake)) throw new RuleError('Mise inconnue.');
      if (!presentOthers(ctx.state, ctx.building.id, ctx.playerId).some((o) => o.id === target)) throw new RuleError('Ce joueur n’est plus là.');
      if (involved(ctx.state, ctx.playerId, ctx.now)) throw new RuleError('Tu as déjà un duel en cours.');
      if (involved(ctx.state, target, ctx.now)) throw new RuleError('Ce joueur est déjà pris dans un duel.');
      if ((ctx.player.stats[mod.currency] ?? 0) < stake) throw new RuleError(`Il te faut ${money(ctx, mod.currency, stake)} pour cette mise.`);
      const id = `dd${ctx.now.toString(36)}${Math.floor(env.random() * 1e6).toString(36)}`;
      duelsOf(ctx.state)[id] = { id, key, challenger: ctx.playerId, target, stake, createdAt: ctx.now };
      st.opponent = '';
      st.stake = 0;
      return { notice: `⚔️ Défi envoyé à **${nameOf(ctx.state, target)}** pour ${money(ctx, mod.currency, stake)} chacun.` };
    }
    case 'cancel':
    case 'refuse': {
      const d = ctx.state.diceDuels?.[arg];
      if (!d || !isPending(d) || d.key !== key || (verb === 'cancel' ? d.challenger : d.target) !== ctx.playerId) throw new RuleError('Ce défi n’existe plus.');
      dropDuel(ctx, d);
      if (verb === 'refuse') {
        const pl = ctx.state.players[d.challenger];
        if (pl) pl.lastDiceDuel = { text: `✖️ **${nameOf(ctx.state, d.target)}** a refusé ton défi. Rien n’a été prélevé.`, at: ctx.now };
        return { notice: `Tu as refusé le défi de **${nameOf(ctx.state, d.challenger)}**.` };
      }
      return { notice: 'Défi annulé. Rien n’a été prélevé.' };
    }
    case 'accept': {
      const d = ctx.state.diceDuels?.[arg];
      if (!d || !isPending(d) || d.key !== key || d.target !== ctx.playerId) throw new RuleError('Ce défi n’existe plus.');
      // Les deux doivent encore être là ; les deux mises sont prélevées maintenant (tout ou rien, avec le lancer).
      if (!present(ctx.state, ctx.building.id, d.challenger)) {
        dropDuel(ctx, d);
        throw new RuleError(`**${nameOf(ctx.state, d.challenger)}** n’est plus dans le salon : duel annulé, rien n’a été prélevé.`);
      }
      if ((ctx.state.players[d.challenger]?.stats[mod.currency] ?? 0) < d.stake) throw new RuleError(`**${nameOf(ctx.state, d.challenger)}** n’a plus assez pour suivre sa mise : duel impossible.`);
      applyAction(ctx, { type: 'stat.add', stat: mod.currency, amount: -d.stake });
      pay(ctx, d.challenger, mod.currency, -d.stake);
      const roll = () => Array.from({ length: mod.dice }, () => 1 + Math.floor(env.random() * mod.faces));
      // Tous les lancers sont tirés maintenant (côté serveur), puis dévoilés au fil du panneau en direct.
      const rounds: { a: number[]; b: number[] }[] = [];
      do rounds.push({ a: roll(), b: roll() });
      while (total(rounds.at(-1)!.a) === total(rounds.at(-1)!.b) && rounds.length < 20);
      const last = rounds.at(-1)!;
      // Après 20 égalités (impossible en pratique), le défié l'emporte.
      const winner = total(last.a) > total(last.b) ? d.challenger : d.target;
      const loser = winner === d.challenger ? d.target : d.challenger;
      const pot = d.stake * 2;
      pay(ctx, winner, mod.currency, pot);
      questTag(ctxFor(ctx, winner), `diceduel:${key}:win`);
      sfx(mod.sound);
      Object.assign(d, { status: 'live', acceptedAt: ctx.now, rounds, winner });
      const line = (who: Id, dice: number[]) => `🎲 **${nameOf(ctx.state, who)}** : ${dice.map(dieFace).join(' + ')} = **${total(dice)}**`;
      const ties = rounds.length - 1;
      const result = [
        `### 🎲 Duel : ${nameOf(ctx.state, d.challenger)} contre ${nameOf(ctx.state, d.target)}`,
        ties ? `-# ${ties} égalité${ties > 1 ? 's' : ''} : on a relancé.` : '',
        line(d.challenger, last.a),
        line(d.target, last.b),
        '',
        `🏆 **${nameOf(ctx.state, winner)}** remporte **${money(ctx, mod.currency, pot)}** ! ${nameOf(ctx.state, loser)} perd sa mise.`,
      ]
        .filter((x, i) => x || i === 4)
        .join('\n');
      // Résultat personnel, dévoilé seulement quand les dés ont fini de rouler.
      for (const who of [d.challenger, d.target]) {
        const pl = ctx.state.players[who];
        if (pl) pl.lastDiceDuel = { text: result, at: finalAt(d) };
      }
      return {};
    }
  }
  return {};
}
