// Copie cohérente d'une base SQLite en fonctionnement (mode WAL), puis vérification d'intégrité.
// Usage : node scripts/backup-db.mjs <source.db> <destination.db>
import { DatabaseSync, backup } from 'node:sqlite';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('Usage : node scripts/backup-db.mjs <source.db> <destination.db>');
  process.exit(2);
}
const db = new DatabaseSync(src, { readOnly: true });
await backup(db, dest);
db.close();
// Copie autonome : un seul fichier, sans journal annexe.
const copy = new DatabaseSync(dest);
copy.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
const res = copy.prepare('PRAGMA integrity_check').get();
copy.close();
if (Object.values(res)[0] !== 'ok') {
  console.error('Copie corrompue.');
  process.exit(1);
}
