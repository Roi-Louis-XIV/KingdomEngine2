import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';

const root = new URL('../../../', import.meta.url).pathname;
let tmp: string;
let app: ReturnType<typeof createApp>;
let base: string;

/** Client HTTP avec cookie de session, comme le Studio. */
class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-kingdom': '1' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data: data as any };
  }
  get = (p: string) => this.call('GET', p);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.call('POST', p, b ?? {}, h);
  put = (p: string, b?: unknown) => this.call('PUT', p, b ?? {});
  del = (p: string, b?: unknown) => this.call('DELETE', p, b ?? {});
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'kingdom-'));
  app = createApp({ dbPath: join(tmp, 'k.db'), contentDir: join(root, 'content'), audioDir: join(tmp, 'audio'), allowRegistration: false });
  const srv = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});
after(() => {
  app.close();
  rmSync(tmp, { recursive: true, force: true });
});

const admin = new Client();
const louis = new Client();
const intrus = new Client();
let serverId = '';

test('premier lancement : le premier compte devient administrateur, puis les inscriptions se ferment', async () => {
  assert.equal((await admin.get('/api/session')).data.firstRun, true);
  const r = await admin.post('/api/auth/register', { username: 'roi', password: 'motdepasse-solide' });
  assert.equal(r.status, 200);
  assert.equal(r.data.account.platformRole, 'platform_admin');
  assert.match(admin.cookie, /^kingdom_session=/);
  const closed = await intrus.post('/api/auth/register', { username: 'pirate', password: 'motdepasse-solide' });
  assert.equal(closed.status, 403);
});

test('sécurité : écriture sans en-tête Studio refusée, mauvais mot de passe refusé', async () => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 403);
  assert.equal((await intrus.post('/api/auth/login', { username: 'roi', password: 'faux-mot-de-passe' })).status, 401);
  assert.equal((await intrus.get('/api/servers/x/overview')).status, 401);
});

test('comptes : l’admin crée un compte, qui se connecte', async () => {
  assert.equal((await admin.post('/api/admin/accounts', { username: 'louis', password: 'motdepasse-louis' })).status, 200);
  assert.equal((await louis.post('/api/auth/login', { username: 'louis', password: 'motdepasse-louis', remember: true })).status, 200);
  assert.equal((await louis.get('/api/admin/overview')).status, 403, 'pas d’accès à l’administration');
  await intrus.post('/api/admin/accounts', {});
  assert.equal((await admin.post('/api/admin/accounts', { username: 'mallory', password: 'motdepasse-mallory' })).status, 200);
  assert.equal((await intrus.post('/api/auth/login', { username: 'mallory', password: 'motdepasse-mallory' })).status, 200);
});

test('serveurs : création depuis un modèle, unicité Discord, isolation entre comptes', async () => {
  const t = await louis.get('/api/templates');
  assert.ok(t.data.some((x: any) => x.id === 'le-royaume'));
  const r = await louis.post('/api/servers', { name: 'Le Royaume de Louis', guildId: '123456789012345678', template: 'le-royaume' });
  assert.equal(r.status, 200);
  serverId = r.data.id;
  assert.equal(serverId, 'le-royaume-de-louis');
  const dup = await intrus.post('/api/servers', { name: 'Copie', guildId: '123456789012345678', template: 'vierge' });
  assert.equal(dup.status, 409);
  assert.equal((await intrus.get(`/api/servers/${serverId}/overview`)).status, 404, 'invisible pour un autre compte');
  const session = await louis.get('/api/session');
  assert.deepEqual(session.data.servers.map((s: any) => [s.id, s.role]), [[serverId, 'owner']]);
});

test('supervision : vue d’ensemble avec bâtiments, réserves, alertes et variables', async () => {
  const o = await louis.get(`/api/servers/${serverId}/overview`);
  assert.equal(o.status, 200);
  assert.equal(o.data.counts.buildings, 1);
  assert.equal(o.data.buildings[0].name, 'À la Gueuse Cocue');
  assert.ok(o.data.alerts.some((a: any) => /rupture/.test(a.text)));
  assert.deepEqual(o.data.variables.map((v: any) => [v.id, v.value]), [['phase', 'calme']]);
});

test('jeu → supervision : un joueur agit sur Discord, la fiche et l’activité le montrent', async () => {
  const rt = app.runtimes;
  const { sessionId, view } = rt.open(serverId, { id: '42', name: 'Perceval' }, 'taverne');
  const find = (label: string) => JSON.stringify(view.message).match(new RegExp(`"label":"${label}","style":"\\w+","customId":"([^"]+)"`))![1]!;
  assert.ok(sessionId);
  const res = rt.interact(serverId, { id: '42', name: 'Perceval' }, find('Devenir cuisinier'), []);
  const accept = JSON.stringify(res.message).match(/"label":"Accepter le métier","style":"\w+","customId":"([^"]+)"/)![1]!;
  rt.interact(serverId, { id: '42', name: 'Perceval' }, accept, []);
  const players = await louis.get(`/api/servers/${serverId}/players`);
  assert.deepEqual(players.data.map((p: any) => [p.name, p.activeJobs]), [['Perceval', ['cuisinier']]]);
  const act = await louis.get(`/api/servers/${serverId}/activity`);
  assert.match(act.data[0].text, /Bienvenue aux fourneaux/);
  assert.equal(act.data[0].playerName, 'Perceval');
});

