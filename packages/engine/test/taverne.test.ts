/**
 * Recette d'acceptation : la Taverne d'Edgar V11, reconstruite uniquement à partir
 * du fichier de contenu content/le-royaume/world.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, validateRendered, validateWorld, buybackQuote, countComponents } from '../src/index.ts';
import { Player, makeEngine, loadWorld, seeded } from './harness.ts';

const hire = (p: Player) => {
  p.click('Devenir cuisinier').click('Accepter le métier');
  return p;
};
const inv = (e: Engine, key: string) => e.snapshot().inventories[`taverne/${key}`]!;

test('le monde de démonstration est valide', () => {
  const issues = validateWorld(loadWorld());
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
});

test('le validateur signale les références cassées', () => {
  const w = loadWorld();
  const b = w.buildings[0]!;
  const prod = b.modules.find((m) => m.type === 'production')!;
  if (prod.type === 'production') prod.recipes[0]!.inputs['licorne'] = 1;
  b.screens[0]!.blocks.push({ type: 'buttons', buttons: [{ label: 'X', rule: { onSuccess: { goto: 'nulle-part' } } }] });
  const msgs = validateWorld(w).map((i) => i.message);
  assert.ok(msgs.includes('objet inconnu : licorne'));
  assert.ok(msgs.includes('écran inconnu : nulle-part'));
});

test('accueil : activités, bourse et section métier selon la situation', () => {
  const { engine } = makeEngine();
  const p = new Player(engine, 'alice');
  assert.match(p.text, /À LA GUEUSE COCUE/);
  assert.match(p.text, /Votre bourse :\*\* 100 écus/);
  assert.match(p.text, /Aucun métier actif · 🟢 3 marmite\(s\) libre\(s\)/);
  assert.ok(p.buttons.includes('Devenir cuisinier'));
  assert.ok(!p.buttons.includes('📜 Démissionner'));
});

test('métier : embauche, métier unique, autre métier bloquant', () => {
  const { engine } = makeEngine();
  const p = hire(new Player(engine, 'alice'));
  assert.equal(p.screen, 'cuisine');
  assert.match(p.text, /Bienvenue aux fourneaux/);
  assert.deepEqual(p.state.activeJobs, ['cuisinier']);

  const m = new Player(engine, 'bob');
  engine.adminApply('bob', 'taverne', [{ type: 'job.join', job: 'mineur' }]);
  m.refresh();
  assert.match(m.text, /Métier actuel : Mineur\. Un seul métier autorisé/);
  assert.ok(m.buttons.includes('Métier occupé'));
});

test('cuisine : cuisson atomique, minuteur, XP 80/20 et récupération par un autre cuisinier', () => {
  const { engine, clock } = makeEngine();
  const a = hire(new Player(engine, 'alice'));
  const b = hire(new Player(engine, 'bob'));

  a.click('Cuisiner'); // marmite 1
  assert.equal(a.screen, 'recettes');
  const opts = a.options(/recette réalisable/).map((o) => o.value);
  assert.deepEqual(opts, ['soupe'], 'niveau 1 : seule la soupe est débloquée');
  a.choose(/recette réalisable/, 'soupe').click('Lancer la production');
  assert.equal(a.screen, 'cuisine');
  assert.match(a.text, /Soupe paysanne lancé ! \+80 XP cuisinier/);
  assert.equal(inv(engine, 'reserve').legumes, 9);
  assert.equal(inv(engine, 'reserve').eau, 7);
  assert.equal(a.state.jobs.cuisinier!.xp, 80);
  assert.match(a.text, /⏳ \*\*01:00\*\*/);
  assert.ok(engine.view(a.sessionId).wakeAt !== null, 'un minuteur demande un rafraîchissement');

  b.refresh();
  b.click('Détails');
  assert.match(b.text, /📋 Détails/);
  assert.match(b.text, /80 au lancement · 20 à la récupération/);

  clock.advance(61);
  b.refresh().click('Récupérer');
  assert.match(b.text, /Soupe paysanne récupéré ! \+20 XP cuisinier\. Lancé par <@alice>/);
  assert.equal(b.state.jobs.cuisinier!.xp, 20);
  assert.equal(inv(engine, 'plats').plat_soupe, 3);
  assert.equal(engine.snapshot().stations['taverne/cuisine']![0], null);
});

