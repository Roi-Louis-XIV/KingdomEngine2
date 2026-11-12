/** Combat au tour par tour : chasse aux créatures (santé du joueur) et duels entre joueurs présents. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, strike, validateRendered, validateWorld, type WorldDef } from '../src/index.ts';
import { Clock, Player } from './harness.ts';

const world = (): WorldDef => ({
  format: 'kingdom-world@1',
  id: 'arene',
  name: 'Arène',
  settings: { maxActiveJobs: 1 },
  stats: [
    { id: 'sante', name: 'Santé', emoji: '❤️', min: 0, max: 50, initial: 50, kind: 'gauge' },
    { id: 'ecus', name: 'Bourse', emoji: '💰', min: 0, initial: 20, kind: 'currency', unit: 'écus' },
    { id: 'gloire', name: 'Gloire', emoji: '🏅', min: 0, initial: 0, kind: 'value' },
  ],
  items: [
    { id: 'epee', name: 'Épée', emoji: '🗡️', equipment: { slot: 'arme', attack: 6 } },
    { id: 'potion', name: 'Potion', emoji: '🧪', consumable: { effects: [{ type: 'stat.add', stat: 'sante', amount: 20 }] } },
    { id: 'croc', name: 'Croc', emoji: '🦷' },
  ],
  modifiers: [],
  jobs: [],
  variables: [{ id: 'nuit', name: 'Nuit', options: [{ value: 'non', label: 'Non' }, { value: 'oui', label: 'Oui' }], initial: 'non' }],
  creatures: [
    { id: 'rat', name: 'Rat', emoji: '🐀', hp: 6, attack: 2, defense: 0, rewards: [{ type: 'stat.add', stat: 'ecus', amount: 5 }], loot: [{ item: 'croc', qty: 1, chance: 1 }] },
    { id: 'ogre', name: 'Ogre', emoji: '👹', hp: 500, attack: 40, defense: 0, rewards: [] },
  ],
  buildings: [
    {
      id: 'cave',
      name: 'Cave',
      homeScreen: 'accueil',
      modules: [
        {
          type: 'combat',
          id: 'arene',
          name: 'Arène',
          health: 'sante',
          base: { attack: 4, defense: 1, dodge: 0 },
          encounters: [
            { creature: 'rat', weight: 1, when: { type: 'variable', variable: 'nuit', op: 'eq', value: 'non' } },
            { creature: 'ogre', weight: 1, when: { type: 'variable', variable: 'nuit', op: 'eq', value: 'oui' } },
          ],
          cooldownSec: 30,
          fleeChance: 0,
          defeat: { health: 10, actions: [{ type: 'stat.add', stat: 'ecus', amount: -50 }] },
          heal: { currency: 'ecus', costPerPoint: 1 },
          duels: { hp: 20, rewards: [{ type: 'stat.add', stat: 'gloire', amount: 10 }], turnSec: 60 },
        },
      ],
      screens: [{ id: 'accueil', name: 'Accueil', blocks: [{ type: 'notice' }, { type: 'widget', widget: { kind: 'combat.arena', combat: 'arene' } }] }],
    },
  ],
} as unknown as WorldDef);

const setup = (random: () => number = () => 0.5) => {
  const clock = new Clock();
  let n = 0;
  const engine = new Engine(world(), undefined, { now: clock.now, random, newId: () => `s${++n}` });
  return { engine, clock };
};

test('le monde de test et ses écrans de combat sont valides', () => {
  assert.deepEqual(validateWorld(world()).filter((i) => i.level === 'error'), []);
  const bad = world();
  (bad.buildings[0]!.modules[0] as { encounters: { creature: string; weight: number }[] }).encounters.push({ creature: 'dragon', weight: 1 });
  assert.ok(validateWorld(bad).some((i) => /créature inconnue : dragon/.test(i.message)));
});

test('coup : esquive, dégâts réduits par la défense et la garde, au moins 1', () => {
  const r = (x: number) => () => x;
  assert.deepEqual(strike(r(0.5), { attack: 10, defense: 0, dodge: 0 }, { attack: 0, defense: 4, dodge: 0 }), { damage: 8, dodged: false, crit: false });
  assert.equal(strike(r(0.5), { attack: 10, defense: 0, dodge: 0 }, { attack: 0, defense: 4, dodge: 0 }, true).damage, 3);
  assert.equal(strike(r(0.5), { attack: 1, defense: 0, dodge: 0 }, { attack: 0, defense: 40, dodge: 0 }).damage, 1);
  assert.equal(strike(r(0.1), { attack: 10, defense: 0, dodge: 0 }, { attack: 0, defense: 0, dodge: 0.5 }).dodged, true);
});

test('chasse : victoire, récompenses, butin, repère de quête, recharge', () => {
  const { engine, clock } = setup();
  const p = new Player(engine, 'alice', 'cave', 'Alice');
  assert.match(p.text, /Rôdent ici :\* 🐀 Rat/);
  p.click('🔎 Chercher un adversaire');
  assert.match(p.text, /Combat — 🐀 Rat/);
  assert.ok(p.state.fight);
  // Attaque 4 contre défense 0 : 4 par coup ; le rat (2 d'attaque, défense joueur 1) inflige 2.
  p.click('⚔️ Attaquer');
  assert.equal(p.state.fight!.hp, 2);
  assert.equal(p.state.stats.sante, 48);
  p.click('⚔️ Attaquer');
  assert.equal(p.state.fight, undefined);
  assert.match(p.text, /Victoire contre 🐀 Rat/);
  assert.match(p.text, /Butin : 🦷 Croc ×1/);
  assert.equal(p.state.stats.ecus, 25);
  assert.equal(p.state.items.croc, 1);
  assert.equal(p.state.stats.sante, 48, 'la santé reste entamée');
  p.click('🔎 Chercher un adversaire');
  assert.match(p.text, /Reprends ton souffle/);
  clock.advance(31);
  p.refresh().click('🔎 Chercher un adversaire');
  assert.ok(p.state.fight);
  for (const m of [p.message]) assert.deepEqual(validateRendered(m), []);
});

test('équipement, objet de soin pendant le combat, soins payants', () => {
  const { engine } = setup();
  new Player(engine, 'alice', 'cave');
  const st = engine.snapshot();
  st.players.alice!.items = { epee: 1, potion: 1 };
  st.players.alice!.stats.sante = 20;
  const e2 = new Engine(world(), st, { now: new Clock().now, random: () => 0.5, newId: () => 'x' + Math.random() });
  const q = new Player(e2, 'alice', 'cave');
  assert.match(q.text, /⚔️ 10 · 🛡️ 1/, 'attaque de base + épée');
  assert.match(q.button(/Se faire soigner/).label, /30 écus/);
  q.click('🔎 Chercher un adversaire');
  q.choose(/Utiliser un objet/, 'potion');
  assert.equal(q.state.items.potion ?? 0, 0);
  assert.equal(q.state.stats.sante, 38, '+20 puis −2');
  q.click('⚔️ Attaquer');
  assert.match(q.text, /Victoire/);
  q.click(/Se faire soigner/);
  assert.equal(q.state.stats.sante, 50);
  assert.equal(q.state.stats.ecus, 20 + 5 - 12);
});

test('défaite : la santé remonte au minimum prévu, la perte impossible est ignorée', () => {
  const { engine } = setup();
  engine.setVariable('nuit', 'oui');
  const p = new Player(engine, 'alice', 'cave');
  p.click('🔎 Chercher un adversaire');
  assert.match(p.text, /Ogre/);
  p.click('🛡️ Se défendre'); // 40 → garde : 16 (×0,4) ; 50 − 16 = 34
  assert.equal(p.state.stats.sante, 34);
  p.click('🏃 Fuir'); // fuite impossible (0 %) : 40 − 0,5 = 40 → 34 − 40 < 0
  assert.equal(p.state.fight, undefined);
  assert.match(p.text, /t’a mis à terre/);
  assert.equal(p.state.stats.sante, 10);
  assert.equal(p.state.stats.ecus, 20, 'pas assez pour perdre 50 : rien n’est retiré');
});

test('duel : défi entre joueurs présents, tours alternés, garde, victoire et gloire', () => {
  const { engine } = setup();
  const a = new Player(engine, 'alice', 'cave', 'Alice');
  const b = new Player(engine, 'bob', 'cave', 'Bob');
  a.refresh();
  assert.deepEqual(a.options(/Défier un joueur/).map((o) => o.label), ['Bob']);
  a.choose(/Défier un joueur/, 'bob');
  assert.match(a.text, /Défi lancé à \*\*Bob\*\*/);
  b.refresh();
  assert.match(b.text, /\*\*Alice\*\* te défie en duel/);
  b.click('✅ Accepter');
  assert.match(b.text, /À toi de jouer/);
  a.refresh();
  assert.match(a.text, /Au tour de Bob/);
  assert.ok(!a.buttons.includes('⚔️ Attaquer'));
  a.click('🏳️ Abandonner');
  b.refresh();
  assert.equal(engine.player('bob')!.stats.gloire, 10);
  assert.match(b.text, /\*\*Bob\*\* remporte le duel contre \*\*Alice\*\* \(abandon\)/);

  // Second duel jusqu'au bout : 4 d'attaque contre 1 de défense = 4 (3,5 arrondi) par coup, 20 PV.
  b.choose(/Défier un joueur/, 'alice');
  a.refresh().click('✅ Accepter');
  for (let i = 0; i < 12 && engine.snapshot().duels && Object.keys(engine.snapshot().duels!).length; i++) {
    const turn = Object.values(engine.snapshot().duels!)[0]!.turn;
    (turn === 'alice' ? a : b).refresh().click('⚔️ Attaquer');
  }
  assert.equal(engine.player('alice')!.stats.gloire, 10, 'Alice frappe en premier et gagne');
  assert.deepEqual(validateRendered(a.refresh().message), []);
});

test('duel : un défi sans réponse expire, un tour non joué fait perdre', () => {
  const { engine, clock } = setup();
  const a = new Player(engine, 'alice', 'cave', 'Alice');
  const b = new Player(engine, 'bob', 'cave', 'Bob');
  a.refresh().choose(/Défier un joueur/, 'bob');
  clock.advance(121);
  engine.tick();
  assert.deepEqual(engine.snapshot().duels, {});
  a.refresh().choose(/Défier un joueur/, 'bob');
  b.refresh().click('✅ Accepter');
  clock.advance(61);
  engine.tick();
  assert.equal(engine.player('alice')!.stats.gloire, 10);
  assert.match(a.refresh().text, /n’a pas joué à temps/);
});

test('un joueur absent ne peut pas être défié', () => {
  const { engine } = setup();
  const a = new Player(engine, 'alice', 'cave', 'Alice');
  new Player(engine, 'bob', 'cave', 'Bob');
  a.refresh();
  engine.closeSessionsOf('bob', 'cave');
  a.choose(/Défier un joueur/, 'bob');
  assert.match(a.text, /n’est plus là/);
});
