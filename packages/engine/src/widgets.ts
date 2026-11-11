/**
 * Widgets : blocs prêts à l'emploi qui affichent et pilotent un module générique
 * (boutique, production, stocks, rachat, dialogue, dés, état du joueur).
 * Chaque widget = un rendu + un gestionnaire d'interactions.
 */
import type { Action, ActivityDef, ActivityModule, Id, ShopOffer, WidgetDef, ProductionModule, Recipe, BuybackModule } from './model.ts';
import type { RButton, RContainer, RSelect, RSelectOption, RTopLevel, RText } from './components.ts';
import type { SessionState } from './state.ts';
import { scopeKey } from './state.ts';
import {
  type Ctx,
  RuleError,
  activeModifiers,
  applyAction,
  describeChanges,
  evaluate,
  findItem,
  findModifier,
  findModule,
  findStat,
  findJob,
  inventoryOf,
  itemName,
  jobProgress,
  pickText,
  contributeObjective,
} from './rules.ts';
import { STARS, abandonQuest, acceptQuest, currentOffers, findQuest, nextLevel, questDeliver, questLevel, questTag, rerollOffers, stepDone, stepTarget } from './quests.ts';
import type { QuestDef } from './model.ts';

export interface WidgetEnv {
  ctx: Ctx;
  session: SessionState;
  screenId: Id;
  path: string;
  /** customId d'une interaction de ce widget. */
  id(verb: string, arg?: string): string;
  /** État d'interface persistant (partagé entre écrans). */
  ui<T extends object>(key: string, init: () => T): T;
  /** État d'interface réinitialisé à chaque entrée dans l'écran. */
  local<T extends object>(init: () => T): T;
  /** Demande un rafraîchissement automatique à cet instant (minuteurs). */
  wake(at: number): void;
  random(): number;
}

export interface HandleResult {
  goto?: Id;
  notice?: string;
}

// ---------------------------------------------------------------------------
// Aides d'affichage
// ---------------------------------------------------------------------------

export const text = (content: string): RText => ({ type: 'text', content });
export const box = (content: string, accent?: number): RContainer => ({
  type: 'container',
  accent,
  children: [text(content)],
});
const button = (customId: string, label: string, style: RButton['style'] = 'secondary', emoji?: string): RButton => ({
  type: 'button',
  customId,
  label,
  style,
  emoji,
});
const select = (customId: string, placeholder: string, options: RSelectOption[]): RSelect => ({
  type: 'select',
  customId,
  placeholder,
  options: options.slice(0, 25),
});
const rowOf = (items: RButton[]): RTopLevel[] => {
  const rows: RTopLevel[] = [];
  for (let i = 0; i < items.length; i += 5) rows.push({ type: 'row', items: items.slice(i, i + 5) });
  return rows;
};

