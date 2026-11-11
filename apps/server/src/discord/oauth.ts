/**
 * Connexion avec Discord (OAuth2, scope « identify » uniquement : identifiant, pseudo, avatar).
 * Aucun e-mail, aucune liste de serveurs n'est demandée. Le jeton Discord n'est pas conservé.
 */
import type { DiscordProfile } from '../platform.ts';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Remplaçable dans les tests. */
  fetch?: typeof fetch;
}

const API = 'https://discord.com/api/v10';

export function authorizeUrl(cfg: OAuthConfig, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, scope: 'identify', state, redirect_uri: redirectUri, prompt: 'none' });
  return `https://discord.com/oauth2/authorize?${q}`;
}

/** Échange le code contre un jeton, lit le profil, puis oublie le jeton. */
export async function fetchProfile(cfg: OAuthConfig, code: string, redirectUri: string): Promise<DiscordProfile> {
  const f = cfg.fetch ?? fetch;
  const tokenRes = await f(`${API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error(tokenRes.status === 401 ? 'Identifiants de l’application Discord refusés (KINGDOM_DISCORD_CLIENT_SECRET).' : `Discord a refusé la connexion (${tokenRes.status}).`);
  const token = (await tokenRes.json()) as { access_token?: string; token_type?: string };
  if (!token.access_token) throw new Error('Réponse de Discord incomplète.');
  const meRes = await f(`${API}/users/@me`, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000) });
  if (!meRes.ok) throw new Error(`Profil Discord illisible (${meRes.status}).`);
  const me = (await meRes.json()) as { id?: string; username?: string; global_name?: string | null; avatar?: string | null };
  if (!me.id || !/^\d{17,20}$/.test(me.id) || !me.username) throw new Error('Profil Discord incomplet.');
  return { id: me.id, username: me.username, globalName: me.global_name ?? null, avatar: me.avatar && /^(a_)?[0-9a-f]{32}$/.test(me.avatar) ? me.avatar : null };
}
