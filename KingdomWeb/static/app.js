let initialAdminToken=localStorage.kingdomToken||"";
if(!initialAdminToken){try{initialAdminToken=prompt("Jeton administrateur", "change-me")||"";}catch(_){initialAdminToken="change-me";}}
const state = {
  type: "dashboard", items: [], editing: null, duplicate: false,
  selectedPreset: null, keyTouched: false, buildingBase: null,
  interfaceDraft: null, selectedPage: null, selectedComponent: null, adminTimer: null,
  supervisionTab: "overview", settingsTab: "onboarding",
  catalogs: {item: [], event: [], building: [], interface: []},
  token: initialAdminToken
};
localStorage.kingdomToken = state.token;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const kingdomSlug = window.kingdomSlug;
// Une clé générée doit rester valide, même lorsque le débutant choisit un nom très court.
function technicalKey(value, fallback="element") {
  const slug = kingdomSlug(value);
  return (slug.length >= 3 ? slug : `${fallback}_${slug || "nouveau"}`).slice(0, 64);
}
const headers = {Authorization: `Bearer ${state.token}`, "Content-Type": "application/json"};
const labels = {dashboard:"Tableau de bord", building:"Bâtiments", item:"Objets", event:"Événements", bot:"Bots Discord", audio:"Voix & audio", supervision:"Supervision", settings:"Paramètres serveur"};
const icons = {dashboard:"◈", building:"🏰", item:"🎒", event:"⚡", bot:"🤖", audio:"🔊", supervision:"🛡️", settings:"⚙️"};

const HELP = {
  preset: ["Choisir un modèle", "Le modèle prépare une structure complète. Tout reste modifiable ensuite.", ["Récolte pour obtenir des ressources", "Production pour transformer", "Commerce pour vendre"]],
  name: ["Nom du lieu", "Choisis un nom court et évocateur. Il sera affiché dans Discord et utilisé pour nommer les salons.", ["Ferme du Royaume", "Atelier des alchimistes"]],
  emoji: ["Symbole", "Un emoji aide les joueurs à reconnaître instantanément le lieu.", ["🌾 pour une ferme", "⚒️ pour une forge"]],
  description: ["Description", "Explique simplement ce que le joueur peut faire ici, en une seule phrase.", ["Récoltez des céréales et nourrissez le village."]],
  actions: ["Actions des joueurs", "Chaque action devient un bouton Discord. Commence par une action claire, puis ajoute ses conséquences.", ["Récolter", "Acheter", "Discuter"]],
  action_name: ["Nom du bouton", "Utilise un verbe qui annonce clairement ce qui va se passer.", ["Couper du bois", "Commander un repas"]],
  effects: ["Résultat de l’action", "Les résultats sont exécutés dans l’ordre : payer un coût, recevoir un objet, puis afficher un message.", ["Retirer 5 énergie", "Donner 2 bois"]],
  effect_resource: ["Ressource ou objet", "Utilise l’identifiant d’un objet existant, ou money / energy pour la monnaie et l’énergie.", ["wood", "iron_ore", "money", "energy"]],
  condition_type: ["Condition d’accès", "Choisis ce que le moteur doit vérifier avant d’autoriser l’action. Les conditions peuvent être combinées ou inversées.", ["Métier actif", "Durabilité minimale", "Rôle Discord"]],
  condition_operator: ["Comparaison", "Compare la valeur du joueur avec le seuil configuré.", ["≥ 5 : au moins cinq", "= 1 : exactement un"]],
  condition_value: ["Valeur attendue", "Seuil numérique utilisé par la condition. Les conditions oui/non utilisent généralement 1.", ["10 énergie", "2 niveaux"]],
  condition_group: ["Combiner les conditions", "Toutes exige chaque condition. Au moins une accepte l’action dès qu’une condition est vraie.", []],
  module_activity_scope: ["Portée de la limite", "Détermine quelles activités en cours sont comptées pour bloquer un nouveau lancement.", ["Joueur + bâtiment", "Joueur + action", "Catégorie"]],
  module_activity_min_durability: ["Durabilité requise", "L’activité est refusée si l’outil possède moins de durabilité que ce seuil.", []],
  module_hook_claim: ["Événement de récupération", "Cet événement KingdomEvent est émis lorsque le joueur récupère le résultat. Le résultat aléatoire sélectionné est inclus.", []],
  npc_name: ["Personnage associé", "Facultatif. Donne un visage au bâtiment et prépare les futures interactions narratives.", ["Roland le mineur"]],
  color: ["Couleur Discord", "Couleur hexadécimale des encarts Discord, sans le caractère #.", ["22c55e", "8b5cf6"]],
  technical_key: ["Identifiant technique", "Il relie les données au moteur. Il est généré automatiquement et ne doit contenir que des lettres minuscules, chiffres et underscores.", ["ferme_du_royaume"]],
  modules_json: ["Configuration intégrale", "Tous les paramètres du bâtiment sont conservés ici : PNJ, métiers, niveaux, durées, énergie, stocks, recettes, butins, livraisons, réparations, améliorations et jeux.", ["Modifie une valeur puis publie le brouillon", "Le moteur régénère les actions depuis ces modules"]]
  ,building_mechanics: ["Comprendre le fonctionnement", "Un métier définit qui peut agir. Une activité décrit où agir, pendant combien de temps et avec quel outil. Les résultats indiquent ensuite ce que le joueur reçoit.", ["1. Crée le métier", "2. Ajoute ses zones d’activité", "3. Ajoute plusieurs résultats et leurs effets", "4. Enregistre puis publie"]]
};

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
const input = (label, name, value="", type="text", extra="") => `<label>${label}<input data-field="${name}" data-help="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`;
const select = (label, name, value, options) => `<label>${label}<select data-field="${name}" data-help="${name}">${options.map(([key,text]) => `<option value="${key}" ${key===value?"selected":""}>${text}</option>`).join("")}</select></label>`;
const check = (label, name, checked) => `<label class="check"><input data-field="${name}" type="checkbox" ${checked?"checked":""}><span>${label}</span></label>`;
const fieldValue = (name, root=document) => {
  const element = root.querySelector(`[data-field="${name}"]`);
  if (!element) return undefined;
  if (element.type === "checkbox") return element.checked;
  if (element.type === "number") return Number(element.value);
  return element.value;
};
const clone = value => JSON.parse(JSON.stringify(value));

function setHelp(key) {
  const [title, text, examples=[]] = HELP[key] || ["Option modifiable", "Cette option peut être ajustée maintenant ou plus tard.", []];
  $("#help-title").textContent = title;
  $("#help-text").textContent = text;
  $("#help-list").innerHTML = examples.map(example => `<li>${escapeHtml(example)}</li>`).join("");
}

async function load() {
  clearInterval(state.adminTimer);
  if (state.type === "dashboard") { await loadDashboard(); return; }
  if (state.type === "supervision") { await loadSupervision(); return; }
  if (state.type === "settings") { await loadSettings(); return; }
  $("#content-stats").hidden = false; $("#content-workspace").hidden = false; $("#admin-view").hidden = true; $("#new").hidden = false;
  const response = await fetch(`/api/content?entity_type=${state.type}`, {headers});
  if (!response.ok) { alert("Accès refusé ou API indisponible."); return; }
  state.items = await response.json();
  renderCards();
}

async function loadCatalogs() {
  const [itemsResponse, eventsResponse, buildingsResponse, interfacesResponse] = await Promise.all([
    fetch("/api/content?entity_type=item", {headers}),
    fetch("/api/content?entity_type=event", {headers}),
    fetch("/api/content?entity_type=building", {headers}),
    fetch("/api/content?entity_type=interface", {headers}),
  ]);
  if (itemsResponse.ok) state.catalogs.item = await itemsResponse.json();
  if (eventsResponse.ok) state.catalogs.event = await eventsResponse.json();
  if (buildingsResponse.ok) state.catalogs.building = await buildingsResponse.json();
  if (interfacesResponse.ok) state.catalogs.interface = await interfacesResponse.json();
}

function catalogOptions(type, currentValue="") {
  const systemResources = type === "item"
    ? [["money", "💰 Monnaie"], ["energy", "⚡ Énergie"]]
    : [];
  const entities = state.catalogs[type].map(entity => [
    entity.entity_key,
    `${entity.payload.emoji || ({item:"📦",event:"⚡",building:"🏰",interface:"🖼️"}[type]||"•")} ${entity.payload.name || entity.entity_key}`,
  ]);
  const options = [...systemResources, ...entities];
  // Préserve une ancienne référence même si son objet a depuis été supprimé.
  if (currentValue && !options.some(([key]) => key === currentValue)) {
    options.push([currentValue, `⚠ ${currentValue} (introuvable)`]);
  }
  return [["", ({item:"Choisir une ressource…",event:"Choisir un événement…",building:"Choisir un bâtiment…",interface:"Choisir une interface…"}[type]||"Choisir…")], ...options];
}

function renderCards() {
  const query = $("#search").value.toLowerCase();
  const items = state.items.filter(item => `${item.entity_key} ${item.payload.name}`.toLowerCase().includes(query));
  $("#count").textContent = state.items.length;
  $("#published").textContent = state.items.filter(item => item.status === "published").length;
  $("#drafts").textContent = state.items.filter(item => item.status === "draft").length;
  $("#cards").innerHTML = items.map(item => `
    <article class="card" data-open="${item.entity_key}" tabindex="0">
      <div class="card-head"><span class="emoji">${item.payload.emoji||icons[state.type]}</span><span class="badge ${item.status}">${item.status==="published"?"PUBLIÉ":"BROUILLON"}</span></div>
      <h3>${escapeHtml(item.payload.name)}</h3><p>${escapeHtml(item.payload.description||"Aucune description")}</p>
      <div class="meta"><span>${item.entity_key} · v${item.version}</span><span>
        ${state.type==="building"?`<button type="button" data-duplicate="${item.entity_key}">Dupliquer</button> · `:""}
        ${state.type==="bot"?`<button type="button" data-invite="${item.entity_key}">Inviter</button> · `:""}
        <button type="button" data-edit="${item.entity_key}">Modifier</button>
        ${item.status==="draft"?` · <button type="button" data-publish="${item.entity_key}" data-version="${item.version}">Publier</button>`:""}
        ${["building","item","event"].includes(state.type)?` · <button type="button" class="danger-link" data-delete="${item.entity_key}">Supprimer</button>`:""}
      </span></div>
    </article>`).join("") || `<p class="empty">Aucune définition. Crée la première.</p>`;
}

function showModal() {
  $("#editor").hidden = false;
  document.body.classList.add("modal-open");
}

function resetEditor() {
  state.editing = null; state.duplicate = false; state.selectedPreset = null; state.keyTouched = false; state.buildingBase = null;
  state.interfaceDraft = null; state.selectedPage = null; state.selectedComponent = null;
  $(".wizard-panel").classList.remove("visual-mode","building-mode"); $("#context-help").hidden = false;
  $("#error").textContent = "";
  $("#wizard-back").hidden = true;
  $("#preset-step").hidden = true;
  $("#definition-step").hidden = false;
  $$(".common-fields").forEach(element => element.hidden = false);
  configureCommonFields();
}

function configureCommonFields() {
  const visual=state.type==="interface";
  $("#common-title").textContent=visual?"Identité de l’interface":"L’essentiel";
  $("#common-description").textContent=visual?"Le nom utilisé dans le Studio et le thème général.":"Ce que les joueurs verront dans Discord.";
  $("#name-label").textContent=visual?"Nom de l’interface":state.type==="building"?"Nom du lieu":"Nom";
  $("#name").placeholder=visual?"Ex. Interface de la Taverne":state.type==="building"?"Ex. Ferme du Royaume":"Ex. Nouvelle définition";
}

function startCreate() {
  resetEditor();
  $("#key").disabled = false; $("#key").value = "";
  $("#name").value = ""; $("#emoji").value = ""; $("#description").value = "";
  if (state.type === "building") {
    $("#editor-kicker").textContent = "ASSISTANT · ÉTAPE 1 SUR 2";
    $("#editor-title").textContent = "Quel lieu veux-tu créer ?";
    $("#definition-step").hidden = true;
    renderPresetPicker();
    setHelp("preset");
  } else {
    $("#editor-kicker").textContent = "ÉDITEUR NO-CODE";
    $("#editor-title").textContent = `Nouvelle définition`;
    renderFields({});
  }
  showModal();
}

function renderPresetPicker() {
  const root = $("#preset-step");
  root.hidden = false;
  root.innerHTML = `<div class="preset-intro"><h3>Choisis le fonctionnement le plus proche</h3><p>Pas d’inquiétude : chaque détail pourra être changé à l’étape suivante.</p></div><div class="preset-grid">${KingdomBuildingPresets.map(preset => `
    <button type="button" class="preset-card" data-preset="${preset.key}"><span class="preset-icon">${preset.icon}</span><strong>${preset.name}</strong><p>${preset.description}</p><small>Ex. ${preset.example}</small></button>`).join("")}</div>`;
  root.querySelectorAll("[data-preset]").forEach(button => {
    button.onmouseenter = () => setHelp("preset");
    button.onclick = () => applyPreset(button.dataset.preset);
  });
}

