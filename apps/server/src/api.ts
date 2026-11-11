/** Routes de l'API du Studio. Chaque route vérifie le droit minimal sur le serveur concerné. */
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { urgency, validateWorld, type Action, type WorldDef } from '../../../packages/engine/src/index.ts';
import { FileReply, type Req, type Router } from './http.ts';
import { HttpError, ROLE_RANK, slugify, type Account, type Platform, type ServerRole } from './platform.ts';
import type { Runtimes } from './runtime.ts';
import type { DiscordBridge, VoiceBridge } from './bridges.ts';
import type { BuildingChannels } from './voice/planner.ts';

export interface ApiDeps {
  platform: Platform;
  runtimes: Runtimes;
  discord: DiscordBridge;
  voice: VoiceBridge;
  audioDir: string;
  version: string;
}

const AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/webm': '.webm',
};

const attempts = new Map<string, { n: number; until: number }>();
function throttle(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 10) throw new HttpError(429, 'Trop de tentatives. Réessaie dans quelques minutes.');
  if (!a || a.until <= now) attempts.set(key, { n: 1, until: now + 5 * 60_000 });
  else a.n += 1;
}

export function registerApi(router: Router, deps: ApiDeps) {
  const { platform, runtimes } = deps;

  const me = (r: Req): Account => {
    if (!r.account) throw new HttpError(401, 'Connexion requise.');
    return r.account;
  };
  const admin = (r: Req): Account => {
    const a = me(r);
    if (a.platformRole !== 'platform_admin') throw new HttpError(403, 'Réservé à l’administration de la plateforme.');
    return a;
  };
  const server = (r: Req, min: ServerRole) => platform.require(me(r), r.params.id!, min);
  const channelsOf = (serverId: string) => platform.setting<Record<string, BuildingChannels>>(serverId, 'discord.channels', {});

  // ---------------------------------------------------------------------------
  // Authentification
  // ---------------------------------------------------------------------------

  router.get('/api/health', () => ({ ok: true, version: deps.version }));

  router.get('/api/session', (r) => ({
    account: r.account ?? null,
    registration: platform.registrationOpen(),
    firstRun: platform.accountCount() === 0,
    servers: r.account ? platform.serversFor(r.account) : [],
    version: deps.version,
  }));

  router.post('/api/auth/login', (r) => {
    throttle(`login:${r.ip}`);
    const { token, account, maxAge } = platform.login(String(r.body.username ?? ''), String(r.body.password ?? ''), !!r.body.remember);
    r.setCookie('kingdom_session', token, { maxAge });
    attempts.delete(`login:${r.ip}`);
    return { account };
  });

  router.post('/api/auth/register', (r) => {
    if (!platform.registrationOpen()) throw new HttpError(403, 'Les inscriptions sont fermées sur cette installation.');
    throttle(`register:${r.ip}`);
    platform.createAccount({ username: String(r.body.username ?? ''), password: String(r.body.password ?? ''), displayName: r.body.displayName });
    const { token, account } = platform.login(String(r.body.username), String(r.body.password), false);
    r.setCookie('kingdom_session', token);
    return { account };
  });

  router.post('/api/auth/logout', (r) => {
    platform.logout(r.cookies.kingdom_session);
    r.setCookie('kingdom_session', '', { clear: true });
    return { ok: true };
  });

  router.post('/api/auth/password', (r) => {
    const a = me(r);
    platform.login(a.username, String(r.body.current ?? ''), false); // vérifie l'ancien mot de passe
    platform.setPassword(a.id, String(r.body.password ?? ''));
    r.setCookie('kingdom_session', '', { clear: true });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Serveurs
  // ---------------------------------------------------------------------------

  router.get('/api/templates', (r) => (me(r), platform.templates()));

  router.post('/api/servers', (r) => {
    const s = platform.createServer(me(r), { name: String(r.body.name ?? ''), guildId: r.body.guildId, template: String(r.body.template ?? 'vierge') });
    void deps.discord.syncBuildings(s.id, true).catch(() => {});
    return s;
  });

  router.get('/api/servers/:id', (r) => {
    const s = server(r, 'viewer');
    return { ...s, content: platform.contentStatus(s.id), members: ROLE_RANK[s.role] >= ROLE_RANK.owner ? platform.members(s.id) : undefined };
  });

  router.put('/api/servers/:id', (r) => {
    const s = server(r, 'owner');
    const out = platform.updateServer(s.id, me(r), { name: r.body.name, guildId: r.body.guildId });
    void deps.discord.syncBuildings(s.id, true).catch(() => {});
    deps.voice.refresh();
    return out;
  });

  router.delete('/api/servers/:id', (r) => {
    const s = server(r, 'owner');
    platform.deleteServer(s.id, String(r.body.confirm ?? ''));
    runtimes.unload(s.id);
    rmSync(join(deps.audioDir, s.id), { recursive: true, force: true });
    deps.voice.refresh();
    return { ok: true };
  });

  router.get('/api/servers/:id/members', (r) => platform.members(server(r, 'owner').id));
  router.put('/api/servers/:id/members', (r) => {
    const s = server(r, 'owner');
    platform.setMember(s.id, me(r), String(r.body.username ?? ''), r.body.role ?? null);
    return platform.members(s.id);
  });

  // ---------------------------------------------------------------------------
  // Contenu
  // ---------------------------------------------------------------------------

  router.get('/api/servers/:id/world', (r) => {
    const s = server(r, 'viewer');
    const pub = platform.published(s.id);
    return { version: pub?.version ?? null, world: pub?.world ?? null };
  });

  router.get('/api/servers/:id/content', (r) => {
    const s = server(r, 'viewer');
    return { ...platform.contentStatus(s.id), versions: platform.versions(s.id) };
  });

  router.get('/api/servers/:id/content/draft', (r) => {
    const s = server(r, 'viewer');
    const d = platform.draft(s.id);
    return { ...d, issues: validateWorld(d.world) };
  });

  router.put('/api/servers/:id/content/draft', (r) => {
    const s = server(r, 'editor');
    return platform.saveDraft(s.id, me(r), r.body.world as WorldDef, Number(r.body.revision ?? 0));
  });

  router.delete('/api/servers/:id/content/draft', (r) => {
    const s = server(r, 'editor');
    platform.discardDraft(s.id, me(r));
    return { ok: true };
  });

  router.post('/api/servers/:id/content/publish', async (r) => {
    const s = server(r, 'editor');
    const res = platform.publish(s.id, me(r), Number(r.body.revision ?? 0), r.body.note);
    runtimes.reload(s.id);
    deps.voice.refresh();
    let discordSync: string | null = null;
    try {
      await deps.discord.syncBuildings(s.id, true);
    } catch (e) {
      discordSync = (e as Error).message;
    }
    return { version: res.version, discordSync };
  });

  router.post('/api/servers/:id/content/restore', (r) => {
    const s = server(r, 'editor');
    return platform.restore(s.id, me(r), Number(r.body.version));
  });

  // ---------------------------------------------------------------------------
  // Supervision
  // ---------------------------------------------------------------------------

  router.get('/api/servers/:id/overview', (r) => {
    const s = server(r, 'viewer');
    const engine = runtimes.engine(s.id);
    const meta = platform.playerMeta(s.id);
    const now = Date.now();
    const content = platform.contentStatus(s.id);
    const alerts: { level: 'error' | 'warning' | 'info'; text: string; link?: string }[] = [];
    const channels = channelsOf(s.id);
    const d = deps.discord.status();
    if (!s.guildId) alerts.push({ level: 'warning', text: 'Aucun serveur Discord associé à ce monde.', link: 'discord' });
    else if (!d.online) alerts.push({ level: 'warning', text: 'Le bot principal KingdomEngine est hors ligne.', link: 'discord' });
    if (content.draft) alerts.push({ level: 'info', text: `Brouillon non publié (version ${content.draft.version}).`, link: 'publish' });
    const buildings = (engine?.world.buildings ?? []).map((b) => {
      const snap = engine!.snapshot();
      const stocks = b.modules
        .filter((m) => m.type === 'inventory')
        .map((m) => {
          if (m.type !== 'inventory') return null;
          const inv = snap.inventories[`${b.id}/${m.id}`] ?? {};
          const items = [...new Set([...Object.keys(m.targets), ...Object.keys(inv)])].map((it) => {
            const qty = inv[it] ?? 0;
            const target = m.targets[it] ?? 0;
            const def = engine!.world.items.find((x) => x.id === it);
            return { item: it, name: def ? `${def.emoji ?? ''} ${def.name}`.trim() : it, qty, target, urgency: target ? urgency(qty, target) : 2 };
          });
          const critical = items.filter((i) => i.urgency === 0);
          if (critical.length)
            alerts.push({
              level: 'warning',
              text: `${b.name} · ${m.name} : ${critical.length} réserve(s) en rupture ou critique(s).`,
              link: `building:${b.id}`,
            });
          return { id: m.id, name: m.name, items };
        })
        .filter(Boolean);
      const stations = b.modules
        .filter((m) => m.type === 'production')
        .map((m) => {
          if (m.type !== 'production') return null;
          const list = snap.stations[`${b.id}/${m.id}`] ?? [];
          return {
            id: m.id,
            name: m.name,
            stationName: m.stationName,
            stations: list.map((st) =>
              st ? { recipe: m.recipes.find((x) => x.id === st.recipe)?.name ?? st.recipe, by: meta.get(st.by)?.name ?? st.by, endsAt: st.endsAt, ready: st.endsAt <= now } : null,
            ),
          };
        })
        .filter(Boolean);
      const objectives = b.modules
        .filter((m) => m.type === 'objective')
        .map((m) => {
          if (m.type !== 'objective') return null;
          const st = snap.objectives?.[`${b.id}/${m.id}`];
          const total = Object.values(m.goals).reduce((x, y) => x + y, 0);
          const done = Object.entries(m.goals).reduce((x, [it, g]) => x + Math.min(g, st?.progress[it] ?? 0), 0);
          return { id: m.id, name: m.name, percent: Math.floor((done / Math.max(1, total)) * 100), completed: !!st?.completedAt, contributors: Object.keys(st?.contributors ?? {}).length };
        })
        .filter(Boolean);
      if (s.guildId && !channels[b.id]?.text) alerts.push({ level: 'info', text: `${b.name} n’a pas encore de salon Discord.`, link: 'discord' });
      return { id: b.id, name: b.name, emoji: b.emoji ?? '', npc: b.npc?.name ?? null, modules: b.modules.map((m) => m.type), stocks, stations, objectives, channels: channels[b.id] ?? {} };
    });
    const players = engine ? engine.playerIds() : [];
    const issues = engine ? validateWorld(engine.world) : [];
    return {
      server: s,
      content,
      published: !!engine,
      counts: {
        players: players.length,
        activeToday: players.filter((p) => (meta.get(p)?.lastSeen ?? 0) > now - 86_400_000).length,
        buildings: engine?.world.buildings.length ?? 0,
        items: engine?.world.items.length ?? 0,
        jobs: engine?.world.jobs.length ?? 0,
        warnings: issues.filter((i) => i.level === 'warning').length,
      },
      variables: (engine?.world.variables ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        value: engine!.variables[v.id],
        options: v.options ?? null,
      })),
      buildings,
      alerts,
      live: engine ? (() => { const l = engine.live(); return { weather: l.weather, running: l.events.filter((e) => e.status === 'running' || e.status === 'paused').map((e) => ({ id: e.id, name: e.name, emoji: e.emoji, status: e.status })) }; })() : null,
      activity: platform.activity(s.id, 25).map((a) => ({ ...a, playerName: a.playerId ? meta.get(a.playerId)?.name ?? a.playerId : null })),
      discord: { ...d, guildId: s.guildId },
    };
  });

  router.get('/api/servers/:id/players', (r) => {
    const s = server(r, 'viewer');
    const engine = runtimes.engine(s.id);
    if (!engine) return [];
    const meta = platform.playerMeta(s.id);
    return engine.playerIds().map((id) => {
      const p = engine.player(id)!;
      const m = meta.get(id);
      return {
        id,
        name: m?.name ?? id,
        avatarUrl: m?.avatarUrl ?? null,
        lastSeen: m?.lastSeen ?? null,
        firstSeen: m?.firstSeen ?? null,
        stats: p.stats,
        activeJobs: p.activeJobs,
        jobs: p.jobs,
        items: Object.values(p.items).reduce((a, b) => a + b, 0),
      };
    });
  });

  router.get('/api/servers/:id/players/:pid', (r) => {
    const s = server(r, 'viewer');
    const engine = runtimes.require(s.id);
    const p = engine.player(r.params.pid!);
    if (!p) throw new HttpError(404, 'Joueur inconnu.');
    const m = platform.playerMeta(s.id).get(r.params.pid!);
    return {
      id: r.params.pid,
      name: m?.name ?? r.params.pid,
      avatarUrl: m?.avatarUrl ?? null,
      lastSeen: m?.lastSeen ?? null,
      firstSeen: m?.firstSeen ?? null,
      state: p,
      activity: platform.activity(s.id, 30, r.params.pid),
    };
  });

  router.post('/api/servers/:id/players/:pid/actions', (r) => {
    const s = server(r, 'manager');
    const actions = r.body.actions as Action[];
    if (!Array.isArray(actions) || !actions.length) throw new HttpError(400, 'Aucune action.');
    const allowed = new Set(['stat.add', 'stat.set', 'item.give', 'item.take', 'job.join', 'job.leave', 'job.setLevel', 'job.xp', 'modifier.apply', 'tool.repair', 'tool.wear']);
    if (actions.some((a) => !allowed.has(a?.type))) throw new HttpError(400, 'Action non autorisée en intervention.');
    const summary = runtimes.adminApply(s.id, me(r), r.params.pid!, actions, r.body.reason);
    return { summary, state: runtimes.require(s.id).player(r.params.pid!) };
  });

  router.post('/api/servers/:id/variables', (r) => {
    const s = server(r, 'manager');
    // La variable de météo passe par le système météo (durée, annonce, cohérence).
    if (runtimes.require(s.id).world.weather?.variable === r.body.variable) runtimes.setWeather(s.id, me(r), String(r.body.value));
    else runtimes.setVariable(s.id, me(r), String(r.body.variable), r.body.value);
    deps.voice.refresh();
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // En direct : météo et événements
  // ---------------------------------------------------------------------------

  router.get('/api/servers/:id/live', (r) => {
    const s = server(r, 'viewer');
    const engine = runtimes.engine(s.id);
    if (!engine) return { published: false, timezone: 'Europe/Paris', now: Date.now(), weather: null, events: [], weatherStates: [], announceChannel: null };
    const def = engine.world.weather;
    const v = engine.world.variables.find((x) => x.id === def?.variable);
    return {
      published: true,
      ...engine.live(),
      weatherStates: (def?.states ?? []).map((st) => ({ value: st.value, label: v?.options?.find((o) => o.value === st.value)?.label ?? st.value, weight: st.weight })),
      announceChannel: platform.setting<string | null>(s.id, 'discord.announceChannel', null),
      announcements: platform.activity(s.id, 100).filter((a) => a.text.startsWith('📣') || a.text.startsWith('📅')).slice(0, 15),
    };
  });

  router.post('/api/servers/:id/events/:eid/:cmd', (r) => {
    const s = server(r, 'manager');
    const cmd = r.params.cmd!;
    if (cmd === 'auto') runtimes.setEventAuto(s.id, me(r), r.params.eid!, !!r.body.enabled);
    else if (['start', 'stop', 'pause', 'resume', 'restart'].includes(cmd)) runtimes.eventControl(s.id, me(r), r.params.eid!, cmd as 'start');
    else throw new HttpError(404, 'Commande inconnue.');
    deps.voice.refresh();
    return runtimes.require(s.id).live();
  });

  router.post('/api/servers/:id/weather', (r) => {
    const s = server(r, 'manager');
    if (r.body.auto !== undefined) runtimes.setWeatherAuto(s.id, me(r), !!r.body.auto);
    if (r.body.value) runtimes.setWeather(s.id, me(r), String(r.body.value), r.body.minutes ? Math.max(1, Number(r.body.minutes)) : undefined);
    deps.voice.refresh();
    return runtimes.require(s.id).live();
  });

  router.put('/api/servers/:id/discord/announce', (r) => {
    const s = server(r, 'manager');
    platform.setSetting(s.id, 'discord.announceChannel', r.body.channel || null);
    platform.audit(s.id, me(r).id, 'discord.announce', r.body.channel ? 'Salon d’annonces choisi' : 'Annonces Discord désactivées');
    return { ok: true };
  });

  router.get('/api/servers/:id/audit', (r) => platform.auditLog(server(r, 'viewer').id, 100));
  router.get('/api/servers/:id/activity', (r) => {
    const s = server(r, 'viewer');
    const meta = platform.playerMeta(s.id);
    return platform.activity(s.id, 100).map((a) => ({ ...a, playerName: a.playerId ? meta.get(a.playerId)?.name ?? a.playerId : null }));
  });

  // ---------------------------------------------------------------------------
  // Discord & voix
  // ---------------------------------------------------------------------------

  router.get('/api/servers/:id/discord', async (r) => {
    const s = server(r, 'viewer');
    const g = s.guildId ? await deps.discord.guild(s.guildId).catch(() => ({ inGuild: false, channels: [] })) : { inGuild: false, channels: [] };
    const v = deps.voice.status();
    return {
      core: deps.discord.status(),
      invite: deps.discord.inviteUrl(s.guildId),
      guildId: s.guildId,
      guild: g,
      channels: channelsOf(s.id),
      announceChannel: platform.setting<string | null>(s.id, 'discord.announceChannel', null),
      workers: v.workers.map((w) => ({ ...w, installed: s.guildId ? w.guilds.includes(s.guildId) : false })),
      ffmpeg: v.ffmpeg,
      unplaced: v.unplaced.filter((u) => u.serverId === s.id),
    };
  });

  router.post('/api/servers/:id/discord/provision', async (r) => {
    const s = server(r, 'manager');
    if (!s.guildId) throw new HttpError(400, 'Associe d’abord un serveur Discord à ce monde.');
    let created: Record<string, BuildingChannels>;
    try {
      created = await deps.discord.provision(s.id, r.body.buildings);
    } catch (e) {
      throw new HttpError(502, (e as Error).message);
    }
    platform.setSetting(s.id, 'discord.channels', { ...channelsOf(s.id), ...created });
    await deps.discord.syncBuildings(s.id, true).catch(() => {});
    platform.audit(s.id, me(r).id, 'discord.provision', `Salons créés ou vérifiés : ${Object.keys(created).length} bâtiment(s)`);
    deps.voice.refresh();
    return channelsOf(s.id);
  });

  router.put('/api/servers/:id/discord/channels', (r) => {
    const s = server(r, 'manager');
    const building = String(r.body.building ?? '');
    const all = channelsOf(s.id);
    all[building] = { text: r.body.text || undefined, voice: r.body.voice || undefined };
    platform.setSetting(s.id, 'discord.channels', all);
    platform.audit(s.id, me(r).id, 'discord.channels', `Salons du bâtiment ${building} modifiés`);
    void deps.discord.syncBuildings(s.id, true).catch(() => {});
    deps.voice.refresh();
    return all;
  });

  router.post('/api/servers/:id/discord/sync', async (r) => {
    const s = server(r, 'manager');
    await deps.discord.syncBuildings(s.id, true);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Médiathèque
  // ---------------------------------------------------------------------------

  router.get('/api/servers/:id/audio', (r) => {
    const s = server(r, 'viewer');
    // Sons référencés par le contenu publié mais absents de la médiathèque.
    const used = new Set<string>();
    const w = platform.published(s.id)?.world;
    for (const b of w?.buildings ?? []) {
      const amb = b.audio?.ambience;
      if (typeof amb === 'string') used.add(amb);
      else amb?.cases.forEach((c) => used.add(c.sound));
      if (b.audio?.welcome) used.add(b.audio.welcome);
    }
    JSON.stringify(w ?? {}).replace(/"type":"audio\.play","sound":"([^"]+)"/g, (_, k: string) => (used.add(k), ''));
    const list = platform.audioList(s.id);
    const have = new Set(list.map((a) => a.key));
    return { sounds: list.map(({ file: _f, ...a }) => a), missing: [...used].filter((k) => !have.has(k)).sort() };
  });

  router.add(
    'POST',
    '/api/servers/:id/audio',
    (r) => {
      const s = server(r, 'manager');
      const mime = String(r.headers['content-type'] ?? '').split(';')[0]!.trim();
      const ext = AUDIO_TYPES[mime];
      if (!ext) throw new HttpError(415, 'Format non pris en charge (MP3, WAV, OGG, OPUS, FLAC, M4A, AAC, WEBM).');
      if (!r.raw?.length) throw new HttpError(400, 'Fichier vide.');
      const name = String(r.query.get('name') ?? 'Son').slice(0, 80);
      const kind = String(r.query.get('kind') ?? 'sfx');
      if (!['ambience', 'music', 'voice', 'sfx'].includes(kind)) throw new HttpError(400, 'Type de son invalide.');
      const key = slugify(r.query.get('key') || name);
      const dir = join(deps.audioDir, s.id);
      mkdirSync(dir, { recursive: true });
      const file = `${key}${ext}`;
      writeFileSync(join(dir, file), r.raw);
      platform.db
        .prepare(
          'INSERT INTO audio (server_id, key, name, kind, file, mime, size, volume, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT DO UPDATE SET name = excluded.name, kind = excluded.kind, file = excluded.file, mime = excluded.mime, size = excluded.size',
        )
        .run(s.id, key, name, kind, file, mime, r.raw.length, Date.now());
      platform.audit(s.id, me(r).id, 'audio.upload', `Son « ${name} » (${key}) importé`);
      deps.voice.refresh();
      return platform.audio(s.id, key);
    },
    { raw: true },
  );

  router.get('/api/servers/:id/audio/:key/file', (r) => {
    const s = server(r, 'viewer');
    const a = platform.audio(s.id, r.params.key!);
    const path = a && join(deps.audioDir, s.id, a.file);
    if (!a || !path || !existsSync(path)) throw new HttpError(404, 'Son introuvable.');
    return new FileReply(path, a.mime);
  });

  router.put('/api/servers/:id/audio/:key', (r) => {
    const s = server(r, 'manager');
    const a = platform.audio(s.id, r.params.key!);
    if (!a) throw new HttpError(404, 'Son introuvable.');
    const kind = r.body.kind ?? a.kind;
    if (!['ambience', 'music', 'voice', 'sfx'].includes(kind)) throw new HttpError(400, 'Type de son invalide.');
    const volume = Math.max(0, Math.min(1, Number(r.body.volume ?? a.volume)));
    platform.db.prepare('UPDATE audio SET name = ?, kind = ?, volume = ? WHERE server_id = ? AND key = ?').run(String(r.body.name ?? a.name).slice(0, 80), kind, volume, s.id, a.key);
    return platform.audio(s.id, a.key);
  });

  router.delete('/api/servers/:id/audio/:key', (r) => {
    const s = server(r, 'manager');
    const a = platform.audio(s.id, r.params.key!);
    if (!a) throw new HttpError(404, 'Son introuvable.');
    rmSync(join(deps.audioDir, s.id, a.file), { force: true });
    platform.db.prepare('DELETE FROM audio WHERE server_id = ? AND key = ?').run(s.id, a.key);
    platform.audit(s.id, me(r).id, 'audio.delete', `Son « ${a.name} » supprimé`);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Administration de la plateforme
  // ---------------------------------------------------------------------------

  router.get('/api/admin/overview', (r) => {
    admin(r);
    const v = deps.voice.status();
    return {
      accounts: platform.listAccounts(),
      servers: platform.allServers().map((s) => ({ ...s, content: platform.contentStatus(s.id), members: platform.members(s.id).length })),
      core: deps.discord.status(),
      workers: v.workers,
      ffmpeg: v.ffmpeg,
      version: deps.version,
      registration: platform.opts.allowRegistration,
    };
  });

  router.post('/api/admin/accounts', (r) => {
    const a = admin(r);
    const acc = platform.createAccount({ username: String(r.body.username ?? ''), password: String(r.body.password ?? ''), displayName: r.body.displayName, platformRole: r.body.platformAdmin ? 'platform_admin' : 'user' });
    platform.audit(null, a.id, 'account.create', `Compte ${acc.username} créé`);
    return acc;
  });

  router.post('/api/admin/accounts/:aid/password', (r) => {
    const a = admin(r);
    platform.setPassword(Number(r.params.aid), String(r.body.password ?? ''));
    platform.audit(null, a.id, 'account.password', `Mot de passe du compte ${r.params.aid} réinitialisé`);
    return { ok: true };
  });

  router.delete('/api/admin/accounts/:aid', (r) => {
    const a = admin(r);
    if (Number(r.params.aid) === a.id) throw new HttpError(400, 'Tu ne peux pas supprimer ton propre compte.');
    platform.deleteAccount(Number(r.params.aid));
    return { ok: true };
  });
}