test('progression : 100 XP = niveau 2, nouvelles recettes débloquées', () => {
  const { engine, clock } = makeEngine();
  const a = hire(new Player(engine, 'alice'));
  a.click('Cuisiner').choose(/recette réalisable/, 'soupe').click('Lancer la production');
  clock.advance(60);
  a.refresh().click('Récupérer');
  assert.equal(a.state.jobs.cuisinier!.level, 2);
  assert.match(a.text, /Cuisinier niveau 2\*\* · 100 XP/);
  a.click('Cuisiner');
  const opts = a.options(/recette réalisable/).map((o) => o.value);
  assert.ok(opts.includes('ragout'));
  assert.ok(!opts.includes('pain'), 'pain débloqué mais farine insuffisante (2/3)');
  assert.match(a.text, /❌ Farine 2\/3/);
});

test('démission : progression conservée, accès retiré, cuisson poursuivie', () => {
  const { engine, clock } = makeEngine();
  const a = hire(new Player(engine, 'alice'));
  a.click('Cuisiner').choose(/recette réalisable/, 'soupe').click('Lancer la production');
  a.click('Retour').click('📜 Démissionner').click('Confirmer la démission');
  assert.match(a.text, /Démission enregistrée/);
  assert.deepEqual(a.state.activeJobs, []);
  assert.equal(a.state.jobs.cuisinier!.xp, 80, 'XP conservée');

  // Retour au métier : niveau et XP retrouvés.
  a.click('Devenir cuisinier');
  assert.match(a.text, /Niveau retrouvé :\*\* 1 · \*\*XP conservée :\*\* 80/);
  a.click('Annuler');

  const b = hire(new Player(engine, 'bob'));
  clock.advance(60);
  b.refresh().click('Récupérer');
  assert.match(b.text, /Lancé par <@alice>/);
});

test('garde d’accès : un non-cuisinier est renvoyé à l’accueil, même avec un ancien bouton', () => {
  const { engine } = makeEngine();
  const a = hire(new Player(engine, 'alice'));
  const stale = a.button('Cuisiner').customId;
  engine.adminApply('alice', 'taverne', [{ type: 'job.leave' }]);
  a.refresh();
  assert.equal(a.screen, 'accueil');
  assert.match(a.text, /Seuls les cuisiniers actifs/);
  const r = engine.interact('alice', stale);
  assert.ok(r.ok);
  assert.equal(a.refresh().screen, 'accueil');
  assert.deepEqual(engine.snapshot().stations['taverne/cuisine'], [null, null, null]);
});

test('concurrence : deux cuisiniers visent la même marmite, un seul réussit', () => {
  const { engine } = makeEngine();
  const a = hire(new Player(engine, 'alice'));
  const b = hire(new Player(engine, 'bob'));
  a.click('Cuisiner').choose(/recette réalisable/, 'soupe');
  b.click('Cuisiner').choose(/recette réalisable/, 'soupe');
  a.click('Lancer la production');
  const before = structuredClone(inv(engine, 'reserve'));
  b.click('Lancer la production');
  assert.match(b.text, /déjà utilisé\(e\)\. Recommence/);
  assert.equal(b.screen, 'cuisine');
  assert.deepEqual(inv(engine, 'reserve'), before, 'aucun ingrédient prélevé');
  assert.equal(b.state.jobs.cuisinier!.xp, 0);
});

test('comptoir : achat sur place avec effets avant → après', () => {
  const { engine } = makeEngine();
  const p = new Player(engine, 'alice');
  p.click('Boissons');
  assert.match(p.text, /Chope de bière\*\* — 8 écus · 🎒 \+1 écus/);
  assert.match(p.text, /⚡ \+5 énergie · 🍺 \+10 alcoolémie/);
  p.choose(/Choisir un article/, 'biere');
  assert.equal(p.screen, 'commande');
  p.click('🍽️ Sur place · 8 écus').click('Confirmer l’achat');
  assert.equal(p.screen, 'boissons');
  assert.match(p.text, /Chope de bière consommé ! ⚡ Énergie \*\*70 → 75\/100\*\* · 🍺 Alcoolémie \*\*0 → 10\/100\*\*/);
  assert.match(p.text, /−8 écus · Solde : 92 écus/);
  assert.equal(inv(engine, 'reserve').biere, 5);
});

