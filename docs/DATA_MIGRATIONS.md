# Migrations de données

KingdomEngine applique uniquement des migrations SQLite additives et idempotentes au démarrage.

- La base n'est jamais supposée vierge.
- Une table ou colonne historique n'est pas supprimée pendant une migration automatique.
- `managed_servers` reste compatible et représente la connexion Discord historique.
- Les tables `organizations`, `worlds` et `world_discord_servers` sont ajoutées puis rétro-alimentées depuis les accès existants.
- Les plans, droits, quotas et usages sont des capacités techniques configurables ; aucun tarif commercial n'est codé en dur.
- Les autorisations Support Mode expirent automatiquement et leur cycle de vie est audité.

Avant déploiement Debian, `update-server.sh` exécute déjà `backup-server.sh`. Un rollback applicatif peut donc restaurer l'archive précédant la révision, puis redémarrer `kingdom-web`, `kingdom-core` et `kingdom-voice`.
