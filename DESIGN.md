---
version: alpha
name: KingdomWeb Next
description: Atelier de création de mondes Discord, sombre et minéral.
colors:
  background: "#101715"
  surface: "#18211e"
  surface-raised: "#202c27"
  border: "#33463c"
  text: "#edf2ed"
  muted: "#a9b9ae"
  primary: "#a3cbb3"
  primary-ink: "#13261c"
  warning: "#e6c38b"
  danger: "#f2a9a1"
  focus: "#c3e6d0"
typography:
  sans:
    fontFamily: "'Segoe UI', 'Helvetica Neue', sans-serif"
  display:
    fontFamily: "'Palatino Linotype', Palatino, Georgia, serif"
  mono:
    fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace"
rounded:
  DEFAULT: "12px"
  control: "7px"
spacing:
  panel: "24px"
  page: "40px"
components:
  button: {}
  panel: {}
  dialog: {}
---

# KingdomWeb Next

## Overview
Direction validée : « L’équilibre des deux ». Un atelier de cartographe au service de créateurs de mondes : surfaces calmes, accents vert minéral, géométrie de lieux reliés. Registre produit, français, création sur ordinateur et supervision mobile. Aucune hypothèse de marché réglementaire à partir de la langue.

La signature est une empreinte topographique discrète sur la carte du monde actif. Pas de décor médiéval imposé, pas de néon, de chrome ludique ni de métriques inventées. La V2 conserve son propre design pendant la transition.

## Colors
Palette normative en frontmatter, implémentée par les propriétés CSS de même nom dans `KingdomWebNext/src/tokens.css`. Ce fichier documente les décisions ; `tokens.css` est leur unique implémentation runtime, consommée par `styles.css` et les primitives. Pas de thème clair dans cette tranche. États et badges combinent texte et couleur. Les contours utilisent le vert éteint, les erreurs le corail pâle.

## Typography
Sans locale pour le travail quotidien, sérif réservée au nom du monde et à l’aperçu de lieu, chasse fixe pour les repères de création. Aucun téléchargement de police requis. Chiffres tabulaires pour les indicateurs, corps 15px/1.6 ; éviter les titres promotionnels dans les formulaires.

## Layout
Navigation latérale 238px, barre de monde globale, contenu limité à 1540px. Rythme de panneaux 22–24px, boutons 42px minimum. Cartes à trois colonnes, deux sur petit ordinateur, une sur téléphone. Sous 850px, navigation dans un panneau plein écran ; les formulaires conservent le défilement du document. La bibliothèque pagine localement par 12, car l’API V2 retourne le catalogue complet.

## Elevation & Depth
Différenciation par surfaces et contours. Ombres réservées aux dialogues et à la barre d’enregistrement persistante. Aucune image décorative distante ni déplacement de géométrie durant les chargements.

## Shapes
Panneaux 12px et contrôles 7px. Emblème de lieu asymétrique, rappel d’une fiche d’atelier. Séparateurs fins ; pas de multiplication de pilules.

## Components
Primitives partagées dans `src/components/ui.tsx`. Boutons : neutre, primaire minéral ; hover, focus visible 2px, actif et désactivé. Champs étiquetés, erreurs associées, formulaires sans bulles natives. Select natif assumé : géométrie du popup gérée par le système. Dialogues HTML ouverts par `showModal`, focus initial sur l’annulation, Escape et restitution du focus. Icônes Lucide, trait simple, libellés obligatoires pour les opérations.

Chargement avec indicateur stable, erreurs persistantes et réessai. Mouvement d’entrée 240ms, retour de contrôle 160ms ; `prefers-reduced-motion` désactive les animations. Scrollbars globales visibles, tokenisées, compatibles forced-colors.

## Do's and Don'ts
- Montrer la différence entre brouillon, révision active et synchronisation Discord.
- Garder un monde sélectionné sur toute la navigation.
- Ne pas présenter l’aperçu Studio comme un moteur de rendu Discord.
- Ne pas offrir de fausses actions pour les fonctionnalités des tranches suivantes.
