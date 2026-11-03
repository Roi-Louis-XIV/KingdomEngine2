# KingdomEngine V3 — architecture de la première tranche

## Décision et base
Base auditée : `agent/kingdomengine2-v2`, commit `00778b78f4fc68ee012a78279ca339af357aaa7c`. Travail dans `agent/kingdomengine3-next`. Le runtime, les migrations, schémas et données SQLite, comptes, inventaires, économie, quêtes, timers, workers vocaux et assets sont conservés.

La reconstruction concerne KingdomWeb. Le frontend React/TypeScript vit dans `KingdomWebNext/`. Sa compilation Vite produit `KingdomWeb/static/next/` ; FastAPI sert l'entrée `/next` et les ressources `/static/next/`. Le routeur utilise le fragment URL, sans empiéter sur les routes V2. L'interface classique reste sur `/`. Aucun changement d'API métier n'est requis pour ce jalon.

## Contrats réutilisés
| Besoin | API | Propriétaire et garantie |
|---|---|---|
| Connexion | POST `/api/auth/login`, `/api/auth/logout` | Cookie HttpOnly `royaume_session_v2`, SameSite strict, HTTPS selon configuration existante |
| Monde global | GET `/api/profile`, en-tête `X-Kingdom-Server` | `RegistreComptes`, autorisation à chaque requête, base indépendante par serveur |
| Bibliothèque | GET `/api/content?entity_type=building` | Dernière révision par entité, hors démonstration Académie |
| Édition | GET/POST `/api/content/building/{key}` | Payload entier conservé ; `expected_version=0` pour créer, version lue pour modifier ; 409 en concurrence |
| Publication | POST `/api/content/building/{key}/{version}/publish` | Une révision active par entité, archive de la précédente ; pas de remise à zéro des états joueur |
| Discord | GET `/api/admin/discord/provision/status` | La publication crée une demande durable ; `pending` n'est pas une validation Discord |
| Tableau de bord | GET `/api/admin/overview` | Projection client existante, sans PID ni journaux techniques globaux |

La publication du contenu et la demande Discord sont actuellement deux transactions successives de l'API V2. Pas de nouvelle garantie distribuée ni d'atomicité entre ces deux opérations annoncée par la V3. Le suivi exposé est le dernier état global de provisionnement ; si son bâtiment ne correspond pas, l'interface ne conclut pas au succès du bâtiment courant.

## Frontend
- `src/api.ts` : client typé, cookie, monde, erreurs HTTP, annulation et délai 15 secondes. Aucune relance automatique d'écriture.
- `src/useResource.ts` : chargement/rechargement, annulation des lectures et rejet des réponses obsolètes.
- `src/App.tsx`, `src/context.ts` : shell, connexion, navigation, profil et monde global, contexte scellé par monde.
- `src/features` : tableau de bord, bibliothèque, premier éditeur de bâtiment et inventaires en lecture des autres espaces.
- `src/components/ui.tsx` : états de chargement, erreurs, récupération de session, dialogues, recherche et badges.
- `src/tokens.css`, `src/styles.css` : tokens et règles UI communes. Contrats dans `DESIGN.md` et `UX-CONTRACT.md`.

Le catalogue V2 est chargé intégralement, puis la bibliothèque filtre et pagine par 12 côté client. Une pagination serveur et un endpoint synthétique seront nécessaires pour de très grands mondes. Les sections de configuration historique sont consultables ; leur édition spécialisée n'est pas remplacée par un champ JSON.

## Frontières et suite
Aucun contenu Edgar/Tempête n'est codé dans le nouveau frontend. Le cahier Taverne reste une recette d'acceptation future. Pas de simulateur, de graphe ni d'émulation Discord complète livrés dans ce jalon. Les contraintes officielles Components V2 doivent être vérifiées avant leur implémentation ; les documents V2 historiques ne suffisent pas à certifier un rendu actuel.

## Lancement local
Depuis la racine :
```sh
python -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
npm --prefix KingdomWebNext ci
npm --prefix KingdomWebNext run build
KINGDOM_DATA_DIR="$PWD/var/v3-dev" KINGDOM_DATABASE="$PWD/var/v3-dev/kingdom.db" .venv/bin/python -m uvicorn KingdomWeb.app:app --host 127.0.0.1 --port 8000
```
Ouvrir `/next` sur ce serveur. La base indiquée est distincte d'une installation de production ; le démarrage normal réutilise les initialisations et le catalogue de la V2. Renseigner les identifiants de développement via `KINGDOM_ADMIN_USERNAME` et `KINGDOM_ADMIN_PASSWORD` avant le premier démarrage. Aucun token Discord n'est nécessaire pour le Studio seul. Sous Windows, remplacer `.venv/bin/python` par `.venv\Scripts\python.exe`.

Pour le rechargement frontend à chaud : backend sur 8000, puis `npm --prefix KingdomWebNext run dev` ; ouvrir l'adresse `/static/next/` du serveur Vite sur le port qu'il indique. Les API sont proxifiées vers 8000. Ce serveur reste local.

Pour un test autonome, `npm --prefix KingdomWebNext run test:e2e` lance le serveur `scripts/v3_test_server.py` et Chromium sur une base temporaire. Ce serveur de test ne doit jamais être utilisé comme serveur public : ses identifiants sont des fixtures, et il ne lance aucun bot.

L'archive Python inclut les fichiers compilés si le build a été réalisé avant packaging. Le JS compilé n'est pas versionné ; le lockfile npm l'est.
