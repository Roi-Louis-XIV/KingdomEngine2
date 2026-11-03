# Contrat d’interaction V3

Sources métier : `docs/V3_BRIEF.md`, `docs/ARCHITECTURE_PRINCIPLES.md`, API de `KingdomWeb/app.py`, versions et transactions de `KingdomData/store.py`, droits de `KingdomWeb/accounts.py`.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | Select natif étiqueté | DESIGN.md | Monde, état, références ; popup système accepté | Playwright clavier et sélection |
| Form | BuildingEditor, LoginForm | API V2, UX-CONTRACT.md | Identité, connexion ; noValidate | Tests navigateur |
| Scrollbar | KingdomWebNext/src/styles.css | DESIGN.md, tokens.css | forced-colors natif | Inspection navigateur |
| Toast | ErrorNotice, statut persistant | UX-CONTRACT.md | Erreur, succès role=status | Échec et sauvegarde navigateur |
| CRUD | ApiClient, routes React Router | API V2, UX-CONTRACT.md | Créer → fiche créée, éditer → rester ; suppression hors tranche | Cycle SQLite et E2E |

## Navigation et données
Le paramètre `world` reste dans l’URL de chaque destination. Le profil valide cet accès, le backend reste l’autorité. Chaque requête porte `X-Kingdom-Server`. Le changement de monde remonte l’espace de travail ; AbortController annule les lectures précédentes et les réponses obsolètes sont ignorées.

Création depuis une configuration vide avec identifiant généré. Les champs inconnus du payload, les modules, actions et interfaces sont conservés par édition additive. Les modes guidé/avancé modifient le même objet. Mode lecture pour les rôles non autorisés ; le serveur vérifie chaque opération.

## Enregistrement et publication
Sauvegarde explicite avec `expected_version`. Pas de mutation optimiste ni de relance automatique d’écriture. En cas de 409, conserver la saisie et proposer le rechargement après confirmation. En cas de délai ou perte de connexion, indiquer l’incertitude et vérifier la révision moteur avant une nouvelle tentative.

La publication nécessite une révision enregistrée, non modifiée et en brouillon ; dialogue nommant le bâtiment et le monde. Un retour de publication signifie contenu actif dans le moteur, puis demande durable de synchronisation Discord. L’état `done` seul confirme la fin de synchronisation remontée par le moteur ; aucune connexion Discord n’est supposée.

## Récupération et sécurité
Navigation avec modifications non enregistrées : dialogue rester/quitter, y compris changement de monde. Sortie de page : beforeunload. Session expirée : reconnexion dans un dialogue sans effacer la fiche. Aucun token dans le navigateur ; cookies de session du backend. Déconnexion via navigation bloquable.

## Listes et accessibilité
Recherche/filtre/page dans l’URL. Catalogue V2 reçu en entier puis filtré et paginé localement par 12 ; autres inventaires en lecture dans une zone de défilement bornée. Français, dates Europe/Paris explicites. Contrôles sémantiques, clavier, focus visible, dialogues natifs modaux, mouvement réduit. Messages d’erreur persistants et champs invalides associés à leur explication.

## Migration
L’interface V2 et ses contrôles spécialisés restent disponibles. Aucun écran V3 ne prétend remplacer un éditeur spécialisé non encore livré. Suppression, graphe, canvas V2, simulation et interventions supervision constituent les tranches suivantes.
