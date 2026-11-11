/**
 * Routes des comptes : connexion (identifiant ou Discord), profil, sessions, jetons d'accès.
 * Toute opération sensible demande une confirmation d'identité (mot de passe actuel,
 * ou connexion Discord de moins de 15 minutes pour un compte sans mot de passe).
 */
import { RawReply, redirectPage, type Req, type Router } from './http.ts';
import { HttpError, TOKEN_ACCESS_LABEL, type Account, type Platform, type TokenAccess } from './platform.ts';
import { authorizeUrl, fetchProfile, type OAuthConfig } from './discord/oauth.ts';

export interface AccountApiDeps {
  platform: Platform;
  /** Adresse publique du Studio (https://studio.exemple.fr). Sinon déduite de la requête. */
  publicUrl?: string;
  discordOAuth?: OAuthConfig;
  throttle: (key: string) => void;
  clearThrottle: (key: string) => void;
}

export function registerAccountApi(router: Router, deps: AccountApiDeps) {
  const { platform } = deps;
  const me = (r: Req): Account => {
    if (!r.account) throw new HttpError(401, 'Connexion requise.');
    return r.account;
  };
  const meta = (r: Req) => ({ ip: r.ip, userAgent: String(r.headers['user-agent'] ?? '') });
  const session = (r: Req) => r.cookies.kingdom_session;

  /** Origine publique du Studio : configurée, sinon celle de la requête (proxy local : X-Forwarded-Proto). */
  const origin = (r: Req): string => {
    if (deps.publicUrl) return deps.publicUrl.replace(/\/+$/, '');
    const host = String(r.headers['x-forwarded-host'] ?? r.headers.host ?? '');
    if (!/^[a-z0-9.\-]+(:\d+)?$|^\[[0-9a-f:]+\](:\d+)?$/i.test(host)) throw new HttpError(400, 'Adresse du Studio inconnue : renseigne KINGDOM_PUBLIC_URL.');
    const proto = String(r.headers['x-forwarded-proto'] ?? '') === 'https' ? 'https' : 'http';
    return `${proto}://${host}`;
  };
  const redirectUri = (r: Req) => `${origin(r)}/api/auth/discord/callback`;

  // ---------------------------------------------------------------------------
  // Connexion par identifiant
  // ---------------------------------------------------------------------------

  router.post('/api/auth/login', (r) => {
    deps.throttle(`login:${r.ip}`);
    const { token, account, maxAge } = platform.login(String(r.body.username ?? ''), String(r.body.password ?? ''), !!r.body.remember, meta(r));
    r.setCookie('kingdom_session', token, { maxAge });
    deps.clearThrottle(`login:${r.ip}`);
    return { account };
  });

  router.post('/api/auth/register', (r) => {
    if (!platform.registrationOpen()) throw new HttpError(403, 'Les inscriptions sont fermées sur cette installation.');
    deps.throttle(`register:${r.ip}`);
    platform.createAccount({ username: String(r.body.username ?? ''), password: String(r.body.password ?? ''), displayName: r.body.displayName });
    const { token, account } = platform.login(String(r.body.username), String(r.body.password), false, meta(r));
    r.setCookie('kingdom_session', token);
    return { account };
  });

  router.post('/api/auth/logout', (r) => {
    platform.logout(session(r));
    r.setCookie('kingdom_session', '', { clear: true });
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Connexion avec Discord
  // ---------------------------------------------------------------------------

  router.get('/api/auth/discord/start', (r) => {
    const cfg = deps.discordOAuth;
    if (!cfg) throw new HttpError(404, 'La connexion avec Discord n’est pas configurée sur cette installation.');
    const mode = r.query.get('mode') === 'link' ? 'link' : 'login';
    if (mode === 'link' && !r.account) return redirectPage('/?erreur=' + encodeURIComponent('Connecte-toi d’abord pour relier ton compte Discord.'));
    deps.throttle(`discord:${r.ip}`);
    const state = platform.oauthStart(mode, r.account?.id ?? null, r.query.get('remember') === '1', r.query.get('next'));
    // Cookie « Lax » : renvoyé par le navigateur au retour de Discord (navigation venant d'un autre site).
    r.setCookie('kingdom_oauth', state, { lax: true, path: '/api/auth/discord', maxAge: 600 });
    return new RawReply(302, null, { location: authorizeUrl(cfg, redirectUri(r), state) });
  });

  router.get('/api/auth/discord/callback', async (r) => {
    const cfg = deps.discordOAuth;
    if (!cfg) throw new HttpError(404, 'La connexion avec Discord n’est pas configurée sur cette installation.');
    const state = r.query.get('state') ?? '';
    const cookie = r.cookies.kingdom_oauth ?? '';
    r.setCookie('kingdom_oauth', '', { clear: true, path: '/api/auth/discord' });
    const fail = (msg: string, mode: 'login' | 'link' = 'login') => redirectPage(`/?erreur=${encodeURIComponent(msg)}${mode === 'link' ? '#/profil' : ''}`);
    // L'état doit venir de CE navigateur : protège contre une connexion imposée par un autre site.
    if (!state || state !== cookie) return fail('Connexion Discord interrompue ou ouverte dans un autre navigateur. Recommence.');
    let pending: ReturnType<Platform['oauthConsume']>;
    try {
      pending = platform.oauthConsume(state);
    } catch (e) {
      return fail((e as Error).message);
    }
    if (r.query.get('error')) return fail(r.query.get('error') === 'access_denied' ? 'Connexion Discord annulée.' : 'Discord a refusé la connexion.', pending.mode);
    const code = r.query.get('code');
    if (!code) return fail('Réponse de Discord incomplète.', pending.mode);
    try {
      const profile = await fetchProfile(cfg, code, redirectUri(r));
      if (pending.mode === 'link') {
        const current = r.account; // cookie Strict absent au retour de Discord : on se fie à l'état enregistré
        const accountId = pending.accountId;
        if (!accountId || (current && current.id !== accountId)) return fail('Session changée pendant la connexion Discord. Recommence.', 'link');
        platform.linkDiscord(accountId, profile);
        platform.audit(null, accountId, 'account.discord.link', `Compte Discord ${profile.username} relié`);
        return redirectPage('/?info=' + encodeURIComponent('Compte Discord relié.') + '#/profil');
      }
      const { token, maxAge, account, created } = platform.loginWithDiscord(profile, pending.remember, meta(r));
      if (created) platform.audit(null, account.id, 'account.create', `Compte ${account.username} créé par Discord`);
      r.setCookie('kingdom_session', token, { maxAge });
      const hash = pending.returnTo ? `#/${pending.returnTo}` : '';
      return redirectPage(created ? '/?info=' + encodeURIComponent('Bienvenue ! Ton compte a été créé avec Discord.') : `/${hash}`);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('Connexion Discord :', (e as Error).message);
      return fail((e as Error).message, pending.mode);
    }
  });

  router.post('/api/auth/discord/unlink', (r) => {
    const a = me(r);
    platform.confirmIdentity(a.id, session(r), r.body.password);
    const out = platform.unlinkDiscord(a.id);
    platform.audit(null, a.id, 'account.discord.unlink', 'Compte Discord détaché');
    return { account: out };
  });

  // ---------------------------------------------------------------------------
  // Profil
  // ---------------------------------------------------------------------------

  router.get('/api/profile', (r) => {
    const a = me(r);
    return {
      account: platform.account(a.id),
      sessions: platform.sessions(a.id, session(r)),
      tokens: platform.tokens(a.id),
      accessLevels: TOKEN_ACCESS_LABEL,
      discordLogin: !!deps.discordOAuth,
      mcpUrl: `${safeOrigin(r)}/mcp`,
    };
  });

  router.put('/api/profile', (r) => {
    const a = me(r);
    const input: { displayName?: string; username?: string } = {};
    if (r.body.displayName !== undefined) input.displayName = String(r.body.displayName);
    if (r.body.username !== undefined && String(r.body.username).trim() !== a.username) {
      platform.confirmIdentity(a.id, session(r), r.body.password);
      input.username = String(r.body.username);
    }
    return { account: platform.updateProfile(a.id, input) };
  });

  router.post('/api/auth/password', (r) => {
    const a = me(r);
    deps.throttle(`password:${a.id}`);
    platform.changePassword(a.id, session(r), r.body.current, String(r.body.password ?? ''));
    deps.clearThrottle(`password:${a.id}`);
    platform.audit(null, a.id, 'account.password', a.hasPassword ? 'Mot de passe modifié' : 'Mot de passe défini');
    return { account: platform.account(a.id) };
  });

  router.delete('/api/profile/password', (r) => {
    const a = me(r);
    platform.removePassword(a.id, session(r), r.body.current);
    platform.audit(null, a.id, 'account.password', 'Mot de passe retiré (connexion par Discord)');
    return { account: platform.account(a.id) };
  });

  router.delete('/api/profile/sessions/:sid', (r) => {
    platform.revokeSession(me(r).id, r.params.sid!);
    return { ok: true };
  });

  router.post('/api/profile/sessions/revoke-others', (r) => ({ closed: platform.revokeOtherSessions(me(r).id, session(r)) }));

  router.post('/api/profile/tokens', (r) => {
    const a = me(r);
    deps.throttle(`token:${a.id}`);
    platform.confirmIdentity(a.id, session(r), r.body.password);
    deps.clearThrottle(`token:${a.id}`);
    const days = r.body.days === null || r.body.days === undefined || r.body.days === '' ? null : Number(r.body.days);
    const out = platform.createToken(a.id, { name: String(r.body.name ?? ''), access: String(r.body.access ?? 'read') as TokenAccess, days });
    platform.audit(null, a.id, 'account.token.create', `Jeton « ${String(r.body.name).trim()} » créé (${TOKEN_ACCESS_LABEL[r.body.access as TokenAccess] ?? r.body.access})`);
    return { ...out, tokens: platform.tokens(a.id) };
  });

  router.delete('/api/profile/tokens/:tid', (r) => {
    const a = me(r);
    platform.revokeToken(a.id, r.params.tid!);
    platform.audit(null, a.id, 'account.token.revoke', `Jeton ${r.params.tid} supprimé`);
    return { tokens: platform.tokens(a.id) };
  });

  router.delete('/api/profile', (r) => {
    const a = me(r);
    if (String(r.body.confirm ?? '').trim() !== a.username) throw new HttpError(400, 'Recopie exactement ton identifiant pour confirmer.');
    platform.confirmIdentity(a.id, session(r), r.body.password);
    const orphans = platform.serversFor(a).filter((s) => s.role === 'owner' && platform.members(s.id).filter((m) => m.role === 'owner').length === 1);
    if (orphans.length) throw new HttpError(400, `Tu es seul propriétaire de : ${orphans.map((s) => `« ${s.name} »`).join(', ')}. Donne ce rôle à quelqu’un d’autre ou supprime ces mondes d’abord.`);
    platform.deleteAccount(a.id);
    r.setCookie('kingdom_session', '', { clear: true });
    return { ok: true };
  });

  function safeOrigin(r: Req): string {
    try {
      return origin(r);
    } catch {
      return '';
    }
  }
}
