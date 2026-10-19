# Edgar UX Lab V11 — suivi d’intégration

## Objectif

Faire de la Taverne de la Tempête un bâtiment de référence entièrement configurable, fondé sur les primitives génériques de KingdomEngine2 et sur une interface Discord personnelle mono-message.

## Architecture retenue

- Conserver `InterfaceView`, les Components V2 et l’édition visuelle KingdomWeb.
- Réutiliser les stocks partagés, postes de transformation, métiers, consommables, dialogues, quêtes et événements existants.
- Ajouter uniquement les primitives génériques manquantes, puis configurer la Taverne dans `storm_sainte_pelle_content.py`.
- Préserver les mondes existants ; leur mise à jour reste explicite via la synchronisation du template.

## Audit ciblé

- **Réutilisable :** navigation mono-message, conditions, achats atomiques, consommables, marmites persistantes, XP 80/20, dialogues, dés, quêtes, timeline et audio.
- **À étendre :** catalogue filtré, présentation des recettes impossibles, rafraîchissement temporisé mutualisé, livraisons tarifées selon le stock.
- **À créer :** état joueur configurable, service sur place/emport, bonus temporaires exclusifs, tarification dynamique par paliers.
- **Risques :** compatibilité des anciennes fiches produit, limites Discord de 25 champs/options, absence actuelle d’expiration générique des bonus.

## Phases

1. Primitives moteur génériques et tests.
2. Contrôles KingdomWeb et aperçu.
3. Données complètes de la Taverne V11.
4. Tests ciblés puis validation Discord manuelle.

## Terminé

- Audit du laboratoire V11 et des mécanismes existants.
- Composant générique `player_status` : bourse, énergie et statistiques configurées depuis KingdomWeb.
- Ajout de cet état indépendant aux écrans Boissons et Repas du template Tempête.

## Restant

- Bonus temporaires exclusifs et affichage du temps restant.
- Modes sur place/emport et transformation d’objet avec supplément.
- Filtres produits/bonus issus des données réelles.
- Priorités de cuisine, recettes verrouillées et actions contextuelles des marmites.
- Livraisons à prix dynamique et confirmation détaillée.
- Ajustement final des dialogues/dés et rafraîchissement visuel.

## Tests effectués

- Rendu et persistance de `player_status` : réussi.
- Validation et rendu des six routes de Taverne avec marmites partagées : réussi.
- Validation syntaxique de `KingdomWeb/static/app.js` : réussie.
- Le seed complet Tempête valide 313 définitions ; durée observée sur Windows : environ 70 secondes.

## Problèmes identifiés

- `player_state` ne porte pas encore de date d’expiration générique ; ne pas simuler les bonus temporaires sans cette primitive.

## Dernier commit

- Jalon courant : `feat: add configurable player status for Edgar V11`.

## Prochaine action exacte

Implémenter un effet générique de bonus temporaire persistant avec remplacement configurable, l’exposer dans l’éditeur d’objets et l’afficher dans `player_status`.