test('à emporter : objet reçu, consommé plus tard, bonus temporaire exclusif', () => {
  const { engine, clock } = makeEngine();
  const p = new Player(engine, 'alice');
  p.click('Boissons').choose(/Choisir un article/, 'jus').click(/À emporter/).click('Confirmer l’achat');
  assert.match(p.text, /Bouteille de jus ajouté à ton inventaire\. −7 écus/);
  assert.equal(p.state.items.bouteille_jus, 1);
  assert.equal(p.state.stats.energie, 70, 'pas d’effet avant consommation');

  p.click('🎒 Inventaire').choose(/consommer/, 'bouteille_jus').click('Consommer cet objet');
  assert.match(p.text, /Énergie \*\*70 → 80\/100\*\*/);
  assert.match(p.text, /Récolte de bois \+10 %\*\* activé pour 10 min/);
  assert.match(p.text, /Bonus actif :\*\* 🪓 Récolte de bois \+10 % · 10 min 00 s restantes/);

  // Le vin remplace le bonus (même groupe exclusif).
  p.click('Retour à la Taverne').click('Boissons').choose(/Choisir un article/, 'vin').click(/Sur place/).click('Confirmer l’achat');
  assert.match(p.text, /bonus précédent remplacé/);
  assert.deepEqual(p.state.modifiers.map((m) => m.id), ['xp']);

  clock.advance(11 * 60);
  p.refresh();
  assert.match(p.text, /Bonus actif :\*\* Aucun/);
});

test('achat refusé : bourse insuffisante, rien ne change', () => {
  const { engine } = makeEngine();
  const p = new Player(engine, 'alice');
  engine.adminApply('alice', 'taverne', [{ type: 'stat.set', stat: 'ecus', value: 5 }]);
  const before = structuredClone(engine.snapshot());
  p.click('Boissons').choose(/Choisir un article/, 'hydromel').click(/Sur place/).click('Confirmer l’achat');
  assert.match(p.text, /Bourse insuffisant\(e\) : il manque 7/);
  const after = engine.snapshot();
  assert.deepEqual(after.players.alice!.stats, before.players.alice!.stats);
  assert.deepEqual(after.inventories, before.inventories);
});

test('repas : la carte se remplit grâce aux cuisiniers ; plats sur place uniquement', () => {
  const { engine, clock } = makeEngine();
  const p = new Player(engine, 'alice');
  p.click('Repas');
  assert.ok(!p.hasSelect(/Choisir un article/), 'aucun plat disponible au départ');
  assert.match(p.text, /Festin du Royaume\*\* — 18 écus · sur place uniquement/);

  const chef = hire(new Player(engine, 'chef'));
  chef.click('Cuisiner').choose(/recette réalisable/, 'soupe').click('Lancer la production');
  clock.advance(60);
  chef.refresh().click('Récupérer');

  p.refresh().choose(/Choisir un article/, 'soupe').click(/Sur place/).click('Confirmer l’achat');
  assert.match(p.text, /Énergie \*\*70 → 100\/100\*\*/, 'énergie plafonnée à 100');
  assert.match(p.text, /Coût énergétique −10 %/);
  assert.equal(inv(engine, 'plats').plat_soupe, 2);
});

test('filtres du catalogue par catégorie et par bonus', () => {
  const { engine } = makeEngine();
  const p = new Player(engine, 'alice');
  p.click('Boissons').choose(/catégorie/, 'Sans alcool');
  assert.deepEqual(p.options(/Choisir un article/).map((o) => o.value), ['eau', 'jus']);
  p.choose(/bonus/, 'xp');
  assert.match(p.text, /Aucun article pour ces filtres/);
  p.choose(/catégorie/, 'Toutes');
  assert.deepEqual(p.options(/Choisir un article/).map((o) => o.value), ['vin']);
});

