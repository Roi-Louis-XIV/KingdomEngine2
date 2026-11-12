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

test('personnages : un worker par PNJ présent si des joueurs sont là, le PNJ du lieu joue l’ambiance', async () => {
  const { readFileSync } = await import('node:fs');
  const { Engine } = await import('../../../packages/engine/src/index.ts');
  const { voiceNeed } = await import('../src/voice/planner.ts');
  const world = JSON.parse(readFileSync(new URL('../../../content/sainte-pelle/world.json', import.meta.url), 'utf8'));
  assert.ok(!world.settings.voiceAlways, 'la bêta : un worker ne vient que si des joueurs sont dans le vocal');
  const engine = new Engine(world);
  const channels = Object.fromEntries(world.buildings.map((b: { id: string }) => [b.id, { voice: `vc-${b.id}` }]));
  const plan = (occupied: string[]) => desiredPresences({ serverId: 's', guildId: 'g1', engine, channels, occupancy: new Map(occupied.map((b) => [`vc-${b}`, 1])) });

  assert.deepEqual(plan([]), [], 'personne dans les vocaux : aucun worker');
  const taverne = plan(['taverne']);
  assert.deepEqual(taverne.map((p) => [p.identity.name, p.holder, p.ambience]), [['Edgar Brassebarbe', true, 'taverne-calme']]);
  assert.equal(taverne[0]!.welcome, 'edgar-bienvenue');
  // Le pont n'a pas de personnage : le worker prend le nom du lieu et joue l'ambiance.
  assert.deepEqual(plan(['pont']).map((p) => [p.identity.name, p.holder, p.ambience]), [['Vieux pont de Valbrume', true, 'pont-calme']]);
  assert.equal(voiceNeed(engine, channels), 8, 'tous les vocaux occupés : 7 personnages + le pont');

  // Messe : tous les PNJ rejoignent l'église ; on les voit dans son salon vocal, Anselme garde l'ambiance.
  engine.setVariable('t', 170);
  const messe = plan(['eglise', 'taverne']);
  const eglise = messe.filter((p) => p.building === 'eglise');
  assert.equal(eglise.length, 7, 'les 7 PNJ à l’église');
  assert.deepEqual(eglise.filter((p) => p.holder).map((p) => p.identity.name), ['Père Anselme']);
  assert.ok(eglise.filter((p) => !p.holder).every((p) => p.ambience === undefined), 'les invités ne jouent pas l’ambiance');
  assert.deepEqual(messe.filter((p) => p.building === 'taverne').map((p) => [p.identity.name, p.holder]), [['À la Gueuse Cocue', true]], 'Edgar parti : la taverne garde son ambiance, au nom du lieu');
  assert.equal(new Set(messe.map((p) => p.key)).size, messe.length, 'une présence par personnage');
});

test('personnages : un PNJ qui se déplace garde son worker, qui change de salon', async () => {
  const p = pool(2);
  const base = { guildId: 'g1', serverId: 's', building: 'forge', identity: { name: 'Wagner' }, volume: 0.6 };
  const a = p.reconcile([{ ...base, key: 's:pnj:wagner', channelId: 'vc-forge', character: 'wagner', holder: true, ambience: 'forge-calme' }], 0);
  const worker = a.assign[0]!.worker;
  const b = p.reconcile([{ ...base, key: 's:pnj:wagner', channelId: 'vc-eglise', building: 'eglise', character: 'wagner', holder: false }], 1000);
  assert.deepEqual(b.update.map((u) => [u.worker, u.presence.channelId]), [[worker, 'vc-eglise']], 'même worker, nouveau salon');
  assert.equal(b.assign.length, 0);
});

test('personnages : le PNJ du lieu revient, la présence au nom du lieu part tout de suite (pas de double ambiance)', () => {
  const p = pool(2);
  const base = { guildId: 'g1', serverId: 's', channelId: 'vc-taverne', building: 'taverne', volume: 0.6, holder: true, ambience: 'taverne-calme' };
  p.reconcile([{ ...base, key: 's:lieu:taverne', identity: { name: 'À la Gueuse Cocue' } }], 0);
  const back = p.reconcile([{ ...base, key: 's:pnj:edgar', character: 'edgar', identity: { name: 'Edgar Brassebarbe' } }], 1000);
  assert.deepEqual(back.release.map((r) => r.presenceKey), ['s:lieu:taverne']);
  assert.equal(back.assign.length, 1);
});

test('ancien format (sans liste de personnages) : le PNJ de chaque bâtiment avec audio', () => {
  const { engine } = makeEngine();
  assert.ok(!engine.world.characters);
  const [p] = desiredPresences({ serverId: 's', guildId: 'g1', engine, channels: { taverne: { voice: 'vc1' } }, occupancy: new Map([['vc1', 1]]) });
  assert.equal(p!.identity.name, 'Edgar Brassebarbe');
  assert.equal(p!.holder, true);
  assert.equal(p!.character, 'npc:taverne');
});

test('finale : silence après le cri, Roland s’en va sans délai, puis musique d’attente et message en boucle là où il y a des joueurs', async () => {
  const { readFileSync } = await import('node:fs');
  const { Engine } = await import('../../../packages/engine/src/index.ts');
  const { departedKeys } = await import('../src/voice/planner.ts');
  const world = JSON.parse(readFileSync(new URL('../../../content/sainte-pelle/world.json', import.meta.url), 'utf8'));
  const engine = new Engine(world);
  const channels = Object.fromEntries(world.buildings.map((b: { id: string }) => [b.id, { voice: `vc-${b.id}` }]));
  const plan = (occupied: string[]) => desiredPresences({ serverId: 's', guildId: 'g1', engine, channels, occupancy: new Map(occupied.map((b) => [`vc-${b}`, 1])) });
  engine.setVariable('t', 182);
  engine.setVariable('acte', 'apocalypse');
  engine.setVariable('apocalypse', 'cri');
  assert.ok(plan(['eglise', 'mine']).every((p) => p.ambience === undefined), 'silence total');
  engine.setVariable('apocalypse', 'panique');
  assert.deepEqual([...departedKeys(engine, 's')], ['s:pnj:roland'], 'Roland est parti');
  assert.equal(plan(['eglise']).length, 6, 'les 6 autres PNJ restent pour hurler');
  // Le pool libère Roland tout de suite (pas de délai de grâce).
  const p = pool(1);
  const base = { guildId: 'g1', serverId: 's', channelId: 'vc-eglise', building: 'eglise', identity: { name: 'Roland' }, volume: 0.6, character: 'roland' };
  p.reconcile([{ ...base, key: 's:pnj:roland' }], 0);
  assert.equal(p.reconcile([], 1000, departedKeys(engine, 's')).release.length, 1);
  // Attente : plus aucun PNJ ; un worker au nom du lieu là où il y a des joueurs, musique + message toutes les 20 s.
  engine.setVariable('apocalypse', 'attente');
  engine.setVariable('monde', 'ferme');
  const attente = plan(['eglise', 'mine']);
  assert.deepEqual(attente.map((x) => [x.identity.name, x.ambience, x.message?.sound, x.message?.every]), [
    ['Mine de Roland', 'fin-attente', 'fin-rejoindre-aide', 20],
    ['Église de la Sainte Pelle', 'fin-attente', 'fin-rejoindre-aide', 20],
  ]);
  assert.deepEqual(plan([]), [], 'personne : personne');
});
