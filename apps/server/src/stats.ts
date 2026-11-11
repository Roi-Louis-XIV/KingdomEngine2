/**
 * Statistiques d'utilisation pour un suivi externe (RoyaumeOS, Observatoire › KingdomEngine).
 * GET /api/stats avec « Authorization: Bearer <KINGDOM_STATS_TOKEN> ».
 * Chiffres agrégés et liste des mondes : aucun pseudo, aucun identifiant Discord, aucun e-mail.
 */
import { timingSafeEqual, createHash } from 'node:crypto';
import { RawReply, Router } from './http.ts';
import type { Platform } from './platform.ts';
import type { DiscordBridge, VoiceBridge } from './bridges.ts';

export interface StatsDeps {
  platform: Platform;
  token?: string;
  version: string;
  startedAt: number;
  discord: () => DiscordBridge;
  voice: () => VoiceBridge;
}

/** Comparaison à temps constant (même longueur grâce à l'empreinte). */
function sameToken(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

export const STATS_SCHEMA = 1;

export function collectStats(deps: StatsDeps) {
  const core = deps.discord().status();
  const voice = deps.voice().status();
  const usage = deps.platform.usageStats();
  return {
    schema: STATS_SCHEMA,
    generatedAt: new Date().toISOString(),
    version: deps.version,
    uptimeSeconds: Math.round((Date.now() - deps.startedAt) / 1000),
    discord: { configured: core.configured, online: core.online },
    voiceWorkers: { configured: voice.workers.filter((w) => w.configured).length, online: voice.workers.filter((w) => w.online).length },
    ...usage,
  };
}

export function registerStats(router: Router, deps: StatsDeps) {
  router.add(
    'GET',
    '/api/stats',
    (r) => {
      if (!deps.token) return new RawReply(404, JSON.stringify({ error: 'Statistiques désactivées : renseigne KINGDOM_STATS_TOKEN.' }), { 'content-type': 'application/json; charset=utf-8' });
      if (!r.bearer || !sameToken(r.bearer, deps.token))
        return new RawReply(401, JSON.stringify({ error: 'Jeton de statistiques invalide.' }), { 'content-type': 'application/json; charset=utf-8', 'www-authenticate': 'Bearer' });
      return collectStats(deps);
    },
    { bearer: true },
  );
}

/** Routeur minimal pour l'écoute dédiée (KINGDOM_STATS_LISTEN) : seulement /api/stats et /api/health. */
export function statsOnlyRouter(deps: StatsDeps): Router {
  const router = new Router();
  router.get('/api/health', () => ({ ok: true, version: deps.version }));
  registerStats(router, deps);
  return router;
}
