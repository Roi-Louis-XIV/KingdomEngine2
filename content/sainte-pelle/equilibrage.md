# Équilibrage des métiers — La Nuit de la Sainte Pelle

*Fichier généré par `scripts/content/sainte-pelle.mjs` : ne pas modifier à la main.*

Difficulté = endurance × niveau requis (+35 % par niveau) × outil ou matière (+15 %) × durée (+10 % par minute au-delà de la première).
Chaque tâche rapporte en moyenne **1 écu et 1 XP par point de difficulté** (matière consommée déduite). Cuisine et brasserie : 2 XP par point et une paie.

## Temps pour atteindre le niveau 5

Objectif 60 min pour un joueur assidu, deux travaux à la fois au maximum. L’XP par niveau est calculée puis corrigée par la simulation de la soirée entière (7 joueurs virtuels à 60 % d’efficacité, `SIM_FACTOR` dans le générateur).

| Métier | XP par niveau |
|---|---|
| Cuisinier | 145 × niveau |
| Bûcheron | 115 × niveau |
| Mineur | 130 × niveau |
| Forgeron | 35 × niveau |
| Fermier | 115 × niveau |
| Pêcheur | 80 × niveau |
| Brasseur | 45 × niveau |

## Gains par tâche

| Métier | Lieu | Tâche | Niveau | Endurance | Outil ou matière | Difficulté | XP | Écus avant | Écus après |
|---|---|---|---|---|---|---|---|---|---|
| Brasseur | Brasserie | Cervoise médiévale | 1 | — | 2 Orge + 2 Seau d’eau | 4,4 | 9 | 0 | 4 (paie) |
| Brasseur | Brasserie | La 8.6 Original | 1 | — | 3 Orge + 1 Houblon + 2 Seau d’eau | 6,9 | 14 | 0 | 7 (paie) |
| Brasseur | Brasserie | Pelican | 1 | — | 2 Orge + 1 Houblon + 2 Seau d’eau | 5,8 | 12 | 0 | 6 (paie) |
| Brasseur | Brasserie | Blanche de Bruges | 1 | — | 2 Gerbe de blé + 1 Houblon + 2 Seau d’eau | 5,8 | 12 | 0 | 6 (paie) |
| Brasseur | Brasserie | Hydromel traditionnel | 2 | — | 3 Miel sauvage + 2 Seau d’eau | 8,1 | 16 | 0 | 8 (paie) |
| Brasseur | Brasserie | Grimbergen Blonde | 2 | — | 3 Orge + 1 Houblon + 1 Miel sauvage + 2 Seau d’eau | 11,3 | 23 | 0 | 11 (paie) |
| Brasseur | Brasserie | Grimbergen Ambrée | 2 | — | 3 Orge + 1 Houblon + 1 Épices + 2 Seau d’eau | 11,3 | 23 | 0 | 11 (paie) |
| Brasseur | Brasserie | Guinness Stout | 2 | — | 4 Orge + 1 Houblon + 2 Seau d’eau | 11,3 | 23 | 0 | 11 (paie) |
| Brasseur | Brasserie | Mort Subite Kriek | 2 | — | 2 Orge + 3 Cerises + 2 Seau d’eau | 11,3 | 23 | 0 | 11 (paie) |
| Brasseur | Brasserie | Vin épicé chaud | 2 | — | 2 Vin rouge de Bordeaux + 1 Miel sauvage + 1 Épices | 5,9 | 12 | 0 | 6 (paie) |
| Brasseur | Brasserie | La Chouffe | 3 | — | 3 Orge + 2 Houblon + 1 Épices + 2 Seau d’eau | 17 | 34 | 0 | 17 (paie) |
| Brasseur | Brasserie | Tripel Karmeliet | 3 | — | 3 Orge + 1 Gerbe de blé + 2 Houblon + 2 Seau d’eau | 17 | 34 | 0 | 17 (paie) |
| Brasseur | Brasserie | Duvel | 3 | — | 4 Orge + 2 Houblon + 2 Seau d’eau | 17 | 34 | 0 | 17 (paie) |
| Brasseur | Brasserie | Hydromel aux baies sauvages | 3 | — | 3 Miel sauvage + 2 Baies sauvages + 2 Seau d’eau | 14,9 | 30 | 0 | 15 (paie) |
| Brasseur | Brasserie | Vin rouge de Bordeaux | 3 | — | 4 Raisin | 8,8 | 18 | 0 | 9 (paie) |
| Brasseur | Brasserie | Vin blanc de Loire | 3 | — | 4 Raisin | 8,8 | 18 | 0 | 9 (paie) |
| Brasseur | Brasserie | Porto vieilli | 4 | — | 4 Raisin + 1 Miel sauvage | 14,4 | 29 | 0 | 14 (paie) |
| Brasseur | Brasserie | Whisky des Highlands | 4 | — | 5 Orge + 2 Seau d’eau | 20,1 | 40 | 0 | 20 (paie) |
| Brasseur | Brasserie | Absinthe de la Fée Verte | 5 | — | 2 Grande armoise + 2 Herbes aromatiques + 1 Seau d’eau | 16,8 | 34 | 0 | 17 (paie) |
| Bûcheron | La lisière | Abattre un jeune arbre | 1 | 5 | Hache de bûcheron | 5,8 | 6 | 4,4 | 6,4 |
| Bûcheron | La lisière | Ramasser du bois mort | 1 | 2 | — | 2 | 2 | 2 | 2 |
| Bûcheron | La lisière | Cueillir des champignons | 1 | 3 → 4 | — | 4 | 4 | 4,2 | 4,2 |
| Bûcheron | La lisière | Cueillir baies et herbes | 1 | 3 | — | 3 | 3 | 6 | 6 |
| Bûcheron | La futaie de chênes | Abattre un chêne | 2 | 6 | Hache de bûcheron | 9,5 | 10 | 8,8 | 8,8 |
| Bûcheron | La futaie de chênes | Récolter du miel sauvage | 2 | 5 | — | 6,8 | 7 | 7,6 | 7,6 |
| Bûcheron | La futaie de chênes | Débiter le chablis | 2 | 5 → 8 | Hache de bûcheron | 12,4 | 12 | 12 | 12 |
| Bûcheron | Le bois sombre | Chasser à l’arc | 3 | 9 | Arc court du Chasseur | 19,4 | 19 | 12,5 | 20,3 |
| Bûcheron | Le bois sombre | Chasser à l’arbalète | 3 | 9 | Arbalète de guerre | 19,4 | 19 | 21,3 | 21,3 |
| Bûcheron | Le bois sombre | Cueillir l’armoise | 3 | 4 | — | 6,8 | 7 | 10,8 | 10,8 |
| Cuisinier | Cuisine | Soupe paysanne | 1 | — | 3 Légumes + 1 Seau d’eau | 4 | 8 | 0 | 4 (paie) |
| Cuisinier | Cuisine | Soupe d’oignon à la bière | 1 | — | 3 Oignons + 1 Cervoise médiévale + 1 Seau d’eau | 5,3 | 11 | 0 | 5 (paie) |
| Cuisinier | Cuisine | Fromage de moines et pain noir | 1 | — | 2 Fromage + 1 Farine | 3 | 6 | 0 | 3 (paie) |
| Cuisinier | Cuisine | Ragoût de sanglier | 2 | — | 2 Viande + 2 Légumes | 5,7 | 11 | 0 | 6 (paie) |
| Cuisinier | Cuisine | Pain rustique | 2 | — | 3 Farine + 1 Seau d’eau | 5,5 | 11 | 0 | 6 (paie) |
| Cuisinier | Cuisine | Pâté de sanglier aux herbes | 2 | — | 2 Viande + 1 Herbes aromatiques + 1 Légumes | 5,9 | 12 | 0 | 6 (paie) |
| Cuisinier | Cuisine | Saucisses fumées & moutarde | 2 | — | 2 Viande + 1 Épices | 4,5 | 9 | 0 | 4 (paie) |
| Cuisinier | Cuisine | Festin du Royaume | 3 | — | 4 Viande + 3 Légumes + 2 Épices | 16,8 | 34 | 0 | 17 (paie) |
| Cuisinier | Cuisine | Cuisses de poulet au miel | 3 | — | 2 Volaille + 1 Miel sauvage + 1 Épices | 7,8 | 16 | 0 | 8 (paie) |
| Cuisinier | Cuisine | Assiette du Bourreau | 4 | — | 1 Viande + 2 Fromage + 1 Farine + 1 Herbes aromatiques | 12,3 | 25 | 0 | 12 (paie) |
| Cuisinier | Cuisine | Banquet royal | 5 | — | 6 Viande + 3 Épices | 25,9 | 52 | 0 | 26 (paie) |
| Fermier | Les champs | Moissonner | 1 | 5 | — | 5 | 5 | 2 | 5 |
| Fermier | Les champs | Moissonner l’orge | 1 | 5 | — | 5 | 5 | 6,4 | 6,4 |
| Fermier | Les champs | Moudre du grain | 1 | 2 | 2 Gerbe de blé | 2,3 | 2 | 7 | 7 |
| Fermier | La basse-cour et le verger | Ramasser les œufs | 1 | 3 | — | 3 | 3 | 3 | 3 |
| Fermier | La basse-cour et le verger | Attraper une volaille | 1 | 4 | — | 4 | 4 | 3,5 | 3,5 |
| Fermier | La basse-cour et le verger | Cueillir des légumes | 1 | 4 | — | 4 | 4 | 9,6 | 9,6 |
| Fermier | Les champs | Cueillir le houblon | 2 | 5 | — | 6,9 | 7 | 6 | 6 |
| Fermier | La basse-cour et le verger | Traire et faire le fromage | 2 | 5 | — | 7,1 | 7 | 8 | 8 |
| Fermier | La basse-cour et le verger | Cueillir des cerises | 2 | 4 | — | 5,4 | 5 | 9 | 9 |
| Fermier | La basse-cour et le verger | Presser des pommes | 2 | 5 | — | 7,1 | 7 | 8 | 8 |
| Fermier | Les champs | Vendanger | 3 | 6 | — | 10,7 | 11 | 13,2 | 13,2 |
| Forgeron | La fonderie | Fondre du bronze | 1 | 5 | 1 Minerai de cuivre + 1 Minerai d’étain | 5,8 | 6 | 1 | 10 |
| Forgeron | La fonderie | Fondre un lingot de fer | 1 | 5 | 2 Minerai de fer | 5,8 | 6 | 2 | 10 |
| Forgeron | Les outils | Pioche de bronze | 1 | 5 | 2 Lingot de bronze + 1 Bûche | 5,8 | 6 | — | — |
| Forgeron | Les outils | Canne renforcée | 1 | 5 | 1 Lingot de fer + 1 Bûche | 5,8 | 6 | — | — |
| Forgeron | Les armes du champ de bataille | Épée courte du Novice | 1 | 5 | 4 Lingot de bronze | 5,8 | 6 | — | — |
| Forgeron | Arcs, arbalètes et projectiles | Arc court du Chasseur | 1 | 5 | 5 Lingot de bronze | 5,8 | 6 | — | — |
| Forgeron | Arcs, arbalètes et projectiles | Flèches en fer (×20) | 1 | 5 | 2 Lingot de fer | 5,8 | 6 | — | — |
| Forgeron | Les armures qui sauvent la vie | Cuirasse de cuir renforcé | 1 | 5 | 5 Lingot de bronze | 5,8 | 6 | — | — |
| Forgeron | Accessoires et services | Bouclier rond en bois et fer | 1 | 5 | 3 Lingot de fer + 1 Bûche | 5,8 | 6 | — | — |
| Forgeron | Accessoires et services | Carquois en cuir | 1 | 5 | 2 Lingot de bronze | 5,8 | 6 | — | — |
| Forgeron | Accessoires et services | Aiguisage ultime | 1 | 5 | 1 Lingot de fer | 5,8 | 6 | — | — |
| Forgeron | La fonderie | Fondre un lingot d’argent | 2 | 6 | 2 Minerai d’argent | 9,5 | 10 | -1 | 18 |
| Forgeron | Les outils | Hache de fer | 2 | 6 | 3 Lingot de fer + 1 Bûche | 9,5 | 10 | — | — |
| Forgeron | Les outils | Pioche de fer | 2 | 6 | 3 Lingot de fer + 1 Bûche | 9,5 | 10 | — | — |
| Forgeron | Les armes du champ de bataille | Épée longue du Chevalier | 2 | 6 | 6 Lingot de fer | 9,5 | 10 | — | — |
| Forgeron | Arcs, arbalètes et projectiles | Flèches à tête large (×12) | 2 | 6 | 3 Lingot de fer | 9,5 | 10 | — | — |
| Forgeron | Arcs, arbalètes et projectiles | Carreaux d’arbalète (×15) | 2 | 6 | 3 Lingot de fer | 9,5 | 10 | — | — |
| Forgeron | Les armures qui sauvent la vie | Heaume à visage fermé | 2 | 6 | 4 Lingot de fer | 9,5 | 10 | — | — |
| Forgeron | Les armures qui sauvent la vie | Cotte de mailles du Soldat | 2 | 6 | 8 Lingot de fer | 9,5 | 10 | — | — |
| Forgeron | Accessoires et services | Gantelets de combat | 2 | 6 | 3 Lingot de fer | 9,5 | 10 | — | — |
| Forgeron | Accessoires et services | Éperons de chevalier | 2 | 6 | 1 Lingot d’argent | 9,5 | 10 | — | — |
| Forgeron | Accessoires et services | Gravure personnalisée | 2 | 6 | 1 Lingot d’argent | 9,5 | 10 | — | — |
| Forgeron | La fonderie | Fondre un lingot d’or | 3 | 7 | 2 Pépite d’or | 14,4 | 14 | 0 | 30 |
| Forgeron | La fonderie | Forger une ferrure | 3 | 7 | 2 Lingot de fer | 14,4 | 14 | -12 | 6 |
| Forgeron | Les outils | Canne à moulinet d’argent | 3 | 7 | 2 Lingot d’argent + 1 Bûche | 14,4 | 14 | — | — |
| Forgeron | Les armes du champ de bataille | Hache de guerre des Montagnes | 3 | 7 | 5 Lingot de fer + 2 Lingot d’argent | 14,4 | 14 | — | — |
| Forgeron | Les armes du champ de bataille | Marteau de guerre du Colosse | 3 | 7 | 7 Lingot de fer | 14,4 | 14 | — | — |
| Forgeron | Les armes du champ de bataille | Dague d’assassin | 3 | 7 | 4 Lingot d’argent | 14,4 | 14 | — | — |
| Forgeron | Arcs, arbalètes et projectiles | Arc long des Elfes | 3 | 7 | 6 Lingot de fer + 2 Lingot d’argent | 14,4 | 14 | — | — |
| Forgeron | Arcs, arbalètes et projectiles | Arbalète de guerre | 3 | 7 | 8 Lingot de fer | 14,4 | 14 | — | — |
| Forgeron | Arcs, arbalètes et projectiles | Carreaux perforants (×10) | 3 | 7 | 2 Lingot d’argent | 14,4 | 14 | — | — |
| Forgeron | Accessoires et services | Bouclier héraldique gravé | 3 | 7 | 2 Lingot d’argent | 14,4 | 14 | — | — |
| Forgeron | Accessoires et services | Enchantement mineur | 3 | 7 | 1 Lingot d’or | 14,4 | 14 | — | — |
| Forgeron | Les outils | Pioche de maître | 4 | 8 | 3 Lingot de fer + 1 Lingot d’or | 20,3 | 20 | — | — |
| Forgeron | Arcs, arbalètes et projectiles | Arbalète de précision | 4 | 8 | 4 Lingot d’argent + 1 Lingot d’or | 20,3 | 20 | — | — |
| Forgeron | Les armures qui sauvent la vie | Armure de plates du Chevalier | 4 | 8 | 10 Lingot de fer + 3 Lingot d’argent | 22,6 | 23 | — | — |
| Forgeron | Les armes du champ de bataille | Lame du Dragon | 5 | 9 | 3 Lingot d’or + 1 Diamant brut | 32,3 | 32 | — | — |
| Forgeron | Les armures qui sauvent la vie | Armure royale du Roi-Dragon | 5 | 9 | 5 Lingot d’or + 2 Diamant brut | 34,8 | 35 | — | — |
| Mineur | Le carreau | Tailler la roche | 1 | 6 | Pioche usée | 7,1 | 7 | 8,5 | 8,5 |
| Mineur | Le carreau | Fouiller les déblais | 1 | 2 | — | 2 | 2 | 2,4 | 2,4 |
| Mineur | La galerie du cuivre | Piocher le filon de cuivre | 1 | 7 | Pioche usée | 8,5 | 8 | 6,3 | 8,4 |
| Mineur | La galerie du cuivre | Gratter l’étain | 1 | 7 | Pioche usée | 8,5 | 8 | 6,3 | 8,4 |
| Mineur | La galerie du fer | Extraire du fer | 2 | 8 | Pioche usée | 13,2 | 13 | 9 | 12,8 |
| Mineur | La galerie profonde | Creuser la galerie profonde | 3 | 10 | Pioche usée | 21,5 | 22 | 13,3 | 19,6 |
| Mineur | Le gouffre | Descendre dans le gouffre | 4 | 12 | Pioche de fer | 32,5 | 33 | 14,6 | 20,2 |
| Pêcheur | La berge | Pêcher à la canne | 1 | 3 → 5 | Canne à pêche | 5,8 | 6 | 5,3 | 5,3 |
| Pêcheur | La berge | Pêcher au filet | 2 | 6 → 9 | Canne à pêche | 15,4 | 15 | 15 | 15 |
| Pêcheur | Sous l’arche | Pêcher sous l’arche | 2 | 5 | Canne à pêche | 8,2 | 8 | 7,6 | 7,6 |
| Pêcheur | Les eaux profondes | Pêcher en eaux profondes | 3 | 7 | Canne renforcée | 15,1 | 15 | 11,1 | 13,6 |
