# Guide de création de mondes KingdomEngine (pour les IA)

Ce guide est renvoyé par l'outil `get_guide` du serveur MCP. Il s'adresse à une IA qui aide une personne à concevoir un monde. Le modèle de données complet est renvoyé par `get_reference`.

## Ce qu'est un monde

KingdomEngine fait vivre un jeu de rôle **sur Discord**. Chaque **bâtiment** a sur le serveur Discord :

- une catégorie ;
- un salon vocal pour y entrer ;
- un salon texte.

Quand un joueur entre, il reçoit une **interface personnelle** : un message Discord à boutons, fait d'**écrans**. Chaque écran est une liste de **blocs** :

- textes, encadrés et séparateurs ;
- sections avec un bouton ;
- rangées de boutons ;
- emplacement du message de retour (`notice`) ;
- **widgets** branchés sur des **modules** : boutique, rachat, production, dialogue, dés, activités, objectifs communs, panneau des quêtes, fiche du joueur, classement.

Au niveau du monde, on trouve :

- les statistiques du joueur (endurance, écus…) ;
- les objets ;
- les bonus temporaires (modificateurs) ;
- les métiers, avec niveaux et expérience ;
- les variables partagées (phase du scénario…) ;
- la météo et les événements programmés ;
- les quêtes personnelles ;
- le serment d'arrivée.

Tout le contenu est **de la donnée**, et le moteur est générique. Un bouton suit la règle *condition → actions → résultat*. Les actions s'exécutent en **tout ou rien** : si une seule échoue (pas assez d'écus, par exemple), rien n'est modifié et le joueur voit l'explication.

## Méthode de travail

1. `list_worlds`, puis `get_world_outline` : identifiants, index des bâtiments, révision du brouillon.
2. `get_reference` une fois, pour connaître les types exacts (actions, conditions, widgets…).
3. Avant de créer quelque chose, lis un exemple proche avec `get_world` et un pointeur précis, par exemple `/buildings/1/screens/0`. Les modèles « Le Royaume » et « La Nuit de la Sainte Pelle » (`list_templates`) contiennent tous les cas.
4. Modifie avec `patch_draft`, par petites opérations, en donnant la **révision lue**. Si elle a changé, quelqu'un a travaillé dans le Studio : relis avant de recommencer.
5. Après chaque série de modifications : `validate_world`. Les **erreurs** bloquent la publication, les avertissements non.
6. Essaie avec `preview_play` : c'est le joueur, sur Discord, dans un monde neuf et isolé. Vérifie :
   - que les textes sont lisibles et que les boutons mènent où il faut ;
   - qu'un refus s'explique (« il te faut 3 écus ») ;
   - que les limites Discord tiennent (section « Limites Discord dépassées »).
7. `publish_draft` **seulement si la personne te l'a demandé**. Les joueurs voient la nouvelle version immédiatement.

## Règles à respecter