function applyPreset(key) {
  const preset = KingdomBuildingPresets.find(item => item.key === key);
  if (!preset) return;
  state.selectedPreset = key;
  const payload = clone(preset.payload);
  state.buildingBase = clone(payload);
  $("#name").value = ""; $("#emoji").value = payload.emoji; $("#description").value = payload.description;
  $("#key").value = ""; state.keyTouched = false;
  $("#preset-step").hidden = true; $("#definition-step").hidden = false; $("#wizard-back").hidden = false;
  $("#editor-kicker").textContent = "ASSISTANT · ÉTAPE 2 SUR 2";
  $("#editor-title").textContent = `Personnalise ton bâtiment`;
  renderBuildingFields(payload, preset);
  setHelp("name");
  setTimeout(() => $("#name").focus(), 0);
}

function openEditor(entity, duplicate=false) {
  resetEditor();
  const payload = clone(entity.payload);
  state.editing = duplicate ? null : entity;
  state.duplicate = duplicate;
  state.selectedPreset = payload.building_kind || null;
  if (duplicate) {
    payload.name = `Copie de ${payload.name}`;
    payload.actions = (payload.actions||[]).map(action => ({...action, key:""}));
  }
  state.buildingBase = clone(payload);
  $("#key").value = duplicate ? "" : entity.entity_key;
  $("#key").disabled = !duplicate;
  $("#name").value = payload.name || ""; $("#emoji").value = payload.emoji || ""; $("#description").value = payload.description || "";
  $("#editor-kicker").textContent = duplicate ? "DUPLICATION GUIDÉE" : "ÉDITEUR NO-CODE";
  $("#editor-title").textContent = duplicate ? "Crée une variante" : `Modifier ${payload.name}`;
  renderFields(payload);
  if (duplicate) $("#wizard-back").hidden = false;
  setHelp(duplicate ? "name" : "actions");
  showModal();
}

function renderFields(payload) {
  if (state.type === "building") { renderBuildingFields(payload); return; }
  if (state.type === "interface") { renderInterfaceFields(payload); return; }
  const root = $("#type-fields");
  if (state.type === "item") root.innerHTML = `<section class="form-section"><h3>Propriétés de l’objet</h3><div class="form-grid">${select("Catégorie","category",payload.category||"resources",[["drinks","Boisson / repas"],["equipment","Équipement"],["ingredients","Ingrédient"],["resources","Ressource"]])}${input("Type","type",payload.type||"ressource")}${select("Rareté","rarity",payload.rarity||"commun",[["commun","Commun"],["peu_commun","Peu commun"],["rare","Rare"],["epique","Épique"],["legendaire","Légendaire"]])}${input("Prix","price",payload.price||0,"number",'min="0"')}${input("Taille maximale de pile","stack_limit",payload.stack_limit||999,"number",'min="1"')}</div><div class="checks">${check("Empilable","stackable",payload.stackable!==false)}${check("Consommable","consumable",!!payload.consumable)}${check("Vendable","sellable",payload.sellable!==false)}</div></section>`;
  if (state.type === "event") { root.innerHTML = `<section class="form-section"><h3>Déclenchement</h3><div class="form-grid">${select("Type","trigger_type",payload.trigger?.type||"manual",[["manual","Manuel"],["scheduled","Date programmée"],["recurring","Récurrent"],["action","Action de jeu"],["players","Nombre de joueurs"]])}${input("Expression / valeur","trigger_value",payload.trigger?.value||"")}${input("Début","starts_at",payload.starts_at||"","datetime-local")}${input("Fin","ends_at",payload.ends_at||"","datetime-local")}${input("Priorité","priority",payload.priority||0,"number")}</div><div class="checks">${check("Événement activé","enabled",payload.enabled!==false)}</div><div id="effects"></div><button type="button" class="secondary" id="add-effect">＋ Ajouter un résultat</button></section>`; (payload.effects||[]).forEach(effect => addEffect($("#effects"),effect)); $("#add-effect").onclick=()=>addEffect($("#effects"),{}); }
  if (state.type === "bot") root.innerHTML = `<section class="form-section"><h3>Identité et connexion Discord</h3><div class="form-grid">${select("Type de bot","bot_type",payload.bot_type||"text",[["text","Bot textuel"],["voice","Bot vocal"]])}${input("Variable de l’Application ID","application_id_env",payload.application_id_env||"")}${input("Variable du token","token_env",payload.token_env||"KINGDOM_CORE_TOKEN")}${input("Identifiant du serveur","guild_id",payload.guild_id||"")}${input("Présence Discord","presence",payload.presence||"")}</div><div class="checks">${check("Bot activé","enabled",!!payload.enabled)}${check("Connexion vocale automatique","auto_join",payload.auto_join!==false)}</div><details class="advanced"><summary>Configuration vocale avancée</summary><div class="advanced-content form-grid">${input("Identifiant du salon vocal","voice_channel_id",payload.voice_channel_id||0)}${input("Variable du salon","voice_channel_env",payload.voice_channel_env||"")}${input("Bâtiment associé","building_key",payload.building_key||"")}${input("Déconnexion après (secondes)","leave_delay",payload.leave_delay||10,"number")}${input("Dossier de bienvenue","welcome_folder",payload.welcome_folder||"")}${input("Dossier musique","music_folder",payload.music_folder||"")}${input("Dossier ambiance","ambience_folder",payload.ambience_folder||"")}${input("Dossier phrases","phrase_folder",payload.phrase_folder||"")}${input("Volume voix","volume_voice",payload.volume?.voice??.8,"number",'min="0" max="1" step="0.05"')}${input("Volume musique","volume_music",payload.volume?.music??.05,"number",'min="0" max="1" step="0.05"')}${input("Volume ambiance","volume_ambience",payload.volume?.ambience??.35,"number",'min="0" max="1" step="0.05"')}${input("Volume effets","volume_sfx",payload.volume?.sfx??.2,"number",'min="0" max="1" step="0.05"')}</div></details></section>`;
  if (state.type === "audio") root.innerHTML = `<section class="form-section"><h3>Fichier et déclenchement</h3><div class="form-grid">${input("Chemin du fichier audio","source",payload.source||"")}${input("Événements déclencheurs","triggers",(payload.triggers||[]).join(", "))}${select("Canal audio","channel",payload.channel||"sfx",[["voice","Voix"],["music","Musique"],["ambience","Ambiance"],["sfx","Effet sonore"]])}${input("Volume","volume",payload.volume??.5,"number",'min="0" max="1" step="0.05"')}</div>${check("Lecture en boucle","loop",!!payload.loop)}</section>`;
}

const COMPONENT_LIBRARY = {
  hero: {name:"En-tête", icon:"👑", props:{title:"Titre de la page",subtitle:"Une courte introduction",emoji:"🏰"}},
  text: {name:"Texte", icon:"¶", props:{text:"Votre texte ici."}},
  card: {name:"Carte", icon:"▣", props:{title:"Titre de la carte",text:"Contenu de la carte"}},
  stat: {name:"Indicateur", icon:"◫", props:{label:"Indicateur",value:"42"}},
  divider: {name:"Séparateur", icon:"—", props:{}},
  image: {name:"Image", icon:"🖼️", props:{url:"",alt:"Illustration"}},
  player_inventory: {name:"Inventaire du joueur", icon:"🎒", props:{title:"Contenu du sac"}},
  button: {name:"Bouton", icon:"◉", props:{label:"Continuer",emoji:"",style:"primary"},interaction:{type:"navigate",page:"home"}},
  select: {name:"Menu déroulant", icon:"⌄", props:{placeholder:"Choisir une option…"},options:[{key:"option_1",label:"Option 1",emoji:"",description:"",interaction:{type:"navigate",page:"home"}}]},
};

function renderInterfaceFields(payload) {
  $(".wizard-panel").classList.add("visual-mode"); $("#context-help").hidden = true;
  initializeInterfaceDraft(payload, payload.target_building_key || "");
  $("#type-fields").innerHTML = visualStudioMarkup();
  bindVisualStudio(); renderVisualStudio();
}

function blankInterface(buildingKey="", name="Bâtiment", emoji="🏰", color="7a1f1f") {
  return {name:`Interface - ${name}`,target_building_key:buildingKey,start_page:"home",theme:{color,density:"comfortable",radius:12},pages:[{key:"home",name:"Accueil",components:[{id:"hero_accueil",type:"hero",props:{title:name,subtitle:"Choisissez une action.",emoji}}]}]};
}

function initializeInterfaceDraft(payload={}, buildingKey="") {
  state.interfaceDraft=clone(Object.keys(payload||{}).length?payload:blankInterface(buildingKey));
  state.interfaceDraft.pages ||= [{key:"home",name:"Accueil",components:[]}];
  state.interfaceDraft.start_page ||= state.interfaceDraft.pages[0].key;
  state.interfaceDraft.target_building_key ||= buildingKey;
  state.interfaceDraft.pages.forEach(page=>{
    let nextSlot=0;
    (page.components||=[]).filter(component=>["button","select"].includes(component.type)).forEach(component=>{
      if(!Number.isInteger(component.slot)){while(page.components.some(other=>other!==component&&other.slot===nextSlot))nextSlot++;component.slot=component.type==="select"?Math.floor(nextSlot/5)*5:nextSlot;}
      if(component.type==="select")component.slot=Math.floor(component.slot/5)*5;
      nextSlot=component.slot+(component.type==="select"?5:1);
    });
  });
  state.selectedPage=state.interfaceDraft.start_page;
  state.selectedComponent=null;
}

function visualStudioMarkup() { return `<section class="visual-studio">
    <aside class="studio-panel"><div class="studio-panel-head"><h3>Composants</h3><small>Glisser</small></div><div class="component-library">${Object.entries(COMPONENT_LIBRARY).map(([key,item])=>`<button type="button" class="component-tile" draggable="true" data-component-type="${key}"><span>${item.icon}</span><b>${item.name}</b></button>`).join("")}</div></aside>
    <section class="studio-panel canvas-shell"><div class="canvas-toolbar"><strong id="canvas-page-name"></strong><span>Contenu puis grille Discord de 25 emplacements.</span></div><div class="builder-canvas" id="builder-canvas"></div><div class="interaction-zone"><div class="interaction-title"><b>Interactions Discord</b><small>5 lignes × 5 emplacements</small></div><div class="interaction-grid" id="interaction-grid"></div></div></section>
    <aside class="studio-panel studio-inspector"><div class="studio-panel-head"><h3>Pages</h3><button type="button" class="secondary" id="add-page">＋</button></div><div class="page-tree" id="page-tree"></div><div class="property-panel" id="property-panel"></div></aside>
  </section>`; }

function currentInterfacePage() { return state.interfaceDraft.pages.find(page=>page.key===state.selectedPage) || state.interfaceDraft.pages[0]; }
function currentInterfaceComponent() { return currentInterfacePage().components.find(component=>component.id===state.selectedComponent); }
function newComponent(type) {
  const template=COMPONENT_LIBRARY[type];
  return {id:technicalKey(`component_${Date.now()}_${Math.floor(Math.random()*9999)}`),type,props:clone(template.props),...(template.interaction?{interaction:clone(template.interaction)}:{}),...(template.options?{options:clone(template.options)}:{})};
}

function bindVisualStudio() {
  $$("[data-component-type]").forEach(tile=>tile.addEventListener("dragstart",event=>event.dataTransfer.setData("text/plain",`new:${tile.dataset.componentType}`)));
  $("#add-page").onclick=()=>{const index=state.interfaceDraft.pages.length+1;const key=technicalKey(`page_${index}`);state.interfaceDraft.pages.push({key,name:`Page ${index}`,components:[]});state.selectedPage=key;state.selectedComponent=null;renderVisualStudio();};
  const canvas=$("#builder-canvas");
  canvas.ondragover=event=>{event.preventDefault();event.dataTransfer.dropEffect="move";};
  canvas.ondrop=event=>{
    event.preventDefault(); const token=event.dataTransfer.getData("text/plain"); const page=currentInterfacePage();
    const target=event.target.closest("[data-component-id]"); let index=target?Math.max(0,page.components.findIndex(item=>item.id===target.dataset.componentId)):page.components.length;
    if(token.startsWith("new:")){const type=token.slice(4);if(["button","select"].includes(type))return;const component=newComponent(type);page.components.splice(index,0,component);state.selectedComponent=component.id;}
    if(token.startsWith("move:")){const id=token.slice(5);const old=page.components.findIndex(item=>item.id===id);if(old>=0){const [component]=page.components.splice(old,1);if(old<index)index--;page.components.splice(index,0,component);state.selectedComponent=id;}}
    renderVisualStudio();
  };
}

function slotComponent(page,slot){return page.components.find(component=>component.type==="button"&&component.slot===slot)||page.components.find(component=>component.type==="select"&&Math.floor(component.slot/5)===Math.floor(slot/5));}

function placeInteraction(type,slot) {
  const page=currentInterfacePage(),row=Math.floor(slot/5);
  if(type==="select")slot=row*5;
  if(type==="select"&&page.components.some(component=>["button","select"].includes(component.type)&&Math.floor(component.slot/5)===row)){alert("Cette ligne contient déjà une interaction.");return;}
  if(type==="button"&&slotComponent(page,slot)){alert("Cet emplacement est déjà occupé.");return;}
  const component=newComponent(type);component.slot=slot;page.components.push(component);state.selectedComponent=component.id;renderVisualStudio();
}

