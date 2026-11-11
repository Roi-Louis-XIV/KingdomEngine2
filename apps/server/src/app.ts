/** Assemblage de la plateforme : base, services, routes. Utilisé par main.ts et par les tests. */
import { createServer, type Server } from 'node:http';
import { openDatabase } from './db.ts';
import { Platform } from './platform.ts';
import { Runtimes } from './runtime.ts';
import { Router } from './http.ts';
import { registerApi } from './api.ts';
import { offlineDiscord, offlineVoice, type DiscordBridge, type VoiceBridge } from './bridges.ts';
import { statsOnlyRouter } from './stats.ts';
import type { OAuthConfig } from './discord/oauth.ts';

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
  /** Adresse publique du Studio (retour de la connexion Discord, adresse MCP affichée). */
  publicUrl?: string;
  /** Application Discord pour « Se connecter avec Discord ». */
  discordOAuth?: OAuthConfig;
  /** Jeton du suivi externe (RoyaumeOS). */
  statsToken?: string;
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
    publicUrl: config.publicUrl,
    discordOAuth: config.discordOAuth,
    statsToken: config.statsToken,
    startedAt: Date.now(),
  });

  let http: Server | undefined;
  let statsHttp: Server | undefined;
  const startedAt = Date.now();
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
    /** Écoute séparée qui ne sert QUE les statistiques (pour un conteneur RoyaumeOS sur le réseau local). */
    listenStats(port: number, host: string): Promise<Server> {
      const r = statsOnlyRouter({
        platform,
        token: config.statsToken,
        version: config.version ?? 'dev',
        startedAt,
        discord: () => bridges.discord,
        voice: () => bridges.voice,
      });
      const srv = createServer((req, res) => void r.handle(req, res));
      return new Promise((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(port, host, () => {
          srv.off('error', reject);
          statsHttp = srv;
          resolve(srv);
        });
      });
    },
    close() {
      http?.close();
      statsHttp?.close();
      for (const s of platform.allServers()) runtimes.persist(s.id);
      db.close();
    },
  };
}