- **Français**, phrases simples, ton du monde (médiéval, chaleureux, un peu d'humour). Pas de jargon technique dans ce que voient les joueurs.
- **Identifiants** :
  - minuscules, chiffres, `_` ou `-` : `pain_emballe`, `forge` ;
  - stables : ne renomme jamais un identifiant existant (l'état des joueurs y fait référence) ; change plutôt le `name` ;
  - uniques : avant d'ajouter un objet, vérifie qu'il n'existe pas déjà (`get_world_outline` → `items`).
- **Limites Discord par interface** : 40 composants au maximum (chaque texte, bouton, rangée, encadré compte) et 4 000 caractères de texte. Au-delà, découpe en plusieurs écrans reliés par des boutons de navigation.
- **Au plus 5 boutons par rangée.** Un menu déroulant occupe une rangée à lui seul (25 choix au maximum).
- Chaque écran doit permettre de **revenir** : bouton « Retour » vers l'écran d'accueil du bâtiment (`homeScreen`).
- Garde un bloc `notice` sur les écrans où l'on agit : c'est là que s'affichent les messages de succès et de refus.
- **Textes dynamiques** :
  - joueur : `{player}` (mention du joueur), `{player.stat.ecus}`, `{player.job}`, `{player.level.<métier>}`, `{player.xp.<métier>}` ;
  - monde : `{var.<variable>}` et `{var.<variable>.label}` ;
  - lieu : `{building.name}`, `{npc.name}`, `{npc.title}` ;
  - réserves et objectifs : `{stock.<inventaire>.<objet>}`, `{objective.<bâtiment>.<objectif>}` (pourcentage).

  Un texte peut aussi varier selon des conditions : `{ "cases": [{ "when": …, "text": "…" }, { "text": "texte par défaut" }] }`. Le premier cas vrai l'emporte ; un cas sans `when` sert de défaut.
- **Sons** : ne référence que des clés existantes (`list_media`). Sinon, préviens la personne qu'elle devra importer le son dans la Médiathèque du Studio.
- **Économie** : reste cohérent avec les prix existants du monde. Un nouvel objet doit avoir une source (récolte, achat, production, récompense) et un usage.
- N'invente pas de mécanique absente du modèle. Si un besoin ne rentre pas dans les primitives existantes, dis-le à la personne plutôt que de détourner un champ.

## Quêtes

Le panneau des quêtes (`quest.board`) propose des quêtes selon le niveau du joueur. Un joueur n'a qu'une quête à la fois. Les étapes sont de trois sortes :

- `visit` : aller dans un bâtiment ;
- `deliver` : apporter des objets ;
- `count` : faire quelque chose N fois.

Une étape `count` compte des **repères**, posés automatiquement par le moteur :

| Repère | Posé quand… |
|---|---|
| `activity:<bâtiment>/<activité>` | une activité est terminée |
| `objective:<bâtiment>/<objectif>[:<objet>]` | le joueur contribue à un objectif commun |
| `shop:<bâtiment>/<boutique>` | il achète dans une boutique |
| `buy:<bâtiment>/<offre>` | il achète une offre précise |
| `cook:<bâtiment>/<recette>` | il cuisine une recette |
| `production:<bâtiment>/<recette>` | il produit une recette |
| `dialogue:<bâtiment>/<nœud>` | il atteint un nœud de dialogue |
| `dice:<bâtiment>/<module>:win` | il gagne aux dés |
| `consume:<objet>` | il consomme un objet |
| `repair`, `repair:<objet>` | il répare un outil |

On peut aussi poser un repère à la main avec l'action `quest.tag`.

## Exemples d'opérations

Renommer un bâtiment :

```json
{ "op": "set", "path": "/buildings/2/name", "value": "La Forge du Dragon Noir" }
```

Ajouter un objet à la fin de la liste :

```json
{ "op": "add", "path": "/items/-", "value": { "id": "miel", "name": "Pot de miel", "emoji": "🍯" } }
```

Ajouter un écran au bâtiment n° 3 (copie d'abord la forme d'un écran existant) :

```json
{ "op": "add", "path": "/buildings/3/screens/-", "value": { "id": "cave", "name": "La cave", "blocks": [ … ] } }
```

Supprimer la 4ᵉ quête :

```json
{ "op": "remove", "path": "/quests/quests/3" }
```

Les pointeurs suivent la RFC 6901 : `/` sépare les niveaux, les listes sont indexées à partir de 0, et `-` désigne la fin d'une liste pour `add`.

## Essai (`preview_play`)

Les étapes possibles :

```json
[
  { "press": "Commander" },
  { "select": "Choisis un plat", "values": ["ragout"] },
  { "wait_minutes": 10 },
  { "enter": "forge" },
  { "start_event": "scenario" },
  { "set_variable": "phase", "value": "tempete" }
]
```

- `press` accepte :
  - le libellé du bouton (même partiel, sans accents) ;
  - le titre de sa section : utile quand plusieurs boutons s'appellent « Lancer » ;
  - l'identifiant exact du bouton.
- `start_event` lance un événement (par exemple le scénario), puis `wait_minutes` fait avancer le temps : c'est ainsi qu'on teste ce qui n'est disponible qu'à une étape précise.
- Le serment d'arrivée est prêté automatiquement.
- Le hasard est fixé par `seed` : le même essai donne le même résultat.

## Ce que tu ne peux pas faire ici

- Relier un monde à Discord, gérer les salons, les rôles ou les Voice Workers : c'est dans le Studio (page « Discord & voix »).
- Importer des sons : Médiathèque du Studio.
- Voir ou modifier les joueurs réels et leur progression.
