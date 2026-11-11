/**
 * Comptes : connexion avec Discord (faux Discord), profil sécurisé, sessions, jetons d'accès,
 * serveur MCP pour les IA et statistiques pour RoyaumeOS.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { applyPatch, renderText } from '../src/mcp.ts';

const root = new URL('../../../', import.meta.url).pathname;
let tmp: string;
let app: ReturnType<typeof createApp>;
let base: string;
let statsBase: string;
let clock = Date.UTC(2026, 10, 11, 12, 0);
const STATS_TOKEN = 's'.repeat(40);

// Faux Discord : le code « code-<id> » donne le profil de cet identifiant.
const discordUsers: Record<string, { id: string; username: string; global_name: string; avatar: string | null }> = {
  '111111111111111111': { id: '111111111111111111', username: 'louis', global_name: 'Louis', avatar: 'a'.repeat(32) },
  '222222222222222222': { id: '222222222222222222', username: 'inconnu', global_name: 'Inconnu', avatar: null },
  '333333333333333333': { id: '333333333333333333', username: 'nouveau', global_name: 'Nouvelle Recrue', avatar: null },
};
const discordCalls: string[] = [];
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  discordCalls.push(u);
  if (u.endsWith('/oauth2/token')) {
    const body = new URLSearchParams(String(init?.body));
    assert.match(String((init?.headers as Record<string, string>).authorization), /^Basic /);
    assert.equal(body.get('redirect_uri'), `${base}/api/auth/discord/callback`);
    const code = body.get('code') ?? '';
    if (!code.startsWith('code-')) return new Response('{}', { status: 400 });
    return Response.json({ access_token: `tok-${code.slice(5)}`, token_type: 'Bearer' });
  }
  if (u.endsWith('/users/@me')) {
    const id = String((init?.headers as Record<string, string>).authorization).replace('Bearer tok-', '');
    return discordUsers[id] ? Response.json(discordUsers[id]) : new Response('{}', { status: 401 });
  }
  return new Response('?', { status: 404 });
}) as typeof fetch;

class Client {
  cookies: Record<string, string> = {};
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch((path.startsWith('http') ? '' : base) + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-kingdom': '1' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      const k = pair!.slice(0, i);
      const v = pair!.slice(i + 1);
      if (v) this.cookies[k] = v;
      else delete this.cookies[k];
    }
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data: data as any, headers: res.headers };
  }
  get = (p: string, h?: Record<string, string>) => this.call('GET', p, undefined, h);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.call('POST', p, b ?? {}, h);
  put = (p: string, b?: unknown) => this.call('PUT', p, b ?? {});
  del = (p: string, b?: unknown) => this.call('DELETE', p, b ?? {});

  /** Parcours complet « Se connecter avec Discord ». */
  async discord(discordId: string, mode: 'login' | 'link' = 'login') {
    const start = await this.get(`/api/auth/discord/start?mode=${mode}`);
    assert.equal(start.status, 302, JSON.stringify(start.data));
    const to = new URL(start.headers.get('location')!);
    assert.equal(to.origin, 'https://discord.com');
    assert.equal(to.searchParams.get('scope'), 'identify');
    const state = to.searchParams.get('state')!;
    assert.equal(this.cookies.kingdom_oauth, state);
    // Au retour de Discord, le cookie de session (SameSite=Strict) n'est pas envoyé : on le retire comme le ferait le navigateur.
    const session = this.cookies.kingdom_session;
    delete this.cookies.kingdom_session;
    const back = await this.get(`/api/auth/discord/callback?code=code-${discordId}&state=${state}`);
    if (!this.cookies.kingdom_session && session) this.cookies.kingdom_session = session;
    return back;
  }
}