function renderInteractionGrid(page){
  let html="";
  for(let row=0;row<5;row++){
    const menu=page.components.find(component=>component.type==="select"&&Math.floor(component.slot/5)===row);
    if(menu){html+=`<button type="button" draggable="true" class="interaction-slot select-slot ${menu.id===state.selectedComponent?"selected":""}" data-component-id="${menu.id}" data-slot="${row*5}"><small>Ligne ${row+1}</small><b>⌄ ${escapeHtml(menu.props?.placeholder||"Menu déroulant")}</b></button>`;continue;}
    for(let column=0;column<5;column++){
      const slot=row*5+column,button=page.components.find(component=>component.type==="button"&&component.slot===slot);
      html+=button?`<button type="button" draggable="true" class="interaction-slot filled ${button.id===state.selectedComponent?"selected":""}" data-component-id="${button.id}" data-slot="${slot}"><small>${slot+1}</small><b>${escapeHtml(button.props?.emoji||"")} ${escapeHtml(button.props?.label||"Bouton")}</b></button>`:`<button type="button" class="interaction-slot" data-slot="${slot}"><small>${slot+1}</small><span>＋</span></button>`;
    }
  }
  return html;
}

function renderVisualStudio() {
  const page=currentInterfacePage(); if(!page)return;
  $("#canvas-page-name").textContent=page.name;
  $("#page-tree").innerHTML=state.interfaceDraft.pages.map(item=>`<div class="page-row"><button type="button" class="page-button ${item.key===page.key?"active":""}" data-page="${item.key}">${item.key===state.interfaceDraft.start_page?"★ ":""}${escapeHtml(item.name)}</button><div class="mini-actions"><button type="button" title="Dupliquer" data-copy-page="${item.key}">⧉</button></div></div>`).join("");
  $$("[data-page]").forEach(button=>button.onclick=()=>{state.selectedPage=button.dataset.page;state.selectedComponent=null;renderVisualStudio();});
  $$("[data-copy-page]").forEach(button=>button.onclick=()=>{const source=state.interfaceDraft.pages.find(item=>item.key===button.dataset.copyPage);const copy=clone(source);copy.key=technicalKey(`page_copy_${Date.now()}`);copy.name=`${source.name} (copie)`;copy.components.forEach((component,index)=>component.id=technicalKey(`${component.type}_${Date.now()}_${index}`));state.interfaceDraft.pages.push(copy);state.selectedPage=copy.key;state.selectedComponent=null;renderVisualStudio();});
  const contentComponents=page.components.filter(component=>!["button","select"].includes(component.type));
  $("#builder-canvas").innerHTML=`<div class="canvas-page">${contentComponents.length?contentComponents.map(renderCanvasComponent).join(""):`<div class="canvas-empty"><div><strong>Le contenu de cette page est vide</strong><p>Glissez un composant visuel depuis la bibliothèque.</p></div></div>`}</div>`;
  $("#interaction-grid").innerHTML=renderInteractionGrid(page);
  $$("[data-component-id]").forEach(element=>{element.onclick=()=>{state.selectedComponent=element.dataset.componentId;renderVisualStudio();};element.ondragstart=event=>event.dataTransfer.setData("text/plain",`move:${element.dataset.componentId}`);});
  $$("#interaction-grid [data-slot]").forEach(cell=>{cell.ondragover=event=>event.preventDefault();cell.ondrop=event=>{event.preventDefault();const token=event.dataTransfer.getData("text/plain"),slot=Number(cell.dataset.slot);if(token.startsWith("new:")){const type=token.slice(4);if(["button","select"].includes(type))placeInteraction(type,slot);}else if(token.startsWith("move:")){const component=page.components.find(item=>item.id===token.slice(5));if(component&&["button","select"].includes(component.type)){page.components=page.components.filter(item=>item!==component);const occupied=slotComponent(page,slot);if(occupied){page.components.push(component);alert("Cet emplacement est déjà occupé.");}else{component.slot=component.type==="select"?Math.floor(slot/5)*5:slot;page.components.push(component);}renderVisualStudio();}}};});
  renderPropertyPanel();
}

function renderCanvasComponent(component) {
  const props=component.props||{}; let content="";
  if(component.type==="hero")content=`<div class="preview-hero"><small>${escapeHtml(props.emoji||"")}</small><h2>${escapeHtml(props.title||"Sans titre")}</h2><p>${escapeHtml(props.subtitle||"")}</p></div>`;
  if(component.type==="text")content=`<div class="preview-text">${escapeHtml(props.text||"")}</div>`;
  if(component.type==="card")content=`<div class="preview-card"><b>${escapeHtml(props.title||"Carte")}</b><p>${escapeHtml(props.text||"")}</p></div>`;
  if(component.type==="stat")content=`<div class="preview-stat"><small>${escapeHtml(props.label||"Indicateur")}</small><strong>${escapeHtml(props.value||"—")}</strong></div>`;
  if(component.type==="divider")content=`<div class="preview-divider"></div>`;
  if(component.type==="image")content=`<div class="preview-image">${props.url?`<img src="${escapeHtml(props.url)}" alt="${escapeHtml(props.alt||"")}">`:"Ajoutez une URL d’image"}</div>`;
  if(component.type==="player_inventory")content=`<div class="preview-card"><b>🎒 ${escapeHtml(props.title||"Inventaire du joueur")}</b><p>Le contenu, la monnaie, l’énergie et les métiers du joueur seront affichés ici.</p></div>`;
  return `<div class="canvas-component ${component.id===state.selectedComponent?"selected":""}" draggable="true" data-component-id="${component.id}"><span class="drag-handle">⋮⋮</span>${content}</div>`;
}

function propertyInput(label,key,value,type="text") { return `<label>${label}<input data-prop="${key}" type="${type}" value="${escapeHtml(value??"")}"></label>`; }
function propertySelect(label,key,value,options) { return `<label>${label}<select data-prop="${key}">${options.map(([option,text])=>`<option value="${option}" ${option===value?"selected":""}>${text}</option>`).join("")}</select></label>`; }
function renderPropertyPanel() {
  const page=currentInterfacePage(),component=currentInterfaceComponent(),panel=$("#property-panel");
  const buildingOptions=[["","Aucun bâtiment"],...state.catalogs.building.map(item=>[item.entity_key,`${item.payload.emoji||"🏰"} ${item.payload.name}`])];
  const buildingField=state.type==="building"?`<p class="field-note">Cette interface appartient au bâtiment courant.</p>`:propertySelect("Bâtiment principal","interface_building",state.interfaceDraft.target_building_key||"",buildingOptions);
  const pageFields=`<h4>Interface</h4>${buildingField}${propertyInput("Couleur","theme_color",state.interfaceDraft.theme?.color||"7a1f1f")}${propertySelect("Densité","theme_density",state.interfaceDraft.theme?.density||"comfortable",[["compact","Compacte"],["comfortable","Confortable"]])}<h4>Page</h4>${propertyInput("Nom","page_name",page.name)}${propertyInput("Identifiant","page_key",page.key)}<div class="checks">${check("Page de départ","page_start",state.interfaceDraft.start_page===page.key)}</div>${state.interfaceDraft.pages.length>1?`<button type="button" class="remove-page secondary">Supprimer cette page</button>`:""}`;
  if(!component){panel.innerHTML=`${pageFields}<p class="field-note">Sélectionnez un composant pour afficher ses propriétés.</p>`;bindPropertyPanel();return;}
  const props=component.props||{};let fields="";
  if(component.type==="hero")fields=propertyInput("Titre","title",props.title)+propertyInput("Sous-titre","subtitle",props.subtitle)+propertyInput("Emoji","emoji",props.emoji);
  if(component.type==="text")fields=`<label>Texte<textarea data-prop="text" rows="5">${escapeHtml(props.text||"")}</textarea></label>`;
  if(component.type==="card")fields=propertyInput("Titre","title",props.title)+`<label>Contenu<textarea data-prop="text" rows="4">${escapeHtml(props.text||"")}</textarea></label>`;
  if(component.type==="stat")fields=propertyInput("Libellé","label",props.label)+propertyInput("Valeur","value",props.value);
  if(component.type==="image")fields=propertyInput("URL","url",props.url)+propertyInput("Texte alternatif","alt",props.alt);
  if(component.type==="player_inventory")fields=propertyInput("Titre","title",props.title||"Contenu du sac");
  if(component.type==="button")fields=buttonPropertyFields(component);
  if(component.type==="select")fields=selectPropertyFields(component);
  panel.innerHTML=`${pageFields}<hr><h4>${COMPONENT_LIBRARY[component.type].icon} ${COMPONENT_LIBRARY[component.type].name}</h4>${fields}<button type="button" class="delete-component secondary">Supprimer le composant</button>`;bindPropertyPanel();
}

function buttonPropertyFields(component) {
  const props=component.props||{},interaction=component.interaction||{type:"navigate",page:state.interfaceDraft.start_page};
  let fields=propertyInput("Libellé","label",props.label)+propertyInput("Emoji","emoji",props.emoji)+propertySelect("Style","style",props.style||"primary",[["primary","Principal"],["secondary","Secondaire"],["success","Succès"],["danger","Danger"]])+propertySelect("Au clic","interaction_type",interaction.type,[["navigate","Ouvrir une page"],["action","Lancer une action"]]);
  if(interaction.type==="navigate")fields+=propertySelect("Page cible","target_page",interaction.page,state.interfaceDraft.pages.map(page=>[page.key,page.name]));
  else {
    const building=state.type==="building"?($("#key").value||state.interfaceDraft.target_building_key):interaction.building||state.interfaceDraft.target_building_key||state.catalogs.building[0]?.entity_key||"";
    const actions=availableActions(building);
    fields+=propertySelect("Bâtiment","target_building",building,buildingTargetOptions(building));
    fields+=propertySelect("Action","target_action",interaction.action||"",[["","Choisir…"],...actions.map(action=>[action.key,action.name||action.key])]);
  }
  return fields;
}

function buildingTargetOptions(current){const options=state.catalogs.building.map(item=>[item.entity_key,`${item.payload.emoji||"🏰"} ${item.payload.name}`]);if(current&&!options.some(([key])=>key===current))options.unshift([current,"🏰 Bâtiment courant"]);return options;}

function availableActions(building){
  const currentKey=$("#key")?.value;
  if(state.type==="building"&&building===currentKey&&$("#actions"))return $$('#actions > .action-builder').map((element,index)=>({key:fieldValue("action_key",element)||technicalKey(fieldValue("action_name",element),`action_${index+1}`),name:fieldValue("action_name",element)||`Action ${index+1}`}));
  return state.catalogs.building.find(item=>item.entity_key===building)?.payload?.actions||[];
}

function interactionFields(interaction,prefix="") {
  let fields=propertySelect("Au choix",`${prefix}interaction_type`,interaction.type||"navigate",[["navigate","Ouvrir une page"],["action","Lancer une action"]]);
  if((interaction.type||"navigate")==="navigate")return fields+propertySelect("Page cible",`${prefix}target_page`,interaction.page||state.interfaceDraft.start_page,state.interfaceDraft.pages.map(page=>[page.key,page.name]));
  const building=state.type==="building"?($("#key").value||state.interfaceDraft.target_building_key):interaction.building||state.interfaceDraft.target_building_key||"";
  const actions=availableActions(building);
  return fields+propertySelect("Bâtiment",`${prefix}target_building`,building,buildingTargetOptions(building))+propertySelect("Action",`${prefix}target_action`,interaction.action||"",[["","Choisir…"],...actions.map(action=>[action.key,action.name||action.key])]);
}

function selectPropertyFields(component){
  const options=component.options||=[];
  return propertyInput("Texte du menu","placeholder",component.props?.placeholder||"Choisir une option…")+`<div class="select-options"><div class="section-head"><b>Options</b><button type="button" class="secondary add-select-option">＋ Option</button></div>${options.map((option,index)=>`<article class="select-option"><button type="button" class="remove-option" data-remove-option="${index}">×</button>${propertyInput("Libellé",`option_${index}_label`,option.label||"")}${propertyInput("Emoji",`option_${index}_emoji`,option.emoji||"")}${propertyInput("Description",`option_${index}_description`,option.description||"")}${interactionFields(option.interaction||{type:"navigate",page:state.interfaceDraft.start_page},`option_${index}_`)}</article>`).join("")}</div>`;
}