test('rachat dynamique : chaque unité est tarifée selon la réserve à son entrée', () => {
  const { engine, world } = makeEngine();
  const buy = world.buildings[0]!.modules.find((m) => m.type === 'buyback')!;
  assert.equal(buy.type, 'buyback');
  if (buy.type !== 'buyback') return;
  // Épices : réserve 0, objectif 15, base 8 → 12 (rupture), puis 10, 10.
  assert.equal(buybackQuote(buy, 'epices', 0, 3, 15), 12 + 10 + 10);

  const p = new Player(engine, 'alice');
  p.click('Stocks');
  assert.match(p.text, /Épices\*\* — 0 en stock \/ objectif 15\n💰 Rachat actuel : \*\*12 écus\/u/);
  p.click('💰 Vendre mes ressources').choose(/ressource/, 'epices').click('×1');
  assert.match(p.text, /Tu recevras : 12 écus/);
  p.choose(/ressource/, 'epices');
  // ×5 indisponible : seulement 3 épices en poche.
  assert.ok(!p.buttons.includes('×5'));
  const r = engine.interact('alice', p.button('Confirmer la vente').customId);
  p.message = r.message!;
  assert.match(p.text, /Épices ×1 livré\(s\) !\*\* \+12 écus · Stock 0 → 1 · Bourse : 112 écus/);
  assert.equal(p.state.items.epices, 2);
});

test('stocks : regroupement par urgence et onglets', () => {
  const { engine } = makeEngine();
  const p = new Player(engine, 'alice');
  p.click('Stocks');
  assert.match(p.text, /🔴 Prioritaires/);
  assert.match(p.text, /🟠 Réserves faibles/);
  assert.doesNotMatch(p.text, /🟢 Réserves suffisantes/, "aucune réserve au-dessus de 50 % au départ");
  p.click('🍗 Plats préparés');
  assert.match(p.text, /Soupe paysanne\*\* — 0 en stock \/ objectif 12/);
});

test('dialogues : sujets, répliques selon la phase, le métier et rotation', () => {
  const { engine } = makeEngine();
  const p = new Player(engine, 'alice');
  p.click('Parler à Edgar');
  assert.match(p.text, /qu’est-ce qui t’amène/);
  p.click('📰 Les nouvelles');
  assert.match(p.text, /le ciel va tourner/);
  assert.ok(p.buttons.includes('← Sujets'));

  p.click('Retour').click('Tempête');
  assert.equal(engine.variables.phase, 'tempete');
  assert.match(p.text, /Ce vent va emporter mon enseigne/);
  p.click('Parler à Edgar');
  assert.equal(p.screen, 'dialogue');
  assert.match(p.text, /qu’est-ce qui t’amène/, 'la discussion repart du début');
  p.click('📰 Les nouvelles');
  assert.match(p.text, /Ferme la porte/);
  assert.match(p.text, /Ambiance :\*\* 🌩️ Tempête/);

  p.click('← Sujets').click('🧑‍🍳 Le travail');
  assert.match(p.text, /Il me faut des cuisiniers/);
  engine.adminApply('alice', 'taverne', [{ type: 'job.join', job: 'cuisinier' }]);
  p.click('← Sujets').click('🧑‍🍳 Le travail');
  assert.match(p.text, /Ah, mon cuisinier ! Niveau 1/);

  p.click('← Sujets').click('🍺 Edgar lui-même');
  assert.match(p.text, /tant de chopes/);
  p.click('← Sujets').click('🍺 Edgar lui-même');
  assert.match(p.text, /Celle que tu paies/);
});

test('dés : tirage serveur, manches comptées, depuis le dialogue', () => {
  const { engine } = makeEngine();
  const p = new Player(engine, 'alice');
  p.click('Parler à Edgar').click('🎲 Jouer aux dés');
  assert.equal(p.screen, 'des');
  p.click('🎲 Lancer les dés');
  assert.match(p.text, /Résultat de la manche 1/);
  assert.match(p.text, /🎲 \*\*Toi :\*\* \d \+ \d = \*\*\d+\*\*/);
  assert.match(p.text, /Tu as gagné|Edgar gagne|Égalité/);
  p.click('🔄 Rejouer');
  assert.match(p.text, /Résultat de la manche 2/);
});

