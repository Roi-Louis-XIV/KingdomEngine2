/* Presets volontairement simples : ils produisent le même format que KingdomData. */
window.KingdomBuildingPresets = [
  {
    key: "harvest",
    icon: "🌲",
    name: "Récolte",
    description: "Les joueurs dépensent de l’énergie pour obtenir des ressources.",
    example: "Mine, forêt, ferme, carrière",
    payload: {
      building_kind: "harvest", emoji: "🌲", color: "22c55e",
      description: "Un lieu où les aventuriers récoltent les ressources du Royaume.",
      actions: [{key:"gather_resources",name:"Récolter",emoji:"🧺",enabled:true,effects:[
        {type:"cost",resource:"energy",amount:5},
        {type:"reward",resource:"wood",amount:2},
        {type:"message",text:"Votre récolte est terminée."}
      ]}]
    }
  },
  {
    key: "production",
    icon: "⚒️",
    name: "Production",
    description: "Transforme des matières premières en objets plus utiles.",
    example: "Forge, boulangerie, atelier",
    payload: {
      building_kind: "production", emoji: "⚒️", color: "f59e0b",
      description: "Un atelier qui transforme les ressources des aventuriers.",
      actions: [{key:"craft_item",name:"Fabriquer",emoji:"🛠️",enabled:true,effects:[
        {type:"cost",resource:"iron_ore",amount:2},
        {type:"reward",resource:"iron",amount:1},
        {type:"message",text:"La fabrication est terminée."}
      ]}]
    }
  },
  {
    key: "commerce",
    icon: "🛒",
    name: "Commerce",
    description: "Permet d’acheter des objets avec la monnaie du jeu.",
    example: "Boutique, marché, taverne",
    payload: {
      building_kind: "commerce", emoji: "🛒", color: "8b5cf6",
      description: "Un commerce où dépenser ses pièces et découvrir de nouveaux objets.",
      actions: [{key:"buy_item",name:"Acheter",emoji:"🪙",enabled:true,effects:[
        {type:"cost",resource:"money",amount:5},
        {type:"reward",resource:"bread",amount:1},
        {type:"message",text:"Votre achat a bien été ajouté à l’inventaire."}
      ]}]
    }
  },
  {
    key: "social",
    icon: "🍻",
    name: "Social",
    description: "Crée un lieu de rencontre, de dialogue et d’événements.",
    example: "Taverne, place publique, guilde",
    payload: {
      building_kind: "social", emoji: "🍻", color: "ec4899",
      description: "Un lieu vivant où les aventuriers se rencontrent.",
      actions: [{key:"meet_people",name:"Discuter",emoji:"💬",enabled:true,effects:[
        {type:"message",text:"Vous prenez le temps de discuter avec les habitants."},
        {type:"emit",event:"social.interaction",payload:{}}
      ]}]
    }
  },
  {
    key: "administration",
    icon: "👑",
    name: "Administration",
    description: "Centralise les annonces, décisions et services du Royaume.",
    example: "Hôtel de ville, château, tribunal",
    payload: {
      building_kind: "administration", emoji: "👑", color: "3b82f6",
      description: "Le centre administratif qui organise la vie du Royaume.",
      actions: [{key:"view_announcements",name:"Voir les annonces",emoji:"📜",enabled:true,effects:[
        {type:"message",text:"Voici les dernières annonces du Royaume."}
      ]}]
    }
  },
  {
    key: "custom",
    icon: "✨",
    name: "Libre",
    description: "Commence avec une page blanche et ajoute uniquement ce dont tu as besoin.",
    example: "Pour un concept vraiment unique",
    payload: {
      building_kind: "custom", emoji: "✨", color: "64748b",
      description: "Un nouveau lieu du Royaume.", actions: []
    }
  }
];

window.kingdomSlug = value => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
