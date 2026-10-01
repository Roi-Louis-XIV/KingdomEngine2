# Le Royaume — content pack de compatibilité

Le Royaume est un contenu de démonstration, pas une règle du moteur. Cette structure marque la frontière entre l’engine générique et les données historiques.

Durant la transition, `seed.py` et `import_v1.py` restent les sources utilisées afin de préserver les bases existantes. Les libellés, bâtiments, métiers, objets, sons et événements propres au Royaume devront progressivement être exportés ici en définitions versionnées.

Points encore reliés au pont de compatibilité :

- définitions initiales de `seed.py` ;
- import idempotent des bâtiments et sons V1 ;
- quelques exemples et textes de tutoriel ;
- catalogue d’objets historique.

Un monde vierge ne doit à terme charger aucun de ces contenus sans choix explicite du créateur.
