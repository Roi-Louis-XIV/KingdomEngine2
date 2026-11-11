/**
 * Diagnostic d'un monde : références cassées, doublons, écrans introuvables…
 * Utilisé par le Studio pour signaler les erreurs avant publication.
 */
import type { Action, Block, BuildingDef, Condition, Id, Text, WidgetDef, WorldDef } from './model.ts';
import { parseHHMM, parseLocalIso } from './clock.ts';

/** Actions qui ont un sens sans joueur (météo, événements). */
const WORLD_ACTIONS = new Set(['variable.set', 'variable.add', 'weather.set', 'players.each', 'objective.add', 'audio.play', 'announce']);
const worldAction = (a: Action): boolean => (a.type === 'if' ? [...a.then, ...(a.else ?? [])].every(worldAction) : WORLD_ACTIONS.has(a.type));

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
      case 'tool':
        if (!w.items.find((i) => i.id === c.item)?.tool) err(where, `${c.item} n’est pas un outil`);
        break;
      case 'compare':
        if (!vars.has(c.left)) err(where, `variable inconnue : ${c.left}`);
        if (!vars.has(c.right)) err(where, `variable inconnue : ${c.right}`);
        break;
      case 'objective':
        checkObjective(where, c.building, c.objective);
        break;
      case 'quest':
        if (!w.quests?.quests.some((q) => q.id === c.quest)) err(where, `quête inconnue : ${c.quest}`);
        break;
    }
  };

  function checkObjective(where: string, building: Id, objective: Id) {
    const bb = w.buildings.find((x) => x.id === building);
    if (!bb) err(where, `bâtiment inconnu : ${building}`);
    else if (!bb.modules.some((m) => m.id === objective && m.type === 'objective')) err(where, `objectif inconnu : ${building}/${objective}`);
  }

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
      case 'audio.play':
        if (!a.sound) err(where, 'son non défini');
        break;
      case 'tool.wear':
      case 'tool.repair':
        if (!w.items.find((i) => i.id === a.item)?.tool) err(where, `${a.item} n’est pas un outil`);
        break;
      case 'weather.set':
        if (!w.weather) err(where, 'aucune météo configurée dans ce monde');
        else if (!w.weather.states.some((s) => s.value === a.value)) err(where, `météo inconnue : ${a.value}`);
        break;
      case 'variable.add':
        if (!vars.has(a.variable)) err(where, `variable inconnue : ${a.variable}`);
        break;
      case 'if':
        checkCondition(where, a.when, b);
        a.then.forEach((x) => checkAction(where, x, b));
        a.else?.forEach((x) => checkAction(where, x, b));
        break;
      case 'players.each':
        a.actions.forEach((x) => checkAction(where, x, b));
        break;
      case 'quest.tag':
        if (!a.tag) err(where, 'repère de quête vide');
        break;
      case 'announce':
        checkText(where, a.text, b);
        break;
      case 'objective.add': {
        checkObjective(where, a.building, a.objective);
        const m = w.buildings.find((x) => x.id === a.building)?.modules.find((x) => x.id === a.objective);
        if (m?.type === 'objective' && !(a.item in m.goals)) err(where, `${a.item} ne fait pas partie de l’objectif ${a.objective}`);
        break;
      }
    }
  };

  for (const it of w.items) it.consumable?.effects.forEach((a) => checkAction(`Objet ${it.id}`, a));

  if (w.onboarding) {
    const ob = w.onboarding;
    if (!ob.title?.trim()) err('Serment', 'titre manquant');
    if (!ob.button?.trim()) err('Serment', 'texte du bouton manquant');
    if (!ob.roleName?.trim()) err('Serment', 'nom du rôle manquant');
    checkText('Serment', ob.text);
    checkText('Serment', ob.confirmation);
    ob.actions.forEach((a) => checkAction('Serment › dotation', a));
  }

  if (w.quests) {
    const qs = w.quests;
    if (!stats.has(qs.xpStat)) err('Quêtes', `statistique d’XP inconnue : ${qs.xpStat}`);
    if (!qs.levels.length) err('Quêtes', 'au moins un niveau est nécessaire');
    if (qs.offers < 1 || qs.offers > 5) err('Quêtes', 'le panneau propose de 1 à 5 quêtes');
    Object.values(qs.rewards ?? {}).forEach((list) => list?.forEach((a) => checkAction('Quêtes › récompenses', a)));
    ids(qs.quests, 'Quêtes');
    for (const q of qs.quests) {
      const where = `Quête ${q.id}`;
      if (![1, 2, 3].includes(q.difficulty)) err(where, 'difficulté de 1 à 3');
      if (!q.steps.length) err(where, 'au moins une étape');
      ids(q.steps, `${where} › étapes`);
      checkCondition(where, q.when);
      checkText(where, q.description);
      q.rewards.forEach((a) => checkAction(where, a));
      for (const st of q.steps) {
        if (st.kind === 'visit' && st.building && !w.buildings.some((x) => x.id === st.building)) err(where, `bâtiment inconnu : ${st.building}`);
        if (st.kind === 'deliver') {
          checkItem(where, st.item);
          if (!w.buildings.some((x) => x.id === st.building)) err(where, `bâtiment inconnu : ${st.building}`);
          if (st.qty < 1) err(where, 'quantité à livrer invalide');
        }
        if (st.kind === 'count' && (!st.tags.length || st.target < 1)) err(where, `étape ${st.id} : repère ou cible manquant`);
      }
    }
  }

  if (w.weather) {
    const where = 'Météo';
    const v = w.variables.find((x) => x.id === w.weather!.variable);
    if (!v) err(where, `variable inconnue : ${w.weather.variable}`);
    if (!w.weather.states.length) err(where, 'aucun temps défini');
    if (w.weather.states.every((s) => s.weight <= 0)) err(where, 'au moins un temps doit avoir un poids positif');
    for (const s of w.weather.states) {
      if (v?.options && !v.options.some((o) => o.value === s.value)) err(where, `« ${s.value} » n’est pas une valeur de la variable ${v.name}`);
      if (s.minMinutes < 1 || s.maxMinutes < s.minMinutes) err(where, `durées invalides pour « ${s.value} »`);
      checkText(where, s.announce);
    }
  }
  const evIds = ids(w.events ?? [], 'Événements');
  void evIds;
  for (const ev of w.events ?? []) {
    const where = `Événement ${ev.id}`;
    const sc = ev.schedule;
    if (sc.type === 'daily') {
      if (!parseHHMM(sc.at)) err(where, `heure invalide : « ${sc.at} » (format HH:MM)`);
      if (sc.days?.some((d) => d < 0 || d > 6)) err(where, 'jours invalides');
    }
    if (sc.type === 'interval' && !(sc.everyMinutes >= 1)) err(where, 'intervalle invalide');
    if (sc.type === 'once' && parseLocalIso(sc.at, w.settings.timezone) === null) err(where, `date invalide : « ${sc.at} »`);
    if (ev.durationMinutes < 0) err(where, 'durée négative');
    const all = [...ev.onStart, ...ev.onEnd, ...ev.steps.flatMap((s) => s.actions)];
    all.forEach((a) => checkAction(where, a));
    if (all.some((a) => !worldAction(a))) warn(where, 'certaines actions visent un joueur : sans joueur, elles seront ignorées');
    for (const s of ev.steps) {
      if (s.afterMinutes < 0) err(where, 'étape avec un délai négatif');
      if (ev.durationMinutes > 0 && s.afterMinutes >= ev.durationMinutes) warn(where, `l’étape à ${s.afterMinutes} min arrive après la fin de l’événement`);
      checkText(where, s.announce);
    }
    checkText(where, ev.announce?.start);
    checkText(where, ev.announce?.end);
  }

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
    const amb = b.audio?.ambience;
    if (amb && typeof amb !== 'string') amb.cases.forEach((c) => checkCondition(`${at} › audio`, c.when, b));
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
        case 'activity': {
          ids(m.activities, where);
          if (m.activities.length > 8) warn(where, 'plus de 8 activités : l’écran risque de dépasser la limite Discord');
          for (const a of m.activities) {
            const here = `${where} › ${a.id}`;
            checkCondition(here, a.when, b);
            a.costs.forEach((x) => checkAction(here, x, b));
            if (a.tool && !w.items.find((i) => i.id === a.tool!.item)?.tool) err(here, `${a.tool.item} n’est pas un outil`);
            if (a.job && !jobs.has(a.job.id)) err(here, `métier inconnu : ${a.job.id}`);
            if (!a.results.length || a.results.every((r) => r.weight <= 0)) err(here, 'au moins un résultat avec un poids positif');
            a.results.forEach((r) => r.actions.forEach((x) => checkAction(here, x, b)));
            a.boostedBy?.forEach((x) => mods.has(x) || err(here, `bonus inconnu : ${x}`));
            a.multipliers?.forEach((x) => {
              checkCondition(here, x.when, b);
              if (!(x.factor >= 0)) err(here, 'facteur de rendement invalide');
            });
            if (a.durationSec < 0 || a.cooldownSec < 0) err(here, 'durées négatives');
          }
          break;
        }
        case 'objective':
          Object.keys(m.goals).forEach((i) => checkItem(where, i));
          if (!Object.keys(m.goals).length) err(where, 'aucune ressource visée');
          if (m.currency && !stats.has(m.currency)) err(where, `monnaie inconnue : ${m.currency}`);
          checkText(where, m.description, b);
          m.onComplete?.actions.forEach((x) => checkAction(where, x, b));
          checkCondition(where, m.when, b);
          if (m.xpPerUnit && !stats.has(m.xpPerUnit.stat)) err(where, `statistique inconnue : ${m.xpPerUnit.stat}`);
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
        case 'activity.board':
          modOf(wd.activity, 'activity', where);
          break;
        case 'objective.board':
          modOf(wd.objective, 'objective', where);
          break;
        case 'player.tools':
          if (wd.repair && !stats.has(wd.repair.currency)) err(where, `monnaie inconnue : ${wd.repair.currency}`);
          break;
        case 'quest.board':
          if (!w.quests) err(where, 'aucune quête configurée dans ce monde');
          break;
        case 'player.sheet':
          wd.stats.forEach((s) => stats.has(s) || err(where, `statistique inconnue : ${s}`));
          break;
        case 'ranking':
          if (!stats.has(wd.stat)) err(where, `statistique inconnue : ${wd.stat}`);
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
