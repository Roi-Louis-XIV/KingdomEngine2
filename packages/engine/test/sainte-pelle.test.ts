/** Bêta « La Nuit de la Sainte Pelle » : quêtes, vote, urgence, fins, limites Discord à chaque acte. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Engine, validateRendered, validateWorld, type WorldDef, type WorldState } from '../src/index.ts';
import { Clock, Player, seeded } from './harness.ts';

const load = (): WorldDef => JSON.parse(readFileSync(new URL('../../../content/sainte-pelle/world.json', import.meta.url), 'utf8'));

function setup(state?: WorldState, clock = new Clock()) {
  let n = 0;
  const world = load();
  const engine = new Engine(world, state, { now: clock.now, random: seeded(7), newId: () => `s${++n}` });
  return { engine, clock, world };
}

/** Avance l'horloge minute par minute en faisant tourner le monde. */
function minutes(engine: Engine, clock: Clock, n: number) {
  for (let i = 0; i < n; i++) {
    clock.advance(60);
    engine.tick();
  }
}

const started = () => {
  const s = setup();
  s.engine.eventControl('scenario', 'start');
  return s;
};

/** Donne une quête précise à un joueur (sans passer par le hasard du panneau). */
function withQuest(engine: Engine, clock: Clock, player: string, quest: string) {
  const snap = engine.snapshot();
  snap.players[player] ??= structuredClone(Object.values(snap.players)[0]!);
  snap.players[player]!.quest = { id: quest, since: clock.now(), progress: {} };
  return setup(snap, clock).engine;
}

test('le monde de la bêta est valide', () => {
  assert.deepEqual(validateWorld(load()), []);
});

test('avant le signal du Roi : la place attend, aucune quête', () => {
  const { engine } = setup();
  const p = new Player(engine, 'louis', 'place');
  assert.match(p.text, /n’a pas encore commencé/);
  assert.ok(!p.buttons.includes('Choisir'));
});

test('panneau des quêtes : 4 propositions, tutoriel en tête, une seule quête à la fois', () => {
  const { engine } = started();
  assert.equal(engine.variables.t, 0);
  const p = new Player(engine, 'louis', 'place');
  assert.match(p.text, /Panneau des quêtes/);
  assert.match(p.text, /Premiers pas/);
  assert.equal(p.buttons.filter((b) => b === 'Choisir').length, 4);
  // Le premier « Choisir » est la quête en vedette.
  p.click('Choisir');
  assert.match(p.text, /Quête acceptée : \*\*Premiers pas\*\*/);
  assert.match(p.text, /Tu mènes déjà une quête/);
  assert.ok(p.buttons.includes('Abandonner cette quête'));
  // La place compte déjà comme 1 lieu visité.
  assert.equal(p.state.quest?.progress.lieux, 1);
});

test('« Mon inventaire » : endurance, ivresse, XP, niveau, quête au-dessus du sac', () => {
  const { engine } = started();
  const p = new Player(engine, 'louis', 'place');
  p.click('Choisir');
  p.click('🎒 Mon inventaire');
  const t = p.text;
  assert.match(t, /Endurance :\*\* 80\/100/);
  assert.match(t, /Ivresse :\*\* 0\/100/);
  assert.match(t, /XP :\*\* 0 · 🏠 \*\*Habitant\*\* \(prochain : Compagnon à 100\)/);
  assert.match(t, /Premiers pas\*\* ★ · Maëlis/);
  assert.match(t, /▫️ Visiter 4 lieux différents \(1\/4\)/);
  assert.match(t, /🎁 💰 \+15 écus · ⭐ \+10 XP/);
  assert.ok(t.indexOf('Premiers pas') < t.indexOf('Mon inventaire'));
  assert.match(t, /Outils :\*\* 🪓 Hache de bûcheron ×1 \(40\/40\)/);
});

test('quête réussie : récompenses, message, retour obligatoire au panneau', () => {
  const { engine } = started();
  const p = new Player(engine, 'louis', 'place');
  p.click('Choisir');
  new Player(engine, 'louis', 'taverne');
  new Player(engine, 'louis', 'mine');
  const last = new Player(engine, 'louis', 'forge');
  assert.match(last.text, /Quête réussie : Premiers pas/);
  assert.match(last.text, /Retourne au panneau des quêtes/);
  assert.equal(last.state.stats.ecus, 115);
  assert.equal(last.state.stats.xp, 10);
  assert.deepEqual(last.state.questsDone, ['q01']);
  // Au panneau : nouvelles propositions, jamais la quête déjà faite.
  const back = new Player(engine, 'louis', 'place');
  assert.doesNotMatch(back.text, /Premiers pas/);
  assert.equal(back.buttons.filter((b) => b === 'Choisir').length, 4);
});

test('livrer depuis l’inventaire du bon bâtiment', () => {
  const s = started();
  s.engine.adminApply('louis', undefined, [{ type: 'item.give', item: 'oeuf', qty: 5 }]);
  const engine = withQuest(s.engine, s.clock, 'louis', 'q04');
  const ailleurs = new Player(engine, 'louis', 'forge');
  ailleurs.click('🎒 Mon inventaire');
  assert.ok(!ailleurs.buttons.some((b) => b.startsWith('Livrer')));
  const p = new Player(engine, 'louis', 'taverne');
  p.click('🎒 Mon inventaire');
  p.click(/^Livrer : /);
  assert.match(p.text, /Livré : 4 🥚 Œuf frais/);
  assert.match(p.text, /Quête réussie : Œufs frais/);
  assert.equal(p.state.items.oeuf, 1);
});