function bindPropertyPanel() {
  const page=currentInterfacePage(),component=currentInterfaceComponent(),panel=$("#property-panel");
  panel.querySelectorAll("[data-prop]").forEach(field=>field.onchange=()=>{
    const key=field.dataset.prop,value=field.type==="number"?Number(field.value):field.value;
    const optionMatch=key.match(/^option_(\d+)_(.+)$/);
    if(component&&optionMatch){const option=component.options[Number(optionMatch[1])],property=optionMatch[2];option.interaction||={type:"navigate",page:state.interfaceDraft.start_page};if(property==="interaction_type")option.interaction=value==="navigate"?{type:"navigate",page:state.interfaceDraft.start_page}:{type:"action",building:state.type==="building"?$("#key").value:state.interfaceDraft.target_building_key||"",action:""};else if(property==="target_page")option.interaction={type:"navigate",page:value};else if(property==="target_building")option.interaction={type:"action",building:value,action:""};else if(property==="target_action")option.interaction.action=value;else option[property]=value;renderVisualStudio();return;}
    if(key==="interface_building")state.interfaceDraft.target_building_key=value;
    else if(key==="theme_color"){state.interfaceDraft.theme||={};state.interfaceDraft.theme.color=value;}
    else if(key==="theme_density"){state.interfaceDraft.theme||={};state.interfaceDraft.theme.density=value;}
    else if(key==="page_name")page.name=value;
    else if(key==="page_key"){const old=page.key,newKey=technicalKey(value,"page");page.key=newKey;if(state.interfaceDraft.start_page===old)state.interfaceDraft.start_page=newKey;state.interfaceDraft.pages.forEach(item=>item.components.forEach(child=>{if(child.interaction?.type==="navigate"&&child.interaction.page===old)child.interaction.page=newKey;(child.options||[]).forEach(option=>{if(option.interaction?.type==="navigate"&&option.interaction.page===old)option.interaction.page=newKey;});}));state.selectedPage=newKey;}
    else if(component&&key==="interaction_type"){component.interaction=value==="navigate"?{type:"navigate",page:state.interfaceDraft.start_page}:{type:"action",building:state.type==="building"?$("#key").value:state.interfaceDraft.target_building_key||"",action:""};}
    else if(component&&key==="target_page")component.interaction={type:"navigate",page:value};
    else if(component&&key==="target_building")component.interaction={type:"action",building:value,action:""};
    else if(component&&key==="target_action")component.interaction.action=value;
    else if(component)component.props[key]=value;
    renderVisualStudio();
  });
  const start=panel.querySelector('[data-field="page_start"]');if(start)start.onchange=()=>{if(start.checked)state.interfaceDraft.start_page=page.key;renderVisualStudio();};
  panel.querySelector(".delete-component")?.addEventListener("click",()=>{page.components=page.components.filter(item=>item.id!==state.selectedComponent);state.selectedComponent=null;renderVisualStudio();});
  panel.querySelector(".add-select-option")?.addEventListener("click",()=>{if(component.options.length>=25)return;const index=component.options.length+1;component.options.push({key:`option_${index}`,label:`Option ${index}`,emoji:"",description:"",interaction:{type:"navigate",page:state.interfaceDraft.start_page}});renderVisualStudio();});
  panel.querySelectorAll("[data-remove-option]").forEach(button=>button.onclick=()=>{component.options.splice(Number(button.dataset.removeOption),1);renderVisualStudio();});
  panel.querySelector(".remove-page")?.addEventListener("click",()=>{const fallback=state.interfaceDraft.pages.find(item=>item.key!==page.key);state.interfaceDraft.pages=state.interfaceDraft.pages.filter(item=>item.key!==page.key);state.interfaceDraft.pages.forEach(item=>item.components.forEach(child=>{if(child.interaction?.type==="navigate"&&child.interaction.page===page.key)child.interaction.page=fallback.key;(child.options||[]).forEach(option=>{if(option.interaction?.type==="navigate"&&option.interaction.page===page.key)option.interaction.page=fallback.key;});}));if(state.interfaceDraft.start_page===page.key)state.interfaceDraft.start_page=fallback.key;state.selectedPage=fallback.key;state.selectedComponent=null;renderVisualStudio();});
}

function renderBuildingFields(payload, preset=null) {
  const root = $("#type-fields");
  const presetInfo = preset || KingdomBuildingPresets.find(item => item.key === payload.building_kind);
  const modules = payload.modules || {};
  const moduleCount = ["professions","activities","products","recipes","deliveries","upgrades"].reduce((total,key) => total + (Array.isArray(modules[key]) ? modules[key].length : 0), 0);
  const buildingKey=$("#key").value||technicalKey($("#name").value||payload.name||"batiment","batiment");
  const linked=payload.interface_key?state.catalogs.interface.find(item=>item.entity_key===payload.interface_key)?.payload:null;
  initializeInterfaceDraft(payload.interface||linked||blankInterface(buildingKey,payload.name||"Nouveau bâtiment",payload.emoji||"🏰",payload.color||"7a1f1f"),buildingKey);
  const access=payload.access||{};
  $(".wizard-panel").classList.add("visual-mode","building-mode");$("#context-help").hidden=false;setHelp("building_mechanics");
  root.innerHTML = `<div class="building-editor-tabs"><button type="button" class="active" data-building-tab="mechanics">⚙️ Fonctionnement</button><button type="button" data-building-tab="visual">🧩 Interface & navigation</button></div>
  <div data-building-panel="mechanics"><section class="form-section mechanics-guide" data-help="building_mechanics"><div class="section-copy"><span class="step-dot">?</span><div><h3>Comment construire une mécanique ?</h3><p><b>Métier</b> = rôle du joueur et outil d’entrée. <b>Zone</b> = activité temporisée accessible à ce métier. <b>Résultat</b> = tirage pondéré. <b>Effet</b> = conséquence obtenue : objet, XP, message ou événement.</p></div></div><ol><li>Crée d’abord le métier et choisis l’objet requis.</li><li>Ajoute une zone, puis sélectionne ce métier et son outil.</li><li>Règle niveau, durée, énergie et usure.</li><li>Ajoute les résultats possibles : un poids élevé les rend plus fréquents.</li><li>Dans chaque résultat, ajoute une ou plusieurs récompenses ou conséquences.</li></ol><p class="field-note">Les actions de recrutement, de démission, de départ et de récupération sont générées automatiquement.</p></section><section class="form-section module-editor"><div class="section-copy"><span class="step-dot">2</span><div><h3>Métiers et zones d’activité</h3><p>Configure plusieurs métiers, leurs outils, leurs zones et leurs résultats sans écrire de JSON.</p></div></div><div class="section-head"><b>Métiers</b><button type="button" class="secondary" id="add-profession">＋ Ajouter un métier</button></div><div id="profession-modules"></div><div class="section-head"><b>Zones et activités</b><button type="button" class="secondary" id="add-activity">＋ Ajouter une zone</button></div><div id="activity-modules"></div></section><section class="form-section"><div class="section-copy"><span class="step-dot">3</span><div><h3>Actions complémentaires</h3><p>Les métiers et zones ci-dessus génèrent automatiquement leurs actions. Ajoute ici les autres actions du lieu.</p></div></div>${presetInfo?`<span class="preset-badge">${presetInfo.icon} Modèle ${presetInfo.name}</span>`:""}<div class="section-head"><span></span><button type="button" class="secondary" id="add-action">＋ Ajouter une action</button></div><div id="actions"></div></section>
  <details class="advanced"><summary>🏗️ Configuration modulaire complète ${moduleCount ? `(${moduleCount} éléments)` : ""}</summary><div class="advanced-content"><p class="field-note">Cette configuration est la source de vérité du bâtiment. Pour les bâtiments importés, les actions sont régénérées automatiquement à partir de ces valeurs.</p><label>Paramètres du bâtiment (JSON)<textarea data-field="modules_json" data-help="modules_json" rows="12" spellcheck="false">${escapeHtml(JSON.stringify(modules,null,2))}</textarea></label>${select("Origine des actions","action_mode",payload.action_mode||"manual",[["manual","Actions éditées ci-dessus"],["generated","Actions générées depuis les modules"]])}</div></details>
  <details class="advanced"><summary>🎭 Apparence et accès Discord</summary><div class="advanced-content form-grid">${input("Couleur Discord","color",payload.color||"7a1f1f")}${input("Personnage associé (facultatif)","npc_name",payload.npc_name||"")}${input("Rôles spéciaux autorisés (séparés par des virgules)","required_roles",(access.required_roles||[]).join(", "))}${check("Bâtiment visible dans le Royaume","building_visible",access.visible!==false)}${check("Salon textuel visible uniquement dans le vocal","temporary_text",access.temporary_text!==false)}</div></details></div>
  <div data-building-panel="visual" hidden>${visualStudioMarkup()}</div>`;
  root.querySelector('[data-building-panel="mechanics"] > details').insertAdjacentHTML("beforebegin",`<section class="form-section"><div class="section-copy"><span class="step-dot">🚚</span><div><h3>Livraisons et transferts</h3><p>Discord propose uniquement les ressources acceptées réellement présentes dans l’inventaire.</p></div></div><div class="section-head"><b>Ressources livrables</b><button type="button" class="secondary" id="add-delivery">＋ Ajouter une ressource livrable</button></div><div id="delivery-modules"></div><div class="checks">${check("Autoriser Tout livrer","delivery_all",modules.delivery_mode==="all_available")}</div></section>`);
  (payload.actions||[]).forEach(addAction);
  (modules.professions||[]).forEach(addProfessionModule);
  (modules.activities||[]).forEach(addActivityModule);
  (modules.deliveries||[]).forEach(addDeliveryModule);
  $("#add-profession").onclick=()=>{addProfessionModule({});refreshActivityProfessionOptions();};
  $("#add-activity").onclick=()=>addActivityModule({outcomes:[]});
  $("#add-delivery").onclick=()=>addDeliveryModule({source:"player_inventory",destination:"building_stock",minimum_quantity:1,unit_price:0,payment_resource:"money"});
  $("#add-action").onclick = () => { addAction({effects:[]}); setHelp("action_name"); };
  $("#add-action").dataset.help = "actions";
  bindVisualStudio();renderVisualStudio();
  $$('[data-building-tab]').forEach(button=>button.onclick=()=>{$$('[data-building-tab]').forEach(item=>item.classList.toggle("active",item===button));$$('[data-building-panel]').forEach(panel=>panel.hidden=panel.dataset.buildingPanel!==button.dataset.buildingTab);if(button.dataset.buildingTab==="visual")renderVisualStudio();});
}

function professionOptions(current="") {
  const options=$$("#profession-modules > .profession-module").map(element=>{
    const key=fieldValue("module_profession_key",element);
    return [key,fieldValue("module_profession_name",element)||key];
  }).filter(([key])=>key);
  if(current&&!options.some(([key])=>key===current))options.push([current,current]);
  return [["","Choisir un métier…"],...options];
}

function addProfessionModule(profession={}) {
  const element=document.createElement("details");element.className="builder profession-module";element.open=!profession.key;element.dataset.original=JSON.stringify(profession);
  element.innerHTML=`<summary><strong>📜 ${escapeHtml(profession.name||"Nouveau métier")}</strong><small>${escapeHtml(profession.key||"à configurer")}</small></summary><div class="module-content"><button type="button" class="remove">×</button><div class="form-grid">${input("Nom du métier","module_profession_name",profession.name||"")}${input("Identifiant","module_profession_key",profession.key||"")}${input("Emoji","module_profession_emoji",profession.emoji||"📜")}${select("Outil ou objet requis","module_profession_item",profession.required_item||"",catalogOptions("item",profession.required_item||""))}${input("Niveau initial de l’outil","module_profession_tool_level",profession.tool_level||1,"number","min=1")}${input("Durabilité initiale","module_profession_initial_durability",profession.initial_durability||profession.max_durability||1,"number","min=0")}${input("Durabilité maximale","module_profession_max_durability",profession.max_durability||1,"number","min=1")}</div><div class="checks">${check("Donner automatiquement cet outil","module_profession_grant",profession.grant_required_item===true)}</div></div>`;
  $("#profession-modules").append(element);element.querySelector(".remove").onclick=()=>{element.remove();refreshActivityProfessionOptions();};
  element.querySelector('[data-field="module_profession_name"]').oninput=event=>{if(!element.querySelector('[data-field="module_profession_key"]').dataset.touched)element.querySelector('[data-field="module_profession_key"]').value=technicalKey(event.target.value,"metier");element.querySelector("summary strong").textContent=`📜 ${event.target.value||"Nouveau métier"}`;refreshActivityProfessionOptions();};
  element.querySelector('[data-field="module_profession_key"]').oninput=event=>{event.target.dataset.touched="true";element.querySelector("summary small").textContent=event.target.value||"à configurer";refreshActivityProfessionOptions();};
}

