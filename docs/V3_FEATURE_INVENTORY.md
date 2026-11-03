# Inventaire fonctionnel V3

Sources : branche V2 `00778b7`, `V1_BUILDINGS_FUNCTIONAL_AUDIT.md`, `V1_TO_V2_BUILDINGS_MIGRATION_REPORT.md`, `docs/EDGAR_V11_IMPLEMENTATION.md` et `V3_TAVERN_REFERENCE.md`. Un inventaire de code ne prouve pas une validation Discord.

| Fonction | Moteur V2 conservé | Surface V3 de cette tranche |
|---|---|---|
| Comptes, sessions, droits | `accounts.py`, dépendances FastAPI | Connexion, reconnexion sans perte de saisie, lecture seule, déconnexion |
| Mondes multiples | Registre de serveurs, SQLite séparées | Sélecteur global, paramètre URL et en-tête par requête |
| Contenus versionnés | `ContentStore.save/publish`, outbox | Sauvegarde, conflits 409, publication confirmée, état Discord distinct |
| Bâtiments | Contrat générique actions/modules/interface | Bibliothèque filtrable, pagination, création vide et éditeur pleine page |
| Identité et références | Payload existant | Nom, description, symbole, catégorie ; nature et lieu en avancé |
| Modules historiques | Métiers, activités, produits, recettes, livraisons, audio, etc. | Inventaire des configurations ; édition dans le Builder classique |
| Interfaces | `KingdomData/interfaces.py`, renderer Discord | Pages intégrées consultables ; pas encore de canvas V2 ni simulateur |
| Stocks, progression, économie | Transactions du moteur | Données du bâtiment consultables ; inchangées par édition/publication |
| Quêtes et scénarios | `kingdomCore/quests.py`, `kingdomEvent` | Inventaire en lecture dans Scénarios |
| Géographie, environnement | `kingdomCore/world.py` | Inventaire en lecture dans Monde |
| Audio, présences, workers | `KingdomVoice`, stockage audio | Inventaire en lecture dans Médiathèque |
| Supervision | Projection métier `/api/admin/overview` | Synthèse en lecture ; interventions dans l'interface classique |
| Connexions et panneaux Discord | File de provisionnement existante | Publication moteur et demande suivie ; test Discord réel non exécuté |

## Écarts explicitement conservés pour les prochaines tranches
Éditeurs spécialisés complets, création de références par sélecteurs pour tous les types, pages libres/secondaires, arborescence et bibliothèque officielle Components V2, conditions/actions visuelles, graphe de dépendances, simulateur isolé multi-joueurs et publication test réelle. Les fonctionnalités V2 restent disponibles ; aucune n'est supprimée.

La Taverne n'est ni un preset forcé ni une branche spécifique du nouveau moteur. La preuve complète depuis un bâtiment vide n'est pas encore réalisée. Les valeurs d'équilibrage ne sont pas inventées dans la V3.
