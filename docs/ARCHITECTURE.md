# Architecture de KingdomEngine 4

## Principe : un seul moteur, plusieurs afficheurs

```
 world.json (contenu)          état (JSON, sauvegardé)
        │                               │
        ▼                               ▼
 ┌──────────────────────────────────────────────┐
 │  packages/engine — moteur pur et synchrone   │
 │  conditions · actions · transactions · rendu │
 └───────────────┬──────────────────────────────┘
                 │ rendu neutre (calqué sur Components V2)
       ┌─────────┴──────────┐
       ▼                    ▼
  apps/bot (Discord)   apps/emulator (navigateur) → futur Studio
```

- **Le moteur ne connaît pas Discord.** Il produit un arbre neutre (encadrés, textes, sections, séparateurs, rangées de boutons, menus) que chaque afficheur traduit.
- **L’émulateur exécute le même code que le bot.** Ce que le créateur teste est exactement ce que vivront les joueurs.
- **Atomicité.** Chaque interaction s’exécute sur une copie de l’état, validée seulement si toutes les actions réussissent. Les méthodes étant synchrones, deux clics ne peuvent pas s’entrelacer. Exemple : deux cuisiniers visent la même marmite, un seul réussit et aucun ingrédient n’est perdu.
- **Boutons sans état.** Un `customId` contient la session, l’écran et le chemin du bloc. Les interfaces restent donc utilisables après un redémarrage.

## Le modèle d’un monde (`packages/engine/src/model.ts`)

| Élément | Exemple dans la Taverne |
|---|---|
| **Statistiques** du joueur (jauge, monnaie, valeur) | Bourse, Énergie 0–100, Alcoolémie |
| **Objets** (consommables ou non) | Légumes, Bouteille de vin (+5 énergie, bonus XP) |
| **Bonus temporaires** (groupes exclusifs) | Récolte minière +15 % pendant 15 min |
| **Métiers** (XP, niveaux, maximum simultané) | Cuisinier, 100 XP par niveau, un seul métier |
| **Variables du monde** | Phase : calme / tempête / après |
| **Bâtiments** = modules + écrans | À la Gueuse Cocue |

### Modules génériques d’un bâtiment

| Module | Ce qu’il fait |
|---|---|
| `inventory` | Réserve partagée, sans plafond, avec objectifs indicatifs |
| `shop` | Catalogue : sur place (effets immédiats) ou à emporter (objet + supplément) |
| `buyback` | Rachat aux joueurs, prix selon la réserve (paliers configurables) |
| `production` | Postes partagés, recettes par niveau, durée, XP lancement/récupération |
| `dialogue` | Arbre de sujets, répliques conditionnelles et en rotation |
| `dice` | Duel de dés contre un PNJ |

### Écrans

Un écran est une liste de **blocs** : texte, encadré, séparateur, section avec bouton, rangée de boutons, emplacement du message de retour, ou **widget** de module (catalogue, marmites, recettes, stocks, vente, dialogue, dés, état du joueur, inventaire).

Chaque bouton porte une **règle** : *condition → actions → résultat (écran suivant, message)*. Les textes peuvent varier selon des conditions et contenir des variables comme `{player.stat.ecus}`, `{player.level.cuisinier}`, `{var.phase.label}` ou `{production.cuisine.free}`.

Un écran peut avoir une **garde** : la cuisine renvoie à l’accueil quiconque n’est pas cuisinier, même s’il clique un ancien bouton.

## Diagnostic

`validateWorld()` signale les références cassées (objet, écran ou module inconnu…) avec leur emplacement. `validateRendered()` vérifie les limites Discord : 40 composants, 4 000 caractères, 5 boutons par rangée, 25 options par menu, `customId` de 100 caractères au plus. Le futur Studio les affichera en direct.
