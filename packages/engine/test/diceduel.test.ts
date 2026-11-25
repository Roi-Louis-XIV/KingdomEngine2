// Duel de dés entre joueurs présents (taverne de la bêta Sainte Pelle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Engine, validateRendered, type WorldDef } from '../src/index.ts';
import { Clock, Player } from './harness.ts';

const world = () => JSON.parse(readFileSync(new URL('../../../content/sainte-pelle/world.json', import.meta.url), 'utf8')) as WorldDef;

function setup(rolls: number[] = []) {
  const clock = new Clock();
  let n = 0;
  // Dés truqués pour le test (valeurs 1..6), utilisés au moment de l'acceptation (voir `armed`).
  const queue: number[] = [];
  const arm = () => queue.push(...rolls.map((v) => (v - 0.5) / 6));
  const engine = new Engine(world(), undefined, { now: clock.now, random: () => queue.shift() ?? 0.5, newId: () => `s${++n}` });
  engine.eventControl('scenario', 'start');
  for (const id of ['alice', 'bob']) engine.adminApply(id, undefined, [{ type: 'stat.set', stat: 'ecus', value: 100 }]);
  return { engine, clock, arm };
}

const ecus = (e: Engine, id: string) => e.player(id)!.stats.ecus;

test('duel : seul dans le salon, on ne peut pas jouer et on sait pourquoi', () => {
  const { engine } = setup();
  const a = new Player(engine, 'alice', 'taverne', 'Alice');
  a.click('Jeux').click('Jouer au Duel');
  assert.match(a.text, /Personne d’autre n’est ici/);
  assert.match(a.text, /au moins deux dans le salon vocal/);
  assert.ok(!a.hasSelect(/Contre qui/));
  assert.deepEqual(validateRendered(a.message), []);
});

