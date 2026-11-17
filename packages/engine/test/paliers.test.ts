/** Statistiques qui évoluent toutes seules et paliers (l'ivresse redescend, et change le travail des métiers). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, validateRendered, validateWorld, type WorldDef } from '../src/index.ts';
import { Clock, Player } from './harness.ts';

const world = (): WorldDef =>
  ({
    format: 'kingdom-world@1',
    id: 'auberge',
    name: 'Auberge',
    settings: { maxActiveJobs: 2 },
    stats: [
      { id: 'energie', name: 'Endurance', emoji: '⚡', min: 0, max: 100, initial: 100, kind: 'gauge' },
      {
        id: 'alcool', name: 'Ivresse', emoji: '🍺', min: 0, max: 100, initial: 0, kind: 'gauge',
        drift: { amount: -5, everySec: 60 },
        levels: [
          { from: 30, name: 'Pompette', emoji: '🙂', yield: 1.5 },
          { from: 50, name: 'Éméché', emoji: '🥴', yield: 0.5, fumble: 1, text: 'Tu vois double.' },
          { from: 100, name: 'Ivre mort', emoji: '😵', blocksWork: true, text: 'Tu titubes.' },
        ],
      },
    ],
    items: [{ id: 'bois', name: 'Bois', emoji: '🪵' }],
    modifiers: [],
    jobs: [{ id: 'bucheron', name: 'Bûcheron', emoji: '🪓', xpPerLevel: 10 }],
    variables: [],
    buildings: [
      {
        id: 'bois',
        name: 'Bois',
        homeScreen: 'accueil',
        modules: [
          {
            type: 'activity',
            id: 'travaux',
            name: 'Travaux',
            activities: [
              { id: 'couper', name: 'Couper du bois', emoji: '🪓', durationSec: 0, cooldownSec: 0, costs: [{ type: 'stat.add', stat: 'energie', amount: -1 }], job: { id: 'bucheron', xp: 1 }, rolls: 1, results: [{ weight: 1, label: 'Du bois', actions: [{ type: 'item.give', item: 'bois', qty: 4 }] }] },
              { id: 'chanter', name: 'Chanter', emoji: '🎶', durationSec: 0, cooldownSec: 0, costs: [], rolls: 1, results: [{ weight: 1, label: 'Une chanson', actions: [] }] },
            ],
          },
        ],
        screens: [{ id: 'accueil', name: 'Accueil', blocks: [{ type: 'notice' }, { type: 'widget', widget: { kind: 'player.sheet', stats: ['alcool'] } }, { type: 'widget', widget: { kind: 'activity.board', activity: 'travaux' } }] }],
      },
    ],
  }) as unknown as WorldDef;

const setup = (alcool: number) => {
  const clock = new Clock();
  let n = 0;
  const w = world();
  const e0 = new Engine(w, undefined, { now: clock.now, random: () => 0.5, newId: () => `s${++n}` });
  new Player(e0, 'alice', 'bois');
  const st = e0.snapshot();
  st.players.alice!.stats.alcool = alcool;
  const engine = new Engine(w, st, { now: clock.now, random: () => 0.5, newId: () => `t${++n}` });
  return { engine, clock, p: new Player(engine, 'alice', 'bois') };
};

test('les paliers et l’évolution automatique sont validés', () => {
  assert.deepEqual(validateWorld(world()).filter((i) => i.level === 'error'), []);
  const bad = world();
  bad.stats[1]!.levels!.push({ from: 30, name: 'Doublon', fumble: 2 });
  const msgs = validateWorld(bad).map((i) => i.message).join(' | ');
  assert.match(msgs, /risque entre 0 et 1/);
  assert.match(msgs, /deux paliers commencent au même seuil/);
});

test('l’ivresse redescend toute seule, par pas, jusqu’à 0, sans écrire quand il n’y a rien à faire', () => {
  const { engine, clock } = setup(20);
  engine.tick(); // premier passage : le compteur démarre
  clock.advance(59);
  engine.tick();
  assert.equal(engine.player('alice')!.stats.alcool, 20);
  clock.advance(1);
  engine.tick();
  assert.equal(engine.player('alice')!.stats.alcool, 15);
  clock.advance(180);
  engine.tick();
  assert.equal(engine.player('alice')!.stats.alcool, 0);
  const rev = engine.revision;
  clock.advance(600);
  engine.tick();
  assert.equal(engine.revision, rev, 'à 0, plus rien ne bouge');
});

test('sobre : récolte normale ; pompette : +50 %, affiché', () => {
  const sober = setup(0).p;
  sober.click('Lancer');
  assert.equal(sober.state.items.bois, 4);
  const { p } = setup(35);
  assert.match(p.text, /🙂 \*\*Pompette\*\* : récoltes \+50 %/);
  p.click('Lancer');
  assert.equal(p.state.items.bois, 6);
  assert.match(p.text, /🙂 Pompette : \+50 %/);
});

test('éméché : maladresse (effort dépensé, rien récolté) ; seulement pour le travail d’un métier', () => {
  const { p } = setup(60);
  assert.match(p.text, /🥴 \*\*Éméché\*\* : récoltes −50 % · 100 % de risque de tout rater\n-# Tu vois double\./);
  p.click('Lancer');
  assert.equal(p.state.items.bois ?? 0, 0);
  assert.equal(p.state.stats.energie, 99, 'l’effort est dépensé');
  assert.match(p.text, /💫 \*\*🪓 Couper du bois\*\* : 🥴 Éméché, tu t’emmêles les pinceaux… \*\*rien récolté\*\*/);
  assert.deepEqual(validateRendered(p.message), []);
});

test('ivre mort : plus de travail de métier, le reste reste possible ; la fiche explique', () => {
  const { p } = setup(100);
  assert.match(p.text, /😵 Ivre mort : Tu titubes\./);
  assert.match(p.text, /🍺 \*\*Ivresse :\*\* 100\/100 .* · 😵 \*\*Ivre mort\*\* : impossible de travailler — Tu titubes\.\n-# ↘️ redescend de 5 chaque minute/);
  const r = p.engine.interact('alice', p.button('Lancer').customId);
  assert.equal(r.message ? 'rendu' : 'rien', 'rendu');
  assert.equal(p.engine.player('alice')!.items.bois ?? 0, 0);
});

test('repos : une statistique ne remonte qu’après un moment sans être dépensée (endurance)', () => {
  const w = world();
  w.stats[0]!.drift = { amount: 2, everySec: 60, restSec: 120 };
  w.stats[0]!.initial = 50;
  const clock = new Clock();
  let n = 0;
  const engine = new Engine(w, undefined, { now: clock.now, random: () => 0.5, newId: () => `s${++n}` });
  const p = new Player(engine, 'alice', 'bois');
  engine.tick();
  clock.advance(60);
  engine.tick();
  assert.equal(engine.player('alice')!.stats.energie, 52, 'au repos : +2 par minute');
  // Travailler dépense de l'endurance : le repos repart de zéro (2 min sans rien regagner).
  p.click('Lancer');
  assert.equal(engine.player('alice')!.stats.energie, 51);
  clock.advance(119);
  engine.tick();
  assert.equal(engine.player('alice')!.stats.energie, 51);
  clock.advance(1);
  engine.tick();
  clock.advance(60);
  engine.tick();
  assert.equal(engine.player('alice')!.stats.energie, 53, 'le repos fini, +2 par minute à nouveau');
  // Plafonnée au maximum.
  clock.advance(3600);
  engine.tick();
  assert.equal(engine.player('alice')!.stats.energie, 100);
});
