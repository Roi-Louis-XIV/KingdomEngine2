/**
 * Outil de secours pour les comptes, à lancer sur le serveur (accès root) quand on ne peut plus se connecter.
 * Sur Debian, passe par : sudo bash /opt/kingdomengineNext/deploy/compte.sh <commande>
 *
 *   liste                              comptes : identifiant, rôle, Discord, mot de passe, dernière connexion
 *   mot-de-passe <identifiant>         nouveau mot de passe aléatoire (affiché une fois), sessions fermées
 *   discord <identifiant> <id discord> relie un compte Discord (connexion « Se connecter avec Discord »)
 *   admin <identifiant>                donne l'administration de la plateforme
 */
import { resolve } from 'node:path';
import { openDatabase } from '../apps/server/src/db.ts';
import { Platform, HttpError } from '../apps/server/src/platform.ts';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(process.env.KINGDOM_DATA_DIR ?? resolve(root, 'var'));
const db = openDatabase(resolve(dataDir, 'kingdom.db'));
const platform = new Platform(db, { contentDir: resolve(root, 'content') });
const [cmd, ...args] = process.argv.slice(2);

const date = (t: number | null) => (t ? new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : 'jamais');
const find = (username: string | undefined) => {
  const a = username ? platform.accountByName(username) : undefined;
  if (!a) {
    console.error(`Compte « ${username ?? ''} » introuvable. Lance « liste » pour voir les identifiants.`);
    process.exit(1);
  }
  return a;
};

try {
  switch (cmd) {
    case 'liste': {
      const rows = platform.listAccounts();
      if (!rows.length) console.log('Aucun compte : ouvre le Studio, le premier compte créé sera administrateur.');
      for (const a of rows)
        console.log(
          [
            `#${a.id}`,
            `identifiant : ${a.username}`,
            `nom : ${a.displayName}`,
            a.platformRole === 'platform_admin' ? 'ADMINISTRATEUR' : 'utilisateur',
            a.discordId ? `Discord ${a.discordId}${a.discordName ? ` (${a.discordName})` : ''}` : 'sans Discord',
            a.hasPassword ? 'mot de passe : oui' : 'mot de passe : non',
            `dernière connexion : ${date(a.lastLoginAt)}`,
          ].join(' · '),
        );
      break;
    }
    case 'mot-de-passe': {
      const a = find(args[0]);
      const pw = platform.resetPasswordRandom(a.id);
      platform.audit(null, a.id, 'account.password', 'Mot de passe réinitialisé en ligne de commande');
      console.log(`Nouveau mot de passe de « ${a.username} » : ${pw}`);
      console.log('Connecte-toi avec, puis change-le dans Mon profil. Les sessions ouvertes ont été fermées.');
      break;
    }
    case 'discord': {
      const a = find(args[0]);
      const id = String(args[1] ?? '').trim();
      if (!/^\d{17,20}$/.test(id)) throw new HttpError(400, 'Identifiant Discord : 17 à 20 chiffres (Discord › Mode développeur › clic droit sur ton nom › Copier l’identifiant).');
      platform.linkDiscord(a.id, { id, username: a.username });
      db.prepare('UPDATE accounts SET discord_name = NULL WHERE id = ?').run(a.id); // le vrai pseudo s'affichera à la première connexion
      platform.audit(null, a.id, 'account.discord.link', 'Compte Discord relié en ligne de commande');
      console.log(`« ${a.username} » est relié au compte Discord ${id} : « Se connecter avec Discord » fonctionne pour lui.`);
      break;
    }
    case 'admin': {
      const a = find(args[0]);
      db.prepare("UPDATE accounts SET platform_role = 'platform_admin' WHERE id = ?").run(a.id);
      platform.audit(null, a.id, 'account.admin', 'Administration donnée en ligne de commande');
      console.log(`« ${a.username} » administre maintenant la plateforme.`);
      break;
    }
    default:
      console.log(`Commandes :
  liste
  mot-de-passe <identifiant>
  discord <identifiant> <id discord>
  admin <identifiant>`);
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(e instanceof HttpError ? e.message : e);
  process.exit(1);
} finally {
  db.close();
}
