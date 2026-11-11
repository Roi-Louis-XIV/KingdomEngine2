/** Propriétaire déclaré par son compte Discord (KINGDOM_OWNER_DISCORD_ID) et secours des comptes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.ts';
import { Platform } from '../src/platform.ts';

const ROOT_CONTENT = new URL('../../../content', import.meta.url).pathname;
const OWNER = '123456789012345678';
const fresh = () => new Platform(openDatabase(':memory:'), { contentDir: ROOT_CONTENT, allowRegistration: false });

test('propriétaire Discord : relié au premier administrateur, qui se connecte avec Discord même inscriptions fermées', () => {
  const p = fresh();
  const admin = p.createAccount({ username: 'louis', password: 'motdepasse1' });
  p.createAccount({ username: 'autre', password: 'motdepasse2' });
  assert.equal(p.ensureOwnerDiscord(OWNER).action, 'linked');
  assert.equal(p.accountByDiscord(OWNER)!.id, admin.id);
  assert.equal(p.ensureOwnerDiscord(OWNER).action, 'ok'); // à chaque démarrage : rien ne change
  const s = p.loginWithDiscord({ id: OWNER, username: 'louis_xiv', globalName: 'Louis' }, false);
  assert.equal(s.created, false);
  assert.equal(s.account.username, 'louis');
  assert.equal(s.account.platformRole, 'platform_admin');
  assert.throws(() => p.loginWithDiscord({ id: '999999999999999999', username: 'inconnu' }, false), /Aucun compte KingdomEngine/);
});

test('propriétaire Discord : compte créé si aucun administrateur libre, promu s’il existait comme simple utilisateur', () => {
  const p = fresh();
  assert.equal(p.ensureOwnerDiscord(OWNER).action, 'created');
  assert.equal(p.accountByDiscord(OWNER)!.platformRole, 'platform_admin');
  const q = fresh();
  q.createAccount({ username: 'premier', password: 'motdepasse1' }); // administrateur (premier compte)
  q.createAccount({ username: 'louis', discordId: OWNER });
  assert.equal(q.ensureOwnerDiscord(OWNER).action, 'promoted');
  assert.equal(q.accountByName('louis')!.platformRole, 'platform_admin');
  assert.throws(() => q.ensureOwnerDiscord('abc'), /17 à 20 chiffres/);
});

test('secours : un nouveau mot de passe aléatoire ouvre le compte et ferme les anciennes sessions', () => {
  const p = fresh();
  const a = p.createAccount({ username: 'louis', password: 'oublie-depuis' });
  const old = p.login('louis', 'oublie-depuis', false).token;
  const pw = p.resetPasswordRandom(a.id);
  assert.ok(pw.length >= 12);
  assert.equal(p.authenticate(old), undefined);
  assert.equal(p.login('louis', pw, false).account.id, a.id);
});
