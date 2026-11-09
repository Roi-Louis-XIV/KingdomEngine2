/** Assemblage de la plateforme : base, services, routes. Utilisé par main.ts et par les tests. */
import { createServer, type Server } from 'node:http';
import { openDatabase } from './db.ts';
import { Platform } from './platform.ts';
import { Runtimes } from './runtime.ts';
import { Router } from './http.ts';
import { registerApi } from './api.ts';
import { offlineDiscord, offlineVoice, type DiscordBridge, type VoiceBridge } from './bridges.ts';

export interface AppConfig {
  dbPath: string;
  contentDir: string;
  audioDir: string;
  staticDir?: string;
  allowRegistration?: boolean;
  maxServersPerAccount?: number;
  secureCookies?: boolean;
  maxAudioBytes?: number;
  version?: string;
  now?: () => number;
}

export function createApp(config: AppConfig) {
  const db = openDatabase(config.dbPath);
  const platform = new Platform(db, {
    contentDir: config.contentDir,
    allowRegistration: config.allowRegistration ?? true,
    maxServersPerAccount: config.maxServersPerAccount ?? 10,
    ...(config.now ? { now: config.now } : {}),
  });
  const runtimes = new Runtimes(platform, config.now);
  const router = new Router();
  router.staticDir = config.staticDir;
  router.secureCookies = !!config.secureCookies;
  if (config.maxAudioBytes) router.maxRawBytes = config.maxAudioBytes;
  router.authenticate = (t) => platform.authenticate(t);

  // Les connexions Discord sont branchées après coup (elles ont besoin de platform/runtimes).
  const bridges: { discord: DiscordBridge; voice: VoiceBridge } = { discord: offlineDiscord, voice: offlineVoice };
  registerApi(router, {
    platform,
    runtimes,
    get discord() {
      return bridges.discord;
    },
    get voice() {
      return bridges.voice;
    },
    audioDir: config.audioDir,
    version: config.version ?? 'dev',
  });

  let http: Server | undefined;
  return {
    db,
    platform,
    runtimes,
    router,
    bridges,
    listen(port: number, host = '0.0.0.0'): Promise<Server> {
      http = createServer((req, res) => void router.handle(req, res));
      return new Promise((resolve) => http!.listen(port, host, () => resolve(http!)));
    },
    close() {
      http?.close();
      for (const s of platform.allServers()) runtimes.persist(s.id);
      db.close();
    },
  };
}
