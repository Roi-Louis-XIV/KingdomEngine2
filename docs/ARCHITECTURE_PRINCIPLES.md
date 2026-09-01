# Principes d'architecture de KingdomEngine

1. **Engine != Content.** Le moteur exécute des primitives génériques ; Le Royaume est un template de démonstration.
2. **Aucun univers imposé.** Les noms, catégories, ressources, lieux, calendriers et conditions viennent des données du monde.
3. **Tout contenu métier est configurable.** Une règle suit autant que possible `condition → cible → propriété → opération → valeur`.
4. **Discord est une interface sociale, pas le moteur.** Le runtime et les données restent utilisables indépendamment du rendu Discord.
5. **PNJ, Voice Presence, Voice Worker et zone sont distincts.** Un worker technique peut incarner plusieurs présences au cours du temps.
6. **Backend configurable et UI utilisable vont ensemble.** Une primitive destinée aux créateurs doit avoir une surface no-code compréhensible.
7. **Desktop sert à créer.** Les builders complets et réglages complexes appartiennent à l'expérience ordinateur.
8. **Mobile sert à superviser.** Il privilégie l'état du monde et les interventions courtes et sûres.
9. **L'infrastructure interne est invisible aux clients.** Services, processus, PID et logs globaux restent réservés à Payen Studio Admin.
10. **Toute évolution de données est migrable.** Les migrations sont additives, idempotentes et testées sur une base existante.
11. **Une option ne bloque jamais le gameplay.** L'absence d'audio ou de worker vocal dégrade l'ambiance, pas les actions de jeu.
12. **Compatibilité et extensibilité avant hardcoding.** Les anciens contrats restent lisibles pendant leur migration vers les abstractions génériques.

## Frontières produit

- **KingdomWeb client** édite et supervise les mondes auxquels l'utilisateur a accès.
- **Payen Studio Admin** supervise la plateforme, ses versions, incidents et consommations. Cette interface est séparée et exige un rôle plateforme.
- **Support Mode** donne un accès temporaire, explicite, limité et audité aux seuls diagnostics consentis par l'utilisateur.
- **KingdomVoice** alloue des workers techniques à des présences vocales ; un PNJ n'est jamais propriétaire d'un token Discord.

## Compatibilité actuelle

`building` reste le nom de contrat historique. Il représente désormais une entité interactive générique et accepte notamment `entity_kind`, `category`, `tags`, `parent_key` et `relations`. Une future API pourra exposer un nom plus générique sans casser les mondes existants.