test('duel : défi, bannière, acceptation, puis panneau en direct pour toute la taverne (3 s, dés, vainqueur)', () => {
  const { engine, clock, arm } = setup([6, 5, 1, 2]);
  const a = new Player(engine, 'alice', 'taverne', 'Alice');
  const b = new Player(engine, 'bob', 'taverne', 'Bob');
  const c = new Player(engine, 'carla', 'taverne', 'Carla');
  a.click('Jeux').click('Jouer au Duel');
  assert.deepEqual(a.options(/Contre qui/).map((o) => o.label).sort(), ['Bob', 'Carla']);
  a.choose(/Contre qui/, 'bob').choose(/Combien miser/, '20').click(/^Défier Bob pour 20 écus/);
  assert.match(a.text, /En attente de sa réponse/);
  assert.equal(ecus(engine, 'alice'), 100, 'rien n’est prélevé avant l’acceptation');
  // Bob est sur l'accueil : la bannière l'avertit et l'emmène au duel.
  b.refresh();
  assert.match(b.text, /📣 \*\*Alice\*\* te défie au Duel ! Mise : \*\*20 écus\*\*/);
  b.click('Voir le défi');
  assert.match(b.text, /\d+ s pour répondre/);
  arm();
  b.click(/Accepter le duel · miser 20 écus/);
  // Mises engagées et réglées tout de suite, mais rien n'est dévoilé avant 3 s.
  assert.equal(ecus(engine, 'alice'), 120);
  assert.equal(ecus(engine, 'bob'), 80);
  assert.match(b.text, /🔴 EN DIRECT/);
  assert.match(b.text, /\*\*Alice\*\* ⚔️ \*\*Bob\*\*\n-# Mise 20 écus chacun · 💰 Cagnotte 40 écus/);
  assert.match(b.text, /# ⏳ 3…/);
  assert.match(b.text, /🟥 \*\*Alice\*\*\n# 🎲 🎲/);
  assert.doesNotMatch(b.text, /remporte 40/);
  // Carla, spectatrice sur l'accueil : invitée à regarder, puis elle suit le compte à rebours.
  c.refresh();
  assert.match(c.text, /🔴 \*\*Duel en direct :\*\* Alice ⚔️ Bob · cagnotte \*\*40 écus\*\*/);
  c.click('Regarder');
  assert.match(c.text, /# ⏳ 3…/);
  clock.advance(1);
  assert.match(c.refresh().text, /# ⏳ 2…/);
  assert.ok(engine.view(c.sessionId).wakeAt! <= clock.now() + 1000, 'image suivante dans la seconde');
  clock.advance(2);
  c.refresh();
  assert.match(c.text, /🟥 \*\*Alice\*\* 🏆\n# 6️⃣ 5️⃣\n\*\*Total : 11\*\* · 👑 \*\*Vainqueur\*\*/);
  assert.match(c.text, /🟦 \*\*Bob\*\*\n# 1️⃣ 2️⃣\n\*\*Total : 3\*\*/);
  assert.match(c.text, /🏁 TERMINÉ/);
  assert.match(c.text, /## 🏆 Alice remporte 40 écus !/);
  // L'écran des jeux montre aussi le panneau en direct.
  const d = new Player(engine, 'dan', 'taverne', 'Dan').click('Jeux');
  assert.match(d.text, /🏁 TERMINÉ/);
  for (const x of [a.refresh(), b.refresh(), c, d]) assert.deepEqual(validateRendered(x.message), []);
  // Le panneau disparaît après un moment ; les duellistes gardent leur résultat.
  clock.advance(46);
  engine.tick();
  assert.doesNotMatch(d.refresh().text, /TERMINÉ/);
  assert.match(a.refresh().text, /Alice\*\* : ⚅ 6 \+ ⚄ 5 = \*\*11\*\*/);
});

test('duel : égalité montrée, puis relance automatique sans toucher aux mises', () => {
  const { engine, clock, arm } = setup([3, 3, 4, 2, 6, 6, 1, 1]);
  const a = new Player(engine, 'alice', 'taverne', 'Alice');
  const b = new Player(engine, 'bob', 'taverne', 'Bob');
  a.click('Jeux').click('Jouer au Duel').choose(/Contre qui/, 'bob').choose(/Combien miser/, '10').click(/^Défier/);
  b.refresh().click('Voir le défi');
  arm();
  b.click(/Accepter le duel/);
  clock.advance(3);
  assert.match(b.refresh().text, /## 🤝 Égalité à 6 ! On relance…/);
  assert.match(b.text, /# 3️⃣ 3️⃣/);
  // Après l'égalité : nouveau compte à rebours de 3 s.
  clock.advance(2.5);
  assert.match(b.refresh().text, /Égalité au lancer précédent \(6 partout\) : on relance !\n# ⏳ 3…/);
  assert.match(b.text, /# 🎲 🎲/);
  clock.advance(1);
  assert.match(b.refresh().text, /# ⏳ 2…/);
  clock.advance(2);
  b.refresh();
  assert.match(b.text, /# 6️⃣ 6️⃣/);
  assert.match(b.text, /🏆 Alice remporte 20 écus/);
  assert.match(b.text, /Après 1 égalité et relance\./);
  assert.equal(ecus(engine, 'alice'), 110);
  assert.equal(ecus(engine, 'bob'), 90);
});

test('duel : refus, expiration après 30 s, départ du salon : rien n’est prélevé', () => {
  const { engine, clock } = setup();
  const a = new Player(engine, 'alice', 'taverne', 'Alice');
  const b = new Player(engine, 'bob', 'taverne', 'Bob');
  const defier = () => a.click('Jeux').click('Jouer au Duel').choose(/Contre qui/, 'bob').choose(/Combien miser/, '50').click(/^Défier/);
  defier();
  b.refresh().click('Voir le défi').click('Refuser');
  const defier2 = () => a.choose(/Contre qui/, 'bob').choose(/Combien miser/, '50').click(/^Défier/);
  assert.match(a.refresh().text, /a refusé ton défi\. Rien n’a été prélevé/);
  // Expiration.
  defier2();
  clock.advance(31);
  engine.tick();
  assert.match(a.refresh().text, /n’a pas répondu à temps/);
  assert.doesNotMatch(b.refresh().text, /te défie/, 'la bannière disparaît');
  // Départ du salon (interface fermée) avant la réponse.
  defier2();
  engine.closeSession(b.sessionId);
  engine.tick();
  assert.match(a.refresh().text, /l’un de vous a quitté les lieux/);
  assert.equal(ecus(engine, 'alice'), 100);
  assert.equal(ecus(engine, 'bob'), 100);
});

test('duel : pas assez d’écus pour suivre, et ce n’est pas un travail (compatible avec un travail en cours)', () => {
  const { engine, arm } = setup([6, 6, 1, 1]);
  engine.adminApply('bob', undefined, [{ type: 'stat.set', stat: 'ecus', value: 5 }]);
  const a = new Player(engine, 'alice', 'taverne', 'Alice');
  const b = new Player(engine, 'bob', 'taverne', 'Bob');
  // Alice a un travail en cours ailleurs (maxActivities = 1) : le duel reste possible.
  engine.adminApply('alice', undefined, []);
  (engine as any).state.players.alice.activities['foret/lisiere/jeune'] = { startedAt: Date.now(), endsAt: Number.MAX_SAFE_INTEGER };
  a.click('Jeux').click('Jouer au Duel').choose(/Contre qui/, 'bob').choose(/Combien miser/, '20').click(/^Défier/);
  b.refresh().click('Voir le défi');
  assert.match(b.text, /il te manque 15 écus pour suivre/);
  const accept = b.message;
  assert.ok(JSON.stringify(accept).includes('"disabled":true'), 'bouton d’acceptation grisé');
  engine.adminApply('bob', undefined, [{ type: 'stat.set', stat: 'ecus', value: 50 }]);
  arm();
  b.refresh().click(/Accepter le duel/);
  assert.match(b.text, /EN DIRECT/);
  assert.equal(ecus(engine, 'alice'), 120);
});