export function money(ctx: Ctx, stat: Id, amount: number): string {
  const def = findStat(ctx.world, stat);
  return `${amount} ${def?.unit ?? def?.name ?? ''}`.trim();
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const gauge = (value: number, max: number) => {
  const filled = Math.max(0, Math.min(10, Math.floor((value / max) * 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};

/** « ⚡ +5 énergie · 🍺 +10 alcoolémie · ✨ Bonus (10 min) » */
export function effectsLine(ctx: Ctx, effects: Action[]): string {
  const parts: string[] = [];
  for (const e of effects) {
    if (e.type === 'stat.add') {
      const def = findStat(ctx.world, e.stat);
      parts.push(`${def?.emoji ?? ''} ${e.amount >= 0 ? '+' : ''}${e.amount} ${def?.unit ?? (def?.name ?? e.stat).toLowerCase()}`.trim());
    } else if (e.type === 'modifier.apply') {
      const m = findModifier(ctx.world, e.modifier);
      parts.push(`${m?.emoji ?? '✨'} ${m?.name ?? e.modifier} (${Math.round(e.durationSec / 60)} min)`);
    } else if (e.type === 'item.give') {
      parts.push(`🎁 ${itemName(ctx.world, e.item)} ×${e.qty}`);
    } else if (e.type === 'item.take') {
      parts.push(`−${e.qty} ${itemName(ctx.world, e.item)}`);
    }
  }
  return parts.join(' · ') || 'Aucun effet';
}

const offerModifier = (o: ShopOffer): Id | undefined =>
  o.highlightModifier ?? o.effects.find((e): e is Extract<Action, { type: 'modifier.apply' }> => e.type === 'modifier.apply')?.modifier;

/** Urgence d'une réserve : 0 = prioritaire, 1 = faible, 2 = suffisante. */
export function urgency(qty: number, target: number): 0 | 1 | 2 {
  const ratio = qty / Math.max(1, target);
  return qty === 0 || ratio <= 0.25 ? 0 : ratio <= 0.5 ? 1 : 2;
}
const URGENCY_MARK = ['🔴', '🟠', '🟢'] as const;

export function buybackUnitPrice(m: BuybackModule, base: number, qty: number, target: number): number {
  const ratio = qty / Math.max(1, target);
  let factor = m.aboveFactor;
  if (qty === 0) factor = m.emptyFactor;
  else {
    for (const tier of m.tiers) {
      if (ratio <= tier.maxRatio) {
        factor = tier.factor;
        break;
      }
    }
  }
  return Math.max(1, Math.round(base * factor));
}

/** Chaque unité livrée est tarifée selon la réserve au moment de son entrée. */
export function buybackQuote(m: BuybackModule, item: Id, stock: number, qty: number, target: number): number {
  const base = m.prices[item] ?? 0;
  let total = 0;
  for (let i = 0; i < qty; i++) total += buybackUnitPrice(m, base, stock + i, target);
  return total;
}

function targetOf(ctx: Ctx, inventory: Id, item: Id): number {
  return findModule(ctx.building, inventory, 'inventory').targets[item] ?? 0;
}

function requireJob(ctx: Ctx, job: Id | undefined) {
  if (job && !ctx.player.activeJobs.includes(job))
    throw new RuleError(`🔒 Métier ${findJob(ctx.world, job)?.name ?? job} requis.`, ctx.building.homeScreen);
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

export function renderWidget(env: WidgetEnv, w: WidgetDef): RTopLevel[] {
  const { ctx } = env;
  const p = ctx.player;
  switch (w.kind) {
    case 'player.status': {
      const lines = [`### ${w.title ?? '👤 Votre état'}`];
      for (const id of w.stats) {
        const def = findStat(ctx.world, id);
        if (!def) continue;
        const v = p.stats[id] ?? def.initial;
        let line = `${def.emoji ?? ''} **${def.name} :** ${def.kind === 'currency' ? money(ctx, id, v) : v}`.trim();
        if (def.max !== undefined) line += `/${def.max}`;
        if (def.kind === 'gauge' && def.max) line += `  \`${gauge(v, def.max)}\``;
        lines.push(line);
      }
      if (w.showModifier !== false) lines.push(modifierLine(env));
      return [box(lines.join('\n'), w.accent)];
    }

    case 'player.consumables': {
      const owned = Object.entries(p.items).filter(([id, q]) => q > 0 && findItem(ctx.world, id)?.consumable);
      const out: RTopLevel[] = [];
      out.push(
        box(
          [`### ${w.title ?? '🎒 Inventaire'}`, modifierLine(env)]
            .concat(
              owned.length
                ? owned.map(([id, q]) => `**${itemName(ctx.world, id)}** ×${q}\n${effectsLine(ctx, findItem(ctx.world, id)!.consumable!.effects)}`)
                : [w.all ? '*Rien à consommer.*' : '*Ton inventaire est vide.*'],
            )
            .concat(w.all ? [inventoryLines(ctx)] : [])
            .join('\n\n'),
          w.accent,
        ),
      );
      if (owned.length) {
        const st = env.local(() => ({ selected: '' as string }));
        out.push({
          type: 'row',
          items: [
            select(
              env.id('pick'),
              'Choisir un objet à consommer…',
              owned.map(([id, q]) => ({
                label: findItem(ctx.world, id)!.name,
                value: id,
                emoji: findItem(ctx.world, id)!.emoji,
                description: `${q} en inventaire`,
                default: st.selected === id,
              })),
            ),
          ],
        });
        if (st.selected && (p.items[st.selected] ?? 0) > 0)
          out.push({ type: 'row', items: [button(env.id('consume'), 'Consommer cet objet', 'success', '🍽️')] });
      }
      return out;
    }

    case 'shop.catalog': {
      const shop = findModule(ctx.building, w.shop, 'shop');
      const f = env.ui(`catalog:${shop.id}`, () => ({ category: 'Toutes', bonus: 'Tous' }));
      const out: RTopLevel[] = [];
      if (w.filters !== false) {
        const cats = ['Toutes', ...new Set(shop.offers.map((o) => o.category).filter((c): c is string => !!c))];
        out.push({
          type: 'row',
          items: [select(env.id('cat'), '📂 Filtrer par catégorie…', cats.map((c) => ({ label: c, value: c, default: c === f.category })))],
        });
        const mods = [...new Set(shop.offers.map(offerModifier).filter((m): m is Id => !!m))];
        if (mods.length)
          out.push({
            type: 'row',
            items: [
              select(env.id('bonus'), '✨ Filtrer par bonus…', [
                { label: 'Tous les bonus', value: 'Tous', default: f.bonus === 'Tous' },
                { label: 'Sans bonus spécial', value: 'aucun', default: f.bonus === 'aucun' },
                ...mods.map((m) => {
                  const def = findModifier(ctx.world, m);
                  return { label: def?.shortName ?? def?.name ?? m, value: m, emoji: def?.emoji, default: f.bonus === m };
                }),
              ]),
            ],
          });
      }
      const inv = inventoryOf(ctx, shop.inventory);
      const lines: string[] = [];
      const options: RSelectOption[] = [];
      for (const o of shop.offers) {
        if (f.category !== 'Toutes' && o.category !== f.category) continue;
        const mod = offerModifier(o);
        if (f.bonus !== 'Tous' && (mod ?? 'aucun') !== f.bonus) continue;
        const qty = inv[o.stockItem] ?? 0;
        const carry = o.takeaway ? ` · 🎒 +${money(ctx, shop.currency, o.takeaway.surcharge)}` : ' · sur place uniquement';
        lines.push(
          `**${o.emoji ?? ''} ${o.name}** — ${money(ctx, shop.currency, o.price)}${carry}\n${effectsLine(ctx, o.effects)}\n${qty ? '✅' : '❌'} Disponible : ${qty}`,
        );
        if (qty) options.push({ label: o.name, value: o.id, emoji: o.emoji, description: `${money(ctx, shop.currency, o.price)} · ${qty} disponible(s)` });
      }
      out.push(box(lines.length ? lines.join('\n\n') : '*Aucun article pour ces filtres.*', w.accent));
      if (options.length) out.push({ type: 'row', items: [select(env.id('buy'), 'Choisir un article…', options)] });
      else out.push(text('⚠️ Aucun article disponible avec ces filtres.'));
      return out;
    }

    case 'shop.checkout': {
      const c = env.ui('checkout', () => ({ shop: '', offer: '', mode: '' as '' | 'place' | 'takeaway', back: '' }));
      const shop = c.shop ? ctx.building.modules.find((m) => m.id === c.shop && m.type === 'shop') : undefined;
      const offer = shop?.type === 'shop' ? shop.offers.find((o) => o.id === c.offer) : undefined;
      if (!shop || shop.type !== 'shop' || !offer) return [box('⚠️ Commande expirée.')];
      const cur = shop.currency;
      const out: RTopLevel[] = [
        box(
          [
            `## 🧾 ${offer.emoji ?? ''} ${offer.name}`,
            `**Prix de base :** ${money(ctx, cur, offer.price)}`,
            `**Effets :** ${effectsLine(ctx, offer.effects)}`,
            `**Bourse :** ${money(ctx, cur, p.stats[cur] ?? 0)}`,
            w.prompt ? `*${pickText(ctx, w.prompt)}*` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          w.accent,
        ),
      ];
      if (!c.mode) {
        const b = [button(env.id('mode', 'place'), `🍽️ Sur place · ${money(ctx, cur, offer.price)}`, 'success')];
        if (offer.takeaway) b.push(button(env.id('mode', 'takeaway'), `🎒 À emporter · +${money(ctx, cur, offer.takeaway.surcharge)}`, 'primary'));
        out.push(...rowOf(b));
      } else {
        const total = offer.price + (c.mode === 'takeaway' ? offer.takeaway?.surcharge ?? 0 : 0);
        const result =
          c.mode === 'place'
            ? '⚡ Effets appliqués immédiatement'
            : `🎒 Objet reçu : **${itemName(ctx.world, offer.takeaway!.item)}** · consommable plus tard`;
        out.push(box(`### ${c.mode === 'place' ? '🍽️ Sur place' : '🎒 À emporter'}\n${result}\n**Total : ${money(ctx, cur, total)}**`, 0x37774c));
        out.push(...rowOf([button(env.id('confirm'), 'Confirmer l’achat', 'success', '💰'), button(env.id('mode', ''), 'Changer de service')]));
      }
      out.push(...rowOf([button(env.id('cancel'), 'Annuler')]));
      return out;
    }

    case 'production.stations': {
      const prod = findModule(ctx.building, w.production, 'production');
      const stations = ctx.state.stations[scopeKey(ctx.building.id, prod.id)] ?? [];
      const st = env.local(() => ({ selected: -1 }));
      return stations.map((s, i) => {
        const recipe = s ? prod.recipes.find((r) => r.id === s.recipe) : undefined;
        const state = !s ? 'free' : ctx.now < s.endsAt ? 'cooking' : 'ready';
        const status = { free: '🟢 Libre', cooking: '🟠 En cours', ready: '✅ Prêt' }[state];
        let info = 'Aucune préparation';
        if (s) {
          info = recipe?.name ?? 'Production inconnue';
          if (state === 'cooking') {
            info += ` · ⏳ **${mmss(s.endsAt - ctx.now)}**\n🏁 Fin prévue : <t:${Math.floor(s.endsAt / 1000)}:T>`;
            env.wake(Math.min(s.endsAt, ctx.now + 5000));
          }
          info += `\n👤 Lancé par <@${s.by}>`;
        }
        const label = {
          free: prod.labels?.start ?? 'Lancer',
          cooking: prod.labels?.details ?? 'Détails',
          ready: prod.labels?.collect ?? 'Récupérer',
        }[state];
        const style = ({ free: 'success', cooking: 'secondary', ready: 'primary' } as const)[state];
        const children: RContainer['children'] = [
          {
            type: 'section',
            texts: [text(`**${prod.stationName} ${i + 1} · ${status}**\n${info}`)],
            accessory: button(env.id('station', String(i)), label, style),
          },
        ];
        if (st.selected === i && s) {
          const xp = recipe?.xp ?? prod.xp;
          children.push({ type: 'separator' });
          children.push(
            text(
              `**📋 Détails**\n**Production :** ${recipe?.name ?? '?'} → ${Object.entries(recipe?.outputs ?? {})
                .map(([it, q]) => `${itemName(ctx.world, it)} ×${q}`)
                .join(', ')}\n**XP :** ${xp.start} au lancement · ${xp.collect} à la récupération\n*Tout titulaire du métier peut récupérer la production, même si son auteur a démissionné.*`,
            ),
          );
        }
        return { type: 'container', accent: { free: 0x36965e, cooking: 0xc58b38, ready: 0x468bbf }[state], children } as RContainer;
      });
    }

    case 'production.priorities': {
      const prod = findModule(ctx.building, w.production, 'production');
      const out = inventoryOf(ctx, prod.outputInventory);
      const stations = ctx.state.stations[scopeKey(ctx.building.id, prod.id)] ?? [];
      const rows = prod.recipes.map((r) => {
        const [item, perBatch] = Object.entries(r.outputs)[0] ?? ['', 0];
        const qty = out[item] ?? 0;
        const target = targetOf(ctx, prod.outputInventory, item);
        const pending = stations.filter((s) => s?.recipe === r.id).length * perBatch;
        return { r, qty, target, pending, ratio: qty / Math.max(1, target) };
      });
      rows.sort((a, b) => a.ratio - b.ratio || a.r.name.localeCompare(b.r.name));
      const lines = rows.slice(0, w.limit ?? 4).map(({ r, qty, target, pending }) => {
        let status = feasible(ctx, prod, r) ? '✅ Réalisable' : '⚠️ Ingrédients manquants';
        if (r.level > jobLevelFor(ctx, prod)) status += ` · 🔒 Niveau ${r.level}`;
        return `${URGENCY_MARK[urgency(qty, target)]} **${r.name}** : ${qty}/${target} · en cours +${pending} · ${status}`;
      });
      return [box(`### ${w.title ?? '📋 À produire en priorité'}\n${lines.join('\n')}\n*Objectifs de réserve indicatifs ; aucun plafond de stockage.*`, w.accent ?? 0x526d52)];
    }

    case 'production.recipes': {
      const prod = findModule(ctx.building, w.production, 'production');
      const pick = env.ui('production', () => ({ module: '', station: -1 }));
      const local = env.local(() => ({ recipe: '' }));
      const level = jobLevelFor(ctx, prod);
      const stock = inventoryOf(ctx, prod.inputInventory);
      const unlocked = prod.recipes.filter((r) => r.level <= level);
      const out: RTopLevel[] = [];
      out.push(
        text(`${prod.stationName} ${pick.module === prod.id && pick.station >= 0 ? pick.station + 1 : '?'} · niveau ${level}`),
      );
      const lines = unlocked.map((r) => {
        const ok = feasible(ctx, prod, r);
        const ing = Object.entries(r.inputs)
          .map(([it, q]) => `${(stock[it] ?? 0) >= q ? '✅' : '❌'} ${findItem(ctx.world, it)?.name ?? it} ${stock[it] ?? 0}/${q}`)
          .join(' · ');
        const outs = Object.entries(r.outputs).map(([it, q]) => `${q} ${findItem(ctx.world, it)?.name ?? it}`).join(', ');
        return `**${r.name}** — niveau ${r.level} · ${r.durationSec}s · ${outs}\n${ok ? '✅ Réalisable' : '❌ Stock insuffisant'}\n${ing}`;
      });
      out.push(box(lines.join('\n\n') || '*Aucune recette débloquée.*', w.accent ?? 0x4b5263));
      const available = unlocked.filter((r) => feasible(ctx, prod, r));
      if (available.length)
        out.push({
          type: 'row',
          items: [
            select(
              env.id('recipe'),
              'Choisir une recette réalisable…',
              available.map((r) => ({
                label: r.name,
                value: r.id,
                emoji: r.emoji,
                description: `Niveau ${r.level} · ${r.durationSec}s`,
                default: r.id === local.recipe,
              })),
            ),
          ],
        });
      else out.push(text('⚠️ Aucune recette réalisable.'));
      const chosen = available.find((r) => r.id === local.recipe);
      if (chosen) {
        const xp = chosen.xp ?? prod.xp;
        out.push(
          box(
            `### 🍳 Confirmer : ${chosen.name}\n**Durée :** ${chosen.durationSec}s · **Production :** ${Object.entries(chosen.outputs)
              .map(([it, q]) => `${q} ${findItem(ctx.world, it)?.name ?? it}`)
              .join(', ')}\n**XP :** ${xp.start} au lancement, ${xp.collect} à la récupération.\n*Ingrédients prélevés à la confirmation.*`,
            0x36965e,
          ),
        );
        out.push({ type: 'row', items: [button(env.id('start'), 'Lancer la production', 'success', '🔥')] });
      }
      return out;
    }

    case 'inventory.stock': {
      const st = env.ui(`stock:${env.screenId}`, () => ({ view: 0 }));
      const view = w.views[st.view] ?? w.views[0];
      const out: RTopLevel[] = [];
      if (!view) return out;
      const inv = inventoryOf(ctx, view.inventory);
      const mod = findModule(ctx.building, view.inventory, 'inventory');
      const buy = view.buyback ? findModule(ctx.building, view.buyback, 'buyback') : undefined;
      const items = [...new Set([...Object.keys(mod.targets), ...Object.keys(inv)])];
      const groups: string[][] = [[], [], []];
      for (const it of items) {
        const qty = inv[it] ?? 0;
        const target = mod.targets[it] ?? 0;
        let entry = `**${itemName(ctx.world, it)}** — ${qty} en stock${target ? ` / objectif ${target}` : ''}`;
        if (buy && buy.prices[it] !== undefined)
          entry += `\n💰 Rachat actuel : **${money(ctx, buy.currency, buybackUnitPrice(buy, buy.prices[it]!, qty, target))}/u**`;
        groups[target ? urgency(qty, target) : 2]!.push(entry);
      }
      const titles = ['🔴 Prioritaires', '🟠 Réserves faibles', '🟢 Réserves suffisantes'];
      const colours = [0xa84a4a, 0xb88039, 0x526d52];
      groups.forEach((g, i) => {
        if (g.length) out.push(box(`### ${titles[i]}\n\n${g.join('\n\n')}`, colours[i]));
      });
      if (!out.length) out.push(box('*Inventaire vide.*'));
      if (w.views.length > 1)
        out.push(
          ...rowOf(
            w.views.map((v, i) => button(env.id('view', String(i)), `${v.emoji ?? ''} ${v.label}`.trim(), i === st.view ? 'primary' : 'secondary')),
          ),
        );
      return out;
    }

    case 'buyback.sell': {
      const buy = findModule(ctx.building, w.buyback, 'buyback');
      const inv = inventoryOf(ctx, buy.inventory);
      const sell = env.ui(`sell:${buy.id}`, () => ({ item: '', qty: 1 }));
      const owned = Object.entries(p.items).filter(([id, q]) => q > 0 && buy.prices[id] !== undefined);
      const out: RTopLevel[] = [];
      const lines = owned.map(
        ([id, q]) =>
          `🎒 **${itemName(ctx.world, id)}** ×${q} · rachat ${money(ctx, buy.currency, buybackUnitPrice(buy, buy.prices[id]!, inv[id] ?? 0, targetOf(ctx, buy.inventory, id)))}/u`,
      );
      out.push(box(`### 🎒 Tes ressources vendables\n${lines.join('\n') || '*Aucune ressource à vendre.*'}`, w.accent ?? 0x526d52));
      if (owned.length)
        out.push({
          type: 'row',
          items: [
            select(
              env.id('item'),
              'Choisir une ressource de ton inventaire…',
              owned.map(([id, q]) => ({ label: findItem(ctx.world, id)?.name ?? id, value: id, description: `${q} disponible(s)`, default: id === sell.item })),
            ),
          ],
        });
      const have = sell.item ? p.items[sell.item] ?? 0 : 0;
      if (sell.item && have > 0) {
        const qty = Math.min(sell.qty, have);
        const stock = inv[sell.item] ?? 0;
        const quote = buybackQuote(buy, sell.item, stock, qty, targetOf(ctx, buy.inventory, sell.item));
        out.push(
          box(
            `### 📋 Proposition de rachat\n**Ressource :** ${itemName(ctx.world, sell.item)} · **Quantité :** ${qty}\n**Stock actuel :** ${stock} · **Après vente :** ${stock + qty}\n**Tu recevras : ${money(ctx, buy.currency, quote)}**`,
            0x36965e,
          ),
        );
        const qb = buy.quantities.filter((n) => n <= have).map((n) => button(env.id('qty', String(n)), `×${n}`, n === qty ? 'primary' : 'secondary'));
        if (qb.length) out.push(...rowOf(qb));
        out.push({ type: 'row', items: [button(env.id('sell'), 'Confirmer la vente', 'success', '💰')] });
      }
      return out;
    }

    case 'dialogue': {
      const dlg = findModule(ctx.building, w.dialogue, 'dialogue');
      const st = env.local(() => ({ node: dlg.start, visits: {} as Record<string, number> }));
      const node = dlg.nodes.find((n) => n.id === st.node) ?? dlg.nodes.find((n) => n.id === dlg.start);
      if (!node) return [box('⚠️ Dialogue vide.')];
      const visits = st.visits[node.id] ?? 1;
      const line = node.lines.length ? pickText(ctx, node.lines[(visits - 1) % node.lines.length]) : '';
      const narration = dlg.narration ? `*${pickText(ctx, dlg.narration)}*\n\n` : '';
      const out: RTopLevel[] = [
        box(`## ${node.title}\n${narration}**${dlg.speaker.emoji ?? '💬'} ${dlg.speaker.name} :** ${line}`, w.accent),
      ];
      const choices = node.choices
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => evaluate(ctx, c.when).ok)
        .map(({ c, i }) => button(env.id('choice', String(i)), `${c.emoji ? c.emoji + ' ' : ''}${c.label}`, 'primary'));
      out.push(...rowOf(choices));
      const nav = [button(env.id('exit'), `Retour`)];
      if (node.id !== dlg.start) nav.unshift(button(env.id('topics'), '← Sujets'));
      out.push(...rowOf(nav));
      return out;
    }

    case 'activity.board': {
      const mod = findModule(ctx.building, w.activity, 'activity');
      const children: RContainer['children'] = [text(`### ${mod.name}`)];
      mod.activities.forEach((a, i) => {
        if (i > 0) children.push({ type: 'separator' });
        const key = activityKey(ctx, mod, a);
        const pending = p.activities[key];
        const reqs: string[] = [];
        if (a.costs.length) reqs.push(effectsLine(ctx, a.costs));
        if (a.tool) {
          const def = findItem(ctx.world, a.tool.item);
          const dur = p.tools[a.tool.item];
          reqs.push(`${itemName(ctx.world, a.tool.item)} (−${a.tool.wear} durabilité${(p.items[a.tool.item] ?? 0) > 0 ? ` · état ${dur ?? def?.tool?.maxDurability}/${def?.tool?.maxDurability}` : ''})`);
        }
        reqs.push(a.durationSec ? `⏱️ ${duration(a.durationSec)}` : '⚡ immédiat');
        let status: string;
        let btn: RButton;
        if (pending && ctx.now < pending.endsAt) {
          status = `⏳ En cours : **${mmss(pending.endsAt - ctx.now)}**`;
          env.wake(Math.min(pending.endsAt, ctx.now + 5000));
          btn = { ...button(env.id('claim', a.id), 'En cours', 'secondary'), disabled: true };
        } else if (pending) {
          status = '✅ **Terminé !** Récupère ta récolte.';
          btn = button(env.id('claim', a.id), 'Récupérer', 'primary');
        } else {
          const lock = activityLock(ctx, mod, a);
          if (lock) {
            status = `🔒 ${lock.text}`;
            if (lock.until) env.wake(Math.min(lock.until, ctx.now + 5000));
            btn = { ...button(env.id('start', a.id), 'Lancer', 'secondary'), disabled: true };
          } else {
            status = '🟢 Disponible';
            btn = button(env.id('start', a.id), 'Lancer', 'success');
          }
        }
        children.push({
          type: 'section',
          texts: [text(`**${a.emoji ?? ''} ${a.name}**${a.description ? `\n${a.description}` : ''}\n${reqs.join(' · ')}\n${status}`)],
          accessory: btn,
        });
      });
      return [{ type: 'container', accent: w.accent, children }];
    }

    case 'objective.board': {
      const mod = findModule(ctx.building, w.objective, 'objective');
      const st = objectiveState(ctx, mod.id);
      const goals = Object.entries(mod.goals);
      const total = goals.reduce((s, [, g]) => s + g, 0);
      const done = goals.reduce((s, [it, g]) => s + Math.min(g, st.progress[it] ?? 0), 0);
      const lines = [`### ${mod.name}`];
      const desc = pickText(ctx, mod.description);
      if (desc) lines.push(desc);
      lines.push('');
      for (const [it, g] of goals) {
        const q = Math.min(g, st.progress[it] ?? 0);
        lines.push(`${q >= g ? '✅' : '▫️'} **${itemName(ctx.world, it)}** ${q}/${g}  \`${gauge(q, g)}\``);
      }
      lines.push('', st.completedAt ? '🎉 **Objectif atteint !** Merci à tous les contributeurs.' : `**Avancement : ${Math.floor((done / Math.max(1, total)) * 100)} %**`);
      const top = Object.entries(st.contributors).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (top.length) lines.push(`🏅 ${top.map(([id, n]) => `<@${id}> (${n})`).join(' · ')}`);
      const out: RTopLevel[] = [box(lines.join('\n'), w.accent ?? 0x526d52)];
      if (st.completedAt) return out;
      if (mod.when && !evaluate(ctx, mod.when).ok) {
        out.push(text(`*${pickText(ctx, mod.closedText) || 'Les contributions sont fermées pour l’instant.'}*`));
        return out;
      }
      const sel = env.ui(`objective:${mod.id}`, () => ({ item: '', qty: 1 }));
      const usable = goals.filter(([it, g]) => (p.items[it] ?? 0) > 0 && (st.progress[it] ?? 0) < g);
      if (!usable.length) {
        out.push(text('*Tu n’as rien à apporter pour l’instant.*'));
        return out;
      }
      out.push({
        type: 'row',
        items: [
          select(
            env.id('item'),
            'Choisir ce que tu apportes…',
            usable.map(([it, g]) => ({
              label: findItem(ctx.world, it)?.name ?? it,
              value: it,
              emoji: findItem(ctx.world, it)?.emoji,
              description: `Tu en as ${p.items[it]} · il en manque ${g - (st.progress[it] ?? 0)}`,
              default: it === sel.item,
            })),
          ),
        ],
      });
      if (sel.item && usable.some(([it]) => it === sel.item)) {
        const max = Math.min(p.items[sel.item] ?? 0, (mod.goals[sel.item] ?? 0) - (st.progress[sel.item] ?? 0));
        const qty = Math.min(sel.qty, max);
        const reward = mod.currency && mod.unitRewards?.[sel.item] ? ` · récompense ${money(ctx, mod.currency, mod.unitRewards[sel.item]! * qty)}` : '';
        const quick = [...new Set([...mod.quantities.filter((n) => n < max), max])].map((n) => button(env.id('qty', String(n)), n === max ? `Tout (${n})` : `×${n}`, n === qty ? 'primary' : 'secondary'));
        out.push(...rowOf(quick));
        out.push({ type: 'row', items: [button(env.id('give'), `Apporter ×${qty}${reward}`, 'success', '🤝')] });
      }
      return out;
    }

    case 'player.tools': {
      const owned = Object.entries(p.items).filter(([id, q]) => q > 0 && findItem(ctx.world, id)?.tool);
      const lines = [`### ${w.title ?? '🧰 Tes outils'}`];
      for (const [id] of owned) {
        const max = findItem(ctx.world, id)!.tool!.maxDurability;
        const dur = p.tools[id] ?? max;
        lines.push(`**${itemName(ctx.world, id)}** ${dur}/${max}  \`${gauge(dur, max)}\`${dur === 0 ? ' · 💥 cassé' : ''}`);
      }
      if (!owned.length) lines.push('*Aucun outil.*');
      const out: RTopLevel[] = [box(lines.join('\n'), w.accent)];
      if (w.repair) {
        const worn = owned.filter(([id]) => (p.tools[id] ?? 0) < findItem(ctx.world, id)!.tool!.maxDurability);
        if (worn.length) {
          const rep = w.repair;
          out.push({
            type: 'row',
            items: [
              select(
                env.id('repair'),
                'Faire réparer un outil…',
                worn.map(([id]) => {
                  const max = findItem(ctx.world, id)!.tool!.maxDurability;
                  return { label: findItem(ctx.world, id)!.name, value: id, emoji: findItem(ctx.world, id)!.emoji, description: `${p.tools[id] ?? 0}/${max} · réparation : ${money(ctx, rep.currency, (max - (p.tools[id] ?? 0)) * rep.costPerPoint)}` };
                }),
              ),
            ],
          });
        }
      }
      return out;
    }

    case 'quest.board': {
      const sys = ctx.world.quests;
      if (!sys) return [box('⚠️ Aucune quête n’est configurée dans ce monde.')];
      const current = findQuest(ctx, p.quest?.id);
      if (current) {
        return [
          box(`### ${w.title ?? '📜 Panneau des quêtes'}\nTu mènes déjà une quête. Termine-la avant d’en choisir une autre.\n\n${questCard(env, current, true)}`, w.accent),
          { type: 'row', items: [button(env.id('abandon'), 'Abandonner cette quête', 'danger', '✖️')] },
        ];
      }
      const offers = currentOffers(ctx);
      const level = questLevel(ctx);
      const children: RContainer['children'] = [
        text(`### ${w.title ?? '📜 Panneau des quêtes'}\n${level ? `Ton niveau : **${level.emoji ? level.emoji + ' ' : ''}${level.name}**. ` : ''}Choisis **une** quête. Quand elle sera réussie, reviens ici pour en prendre une autre.`),
      ];
      if (!offers.length) children.push(text('*Aucune quête disponible pour l’instant. Repasse plus tard !*'));
      offers.forEach((q) => {
        children.push({ type: 'separator' });
        children.push({ type: 'section', texts: [text(questCard(env, q, false))], accessory: button(env.id('accept', q.id), 'Choisir', 'success', '✅') });
      });
      const out: RTopLevel[] = [{ type: 'container', accent: w.accent, children }];
      const until = (p.questRerollAt ?? 0) + sys.rerollMinutes * 60_000;
      if (p.questRerollAt && ctx.now < until) {
        env.wake(Math.min(until, ctx.now + 60_000));
        out.push({ type: 'row', items: [{ ...button(env.id('reroll'), `Autres quêtes dans ${Math.ceil((until - ctx.now) / 60_000)} min`, 'secondary', '🎲'), disabled: true }] });
      } else if (offers.length) out.push({ type: 'row', items: [button(env.id('reroll'), 'Autres quêtes', 'secondary', '🎲')] });
      return out;
    }

    case 'player.sheet': {
      const lines = ['### 🧾 Ta fiche'];
      for (const id of w.stats) {
        const def = findStat(ctx.world, id);
        if (!def) continue;
        const v = p.stats[id] ?? def.initial;
        let line = `${def.emoji ?? ''} **${def.name} :** ${def.kind === 'currency' ? money(ctx, id, v) : v}`.trim();
        if (def.max !== undefined) line += `/${def.max}`;
        if (def.kind === 'gauge' && def.max) line += `  \`${gauge(v, def.max)}\``;
        lines.push(line);
      }
      const sys = ctx.world.quests;
      if (sys) {
        const xp = p.stats[sys.xpStat] ?? 0;
        const xpDef = findStat(ctx.world, sys.xpStat);
        const level = questLevel(ctx);
        const next = nextLevel(ctx);
        lines.push(`${xpDef?.emoji ?? '⭐'} **${xpDef?.name ?? 'XP'} :** ${xp}${level ? ` · ${level.emoji ? level.emoji + ' ' : ''}**${level.name}**` : ''}${next ? ` (prochain : ${next.name} à ${next.minXp})` : ''}`);
      }
      const q = findQuest(ctx, p.quest?.id);
      lines.push('', q ? questCard(env, q, true) : '📜 *Aucune quête en cours : passe au panneau des quêtes de la Place.*');
      const out: RTopLevel[] = [box(lines.join('\n'), w.accent)];
      if (q) {
        const btns = q.steps
          .filter((st) => st.kind === 'deliver' && st.building === ctx.building.id && !stepDone(ctx, st) && (p.items[st.item] ?? 0) > 0)
          .filter((st, i, all) => !q.ordered || q.steps.find((x) => !stepDone(ctx, x)) === st || all.length === 0)
          .map((st) => button(env.id('deliver', st.id), `Livrer : ${st.label}`.slice(0, 80), 'success', '📦'));
        out.push(...rowOf(btns));
      }
      return out;
    }

    case 'ranking': {
      const def = findStat(ctx.world, w.stat);
      const rows = Object.entries(ctx.state.players)
        .map(([id, pl]) => ({ id, v: pl.stats[w.stat] ?? 0 }))
        .filter((r) => r.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, w.limit ?? 10);
      const medals = ['🥇', '🥈', '🥉'];
      const lines = [`### ${w.title ?? '🏅 Classement'}`];
      rows.forEach((r, i) => lines.push(`${medals[i] ?? `**${i + 1}.**`} <@${r.id}> — ${r.v} ${def?.unit ?? def?.name ?? ''}`.trim()));
      if (!rows.length) lines.push('*Personne pour l’instant.*');
      return [box(lines.join('\n'), w.accent)];
    }

    case 'dice': {
      const dice = findModule(ctx.building, w.dice, 'dice');
      const st = env.local(() => ({ me: [] as number[], them: [] as number[], rounds: 0 }));
      const out: RTopLevel[] = [];
      if (st.me.length) {
        const a = st.me.reduce((x, y) => x + y, 0);
        const b = st.them.reduce((x, y) => x + y, 0);
        const verdict = pickText(ctx, a > b ? dice.texts.win : a < b ? dice.texts.lose : dice.texts.draw);
        out.push(
          box(
            `### Résultat de la manche ${st.rounds}\n🎲 **Toi :** ${st.me.join(' + ')} = **${a}**\n🎲 **${dice.opponent} :** ${st.them.join(' + ')} = **${b}**\n\n${verdict}`,
            a >= b ? 0x526d52 : 0x885c34,
          ),
        );
      }
      out.push({ type: 'row', items: [button(env.id('roll'), st.me.length ? '🔄 Rejouer' : '🎲 Lancer les dés', 'success')] });
      return out;
    }
  }
}

/** Objets non consommables du joueur, regroupés par catégorie. */
function inventoryLines(ctx: Ctx): string {
  const groups = new Map<string, string[]>();
  for (const [id, q] of Object.entries(ctx.player.items)) {
    const def = findItem(ctx.world, id);
    if (!def || q <= 0 || def.consumable) continue;
    const cat = def.category ?? 'Objets';
    const dur = def.tool ? ` (${ctx.player.tools[id] ?? def.tool.maxDurability}/${def.tool.maxDurability})` : '';
    (groups.get(cat) ?? groups.set(cat, []).get(cat)!).push(`${itemName(ctx.world, id)} ×${q}${dur}`);
  }
  if (!groups.size) return '**🧺 Sac :** *vide*';
  return [...groups].map(([cat, list]) => `**${cat} :** ${list.join(' · ')}`).join('\n');
}

/** Carte d'une quête : titre, donneur, difficulté, étapes (avec avancement si en cours), récompense. */
function questCard(env: WidgetEnv, q: QuestDef, active: boolean): string {
  const { ctx } = env;
  const sys = ctx.world.quests!;
  const head = `**${q.emoji ?? '📜'} ${q.name}** ${STARS[q.difficulty]}${q.giver ? ` · ${q.giver}` : ''}`;
  const desc = pickText(ctx, q.description);
  const steps = q.steps.map((s) => {
    const target = stepTarget(s);
    const done = active ? Math.min(target, ctx.player.quest?.progress[s.id] ?? 0) : 0;
    const count = target > 1 ? ` (${done}/${target})` : '';
    return active ? `${done >= target ? '✅' : '▫️'} ${s.label}${count}` : `• ${s.label}${target > 1 ? ` (${target})` : ''}`;
  });
  const reward = effectsLine(ctx, [...(sys.rewards?.[String(q.difficulty) as '1' | '2' | '3'] ?? []), ...q.rewards]);
  return [head, desc ? `*${desc}*` : '', ...steps, `🎁 ${reward}`].filter(Boolean).join('\n');
}

const duration = (sec: number) => (sec < 60 ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec / 60} min`);

export const activityKey = (ctx: Ctx, mod: ActivityModule, a: ActivityDef) => `${ctx.building.id}/${mod.id}/${a.id}`;

/** Raison pour laquelle une activité ne peut pas être lancée, ou null. */
export function activityLock(ctx: Ctx, mod: ActivityModule, a: ActivityDef): { text: string; until?: number } | null {
  const p = ctx.player;
  const until = p.cooldowns[activityKey(ctx, mod, a)];
  if (until && until > ctx.now) return { text: `Disponible dans ${mmss(until - ctx.now)}`, until };
  const v = evaluate(ctx, a.when);
  if (!v.ok) return { text: v.reason.charAt(0).toUpperCase() + v.reason.slice(1) };
  if (a.maxConcurrent) {
    const key = activityKey(ctx, mod, a);
    const busy = Object.values(ctx.state.players).filter((o) => o.activities?.[key] && ctx.now < o.activities[key]!.endsAt).length;
    if (busy >= a.maxConcurrent) return { text: `Déjà ${busy} personnes à l’ouvrage : attends qu’une place se libère`, until: ctx.now + 15_000 };
  }
  if (a.tool) {
    const t = evaluate(ctx, { type: 'tool', item: a.tool.item });
    if (!t.ok) return { text: t.reason.charAt(0).toUpperCase() + t.reason.slice(1) };
  }
  for (const c of a.costs) {
    if (c.type === 'stat.add' && c.amount < 0) {
      const def = findStat(ctx.world, c.stat);
      const have = p.stats[c.stat] ?? def?.initial ?? 0;
      if (have + c.amount < (def?.min ?? 0)) return { text: `${def?.emoji ?? ''} ${def?.name ?? c.stat} insuffisant(e) (${have}/${-c.amount})`.trim() };
    }
    if (c.type === 'item.take' && !c.inventory && (p.items[c.item] ?? 0) < c.qty) return { text: `${itemName(ctx.world, c.item)} : ${p.items[c.item] ?? 0}/${c.qty}` };
  }
  return null;
}

function objectiveState(ctx: Ctx, module: Id) {
  return (ctx.state.objectives[scopeKey(ctx.building.id, module)] ??= { progress: {}, contributors: {} });
}

/** Applique les résultats tirés, avec les bonus actifs qui augmentent les objets reçus. */
function claimActivity(ctx: Ctx, mod: ActivityModule, a: ActivityDef, results: number[]): string {
  const p = ctx.player;
  const active = activeModifiers(p, ctx.now).filter((m) => a.boostedBy?.includes(m.id));
  const boost = active.reduce((s, m) => s + (findModifier(ctx.world, m.id)?.value ?? 0), 0);
  const mult = a.multipliers?.find((x) => evaluate(ctx, x.when).ok);
  const factor = (1 + boost) * (mult?.factor ?? 1);
  const labels: string[] = [];
  const before = ctx.changes.length;
  for (const i of results) {
    const r = a.results[i];
    if (!r) continue;
    labels.push(r.label);
    for (const act of r.actions) {
      if (act.type === 'item.give' && !act.inventory && factor !== 1) {
        const qty = factor > 1 ? Math.max(act.qty, Math.round(act.qty * factor)) : Math.max(0, Math.round(act.qty * factor));
        if (qty > 0) applyAction(ctx, { ...act, qty });
      } else applyAction(ctx, act);
    }
  }
  if (a.job?.xp) applyAction(ctx, { type: 'job.xp', job: a.job.id, amount: a.job.xp });
  delete p.activities[activityKey(ctx, mod, a)];
  if (a.cooldownSec) p.cooldowns[activityKey(ctx, mod, a)] = ctx.now + a.cooldownSec * 1000;
  const fx = describeChanges(ctx, ctx.changes.slice(before));
  questTag(ctx, `activity:${ctx.building.id}/${a.id}`);
  let bonus = active.length ? ` (${active.map((m) => findModifier(ctx.world, m.id)?.emoji ?? '✨').join('')} bonus +${Math.round(boost * 100)} %)` : '';
  if (mult) bonus += ` (${mult.label ?? `rendement ×${mult.factor}`})`;
  return `✅ **${a.emoji ?? ''} ${a.name}** : ${labels.join(', ') || 'terminé'}${fx ? ` · ${fx}` : ''}${bonus}`;
}

function rollResults(a: ActivityDef, random: () => number): number[] {
  const total = a.results.reduce((s, r) => s + Math.max(0, r.weight), 0);
  const out: number[] = [];
  for (let n = 0; n < Math.max(1, a.rolls); n++) {
    let x = random() * total;
    let idx = a.results.length - 1;
    for (let i = 0; i < a.results.length; i++) {
      x -= Math.max(0, a.results[i]!.weight);
      if (x < 0) {
        idx = i;
        break;
      }
    }
    if (total > 0) out.push(idx);
  }
  return out;
}

function modifierLine(env: WidgetEnv): string {
  const { ctx } = env;
  const active = activeModifiers(ctx.player, ctx.now);
  if (!active.length) return '✨ **Bonus actif :** Aucun';
  return active
    .map((m) => {
      const def = findModifier(ctx.world, m.id);
      const left = Math.ceil((m.expiresAt - ctx.now) / 1000);
      env.wake(Math.min(m.expiresAt, ctx.now + 5000));
      return `✨ **Bonus actif :** ${def?.emoji ?? ''} ${def?.name ?? m.id} · ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, '0')} s restantes`;
    })
    .join('\n');
}

function jobLevelFor(ctx: Ctx, prod: ProductionModule): number {
  return prod.job ? jobProgress(ctx.player, prod.job).level : Infinity;
}

function feasible(ctx: Ctx, prod: ProductionModule, r: Recipe): boolean {
  const stock = inventoryOf(ctx, prod.inputInventory);
  return Object.entries(r.inputs).every(([it, q]) => (stock[it] ?? 0) >= q);
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export function handleWidget(env: WidgetEnv, w: WidgetDef, verb: string, arg: string, values: string[]): HandleResult {
  const { ctx } = env;
  const p = ctx.player;
  const value = values[0] ?? '';
  switch (w.kind) {
    case 'player.consumables': {
      const st = env.local(() => ({ selected: '' }));
      if (verb === 'pick') {
        st.selected = value;
        return {};
      }
      if (verb === 'consume') {
        const item = findItem(ctx.world, st.selected);
        if (!item?.consumable || (p.items[item.id] ?? 0) <= 0) {
          st.selected = '';
          throw new RuleError('⚠️ Objet absent de ton inventaire.');
        }
        applyAction(ctx, { type: 'item.take', item: item.id, qty: 1 });
        const before = ctx.changes.length;
        for (const e of item.consumable.effects) applyAction(ctx, e);
        questTag(ctx, `consume:${item.id}`);
        st.selected = '';
        const fx = describeChanges(ctx, ctx.changes.slice(before));
        return { notice: `✅ ${itemName(ctx.world, item.id)} consommé !${fx ? ' ' + fx : ''}` };
      }
      break;
    }

    case 'shop.catalog': {
      const f = env.ui(`catalog:${w.shop}`, () => ({ category: 'Toutes', bonus: 'Tous' }));
      if (verb === 'cat') f.category = value || 'Toutes';
      else if (verb === 'bonus') f.bonus = value || 'Tous';
      else if (verb === 'buy') {
        const shop = findModule(ctx.building, w.shop, 'shop');
        if (!shop.offers.some((o) => o.id === value)) throw new RuleError('Article inconnu.');
        const c = env.ui('checkout', () => ({ shop: '', offer: '', mode: '', back: '' }));
        Object.assign(c, { shop: shop.id, offer: value, mode: '', back: env.screenId });
        return { goto: w.checkoutScreen };
      }
      return {};
    }

    case 'shop.checkout': {
      const c = env.ui('checkout', () => ({ shop: '', offer: '', mode: '' as string, back: '' }));
      const back = c.back || w.backScreen;
      if (verb === 'cancel') {
        Object.assign(c, { shop: '', offer: '', mode: '' });
        return { goto: back };
      }
      const shop = findModule(ctx.building, c.shop, 'shop');
      const offer = shop.offers.find((o) => o.id === c.offer);
      if (!offer) throw new RuleError('Commande introuvable.', back);
      if (verb === 'mode') {
        c.mode = arg === 'takeaway' && !offer.takeaway ? '' : arg;
        return {};
      }
      if (verb === 'confirm') {
        if (c.mode !== 'place' && c.mode !== 'takeaway') throw new RuleError('⚠️ Choisis un service disponible.');
        const price = offer.price + (c.mode === 'takeaway' ? offer.takeaway!.surcharge : 0);
        // Ordre : paiement puis stock, le tout atomique.
        applyAction(ctx, { type: 'stat.add', stat: shop.currency, amount: -price });
        if ((inventoryOf(ctx, shop.inventory)[offer.stockItem] ?? 0) <= 0)
          throw new RuleError('⚠️ Stock épuisé : commande annulée.', back);
        applyAction(ctx, { type: 'item.take', item: offer.stockItem, qty: 1, inventory: shop.inventory });
        let msg: string;
        if (c.mode === 'takeaway') {
          applyAction(ctx, { type: 'item.give', item: offer.takeaway!.item, qty: 1 });
          msg = `🎒 ${itemName(ctx.world, offer.takeaway!.item)} ajouté à ton inventaire.`;
        } else {
          const before = ctx.changes.length;
          for (const e of offer.effects) applyAction(ctx, e);
          const fx = describeChanges(ctx, ctx.changes.slice(before));
          msg = `🍽️ ${offer.name} consommé !${fx ? ' ' + fx + '.' : ''}`;
        }
        Object.assign(c, { shop: '', offer: '', mode: '' });
        questTag(ctx, `buy:${ctx.building.id}/${offer.id}`);
        questTag(ctx, `shop:${ctx.building.id}/${shop.id}`);
        if (c.mode === 'place') questTag(ctx, `consume:${offer.stockItem}`);
        return {
          goto: back,
          notice: `✅ ${msg} −${money(ctx, shop.currency, price)} · Solde : ${money(ctx, shop.currency, p.stats[shop.currency] ?? 0)}.`,
        };
      }
      return {};
    }

    case 'production.stations': {
      const prod = findModule(ctx.building, w.production, 'production');
      const st = env.local(() => ({ selected: -1 }));
      if (verb !== 'station') return {};
      requireJob(ctx, prod.job);
      const i = Number(arg);
      const stations = ctx.state.stations[scopeKey(ctx.building.id, prod.id)]!;
      if (!(i >= 0 && i < stations.length)) throw new RuleError('Poste inconnu.');
      const s = stations[i];
      if (!s) {
        const pick = env.ui('production', () => ({ module: '', station: -1 }));
        Object.assign(pick, { module: prod.id, station: i });
        return { goto: w.recipeScreen };
      }
      if (ctx.now < s.endsAt) {
        st.selected = st.selected === i ? -1 : i;
        return {};
      }
      // Récupération : sorties dans la réserve, XP au récupérateur.
      const recipe = prod.recipes.find((r) => r.id === s.recipe);
      stations[i] = null;
      st.selected = -1;
      if (recipe) {
        for (const [it, q] of Object.entries(recipe.outputs)) applyAction(ctx, { type: 'item.give', item: it, qty: q, inventory: prod.outputInventory });
        const xp = (recipe.xp ?? prod.xp).collect;
        if (prod.job && xp) applyAction(ctx, { type: 'job.xp', job: prod.job, amount: xp });
        questTag(ctx, `production:${ctx.building.id}/${recipe.id}`);
      }
      const job = prod.job ? findJob(ctx.world, prod.job)?.name : '';
      const xp = recipe ? (recipe.xp ?? prod.xp).collect : 0;
      return {
        notice: `✅ ${recipe?.name ?? 'Production'} récupéré !${xp && job ? ` +${xp} XP ${job.toLowerCase()}.` : ''}${s.by !== ctx.playerId ? ` Lancé par <@${s.by}>.` : ''}`,
      };
    }

    case 'production.recipes': {
      const prod = findModule(ctx.building, w.production, 'production');
      const local = env.local(() => ({ recipe: '' }));
      if (verb === 'recipe') {
        local.recipe = value;
        return {};
      }
      if (verb === 'start') {
        requireJob(ctx, prod.job);
        const pick = env.ui('production', () => ({ module: '', station: -1 }));
        const recipe = prod.recipes.find((r) => r.id === local.recipe);
        const stations = ctx.state.stations[scopeKey(ctx.building.id, prod.id)]!;
        local.recipe = '';
        if (!recipe || pick.module !== prod.id || !(pick.station >= 0) || stations[pick.station] !== null)
          throw new RuleError(`⚠️ ${prod.stationName} déjà utilisé(e). Recommence.`, w.backScreen);
        if (recipe.level > jobLevelFor(ctx, prod) || !feasible(ctx, prod, recipe))
          throw new RuleError('⚠️ Recette devenue indisponible : stocks ou niveau insuffisants.');
        for (const [it, q] of Object.entries(recipe.inputs)) applyAction(ctx, { type: 'item.take', item: it, qty: q, inventory: prod.inputInventory });
        stations[pick.station] = { recipe: recipe.id, by: ctx.playerId, startedAt: ctx.now, endsAt: ctx.now + recipe.durationSec * 1000 };
        questTag(ctx, `cook:${ctx.building.id}/${recipe.id}`);
        const xp = (recipe.xp ?? prod.xp).start;
        if (prod.job && xp) applyAction(ctx, { type: 'job.xp', job: prod.job, amount: xp });
        pick.station = -1;
        const job = prod.job ? findJob(ctx.world, prod.job)?.name : '';
        return { goto: w.backScreen, notice: `🔥 ${recipe.name} lancé !${xp && job ? ` +${xp} XP ${job.toLowerCase()}.` : ''}` };
      }
      return {};
    }

    case 'inventory.stock': {
      if (verb === 'view') env.ui(`stock:${env.screenId}`, () => ({ view: 0 })).view = Number(arg) || 0;
      return {};
    }

    case 'buyback.sell': {
      const buy = findModule(ctx.building, w.buyback, 'buyback');
      const sell = env.ui(`sell:${buy.id}`, () => ({ item: '', qty: 1 }));
      if (verb === 'item') {
        sell.item = value;
        sell.qty = 1;
        return {};
      }
      if (verb === 'qty') {
        sell.qty = Math.max(1, Number(arg) || 1);
        return {};
      }
      if (verb === 'sell') {
        const item = sell.item;
        const qty = sell.qty;
        if (!item || buy.prices[item] === undefined || (p.items[item] ?? 0) < qty)
          throw new RuleError('⚠️ Inventaire modifié : vente impossible.');
        const inv = inventoryOf(ctx, buy.inventory);
        const before = inv[item] ?? 0;
        const amount = buybackQuote(buy, item, before, qty, targetOf(ctx, buy.inventory, item));
        applyAction(ctx, { type: 'item.take', item, qty });
        applyAction(ctx, { type: 'item.give', item, qty, inventory: buy.inventory });
        applyAction(ctx, { type: 'stat.add', stat: buy.currency, amount });
        sell.item = '';
        sell.qty = 1;
        return {
          notice: `✅ **${itemName(ctx.world, item)} ×${qty} livré(s) !** +${money(ctx, buy.currency, amount)} · Stock ${before} → ${before + qty} · Bourse : ${money(ctx, buy.currency, p.stats[buy.currency] ?? 0)}.`,
        };
      }
      return {};
    }

    case 'dialogue': {
      const dlg = findModule(ctx.building, w.dialogue, 'dialogue');
      const st = env.local(() => ({ node: dlg.start, visits: {} as Record<string, number> }));
      const goNode = (id: Id) => {
        st.node = id;
        st.visits[id] = (st.visits[id] ?? 0) + 1;
        questTag(ctx, `dialogue:${ctx.building.id}/${id}`);
      };
      if (verb === 'exit') return { goto: w.exitScreen };
      if (verb === 'topics') {
        goNode(dlg.start);
        return {};
      }
      if (verb === 'choice') {
        const node = dlg.nodes.find((n) => n.id === st.node) ?? dlg.nodes.find((n) => n.id === dlg.start)!;
        const choice = node.choices[Number(arg)];
        if (!choice) throw new RuleError('Choix inconnu.');
        const v = evaluate(ctx, choice.when);
        if (!v.ok) throw new RuleError(`Ce choix n'est pas disponible (${v.reason}).`);
        if (choice.goto) goNode(choice.goto);
        if (choice.screen) return { goto: choice.screen };
      }
      return {};
    }

    case 'activity.board': {
      const mod = findModule(ctx.building, w.activity, 'activity');
      const a = mod.activities.find((x) => x.id === arg);
      if (!a) throw new RuleError('Activité inconnue (contenu modifié ?).');
      const key = activityKey(ctx, mod, a);
      if (verb === 'start') {
        if (p.activities[key]) throw new RuleError('⏳ Cette activité est déjà en cours.');
        const lock = activityLock(ctx, mod, a);
        if (lock) throw new RuleError(`🔒 ${lock.text}`);
        if (a.tool) applyAction(ctx, { type: 'tool.wear', item: a.tool.item, amount: a.tool.wear });
        for (const c of a.costs) applyAction(ctx, c);
        // Le hasard est tiré au lancement : relancer l'interface ne change pas le résultat.
        const results = rollResults(a, env.random);
        if (!a.durationSec) return { notice: claimActivity(ctx, mod, a, results) };
        p.activities[key] = { startedAt: ctx.now, endsAt: ctx.now + a.durationSec * 1000, results };
        return { notice: `${a.emoji ?? '⏳'} **${a.name}** lancé(e) : retour dans ${duration(a.durationSec)}.` };
      }
      if (verb === 'claim') {
        const pending = p.activities[key];
        if (!pending) throw new RuleError('Rien à récupérer.');
        if (ctx.now < pending.endsAt) throw new RuleError(`⏳ Encore ${mmss(pending.endsAt - ctx.now)}.`);
        return { notice: claimActivity(ctx, mod, a, pending.results) };
      }
      return {};
    }

    case 'objective.board': {
      const mod = findModule(ctx.building, w.objective, 'objective');
      const st = objectiveState(ctx, mod.id);
      const sel = env.ui(`objective:${mod.id}`, () => ({ item: '', qty: 1 }));
      if (verb === 'item') {
        sel.item = value;
        sel.qty = 1;
        return {};
      }
      if (verb === 'qty') {
        sel.qty = Math.max(1, Number(arg) || 1);
        return {};
      }
      if (verb === 'give') {
        if (st.completedAt) throw new RuleError('Cet objectif est déjà atteint.');
        const goal = mod.goals[sel.item];
        if (!goal) throw new RuleError('Choisis ce que tu apportes.');
        const remaining = goal - (st.progress[sel.item] ?? 0);
        const qty = Math.min(sel.qty, remaining, p.items[sel.item] ?? 0);
        if (qty <= 0) throw new RuleError(remaining <= 0 ? 'Cette ressource est déjà complète.' : 'Tu n’en as plus.');
        applyAction(ctx, { type: 'item.take', item: sel.item, qty });
        const r = contributeObjective(ctx, ctx.building.id, mod.id, sel.item, qty);
        let notice = `🤝 Merci ! ${qty} ${itemName(ctx.world, sel.item)} apporté(s).`;
        const unit = mod.unitRewards?.[sel.item];
        if (mod.currency && unit) notice += ` +${money(ctx, mod.currency, unit * qty)}.`;
        if (mod.xpPerUnit) notice += ` +${mod.xpPerUnit.amount * qty} ${findStat(ctx.world, mod.xpPerUnit.stat)?.name ?? ''}.`;
        sel.item = '';
        sel.qty = 1;
        if (r.completed) notice += `\n🎉 **Objectif atteint !** ${pickText(ctx, mod.onComplete?.announce)}`;
        return { notice };
      }
      return {};
    }

    case 'player.tools': {
      if (verb === 'repair' && w.repair) {
        const def = findItem(ctx.world, value);
        if (!def?.tool || (p.items[value] ?? 0) < 1) throw new RuleError('Outil introuvable.');
        const cost = (def.tool.maxDurability - (p.tools[value] ?? 0)) * w.repair.costPerPoint;
        if (cost > 0) applyAction(ctx, { type: 'stat.add', stat: w.repair.currency, amount: -cost });
        applyAction(ctx, { type: 'tool.repair', item: value });
        questTag(ctx, `repair:${value}`);
        questTag(ctx, 'repair');
        return { notice: `🔧 ${itemName(ctx.world, value)} réparé(e) comme neuf·ve. −${money(ctx, w.repair.currency, cost)}.` };
      }
      return {};
    }

    case 'dice': {
      const dice = findModule(ctx.building, w.dice, 'dice');
      const st = env.local(() => ({ me: [] as number[], them: [] as number[], rounds: 0 }));
      if (verb === 'roll') {
        // Tirage côté serveur, jamais réutilisé.
        const roll = () => Array.from({ length: dice.dice }, () => 1 + Math.floor(env.random() * dice.faces));
        st.me = roll();
        st.them = roll();
        st.rounds += 1;
        const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
        if (sum(st.me) > sum(st.them)) questTag(ctx, `dice:${ctx.building.id}/${dice.id}:win`);
      }
      return {};
    }

    case 'quest.board': {
      if (verb === 'accept') {
        const q = acceptQuest(ctx, arg);
        return { notice: `📜 Quête acceptée : **${q.name}** ${STARS[q.difficulty]}. Tu la retrouves dans « Mon inventaire », dans chaque bâtiment.` };
      }
      if (verb === 'abandon') {
        const q = abandonQuest(ctx);
        return { notice: q ? `Quête **${q.name}** abandonnée. Choisis-en une autre.` : 'Aucune quête en cours.' };
      }
      if (verb === 'reroll') {
        if (p.quest) throw new RuleError('Termine ou abandonne d’abord ta quête en cours.');
        rerollOffers(ctx);
        return { notice: '🎲 De nouvelles quêtes sont affichées.' };
      }
      return {};
    }

    case 'player.sheet': {
      if (verb === 'deliver') return { notice: questDeliver(ctx, arg) };
      return {};
    }

    default:
      break;
  }
  return {};
}

/** Libellé de bouton d'une offre pour d'éventuels usages externes. */
export const describeOffer = (ctx: Ctx, o: ShopOffer) => `${o.name} — ${effectsLine(ctx, o.effects)}`;
export type { BuybackModule };
