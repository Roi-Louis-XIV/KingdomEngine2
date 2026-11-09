/**
 * Diagnostic d'un monde : références cassées, doublons, écrans introuvables…
 * Utilisé par le Studio pour signaler les erreurs avant publication.
 */
import type { Action, Block, BuildingDef, Condition, Id, Text, WidgetDef, WorldDef } from './model.ts';

export interface Issue {
  level: 'error' | 'warning';
  /** Emplacement lisible : « Bâtiment taverne › écran cuisine › bloc 3 ». */
  where: string;
  message: string;
}

export function validateWorld(w: WorldDef): Issue[] {
  const issues: Issue[] = [];
  const err = (where: string, message: string) => issues.push({ level: 'error', where, message });
  const warn = (where: string, message: string) => issues.push({ level: 'warning', where, message });

  const ids = (list: { id: Id }[], label: string) => {
    const set = new Set<Id>();
    for (const x of list) {
      if (set.has(x.id)) err(label, `identifiant en double : ${x.id}`);
      set.add(x.id);
    }
    return set;
  };
  const stats = ids(w.stats, 'Statistiques');
  const items = ids(w.items, 'Objets');
  const mods = ids(w.modifiers, 'Bonus');
  const jobs = ids(w.jobs, 'Métiers');
  const vars = ids(w.variables, 'Variables');
  ids(w.buildings, 'Bâtiments');

  const checkItem = (where: string, id: Id) => items.has(id) || err(where, `objet inconnu : ${id}`);

  const checkCondition = (where: string, c: Condition | undefined, b?: BuildingDef): void => {
    if (!c) return;
    switch (c.type) {
      case 'all':
      case 'any':
        c.conditions.forEach((x) => checkCondition(where, x, b));
        break;
      case 'not':
        checkCondition(where, c.condition, b);
        break;
      case 'stat':
        if (!stats.has(c.stat)) err(where, `statistique inconnue : ${c.stat}`);
        break;
      case 'hasJob':
        if (c.job && !jobs.has(c.job)) err(where, `métier inconnu : ${c.job}`);
        break;
      case 'jobLevel':
        if (!jobs.has(c.job)) err(where, `métier inconnu : ${c.job}`);
        break;
      case 'variable': {
        const v = w.variables.find((x) => x.id === c.variable);
        if (!v) err(where, `variable inconnue : ${c.variable}`);
        else if (v.options && !v.options.some((o) => o.value === c.value)) warn(where, `valeur « ${c.value} » absente des options de ${v.id}`);
        break;
      }
      case 'item':
        checkItem(where, c.item);
        if (c.inventory && b && !b.modules.some((m) => m.id === c.inventory && m.type === 'inventory'))
          err(where, `inventaire inconnu : ${c.inventory}`);
        break;
      case 'modifierActive':
        if (c.modifier && !mods.has(c.modifier)) err(where, `bonus inconnu : ${c.modifier}`);
        break;
    }
  };

  const checkText = (where: string, t: Text | undefined, b?: BuildingDef) => {
    if (t && typeof t !== 'string') t.cases.forEach((c) => checkCondition(where, c.when, b));
  };

  const checkAction = (where: string, a: Action, b?: BuildingDef) => {
    switch (a.type) {
      case 'stat.add':
      case 'stat.set':
        if (!stats.has(a.stat)) err(where, `statistique inconnue : ${a.stat}`);
        break;
      case 'item.give':
      case 'item.take':
        checkItem(where, a.item);
        if (a.inventory && b && !b.modules.some((m) => m.id === a.inventory && m.type === 'inventory'))
          err(where, `inventaire inconnu : ${a.inventory}`);
        break;
      case 'job.join':
      case 'job.xp':
      case 'job.setLevel':
        if (!jobs.has(a.job)) err(where, `métier inconnu : ${a.job}`);
        break;
      case 'job.leave':
        if (a.job && !jobs.has(a.job)) err(where, `métier inconnu : ${a.job}`);
        break;
      case 'modifier.apply':
        if (!mods.has(a.modifier)) err(where, `bonus inconnu : ${a.modifier}`);
        break;
      case 'variable.set':
        if (!vars.has(a.variable)) err(where, `variable inconnue : ${a.variable}`);
        break;
    }
  };

  for (const it of w.items) it.consumable?.effects.forEach((a) => checkAction(`Objet ${it.id}`, a));

  for (const b of w.buildings) {
    const at = `Bâtiment ${b.id}`;
    const mid = ids(b.modules, `${at} › modules`);
    const sid = ids(b.screens, `${at} › écrans`);
    const modOf = (id: Id, type: string, where: string) => {
      const m = b.modules.find((x) => x.id === id);
      if (!m) err(where, `module inconnu : ${id}`);
      else if (m.type !== type) err(where, `${id} n'est pas un module ${type}`);
    };
    const screen = (id: Id | undefined, where: string) => {
      if (id && !sid.has(id)) err(where, `écran inconnu : ${id}`);
    };
    screen(b.homeScreen, `${at} › écran d'accueil`);
    void mid;

    for (const m of b.modules) {
      const where = `${at} › module ${m.id}`;
      switch (m.type) {
        case 'inventory':
          Object.keys(m.initial).forEach((i) => checkItem(where, i));
          Object.keys(m.targets).forEach((i) => checkItem(where, i));
          break;
        case 'shop':
          modOf(m.inventory, 'inventory', where);
          if (!stats.has(m.currency)) err(where, `monnaie inconnue : ${m.currency}`);
          for (const o of m.offers) {
            checkItem(`${where} › ${o.id}`, o.stockItem);
            if (o.takeaway) checkItem(`${where} › ${o.id}`, o.takeaway.item);
            o.effects.forEach((a) => checkAction(`${where} › ${o.id}`, a, b));
          }
          break;
        case 'buyback':
          modOf(m.inventory, 'inventory', where);
          Object.keys(m.prices).forEach((i) => checkItem(where, i));
          for (let i = 1; i < m.tiers.length; i++)
            if (m.tiers[i]!.maxRatio <= m.tiers[i - 1]!.maxRatio) err(where, 'les paliers doivent être croissants');
          break;
        case 'production':
          modOf(m.inputInventory, 'inventory', where);
          modOf(m.outputInventory, 'inventory', where);
          if (m.job && !jobs.has(m.job)) err(where, `métier inconnu : ${m.job}`);
          if (m.stationCount < 1) err(where, 'au moins un poste est nécessaire');
          for (const r of m.recipes) {
            Object.keys(r.inputs).forEach((i) => checkItem(`${where} › ${r.id}`, i));
            Object.keys(r.outputs).forEach((i) => checkItem(`${where} › ${r.id}`, i));
            if (r.durationSec <= 0) err(`${where} › ${r.id}`, 'durée nulle');
          }
          if (m.recipes.length > 25) warn(where, 'plus de 25 recettes : le menu Discord n’en affichera que 25');
          break;
        case 'dialogue': {
          const nodes = new Set(m.nodes.map((n) => n.id));
          if (!nodes.has(m.start)) err(where, `sujet de départ inconnu : ${m.start}`);
          checkText(where, m.narration, b);
          for (const n of m.nodes) {
            n.lines.forEach((t) => checkText(`${where} › ${n.id}`, t, b));
            if (n.choices.length > 15) warn(`${where} › ${n.id}`, 'beaucoup de choix : vérifier la limite de 40 composants');
            for (const c of n.choices) {
              if (c.goto && !nodes.has(c.goto)) err(`${where} › ${n.id}`, `sujet inconnu : ${c.goto}`);
              screen(c.screen, `${where} › ${n.id}`);
              checkCondition(`${where} › ${n.id}`, c.when, b);
            }
          }
          break;
        }
        case 'dice':
          if (m.dice < 1 || m.faces < 2) err(where, 'dés invalides');
          break;
      }
    }

    const checkWidget = (where: string, wd: WidgetDef) => {
      switch (wd.kind) {
        case 'player.status':
          wd.stats.forEach((s) => stats.has(s) || err(where, `statistique inconnue : ${s}`));
          break;
        case 'shop.catalog':
          modOf(wd.shop, 'shop', where);
          screen(wd.checkoutScreen, where);
          break;
        case 'shop.checkout':
          screen(wd.backScreen, where);
          break;
        case 'production.stations':
          modOf(wd.production, 'production', where);
          screen(wd.recipeScreen, where);
          break;
        case 'production.priorities':
          modOf(wd.production, 'production', where);
          break;
        case 'production.recipes':
          modOf(wd.production, 'production', where);
          screen(wd.backScreen, where);
          break;
        case 'inventory.stock':
          for (const v of wd.views) {
            modOf(v.inventory, 'inventory', where);
            if (v.buyback) modOf(v.buyback, 'buyback', where);
          }
          break;
        case 'buyback.sell':
          modOf(wd.buyback, 'buyback', where);
          break;
        case 'dialogue':
          modOf(wd.dialogue, 'dialogue', where);
          screen(wd.exitScreen, where);
          break;
        case 'dice':
          modOf(wd.dice, 'dice', where);
          break;
        case 'player.consumables':
          break;
      }
    };

    const walk = (blocks: Block[], where: string, nested: boolean) =>
      blocks.forEach((bl, i) => {
        const here = `${where} › bloc ${i + 1}`;
        checkCondition(here, bl.visibleIf, b);
        switch (bl.type) {
          case 'text':
            checkText(here, bl.text, b);
            break;
          case 'container':
            if (nested) err(here, 'un encadré ne peut pas contenir un autre encadré');
            walk(bl.children, here, true);
            break;
          case 'section':
            checkText(here, bl.text, b);
            checkButton(here, bl.button);
            break;
          case 'buttons':
            bl.buttons.forEach((bd, j) => checkButton(`${here} › bouton ${j + 1}`, bd));
            break;
          case 'widget':
            if (nested) err(here, 'un widget doit être placé au premier niveau de l’écran');
            checkWidget(here, bl.widget);
            break;
          default:
            break;
        }
      });
    const checkButton = (where: string, bd: { label: Text; visibleIf?: Condition; rule: import('./model.ts').Rule }) => {
      checkText(where, bd.label, b);
      checkCondition(where, bd.visibleIf, b);
      checkCondition(where, bd.rule.when, b);
      bd.rule.actions?.forEach((a) => checkAction(where, a, b));
      screen(bd.rule.onSuccess?.goto, where);
      screen(bd.rule.onFailure?.goto, where);
    };
    for (const s of b.screens) {
      const where = `${at} › écran ${s.id}`;
      if (s.guard) {
        checkCondition(where, s.guard.when, b);
        screen(s.guard.redirect, where);
      }
      walk(s.blocks, where, false);
    }
  }
  return issues;
}
