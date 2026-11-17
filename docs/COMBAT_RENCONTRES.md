# Combat — rencontres et « La Traque »

*Décisions de conception prises avec Louis le 18 novembre 2026. Rien n'est codé : c'est la direction à suivre. Copie dans le projet claude.ai « Le royaume ».*

## Ce qui est écarté
- Le combat classique « Attaquer jusqu'à ce que ça meure » (module `combat` actuel, retiré de la bêta le 16 novembre).
- Le monstre joué en secret par un joueur (façon Loup-garou) : **non**.
- Les joutes verbales à la Monkey Island : **non**.

## 1. Les rencontres (loup, brigands…) — retenu
Principe : **ce n'est pas un combat, c'est une rencontre**. Se battre est une option parmi d'autres ; la meilleure dépend de qui on est et de ce qu'on porte.

- **Déclenchement** : petite chance pendant un travail (ex. en forêt), plus forte **la nuit** et quand **le sac est plein** (les brigands sentent le butin). L'écran du joueur se fige sur la scène : **20 secondes pour décider**.
- **Brigands** (« La bourse ou la vie ») — le chef parle à voix haute dans le salon vocal (Voice Worker) :
  - **Payer** : perdre une part des écus ou de la récolte, sans risque.
  - **Bluffer** : les brigands **regardent le profil** ; une belle arme et une armure visibles font réussir le bluff (les armes décoratives prennent un sens).
  - **Appeler à l'aide** : les joueurs du même salon vocal reçoivent « Courir l'aider » ; en infériorité, les brigands fuient.
  - **Fuir** : marche souvent, mais on lâche une partie du sac.
  - **Se battre** : échange court (2 à 3 coups) où l'on **lit l'adversaire** (« il recule son bras… ») et choisit frapper / parer / esquiver.
- **Loup** : lancer de la viande (si on en a), brandir une torche (si on en a), grimper à un arbre (en sécurité mais bloqué quelques minutes), rester immobile (chance qu'il passe), se battre (lire ses bonds).
- **La forêt se souvient** (persistance sur la soirée) :
  - brigands payés → ils reviennent plus souvent (proie facile) ;
  - brigands battus → le chef jure vengeance et revient plus tard avec des renforts ;
  - loup nourri → il peut revenir et défendre le joueur.
- **Liens avec le reste** : gros sac = risque (on revend plus souvent) ; objets utiles (viande, torche, armure visible) ; entraide en vocal ; **perdre n'est jamais mortel** (blessé, volé ou humilié — et une anecdote à raconter à la Taverne).
- **Bases du duel** (si on se bat) : l'ennemi **annonce son intention** ; Frapper / Parer / Esquiver (+ Charger) ; les ennemis forts **feintent** ; peu de hasard, c'est la lecture qui compte ; l'endurance limite les coups ; l'ivresse frappe plus fort mais pare moins bien ; défaite = blessure temporaire (travail moins efficace ~20 min, soin à l'église ou par un bon plat).

## 2. « La Traque » (le grand monstre) — retenu, à approfondir
Rencontre finale qui demande tout le village. Assemble trois idées :
- **Le village se prépare toute la soirée** : mineurs (pièges), forgeron (flèches, porte renforcée), cuisiniers (nourrir les défenseurs), brasseur (courage liquide). L'économie devient l'effort de guerre.
- **Le monstre rôde de salon vocal en salon vocal** (Voice Worker) : on l'**entend arriver** (grognements, pas). Fuir = changer de salon ; se barricader (ex. l'église, si la porte a été renforcée).
- **Le silence comme arme** : quand il entre dans un salon, tout le monde doit se taire ; s'il entend parler, il attaque.

## À vérifier techniquement avant de coder
- Le bot reçoit-il les signaux « quelqu'un parle » malgré le chiffrement vocal DAVE ?
- Déplacements des Voice Workers d'un salon à l'autre (délais, limites).

## Questions encore ouvertes
- Nombre de rencontres par soirée (surprise, pas corvée).
- Ce qu'on perd exactement dans chaque cas.
- Règle du projet : tout cela devient des primitives génériques (module « rencontre », choix conditionnés aux objets et au profil, mémoire par joueur), configurables dans le Studio — aucun loup ni brigand dans le code.