test('interventions : actions auditées, atomiques, droits gestionnaire requis', async () => {
  const r = await louis.post(`/api/servers/${serverId}/players/42/actions`, {
    actions: [
      { type: 'stat.add', stat: 'ecus', amount: 50 },
      { type: 'job.setLevel', job: 'cuisinier', level: 3 },
    ],
    reason: 'compensation',
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.state.stats.ecus, 150);
  assert.equal(r.data.state.jobs.cuisinier.level, 3);
  const bad = await louis.post(`/api/servers/${serverId}/players/42/actions`, {
    actions: [
      { type: 'stat.add', stat: 'ecus', amount: 10 },
      { type: 'item.take', item: 'vin', qty: 99 },
    ],
  });
  assert.equal(bad.status, 400);
  const p = await louis.get(`/api/servers/${serverId}/players/42`);
  assert.equal(p.data.state.stats.ecus, 150, 'rien n’a été appliqué');
  const forbidden = await louis.post(`/api/servers/${serverId}/players/42/actions`, { actions: [{ type: 'variable.set', variable: 'phase', value: 'tempete' }] });
  assert.equal(forbidden.status, 400);
  const audit = await louis.get(`/api/servers/${serverId}/audit`);
  assert.match(audit.data[0].summary, /Perceval : ecus \+50, cuisinier niveau 3 \(compensation\)/);
});

test('variables : changer la phase du scénario depuis le Studio', async () => {
  assert.equal((await louis.post(`/api/servers/${serverId}/variables`, { variable: 'phase', value: 'tempete' })).status, 200);
  assert.equal(app.runtimes.engine(serverId)!.variables.phase, 'tempete');
  assert.equal((await louis.post(`/api/servers/${serverId}/variables`, { variable: 'phase', value: 'apocalypse' })).status, 400);
});

test('contenu : brouillon, conflit 409, validation 422, publication à chaud sans perte de progression', async () => {
  const d = await louis.get(`/api/servers/${serverId}/content/draft`);
  assert.equal(d.data.revision, 0);
  const world = d.data.world;
  world.buildings[0].name = 'À la Gueuse Cocue (rénovée)';
  const s1 = await louis.put(`/api/servers/${serverId}/content/draft`, { world, revision: 0 });
  assert.equal(s1.data.revision, 1);
  const conflict = await louis.put(`/api/servers/${serverId}/content/draft`, { world, revision: 0 });
  assert.equal(conflict.status, 409);

  const broken = structuredClone(world);
  broken.buildings[0].homeScreen = 'inexistant';
  await louis.put(`/api/servers/${serverId}/content/draft`, { world: broken, revision: 1 });
  const refused = await louis.post(`/api/servers/${serverId}/content/publish`, { revision: 2 });
  assert.equal(refused.status, 422);
  assert.match(refused.data.issues[0].message, /écran inconnu/);

  await louis.put(`/api/servers/${serverId}/content/draft`, { world, revision: 2 });
  const pub = await louis.post(`/api/servers/${serverId}/content/publish`, { revision: 3, note: 'Rénovation' });
  assert.equal(pub.status, 200);
  assert.equal(pub.data.version, 2);
  const engine = app.runtimes.engine(serverId)!;
  assert.equal(engine.world.buildings[0]!.name, 'À la Gueuse Cocue (rénovée)');
  assert.equal(engine.player('42')!.jobs.cuisinier!.level, 3, 'progression conservée');
  assert.equal(engine.variables.phase, 'tempete');
  const versions = await louis.get(`/api/servers/${serverId}/content`);
  assert.deepEqual(versions.data.versions.map((v: any) => v.status), ['published', 'archived']);
});

test('droits : un éditeur publie mais n’intervient pas sur les joueurs', async () => {
  assert.equal((await louis.put(`/api/servers/${serverId}/members`, { username: 'mallory', role: 'editor' })).status, 200);
  assert.equal((await intrus.get(`/api/servers/${serverId}/overview`)).status, 200);
  const r = await intrus.post(`/api/servers/${serverId}/players/42/actions`, { actions: [{ type: 'stat.add', stat: 'ecus', amount: 1000 }] });
  assert.equal(r.status, 403);
  const lastOwner = await louis.put(`/api/servers/${serverId}/members`, { username: 'louis', role: 'viewer' });
  assert.equal(lastOwner.status, 400, 'il reste toujours un propriétaire');
});

test('médiathèque : import, lecture, sons manquants signalés', async () => {
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  const up = await louis.post(`/api/servers/${serverId}/audio?name=Taverne%20calme&kind=ambience&key=taverne-calme`, bytes, { 'content-type': 'audio/mpeg' });
  assert.equal(up.status, 200);
  assert.equal(up.data.key, 'taverne-calme');
  const list = await louis.get(`/api/servers/${serverId}/audio`);
  assert.deepEqual(list.data.sounds.map((s: any) => s.key), ['taverne-calme']);
  assert.ok(list.data.missing.includes('taverne-tempete'));
  assert.ok(list.data.missing.includes('chope-servie'));
  assert.ok(!list.data.missing.includes('taverne-calme'));
  const file = await louis.get(`/api/servers/${serverId}/audio/taverne-calme/file`);
  assert.equal(file.status, 200);
  assert.equal((file.data as ArrayBuffer).byteLength, bytes.length);
  const bad = await louis.post(`/api/servers/${serverId}/audio?name=x`, bytes, { 'content-type': 'image/png' });
  assert.equal(bad.status, 415);
});

test('suppression d’un serveur : confirmation par le nom', async () => {
  const s = await louis.post('/api/servers', { name: 'Brouillon', template: 'vierge' });
  assert.equal((await louis.del(`/api/servers/${s.data.id}`, { confirm: 'brouillon' })).status, 400);
  assert.equal((await louis.del(`/api/servers/${s.data.id}`, { confirm: 'Brouillon' })).status, 200);
  assert.equal((await louis.get(`/api/servers/${s.data.id}`)).status, 404);
});

test('déconnexion', async () => {
  await louis.post('/api/auth/logout');
  assert.equal((await louis.get(`/api/servers/${serverId}/overview`)).status, 401);
});
