/** Phase 2 : outils et durabilité, activités temporisées, objectifs collectifs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, validateRendered, validateWorld } from '../src/index.ts';
import { Player, makeEngine, loadWorld, seeded } from './harness.ts';

const forest = (e: Engine, id = 'alice') => new Player(e, id, 'foret');
const join = (p: Player) => p.click('Devenir bûcheron');

test('le monde avec la Forêt reste valide', () => {
  assert.deepEqual(validateWorld(loadWorld()).filter((i) => i.level === 'error'), []);
});

test('métier : l’embauche remet une hache neuve ; activités verrouillées sans métier', () => {
  const { engine } = makeEngine();
  const p = forest(engine);
  assert.match(p.text, /🔒 N'exerce pas le métier Bûcheron/);
  assert.match(p.text, /Le chantier de l’Église ouvrira après la tempête/);
  join(p);
  assert.match(p.text, /bienvenue parmi les bûcherons/);
  assert.equal(p.state.items.hache, 1);
  assert.equal(p.state.tools.hache, 20);
  assert.match(p.text, /Hache de bûcheron\*\* 20\/20/);
  assert.ok(!p.buttons.includes('Devenir bûcheron'));
  assert.ok(p.buttons.includes('Démissionner'));
});

test('activité temporisée : coûts, usure, hasard figé au lancement, récupération, XP, recharge', () => {
  const { engine, clock } = makeEngine();
  const p = join(forest(engine));
  const energy = p.state.stats.energie!;
  // Le bouton « Lancer » de la première activité (Abattre).
  p.click('Lancer');
  assert.match(p.text, /Abattre un arbre\*\* lancé\(e\) : retour dans 30 s/);
  assert.equal(p.state.stats.energie, energy - 10);
  assert.equal(p.state.tools.hache, 18);
  const rolled = structuredClone(Object.values(p.state.activities)[0]!.results);
  assert.equal(rolled.length, 1);
  assert.match(p.text, /⏳ En cours/);
  assert.ok(engine.view(p.sessionId).wakeAt !== null);

  clock.advance(30);
  p.refresh();
  assert.deepEqual(Object.values(p.state.activities)[0]!.results, rolled, 'le résultat ne change pas en attendant');
  p.click('Récupérer');
  assert.match(p.text, /✅ \*\*🪓 Abattre un arbre\*\* : (Belle coupe|Arbre noueux|Trésor)/);
  assert.match(p.text, /\+15 XP Bûcheron/);
  assert.ok((p.state.items.buche ?? 0) >= 1);
  assert.deepEqual(p.state.activities, {});
  assert.match(p.text, /🔒 Disponible dans 00:15/, 'temps de recharge');
  clock.advance(15);
  p.refresh();
  assert.doesNotMatch(p.text, /Disponible dans/);
});

test('activité immédiate ouverte à tous', () => {
  const { engine } = makeEngine();
  const p = forest(engine);
  const lancer = p.message.components.flatMap((c: any) => (c.type === 'container' ? c.children : [])).filter((c: any) => c.type === 'section' && c.accessory.label === 'Lancer' && !c.accessory.disabled);
  assert.equal(lancer.length, 2, 'ramasser et cueillir sont ouverts, abattre est verrouillé');
  const r = engine.interact('alice', lancer[0].accessory.customId);
  assert.match(r.notice!, /Ramasser du bois mort\*\* : Quelques branches · \+1 🪵 Bûche/);
});

test('tirage pondéré : sur 200 coupes, la répartition suit les poids', () => {
  const world = loadWorld();
  let t = Date.UTC(2026, 0, 1);
  const engine = new Engine(world, undefined, { now: () => t, random: seeded(7), newId: (() => { let n = 0; return () => `s${++n}`; })() });
  engine.adminApply('a', undefined, [{ type: 'job.join', job: 'bucheron' }, { type: 'item.give', item: 'hache', qty: 1 }, { type: 'stat.set', stat: 'energie', value: 100 }]);
  const counts = { belle: 0, noueux: 0, tresor: 0 };
  const p = new Player(engine, 'a', 'foret');
  for (let i = 0; i < 200; i++) {
    engine.adminApply('a', undefined, [{ type: 'stat.set', stat: 'energie', value: 100 }, { type: 'tool.repair', item: 'hache' }].filter((x) => x.type !== 'tool.repair' || engine.player('a')!.tools.hache! < 20) as never);
    p.refresh();
    const r = engine.interact('a', p.button('Lancer').customId);
    t += 31_000;
    p.message = r.message!;
    p.refresh();
    const n = engine.interact('a', p.button('Récupérer').customId).notice!;
    if (n.includes('Belle coupe')) counts.belle++;
    else if (n.includes('noueux')) counts.noueux++;
    else counts.tresor++;
    t += 16_000;
  }
  assert.ok(counts.belle > 110 && counts.belle < 170, JSON.stringify(counts));
  assert.ok(counts.tresor < 25, JSON.stringify(counts));
});

test('bonus de récolte : le jus de pomme d’Edgar augmente le bois obtenu', () => {
  const { engine, clock } = makeEngine();
  const p = join(forest(engine));
  engine.adminApply('alice', undefined, [{ type: 'modifier.apply', modifier: 'bois', durationSec: 600 }]);
  // On force un résultat « Belle coupe » (3 bûches) pour mesurer le bonus.
  p.click('Lancer');
  const key = Object.keys(p.state.activities)[0]!;
  const snap = engine.snapshot();
  snap.players.alice!.activities[key]!.results = [0];
  const e2 = new Engine(engine.world, snap, { now: clock.now });
  clock.advance(30);
  const p2 = new Player(e2, 'alice', 'foret');
  p2.click('Récupérer');
  assert.match(p2.text, /\+3 🪵 Bûche.*🪓 bonus \+10 %/, 'arrondi : 3 × 1,10 = 3');
  assert.equal(p2.state.items.buche, 3);
});

test('durabilité : hache cassée → activité bloquée, réparation payante', () => {
  const { engine, clock } = makeEngine();
  const p = join(forest(engine));
  engine.adminApply('alice', undefined, [{ type: 'tool.wear', item: 'hache', amount: 20 }]);
  p.refresh();
  assert.match(p.text, /🔒 🪓 Hache de bûcheron cassé\(e\) : fais-le réparer/);
  assert.match(p.text, /💥 cassé/);
  const before = p.state.stats.ecus!;
  p.choose(/réparer/, 'hache');
  assert.match(p.text, /réparé\(e\) comme neuf·ve\. −20 écus/);
  assert.equal(p.state.stats.ecus, before - 20);
  assert.equal(p.state.tools.hache, 20);
  void clock;
});

test('objectif collectif : contributions de plusieurs joueurs, récompense, achèvement qui change le scénario', () => {
  const { engine } = makeEngine();
  engine.setVariable('phase', 'apres');
  const a = forest(engine, 'alice');
  const b = forest(engine, 'bob');
  engine.adminApply('alice', undefined, [{ type: 'item.give', item: 'buche', qty: 30 }]);
  engine.adminApply('bob', undefined, [{ type: 'item.give', item: 'buche', qty: 15 }]);
  a.refresh().click('Chantier');
  assert.match(a.text, /Avancement : 0 %/);
  a.choose(/apportes/, 'buche').click('×10');
  assert.ok(a.buttons.includes('Apporter ×10 · récompense 20 écus'), a.buttons.join(' | '));
  a.click(/Apporter ×10/);
  assert.match(a.text, /10 🪵 Bûche apporté\(s\)\. \+20 écus/);
  assert.match(a.text, /Bûche\*\* 10\/40/);

  b.refresh().click('Chantier').choose(/apportes/, 'buche').click('Tout (15)').click(/Apporter/);
  a.choose(/apportes/, 'buche').click(/Tout/).click(/Apporter/);
  assert.match(a.text, /Bûche\*\* 40\/40/);
  assert.equal(a.state.items.buche, 5, 'seules les 15 bûches manquantes sont prises');
  assert.match(a.text, /🏅 <@alice> \(25\) · <@bob> \(15\)/);
  assert.equal(engine.variables.phase, 'apres', 'pas encore terminé : il manque les légumes');

  a.choose(/apportes/, 'legumes').click(/Tout/).click(/Apporter/);
  assert.match(a.text, /🎉 \*\*Objectif atteint !\*\* L’Église est rebâtie/);
  assert.equal(engine.variables.phase, 'calme', 'l’achèvement ramène le calme');
  assert.ok(!a.hasSelect(/apportes/));
});

test('Forêt : tous les écrans respectent les limites Discord', () => {
  const { engine, clock } = makeEngine();
  engine.setVariable('phase', 'apres');
  const p = join(forest(engine));
  engine.adminApply('alice', undefined, [{ type: 'tool.wear', item: 'hache', amount: 5 }, { type: 'item.give', item: 'buche', qty: 3 }]);
  const check = (l: string) => assert.deepEqual(validateRendered(p.refresh().message), [], l);
  check('accueil');
  p.click('Lancer');
  check('en cours');
  clock.advance(31);
  check('prêt');
  p.click('Chantier').choose(/apportes/, 'buche');
  check('chantier');
});

test('ancien état sans champs de phase 2 : rechargé sans perte', () => {
  const { engine, world } = makeEngine();
  new Player(engine, 'alice');
  const old = engine.snapshot() as any;
  delete old.objectives;
  for (const p of Object.values(old.players) as any[]) {
    delete p.tools;
    delete p.cooldowns;
    delete p.activities;
  }
  const e2 = new Engine(world, old);
  const p = new Player(e2, 'alice', 'foret');
  assert.match(p.text, /Forêt du Royaume/);
  assert.deepEqual(e2.player('alice')!.tools, {});
});
