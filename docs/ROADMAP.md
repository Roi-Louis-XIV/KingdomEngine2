# Feuille de route

## ✅ Jalon 1 — Fondations (fait)
- Moteur générique, atomique et sans dépendance (TypeScript).
- Taverne d’Edgar V11 reconstruite en pur contenu JSON.
- 23 tests : métier unique, cuisson minutée, XP 80/20, démission, concurrence, achats sur place / à emporter, bonus exclusifs, rachat dynamique, dialogues conditionnels, dés, gardes d’accès, redémarrage, limites Discord.
- Bot Discord (Components V2) avec sauvegarde atomique et rafraîchissement automatique.
- Émulateur navigateur exécutant le vrai moteur.

## Jalon 2 — Studio (prochaine étape)
L’objectif : **créer un bâtiment complet sans toucher au JSON**.
- Application web : liste des bâtiments, éditeur pleine page, émulateur intégré à droite qui se met à jour à chaque modification.
- Assistants guidés : « Ajouter une boutique », « Ajouter une cuisine », « Ajouter un dialogue ». Chacun crée le module ET des écrans prêts à l’emploi.
- Éditeurs dédiés : objets, statistiques, bonus, métiers, recettes, offres, arbre de dialogue.
- Éditeur d’écran : glisser-déposer des blocs, inspecteur de propriétés, éditeur de règles (*quand → si → alors*) avec explication des conditions.
- Diagnostic en direct et publication vers le bot (rechargement à chaud du monde).

## Jalon 3 — Robustesse et production
- Stockage SQLite, sauvegardes, historique des versions du contenu.
- Comptes, permissions, plusieurs mondes et serveurs.
- Rechargement du monde sans redémarrer le bot.

## Plus tard
- Quêtes et événements planifiés, calendrier, timeline de scénario.
- Bots vocaux (ambiances, PNJ parlants), médiathèque.
- Nouveaux modules : quêtes, récolte, artisanat, mini-jeux supplémentaires.