test('interface personnelle : un autre joueur ne peut pas cliquer', () => {
  const { engine } = makeEngine();
  const a = new Player(engine, 'alice');
  const r = engine.interact('mallory', a.button('Boissons').customId);
  assert.equal(r.ok, false);
  assert.match(r.private!, /appartient à un autre joueur/);
});

test('redémarrage : l’état se recharge et les anciens boutons fonctionnent', () => {
  const { engine, clock, world } = makeEngine();
  const a = hire(new Player(engine, 'alice'));
  a.click('Cuisiner').choose(/recette réalisable/, 'soupe').click('Lancer la production');
  const oldButton = a.button('Détails').customId;
  const saved = JSON.parse(JSON.stringify(engine.snapshot()));

  const reborn = new Engine(world, saved, { now: clock.now, random: seeded() });
  const r = reborn.interact('alice', oldButton);
  assert.ok(r.ok);
  assert.equal(reborn.player('alice')!.jobs.cuisinier!.xp, 80);
  assert.equal(reborn.snapshot().stations['taverne/cuisine']![0]!.recipe, 'soupe');
});

test('ajouter une marmite dans le contenu ne perd aucune progression', () => {
  const { engine, world } = makeEngine();
  hire(new Player(engine, 'alice'));
  const saved = engine.snapshot();
  const w2 = structuredClone(world);
  const prod = w2.buildings[0]!.modules.find((m) => m.type === 'production')!;
  if (prod.type === 'production') prod.stationCount = 4;
  const e2 = new Engine(w2, saved);
  assert.equal(e2.snapshot().stations['taverne/cuisine']!.length, 4);
  assert.deepEqual(e2.player('alice')!.activeJobs, ['cuisinier']);
});

test('tous les écrans respectent les limites Discord Components V2', () => {
  const { engine, clock } = makeEngine();
  const a = hire(new Player(engine, 'alice'));
  engine.adminApply('alice', 'taverne', [
    { type: 'job.setLevel', job: 'cuisinier', level: 5 },
    { type: 'item.give', item: 'viande', qty: 30, inventory: 'reserve' },
    { type: 'item.give', item: 'epices', qty: 10, inventory: 'reserve' },
    { type: 'item.give', item: 'bouteille_vin', qty: 2 },
    { type: 'item.give', item: 'gamelle_soupe', qty: 1 },
  ]);
  const check = (label: string) => {
    const issues = validateRendered(a.message);
    assert.deepEqual(issues, [], `${label} (${a.screen}) : ${issues.join(', ')}`);
    assert.ok(countComponents(a.message) <= 40);
  };
  a.refresh();
  check('cuisine vide');
  for (let i = 0; i < 3; i++) {
    a.click('Cuisiner');
    check('recettes');
    a.choose(/recette réalisable/, ['soupe', 'ragout', 'festin'][i]!);
    check('recette choisie');
    a.click('Lancer la production');
  }
  a.click('Détails');
  check('cuisine pleine + détails');
  clock.advance(200);
  a.refresh();
  check('cuisine prête');
  const screens: [string, () => void][] = [
    ['accueil', () => a.click('Retour')],
    ['boissons', () => a.click('Boissons')],
    ['commande', () => a.choose(/Choisir un article/, 'vin')],
    ['mode', () => a.click(/À emporter/)],
    ['repas', () => a.click('Annuler').click('Retour').click('Repas')],
    ['inventaire', () => a.click('🎒 Inventaire').choose(/consommer/, 'bouteille_vin')],
    ['stocks', () => a.click('Retour à la Taverne').click('Stocks')],
    ['vente', () => a.click('💰 Vendre mes ressources').choose(/ressource/, 'viande')],
    ['dialogue', () => a.click('Retour').click('Parler à Edgar').click('📰 Les nouvelles')],
    ['dés', () => a.click('← Sujets').click('🎲 Jouer aux dés').click('🎲 Lancer les dés')],
    ['démission', () => a.click('← Accueil').click('📜 Démissionner')],
  ];
  for (const [label, go] of screens) {
    go();
    check(label);
  }
});