function refreshActivityProfessionOptions(){
  $$("#activity-modules .activity-module").forEach(element=>{const field=element.querySelector('[data-field="module_activity_profession"]'),value=field.value;field.innerHTML=professionOptions(value).map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===value?"selected":""}>${escapeHtml(label)}</option>`).join("");});
}

function addActivityModule(activity={}) {
  const element=document.createElement("details");element.className="builder activity-module";element.open=!activity.key;element.dataset.original=JSON.stringify(activity);
  const limit=activity.activity_limit||{scope:"building",max_active:1,category:activity.profession||""};
  const hooks=activity.hooks||{};const hookEvent=name=>(Array.isArray(hooks[name])?hooks[name][0]:hooks[name])?.event||"";
  element.innerHTML=`<summary><strong>${escapeHtml(activity.emoji||"🗺️")} ${escapeHtml(activity.name||"Nouvelle zone")}</strong><small>${escapeHtml(activity.profession||"métier à choisir")}</small></summary><div class="module-content"><button type="button" class="remove">×</button><div class="form-grid">${input("Nom de la zone","module_activity_name",activity.name||"")}${input("Identifiant","module_activity_key",activity.key||"")}${input("Emoji","module_activity_emoji",activity.emoji||"🗺️")}${select("Métier","module_activity_profession",activity.profession||"",professionOptions(activity.profession||""))}${select("Outil requis","module_activity_tool",activity.tool||"",catalogOptions("item",activity.tool||""))}${input("Niveau requis","module_activity_level",activity.required_level||1,"number","min=1")}${input("Durée (secondes)","module_activity_duration",activity.duration_seconds||0,"number","min=0")}${input("Coût en énergie","module_activity_energy",activity.energy_cost||0,"number","min=0")}${input("Usure de l’outil","module_activity_durability",activity.durability_cost||0,"number","min=0")}${input("Durabilité minimale","module_activity_min_durability",activity.minimum_durability??activity.durability_cost??0,"number","min=0")}${input("Durabilité maximale initiale","module_activity_max_durability",activity.tool_max_durability||80,"number","min=1")}${select("Limite des activités","module_activity_scope",limit.scope||"player_building",[["player","Toutes mes activités"],["player_building","Dans ce bâtiment"],["player_action","Pour cette action"],["category","Dans cette catégorie"]])}${input("Maximum simultané","module_activity_max_active",limit.max_active||1,"number","min=1")}${input("Catégorie de limite","module_activity_category",limit.category||activity.profession||"")}${input("Description","module_activity_description",activity.description||"")}</div><details><summary>⚡ Événements de l’activité</summary><div class="form-grid">${select("Au lancement","module_hook_start",hookEvent("on_start"),catalogOptions("event",hookEvent("on_start")))}${select("Après lancement réussi","module_hook_success",hookEvent("on_success"),catalogOptions("event",hookEvent("on_success")))}${select("En cas d’échec","module_hook_failure",hookEvent("on_failure"),catalogOptions("event",hookEvent("on_failure")))}${select("À la récupération","module_hook_claim",hookEvent("on_claim"),catalogOptions("event",hookEvent("on_claim")))}</div></details><div class="section-head"><b>Résultats aléatoires</b><button type="button" class="secondary add-outcome">＋ Ajouter un résultat</button></div><div class="outcome-modules"></div></div>`;
  $("#activity-modules").append(element);(activity.outcomes||[]).forEach(outcome=>addOutcomeModule(element.querySelector(".outcome-modules"),outcome));
  element.querySelector(".add-outcome").onclick=()=>addOutcomeModule(element.querySelector(".outcome-modules"),{effects:[]});element.querySelector(".remove").onclick=()=>element.remove();
}

function addOutcomeModule(container,outcome={}) {
  const element=document.createElement("details");element.className="builder outcome-module";element.open=!outcome.key;element.dataset.original=JSON.stringify(outcome);
  element.innerHTML=`<summary><strong>🎲 ${escapeHtml(outcome.key||"Nouveau résultat")}</strong><small>Poids ${escapeHtml(outcome.weight||1)}</small></summary><div class="module-content"><button type="button" class="remove">×</button><div class="form-grid">${input("Nom technique","module_outcome_key",outcome.key||"")}${input("Poids","module_outcome_weight",outcome.weight||1,"number","min=0.01 step=0.01")}</div><div class="section-head"><b>Effets de ce résultat</b><button type="button" class="secondary add-outcome-effect">＋ Ajouter un effet</button></div><div class="outcome-effects"></div></div>`;
  container.append(element);(outcome.effects||legacyOutcomeEffects(outcome)).forEach(effect=>addOutcomeEffect(element.querySelector(".outcome-effects"),effect));element.querySelector(".add-outcome-effect").onclick=()=>addOutcomeEffect(element.querySelector(".outcome-effects"),{});element.querySelector(".remove").onclick=()=>element.remove();
}

function legacyOutcomeEffects(outcome){return Object.entries(outcome.rewards||{}).map(([resource,amount])=>({type:"reward",resource,amount}));}

function addOutcomeEffect(container,effect={}) {
  const element=document.createElement("div");element.className="builder outcome-effect";element.dataset.original=JSON.stringify(effect);container.append(element);
  const render=()=>{const type=element.querySelector('[data-field="outcome_effect_type"]')?.value||effect.type||"reward";let fields="";
    if(["reward","cost","stock_reward"].includes(type)){const amount=effect.amount??1,min=Array.isArray(amount)?amount[0]:amount,max=Array.isArray(amount)?amount[1]:amount;fields=`${select("Ressource","outcome_effect_resource",effect.resource||effect.item||"",catalogOptions("item",effect.resource||effect.item||""))}${input("Minimum","outcome_effect_min",min,"number")}${input("Maximum","outcome_effect_max",max,"number")}${type==="stock_reward"?select("Stock du bâtiment","outcome_effect_building",effect.building||"",catalogOptions("building",effect.building||"")):""}`;}
    else if(type==="message")fields=input("Message","outcome_effect_text",effect.text||"");
    else if(type==="profession")fields=`${select("Métier","outcome_effect_profession",effect.profession||"",professionOptions(effect.profession||""))}${input("Expérience","outcome_effect_experience",effect.experience||0,"number")}${input("XP par niveau","outcome_effect_xp_level",effect.experience_per_level||100,"number")}`;
    else if(type==="emit")fields=`${select("Événement","outcome_effect_event",effect.event||"",catalogOptions("event",effect.event||""))}`;
    else fields=`${input("État à modifier","outcome_effect_state",effect.key||"")}${select("Opération","outcome_effect_operation",effect.operation||"set",[["set","Définir"],["increment","Ajouter"]])}${input("Valeur","outcome_effect_value",effect.value??1,"number")}`;
    element.innerHTML=`<button type="button" class="remove">×</button><div class="outcome-effect-grid">${select("Type","outcome_effect_type",type,[["reward","Donner au joueur"],["stock_reward","Ajouter au stock d’un bâtiment"],["cost","Retirer au joueur"],["message","Afficher un message"],["profession","Donner de l’expérience"],["emit","Envoyer un événement"],["state","Modifier un état"]])}${fields}</div>`;element.querySelector('[data-field="outcome_effect_type"]').onchange=event=>{effect={type:event.target.value};render();};element.querySelector(".remove").onclick=()=>element.remove();};render();
}

function addAction(action={}) {
  const container = $("#actions");
  const element = document.createElement("details");
  element.className = "builder action-builder";
  element.open = !action.key;
  const number = container.children.length + 1;
  const conditionGroup=action.conditions?.any?"any":"all";const hooks=action.hooks||{};const hookEvent=name=>(Array.isArray(hooks[name])?hooks[name][0]:hooks[name])?.event||"";
  element.innerHTML = `<summary><span class="action-number">Action ${number}</span><strong data-action-summary>${escapeHtml(action.emoji||"⚙️")} ${escapeHtml(action.name||"Nouvelle action")}</strong><small data-action-key-summary>${escapeHtml(action.key||"à configurer")}</small></summary><div class="action-configuration"><button type="button" class="remove" aria-label="Supprimer cette action">×</button><div class="form-grid">${input("Nom du bouton","action_name",action.name||"")}${input("Symbole","action_emoji",action.emoji||"")}</div><div class="checks">${check("Disponible pour les joueurs","action_enabled",action.enabled!==false)}</div><div class="section-head"><b>Conditions d’accès</b><button type="button" class="secondary add-condition">＋ Ajouter</button></div><div class="form-grid">${select("Combinaison","condition_group",conditionGroup,[["all","Toutes les conditions"],["any","Au moins une condition"]])}</div><div class="condition-editors"></div><div class="section-head"><b>Résultats</b><button type="button" class="secondary add-inner">＋ Ajouter</button></div><div class="action-effects"></div><details><summary>⚡ Événements</summary><div class="form-grid">${select("Au lancement","action_hook_start",hookEvent("on_start"),catalogOptions("event",hookEvent("on_start")))}${select("Après réussite","action_hook_success",hookEvent("on_success"),catalogOptions("event",hookEvent("on_success")))}${select("En cas d’échec","action_hook_failure",hookEvent("on_failure"),catalogOptions("event",hookEvent("on_failure")))}${select("À la récupération","action_hook_claim",hookEvent("on_claim"),catalogOptions("event",hookEvent("on_claim")))}</div></details><details class="advanced"><summary>Identifiant technique</summary><div class="advanced-content">${input("Identifiant","action_key",action.key||"")}</div></details></div>`;
  container.append(element);
  element.dataset.originalAction = JSON.stringify(action);
  (action.effects||[]).forEach(effect => addEffect(element.querySelector(".action-effects"),effect));
  const conditionRoot=action.conditions||{};const conditions=conditionRoot.all||conditionRoot.any||(Object.keys(conditionRoot).length?[conditionRoot]:[]);conditions.forEach(condition=>addConditionEditor(element.querySelector(".condition-editors"),condition));
  element.querySelector(".add-condition").onclick=()=>addConditionEditor(element.querySelector(".condition-editors"),{});
  element.querySelector(".add-inner").onclick = () => { addEffect(element.querySelector(".action-effects"),{}); setHelp("effects"); };
  element.querySelector(".add-inner").dataset.help = "effects";
  element.querySelector(".remove").onclick = () => element.remove();
  const nameField = element.querySelector('[data-field="action_name"]');
  const keyField = element.querySelector('[data-field="action_key"]');
  const emojiField=element.querySelector('[data-field="action_emoji"]'),summary=element.querySelector('[data-action-summary]'),keySummary=element.querySelector('[data-action-key-summary]');
  const refreshSummary=()=>{summary.textContent=`${emojiField.value||"⚙️"} ${nameField.value||"Nouvelle action"}`;keySummary.textContent=keyField.value||"à configurer";};
  nameField.addEventListener("input", () => { if (!keyField.dataset.touched) keyField.value = technicalKey(nameField.value,"action"); refreshSummary(); });
  emojiField.addEventListener("input",refreshSummary);
  keyField.addEventListener("input", () => {keyField.dataset.touched = "true";refreshSummary();});
}

function addEffect(container, effect={}) {
  const element = document.createElement("div");
  element.className = "builder effect-builder";
  element.dataset.originalEffect = JSON.stringify(effect);
  const resource = effect.resource || effect.event || "";
  element.innerHTML = `<button type="button" class="remove" aria-label="Supprimer ce résultat">×</button><div class="friendly-effect">${select("Résultat","effect_type",effect.type||"message",[["message","Afficher un message"],["reward","Donner une ressource"],["cost","Retirer une ressource"],["emit","Déclencher un événement"],["random_reward","Butin aléatoire"],["random_bundle","Butin groupé (module)"],["random_message","Message aléatoire (module)"],["stock_cost","Retirer du stock"],["stock_reward","Ajouter au stock"],["profession","Expérience de métier"],["durability","Usure d’un outil"],["repair","Réparer un outil"],["upgrade","Améliorer un outil"],["schedule","Planifier la récompense"],["claim_scheduled","Récupérer une récompense"]])}<span class="effect-resource-field"></span>${input("Quantité","effect_amount",effect.amount||0,"number")}${input("Message au joueur","effect_text",effect.text||"")}</div>`;
  container.append(element);
  const renderResourceSelector = (value="") => {
    const effectType = fieldValue("effect_type", element);
    if (!["reward", "cost", "emit"].includes(effectType)) {
      element.querySelector(".effect-resource-field").innerHTML = "";
      return;
    }
    const catalogType = effectType === "emit" ? "event" : "item";
    element.querySelector(".effect-resource-field").innerHTML = select(
      catalogType === "item" ? "Ressource ou objet" : "Événement",
      "effect_resource", value, catalogOptions(catalogType, value),
    );
  };
  renderResourceSelector(resource);
  element.querySelector('[data-field="effect_type"]').addEventListener("change", () => renderResourceSelector());
  element.querySelector(".remove").onclick = () => element.remove();
}

function readEffects(container) {
  return [...container.querySelectorAll(":scope > .effect-builder")].map(element => {
    const type = fieldValue("effect_type",element);
    if (["random_reward","random_bundle","random_message","stock_cost","stock_reward","profession","durability","repair","upgrade","schedule","claim_scheduled"].includes(type)) return {...JSON.parse(element.dataset.originalEffect || '{}'),type};
    if (type === "message") return {type,text:fieldValue("effect_text",element)};
    if (type === "emit") return {type,event:fieldValue("effect_resource",element),payload:{}};
    return {type,resource:fieldValue("effect_resource",element),amount:fieldValue("effect_amount",element)};
  });
}

function addConditionEditor(container,source={}) {
  let negated=!!source.not,condition=clone(source.not||source);const element=document.createElement("div");element.className="builder condition-editor";container.append(element);
  const render=()=>{const type=condition.type||"resource";let reference="";
    if(type==="resource")reference=select("Ressource","condition_ref",condition.resource||"",catalogOptions("item",condition.resource||""));
    else if(["item_present","item_absent","building_stock"].includes(type))reference=select("Objet","condition_ref",condition.item||"",catalogOptions("item",condition.item||""));
    else if(["profession_active","profession_level"].includes(type))reference=select("Métier","condition_ref",condition.profession||"",professionOptions(condition.profession||""));
    else if(["tool_present","tool_level","tool_durability"].includes(type))reference=select("Outil","condition_ref",condition.tool||"",catalogOptions("item",condition.tool||""));
    else if(type==="discord_role")reference=input("Nom du rôle Discord","condition_ref",condition.role||"");
    else if(type==="state")reference=input("État ou jauge","condition_ref",condition.key||"");
    const scopes=["no_pending_activity","activity_limit_available"].includes(type)?select("Portée","condition_scope",condition.scope||"player_action",[["player","Joueur"],["player_building","Joueur + bâtiment"],["player_action","Joueur + action"],["category","Catégorie"]]):"";
    element.innerHTML=`<button type="button" class="remove">×</button><div class="condition-grid">${select("Type","condition_type",type,[["resource","Ressource minimale"],["item_present","Objet possédé"],["item_absent","Objet absent"],["profession_active","Métier actif"],["no_active_profession","Aucun métier actif"],["profession_level","Niveau de métier"],["tool_present","Outil possédé"],["tool_level","Niveau d’outil"],["tool_durability","Durabilité minimale"],["voice_presence","Présence vocale"],["discord_role","Rôle Discord"],["no_pending_activity","Aucune activité active"],["activity_limit_available","Limite disponible"],["cooldown_available","Cooldown disponible"],["building_stock","Stock bâtiment"],["state","État joueur"]])}${reference}${select("Opérateur","condition_operator",condition.operator||">=",[["=","="],["!=","≠"],[">",">"] ,[">=","≥"],["<","<"],["<=","≤"]])}${input("Valeur","condition_value",condition.value??1,"number")}${scopes}${check("Inverser (NOT)","condition_not",negated)}</div><div class="reorder"><button type="button" class="secondary move-up">↑</button><button type="button" class="secondary move-down">↓</button></div>`;
    element.querySelector('[data-field="condition_type"]').onchange=event=>{condition={type:event.target.value};render();};element.querySelector(".remove").onclick=()=>element.remove();element.querySelector(".move-up").onclick=()=>element.previousElementSibling&&container.insertBefore(element,element.previousElementSibling);element.querySelector(".move-down").onclick=()=>element.nextElementSibling&&container.insertBefore(element.nextElementSibling,element);
  };render();
}

function readConditions(actionElement){const conditions=[...actionElement.querySelectorAll(".condition-editors > .condition-editor")].map(element=>{const type=fieldValue("condition_type",element),reference=fieldValue("condition_ref",element);const condition={type,operator:fieldValue("condition_operator",element),value:fieldValue("condition_value",element)};if(type==="resource")condition.resource=reference;else if(["item_present","item_absent","building_stock"].includes(type))condition.item=reference;else if(["profession_active","profession_level"].includes(type))condition.profession=reference;else if(["tool_present","tool_level","tool_durability"].includes(type))condition.tool=reference;else if(type==="discord_role")condition.role=reference;else if(type==="state")condition.key=reference;if(fieldValue("condition_scope",element))condition.scope=fieldValue("condition_scope",element);return fieldValue("condition_not",element)?{not:condition}:condition;});return conditions.length?{[fieldValue("condition_group",actionElement)||"all"]:conditions}:undefined;}

function readHooks(element,prefix="action_hook_"){return Object.fromEntries([["on_start","start"],["on_success","success"],["on_failure","failure"],["on_claim","claim"]].map(([hook,suffix])=>[hook,fieldValue(prefix+suffix,element)?[{event:fieldValue(prefix+suffix,element),payload:{}}]:null]).filter(([,value])=>value));}

function addDeliveryModule(rule={}) {
  const element=document.createElement("div");element.className="builder delivery-module";element.dataset.original=JSON.stringify(rule);
  const events=rule.events||{};element.innerHTML=`<button type="button" class="remove">×</button><div class="form-grid">${select("Ressource","delivery_resource",rule.item_key||rule.resource||"",catalogOptions("item",rule.item_key||rule.resource||""))}${select("Source","delivery_source",rule.source||"player_inventory",[["player_inventory","Inventaire du joueur"]])}${select("Destination","delivery_destination",rule.destination||"building_stock",[["building_stock","Stock d’un bâtiment"],["player_inventory","Inventaire joueur"]])}${select("Bâtiment destinataire","delivery_building",rule.target_building_key||rule.building||"",catalogOptions("building",rule.target_building_key||rule.building||""))}${input("Quantité minimale","delivery_min",rule.minimum_quantity??1,"number","min=1")}${input("Quantité maximale (0 = aucune)","delivery_max",rule.maximum_quantity??0,"number","min=0")}${input("Prix par unité","delivery_price",rule.unit_price??0,"number","min=0")}${select("Monnaie de paiement","delivery_currency",rule.payment_resource||rule.currency||"money",catalogOptions("item",rule.payment_resource||rule.currency||"money"))}${select("Événement au début","delivery_event_start",events.on_start?.event||"",catalogOptions("event",events.on_start?.event||""))}${select("Événement après livraison","delivery_event_success",events.on_success?.event||"",catalogOptions("event",events.on_success?.event||""))}${select("Événement en cas d’échec","delivery_event_failure",events.on_failure?.event||"",catalogOptions("event",events.on_failure?.event||""))}</div>`;
  element.insertAdjacentHTML("beforeend",`<div class="section-head"><b>Conditions</b><button type="button" class="secondary add-delivery-condition">＋ Ajouter</button></div>${select("Combinaison","condition_group",rule.conditions?.any?"any":"all",[["all","Toutes les conditions"],["any","Au moins une condition"]])}<div class="condition-editors"></div>`);
  $("#delivery-modules").append(element);const conditionRoot=rule.conditions||{},conditions=conditionRoot.all||conditionRoot.any||(Object.keys(conditionRoot).length?[conditionRoot]:[]);conditions.forEach(condition=>addConditionEditor(element.querySelector(".condition-editors"),condition));element.querySelector(".add-delivery-condition").onclick=()=>addConditionEditor(element.querySelector(".condition-editors"),{});element.querySelector(".remove").onclick=()=>element.remove();
}

function readDeliveryModules(){return $$("#delivery-modules > .delivery-module").map(element=>{const maximum=fieldValue("delivery_max",element),events={},conditions=readConditions(element);[["on_start","delivery_event_start"],["on_success","delivery_event_success"],["on_failure","delivery_event_failure"]].forEach(([key,field])=>{if(fieldValue(field,element))events[key]={event:fieldValue(field,element),payload:{}};});return {...JSON.parse(element.dataset.original||"{}"),item_key:fieldValue("delivery_resource",element),source:fieldValue("delivery_source",element),destination:fieldValue("delivery_destination",element),target_building_key:fieldValue("delivery_building",element),minimum_quantity:fieldValue("delivery_min",element),maximum_quantity:maximum>0?maximum:null,unit_price:fieldValue("delivery_price",element),payment_resource:fieldValue("delivery_currency",element)||"money",events,conditions};});}

function readProfessionModules() {
  return $$("#profession-modules > .profession-module").map((element,index)=>({
    ...JSON.parse(element.dataset.original||"{}"),
    key:fieldValue("module_profession_key",element)||technicalKey(fieldValue("module_profession_name",element),`metier_${index+1}`),
    name:fieldValue("module_profession_name",element),emoji:fieldValue("module_profession_emoji",element),
    required_item:fieldValue("module_profession_item",element)||undefined,
    grant_required_item:fieldValue("module_profession_grant",element),
    tool_level:fieldValue("module_profession_tool_level",element),initial_durability:fieldValue("module_profession_initial_durability",element),max_durability:fieldValue("module_profession_max_durability",element),
  }));
}

function readOutcomeEffects(container) {
  return [...container.querySelectorAll(":scope > .outcome-effect")].map(element=>{
    const type=fieldValue("outcome_effect_type",element);
    if(["reward","cost","stock_reward"].includes(type)){
      const minimum=fieldValue("outcome_effect_min",element),maximum=fieldValue("outcome_effect_max",element);
      const amount=minimum===maximum?minimum:[minimum,maximum];
      if(type==="stock_reward")return {type,item:fieldValue("outcome_effect_resource",element),building:fieldValue("outcome_effect_building",element),amount};
      return {type,resource:fieldValue("outcome_effect_resource",element),amount};
    }
    if(type==="message")return {type,text:fieldValue("outcome_effect_text",element)};
    if(type==="profession")return {type,profession:fieldValue("outcome_effect_profession",element),experience:fieldValue("outcome_effect_experience",element),experience_per_level:fieldValue("outcome_effect_xp_level",element)};
    if(type==="emit")return {type,event:fieldValue("outcome_effect_event",element),payload:JSON.parse(element.dataset.original||"{}").payload||{}};
    return {type:"state",key:fieldValue("outcome_effect_state",element),operation:fieldValue("outcome_effect_operation",element),value:fieldValue("outcome_effect_value",element)};
  });
}

function readActivityModules() {
  return $$("#activity-modules > .activity-module").map((element,index)=>({
    ...JSON.parse(element.dataset.original||"{}"),
    key:fieldValue("module_activity_key",element)||technicalKey(fieldValue("module_activity_name",element),`zone_${index+1}`),
    name:fieldValue("module_activity_name",element),emoji:fieldValue("module_activity_emoji",element),description:fieldValue("module_activity_description",element),
    profession:fieldValue("module_activity_profession",element),tool:fieldValue("module_activity_tool",element)||undefined,
    required_level:fieldValue("module_activity_level",element),duration_seconds:fieldValue("module_activity_duration",element),energy_cost:fieldValue("module_activity_energy",element),
    durability_cost:fieldValue("module_activity_durability",element),minimum_durability:fieldValue("module_activity_min_durability",element),tool_max_durability:fieldValue("module_activity_max_durability",element),
    activity_limit:{scope:fieldValue("module_activity_scope",element),max_active:fieldValue("module_activity_max_active",element),category:fieldValue("module_activity_category",element)},
    hooks:Object.fromEntries([["on_start","module_hook_start"],["on_success","module_hook_success"],["on_failure","module_hook_failure"],["on_claim","module_hook_claim"]].map(([hook,field])=>[hook,fieldValue(field,element)?[{event:fieldValue(field,element),payload:{}}]:null]).filter(([,value])=>value)),
    outcomes:[...element.querySelectorAll(":scope > .module-content > .outcome-modules > .outcome-module")].map((outcome,outcomeIndex)=>({
      key:fieldValue("module_outcome_key",outcome)||`result_${outcomeIndex+1}`,weight:Number(fieldValue("module_outcome_weight",outcome)),
      effects:readOutcomeEffects(outcome.querySelector(".outcome-effects")),
    })),
  }));
}

function buildPayload() {
  const payload = state.type === "building" ? clone(state.buildingBase || {}) : state.type === "interface" ? clone(state.interfaceDraft || {}) : {};
  Object.assign(payload,{name:$("#name").value.trim(),emoji:$("#emoji").value.trim(),description:$("#description").value.trim()});
  if (state.type === "building") {
    let modules = {};
    try { modules = JSON.parse(fieldValue("modules_json") || "{}"); }
    catch (_) { throw Error("La configuration modulaire contient un JSON invalide."); }
    modules.professions=readProfessionModules();
    modules.activities=readActivityModules();
    modules.deliveries=readDeliveryModules();
    modules.delivery_mode=fieldValue("delivery_all")?"all_available":"selected_quantity";
    const buildingKey=$("#key").value.trim();
    const previousTarget=state.interfaceDraft?.target_building_key;
    const interfaceDefinition=clone(state.interfaceDraft||blankInterface(buildingKey,payload.name,payload.emoji,payload.color));
    if(!state.editing||state.duplicate)interfaceDefinition.name=`Interface - ${payload.name}`;
    else interfaceDefinition.name ||= `Interface - ${payload.name}`;
    interfaceDefinition.target_building_key=buildingKey;
    interfaceDefinition.theme||={};interfaceDefinition.theme.color=fieldValue("color")||interfaceDefinition.theme.color||"7a1f1f";
    interfaceDefinition.pages.forEach(page=>page.components.forEach(component=>{
      if(component.interaction?.type==="action"&&(!component.interaction.building||component.interaction.building===previousTarget))component.interaction.building=buildingKey;
      (component.options||[]).forEach((option,index)=>{option.key=technicalKey(option.key||option.label||`option_${index+1}`,`option_${index+1}`);if(option.interaction?.type==="action"&&(!option.interaction.building||option.interaction.building===previousTarget))option.interaction.building=buildingKey;});
    }));
    Object.assign(payload,{building_kind:state.selectedPreset||state.editing?.payload?.building_kind||"custom",color:fieldValue("color")||"7c5cff",npc_name:fieldValue("npc_name")||"",action_mode:fieldValue("action_mode")||"manual",modules,interface:interfaceDefinition,access:{visible:fieldValue("building_visible")!==false,required_roles:(fieldValue("required_roles")||"").split(",").map(value=>value.trim()).filter(Boolean),temporary_text:fieldValue("temporary_text")!==false},actions:$$('#actions > .action-builder').map((element,index)=>{const action={...JSON.parse(element.dataset.originalAction||"{}"),key:fieldValue("action_key",element)||technicalKey(fieldValue("action_name",element),`action_${index+1}`),name:fieldValue("action_name",element),emoji:fieldValue("action_emoji",element),enabled:fieldValue("action_enabled",element),effects:readEffects(element.querySelector(".action-effects")),hooks:readHooks(element)};const conditions=readConditions(element);if(conditions)action.conditions=conditions;else delete action.conditions;return action;})});
  }
  if (state.type === "item") Object.assign(payload,{category:fieldValue("category"),type:fieldValue("type"),rarity:fieldValue("rarity"),price:fieldValue("price"),stack_limit:fieldValue("stack_limit"),stackable:fieldValue("stackable"),consumable:fieldValue("consumable"),sellable:fieldValue("sellable")});
  if (state.type === "event") Object.assign(payload,{trigger:{type:fieldValue("trigger_type"),value:fieldValue("trigger_value")},starts_at:fieldValue("starts_at")||null,ends_at:fieldValue("ends_at")||null,priority:fieldValue("priority"),enabled:fieldValue("enabled"),effects:readEffects($("#effects"))});
  if (state.type === "bot") Object.assign(payload,{bot_type:fieldValue("bot_type"),application_id_env:fieldValue("application_id_env"),token_env:fieldValue("token_env"),guild_id:fieldValue("guild_id"),presence:fieldValue("presence"),enabled:fieldValue("enabled"),auto_join:fieldValue("auto_join"),voice_channel_id:fieldValue("voice_channel_id")||"0",voice_channel_env:fieldValue("voice_channel_env"),building_key:fieldValue("building_key"),leave_delay:fieldValue("leave_delay"),welcome_folder:fieldValue("welcome_folder"),music_folder:fieldValue("music_folder"),ambience_folder:fieldValue("ambience_folder"),phrase_folder:fieldValue("phrase_folder"),volume:{voice:fieldValue("volume_voice"),music:fieldValue("volume_music"),ambience:fieldValue("volume_ambience"),sfx:fieldValue("volume_sfx")}});
  if (state.type === "audio") Object.assign(payload,{source:fieldValue("source"),triggers:(fieldValue("triggers")||"").split(",").map(value=>value.trim()).filter(Boolean),channel:fieldValue("channel"),volume:fieldValue("volume"),loop:fieldValue("loop")});
  return payload;
}

async function publishItem(key, version) {
  const response = await fetch(`/api/content/${state.type}/${key}/${version}/publish`,{method:"POST",headers,body:"{}"});
  if (!response.ok) alert((await response.json()).detail);
  await loadCatalogs(); await load();
}

function closeEditor() { resetEditor(); $("#editor").hidden=true; document.body.classList.remove("modal-open"); }

function metricCard(label,value,detail="") { return `<article class="admin-metric"><span>${label}</span><strong>${escapeHtml(value)}</strong>${detail?`<small>${escapeHtml(detail)}</small>`:""}</article>`; }
function inventoryChips(inventory) { const entries=Object.entries(inventory||{});return entries.length?`<div class="inventory-chips">${entries.map(([item,quantity])=>`<span class="inventory-chip">${escapeHtml(item)} × ${quantity}</span>`).join("")}</div>`:"<span class=\"empty-admin\">Vide</span>"; }
function adminTable(headersList,rows) { return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headersList.map(item=>`<th>${item}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`; }
function formatDate(value) { if(!value)return "—";try{return new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"medium"}).format(new Date(value));}catch(_){return value;} }

function renderAdministration(data) {
  const metrics=data.metrics;
  const services=data.services.map(service=>`<article class="service-card"><div class="service-title"><strong>${service.emoji} ${escapeHtml(service.name)}</strong><span class="status-pill ${service.running?"running":""}">${service.running?"EN LIGNE":"ARRÊTÉ"}</span></div><div class="service-meta">${service.pid?`PID ${service.pid}`:"Aucun processus"}${service.started_at?` · ${formatDate(service.started_at)}`:""}</div>${service.controllable?`<div class="service-actions"><button data-service="${service.key}" data-operation="start" ${service.running?"disabled":""}>Démarrer</button><button data-service="${service.key}" data-operation="restart" ${!service.running?"disabled":""}>Redémarrer</button><button data-service="${service.key}" data-operation="stop" ${!service.running?"disabled":""}>Arrêter</button></div>`:"<small>Service hôte — contrôle local uniquement</small>"}</article>`).join("");
  const buildings=adminTable(["Bâtiment","Publication","Interface","Actions","Tâches","Stock"],data.buildings.map(building=>`<tr><td><b>${building.emoji} ${escapeHtml(building.name)}</b><br><small>${building.key} · v${building.version}</small></td><td><span class="status-pill ${building.status}">${building.status.toUpperCase()}</span></td><td>${building.pages} page(s)</td><td>${building.actions}</td><td>${building.pending}</td><td><details><summary>${building.stock_total} unité(s)</summary>${inventoryChips(building.stock)}</details></td></tr>`));
  const players=adminTable(["Joueur Discord","Économie","Métiers","Inventaire","Dernière activité"],data.players.map(player=>`<tr><td><b>${escapeHtml(player.discord_id)}</b></td><td>💰 ${player.money}<br>⚡ ${player.energy}</td><td>${player.professions.length?player.professions.map(job=>`${escapeHtml(job.key)} niv. ${job.level} (${job.experience} XP)`).join("<br>"):"—"}</td><td>${inventoryChips(player.inventory)}</td><td>${formatDate(player.updated_at)}</td></tr>`));
  const activity=adminTable(["Date","Joueur","Bâtiment","Action"],data.activity.map(item=>`<tr><td>${formatDate(item.created_at)}</td><td>${escapeHtml(item.discord_id)}</td><td>${escapeHtml(item.building_key)}</td><td>${escapeHtml(item.action_key)}</td></tr>`));
  $("#admin-view").innerHTML=`<div class="admin-grid"><section class="admin-metrics">${metricCard("SERVICES",`${metrics.running_services}/${data.services.length}`,"en ligne")}${metricCard("BÂTIMENTS",metrics.published_buildings,`${metrics.buildings} définitions`)}${metricCard("JOUEURS",metrics.players)}${metricCard("TÂCHES EN COURS",metrics.pending_jobs)}${metricCard("BASE",`${Math.max(1,Math.round(data.database.size_bytes/1024))} Ko`)}</section><section class="admin-section"><div class="admin-section-head"><h2>Statut des services</h2><small>Actualisation automatique toutes les 5 secondes</small></div><div class="service-grid">${services}</div></section><section class="admin-section"><div class="admin-section-head"><h2>État des bâtiments</h2><small>Publication, interfaces, actions et stocks</small></div>${buildings}</section><div class="admin-split"><section class="admin-section"><div class="admin-section-head"><h2>Joueurs et inventaires</h2><small>${data.players.length} joueur(s)</small></div>${players}</section><section class="admin-section"><div class="admin-section-head"><h2>Activité récente</h2><small>30 dernières actions</small></div>${activity}</section></div></div>`;
}

function showSystemView() {
  $("#content-stats").hidden=true;$("#content-workspace").hidden=true;$("#admin-view").hidden=false;$("#new").hidden=true;
}

async function fetchOverview(message="Chargement…") {
  showSystemView();$("#admin-view").innerHTML=`<div class="empty-admin"><span class="refresh-spin">⟳</span> ${message}</div>`;
  const response=await fetch("/api/admin/overview",{headers});
  if(!response.ok){$("#admin-view").innerHTML=`<div class="empty-admin">Données indisponibles : ${escapeHtml((await response.json()).detail||response.status)}</div>`;return null;}
  return response.json();
}

async function loadDashboard() {
  const data=await fetchOverview("Préparation du tableau de bord…");if(!data)return;
  const metrics=data.metrics;
  const services=data.services.map(service=>`<article class="service-card"><div class="service-title"><strong>${service.emoji} ${escapeHtml(service.name)}</strong><span class="status-pill ${service.running?"running":""}">${service.running?"EN LIGNE":"ARRÊTÉ"}</span></div><div class="service-meta">${service.pid?`PID ${service.pid}`:"Aucun processus"}</div></article>`).join("");
  const activity=data.activity.slice(0,10).map(item=>`<li><span>${formatDate(item.created_at)}</span><b>${escapeHtml(item.action_key)}</b><small>${escapeHtml(item.building_key)} · joueur ${escapeHtml(item.discord_id)}</small></li>`).join("")||"<li class='empty-admin'>Aucune action récente.</li>";
  const events=data.events.map(event=>`<article class="event-card"><span>${event.emoji}</span><div><b>${escapeHtml(event.name)}</b><small>${escapeHtml(event.trigger)} · ${event.status}${event.enabled?"":" · désactivé"}</small></div></article>`).join("")||"<p class='empty-admin'>Aucun événement configuré.</p>";
  $("#admin-view").innerHTML=`<div class="admin-grid"><section class="admin-metrics">${metricCard("SERVICES",`${metrics.running_services}/${data.services.length}`,"en ligne")}${metricCard("BÂTIMENTS",metrics.published_buildings,`${metrics.buildings} configurés`)}${metricCard("JOUEURS",metrics.players)}${metricCard("ÉVÉNEMENTS",metrics.active_events,"actifs")}${metricCard("TÂCHES",metrics.pending_jobs,"en attente")}</section><div class="quick-actions"><button data-go="building">＋ Créer un bâtiment</button><button data-go="event">⚡ Gérer les événements</button><button data-go="supervision">🛡️ Ouvrir la supervision</button><button data-go="settings">⚙️ Paramétrer le serveur</button></div><div class="admin-split"><section class="admin-section"><div class="admin-section-head"><h2>État du moteur</h2><small>${formatDate(data.generated_at)}</small></div><div class="service-grid">${services}</div></section><section class="admin-section"><div class="admin-section-head"><h2>Événements</h2><small>${data.events.length} configuré(s)</small></div><div class="event-grid">${events}</div></section></div><section class="admin-section"><div class="admin-section-head"><h2>Actions principales récentes</h2><small>Activité du Royaume</small></div><ol class="activity-feed">${activity}</ol></section></div>`;
  bindNavigationShortcuts();
}

async function loadSupervision(background=false) {
  let data;
  if(background){const response=await fetch("/api/admin/overview",{headers});if(!response.ok)return;data=await response.json();}
  else data=await fetchOverview("Chargement de la supervision détaillée…");
  if(!data)return;renderSupervision(data);
  if(!background){clearInterval(state.adminTimer);state.adminTimer=setInterval(()=>{if(state.type==="supervision")loadSupervision(true);},5000);}
}

function renderSupervision(data) {
  renderAdministration(data);
  const grid=$("#admin-view .admin-grid");
  const logs=Object.entries(data.logs||{}).map(([key,value])=>{const content=[...(value.errors||[]),...(value.output||[])].join("\n")||"Aucun journal disponible. Redémarrez le service pour activer la capture.";return `<details class="log-panel" data-log-key="${escapeHtml(key)}" open><summary>${escapeHtml(key)} · ${(value.errors||[]).length} ligne(s) système</summary><button type="button" class="secondary copy-log" data-copy-log="${escapeHtml(key)}">Copier ce journal</button><pre data-log-content="${escapeHtml(key)}">${escapeHtml(content)}</pre></details>`;}).join("");
  grid.insertAdjacentHTML("beforeend",`<section class="admin-section"><div class="admin-section-head"><h2>Journaux des services</h2><div><small>Actualisation suspendue pendant la lecture</small> <button type="button" class="secondary" id="refresh-logs">Actualiser</button></div></div><div class="logs-grid">${logs}</div></section>`);
  const panels=[...grid.children].slice(1);
  const panelKeys=["services","buildings","players","logs"];
  panels.forEach((panel,index)=>{panel.dataset.supervisionPanel=panelKeys[index];panel.hidden=state.supervisionTab!==panelKeys[index];});
  grid.children[0].insertAdjacentHTML("afterend",`<nav class="section-tabs" aria-label="Sections de supervision"><button data-supervision-tab="overview" class="${state.supervisionTab==="overview"?"active":""}">Vue générale</button><button data-supervision-tab="services" class="${state.supervisionTab==="services"?"active":""}">Services</button><button data-supervision-tab="buildings" class="${state.supervisionTab==="buildings"?"active":""}">Bâtiments</button><button data-supervision-tab="players" class="${state.supervisionTab==="players"?"active":""}">Joueurs & activité</button><button data-supervision-tab="logs" class="${state.supervisionTab==="logs"?"active":""}">Journaux</button></nav>`);
  $$('[data-supervision-tab]').forEach(button=>button.onclick=()=>{state.supervisionTab=button.dataset.supervisionTab;$$('[data-supervision-tab]').forEach(item=>item.classList.toggle("active",item===button));$$('[data-supervision-panel]').forEach(panel=>panel.hidden=panel.dataset.supervisionPanel!==state.supervisionTab);if(state.supervisionTab==="logs"){clearInterval(state.adminTimer);state.adminTimer=null;}else if(!state.adminTimer)state.adminTimer=setInterval(()=>{if(state.type==="supervision")loadSupervision(true);},5000);});
  $$('[data-service]').forEach(button=>button.onclick=async()=>{button.disabled=true;button.textContent="…";const response=await fetch(`/api/admin/services/${button.dataset.service}/${button.dataset.operation}`,{method:"POST",headers,body:"{}"});if(!response.ok)alert((await response.json()).detail);await loadSupervision(true);});
  $("#refresh-logs").onclick=()=>loadSupervision(true);
  $$('.copy-log').forEach(button=>button.onclick=async()=>{const content=$(`[data-log-content="${button.dataset.copyLog}"]`)?.textContent||"";await navigator.clipboard.writeText(content);button.textContent="Copié !";setTimeout(()=>button.textContent="Copier ce journal",1200);});
}

const settingField=(label,path,value,type="text")=>`<label>${label}<input data-setting="${path}" type="${type}" value="${escapeHtml(value??"")}"></label>`;
const settingArea=(label,path,value)=>`<label>${label}<textarea data-setting="${path}" rows="8">${escapeHtml(value||"")}</textarea></label>`;
const settingCheck=(label,path,value)=>`<label class="check"><input data-setting="${path}" type="checkbox" ${value?"checked":""}><span>${label}</span></label>`;

async function loadSettings(){
  showSystemView();$("#admin-view").innerHTML=`<div class="empty-admin"><span class="refresh-spin">⟳</span> Chargement des paramètres…</div>`;
  const response=await fetch("/api/server/settings",{headers});if(!response.ok){$("#admin-view").innerHTML=`<div class="empty-admin">Paramètres indisponibles.</div>`;return;}
  state.settingsEntity=await response.json();renderSettings(state.settingsEntity.payload);
}

function renderSettings(settings){
  const onboarding=settings.onboarding,roles=settings.roles,discord=settings.discord,theme=settings.theme;
  $("#admin-view").innerHTML=`<div class="settings-layout"><section class="admin-section settings-hero"><div><small>CONFIGURATION CENTRALE</small><h2>Le Royaume, depuis un seul endroit</h2><p>Les valeurs publiées sont utilisées par KingdomCore et par le provisionnement Discord.</p></div><button type="button" class="primary" id="save-settings">Enregistrer et publier</button></section><section class="settings-shortcuts"><button data-go="building">🏰 Interfaces des bâtiments</button><button data-go="item">🎒 Objets</button><button data-go="event">⚡ Événements</button><button data-go="bot">🤖 Bots</button><button data-go="audio">🔊 Voix & audio</button></section><nav class="section-tabs" aria-label="Sections des paramètres"><button data-settings-tab="onboarding" class="${state.settingsTab==="onboarding"?"active":""}">Serment</button><button data-settings-tab="roles" class="${state.settingsTab==="roles"?"active":""}">Rôles & couleurs</button><button data-settings-tab="discord" class="${state.settingsTab==="discord"?"active":""}">Organisation Discord</button><button data-settings-tab="access" class="${state.settingsTab==="access"?"active":""}">Entrée des bâtiments</button></nav><div class="settings-grid"><section class="admin-section settings-card" data-settings-panel="onboarding"><h3>🛠️ Serment de la Sainte Pelle</h3>${settingCheck("Activer le serment à l'arrivée","onboarding.enabled",onboarding.enabled)}${settingField("Salon du serment","onboarding.channel_name",onboarding.channel_name)}${settingField("Titre","onboarding.title",onboarding.title)}${settingArea("Règles du serveur","onboarding.rules_text",onboarding.rules_text)}${settingField("Libellé du bouton","onboarding.button_label",onboarding.button_label)}${settingField("Emoji du bouton","onboarding.button_emoji",onboarding.button_emoji)}${settingField("Confirmation","onboarding.confirmation",onboarding.confirmation)}</section><section class="admin-section settings-card" data-settings-panel="roles"><h3>👥 Rôles Discord</h3>${settingField("Maître du Royaume","roles.game_master",roles.game_master)}${settingField("Joueur après serment","roles.player",roles.player)}${settingField("Bots du Royaume","roles.bot",roles.bot)}<p class="field-note">Le rôle joueur n'est accordé qu'après le serment.</p><h3>🎨 Couleurs</h3>${settingField("Couleur principale","theme.primary_color",theme.primary_color)}${settingField("Accent","theme.accent_color",theme.accent_color)}</section><section class="admin-section settings-card" data-settings-panel="discord"><h3>🏰 Organisation Discord</h3>${settingField("Catégorie générale","discord.general_category",discord.general_category)}${settingField("Modèle des catégories bâtiment","discord.building_category_template",discord.building_category_template)}${settingField("Salon d'accueil","discord.welcome_channel",discord.welcome_channel)}${settingField("Salon des commandes","discord.commands_channel",discord.commands_channel)}${settingField("Salon d'administration","discord.administration_channel",discord.administration_channel)}${settingField("Salon texte d'un bâtiment","discord.building_text_channel",discord.building_text_channel)}${settingField("Salon vocal d'un bâtiment","discord.building_voice_channel_template",discord.building_voice_channel_template)}</section><section class="admin-section settings-card" data-settings-panel="access"><h3>🚪 Entrée dans les bâtiments</h3>${settingCheck("Accès textuel seulement pendant la présence vocale","discord.temporary_text_access",discord.temporary_text_access)}${settingCheck("Publier le message d'entrée","discord.entry_message_enabled",discord.entry_message_enabled)}${settingArea("Message d'entrée","discord.entry_message",discord.entry_message)}<p class="field-note">Variables disponibles : {player}, {building}, {key}. Après une modification de structure, relancez le provisionnement Discord.</p></section></div></div>`;
  $$('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==state.settingsTab);
  $$('[data-settings-tab]').forEach(button=>button.onclick=()=>{state.settingsTab=button.dataset.settingsTab;$$('[data-settings-tab]').forEach(item=>item.classList.toggle("active",item===button));$$('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==state.settingsTab);});
  bindNavigationShortcuts();$("#save-settings").onclick=saveSettings;
}

function setNested(target,path,value){const parts=path.split(".");const last=parts.pop();const parent=parts.reduce((current,key)=>current[key]||={},target);parent[last]=value;}
async function saveSettings(){
  const button=$("#save-settings"),payload=clone(state.settingsEntity.payload);$$('[data-setting]').forEach(field=>setNested(payload,field.dataset.setting,field.type==="checkbox"?field.checked:field.value));button.disabled=true;button.textContent="Publication…";
  const response=await fetch("/api/server/settings",{method:"POST",headers,body:JSON.stringify({payload,expected_version:state.settingsEntity.version})});const data=await response.json();button.disabled=false;button.textContent="Enregistrer et publier";if(!response.ok){alert(data.detail);return;}state.settingsEntity=data;renderSettings(data.payload);
}

function bindNavigationShortcuts(){$$('[data-go]').forEach(button=>button.onclick=()=>navigateTo(button.dataset.go));}
function navigateTo(type){const button=$(`#nav [data-type="${type}"]`);if(button){const submenu=button.closest('[data-nav-submenu]');if(submenu)openNavigationGroup(submenu.dataset.navSubmenu);button.click();}}

function openNavigationGroup(group){
  $$('[data-nav-submenu]').forEach(menu=>{const open=menu.dataset.navSubmenu===group;menu.hidden=!open;const trigger=$(`[data-nav-group="${menu.dataset.navSubmenu}"]`);trigger?.setAttribute("aria-expanded",String(open));});
}

function activateNavigation(button){
  const parent=button.closest('[data-nav-submenu]');
  if(parent)openNavigationGroup(parent.dataset.navSubmenu);
  else{$$('[data-nav-submenu]').forEach(menu=>menu.hidden=true);$$('[data-nav-group]').forEach(item=>item.setAttribute("aria-expanded","false"));}
  $$('#nav [data-type]').forEach(item=>item.classList.toggle("active",item===button));
  $$('#nav [data-nav-group]').forEach(item=>item.classList.toggle("active",parent?.dataset.navSubmenu===item.dataset.navGroup));
}

$("#cards").addEventListener("click", async event => {
  const invite = event.target.closest("[data-invite]");
  if (invite) { event.stopPropagation(); const response=await fetch(`/api/bots/${invite.dataset.invite}/invite`,{headers}); const data=await response.json(); if(!response.ok){alert(data.detail);return;} window.open(data.url,"_blank","noopener"); return; }
  const duplicate = event.target.closest("[data-duplicate]");
  if (duplicate) { event.stopPropagation(); const entity=state.items.find(item=>item.entity_key===duplicate.dataset.duplicate); if(entity)openEditor(entity,true); return; }
  const publish = event.target.closest("[data-publish]");
  if (publish) { event.stopPropagation(); await publishItem(publish.dataset.publish,Number(publish.dataset.version)); return; }
  const remove = event.target.closest("[data-delete]");
  if (remove) {
    event.stopPropagation();
    const entity=state.items.find(item=>item.entity_key===remove.dataset.delete);
    if(!entity||!confirm(`Supprimer « ${entity.payload.name} » ?\n\nCette définition disparaîtra du Studio, mais son historique restera conservé.`))return;
    const response=await fetch(`/api/content/${state.type}/${remove.dataset.delete}`,{method:"DELETE",headers});
    if(!response.ok){alert((await response.json()).detail);return;}
    await loadCatalogs(); await load(); return;
  }
  const target = event.target.closest("[data-edit],[data-open]");
  if (target) { const key=target.dataset.edit||target.dataset.open; const entity=state.items.find(item=>item.entity_key===key); if(entity)openEditor(entity); }
});

$("#cards").addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)){const card=event.target.closest("[data-open]");if(card){event.preventDefault();const entity=state.items.find(item=>item.entity_key===card.dataset.open);if(entity)openEditor(entity);}}});
$("#editor").addEventListener("focusin", event => { const key=event.target.dataset.help; if(key)setHelp(key); });
$("#editor").addEventListener("mouseover", event => { const target=event.target.closest("[data-help]"); if(target)setHelp(target.dataset.help); });
$("#name").addEventListener("input", () => {
  if (!state.editing && !state.keyTouched) $("#key").value = technicalKey($("#name").value,state.type==="building"?"batiment":state.type);
  if(state.type==="building"&&state.interfaceDraft){const previous=state.interfaceDraft.target_building_key,current=$("#key").value;state.interfaceDraft.target_building_key=current;state.interfaceDraft.pages.forEach(page=>page.components.forEach(component=>{if(component.interaction?.type==="action"&&component.interaction.building===previous)component.interaction.building=current;(component.options||[]).forEach(option=>{if(option.interaction?.type==="action"&&option.interaction.building===previous)option.interaction.building=current;});}));}
});
$("#key").addEventListener("input", () => state.keyTouched = true);
$("#wizard-back").onclick = () => { if(state.type==="building"){ $("#definition-step").hidden=true; renderPresetPicker(); $("#editor-title").textContent="Quel lieu veux-tu créer ?"; $("#editor-kicker").textContent="ASSISTANT · ÉTAPE 1 SUR 2"; $("#wizard-back").hidden=true; setHelp("preset"); } };
$("#close-editor").onclick=closeEditor; $("#cancel-editor").onclick=closeEditor;
$("#editor-form").onsubmit=event=>event.preventDefault();
$("#editor").onclick=event=>{if(event.target===$("#editor"))closeEditor();};
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!$("#editor").hidden)closeEditor();});

