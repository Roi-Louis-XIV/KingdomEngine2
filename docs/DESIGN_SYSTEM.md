# KingdomWeb Design System

KingdomWeb est un éditeur de monde SaaS. Son interface reste neutre vis-à-vis du contenu : les références médiévales appartiennent aux templates, jamais aux composants.

## Fondations

- Espacements : échelle `--ke-space-1` à `--ke-space-6` (4, 8, 12, 16, 24, 32 px).
- Rayons : `--ke-radius-sm`, `--ke-radius-md`, `--ke-radius-lg`.
- Couleurs : employer les tokens existants `--background`, `--panel`, `--surface`, `--surface-soft`, `--line`, `--text`, `--text-soft`, `--text-muted` et `--brand-green`.
- Typographie : sans-serif pour l’interface ; les polices décoratives ne doivent pas porter l’information fonctionnelle.
- Focus : chaque contrôle interactif reçoit un anneau visible via `--ke-focus`.

## Composants

- Cartes : surface, bordure `--line`, rayon moyen ou large, ombre `--ke-shadow-card`.
- Boutons : une action primaire maximum par panneau ; actions dangereuses explicitement nommées et confirmées.
- Badges : `.product-badge` avec `data-tone="success|warning|danger"`.
- États vides : `.product-empty`, avec explication, conséquence et CTA unique.
- Chargement : `.product-skeleton`, sans reconstruire la navigation active.
- Notifications : `.product-toast-stack` et `.product-toast`.
- Modales : titre, explication courte, contenu scrollable et actions persistantes.
- Options avancées : placées dans un `details`, identifiants et données techniques masqués par défaut.

## Responsive

- Desktop (> 1024 px) : création complète et grands éditeurs.
- Tablette (761–1024 px) : consultation et petites éditions simples ; panneaux latéraux repliés.
- Mobile (≤ 760 px) : supervision, monde live, joueurs, événements, environnement, présences vocales, alertes et profil. Les éditeurs structurels sont masqués, pas simplement désactivés.
- Largeurs vérifiées : 390, 430 et 768 px. Aucun contenu fonctionnel ne doit imposer un défilement horizontal à la page.

## Accessibilité et états

Les actions ont un libellé visible ou un `aria-label`. Les états ne reposent jamais uniquement sur une couleur. `disabled` et `readonly` restent visuellement distincts. Les animations respectent `prefers-reduced-motion`.
