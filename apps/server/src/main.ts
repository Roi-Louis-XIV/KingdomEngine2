/**
 * KingdomEngine — point d'entrée unique : Studio web + API + bot Discord + Voice Workers.
 * Configuration par variables d'environnement (voir .env.example).
 */
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp } from './app.ts';

const env = process.env;
const root = resolve(import.meta.dirname, '../../..');
const dataDir = resolve(env.KINGDOM_DATA_DIR ?? resolve(root, 'var'));
const version = (() => {
  try {
    return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version as string;
  } catch {
    return 'dev';
  }
})();

const app = createApp({
  dbPath: resolve(dataDir, 'kingdom.db'),
  contentDir: resolve(root, 'content'),
  audioDir: resolve(dataDir, 'audio'),
  staticDir: resolve(root, 'apps/studio/dist'),
  allowRegistration: env.KINGDOM_ALLOW_REGISTRATION !== '0',
  maxServersPerAccount: Number(env.KINGDOM_MAX_SERVERS_PER_ACCOUNT ?? 10),
  secureCookies: env.KINGDOM_SECURE_COOKIES === '1',
  maxAudioBytes: Number(env.KINGDOM_AUDIO_MAX_MB ?? 100) * 1024 * 1024,
  version,
  publicUrl: env.KINGDOM_PUBLIC_URL?.trim() || undefined,
  discordOAuth:
    env.KINGDOM_DISCORD_CLIENT_ID && env.KINGDOM_DISCORD_CLIENT_SECRET
      ? { clientId: env.KINGDOM_DISCORD_CLIENT_ID.trim(), clientSecret: env.KINGDOM_DISCORD_CLIENT_SECRET.trim() }
      : undefined,
  statsToken: statsToken(env.KINGDOM_STATS_TOKEN),
});

function statsToken(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  if (t.length < 32) {
    console.error('❌ KINGDOM_STATS_TOKEN trop court (32 caractères minimum) : statistiques désactivées.');
    return undefined;
  }
  return t;
}

// Compte administrateur initial (facultatif) : sinon, le premier compte inscrit devient administrateur.
if (app.platform.accountCount() === 0 && env.KINGDOM_ADMIN_USERNAME && env.KINGDOM_ADMIN_PASSWORD) {
  app.platform.createAccount({ username: env.KINGDOM_ADMIN_USERNAME, password: env.KINGDOM_ADMIN_PASSWORD, platformRole: 'platform_admin' });
  console.log(`👑 Compte administrateur « ${env.KINGDOM_ADMIN_USERNAME} » créé.`);
}
// Propriétaire reconnu par son compte Discord (comme OWNER_DISCORD_ID dans RoyaumeOS).
if (env.KINGDOM_OWNER_DISCORD_ID?.trim()) {
  try {
    const { account, action } = app.platform.ensureOwnerDiscord(env.KINGDOM_OWNER_DISCORD_ID.trim());
    const what = { ok: 'reconnu', linked: 'relié au compte administrateur', created: 'créé', promoted: 'nommé administrateur' }[action];
    console.log(`👑 Propriétaire Discord ${what} : « ${account.username} ».`);
  } catch (e) {
    console.error('❌', (e as Error).message);
  }
}

const port = Number(env.KINGDOM_PORT ?? 8080);
const host = env.KINGDOM_HOST ?? '0.0.0.0';
await app.listen(port, host);
console.log(`🏰 KingdomEngine ${version} — Studio : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
if (app.platform.accountCount() === 0) console.log('   Premier lancement : ouvre le Studio et crée ton compte (il sera administrateur).');
console.log(env.KINGDOM_DISCORD_CLIENT_ID ? '   Connexion avec Discord : activée.' : '   Connexion avec Discord : désactivée (KINGDOM_DISCORD_CLIENT_ID / _SECRET).');
// Statistiques pour RoyaumeOS sur une écoute dédiée (ex. 192.168.1.20:8091), sans exposer le Studio.
if (env.KINGDOM_STATS_LISTEN && env.KINGDOM_STATS_TOKEN) {
  const m = /^(.+):(\d+)$/.exec(env.KINGDOM_STATS_LISTEN.trim());
  if (!m) console.error('❌ KINGDOM_STATS_LISTEN attendu sous la forme adresse:port.');
  else {
    // Ne bloque jamais le Studio : l'interface (ex. docker0) peut ne pas encore exister au démarrage.
    const listenStats = (attempt: number) =>
      app
        .listenStats(Number(m[2]), m[1]!.replace(/^\[|\]$/g, ''))
        .then(() => console.log(`📊 Statistiques RoyaumeOS : http://${m[1]}:${m[2]}/api/stats`))
        .catch((e: Error) => {
          console.error(`❌ Écoute des statistiques ${env.KINGDOM_STATS_LISTEN} : ${e.message}${attempt < 10 ? ' (nouvel essai dans 30 s)' : ''}`);
          if (attempt < 10) setTimeout(() => void listenStats(attempt + 1), 30_000).unref();
        });
    void listenStats(1);
  }
}

const stops: (() => void)[] = [];
// Horloge des mondes : météo, événements programmés, étapes.
app.runtimes.tickAll();
const clock = setInterval(() => app.runtimes.tickAll(), Number(env.KINGDOM_TICK_SECONDS ?? 5) * 1000);
stops.push(() => clearInterval(clock));
if (env.KINGDOM_CORE_TOKEN) {
  const { CoreBot } = await import('./discord/core.ts');
  const core = new CoreBot(app.platform, app.runtimes, env.KINGDOM_CORE_TOKEN);
  app.bridges.discord = core;
  await core.start().catch((e) => console.error('❌ Bot principal :', e.message));
  stops.push(() => core.stop());

  const { VoiceWorkers, workersFromEnv } = await import('./voice/workers.ts');
  const configs = workersFromEnv(env);
  if (configs.length) {
    const voice = new VoiceWorkers(app.platform, app.runtimes, core, resolve(dataDir, 'audio'), configs);
    app.bridges.voice = voice;
    core.voiceBotIds = () => voice.botIds();
    // Dès qu'un Voice Worker se connecte, il est ajouté aux salons vocaux réservés (regroupé sur 10 s).
    let resync: NodeJS.Timeout | undefined;
    voice.onBotsChanged = () => {
      clearTimeout(resync);
      resync = setTimeout(() => {
        for (const s of app.platform.allServers()) if (s.guildId) void core.syncBuildings(s.id, true).catch(() => {});
      }, 10_000);
      resync.unref();
    };
    await voice.start();
    stops.push(() => voice.stop());
    console.log(`🎙️  ${configs.length} Voice Worker(s) configuré(s).`);
  } else console.log('   Aucun Voice Worker (VOICE_WORKER_1_TOKEN…) : les bâtiments restent silencieux.');
} else {
  console.log('   Discord désactivé : renseigne KINGDOM_CORE_TOKEN pour connecter le bot principal.');
}

const shutdown = () => {
  console.log('Arrêt…');
  stops.forEach((s) => s());
  app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