async function mcp(token: string | null, method: string, params?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}
const call = async (token: string, name: string, args: unknown = {}) => {
  const r = await mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(r.status, 200);
  return { text: r.data.result.content[0].text as string, error: !!r.data.result.isError };
};

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'kingdom-acc-'));
  app = createApp({
    dbPath: join(tmp, 'k.db'),
    contentDir: join(root, 'content'),
    audioDir: join(tmp, 'audio'),
    allowRegistration: false,
    now: () => clock,
    discordOAuth: { clientId: '999', clientSecret: 'secret', fetch: fakeFetch },
    statsToken: STATS_TOKEN,
    version: '4.test',
  });
  const srv = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const st = await app.listenStats(0, '127.0.0.1');
  statsBase = `http://127.0.0.1:${(st.address() as { port: number }).port}`;
});
after(() => {
  app.close();
  rmSync(tmp, { recursive: true, force: true });
});

const roi = new Client();
const louis = new Client();
const recrue = new Client();
let worldId = '';
let readToken = '';
let draftToken = '';
let publishToken = '';

test('le Studio annonce la connexion Discord ; un compte Discord inconnu est refusé quand les inscriptions sont fermées', async () => {
  await roi.post('/api/auth/register', { username: 'roi', password: 'motdepasse-solide' });
  assert.equal((await roi.get('/api/session')).data.discordLogin, true);
  const r = await new Client().discord('222222222222222222');
  assert.equal(r.status, 200);
  assert.match(r.data, /erreur=/);
  assert.match(decodeURIComponent(r.data), /Aucun compte KingdomEngine/);
});

test('connexion Discord : état lié au navigateur, usage unique', async () => {
  const c = new Client();
  const start = await c.get('/api/auth/discord/start');
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  // Autre navigateur (pas de cookie) : refusé.
  const other = await new Client().get(`/api/auth/discord/callback?code=code-111111111111111111&state=${state}`);
  assert.match(decodeURIComponent(other.data), /autre navigateur/);
  // Lien imposé avec un état inventé : refusé.
  c.cookies.kingdom_oauth = 'invente';
  const forged = await c.get(`/api/auth/discord/callback?code=code-111111111111111111&state=invente`);
  assert.match(decodeURIComponent(forged.data), /expirée|interrompue/);
  assert.equal(c.cookies.kingdom_session, undefined);
  assert.match(start.headers.getSetCookie().join(), /kingdom_oauth=.*SameSite=Lax/);
});

test("l'administrateur crée un compte par identifiant Discord, sans mot de passe ; la personne se connecte avec Discord", async () => {
  const created = await roi.post('/api/admin/accounts', { username: 'louis', discordId: '111111111111111111', displayName: 'Louis' });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.hasPassword, false);
  assert.equal((await roi.post('/api/admin/accounts', { username: 'sansrien' })).status, 400);
  // Pas de mot de passe : la connexion par identifiant explique quoi faire.
  const pw = await new Client().post('/api/auth/login', { username: 'louis', password: 'nimportequoi' });
  assert.equal(pw.status, 401);
  assert.match(pw.data.error, /Discord/);

  const back = await louis.discord('111111111111111111');
  assert.match(back.data, /location\.replace\("\/"\)/);
  assert.match(back.headers.get('content-security-policy')!, /default-src 'none'/);
  const s = await louis.get('/api/session');
  assert.equal(s.data.account.username, 'louis');
  assert.equal(s.data.account.discordId, '111111111111111111');
  assert.equal(s.data.account.discordName, 'Louis (@louis)');
  assert.match(s.data.account.avatarUrl, /^https:\/\/cdn\.discordapp\.com\/avatars\/111111111111111111\//);
  assert.ok(!JSON.stringify(s.data).includes('tok-'), 'le jeton Discord n’est jamais conservé ni renvoyé');
});

test('inscriptions ouvertes : un nouveau venu crée son compte en un clic avec Discord', async () => {
  app.platform.opts.allowRegistration = true;
  try {
    const back = await recrue.discord('333333333333333333');
    assert.match(decodeURIComponent(back.data), /Ton compte a été créé avec Discord/);
    const s = await recrue.get('/api/session');
    assert.equal(s.data.account.username, 'nouveau');
    assert.equal(s.data.account.displayName, 'Nouvelle Recrue');
    assert.equal(s.data.account.platformRole, 'user');
  } finally {
    app.platform.opts.allowRegistration = false;
  }
});

