/* Contenu pédagogique centralisé. Les cibles reposent uniquement sur des attributs stables. */
window.KingdomTutorialContent = {
  tutorials: [
    {id:"first_realm",icon:"👑",module:"dashboard",title:"Construire mon premier royaume",description:"Passez d’un monde vide à une première expérience jouable sur Discord.",steps:[
      {id:"dashboard",page:"dashboard",target:"[data-type='dashboard']",title:"Votre centre de commandement",content:"Le tableau de bord résume votre royaume. Vous pourrez toujours revenir ici.",position:"right"},
      {id:"building",page:"building",target:"#new",title:"Créez un premier bâtiment",content:"Un bâtiment rassemble les actions, métiers, sons et pages Discord d’un lieu.",position:"bottom",rule:"has_building"},
      {id:"profession",page:"building",target:"[data-building-tab='mechanics']",title:"Ajoutez un métier",content:"Dans Fonctionnement, associez un métier puis créez une activité accessible aux joueurs.",rule:"has_profession"},
      {id:"activity",page:"building",target:"[data-building-tab='mechanics']",title:"Créez une activité",content:"Une activité précise l’outil, la durée, l’énergie et les résultats.",rule:"has_activity"},
      {id:"audio",page:"building",target:"[data-building-tab='sound']",title:"Donnez une ambiance au lieu",content:"L’ambiance joue dans le vocal. Un SFX se déclenche seulement lors d’une action.",rule:"has_ambience"},
      {id:"discord",page:"building",target:"[data-building-tab='visual']",title:"Préparez l’interface Discord",content:"Créez une page, un texte et un bouton relié à une vraie action.",rule:"has_discord_page"},
      {id:"publish",page:"building",target:"#save",title:"Sauvegarder puis publier",content:"Sauvegarder crée un brouillon. Publier l’active. Synchroniser transmet ensuite les changements aux services.",rule:"has_published_building"}
    ]},
    {id:"building",icon:"🏰",module:"building",title:"Créer mon premier bâtiment",description:"Identité, fonctionnement, relations, audio, Discord et localisation.",steps:[
      {id:"open",page:"building",target:"[data-tutorial='building-open']",title:"Choisissez un bâtiment",content:"Cliquez sur Modifier sur le bâtiment que vous souhaitez découvrir.",interaction:"free",completion:{event:"building_editor_opened"}},
      {id:"relations_open",page:"building",target:"[data-tutorial='building-tab-relations']",title:"Ouvrez Relations",content:"Cliquez sur l’onglet Relations pour continuer.",interaction:"target",completion:{event:"building_tab_changed",value:"relations"}},
      {id:"relations_explain",page:"building",target:"[data-tutorial='building-panel-relations']",title:"Les relations du bâtiment",content:"Vous voyez ici le métier principal, le bot, les objets utilisés et les relations calculées.",interaction:"blocked"},
      {id:"functioning",page:"building",target:"[data-tutorial='building-tab-mechanics']",title:"Passez au fonctionnement",content:"Cliquez ici pour retrouver les métiers, zones, résultats, recettes et livraisons.",interaction:"target",completion:{event:"building_tab_changed",value:"mechanics"},rule:"has_activity"},
      {id:"audio",page:"building",target:"[data-tutorial='building-tab-audio']",title:"Ouvrez Audio",content:"Cliquez sur Audio. Vous pourrez ensuite rechercher et sélectionner librement une ambiance.",interaction:"target",completion:{event:"building_tab_changed",value:"sound"},rule:"has_ambience"},
      {id:"audio_work",page:"building",target:"[data-building-panel='sound']",title:"Configurez le son",content:"L’interface reste entièrement utilisable : écoutez, choisissez une ambiance ou associez un SFX.",interaction:"free"},
      {id:"discord",page:"building",target:"[data-tutorial='building-tab-discord']",title:"Ouvrez Discord",content:"Cliquez sur Discord pour composer les pages, textes, boutons et actions.",interaction:"target",completion:{event:"building_tab_changed",value:"visual"},rule:"has_discord_page"},
      {id:"discord_work",page:"building",target:"[data-building-panel='visual']",title:"Construisez l’interface",content:"Ajoutez ou modifiez les composants réels. Le tutoriel reste visible sans bloquer les sélecteurs.",interaction:"free"}
    ]},
    {id:"professions",icon:"⚒️",module:"profession",title:"Comprendre les métiers",description:"Métier → bâtiment → activité → outil → résultat.",steps:[
      {id:"catalog",page:"profession",target:"#cards",title:"Des fiches transversales",content:"Un métier peut relier plusieurs activités, outils, productions et bâtiments.",rule:"has_profession"},
      {id:"building_link",page:"building",target:"[data-building-tab='mechanics']",title:"Associer au gameplay",content:"Ajoutez le métier depuis le fonctionnement d’un bâtiment, puis configurez ses zones."}
    ]},
    {id:"items",icon:"🎒",module:"item",title:"Comprendre les objets",description:"Outils, récompenses, ingrédients, produits et conditions.",steps:[
      {id:"catalog",page:"item",target:"#cards",title:"Un objet, plusieurs usages",content:"Les usages affichés viennent des relations réelles du moteur, pas d’une liste dupliquée.",rule:"has_item"},
      {id:"create",page:"item",target:"#new",title:"Créer dans le contexte",content:"Quand un sélecteur ne contient pas encore l’objet voulu, créez-le sans perdre votre travail."}
    ]},
    {id:"audio",icon:"🔊",module:"audio",title:"Ambiances et effets sonores",description:"Comprendre la différence entre ambiance vocale et son d’action.",steps:[
      {id:"bank",page:"audio",target:"#cards",title:"La banque audio",content:"Écoutez, classez et assignez les fichiers disponibles."},
      {id:"voice",page:"bot",target:"#cards",title:"La contrainte vocale",content:"Un bot Discord ne peut rejoindre qu’un salon vocal à la fois. Associez un bot par espace nécessitant sa propre ambiance."},
      {id:"ambience",page:"building",target:"[data-building-tab='sound']",title:"Ambiance globale",content:"Vent, oiseaux ou musique générale : ce son accompagne le bâtiment.",rule:"has_ambience"},
      {id:"sfx",page:"building",target:"[data-building-tab='sound']",title:"SFX d’action",content:"Coup de hache, pièces ou boisson : le son se joue lorsque l’action correspondante est exécutée.",rule:"has_sfx"}
    ]},
    {id:"world",icon:"🗺️",module:"location",title:"Construire et relier mon monde",description:"Royaume → région → ville ou zone → lieu → bâtiment.",steps:[
      {id:"map",page:"location",target:"#cards",title:"Votre géographie",content:"Placez les lieux puis reliez-les avec des chemins réellement empruntables.",rule:"has_location"},
      {id:"route",page:"location",target:"#cards",title:"Relier deux lieux",content:"Une route possède une origine, une destination, une durée, une direction et éventuellement des conditions.",rule:"has_route"},
      {id:"visibility",page:"location",target:"#cards",title:"Visible, verrouillée ou secrète",content:"Visible : affichée. Verrouillée : affichée mais inaccessible. Secrète : invisible jusqu’à sa découverte."},
      {id:"exploration",page:"players",target:"#admin-view",title:"Une position logique individuelle",content:"Deux joueurs dans le même vocal peuvent explorer deux lieux logiques différents."}
    ]},
    {id:"events",icon:"⚡",module:"event",title:"Faire évoluer mon monde",description:"Cible → propriété → opération → valeur effective.",steps:[
      {id:"create",page:"event",target:"#new",title:"Créer un événement",content:"Un événement applique temporairement des modificateurs génériques.",rule:"has_event"},
      {id:"effective",page:"live_world",target:".world-impacts",title:"Base + modificateurs = effectif",content:"La configuration de base reste intacte. Quand l’événement disparaît, la valeur revient à sa valeur initiale."},
      {id:"weather",page:"environment",target:"#admin-view",title:"Météo et temps",content:"La météo peut être manuelle, programmée ou pondérée et utiliser les mêmes modificateurs gameplay."}
    ]},
    {id:"publication",icon:"⇧",module:"building",title:"Publier et synchroniser",description:"Comprendre le cycle de mise en ligne sans risque.",steps:[
      {id:"edit",page:"building",target:"#cards",title:"Modifier",content:"Ouvrir un contenu ne change pas encore le monde en direct."},
      {id:"save",page:"building",target:"#save",title:"Sauvegarder",content:"Un brouillon versionné conserve votre travail sans l’activer."},
      {id:"publish",page:"building",target:"#cards",title:"Publier",content:"La publication désigne la version que le moteur doit utiliser.",rule:"has_published_building"},
      {id:"sync",page:"dashboard",target:"#save-state",title:"Synchroniser",content:"Synchronisé signifie que les services utilisent la version publiée. Une erreur reste visible et expliquée ici."}
    ]}
  ],
  screenTours: {
    dashboard:[{target:"#nav",title:"Navigation",content:"Tous les modules de votre royaume."},{target:"#save-state",title:"État réel",content:"Vérifiez ici si vos publications sont synchronisées."}],
    building:[{target:"#new",title:"Créer",content:"L’assistant Simple prépare un bâtiment complet."},{target:"#cards",title:"Vos bâtiments",content:"Ouvrez, dupliquez, publiez ou archivez chaque lieu."}],
    location:[{target:"#cards",title:"Carte et lieux",content:"La carte montre les connexions calculées entre vos lieux."}],
    event:[{target:"#new",title:"Événements",content:"Créez des changements temporaires sans modifier les valeurs de base."}],
    audio:[{target:"#cards",title:"Banque audio",content:"Préécoutez les sons avant de les associer."}]
  }
};