test('compter : activités, recharge, quête ordonnée', () => {
  const s = started();
  new Player(s.engine, 'louis', 'place');
  const engine = withQuest(s.engine, s.clock, 'louis', 'q03');
  const f = new Player(engine, 'louis', 'foret');
  f.click('Lancer');
  s.clock.advance(80);
  f.refresh().click('Récupérer');
  assert.equal(f.state.quest?.progress.abattre, 1);
  // 4 bûches apportées à la fête.
  const pl = new Player(engine, 'louis', 'place');
  pl.click('🎉 Fête & Trésor');
  pl.choose(/Choisir ce que tu apportes/, 'buche');
  pl.click(/^Tout|×4/);
  pl.click(/^Apporter/);
  assert.match(pl.text, /Quête réussie : Le bois du bûcher/);
  assert.match(pl.text, /\+\d+ XP/);
});

test('vote, verdict, incendie, urgence maîtrisée, éclats retrouvés et fin triomphante', () => {
  const { engine, clock } = started();
  minutes(engine, clock, 45);
  assert.equal(engine.variables.t, 45);
  for (const id of ['a', 'b', 'c']) {
    const p = new Player(engine, id, 'place');
    p.click('🗳️ Conseil de la pierre');
    p.click(id === 'c' ? 'Rendre à la mine' : 'Garder à la forge');
    assert.match(p.text, /Ta voix est comptée/);
    assert.ok(!p.buttons.includes('Garder à la forge'));
  }
  minutes(engine, clock, 20);
  assert.equal(engine.variables.pierre, 'forge');
  minutes(engine, clock, 25);
  assert.equal(engine.variables.urgence, 'incendie');
  // Pendant la tempête, la forêt est fermée.
  assert.match(new Player(engine, 'a', 'foret').text, /Forêt fermée/);
  // 30 seaux du puits jusqu'à la forge.
  engine.adminApply('a', undefined, [{ type: 'item.give', item: 'seau', qty: 30 }]);
  const f = new Player(engine, 'a', 'forge');
  for (let i = 0; i < 30; i++) {
    f.click('Lancer');
    clock.advance(4);
  }
  assert.match(f.text, /Objectif atteint/);
  minutes(engine, clock, 10);
  assert.equal(engine.variables.urgence_res, 'reussie');
  assert.equal(engine.variables.forge_etat, 'ok');
  minutes(engine, clock, 10);
  assert.equal(engine.variables.acte, 'releve');
  // Chantier et éclats menés « à la main ».
  engine.adminApply('a', 'eglise', [
    { type: 'objective.add', building: 'eglise', objective: 'arbre', item: 'branche', qty: 12 },
    { type: 'objective.add', building: 'eglise', objective: 'chantier', item: 'buche', qty: 40 },
    { type: 'objective.add', building: 'eglise', objective: 'chantier', item: 'pierre', qty: 30 },
    { type: 'objective.add', building: 'eglise', objective: 'assemblage', item: 'assemblage', qty: 3 },
  ]);
  const e = new Player(engine, 'b', 'eglise');
  e.click('Ramasser l’éclat');
  assert.match(e.text, /Éclat retrouvé/);
  assert.equal(engine.variables.eclats, 1);
  assert.ok(!e.buttons.includes('Ramasser l’éclat'));
  for (const n of [2, 3, 4, 5, 6]) engine.adminApply('a', undefined, [{ type: 'variable.add', variable: 'eclats', amount: 1 }, { type: 'variable.set', variable: `eclat${n}`, value: 'oui' }]);
  minutes(engine, clock, 60);
  assert.equal(engine.variables.fin, 'triomphe');
  minutes(engine, clock, 11);
  assert.equal(engine.variables.acte, 'fin');
  assert.equal(engine.live().events.find((x) => x.id === 'scenario')?.status, 'finished');
  assert.match(new Player(engine, 'a', 'place').click('🏅 Tableau d’honneur').text, /Tableau d’honneur/);
});

test('urgence ratée : la forge est endommagée jusqu’à ce qu’on la rebâtisse', () => {
  const { engine, clock } = started();
  minutes(engine, clock, 45);
  const p = new Player(engine, 'a', 'place');
  p.click('🗳️ Conseil de la pierre').click('Garder à la forge');
  minutes(engine, clock, 56);
  assert.equal(engine.variables.urgence_res, 'ratee');
  assert.equal(engine.variables.forge_etat, 'endommagee');
  const f = new Player(engine, 'a', 'forge');
  assert.match(f.text, /Rebâtir la forge/);
  assert.doesNotMatch(f.text, /Fondre un lingot/);
});

test('aucune urgence pour la mine si personne ne vote : égalité = la pierre retourne à la mine', () => {
  const { engine, clock } = started();
  minutes(engine, clock, 90);
  assert.equal(engine.variables.pierre, 'mine');
  assert.equal(engine.variables.urgence, 'eboulement');
  assert.match(new Player(engine, 'a', 'mine').text, /Dégager Roland/);
});

test('tous les écrans de tous les lieux respectent les limites Discord, à chaque acte', () => {
  const { engine, clock, world } = started();
  for (const t of [0, 30, 50, 60, 75, 92, 105, 120, 175]) {
    minutes(engine, clock, t - Number(engine.variables.t));
    for (const b of world.buildings)
      for (const s of b.screens) {
        const p = new Player(engine, `testeur-${t}`, b.id);
        const snap = engine.snapshot();
        snap.sessions[p.sessionId]!.screen = s.id;
        const e2 = new Engine(world, snap, { now: clock.now });
        const msg = e2.view(p.sessionId).message;
        assert.deepEqual(validateRendered(msg), [], `T+${t} ${b.id}/${s.id}`);
      }
  }
});
