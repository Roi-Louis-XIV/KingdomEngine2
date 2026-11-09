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
}
const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  platformRole: r.platform_role,
  createdAt: r.created_at,
});

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

  createAccount(input: { username: string; password: string; displayName?: string; platformRole?: Account['platformRole'] }): Account {
    const username = input.username.trim();
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username))
      throw new HttpError(400, 'Identifiant : 3 à 32 caractères (lettres, chiffres, . _ -).');
    if (input.password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
    // Le tout premier compte administre la plateforme.
    const role = this.accountCount() === 0 ? 'platform_admin' : (input.platformRole ?? 'user');
    try {
      const r = this.db
        .prepare('INSERT INTO accounts (username, display_name, password_hash, platform_role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(username, input.displayName?.trim() || username, hashPassword(input.password), role, this.now());
      return this.account(Number(r.lastInsertRowid))!;
    } catch (e) {
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

  listAccounts(): (Account & { servers: number })[] {
    const rows = this.db
      .prepare('SELECT a.*, (SELECT COUNT(*) FROM access x WHERE x.account_id = a.id) AS servers FROM accounts a ORDER BY a.id')
      .all() as (AccountRow & { servers: number })[];
    return rows.map((r) => ({ ...toAccount(r), servers: r.servers }));
  }

  setPassword(accountId: number, password: string): void {
    if (password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
    this.db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(password), accountId);
    this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
  }

  deleteAccount(accountId: number): void {
    const admins = this.db.prepare("SELECT id FROM accounts WHERE platform_role = 'platform_admin'").all() as { id: number }[];
    if (admins.length === 1 && admins[0]!.id === accountId) throw new HttpError(400, 'Impossible de supprimer le dernier administrateur.');
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  }

  login(username: string, password: string, remember: boolean): { token: string; account: Account; maxAge?: number } {
    const r = this.db.prepare('SELECT * FROM accounts WHERE username = ?').get(username.trim()) as AccountRow | undefined;
    // Vérification systématique pour ne pas révéler l'existence d'un compte par le temps de réponse.
    const ok = verifyPassword(password, r?.password_hash ?? hashPassword('leurre-temporel'));
    if (!r || !ok) throw new HttpError(401, 'Identifiant ou mot de passe incorrect.');
    const token = randomBytes(32).toString('base64url');
    const ttl = remember ? SESSION_LONG : SESSION_SHORT;
    this.db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha256(token), r.id, this.now() + ttl, this.now());
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(this.now());
    return { token, account: toAccount(r), maxAge: remember ? ttl / 1000 : undefined };
  }

  authenticate(token: string | undefined): Account | undefined {
    if (!token) return undefined;
    const row = this.db.prepare('SELECT account_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as
      | { account_id: number; expires_at: number }
      | undefined;
    if (!row || row.expires_at < this.now()) return undefined;
    return this.account(row.account_id);
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
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

  createServer(account: Account, input: { name: string; guildId?: string; template: string }): ServerInfo {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Nom du serveur : 2 à 60 caractères.');
    const guildId = input.guildId?.trim() || null;
    if (guildId && !/^\d{17,20}$/.test(guildId)) throw new HttpError(400, 'Identifiant Discord invalide (17 à 20 chiffres).');
    if (guildId && this.serverByGuild(guildId))
      throw new HttpError(409, 'Ce serveur Discord est déjà géré sur la plateforme. Demande à un administrateur de t’y donner accès.');
    const owned = (this.db.prepare("SELECT COUNT(*) AS n FROM access WHERE account_id = ? AND role = 'owner'").get(account.id) as { n: number }).n;
    if (account.platformRole !== 'platform_admin' && owned >= this.opts.maxServersPerAccount)
      throw new HttpError(403, `Limite de ${this.opts.maxServersPerAccount} serveurs atteinte.`);
    const world = this.template(input.template);
    let id = slugify(name);
    for (let i = 2; this.server(id); i++) id = `${slugify(name)}-${i}`;
    const now = this.now();
    transaction(this.db, () => {
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
    if (confirmName.trim() !== s.name) throw new HttpError(400, 'Recopie exactement le nom du serveur pour confirmer.');
    this.db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
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
