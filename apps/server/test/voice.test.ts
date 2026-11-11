import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoicePool, type Presence } from '../src/voice/pool.ts';
import { desiredPresences } from '../src/voice/planner.ts';
import { makeEngine } from '../../../packages/engine/test/harness.ts';

const presence = (key: string, guildId = 'g1', ambience = 'a'): Presence => ({
  key,
  guildId,
  channelId: `vc-${key}`,
  serverId: 's',
  building: key,
  identity: { name: key },
  ambience,
  volume: 0.6,
});

function pool(n: number, guilds = ['g1']) {
  const p = new VoicePool(30_000);
  for (let i = 1; i <= n; i++) {
    const w = p.register(`w${i}`, `Voice Worker ${i}`);
    w.online = true;
    guilds.forEach((g) => w.guilds.add(g));
  }
  return p;
}

test('voix : une présence par bâtiment occupé, worker conservé tant qu’elle est souhaitée', () => {
  const p = pool(2);
  const a = p.reconcile([presence('taverne')], 0);
  assert.equal(a.assign.length, 1);
  const worker = a.assign[0]!.worker;
  const b = p.reconcile([presence('taverne'), presence('forge')], 1000);
  assert.equal(b.assign.length, 1);
  assert.notEqual(b.assign[0]!.worker, worker, 'la forge prend l’autre worker');
  const c = p.reconcile([presence('taverne'), presence('forge')], 2000);
  assert.deepEqual([c.assign, c.update, c.release], [[], [], []], 'rien ne bouge');
});

test('voix : capacité atteinte et worker non installé sur le serveur', () => {
  const p = pool(1);
  const r = p.reconcile([presence('taverne'), presence('forge')], 0);
  assert.equal(r.assign.length, 1);
  assert.match(r.unplaced[0]!.reason, /occupés/);
  const r2 = p.reconcile([presence('mine', 'g2')], 0);
  assert.match(r2.unplaced[0]!.reason, /Aucun Voice Worker/);
});

test('voix : délai de grâce avant libération, pas de doublon pendant la grâce', () => {
  const p = pool(2);
  p.reconcile([presence('taverne')], 0);
  const empty = p.reconcile([], 10_000);
  assert.equal(empty.release.length, 0, 'encore dans le délai de grâce');
  const back = p.reconcile([presence('taverne')], 15_000);
  assert.equal(back.assign.length, 0, 'le joueur revient : même worker, pas de nouvelle connexion');
  p.reconcile([], 20_000);
  const gone = p.reconcile([], 50_000);
  assert.equal(gone.release.length, 1);
});

test('voix : changement d’ambiance (Tempête) = mise à jour sans changer de worker', () => {
  const p = pool(1);
  p.reconcile([presence('taverne', 'g1', 'calme')], 0);
  const r = p.reconcile([presence('taverne', 'g1', 'tempete')], 1000);
  assert.equal(r.update.length, 1);
  assert.equal(r.update[0]!.presence.ambience, 'tempete');
});

test('voix : un worker déconnecté est libéré et la présence réattribuée', () => {
  const p = pool(2);
  const a = p.reconcile([presence('taverne')], 0);
  p.workers.get(a.assign[0]!.worker)!.online = false;
  const r = p.reconcile([presence('taverne')], 1000);
  assert.equal(r.release.length, 1);
  assert.equal(r.assign.length, 1);
  assert.notEqual(r.assign[0]!.worker, a.assign[0]!.worker);
});

test('planificateur : bâtiment occupé + audio configuré → présence avec identité du PNJ et ambiance de phase', () => {
  const { engine } = makeEngine();
  const args = { serverId: 's', guildId: 'g1', engine, channels: { taverne: { voice: 'vc1' } }, occupancy: new Map([['vc1', 2]]) };
  const [p] = desiredPresences(args);
  assert.equal(p!.identity.name, 'Edgar Brassebarbe');
  assert.equal(p!.ambience, 'taverne-calme');
  engine.setVariable('phase', 'tempete');
  assert.equal(desiredPresences(args)[0]!.ambience, 'taverne-tempete');
  assert.deepEqual(desiredPresences({ ...args, occupancy: new Map() }), [], 'salon vide : aucune présence');
});

test('ambiance permanente : chaque bâtiment avec ambiance a sa présence, les bâtiments occupés passent en premier', async () => {
  const { readFileSync } = await import('node:fs');
  const { Engine } = await import('../../../packages/engine/src/index.ts');
  const { voiceNeed } = await import('../src/voice/planner.ts');
  const world = JSON.parse(readFileSync(new URL('../../../content/sainte-pelle/world.json', import.meta.url), 'utf8'));
  assert.equal(world.settings.voiceAlways, true);
  const engine = new Engine(world);
  const channels = Object.fromEntries(world.buildings.map((b: { id: string }) => [b.id, { voice: `vc-${b.id}` }]));
  assert.equal(voiceNeed(world, channels), 8, 'les 8 lieux de la bêta ont une ambiance : 8 Voice Workers');
  const all = desiredPresences({ serverId: 's', guildId: 'g1', engine, channels, occupancy: new Map([['vc-forge', 1]]) });
  assert.equal(all.length, 8, 'tous les salons, même vides');
  assert.equal(all[0]!.building, 'forge', 'le bâtiment occupé d’abord');
  assert.equal(all.find((p) => p.building === 'taverne')!.welcome, undefined, 'pas d’accueil dans un salon vide');
  assert.equal(all.find((p) => p.building === 'place')!.ambience, 'place-calme');
  // Pas assez de workers : le bâtiment occupé est servi.
  const plan = pool(3).reconcile(all, 0);
  assert.equal(plan.assign.length, 3);
  assert.ok(plan.assign.some((a) => a.presence.building === 'forge'));
  assert.equal(plan.unplaced.length, 5);
  // Sans l'option : seulement les salons occupés.
  world.settings.voiceAlways = false;
  assert.deepEqual(desiredPresences({ serverId: 's', guildId: 'g1', engine: new Engine(world), channels, occupancy: new Map([['vc-forge', 1]]) }).map((p) => p.building), ['forge']);
});