test('profil : changer le mot de passe exige le mot de passe actuel et ferme les autres sessions', async () => {
  const autre = new Client();
  await autre.post('/api/auth/login', { username: 'roi', password: 'motdepasse-solide' });
  assert.equal((await roi.post('/api/auth/password', { password: 'nouveau-secret-1' })).status, 403);
  assert.equal((await roi.post('/api/auth/password', { current: 'faux-mot-de-passe', password: 'nouveau-secret-1' })).status, 403);
  assert.equal((await roi.post('/api/auth/password', { current: 'motdepasse-solide', password: 'court' })).status, 400);
  const ok = await roi.post('/api/auth/password', { current: 'motdepasse-solide', password: 'nouveau-secret-1' });
  assert.equal(ok.status, 200);
  assert.equal((await roi.get('/api/session')).data.account.username, 'roi', 'la session actuelle reste ouverte');
  assert.equal((await autre.get('/api/session')).data.account, null, 'les autres appareils sont déconnectés');
});

test('compte sans mot de passe : la confirmation se fait par une connexion Discord récente', async () => {
  // Session ouverte à l'instant : définir un mot de passe est accepté.
  assert.equal((await louis.post('/api/auth/password', { password: 'secret-de-louis' })).status, 200);
  assert.equal((await louis.get('/api/profile')).data.account.hasPassword, true);
  // Retirer le mot de passe demande le mot de passe actuel.
  assert.equal((await louis.del('/api/profile/password', {})).status, 403);
  assert.equal((await louis.del('/api/profile/password', { current: 'secret-de-louis' })).status, 200);
  // 20 minutes plus tard : il faut se reconnecter avec Discord.
  clock += 20 * 60_000;
  const late = await louis.post('/api/auth/password', { password: 'secret-de-louis-2' });
  assert.equal(late.status, 403);
  assert.equal(late.data.reauth, true);
  await louis.discord('111111111111111111');
  assert.equal((await louis.post('/api/auth/password', { password: 'secret-de-louis-2' })).status, 200);
  // Détacher Discord : possible seulement avec un mot de passe, et après confirmation.
  assert.equal((await louis.post('/api/auth/discord/unlink', { password: 'mauvais' })).status, 403);
  // Relier un compte Discord déjà pris : refusé.
  const taken = await roi.discord('111111111111111111', 'link');
  assert.match(decodeURIComponent(taken.data), /déjà relié/);
});

