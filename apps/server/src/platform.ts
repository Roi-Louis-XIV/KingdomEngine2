/**
 * Services de la plateforme : comptes, serveurs, droits, contenu versionné,
 * état des mondes, joueurs, activité, audit, médiathèque et réglages.
 * Synchrone (SQLite intégré) et sans HTTP : testable directement.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateWorld, type Issue, type WorldDef, type WorldState } from '../../../packages/engine/src/index.ts';
import { type DB, transaction } from './db.ts';

export type ServerRole = 'viewer' | 'editor' | 'manager' | 'owner';
export const ROLE_RANK: Record<ServerRole, number> = { viewer: 0, editor: 1, manager: 2, owner: 3 };
export const ROLE_LABEL: Record<ServerRole, string> = { viewer: 'Lecture', editor: 'Éditeur', manager: 'Gestionnaire', owner: 'Propriétaire' };

export interface Account {
  id: number;
  username: string;
  displayName: string;
  platformRole: 'user' | 'platform_admin';
  createdAt: number;
  discordId: string | null;
  discordName: string | null;
  avatarUrl: string | null;
  hasPassword: boolean;
  lastLoginAt: number | null;
}

/** Contexte d'une ouverture de session (affiché dans le profil : « mes appareils »). */
export interface SessionMeta {
  ip?: string;
  userAgent?: string;
  method?: 'password' | 'discord';
}

export type TokenAccess = 'read' | 'draft' | 'publish';
export const TOKEN_ACCESS_LABEL: Record<TokenAccess, string> = { read: 'Lecture seule', draft: 'Lecture et brouillon', publish: 'Brouillon et publication' };

/** Compte authentifié par un jeton d'accès (MCP) : porte le niveau d'accès du jeton. */
export interface TokenAccount extends Account {
  tokenId: string;
  tokenAccess: TokenAccess;
}

export interface ServerInfo {
  id: string;
  name: string;
  guildId: string | null;
  template: string;
  createdAt: number;
  role?: ServerRole;
}

export class HttpError extends Error {
  readonly status: number;
  readonly data?: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export interface PlatformOptions {
  contentDir: string;
  now?: () => number;
  maxServersPerAccount?: number;
  allowRegistration?: boolean;
}

const SESSION_SHORT = 12 * 3600_000; // session « navigateur »
const SESSION_LONG = 7 * 24 * 3600_000; // « rester connecté »

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const DECOY_HASH = hashPassword('leurre-temporel');

function checkPassword(password: string) {
  if (password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
  if (password.length > 200) throw new HttpError(400, 'Mot de passe : 200 caractères maximum.');
}

/** Résumé lisible d'un navigateur (« Firefox · Windows »), sans conserver plus que nécessaire. */
export function describeDevice(ua: string | null | undefined): string {
  if (!ua) return 'Appareil inconnu';
  if (/claude|mcp|python|node|curl/i.test(ua) && !/mozilla/i.test(ua)) return 'Outil externe';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Discord/i.test(ua) ? 'Discord' : 'Navigateur';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'monde'
  );
}

interface AccountRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  platform_role: 'user' | 'platform_admin';
  created_at: number;
  discord_id: string | null;
  discord_name: string | null;
  avatar_url: string | null;
  last_login_at: number | null;
}
const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  platformRole: r.platform_role,
  createdAt: r.created_at,
  discordId: r.discord_id ?? null,
  discordName: r.discord_name ?? null,
  avatarUrl: r.avatar_url ?? null,
  hasPassword: !!r.password_hash,
  lastLoginAt: r.last_login_at ?? null,
});

/** Profil Discord renvoyé par l'OAuth2 (scope identify). */
export interface DiscordProfile {
  id: string;
  username: string;
  globalName?: string | null;
  avatar?: string | null;
}

