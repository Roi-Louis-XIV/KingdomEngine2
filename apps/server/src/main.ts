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
});

// Compte administrateur initial (facultatif) : sinon, le premier compte inscrit devient administrateur.
if (app.platform.accountCount() === 0 && env.KINGDOM_ADMIN_USERNAME && env.KINGDOM_ADMIN_PASSWORD) {
  app.platform.createAccount({ username: env.KINGDOM_ADMIN_USERNAME, password: env.KINGDOM_ADMIN_PASSWORD, platformRole: 'platform_admin' });
  console.log(`👑 Compte administrateur « ${env.KINGDOM_ADMIN_USERNAME} » créé.`);
}

const port = Number(env.KINGDOM_PORT ?? 8080);
const host = env.KINGDOM_HOST ?? '0.0.0.0';
await app.listen(port, host);
console.log(`🏰 KingdomEngine ${version} — Studio : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
if (app.platform.accountCount() === 0) console.log('   Premier lancement : ouvre le Studio et crée ton compte (il sera administrateur).');

const stops: (() => void)[] = [];
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
