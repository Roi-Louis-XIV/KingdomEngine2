/* Parcours pédagogiques. Les cibles utilisent uniquement des attributs ou ID stables. */
window.KingdomTutorialContent = {
  tutorials: [
    {
      id: "first_realm",
      icon: "👑",
      module: "dashboard",
      title: "Créer mon premier royaume",
      description:
        "Le parcours complet : bâtiment, métier, action, Discord, audio, météo et Event.",
      steps: [
        {
          id: "welcome",
          page: "dashboard",
          target: "[data-type='dashboard']",
          title: "Votre centre de commandement",
          content:
            "Ce parcours agit dans les vrais écrans. Vos créations sont réelles et la progression est enregistrée.",
        },
        {
          id: "building",
          page: "building",
          target: "#new",
          title: "Commencez par un bâtiment",
          content:
            "Cliquez sur Nouvelle définition. Le bâtiment contiendra votre première expérience jouable.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#new" },
        },
        {
          id: "preset",
          page: "building",
          target: "[data-preset]",
          title: "Choisissez un modèle",
          content:
            "Cliquez sur le type le plus proche de votre idée. Tout restera modifiable.",
          interaction: "target",
          completion: { event: "dom_click", selector: "[data-preset]" },
        },
        {
          id: "identity",
          page: "building",
          target: "#name",
          title: "Donnez-lui une identité",
          content:
            "Renseignez le nom, l’emoji et la description, puis continuez avec la bulle.",
          interaction: "free",
        },
        {
          id: "mechanics",
          page: "building",
          target: "[data-tutorial='building-tab-mechanics']",
          title: "Ouvrez Fonctionnement",
          content:
            "C’est ici que vivent métiers, zones, actions, recettes et livraisons.",
          interaction: "target",
          completion: { event: "building_tab_changed", value: "mechanics" },
        },
        {
          id: "profession",
          page: "building",
          target: "#add-simple-mechanic",
          title: "Ajoutez un métier",
          content:
            "Restez en mode Simple : ce bouton ouvre une fiche claire pour le nom et l’outil du métier.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#add-simple-mechanic" },
        },
        {
          id: "profession_identity",
          page: "building",
          target: "#simple-profession-dialog [name='name']",
          title: "Définissez le métier",
          content:
            "Nommez le métier, choisissez son outil principal et décidez si cet outil est offert au joueur.",
          interaction: "free",
        },
        {
          id: "profession_apply",
          page: "building",
          target: "#simple-profession-dialog [value='save']",
          title: "Créez le métier",
          content:
            "Appliquez la fiche. Le métier apparaît immédiatement dans le mode Simple.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "#simple-profession-dialog [value='save']",
          },
        },
        {
          id: "zone",
          page: "building",
          target: "[data-add-simple-zone]",
          title: "Ajoutez sa première zone",
          content:
            "Chaque métier peut posséder plusieurs zones avec ses propres niveaux, durées, outils et récompenses.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "[data-add-simple-zone]",
          },
        },
        {
          id: "zone_config",
          page: "building",
          target: "#simple-zone-dialog",
          title: "Configurez l’activité",
          content:
            "Renseignez le nom, la durée, l’énergie, le niveau requis et les résultats possibles, sans quitter le mode Simple.",
          interaction: "free",
        },
        {
          id: "zone_apply",
          page: "building",
          target: "#simple-zone-dialog [value='save']",
          title: "Appliquez la zone",
          content:
            "Validez pour revenir au fonctionnement du bâtiment et voir la zone sous son métier.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "#simple-zone-dialog [value='save']",
          },
        },
        {
          id: "action",
          page: "building",
          target: "#add-simple-action",
          title: "Ajoutez une action",
          content:
            "Restez en mode Simple : créez ici un bouton de gameplay complémentaire et ses premiers résultats.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#add-simple-action" },
        },
        {
          id: "action_config",
          page: "building",
          target: "#simple-action-dialog [name='name']",
          title: "Nommez l’action",
          content:
            "Utilisez un verbe clair pour annoncer immédiatement ce que fera le bouton.",
          interaction: "free",
        },
        {
          id: "action_apply",
          page: "building",
          target: "#simple-action-dialog [value='save']",
          title: "Appliquez l’action",
          content:
            "Validez l’action avant de passer à la construction de l’interface Discord.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "#simple-action-dialog [value='save']",
          },
        },
        {
          id: "discord",
          page: "building",
          target: "[data-tutorial='building-tab-discord']",
          title: "Construisez Discord",
          content: "Organisez les pages, textes, boutons et menus du bâtiment.",
          interaction: "target",
          completion: { event: "building_tab_changed", value: "visual" },
        },
        {
          id: "audio",
          page: "building",
          target: "[data-tutorial='building-tab-audio']",
          title: "Ajoutez une identité sonore",
          content:
            "Choisissez l’ambiance et les sons déclenchés par le gameplay.",
          interaction: "target",
          completion: { event: "building_tab_changed", value: "sound" },
        },
        {
          id: "save",
          page: "building",
          target: "#save",
          title: "Enregistrez le brouillon",
          content:
            "Cliquez lorsque la fiche est prête. Rien n’est publié automatiquement.",
          interaction: "target",
          completion: { event: "content_saved", value: "building" },
        },
        {
          id: "weather",
          page: "environment",
          target: "#new",
          title: "Configurez le climat",
          content:
            "La météo donne un contexte vivant au royaume. Créez ou ouvrez sa configuration.",
        },
        {
          id: "events",
          page: "event",
          target: "#new",
          title: "Faites vivre le royaume",
          content:
            "Les Events déclenchent des résultats, modifient les règles et pilotent les ambiances.",
        },
        {
          id: "finish",
          page: "academy",
          target: ".academy-progress",
          title: "Revenez quand vous voulez",
          content:
            "L’Académie conserve l’avancement et permet de reprendre ou rejouer chaque parcours.",
        },
      ],
    },
    {
      id: "building",
      icon: "🏰",
      module: "building",
      title: "Créer un bâtiment",
      description: "Assistant, identité, relations et premier brouillon.",
      steps: [
        {
          id: "new",
          page: "building",
          target: "#new",
          title: "Créer une fiche",
          content: "Cliquez sur Nouvelle définition.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#new" },
        },
        {
          id: "preset",
          page: "building",
          target: "[data-preset]",
          title: "Choisir un preset",
          content:
            "Récolte, production, commerce, social ou administration : tout restera modifiable.",
          interaction: "target",
          completion: { event: "dom_click", selector: "[data-preset]" },
        },
        {
          id: "name",
          page: "building",
          target: "#name",
          title: "Nom visible",
          content:
            "Ce nom sera affiché dans Discord et utilisé pour les salons.",
          interaction: "free",
        },
        {
          id: "description",
          page: "building",
          target: "#description",
          title: "Promesse au joueur",
          content: "Décrivez en une phrase ce que le joueur pourra faire ici.",
          interaction: "free",
        },
        {
          id: "overview",
          page: "building",
          target: "[data-building-panel='overview']",
          title: "Aperçu de la fiche",
          content: "Il résume métier, bot, ambiance, actions et pages Discord.",
        },
        {
          id: "relations",
          page: "building",
          target: "[data-tutorial='building-tab-relations']",
          title: "Relier le bâtiment",
          content:
            "Associez lieu, objets, métier principal et bot sans manipuler d’identifiants.",
          interaction: "target",
          completion: { event: "building_tab_changed", value: "relations" },
        },
        {
          id: "save",
          page: "building",
          target: "#save",
          title: "Conserver le travail",
          content:
            "Enregistrer crée un brouillon versionné. Vous publierez quand vous serez prêt.",
          interaction: "target",
          completion: { event: "content_saved", value: "building" },
        },
      ],
    },
    {
      id: "actions",
      icon: "⚡",
      module: "building",
      title: "Créer une action",
      description: "Bouton → conditions → effets → interface Discord.",
      steps: [
        {
          id: "open",
          page: "building",
          target: "[data-tutorial='building-open']",
          title: "Ouvrez un bâtiment",
          content: "Cliquez sur Modifier.",
          interaction: "target",
          completion: { event: "building_editor_opened" },
        },
        {
          id: "mechanics",
          page: "building",
          target: "[data-tutorial='building-tab-mechanics']",
          title: "Ouvrez Fonctionnement",
          content:
            "Les actions complémentaires sont sous les métiers et zones.",
          interaction: "target",
          completion: { event: "building_tab_changed", value: "mechanics" },
        },
        {
          id: "add",
          page: "building",
          target: "#add-simple-action",
          title: "Ajouter une action",
          content:
            "Cliquez ici : la fiche simple s’ouvre sans afficher les paramètres techniques.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#add-simple-action" },
        },
        {
          id: "name",
          page: "building",
          target: "#simple-action-dialog [name='name']",
          title: "Nommer le bouton",
          content:
            "Utilisez un verbe explicite : Récolter, Acheter, Fouiller ou Parler.",
          interaction: "free",
        },
        {
          id: "effects",
          page: "building",
          target: "#simple-action-dialog .simple-results",
          title: "Comprendre les résultats",
          content:
            "Cette synthèse montre les conséquences de l’action. Le bouton avancé reste disponible uniquement lorsque vous avez besoin de conditions ou de plusieurs effets.",
          interaction: "free",
        },
        {
          id: "apply",
          page: "building",
          target: "#simple-action-dialog [value='save']",
          title: "Appliquer l’action",
          content:
            "Validez pour ajouter cette action au brouillon du bâtiment.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "#simple-action-dialog [value='save']",
          },
        },
        {
          id: "discord",
          page: "building",
          target: "[data-tutorial='building-tab-discord']",
          title: "Rendre l’action accessible",
          content:
            "Ajoutez un bouton ou menu Discord puis sélectionnez l’action par son nom.",
          interaction: "target",
          completion: { event: "building_tab_changed", value: "visual" },
        },
        {
          id: "save",
          page: "building",
          target: "#save",
          title: "Enregistrer",
          content: "Sauvegardez le bâtiment et son interface.",
          interaction: "target",
          completion: { event: "content_saved", value: "building" },
        },
      ],
    },
    {
      id: "professions",
      icon: "⚒️",
      module: "profession",
      title: "Créer un métier et ses zones",
      description:
        "Un parcours entièrement guidé dans le mode Simple du bâtiment.",
      steps: [
        {
          id: "building",
          page: "building",
          target: "[data-tutorial='building-open']",
          title: "Ouvrez un bâtiment",
          content:
            "Choisissez le bâtiment dans lequel les joueurs exerceront ce métier.",
          interaction: "target",
          completion: { event: "building_editor_opened" },
        },
        {
          id: "mechanics",
          page: "building",
          target: "[data-tutorial='building-tab-mechanics']",
          title: "Ouvrez Fonctionnement",
          content: "Vous allez relier le métier à ses zones.",
          interaction: "target",
          completion: { event: "building_tab_changed", value: "mechanics" },
        },
        {
          id: "add_profession",
          page: "building",
          target: "#add-simple-mechanic",
          title: "Ajouter le métier",
          content:
            "Ce bouton reste en mode Simple et ouvre directement la fiche du nouveau métier.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#add-simple-mechanic" },
        },
        {
          id: "profession_name",
          page: "building",
          target: "#simple-profession-dialog [name='name']",
          title: "Nom visible",
          content:
            "Donnez un nom compréhensible par les joueurs, par exemple Bûcheron ou Chasseur.",
          interaction: "free",
        },
        {
          id: "profession_tool",
          page: "building",
          target: "#simple-profession-dialog [name='tool']",
          title: "Outil principal",
          content:
            "Choisissez un objet existant. Vous pouvez aussi décider de le remettre automatiquement.",
          interaction: "free",
        },
        {
          id: "profession_save",
          page: "building",
          target: "#simple-profession-dialog [value='save']",
          title: "Appliquer le métier",
          content:
            "Le métier est ajouté au brouillon du bâtiment ; il n’est pas encore publié.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "#simple-profession-dialog [value='save']",
          },
        },
        {
          id: "add_activity",
          page: "building",
          target: "[data-add-simple-zone]",
          title: "Créer une zone",
          content:
            "Ajoutez maintenant une activité directement depuis la carte du métier.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "[data-add-simple-zone]",
          },
        },
        {
          id: "zone_identity",
          page: "building",
          target: "#simple-zone-dialog [name='name']",
          title: "Décrire la zone",
          content:
            "Réglez son nom, sa durée, son coût énergétique, son niveau et l’usure de l’outil.",
          interaction: "free",
        },
        {
          id: "results",
          page: "building",
          target: "#simple-zone-dialog .simple-results",
          title: "Récompenses et XP",
          content:
            "Ajoutez les résultats possibles. Chacun peut ensuite combiner ressource, XP métier, message, son et Event.",
          interaction: "free",
        },
        {
          id: "zone_save",
          page: "building",
          target: "#simple-zone-dialog [value='save']",
          title: "Appliquer la zone",
          content:
            "Validez la zone pour revenir à la vue Simple et voir le métier avec son activité.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "#simple-zone-dialog [value='save']",
          },
        },
        {
          id: "save",
          page: "building",
          target: "#save",
          title: "Enregistrer",
          content:
            "Le moteur générera les actions nécessaires sans logique liée au nom du métier.",
          interaction: "target",
          completion: { event: "content_saved", value: "building" },
        },
      ],
    },
    {
      id: "discord_interface",
      icon: "🧩",
      module: "building",
      title: "Construire l’interface Discord",
      description: "Pages, textes, boutons, menus et navigation.",
      steps: [
        {
          id: "open",
          page: "building",
          target: "[data-tutorial='building-open']",
          title: "Ouvrez le bâtiment",
          content: "Choisissez celui dont les joueurs verront l’interface.",
          interaction: "target",
          completion: { event: "building_editor_opened" },
        },
        {
          id: "tab",
          page: "building",
          target: "[data-tutorial='building-tab-discord']",
          title: "Ouvrez Discord",
          content: "Le mode simple montre d’abord les pages essentielles.",
          interaction: "target",
          completion: { event: "building_tab_changed", value: "visual" },
        },
        {
          id: "pages",
          page: "building",
          target: ".simple-discord-pages",
          title: "Parcours entre pages",
          content:
            "La page d’accueil est l’entrée. Les boutons et menus créent les liaisons.",
        },
        {
          id: "add_page",
          page: "building",
          target: "[data-add-simple-page]",
          title: "Ajouter une page",
          content: "Créez une nouvelle étape du parcours joueur.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "[data-add-simple-page]",
          },
        },
        {
          id: "page_name",
          page: "building",
          target: "#simple-page-dialog [name='name']",
          title: "Nommer la page",
          content:
            "Utilisez un titre clair : Boutique, Expédition ou Inventaire.",
          interaction: "free",
        },
        {
          id: "builder",
          page: "building",
          target: "#simple-page-dialog [data-page-full-builder]",
          title: "Builder complet",
          content:
            "Il permet de placer embeds, boutons, menus, inventaires et liaisons.",
          interaction: "free",
        },
        {
          id: "save",
          page: "building",
          target: "#save",
          title: "Enregistrer",
          content: "Les pages sont conservées et publiées avec le bâtiment.",
          interaction: "target",
          completion: { event: "content_saved", value: "building" },
        },
      ],
    },
    {
      id: "audio",
      icon: "🔊",
      module: "audio",
      title: "Sons, ambiances et histoires",
      description: "Importer, écouter, grouper et relier au gameplay.",
      steps: [
        {
          id: "bank",
          page: "audio",
          target: "[data-audio-mode='library']",
          title: "Banque sonore",
          content:
            "Chaque fichier est centralisé dans KingdomData et réutilisable partout.",
        },
        {
          id: "upload",
          page: "audio",
          target: "#audio-upload-form",
          title: "Importer et classer",
          content:
            "Choisissez fichier, type, bot parlant et mots-clés. Vous pourrez l’écouter avant attribution.",
          interaction: "free",
        },
        {
          id: "groups",
          page: "audio",
          target: "[data-audio-mode='groups']",
          title: "Groupes d’ambiance",
          content:
            "Cliquez pour réunir plusieurs sons dans une atmosphère réutilisable.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "[data-audio-mode='groups']",
          },
        },
        {
          id: "create",
          page: "audio",
          target: "#create-audio-composition",
          title: "Créer un groupe",
          content:
            "Ajoutez des couches, leurs rôles et les bâtiments suggérés.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "#create-audio-composition",
          },
        },
        {
          id: "layers",
          page: "audio",
          target: "#audio-composition-dialog",
          title: "Couches sonores",
          content:
            "Sélectionnez sons, rôles, volumes et boucles. Annulez si vous explorez seulement.",
          interaction: "free",
        },
        {
          id: "stories",
          page: "audio",
          target: "[data-audio-mode='stories']",
          title: "Histoires auditives",
          content:
            "Fermez la fenêtre puis ouvrez ce menu : chaque étape contient son, délai et texte.",
          interaction: "free",
        },
        {
          id: "building",
          page: "building",
          target: "[data-tutorial='building-open']",
          title: "Relier au gameplay",
          content:
            "Dans un bâtiment, l’onglet Audio associe ambiance et SFX aux actions.",
        },
      ],
    },
    {
      id: "weather",
      icon: "🌦️",
      module: "environment",
      title: "Configurer météo et temps",
      description: "Horloge, climats, probabilités et influences.",
      steps: [
        {
          id: "open",
          page: "environment",
          target: "#new",
          title: "Créer l’environnement",
          content:
            "Cliquez sur Nouvelle définition. Si un environnement existe déjà, vous pourrez quitter et ouvrir sa fiche à la place.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#new" },
        },
        {
          id: "clock",
          page: "environment",
          target: "[data-field='clock_mode']",
          title: "Horloge",
          content:
            "Temps autonome avance selon la vitesse ; heure administrée reste sous votre contrôle.",
          interaction: "free",
        },
        {
          id: "mode",
          page: "environment",
          target: "[data-field='environment_mode']",
          title: "Mode météo",
          content:
            "Manuel fixe la météo ; pondéré effectue des tirages ; programmé suit les plages prévues.",
          interaction: "free",
        },
        {
          id: "add",
          page: "environment",
          target: "#add-weather-option",
          title: "Ajouter un climat",
          content: "Définissez nom, emoji, poids et paramètres visuels.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#add-weather-option" },
        },
        {
          id: "modifier",
          page: "environment",
          target: "#add-world-modifier",
          title: "Influencer le gameplay",
          content:
            "Modifiez production, durée, énergie, prix, cooldown ou disponibilité.",
          interaction: "free",
        },
        {
          id: "save",
          page: "environment",
          target: "#save",
          title: "Enregistrer",
          content: "Sauvegardez puis publiez pour alimenter Monde en direct.",
          interaction: "target",
          completion: { event: "content_saved", value: "environment" },
        },
      ],
    },
    {
      id: "events",
      icon: "✦",
      module: "event",
      title: "Créer un grand événement",
      description: "Déclencheur, effets, modificateurs et ambiance.",
      steps: [
        {
          id: "new",
          page: "event",
          target: "#new",
          title: "Créer la définition",
          content: "Cliquez pour ouvrir le grand éditeur Event.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#new" },
        },
        {
          id: "trigger",
          page: "event",
          target: "[data-field='trigger_type']",
          title: "Déclencheur",
          content:
            "Manuel, programmé, récurrent, action de jeu ou nombre de joueurs.",
          interaction: "free",
        },
        {
          id: "effect",
          page: "event",
          target: "#add-effect",
          title: "Ajouter un résultat",
          content: "Message, ressource, XP, son ou autre Event.",
          interaction: "target",
          completion: { event: "dom_click", selector: "#add-effect" },
        },
        {
          id: "audio",
          page: "event",
          target: "#add-event-audio-layer",
          title: "Changer l’atmosphère",
          content:
            "Appliquez un groupe à tout le royaume ou aux bâtiments cochés.",
          interaction: "target",
          completion: {
            event: "dom_click",
            selector: "#add-event-audio-layer",
          },
        },
        {
          id: "save",
          page: "event",
          target: "#save",
          title: "Enregistrer avant activation",
          content:
            "Créez le brouillon, publiez-le puis activez son occurrence.",
          interaction: "target",
          completion: { event: "content_saved", value: "event" },
        },
      ],
    },
  ],
  screenTours: {
    dashboard: [
      {
        target: "#nav",
        title: "Navigation",
        content: "Tous les modules du royaume.",
      },
      {
        target: "#save-state",
        title: "État réel",
        content: "Vérifiez la synchronisation.",
      },
    ],
    building: [
      {
        target: "#new",
        title: "Créer",
        content: "L’assistant prépare une base complète.",
      },
      {
        target: "#cards",
        title: "Bâtiments",
        content: "Ouvrez, dupliquez et publiez chaque lieu.",
      },
    ],
    profession: [
      {
        target: "#new",
        title: "Métiers",
        content: "Créez les métiers partagés puis reliez-les aux bâtiments.",
      },
    ],
    environment: [
      {
        target: "#cards",
        title: "Temps et météo",
        content: "Gérez horloge, climats et influences.",
      },
    ],
    event: [
      {
        target: "#new",
        title: "Events",
        content: "Créez des changements temporaires.",
      },
    ],
    audio: [
      {
        target: "[data-audio-mode='library']",
        title: "Banque audio",
        content: "Importez et écoutez les sons.",
      },
      {
        target: "[data-audio-mode='groups']",
        title: "Groupes",
        content: "Composez des ambiances réutilisables.",
      },
    ],
    voice_presence: [
      {
        target: "[data-tutorial='voice-presence-studio']",
        title: "Présence et capacité",
        content:
          "La présence est l’identité entendue. Une capacité Discord libre l’exécute temporairement.",
      },
      {
        target: "[data-new-presence]",
        title: "Créer une identité",
        content:
          "Choisissez Personnage, Ambiance ou Personnalisée, puis son lieu et son comportement.",
      },
      {
        target: "[data-voice-tab='profiles']",
        title: "Profils vocaux",
        content:
          "Regroupez langue, clips, volume et fallback sans lier la voix à un bot fixe.",
      },
    ],
  },
};