const discordAvatar = (p: DiscordProfile) => (p.avatar ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=128` : null);
/** Réauthentification : une session ouverte depuis moins de 15 minutes vaut confirmation. */
const REAUTH_WINDOW = 15 * 60_000;

export class Platform {
  readonly db: DB;
  readonly opts: Required<PlatformOptions>;
  private readonly now: () => number;

  constructor(db: DB, opts: PlatformOptions) {
    this.db = db;
    this.now = opts.now ?? Date.now;
    this.opts = {
      maxServersPerAccount: 10,
      allowRegistration: true,
      now: this.now,
      ...opts,
    };
  }

  // -------------------------------------------------------------------------
  // Comptes et sessions
  // -------------------------------------------------------------------------

  accountCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n;
  }

  /** L'inscription est ouverte si autorisée, et toujours pour créer le tout premier compte. */
  registrationOpen(): boolean {
    return this.opts.allowRegistration || this.accountCount() === 0;
  }

  createAccount(input: { username: string; password?: string; displayName?: string; platformRole?: Account['platformRole']; discordId?: string }): Account {
    const username = input.username.trim();
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username))
      throw new HttpError(400, 'Identifiant : 3 à 32 caractères (lettres, chiffres, . _ -).');
    const discordId = input.discordId?.trim() || null;
    if (discordId && !/^\d{17,20}$/.test(discordId)) throw new HttpError(400, 'Identifiant Discord : 17 à 20 chiffres.');
    const password = input.password ?? '';
    // Un compte doit pouvoir se connecter : mot de passe, ou compte Discord relié.
    if (!discordId || password) checkPassword(password);
    // Le tout premier compte administre la plateforme.
    const role = this.accountCount() === 0 ? 'platform_admin' : (input.platformRole ?? 'user');
    try {
      const r = this.db
        .prepare('INSERT INTO accounts (username, display_name, password_hash, platform_role, created_at, discord_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(username, input.displayName?.trim() || username, password ? hashPassword(password) : '', role, this.now(), discordId);
      return this.account(Number(r.lastInsertRowid))!;
    } catch (e) {
      if (String(e).includes('accounts.discord_id')) throw new HttpError(409, 'Ce compte Discord est déjà relié à un autre compte.');
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'Cet identifiant est déjà utilisé.');
      throw e;
    }
  }

  account(id: number): Account | undefined {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
    return r ? toAccount(r) : undefined;
  }

  accountByName(username: string): Account | undefined {
    const r = this.db.prepare('SELECT * FROM accounts WHERE username = ?').get(username.trim()) as AccountRow | undefined;
    return r ? toAccount(r) : undefined;
  }

  accountByDiscord(discordId: string): Account | undefined {
    const r = this.db.prepare('SELECT * FROM accounts WHERE discord_id = ?').get(discordId) as AccountRow | undefined;
    return r ? toAccount(r) : undefined;
  }

  listAccounts(): (Account & { servers: number })[] {
    const rows = this.db
      .prepare('SELECT a.*, (SELECT COUNT(*) FROM access x WHERE x.account_id = a.id) AS servers FROM accounts a ORDER BY a.id')
      .all() as (AccountRow & { servers: number })[];
    return rows.map((r) => ({ ...toAccount(r), servers: r.servers }));
  }

  /** Réinitialisation par un administrateur : toutes les sessions et tous les jetons du compte sont fermés. */
  setPassword(accountId: number, password: string): void {
    checkPassword(password);
    this.db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(password), accountId);
    this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
  }

  /**
   * Vérifie que la personne connectée est bien la titulaire du compte avant une opération sensible :
   * mot de passe actuel, ou (compte sans mot de passe) session ouverte il y a moins de 15 minutes.
   */
  confirmIdentity(accountId: number, sessionToken: string | undefined, password: string | undefined): void {
    const row = this.db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(accountId) as { password_hash: string } | undefined;
    if (!row) throw new HttpError(401, 'Connexion requise.');
    if (row.password_hash) {
      if (!password || !verifyPassword(password, row.password_hash)) throw new HttpError(403, 'Mot de passe actuel incorrect.');
      return;
    }
    const s = sessionToken ? (this.db.prepare('SELECT created_at FROM sessions WHERE token_hash = ?').get(sha256(sessionToken)) as { created_at: number } | undefined) : undefined;
    if (!s || this.now() - s.created_at > REAUTH_WINDOW)
      throw new HttpError(403, 'Pour confirmer qu’il s’agit bien de toi, reconnecte-toi avec Discord puis recommence (moins de 15 minutes).', { reauth: true });
  }

  /** Changement de mot de passe par la personne elle-même : les autres sessions sont fermées, la session actuelle reste ouverte. */
  changePassword(accountId: number, sessionToken: string | undefined, current: string | undefined, password: string): void {
    this.confirmIdentity(accountId, sessionToken, current);
    checkPassword(password);
    if (current && current === password) throw new HttpError(400, 'Le nouveau mot de passe doit être différent de l’actuel.');
    this.db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(password), accountId);
    this.db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash != ?').run(accountId, sessionToken ? sha256(sessionToken) : '');
  }

  /** Retire le mot de passe (connexion par Discord uniquement). */
  removePassword(accountId: number, sessionToken: string | undefined, current: string | undefined): void {
    const a = this.account(accountId);
    if (!a?.discordId) throw new HttpError(400, 'Relie d’abord ton compte Discord : sans mot de passe ni Discord, tu ne pourrais plus te connecter.');
    this.confirmIdentity(accountId, sessionToken, current);
    this.db.prepare("UPDATE accounts SET password_hash = '' WHERE id = ?").run(accountId);
  }

  updateProfile(accountId: number, input: { displayName?: string; username?: string }): Account {
    if (input.displayName !== undefined) {
      const name = String(input.displayName).trim();
      if (!name || name.length > 60) throw new HttpError(400, 'Nom affiché : 1 à 60 caractères.');
      this.db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(name, accountId);
    }
    if (input.username !== undefined) {
      const username = String(input.username).trim();
      if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) throw new HttpError(400, 'Identifiant : 3 à 32 caractères (lettres, chiffres, . _ -).');
      try {
        this.db.prepare('UPDATE accounts SET username = ? WHERE id = ?').run(username, accountId);
      } catch (e) {
        if (String(e).includes('UNIQUE')) throw new HttpError(409, 'Cet identifiant est déjà utilisé.');
        throw e;
      }
    }
    return this.account(accountId)!;
  }

  deleteAccount(accountId: number): void {
    const admins = this.db.prepare("SELECT id FROM accounts WHERE platform_role = 'platform_admin'").all() as { id: number }[];
    if (admins.length === 1 && admins[0]!.id === accountId) throw new HttpError(400, 'Impossible de supprimer le dernier administrateur.');
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  }

  private openSession(accountId: number, remember: boolean, meta: SessionMeta = {}): { token: string; maxAge?: number } {
    const token = randomBytes(32).toString('base64url');
    const ttl = remember ? SESSION_LONG : SESSION_SHORT;
    const now = this.now();
    this.db
      .prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at, last_seen, ip, user_agent, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(token), accountId, now + ttl, now, now, meta.ip?.slice(0, 64) ?? null, meta.userAgent?.slice(0, 300) ?? null, meta.method ?? 'password');
    this.db.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(now, accountId);
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    return { token, maxAge: remember ? ttl / 1000 : undefined };
  }

  login(username: string, password: string, remember: boolean, meta: SessionMeta = {}): { token: string; account: Account; maxAge?: number } {
    const r = this.db.prepare('SELECT * FROM accounts WHERE username = ?').get(username.trim()) as AccountRow | undefined;
    // Vérification systématique pour ne pas révéler l'existence d'un compte par le temps de réponse.
    const ok = verifyPassword(password, r?.password_hash || DECOY_HASH);
    if (!r || !ok) throw new HttpError(401, r && !r.password_hash ? 'Ce compte se connecte avec Discord.' : 'Identifiant ou mot de passe incorrect.');
    const { token, maxAge } = this.openSession(r.id, remember, { ...meta, method: 'password' });
    return { token, account: this.account(r.id)!, maxAge };
  }

  authenticate(token: string | undefined): Account | undefined {
    if (!token) return undefined;
    const hash = sha256(token);
    const row = this.db.prepare('SELECT account_id, expires_at, last_seen FROM sessions WHERE token_hash = ?').get(hash) as
      | { account_id: number; expires_at: number; last_seen: number | null }
      | undefined;
    if (!row || row.expires_at < this.now()) return undefined;
    if (!row.last_seen || this.now() - row.last_seen > 60_000) this.db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(this.now(), hash);
    return this.account(row.account_id);
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  /** Sessions ouvertes du compte (l'identifiant public est un préfixe de l'empreinte, jamais le jeton). */
  sessions(accountId: number, currentToken?: string) {
    const current = currentToken ? sha256(currentToken) : '';
    const rows = this.db
      .prepare('SELECT token_hash, created_at, last_seen, expires_at, ip, user_agent, method FROM sessions WHERE account_id = ? AND expires_at >= ? ORDER BY COALESCE(last_seen, created_at) DESC')
      .all(accountId, this.now()) as { token_hash: string; created_at: number; last_seen: number | null; expires_at: number; ip: string | null; user_agent: string | null; method: string | null }[];
    return rows.map((r) => ({
      id: r.token_hash.slice(0, 16),
      current: r.token_hash === current,
      createdAt: r.created_at,
      lastSeen: r.last_seen ?? r.created_at,
      expiresAt: r.expires_at,
      ip: r.ip,
      device: describeDevice(r.user_agent),
      method: (r.method ?? 'password') as 'password' | 'discord',
    }));
  }

  revokeSession(accountId: number, id: string): void {
    if (!/^[0-9a-f]{16}$/.test(id)) throw new HttpError(400, 'Session inconnue.');
    const r = this.db.prepare("DELETE FROM sessions WHERE account_id = ? AND substr(token_hash, 1, 16) = ?").run(accountId, id);
    if (!r.changes) throw new HttpError(404, 'Session inconnue ou déjà fermée.');
  }

  revokeOtherSessions(accountId: number, currentToken: string | undefined): number {
    return Number(this.db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash != ?').run(accountId, currentToken ? sha256(currentToken) : '').changes);
  }

  // -------------------------------------------------------------------------
  // Connexion avec Discord (OAuth2)
  // -------------------------------------------------------------------------

  /** Prépare une connexion Discord : l'état aléatoire relie le retour de Discord à ce navigateur. */
  oauthStart(mode: 'login' | 'link', accountId: number | null, remember: boolean, returnTo?: string | null): string {
    const state = randomBytes(24).toString('base64url');
    // Retour vers une page du Studio uniquement (« profil », « apercu »…), jamais vers une adresse.
    const back = returnTo && /^[a-z][a-z-]{1,30}$/.test(returnTo) ? returnTo : null;
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(this.now());
    this.db.prepare('INSERT INTO oauth_states (state, mode, account_id, remember, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(state, mode, accountId, remember ? 1 : 0, back, this.now() + 10 * 60_000);
    return state;
  }

  /** Consomme l'état (usage unique). */
  oauthConsume(state: string): { mode: 'login' | 'link'; accountId: number | null; remember: boolean; returnTo: string | null } {
    const row = this.db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(state) as
      | { mode: 'login' | 'link'; account_id: number | null; remember: number; return_to: string | null; expires_at: number }
      | undefined;
    this.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    if (!row || row.expires_at < this.now()) throw new HttpError(400, 'Connexion Discord expirée. Recommence.');
    return { mode: row.mode, accountId: row.account_id, remember: !!row.remember, returnTo: row.return_to };
  }

  /**
   * Connexion par Discord : compte relié, sinon nouveau compte si les inscriptions sont ouvertes.
   * Le profil Discord (nom, avatar) est mis à jour à chaque connexion.
   */
  loginWithDiscord(profile: DiscordProfile, remember: boolean, meta: SessionMeta = {}): { token: string; account: Account; maxAge?: number; created: boolean } {
    let account = this.accountByDiscord(profile.id);
    let created = false;
    if (!account) {
      if (!this.registrationOpen())
        throw new HttpError(403, 'Aucun compte KingdomEngine n’est relié à ce compte Discord. Demande à un administrateur de t’ajouter, ou connecte-toi avec ton identifiant puis relie Discord depuis ton profil.');
      account = this.createAccount({ username: this.freeUsername(profile.username), displayName: profile.globalName || profile.username, discordId: profile.id });
      created = true;
    }
    this.refreshDiscordProfile(account.id, profile);
    const { token, maxAge } = this.openSession(account.id, remember, { ...meta, method: 'discord' });
    return { token, account: this.account(account.id)!, maxAge, created };
  }

  /**
   * Propriétaire déclaré dans la configuration (KINGDOM_OWNER_DISCORD_ID), comme le Roi de RoyaumeOS :
   * ce compte Discord peut toujours se connecter et administre la plateforme, même inscriptions fermées.
   * Il est relié au plus ancien administrateur qui n'a pas encore de compte Discord, sinon un compte est créé.
   */
  ensureOwnerDiscord(discordId: string): { account: Account; action: 'ok' | 'linked' | 'created' | 'promoted' } {
    if (!/^\d{17,20}$/.test(discordId)) throw new HttpError(400, 'KINGDOM_OWNER_DISCORD_ID : identifiant Discord de 17 à 20 chiffres.');
    const existing = this.accountByDiscord(discordId);
    if (existing) {
      if (existing.platformRole === 'platform_admin') return { account: existing, action: 'ok' };
      this.db.prepare("UPDATE accounts SET platform_role = 'platform_admin' WHERE id = ?").run(existing.id);
      return { account: this.account(existing.id)!, action: 'promoted' };
    }
    const admin = this.db.prepare("SELECT id FROM accounts WHERE platform_role = 'platform_admin' AND discord_id IS NULL ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (admin) {
      this.db.prepare('UPDATE accounts SET discord_id = ? WHERE id = ?').run(discordId, admin.id);
      return { account: this.account(admin.id)!, action: 'linked' };
    }
    const account = this.createAccount({ username: this.freeUsername('roi'), displayName: 'Roi', discordId, platformRole: 'platform_admin' });
    return { account, action: 'created' };
  }

  /** Nouveau mot de passe aléatoire (outil de secours en ligne de commande). Ferme les sessions du compte. */
  resetPasswordRandom(accountId: number): string {
    const password = randomBytes(9).toString('base64url');
    this.setPassword(accountId, password);
    return password;
  }

  linkDiscord(accountId: number, profile: DiscordProfile): Account {
    const holder = this.accountByDiscord(profile.id);
    if (holder && holder.id !== accountId) throw new HttpError(409, 'Ce compte Discord est déjà relié à un autre compte KingdomEngine.');
    this.db.prepare('UPDATE accounts SET discord_id = ? WHERE id = ?').run(profile.id, accountId);
    this.refreshDiscordProfile(accountId, profile);
    return this.account(accountId)!;
  }

  unlinkDiscord(accountId: number): Account {
    const a = this.account(accountId);
    if (!a?.hasPassword) throw new HttpError(400, 'Choisis d’abord un mot de passe : sans Discord ni mot de passe, tu ne pourrais plus te connecter.');
    this.db.prepare('UPDATE accounts SET discord_id = NULL, discord_name = NULL, avatar_url = NULL WHERE id = ?').run(accountId);
    return this.account(accountId)!;
  }

  private refreshDiscordProfile(accountId: number, p: DiscordProfile) {
    this.db.prepare('UPDATE accounts SET discord_name = ?, avatar_url = ? WHERE id = ?').run(p.globalName ? `${p.globalName} (@${p.username})` : `@${p.username}`, discordAvatar(p), accountId);
  }

  private freeUsername(base: string): string {
    const clean = base.normalize('NFKC').replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 28) || 'joueur';
    const root = clean.length >= 3 ? clean : `${clean}___`.slice(0, 3);
    for (let i = 0; i < 1000; i++) {
      const name = i ? `${root}${i + 1}` : root;
      if (!this.accountByName(name)) return name;
    }
    return `${root}-${randomBytes(3).toString('hex')}`;
  }

  // -------------------------------------------------------------------------
  // Jetons d'accès (MCP et outils externes)
  // -------------------------------------------------------------------------

  createToken(accountId: number, input: { name: string; access: TokenAccess; days?: number | null }): { token: string; id: string } {
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 60) throw new HttpError(400, 'Nom du jeton : 1 à 60 caractères.');
    if (!['read', 'draft', 'publish'].includes(input.access)) throw new HttpError(400, 'Niveau d’accès inconnu.');
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE account_id = ?').get(accountId) as { n: number }).n;
    if (count >= 20) throw new HttpError(400, 'Vingt jetons au maximum : supprime ceux qui ne servent plus.');
    const days = input.days == null ? null : Number(input.days);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new HttpError(400, 'Durée invalide.');
    const id = randomBytes(6).toString('hex');
    const token = `ke4_${randomBytes(30).toString('base64url')}`;
    this.db
      .prepare('INSERT INTO api_tokens (id, account_id, name, token_hash, prefix, access, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, accountId, name, sha256(token), token.slice(0, 10), input.access, this.now(), days ? this.now() + days * 86_400_000 : null);
    return { token, id };
  }

  tokens(accountId: number) {
    const rows = this.db.prepare('SELECT * FROM api_tokens WHERE account_id = ? ORDER BY created_at DESC').all(accountId) as {
      id: string; name: string; prefix: string; access: TokenAccess; created_at: number; last_used_at: number | null; expires_at: number | null;
    }[];
    return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, access: r.access, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at, expired: !!r.expires_at && r.expires_at < this.now() }));
  }

  revokeToken(accountId: number, id: string): void {
    const r = this.db.prepare('DELETE FROM api_tokens WHERE account_id = ? AND id = ?').run(accountId, id);
    if (!r.changes) throw new HttpError(404, 'Jeton inconnu.');
  }

  authenticateToken(token: string | undefined): TokenAccount | undefined {
    if (!token || !token.startsWith('ke4_')) return undefined;
    const row = this.db.prepare('SELECT id, account_id, access, expires_at, last_used_at FROM api_tokens WHERE token_hash = ?').get(sha256(token)) as
      | { id: string; account_id: number; access: TokenAccess; expires_at: number | null; last_used_at: number | null }
      | undefined;
    if (!row || (row.expires_at && row.expires_at < this.now())) return undefined;
    const account = this.account(row.account_id);
    if (!account) return undefined;
    if (!row.last_used_at || this.now() - row.last_used_at > 60_000) this.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(this.now(), row.id);
    return { ...account, tokenId: row.id, tokenAccess: row.access };
  }

  // -------------------------------------------------------------------------
  // Statistiques d'utilisation (suivi externe, ex. RoyaumeOS) — aucune donnée personnelle
  // -------------------------------------------------------------------------

  usageStats() {
    const now = this.now();
    const day = 86_400_000;
    const n = (sql: string, ...args: (number | string)[]) => (this.db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;
    const servers = this.allServers();
    const worlds = servers.map((s) => {
      // Requêtes légères : le JSON des mondes n'est pas relu.
      const pub = this.db.prepare("SELECT version, published_at FROM content WHERE server_id = ? AND status = 'published'").get(s.id) as { version: number; published_at: number | null } | undefined;
      const draft = this.db.prepare("SELECT 1 AS x FROM content WHERE server_id = ? AND status = 'draft'").get(s.id);
      return {
        id: s.id,
        name: s.name,
        template: s.template,
        createdAt: s.createdAt,
        discordLinked: !!s.guildId,
        published: !!pub,
        publishedVersion: pub?.version ?? null,
        publishedAt: pub?.published_at ?? null,
        hasDraft: !!draft,
        players: n('SELECT COUNT(*) AS n FROM players WHERE server_id = ?', s.id),
        activePlayers24h: n('SELECT COUNT(*) AS n FROM players WHERE server_id = ? AND last_seen >= ?', s.id, now - day),
        activePlayers7d: n('SELECT COUNT(*) AS n FROM players WHERE server_id = ? AND last_seen >= ?', s.id, now - 7 * day),
        newPlayers7d: n('SELECT COUNT(*) AS n FROM players WHERE server_id = ? AND first_seen >= ?', s.id, now - 7 * day),
        actions24h: n('SELECT COUNT(*) AS n FROM activity WHERE server_id = ? AND at >= ?', s.id, now - day),
        lastActivityAt: (this.db.prepare('SELECT MAX(at) AS n FROM activity WHERE server_id = ?').get(s.id) as { n: number | null }).n,
        editors: n('SELECT COUNT(*) AS n FROM access WHERE server_id = ?', s.id),
      };
    });
    return {
      accounts: {
        total: n('SELECT COUNT(*) AS n FROM accounts'),
        admins: n("SELECT COUNT(*) AS n FROM accounts WHERE platform_role = 'platform_admin'"),
        discordLinked: n('SELECT COUNT(*) AS n FROM accounts WHERE discord_id IS NOT NULL'),
        new7d: n('SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ?', now - 7 * day),
        new30d: n('SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ?', now - 30 * day),
        active7d: n('SELECT COUNT(DISTINCT account_id) AS n FROM sessions WHERE COALESCE(last_seen, created_at) >= ?', now - 7 * day),
      },
      worlds: {
        total: servers.length,
        discordLinked: worlds.filter((w) => w.discordLinked).length,
        published: worlds.filter((w) => w.published).length,
        live: worlds.filter((w) => w.discordLinked && w.published).length,
        new30d: worlds.filter((w) => w.createdAt >= now - 30 * day).length,
      },
      players: {
        total: n('SELECT COUNT(*) AS n FROM players'),
        unique: n('SELECT COUNT(DISTINCT player_id) AS n FROM players'),
        active24h: n('SELECT COUNT(DISTINCT player_id) AS n FROM players WHERE last_seen >= ?', now - day),
        active7d: n('SELECT COUNT(DISTINCT player_id) AS n FROM players WHERE last_seen >= ?', now - 7 * day),
        new7d: n('SELECT COUNT(*) AS n FROM players WHERE first_seen >= ?', now - 7 * day),
      },
      activity: {
        actions24h: n('SELECT COUNT(*) AS n FROM activity WHERE at >= ?', now - day),
        actions7d: n('SELECT COUNT(*) AS n FROM activity WHERE at >= ?', now - 7 * day),
        publications30d: n("SELECT COUNT(*) AS n FROM content WHERE published_at >= ?", now - 30 * day),
      },
      tokens: {
        total: n('SELECT COUNT(*) AS n FROM api_tokens'),
        used7d: n('SELECT COUNT(*) AS n FROM api_tokens WHERE last_used_at >= ?', now - 7 * day),
      },
      worldList: worlds,
    };
  }

  // -------------------------------------------------------------------------
  // Serveurs et droits
  // -------------------------------------------------------------------------

  templates(): { id: string; name: string; description: string; buildings: number }[] {
    if (!existsSync(this.opts.contentDir)) return [];
    return readdirSync(this.opts.contentDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(this.opts.contentDir, d.name, 'world.json')))
      .map((d) => {
        const w = this.template(d.name);
        return { id: d.name, name: w.name, description: w.description ?? '', buildings: w.buildings.length };
      })
      .sort((a, b) => (a.id === 'vierge' ? -1 : b.id === 'vierge' ? 1 : a.name.localeCompare(b.name)));
  }

  template(id: string): WorldDef {
    if (!/^[a-z0-9-]+$/.test(id)) throw new HttpError(400, 'Modèle inconnu.');
    const path = join(this.opts.contentDir, id, 'world.json');
    if (!existsSync(path)) throw new HttpError(404, 'Modèle inconnu.');
    return JSON.parse(readFileSync(path, 'utf8')) as WorldDef;
  }

  roleOf(account: Account, serverId: string): ServerRole | undefined {
    if (account.platformRole === 'platform_admin') return 'owner';
    const r = this.db.prepare('SELECT role FROM access WHERE account_id = ? AND server_id = ?').get(account.id, serverId) as
      | { role: ServerRole }
      | undefined;
    return r?.role;
  }

  /** Vérifie le droit minimal sur un serveur ; 404 si aucun accès (ne révèle pas l'existence). */
  require(account: Account, serverId: string, min: ServerRole): ServerInfo & { role: ServerRole } {
    const server = this.server(serverId);
    const role = server ? this.roleOf(account, serverId) : undefined;
    if (!server || !role) throw new HttpError(404, 'Serveur introuvable.');
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new HttpError(403, `Droit « ${ROLE_LABEL[min]} » requis.`);
    return { ...server, role };
  }

  server(id: string): ServerInfo | undefined {
    const r = this.db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as
      | { id: string; name: string; guild_id: string | null; template: string; created_at: number }
      | undefined;
    return r ? { id: r.id, name: r.name, guildId: r.guild_id, template: r.template, createdAt: r.created_at } : undefined;
  }

  serverByGuild(guildId: string): ServerInfo | undefined {
    const r = this.db.prepare('SELECT id FROM servers WHERE guild_id = ?').get(guildId) as { id: string } | undefined;
    return r ? this.server(r.id) : undefined;
  }

  allServers(): ServerInfo[] {
    return (this.db.prepare('SELECT id FROM servers ORDER BY created_at').all() as { id: string }[]).map((r) => this.server(r.id)!);
  }

  serversFor(account: Account): (ServerInfo & { role: ServerRole })[] {
    if (account.platformRole === 'platform_admin') return this.allServers().map((s) => ({ ...s, role: 'owner' as const }));
    const rows = this.db.prepare('SELECT server_id, role FROM access WHERE account_id = ?').all(account.id) as { server_id: string; role: ServerRole }[];
    return rows
      .map((r) => ({ ...this.server(r.server_id)!, role: r.role }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Crée un monde. Si le serveur Discord est déjà relié à un autre monde, refus 409 avec ce monde
   * quand le demandeur peut le reprendre (propriétaire de ce monde ou administrateur) : `takeOver` le détache alors.
   */
  createServer(account: Account, input: { name: string; guildId?: string; template: string; takeOver?: boolean }): ServerInfo {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Nom du serveur : 2 à 60 caractères.');
    const guildId = input.guildId?.trim() || null;
    if (guildId && !/^\d{17,20}$/.test(guildId)) throw new HttpError(400, 'Identifiant Discord invalide (17 à 20 chiffres).');
    const holder = guildId ? this.serverByGuild(guildId) : undefined;
    const canTakeOver = !!holder && (account.platformRole === 'platform_admin' || this.roleOf(account, holder.id) === 'owner');
    if (holder && !(canTakeOver && input.takeOver)) {
      if (canTakeOver)
        throw new HttpError(409, `Ce serveur Discord est déjà relié à ton monde « ${holder.name} ».`, { holder: { id: holder.id, name: holder.name }, canTakeOver: true });
      throw new HttpError(409, 'Ce serveur Discord est déjà géré sur la plateforme par un autre compte. Demande à un administrateur de t’y donner accès.');
    }
    const owned = (this.db.prepare("SELECT COUNT(*) AS n FROM access WHERE account_id = ? AND role = 'owner'").get(account.id) as { n: number }).n;
    if (account.platformRole !== 'platform_admin' && owned >= this.opts.maxServersPerAccount)
      throw new HttpError(403, `Limite de ${this.opts.maxServersPerAccount} serveurs atteinte.`);
    const world = this.template(input.template);
    let id = slugify(name);
    for (let i = 2; this.server(id); i++) id = `${slugify(name)}-${i}`;
    const now = this.now();
    transaction(this.db, () => {
      if (holder) {
        this.db.prepare('UPDATE servers SET guild_id = NULL WHERE id = ?').run(holder.id);
        this.audit(holder.id, account.id, 'server.update', `Serveur Discord ${guildId} repris par le nouveau monde « ${name} »`);
      }
      this.db.prepare('INSERT INTO servers (id, name, guild_id, template, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, guildId, input.template, account.id, now);
      this.db.prepare("INSERT INTO access (account_id, server_id, role) VALUES (?, ?, 'owner')").run(account.id, id);
      // Le modèle est copié : les évolutions du modèle ne touchent jamais ce monde.
      this.db
        .prepare("INSERT INTO content (server_id, version, status, revision, world_json, author_id, note, created_at, updated_at, published_at) VALUES (?, 1, 'published', 1, ?, ?, ?, ?, ?, ?)")
        .run(id, JSON.stringify({ ...world, id, name }), account.id, `Modèle « ${world.name} »`, now, now, now);
      this.audit(id, account.id, 'server.create', `Serveur créé depuis le modèle « ${world.name} »`);
    });
    return this.server(id)!;
  }

  updateServer(serverId: string, account: Account, input: { name?: string; guildId?: string | null }): ServerInfo {
    const s = this.server(serverId);
    if (!s) throw new HttpError(404, 'Serveur introuvable.');
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Nom du serveur : 2 à 60 caractères.');
      this.db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(name, serverId);
    }
    if (input.guildId !== undefined) {
      const guildId = input.guildId?.trim() || null;
      if (guildId && !/^\d{17,20}$/.test(guildId)) throw new HttpError(400, 'Identifiant Discord invalide (17 à 20 chiffres).');
      const other = guildId ? this.serverByGuild(guildId) : undefined;
      if (other && other.id !== serverId) throw new HttpError(409, 'Ce serveur Discord est déjà associé à un autre monde.');
      this.db.prepare('UPDATE servers SET guild_id = ? WHERE id = ?').run(guildId, serverId);
    }
    this.audit(serverId, account.id, 'server.update', 'Paramètres du serveur modifiés', input);
    return this.server(serverId)!;
  }

  deleteServer(serverId: string, confirmName: string): void {
    const s = this.server(serverId);
    if (!s) throw new HttpError(404, 'Serveur introuvable.');
    if (confirmName.trim() !== s.name.trim()) throw new HttpError(400, 'Recopie exactement le nom du monde pour confirmer.');
    transaction(this.db, () => {
      // Le lien Discord est libéré d'abord : le serveur Discord peut aussitôt être relié à un autre monde.
      this.db.prepare('UPDATE servers SET guild_id = NULL WHERE id = ?').run(serverId);
      this.db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
    });
    if (this.server(serverId)) throw new HttpError(500, 'La suppression du monde a échoué.');
  }

  members(serverId: string): { accountId: number; username: string; displayName: string; role: ServerRole }[] {
    return (
      this.db
        .prepare('SELECT a.id, a.username, a.display_name, x.role FROM access x JOIN accounts a ON a.id = x.account_id WHERE x.server_id = ? ORDER BY a.username')
        .all(serverId) as { id: number; username: string; display_name: string; role: ServerRole }[]
    ).map((r) => ({ accountId: r.id, username: r.username, displayName: r.display_name, role: r.role }));
  }

  setMember(serverId: string, actor: Account, username: string, role: ServerRole | null): void {
    const target = this.accountByName(username);
    if (!target) throw new HttpError(404, 'Compte introuvable.');
    if (role && !(role in ROLE_RANK)) throw new HttpError(400, 'Rôle invalide.');
    transaction(this.db, () => {
      if (role) this.db.prepare('INSERT INTO access (account_id, server_id, role) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET role = excluded.role').run(target.id, serverId, role);
      else this.db.prepare('DELETE FROM access WHERE account_id = ? AND server_id = ?').run(target.id, serverId);
      const owners = (this.db.prepare("SELECT COUNT(*) AS n FROM access WHERE server_id = ? AND role = 'owner'").get(serverId) as { n: number }).n;
      if (owners === 0) throw new HttpError(400, 'Un serveur doit garder au moins un propriétaire.');
      this.audit(serverId, actor.id, 'access', role ? `${target.username} → ${ROLE_LABEL[role]}` : `${target.username} retiré`);
    });
  }

  // -------------------------------------------------------------------------
  // Contenu versionné
  // -------------------------------------------------------------------------

  private contentRow(serverId: string, status: 'draft' | 'published') {
    return this.db.prepare('SELECT * FROM content WHERE server_id = ? AND status = ?').get(serverId, status) as
      | { version: number; revision: number; world_json: string; updated_at: number; published_at: number | null; author_id: number | null; note: string | null }
      | undefined;
  }

  published(serverId: string): { version: number; world: WorldDef; publishedAt: number } | undefined {
    const r = this.contentRow(serverId, 'published');
    return r ? { version: r.version, world: JSON.parse(r.world_json), publishedAt: r.published_at ?? r.updated_at } : undefined;
  }

  /** Brouillon en cours, ou à défaut la version publiée (révision 0 = pas encore de brouillon). */
  draft(serverId: string): { world: WorldDef; revision: number; version: number | null; updatedAt: number | null; basedOn: number | null } {
    const d = this.contentRow(serverId, 'draft');
    const p = this.contentRow(serverId, 'published');
    if (d) return { world: JSON.parse(d.world_json), revision: d.revision, version: d.version, updatedAt: d.updated_at, basedOn: p?.version ?? null };
    if (!p) throw new HttpError(404, 'Aucun contenu.');
    return { world: JSON.parse(p.world_json), revision: 0, version: null, updatedAt: null, basedOn: p.version };
  }

  contentStatus(serverId: string) {
    const d = this.contentRow(serverId, 'draft');
    const p = this.contentRow(serverId, 'published');
    return {
      published: p ? { version: p.version, publishedAt: p.published_at } : null,
      draft: d ? { version: d.version, revision: d.revision, updatedAt: d.updated_at } : null,
    };
  }

  /** Enregistre le brouillon. `revision` = révision lue ; refus 409 si quelqu'un a enregistré entre-temps. */
  saveDraft(serverId: string, account: Account, world: WorldDef, revision: number): { revision: number; issues: Issue[] } {
    if (world?.format !== 'kingdom-world@1') throw new HttpError(400, 'Document de monde invalide.');
    return transaction(this.db, () => {
      const d = this.contentRow(serverId, 'draft');
      const current = d?.revision ?? 0;
      if (revision !== current)
        throw new HttpError(409, 'Le brouillon a été modifié par quelqu’un d’autre. Recharge-le avant d’enregistrer.', { revision: current });
      const json = JSON.stringify(world);
      const now = this.now();
      if (d) {
        this.db.prepare("UPDATE content SET world_json = ?, revision = revision + 1, author_id = ?, updated_at = ? WHERE server_id = ? AND status = 'draft'").run(json, account.id, now, serverId);
      } else {
        const max = (this.db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM content WHERE server_id = ?').get(serverId) as { v: number }).v;
        this.db
          .prepare("INSERT INTO content (server_id, version, status, revision, world_json, author_id, created_at, updated_at) VALUES (?, ?, 'draft', 1, ?, ?, ?, ?)")
          .run(serverId, max + 1, json, account.id, now, now);
      }
      return { revision: current + 1, issues: validateWorld(world) };
    });
  }

  discardDraft(serverId: string, account: Account): void {
    this.db.prepare("DELETE FROM content WHERE server_id = ? AND status = 'draft'").run(serverId);
    this.audit(serverId, account.id, 'content.discard', 'Brouillon abandonné');
  }

  /** Publie le brouillon (révision attendue). Refusé si le monde contient des erreurs. */
  publish(serverId: string, account: Account, revision: number, note?: string): { version: number; world: WorldDef } {
    return transaction(this.db, () => {
      const d = this.contentRow(serverId, 'draft');
      if (!d) throw new HttpError(400, 'Aucun brouillon à publier.');
      if (d.revision !== revision) throw new HttpError(409, 'Le brouillon a changé depuis ta lecture. Recharge-le.', { revision: d.revision });
      const world = JSON.parse(d.world_json) as WorldDef;
      const errors = validateWorld(world).filter((i) => i.level === 'error');
      if (errors.length) throw new HttpError(422, `${errors.length} erreur(s) à corriger avant publication.`, { issues: errors });
      const now = this.now();
      this.db.prepare("UPDATE content SET status = 'archived' WHERE server_id = ? AND status = 'published'").run(serverId);
      this.db.prepare("UPDATE content SET status = 'published', published_at = ?, note = ? WHERE server_id = ? AND version = ?").run(now, note ?? null, serverId, d.version);
      this.audit(serverId, account.id, 'content.publish', `Version ${d.version} publiée${note ? ` : ${note}` : ''}`);
      return { version: d.version, world };
    });
  }

  versions(serverId: string) {
    return (
      this.db
        .prepare('SELECT c.version, c.status, c.revision, c.note, c.updated_at, c.published_at, a.username FROM content c LEFT JOIN accounts a ON a.id = c.author_id WHERE c.server_id = ? ORDER BY c.version DESC LIMIT 50')
        .all(serverId) as { version: number; status: string; revision: number; note: string | null; updated_at: number; published_at: number | null; username: string | null }[]
    ).map((r) => ({ version: r.version, status: r.status, revision: r.revision, note: r.note, updatedAt: r.updated_at, publishedAt: r.published_at, author: r.username }));
  }

  /** Remet une ancienne version en brouillon (restauration). */
  restore(serverId: string, account: Account, version: number): { revision: number } {
    const r = this.db.prepare('SELECT world_json FROM content WHERE server_id = ? AND version = ?').get(serverId, version) as { world_json: string } | undefined;
    if (!r) throw new HttpError(404, 'Version introuvable.');
    const current = this.contentRow(serverId, 'draft')?.revision ?? 0;
    const res = this.saveDraft(serverId, account, JSON.parse(r.world_json), current);
    this.audit(serverId, account.id, 'content.restore', `Version ${version} restaurée en brouillon`);
    return { revision: res.revision };
  }

  /**
   * Met la dernière version d'un modèle en brouillon (le monde d'un serveur est une copie du modèle,
   * qui ne suit pas ses évolutions). Rien n'est en ligne avant « Publier » ; l'ancienne version reste dans l'historique.
   */
  fromTemplate(serverId: string, account: Account, templateId: string): { revision: number; template: string } {
    const s = this.server(serverId);
    if (!s) throw new HttpError(404, 'Serveur introuvable.');
    const world = this.template(templateId);
    const current = this.contentRow(serverId, 'draft')?.revision ?? 0;
    const res = this.saveDraft(serverId, account, { ...world, id: s.id, name: s.name }, current);
    this.audit(serverId, account.id, 'content.template', `Dernière version du modèle « ${world.name} » mise en brouillon`);
    return { revision: res.revision, template: world.name };
  }

  // -------------------------------------------------------------------------
  // État, joueurs, activité, audit
  // -------------------------------------------------------------------------

  loadState(serverId: string): WorldState | undefined {
    const r = this.db.prepare('SELECT state_json FROM states WHERE server_id = ?').get(serverId) as { state_json: string } | undefined;
    return r ? (JSON.parse(r.state_json) as WorldState) : undefined;
  }

  saveState(serverId: string, state: WorldState): void {
    this.db
      .prepare('INSERT INTO states (server_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(server_id) DO UPDATE SET revision = excluded.revision, state_json = excluded.state_json, updated_at = excluded.updated_at')
      .run(serverId, state.revision, JSON.stringify(state), this.now());
  }

  touchPlayer(serverId: string, playerId: string, name: string, avatarUrl?: string | null): void {
    const now = this.now();
    this.db
      .prepare('INSERT INTO players (server_id, player_id, name, avatar_url, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url, last_seen = excluded.last_seen')
      .run(serverId, playerId, name, avatarUrl ?? null, now, now);
  }

  playerMeta(serverId: string): Map<string, { name: string; avatarUrl: string | null; firstSeen: number; lastSeen: number }> {
    const rows = this.db.prepare('SELECT * FROM players WHERE server_id = ?').all(serverId) as {
      player_id: string;
      name: string;
      avatar_url: string | null;
      first_seen: number;
      last_seen: number;
    }[];
    return new Map(rows.map((r) => [r.player_id, { name: r.name, avatarUrl: r.avatar_url, firstSeen: r.first_seen, lastSeen: r.last_seen }]));
  }

  logActivity(serverId: string, playerId: string | null, buildingId: string | null, text: string): void {
    const r = this.db.prepare('INSERT INTO activity (server_id, at, player_id, building_id, text) VALUES (?, ?, ?, ?, ?)').run(serverId, this.now(), playerId, buildingId, text.slice(0, 500));
    // Conserve les 2 000 dernières lignes par serveur.
    if (Number(r.lastInsertRowid) % 200 === 0)
      this.db.prepare('DELETE FROM activity WHERE server_id = ? AND id <= (SELECT id FROM activity WHERE server_id = ? ORDER BY id DESC LIMIT 1 OFFSET 2000)').run(serverId, serverId);
  }

  activity(serverId: string, limit = 30, playerId?: string) {
    const rows = (
      playerId
        ? this.db.prepare('SELECT * FROM activity WHERE server_id = ? AND player_id = ? ORDER BY id DESC LIMIT ?').all(serverId, playerId, limit)
        : this.db.prepare('SELECT * FROM activity WHERE server_id = ? ORDER BY id DESC LIMIT ?').all(serverId, limit)
    ) as { id: number; at: number; player_id: string | null; building_id: string | null; text: string }[];
    return rows.map((r) => ({ id: r.id, at: r.at, playerId: r.player_id, buildingId: r.building_id, text: r.text }));
  }

  audit(serverId: string | null, accountId: number | null, kind: string, summary: string, detail?: unknown): void {
    this.db
      .prepare('INSERT INTO audit (server_id, at, account_id, kind, summary, detail_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(serverId, this.now(), accountId, kind, summary, detail === undefined ? null : JSON.stringify(detail));
  }

  auditLog(serverId: string, limit = 50) {
    return (
      this.db
        .prepare('SELECT x.id, x.at, x.kind, x.summary, a.username FROM audit x LEFT JOIN accounts a ON a.id = x.account_id WHERE x.server_id = ? ORDER BY x.id DESC LIMIT ?')
        .all(serverId, limit) as { id: number; at: number; kind: string; summary: string; username: string | null }[]
    ).map((r) => ({ id: r.id, at: r.at, kind: r.kind, summary: r.summary, author: r.username ?? 'système' }));
  }

  // -------------------------------------------------------------------------
  // Réglages et médiathèque
  // -------------------------------------------------------------------------

  setting<T>(serverId: string, key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value_json FROM server_settings WHERE server_id = ? AND key = ?').get(serverId, key) as { value_json: string } | undefined;
    return r ? (JSON.parse(r.value_json) as T) : fallback;
  }

  setSetting(serverId: string, key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO server_settings (server_id, key, value_json) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET value_json = excluded.value_json')
      .run(serverId, key, JSON.stringify(value));
  }

  audioList(serverId: string) {
    return (
      this.db.prepare('SELECT * FROM audio WHERE server_id = ? ORDER BY kind, name').all(serverId) as {
        key: string;
        name: string;
        kind: string;
        file: string;
        mime: string;
        size: number;
        volume: number;
        created_at: number;
      }[]
    ).map((r) => ({ key: r.key, name: r.name, kind: r.kind, file: r.file, mime: r.mime, size: r.size, volume: r.volume, createdAt: r.created_at }));
  }

  audio(serverId: string, key: string) {
    return this.audioList(serverId).find((a) => a.key === key);
  }
}
