/**
 * Base de données de la plateforme (SQLite intégré à Node, mode WAL).
 * Les migrations sont additives et idempotentes : une base existante n'est jamais vidée.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS: string[] = [
  // 1 — socle
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    platform_role TEXT NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user', 'platform_admin')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    guild_id TEXT UNIQUE,
    template TEXT NOT NULL,
    created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE access (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'manager', 'owner')),
    PRIMARY KEY (account_id, server_id)
  );
  CREATE TABLE content (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
    revision INTEGER NOT NULL DEFAULT 1,
    world_json TEXT NOT NULL,
    author_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    published_at INTEGER,
    PRIMARY KEY (server_id, version)
  );
  CREATE UNIQUE INDEX one_draft ON content(server_id) WHERE status = 'draft';
  CREATE UNIQUE INDEX one_published ON content(server_id) WHERE status = 'published';
  CREATE TABLE states (
    server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE players (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (server_id, player_id)
  );
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    player_id TEXT,
    building_id TEXT,
    text TEXT NOT NULL
  );
  CREATE INDEX activity_server ON activity(server_id, id DESC);
  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail_json TEXT
  );
  CREATE INDEX audit_server ON audit(server_id, id DESC);
  CREATE TABLE audio (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('ambience', 'music', 'voice', 'sfx')),
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    volume REAL NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (server_id, key)
  );
  CREATE TABLE server_settings (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY (server_id, key)
  );
  `,
];

export type DB = DatabaseSync;

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]!);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
    });
    version += 1;
  }
  return db;
}

/** Exécute fn dans une transaction SQLite (annulée en cas d'exception). */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
