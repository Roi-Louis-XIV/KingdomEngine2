/** Phase 3 : météo automatique et événements programmés. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, nextRun, localToUtc, zoned, validateWorld } from '../src/index.ts';
import { Clock, Player, loadWorld, seeded } from './harness.ts';

function setup(start = localToUtc(2026, 11, 10, 12, 0, 'Europe/Paris')) {
  const clock = new Clock();
  clock.t = start;
  const engine = new Engine(loadWorld(), undefined, { now: clock.now, random: seeded(3) });
  return { engine, clock };
}
const ev = (e: Engine, id: string) => e.live().events.find((x) => x.id === id)!;

test('fuseau horaire : 20:00 à Paris, été comme hiver', () => {
  const winter = localToUtc(2026, 1, 15, 20, 0, 'Europe/Paris');
  assert.equal(new Date(winter).toISOString(), '2026-01-15T19:00:00.000Z');
  const summer = localToUtc(2026, 7, 15, 20, 0, 'Europe/Paris');
  assert.equal(new Date(summer).toISOString(), '2026-07-15T18:00:00.000Z');
  assert.equal(zoned(summer, 'Europe/Paris').h, 20);
});

test('programmations : quotidienne (jours choisis), intervalle avec rattrapage, date unique', () => {
  const tz = 'Europe/Paris';
  const mon10 = localToUtc(2026, 11, 9, 10, 0, tz); // lundi
  assert.equal(nextRun({ type: 'daily', at: '20:00' }, mon10, tz), localToUtc(2026, 11, 9, 20, 0, tz));
  assert.equal(nextRun({ type: 'daily', at: '08:00' }, mon10, tz), localToUtc(2026, 11, 10, 8, 0, tz), 'déjà passé : demain');
  assert.equal(nextRun({ type: 'daily', at: '20:00', days: [6] }, mon10, tz), localToUtc(2026, 11, 14, 20, 0, tz), 'samedi suivant');
  const last = mon10 - 7 * 3600_000;
  assert.equal(nextRun({ type: 'interval', everyMinutes: 120 }, mon10, tz, last), mon10 + 3600_000, 'créneaux manqués non rejoués');
  assert.equal(nextRun({ type: 'once', at: '2026-11-09T09:00' }, mon10, tz), null, 'date passée');
  assert.equal(nextRun({ type: 'manual' }, mon10, tz), null);
});

test('météo automatique : premier tirage, changement à échéance, annonces, suspension', () => {
  const { engine, clock } = setup();
  engine.tick();
  const w1 = engine.live().weather!;
  assert.ok(w1, 'une météo est tirée au premier passage');
  assert.equal(engine.variables.meteo, w1.value);
  assert.ok(w1.until > clock.t);
  const rev = engine.revision;
  engine.tick();
  assert.equal(engine.revision, rev, 'rien ne change avant l’échéance : pas de nouvelle révision');

  let changes = 0;
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) {
    clock.t = engine.live().weather!.until + 1000;
    const before = engine.variables.meteo;
    engine.tick();
    if (engine.variables.meteo !== before) changes++;
    seen.add(String(engine.variables.meteo));
  }
  assert.equal(changes, 60, 'chaque échéance change le temps');
  assert.ok(seen.has('soleil') && seen.size >= 3, [...seen].join(','));

  engine.setWeatherAuto(false);
  const frozen = engine.variables.meteo;
  clock.advance(24 * 3600);
  engine.tick();
  assert.equal(engine.variables.meteo, frozen, 'suspendue : la météo ne bouge plus');
  const ann = engine.setWeather('orage', 10);
  assert.equal(engine.variables.meteo, 'orage');
  assert.match(ann[0]!.type === 'announce' ? ann[0]!.text : '', /orage gronde/);
});

test('la météo agit sur le jeu : pas d’abattage sous l’orage, cèpes par temps de pluie', () => {
  const { engine } = setup();
  const p = new Player(engine, 'alice', 'foret');
  p.click('Devenir bûcheron');
  engine.setWeather('orage', 30);
  p.refresh();
  assert.match(p.text, /🔒 Météo = orage \(attendu ≠ orage\)/);
  assert.match(p.text, /🔒 Aucune alternative remplie/);
  assert.match(p.text, /Météo :\*\* ⛈️ Orage/);
  engine.setWeather('pluie', 30);
  p.refresh();
  assert.doesNotMatch(p.text, /🔒 Aucune alternative/);
});

test('événement manuel scénarisé : démarrer, étape, pause qui gèle le temps, reprise, fin', () => {
  const { engine, clock } = setup();
  assert.equal(ev(engine, 'tempete').status, 'idle');
  const start = engine.eventControl('tempete', 'start');
  assert.match(start.map((x) => (x.type === 'announce' ? x.text : '')).join('\n'), /Tempête de la Sainte Pelle\*\* s’abat/);
  assert.equal(engine.variables.phase, 'tempete');
  assert.equal(engine.variables.meteo, 'orage');
  assert.throws(() => engine.eventControl('tempete', 'start'), /déjà en cours/);

  clock.advance(20 * 60);
  engine.eventControl('tempete', 'pause');
  assert.equal(ev(engine, 'tempete').status, 'paused');
  clock.advance(60 * 60);
  assert.equal(engine.tick().length, 0, 'en pause : ni étape ni fin');
  assert.equal(Math.round(ev(engine, 'tempete').elapsedMs / 60000), 20);

  engine.eventControl('tempete', 'resume');
  clock.advance(10 * 60);
  const step = engine.tick();
  assert.match(step.map((x) => (x.type === 'announce' ? x.text : '')).join(), /clocher/);
  assert.equal(ev(engine, 'tempete').stepsDone, 1);
  clock.advance(15 * 60);
  const end = engine.tick();
  assert.match(end.map((x) => (x.type === 'announce' ? x.text : '')).join(), /tempête s’éloigne/);
  assert.equal(ev(engine, 'tempete').status, 'finished');
  assert.equal(engine.variables.phase, 'apres');
  assert.equal(engine.variables.meteo, 'pluie');
  assert.equal(ev(engine, 'tempete').nextRunAt, null, 'manuel : jamais relancé tout seul');
});

test('arrêt et redémarrage', () => {
  const { engine, clock } = setup();
  engine.eventControl('tempete', 'start');
  clock.advance(5 * 60);
  engine.eventControl('tempete', 'stop');
  assert.equal(ev(engine, 'tempete').status, 'finished');
  assert.equal(engine.variables.phase, 'apres', 'l’arrêt applique les actions de fin');
  assert.throws(() => engine.eventControl('tempete', 'stop'), /n’est pas en cours/);
  engine.eventControl('tempete', 'start');
  clock.advance(10 * 60);
  engine.eventControl('tempete', 'restart');
  const e = ev(engine, 'tempete');
  assert.equal(e.status, 'running');
  assert.equal(e.runs, 3);
  assert.equal(Math.round(e.elapsedMs), 0, 'le compteur repart de zéro');
  assert.equal(engine.variables.phase, 'tempete');
});

test('événement quotidien : déclenchement à 20:00, fin après 2 h, reprogrammé le lendemain ; programmation coupable', () => {
  const { engine, clock } = setup(localToUtc(2026, 11, 10, 19, 58, 'Europe/Paris'));
  engine.tick();
  const plan = ev(engine, 'soiree').nextRunAt!;
  assert.equal(plan, localToUtc(2026, 11, 10, 20, 0, 'Europe/Paris'));
  clock.advance(3 * 60);
  engine.tick();
  assert.equal(ev(engine, 'soiree').status, 'running');
  assert.equal(engine.variables.soiree, 'oui');
  const p = new Player(engine, 'alice');
  assert.match(p.text, /Soirée en cours/);
  clock.advance(2 * 3600);
  engine.tick();
  assert.equal(ev(engine, 'soiree').status, 'finished');
  assert.equal(engine.variables.soiree, 'non');
  assert.equal(ev(engine, 'soiree').nextRunAt, localToUtc(2026, 11, 11, 20, 0, 'Europe/Paris'));

  engine.setEventAuto('soiree', false);
  assert.equal(ev(engine, 'soiree').nextRunAt, null);
  clock.t = localToUtc(2026, 11, 11, 20, 5, 'Europe/Paris');
  engine.tick();
  assert.equal(ev(engine, 'soiree').status, 'finished', 'programmation coupée : pas de lancement');
  engine.setEventAuto('soiree', true);
  assert.equal(ev(engine, 'soiree').nextRunAt, localToUtc(2026, 11, 12, 20, 0, 'Europe/Paris'));
  assert.throws(() => engine.setEventAuto('tempete', true), /se lance à la main/);
});

test('redémarrage du serveur pendant un événement : il reprend où il en était', () => {
  const { engine, clock } = setup();
  engine.eventControl('tempete', 'start');
  clock.advance(10 * 60);
  const saved = JSON.parse(JSON.stringify(engine.snapshot()));
  const e2 = new Engine(loadWorld(), saved, { now: clock.now, random: seeded(1) });
  clock.advance(25 * 60);
  e2.tick();
  assert.equal(ev(e2, 'tempete').stepsDone, 1);
  clock.advance(10 * 60);
  e2.tick();
  assert.equal(ev(e2, 'tempete').status, 'finished');
});

test('validation : heure invalide et météo inconnue signalées', () => {
  const w = loadWorld();
  w.events![1]!.schedule = { type: 'daily', at: '25:99' };
  w.events![0]!.onStart.push({ type: 'weather.set', value: 'neige' });
  const msgs = validateWorld(w).map((i) => i.message);
  assert.ok(msgs.some((m) => /heure invalide/.test(m)));
  assert.ok(msgs.includes('météo inconnue : neige'));
});