test('profil : nom affiché, identifiant (avec confirmation), appareils connectés', async () => {
  assert.equal((await louis.put('/api/profile', { displayName: '  Louis XIV  ' })).data.account.displayName, 'Louis XIV');
  assert.equal((await louis.put('/api/profile', { username: 'roi' })).status, 403, 'changer d’identifiant demande le mot de passe');
  assert.equal((await louis.put('/api/profile', { username: 'roi', password: 'secret-de-louis-2' })).status, 409);
  await new Client().post('/api/auth/login', { username: 'louis', password: 'secret-de-louis-2' }, { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Firefox/130.0' });
  const p = await louis.get('/api/profile');
  assert.equal(p.data.sessions.length, 2);
  assert.equal(p.data.sessions.find((s: any) => !s.current).device, 'Firefox · Windows');
  const current = p.data.sessions.find((s: any) => s.current);
  assert.equal(current.method, 'discord');
  assert.ok(!JSON.stringify(p.data.sessions).includes('token'), 'aucun jeton de session renvoyé');
  const other = p.data.sessions.find((s: any) => !s.current);
  assert.equal((await louis.del(`/api/profile/sessions/${other.id}`)).status, 200);
  assert.equal((await louis.del(`/api/profile/sessions/${other.id}`)).status, 404);
  assert.equal((await louis.post('/api/profile/sessions/revoke-others')).status, 200);
  assert.equal((await louis.get('/api/profile')).data.sessions.length, 1);
});

test("jetons d'accès : création confirmée par mot de passe, affichés une seule fois, révocables", async () => {
  const s = await louis.post('/api/servers', { name: 'Monde IA', template: 'le-royaume' });
  worldId = s.data.id;
  assert.equal((await louis.post('/api/profile/tokens', { name: 'Claude', access: 'read' })).status, 403);
  const r = await louis.post('/api/profile/tokens', { name: 'Claude lecture', access: 'read', days: 30, password: 'secret-de-louis-2' });
  assert.equal(r.status, 200);
  readToken = r.data.token;
  assert.match(readToken, /^ke4_/);
  draftToken = (await louis.post('/api/profile/tokens', { name: 'Claude brouillon', access: 'draft', password: 'secret-de-louis-2' })).data.token;
  publishToken = (await louis.post('/api/profile/tokens', { name: 'Claude publication', access: 'publish', password: 'secret-de-louis-2' })).data.token;
  const list = (await louis.get('/api/profile')).data.tokens;
  assert.equal(list.length, 3);
  assert.ok(!JSON.stringify(list).includes(readToken), 'le jeton complet n’est jamais relu');
  assert.ok(list.find((t: any) => t.name === 'Claude lecture').expiresAt > clock);
});

test('MCP : sans jeton, avec un cookie ou depuis une page web étrangère, rien ne passe', async () => {
  const anon = await mcp(null, 'initialize');
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get('www-authenticate')!, /Bearer/);
  // Le cookie de session n'ouvre pas le MCP (pas de CSRF possible).
  const cookie = Object.entries(louis.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  assert.equal((await mcp(null, 'tools/list', undefined, { cookie })).status, 401);
  assert.equal((await mcp(readToken, 'tools/list', undefined, { origin: 'https://site-malveillant.example' })).status, 403);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
});

test('MCP : initialisation, outils selon le niveau du jeton', async () => {
  const init = await mcp(readToken, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.data.result.protocolVersion, '2025-06-18');
  assert.equal(init.data.result.serverInfo.name, 'kingdomengine');
  assert.match(init.data.result.instructions, /get_guide/);
  const notif = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${readToken}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(notif.status, 202);
  const names = (t: string) => mcp(t, 'tools/list').then((r) => r.data.result.tools.map((x: any) => x.name) as string[]);
  const read = await names(readToken);
  assert.ok(read.includes('get_world_outline') && read.includes('preview_play'));
  assert.ok(!read.includes('patch_draft') && !read.includes('publish_draft'));
  assert.ok((await names(draftToken)).includes('patch_draft'));
  assert.ok(!(await names(draftToken)).includes('publish_draft'));
  assert.ok((await names(publishToken)).includes('publish_draft'));
  const denied = await call(readToken, 'patch_draft', { world_id: worldId, revision: 0, operations: [] });
  assert.equal(denied.error, true);
  assert.match(denied.text, /ne permet pas/);
});

test('MCP : lire un monde (plan, partie, guide, modèle), vérifier, essayer', async () => {
  const worlds = JSON.parse((await call(readToken, 'list_worlds')).text);
  assert.equal(worlds[0].world_id, worldId);
  const plan = JSON.parse((await call(readToken, 'get_world_outline', { world_id: worldId })).text);
  assert.equal(plan.revision, 0);
  assert.ok(plan.buildings.some((b: any) => b.id === 'taverne'));
  const taverne = plan.buildings.find((b: any) => b.id === 'taverne');
  const part = await call(readToken, 'get_world', { world_id: worldId, pointer: `/buildings/${taverne.index}/name` });
  assert.match(part.text, /révision du brouillon : 0/);
  assert.match((await call(readToken, 'get_world', { world_id: worldId, pointer: '/nexiste/pas' })).text, /Rien à l’emplacement/);
  assert.match((await call(readToken, 'get_guide')).text, /preview_play/);
  assert.match((await call(readToken, 'get_reference')).text, /export interface WorldDef/);
  assert.equal((await call(readToken, 'validate_world', { world_id: worldId })).error, false);
  // Un autre compte (non administrateur) ne voit pas ce monde.
  await recrue.discord('333333333333333333'); // connexion récente : vaut confirmation pour un compte sans mot de passe
  const otherToken = (await recrue.post('/api/profile/tokens', { name: 'x', access: 'read' })).data.token;
  const hidden = await call(otherToken, 'get_world_outline', { world_id: worldId });
  assert.equal(hidden.error, true);
  assert.equal(JSON.parse((await call(otherToken, 'list_worlds')).text.startsWith('[') ? (await call(otherToken, 'list_worlds')).text : '[]').length, 0);

  const play = await call(readToken, 'preview_play', { world_id: worldId, building: 'taverne' });
  assert.equal(play.error, false, play.text);
  assert.match(play.text, /## Écran affiché/);
  assert.match(play.text, /Bouton « /);
  const first = /Bouton « ([^»]+) »/.exec(play.text)![1]!.trim();
  const after = await call(readToken, 'preview_play', { world_id: worldId, building: 'taverne', steps: [{ press: first }, { wait_minutes: 5 }] });
  assert.equal(after.error, false, after.text);
  assert.match(after.text, new RegExp(`clic sur « ${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} »`));
  const wrong = await call(readToken, 'preview_play', { world_id: worldId, building: 'taverne', steps: [{ press: 'Bouton imaginaire' }] });
  assert.equal(wrong.error, true);
  assert.match(wrong.text, /Disponibles/);
});

test('MCP : modifier le brouillon par petites opérations, protégé contre les modifications simultanées', async () => {
  const plan = JSON.parse((await call(draftToken, 'get_world_outline', { world_id: worldId })).text);
  const i = plan.buildings.find((b: any) => b.id === 'taverne').index;
  const r = await call(draftToken, 'patch_draft', { world_id: worldId, revision: 0, operations: [{ op: 'set', path: `/buildings/${i}/name`, value: 'La Taverne de l’IA' }] });
  assert.equal(r.error, false, r.text);
  assert.match(r.text, /révision 1/);
  // Révision périmée (quelqu'un a enregistré entre-temps) : refusé, rien n'est écrit.
  const stale = await call(draftToken, 'patch_draft', { world_id: worldId, revision: 0, operations: [{ op: 'set', path: `/buildings/${i}/name`, value: 'Écrasé' }] });
  assert.equal(stale.error, true);
  assert.match(stale.text, /a changé/);
  // Une opération fautive annule tout l'appel.
  const bad = await call(draftToken, 'patch_draft', { world_id: worldId, revision: 1, operations: [{ op: 'set', path: `/buildings/${i}/emoji`, value: '🧪' }, { op: 'remove', path: '/items/9999' }] });
  assert.equal(bad.error, true);
  const d = (await louis.get(`/api/servers/${worldId}/content/draft`)).data;
  assert.equal(d.revision, 1);
  assert.equal(d.world.buildings[i].name, 'La Taverne de l’IA');
  assert.notEqual(d.world.buildings[i].emoji, '🧪');
  // Le journal garde la trace de l'IA.
  const audit = (await louis.get(`/api/servers/${worldId}/audit`)).data;
  assert.ok(audit.some((a: any) => a.kind === 'mcp.write'));
  // Publication : jeton « publication » seulement.
  assert.equal((await call(draftToken, 'publish_draft', { world_id: worldId, revision: 1 })).error, true);
  const pub = await call(publishToken, 'publish_draft', { world_id: worldId, revision: 1, note: 'Nouveau nom' });
  assert.equal(pub.error, false, pub.text);
  assert.match(pub.text, /Version \d+ publiée/);
});

test('jeton révoqué ou expiré : refusé', async () => {
  const p = (await louis.get('/api/profile')).data;
  const t = p.tokens.find((x: any) => x.name === 'Claude brouillon');
  await louis.del(`/api/profile/tokens/${t.id}`);
  assert.equal((await mcp(draftToken, 'tools/list')).status, 401);
  clock += 31 * 86_400_000; // le jeton de lecture expirait après 30 jours
  assert.equal((await mcp(readToken, 'tools/list')).status, 401);
  assert.equal((await mcp(publishToken, 'tools/list')).status, 200);
});

test('statistiques RoyaumeOS : jeton obligatoire, chiffres agrégés sans données personnelles', async () => {
  assert.equal((await fetch(`${base}/api/stats`)).status, 401);
  assert.equal((await fetch(`${base}/api/stats`, { headers: { authorization: 'Bearer mauvais' } })).status, 401);
  // Le cookie d'un administrateur ne suffit pas.
  const cookie = Object.entries(roi.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  assert.equal((await fetch(`${base}/api/stats`, { headers: { cookie } })).status, 401);
  const res = await fetch(`${base}/api/stats`, { headers: { authorization: `Bearer ${STATS_TOKEN}` } });
  assert.equal(res.status, 200);
  const s = (await res.json()) as any;
  assert.equal(s.schema, 1);
  assert.equal(s.version, '4.test');
  assert.equal(s.accounts.total, 3);
  assert.equal(s.accounts.discordLinked, 2);
  assert.equal(s.worlds.total, 1);
  assert.equal(s.worlds.published, 1);
  assert.equal(s.worlds.live, 0, 'pas de Discord relié : le monde ne tourne pas');
  assert.equal(s.tokens.total, 3);
  assert.equal(s.worldList[0].name, 'Monde IA');
  const raw = JSON.stringify(s);
  for (const secret of ['louis', 'roi', '111111111111111111', 'nouveau']) assert.ok(!raw.includes(`"${secret}"`), `aucune donnée personnelle (${secret})`);
});

test("écoute dédiée aux statistiques : rien d'autre n'y est servi", async () => {
  assert.equal((await fetch(`${statsBase}/api/stats`, { headers: { authorization: `Bearer ${STATS_TOKEN}` } })).status, 200);
  assert.equal((await fetch(`${statsBase}/api/session`)).status, 404);
  assert.equal((await fetch(`${statsBase}/mcp`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${statsBase}/`)).status, 404);
});

test('supprimer son compte : refusé si l’on est seul propriétaire d’un monde', async () => {
  await louis.post('/api/auth/login', { username: 'louis', password: 'secret-de-louis-2' }); // la session précédente a expiré (horloge avancée)
  const r = await louis.del('/api/profile', { confirm: 'louis', password: 'secret-de-louis-2' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Monde IA/);
  // Un compte sans monde peut partir.
  clock += 1000;
  await recrue.discord('333333333333333333');
  assert.equal((await recrue.del('/api/profile', { confirm: 'mauvais' })).status, 400);
  assert.equal((await recrue.del('/api/profile', { confirm: 'nouveau' })).status, 200);
  assert.equal((await recrue.get('/api/session')).data.account, null);
});

test('opérations JSON : tout ou rien, clés dangereuses refusées', () => {
  const doc = { a: { b: [1, 2, 3] }, c: 'x' };
  assert.deepEqual(applyPatch(doc, [{ op: 'add', path: '/a/b/-', value: 4 }, { op: 'remove', path: '/a/b/0' }, { op: 'merge', path: '/a', value: { d: 1 } }]), { a: { b: [2, 3, 4], d: 1 }, c: 'x' });
  assert.deepEqual(doc, { a: { b: [1, 2, 3] }, c: 'x' }, 'le document d’origine est intact');
  assert.throws(() => applyPatch(doc, [{ op: 'set', path: '/__proto__/x', value: 1 }]), /interdite/);
  assert.throws(() => applyPatch(doc, [{ op: 'set', path: '/a/b/9', value: 1 }]), /absent/);
  assert.throws(() => applyPatch(doc, [{ op: 'set', path: '', value: 1 }]), /racine/);
  assert.equal(applyPatch({ a: { 'x/y': 1 } }, [{ op: 'set', path: '/a/x~1y', value: 2 }]).a['x/y'], 2);
});

test('rendu texte : boutons et menus lisibles par une IA', () => {
  const { text, controls } = renderText({
    components: [{ type: 'container', children: [{ type: 'text', content: '# Taverne' }, { type: 'row', items: [{ type: 'button', label: 'Boire', emoji: '🍺', style: 'primary', customId: 'x|b|s|0.0' }] }] }],
  });
  assert.match(text, /# Taverne/);
  assert.match(text, /\[🍺 Boire\]/);
  assert.deepEqual(controls[0], { kind: 'button', label: '🍺 Boire', id: 'x|b|s|0.0' });
});
