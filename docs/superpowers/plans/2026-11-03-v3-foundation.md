# KingdomWeb Next — première tranche

> Execution: native, dans cette session. La demande prescrit de réaliser immédiatement la tranche, sans arrêt à un plan.

**Goal:** créer une interface React utilisable sur les API réelles, sans remplacer la V2.
**Architecture:** frontend indépendant `KingdomWebNext`, servi sur `/next` par FastAPI. Sessions et sélection `X-Kingdom-Server` conservées. Aucun changement du schéma SQLite ou du runtime.
**Tech Stack:** React, TypeScript strict, Vite, React Router, Vitest, Playwright, pytest.
**Spec:** `docs/V3_BRIEF.md`, `docs/V3_TAVERN_REFERENCE.md`.

## Contraintes
Branche dédiée, aucun déploiement production, aucun contenu Edgar codé en dur, aucune perte de champs inconnus lors de l'édition. Les six espaces existent ; seuls les parcours de cette tranche sont annoncés comme achevés. Un accusé de mise en file Discord n'est jamais présenté comme une publication Discord confirmée.

## Review focus
Changement rapide de monde, sauvegarde concurrente, session expirée pendant édition, payload historique inconnu, publication sans worker Discord.

## Tâche 1 — contrat et intégration FastAPI
- [ ] Écrire et exécuter les tests du point d'entrée `/next`, des droits monde, du cycle sauvegarde/conflit/publication et de la conservation des données joueur.
- [ ] Ajouter le point d'entrée séparé, conserver `/` et les API V2.
- [ ] Vérifier pytest, documenter les contrats et committer.

## Tâche 2 — Studio connecté
- [ ] Écrire les tests du client API (cookie, monde, erreurs), de l'édition sans perte et des parcours navigateur.
- [ ] Créer les tokens, primitives et shell à six espaces, connexion et sélection globale de monde.
- [ ] Tableau de bord réel, bibliothèque filtrable/paginée, création et édition pleine page : identité, modules existants inspectés, interfaces et relations consultables, activité et données réelles.
- [ ] Sauvegarder avec `expected_version`, publier uniquement un brouillon enregistré après confirmation, montrer séparément la synchronisation Discord.
- [ ] Vérifier types, tests, build, parcours navigateur PC/mobile, erreurs, concurrence, navigation avec changements non enregistrés ; committer.

## Tâche 3 — reprise
- [ ] Mettre à jour les quatre documents V3, instructions de démarrage et limitations précises.
- [ ] Faire relire la branche et corriger les problèmes importants, relancer les vérifications et committer.

## Arbitrages
Les éditeurs spécialisés, le canvas Discord V2 complet et le simulateur sont les tranches suivantes. Cette tranche conserve et affiche les configurations historiques sans offrir de bascules de modules dont l'effet métier ne serait pas défini.
