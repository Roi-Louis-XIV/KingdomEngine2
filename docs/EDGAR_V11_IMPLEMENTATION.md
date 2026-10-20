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

- Six parcours Taverne V11 mono-message : accueil, boissons, repas, Edgar, cuisine et stocks/livraisons.
- État joueur configurable : bourse, énergie, alcoolémie et bonus temporaire avec compte à rebours.
- Service réel sur place ou à emporter, supplément configurable et effets de consommation persistants.
- Bonus temporaires exclusifs persistants, remplaçables/refusables et utilisables par les modificateurs génériques.
- Produits filtrables par objet et type de bonus depuis KingdomWeb.
- Marmites partagées : états détaillés, auteur, recette, production, temps restant, récupération unique et reprise après redémarrage.
- Recettes filtrées par métier, niveau, ingrédients et disponibilité d’un poste ; catalogue verrouillé explicatif.
- Priorités de production calculées depuis les stocks, objectifs et productions en cours.
- Rafraîchissement Discord mutualisé toutes les cinq secondes pour les écrans de production actifs.
- Démission configurable pendant une production partagée, sans perte d’XP ni réactivation implicite du métier.
- Livraisons à prix dynamique par paliers, confirmation du prix exact et évolution du stock.
- Dialogue contextuel d’Edgar, quête réelle, rumeurs temporelles et dés amicaux sans mise.
- Contrôles no-code correspondants intégrés aux éditeurs existants de KingdomWeb.

## Restant

- Validation visuelle manuelle sur un véritable serveur Discord (non automatisable dans l’environnement local).

## Tests effectués

- Syntaxe Python et JavaScript : réussie.
- Hospitalité et postes partagés : 13 tests réussis.
- Parcours complet Tempête/Taverne, quêtes, timeline, pêche, audio et persistance : 34 tests réussis.
- Le seed complet Tempête reste volontairement testé sur de vraies bases ; durée de la suite complète sous Windows : environ 41 minutes.

## Problèmes identifiés

- Aucun blocage fonctionnel automatisé restant sur le périmètre V11.

## Dernier commit

- Jalon précédent : `feat: add configurable player status for Edgar V11`.
- Jalon final : intégration V11 complète à committer.

## Prochaine action exacte

Ouvrir la Taverne Tempête sur le serveur bêta et effectuer une validation visuelle finale avec deux joueurs et plusieurs marmites simultanées.