$("#save").onclick = async () => {
  const button=$("#save");
  try {
    const name=$("#name").value.trim();
    if(!name) throw Error("Donne un nom au lieu avant de l’enregistrer.");
    if(!$("#key").value.trim()) $("#key").value=technicalKey(name,state.type==="building"?"batiment":state.type);
    if(!$("#key").value.trim()) throw Error("Le nom doit contenir au moins quelques lettres ou chiffres.");
    button.disabled=true; button.textContent="Enregistrement…";
    const response=await fetch(`/api/content/${state.type}/${$("#key").value}`,{method:"POST",headers,body:JSON.stringify({payload:buildPayload(),expected_version:state.editing?.version})});
    if(!response.ok) throw Error((await response.json()).detail);
    closeEditor(); await loadCatalogs(); await load();
  } catch(error) { $("#error").textContent=error.message; }
  finally { button.disabled=false; button.textContent="Enregistrer le brouillon"; }
};

$("#new").onclick=startCreate; $("#search").oninput=renderCards;
$$('#nav [data-nav-group]').forEach(button=>button.onclick=()=>{const group=button.dataset.navGroup,menu=$(`[data-nav-submenu="${group}"]`),willOpen=menu.hidden;$$('[data-nav-submenu]').forEach(item=>item.hidden=true);$$('[data-nav-group]').forEach(item=>item.setAttribute("aria-expanded","false"));menu.hidden=!willOpen;button.setAttribute("aria-expanded",String(willOpen));});
$$('#nav [data-type]').forEach(button=>button.onclick=()=>{activateNavigation(button);state.type=button.dataset.type;$("#title").textContent=labels[state.type];$("#crumb").textContent=labels[state.type].toUpperCase();load();});
loadCatalogs().finally(load);
