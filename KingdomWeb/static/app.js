const state = {
  type: "building", items: [], editing: null, duplicate: false,
  selectedPreset: null, keyTouched: false,
  catalogs: {item: [], event: []},
  token: localStorage.kingdomToken || prompt("Jeton administrateur", "change-me") || ""
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
const labels = {building:"Bâtiments", item:"Objets", event:"Événements", bot:"Bots Discord", audio:"Voix & audio"};
const icons = {building:"🏰", item:"🎒", event:"⚡", bot:"🤖", audio:"🔊"};

const HELP = {
  preset: ["Choisir un modèle", "Le modèle prépare une structure complète. Tout reste modifiable ensuite.", ["Récolte pour obtenir des ressources", "Production pour transformer", "Commerce pour vendre"]],
  name: ["Nom du lieu", "Choisis un nom court et évocateur. Il sera affiché dans Discord et utilisé pour nommer les salons.", ["Ferme du Royaume", "Atelier des alchimistes"]],
  emoji: ["Symbole", "Un emoji aide les joueurs à reconnaître instantanément le lieu.", ["🌾 pour une ferme", "⚒️ pour une forge"]],
  description: ["Description", "Explique simplement ce que le joueur peut faire ici, en une seule phrase.", ["Récoltez des céréales et nourrissez le village."]],
  actions: ["Actions des joueurs", "Chaque action devient un bouton Discord. Commence par une action claire, puis ajoute ses conséquences.", ["Récolter", "Acheter", "Discuter"]],
  action_name: ["Nom du bouton", "Utilise un verbe qui annonce clairement ce qui va se passer.", ["Couper du bois", "Commander un repas"]],
  effects: ["Résultat de l’action", "Les résultats sont exécutés dans l’ordre : payer un coût, recevoir un objet, puis afficher un message.", ["Retirer 5 énergie", "Donner 2 bois"]],
  effect_resource: ["Ressource ou objet", "Utilise l’identifiant d’un objet existant, ou money / energy pour la monnaie et l’énergie.", ["wood", "iron_ore", "money", "energy"]],
  npc_name: ["Personnage associé", "Facultatif. Donne un visage au bâtiment et prépare les futures interactions narratives.", ["Roland le mineur"]],
  color: ["Couleur Discord", "Couleur hexadécimale des encarts Discord, sans le caractère #.", ["22c55e", "8b5cf6"]],
  technical_key: ["Identifiant technique", "Il relie les données au moteur. Il est généré automatiquement et ne doit contenir que des lettres minuscules, chiffres et underscores.", ["ferme_du_royaume"]]
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
  const response = await fetch(`/api/content?entity_type=${state.type}`, {headers});
  if (!response.ok) { alert("Accès refusé ou API indisponible."); return; }
  state.items = await response.json();
  renderCards();
}

async function loadCatalogs() {
  const [itemsResponse, eventsResponse] = await Promise.all([
    fetch("/api/content?entity_type=item", {headers}),
    fetch("/api/content?entity_type=event", {headers}),
  ]);
  if (itemsResponse.ok) state.catalogs.item = await itemsResponse.json();
  if (eventsResponse.ok) state.catalogs.event = await eventsResponse.json();
}

function catalogOptions(type, currentValue="") {
  const systemResources = type === "item"
    ? [["money", "💰 Monnaie"], ["energy", "⚡ Énergie"]]
    : [];
  const entities = state.catalogs[type].map(entity => [
    entity.entity_key,
    `${entity.payload.emoji || (type === "item" ? "📦" : "⚡")} ${entity.payload.name || entity.entity_key}`,
  ]);
  const options = [...systemResources, ...entities];
  // Préserve une ancienne référence même si son objet a depuis été supprimé.
  if (currentValue && !options.some(([key]) => key === currentValue)) {
    options.push([currentValue, `⚠ ${currentValue} (introuvable)`]);
  }
  return [["", type === "item" ? "Choisir une ressource…" : "Choisir un événement…"], ...options];
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
      </span></div>
    </article>`).join("") || `<p class="empty">Aucune définition. Crée la première.</p>`;
}

function showModal() {
  $("#editor").hidden = false;
  document.body.classList.add("modal-open");
}

function resetEditor() {
  state.editing = null; state.duplicate = false; state.selectedPreset = null; state.keyTouched = false;
  $("#error").textContent = "";
  $("#wizard-back").hidden = true;
  $("#preset-step").hidden = true;
  $("#definition-step").hidden = false;
  $$(".common-fields").forEach(element => element.hidden = false);
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
  const root = $("#type-fields");
  if (state.type === "item") root.innerHTML = `<section class="form-section"><h3>Propriétés de l’objet</h3><div class="form-grid">${select("Catégorie","category",payload.category||"resources",[["drinks","Boisson / repas"],["equipment","Équipement"],["ingredients","Ingrédient"],["resources","Ressource"]])}${input("Type","type",payload.type||"ressource")}${select("Rareté","rarity",payload.rarity||"commun",[["commun","Commun"],["peu_commun","Peu commun"],["rare","Rare"],["epique","Épique"],["legendaire","Légendaire"]])}${input("Prix","price",payload.price||0,"number",'min="0"')}${input("Taille maximale de pile","stack_limit",payload.stack_limit||999,"number",'min="1"')}</div><div class="checks">${check("Empilable","stackable",payload.stackable!==false)}${check("Consommable","consumable",!!payload.consumable)}${check("Vendable","sellable",payload.sellable!==false)}</div></section>`;
  if (state.type === "event") { root.innerHTML = `<section class="form-section"><h3>Déclenchement</h3><div class="form-grid">${select("Type","trigger_type",payload.trigger?.type||"manual",[["manual","Manuel"],["scheduled","Date programmée"],["recurring","Récurrent"],["action","Action de jeu"],["players","Nombre de joueurs"]])}${input("Expression / valeur","trigger_value",payload.trigger?.value||"")}${input("Début","starts_at",payload.starts_at||"","datetime-local")}${input("Fin","ends_at",payload.ends_at||"","datetime-local")}${input("Priorité","priority",payload.priority||0,"number")}</div><div class="checks">${check("Événement activé","enabled",payload.enabled!==false)}</div><div id="effects"></div><button type="button" class="secondary" id="add-effect">＋ Ajouter un résultat</button></section>`; (payload.effects||[]).forEach(effect => addEffect($("#effects"),effect)); $("#add-effect").onclick=()=>addEffect($("#effects"),{}); }
  if (state.type === "bot") root.innerHTML = `<section class="form-section"><h3>Identité et connexion Discord</h3><div class="form-grid">${select("Type de bot","bot_type",payload.bot_type||"text",[["text","Bot textuel"],["voice","Bot vocal"]])}${input("Variable de l’Application ID","application_id_env",payload.application_id_env||"")}${input("Variable du token","token_env",payload.token_env||"KINGDOM_CORE_TOKEN")}${input("Identifiant du serveur","guild_id",payload.guild_id||"")}${input("Présence Discord","presence",payload.presence||"")}</div><div class="checks">${check("Bot activé","enabled",!!payload.enabled)}${check("Connexion vocale automatique","auto_join",payload.auto_join!==false)}</div><details class="advanced"><summary>Configuration vocale avancée</summary><div class="advanced-content form-grid">${input("Identifiant du salon vocal","voice_channel_id",payload.voice_channel_id||0)}${input("Variable du salon","voice_channel_env",payload.voice_channel_env||"")}${input("Bâtiment associé","building_key",payload.building_key||"")}${input("Déconnexion après (secondes)","leave_delay",payload.leave_delay||10,"number")}${input("Dossier de bienvenue","welcome_folder",payload.welcome_folder||"")}${input("Dossier musique","music_folder",payload.music_folder||"")}${input("Dossier ambiance","ambience_folder",payload.ambience_folder||"")}${input("Dossier phrases","phrase_folder",payload.phrase_folder||"")}${input("Volume voix","volume_voice",payload.volume?.voice??.8,"number",'min="0" max="1" step="0.05"')}${input("Volume musique","volume_music",payload.volume?.music??.05,"number",'min="0" max="1" step="0.05"')}${input("Volume ambiance","volume_ambience",payload.volume?.ambience??.35,"number",'min="0" max="1" step="0.05"')}${input("Volume effets","volume_sfx",payload.volume?.sfx??.2,"number",'min="0" max="1" step="0.05"')}</div></details></section>`;
  if (state.type === "audio") root.innerHTML = `<section class="form-section"><h3>Fichier et déclenchement</h3><div class="form-grid">${input("Chemin du fichier audio","source",payload.source||"")}${input("Événements déclencheurs","triggers",(payload.triggers||[]).join(", "))}${select("Canal audio","channel",payload.channel||"sfx",[["voice","Voix"],["music","Musique"],["ambience","Ambiance"],["sfx","Effet sonore"]])}${input("Volume","volume",payload.volume??.5,"number",'min="0" max="1" step="0.05"')}</div>${check("Lecture en boucle","loop",!!payload.loop)}</section>`;
}

function renderBuildingFields(payload, preset=null) {
  const root = $("#type-fields");
  const presetInfo = preset || KingdomBuildingPresets.find(item => item.key === payload.building_kind);
  root.innerHTML = `<section class="form-section"><div class="section-copy"><span class="step-dot">2</span><div><h3>Ce que les joueurs peuvent faire</h3><p>Chaque action devient un bouton dans Discord.</p></div></div>${presetInfo?`<span class="preset-badge">${presetInfo.icon} Modèle ${presetInfo.name}</span>`:""}<div class="section-head"><span></span><button type="button" class="secondary" id="add-action">＋ Ajouter une action</button></div><div id="actions"></div></section><details class="advanced"><summary>⚙️ Apparence et personnage</summary><div class="advanced-content form-grid">${input("Couleur Discord","color",payload.color||"7c5cff")}${input("Personnage associé (facultatif)","npc_name",payload.npc_name||"")}</div></details>`;
  (payload.actions||[]).forEach(addAction);
  $("#add-action").onclick = () => { addAction({effects:[]}); setHelp("action_name"); };
  $("#add-action").dataset.help = "actions";
}

function addAction(action={}) {
  const container = $("#actions");
  const element = document.createElement("article");
  element.className = "builder action-builder";
  const number = container.children.length + 1;
  element.innerHTML = `<button type="button" class="remove" aria-label="Supprimer cette action">×</button><span class="action-number">Action ${number}</span><div class="form-grid">${input("Nom du bouton","action_name",action.name||"")}${input("Symbole","action_emoji",action.emoji||"")}</div><div class="checks">${check("Disponible pour les joueurs","action_enabled",action.enabled!==false)}</div><div class="section-head"><b>Que se passe-t-il ensuite ?</b><button type="button" class="secondary add-inner">＋ Ajouter un résultat</button></div><div class="action-effects"></div><details class="advanced"><summary>Identifiant technique de l’action</summary><div class="advanced-content">${input("Identifiant","action_key",action.key||"")}</div></details>`;
  container.append(element);
  element.dataset.originalAction = JSON.stringify(action);
  (action.effects||[]).forEach(effect => addEffect(element.querySelector(".action-effects"),effect));
  element.querySelector(".add-inner").onclick = () => { addEffect(element.querySelector(".action-effects"),{}); setHelp("effects"); };
  element.querySelector(".add-inner").dataset.help = "effects";
  element.querySelector(".remove").onclick = () => element.remove();
  const nameField = element.querySelector('[data-field="action_name"]');
  const keyField = element.querySelector('[data-field="action_key"]');
  nameField.addEventListener("input", () => { if (!keyField.dataset.touched) keyField.value = technicalKey(nameField.value,"action"); });
  keyField.addEventListener("input", () => keyField.dataset.touched = "true");
}

function addEffect(container, effect={}) {
  const element = document.createElement("div");
  element.className = "builder effect-builder";
  element.dataset.originalEffect = JSON.stringify(effect);
  const resource = effect.resource || effect.event || "";
  element.innerHTML = `<button type="button" class="remove" aria-label="Supprimer ce résultat">×</button><div class="friendly-effect">${select("Résultat","effect_type",effect.type||"message",[["message","Afficher un message"],["reward","Donner une ressource"],["cost","Retirer une ressource"],["emit","Déclencher un événement"],["random_reward","Butin aléatoire (avancé)"]])}<span class="effect-resource-field"></span>${input("Quantité","effect_amount",effect.amount||0,"number")}${input("Message au joueur","effect_text",effect.text||"")}</div>`;
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
    if (type === "random_reward") return JSON.parse(element.dataset.originalEffect || '{"type":"random_reward","choices":[]}');
    if (type === "message") return {type,text:fieldValue("effect_text",element)};
    if (type === "emit") return {type,event:fieldValue("effect_resource",element),payload:{}};
    return {type,resource:fieldValue("effect_resource",element),amount:fieldValue("effect_amount",element)};
  });
}

function buildPayload() {
  const payload = {name:$("#name").value.trim(),emoji:$("#emoji").value.trim(),description:$("#description").value.trim()};
  if (state.type === "building") Object.assign(payload,{building_kind:state.selectedPreset||state.editing?.payload?.building_kind||"custom",color:fieldValue("color")||"7c5cff",npc_name:fieldValue("npc_name")||"",actions:$$('#actions > .action-builder').map((element,index)=>({key:fieldValue("action_key",element)||technicalKey(fieldValue("action_name",element),`action_${index+1}`),name:fieldValue("action_name",element),emoji:fieldValue("action_emoji",element),enabled:fieldValue("action_enabled",element),effects:readEffects(element.querySelector(".action-effects"))}))});
  if (state.type === "item") Object.assign(payload,{category:fieldValue("category"),type:fieldValue("type"),rarity:fieldValue("rarity"),price:fieldValue("price"),stack_limit:fieldValue("stack_limit"),stackable:fieldValue("stackable"),consumable:fieldValue("consumable"),sellable:fieldValue("sellable")});
  if (state.type === "event") Object.assign(payload,{trigger:{type:fieldValue("trigger_type"),value:fieldValue("trigger_value")},starts_at:fieldValue("starts_at")||null,ends_at:fieldValue("ends_at")||null,priority:fieldValue("priority"),enabled:fieldValue("enabled"),effects:readEffects($("#effects"))});
  if (state.type === "bot") Object.assign(payload,{bot_type:fieldValue("bot_type"),application_id_env:fieldValue("application_id_env"),token_env:fieldValue("token_env"),guild_id:fieldValue("guild_id"),presence:fieldValue("presence"),enabled:fieldValue("enabled"),auto_join:fieldValue("auto_join"),voice_channel_id:fieldValue("voice_channel_id")||"0",voice_channel_env:fieldValue("voice_channel_env"),building_key:fieldValue("building_key"),leave_delay:fieldValue("leave_delay"),welcome_folder:fieldValue("welcome_folder"),music_folder:fieldValue("music_folder"),ambience_folder:fieldValue("ambience_folder"),phrase_folder:fieldValue("phrase_folder"),volume:{voice:fieldValue("volume_voice"),music:fieldValue("volume_music"),ambience:fieldValue("volume_ambience"),sfx:fieldValue("volume_sfx")}});
  if (state.type === "audio") Object.assign(payload,{source:fieldValue("source"),triggers:(fieldValue("triggers")||"").split(",").map(value=>value.trim()).filter(Boolean),channel:fieldValue("channel"),volume:fieldValue("volume"),loop:fieldValue("loop")});
  return payload;
}

async function publishItem(key, version) {
  const response = await fetch(`/api/content/${state.type}/${key}/${version}/publish`,{method:"POST",headers,body:"{}"});
  if (!response.ok) alert((await response.json()).detail);
  await load();
}

function closeEditor() { resetEditor(); $("#editor").hidden=true; document.body.classList.remove("modal-open"); }

$("#cards").addEventListener("click", async event => {
  const invite = event.target.closest("[data-invite]");
  if (invite) { event.stopPropagation(); const response=await fetch(`/api/bots/${invite.dataset.invite}/invite`,{headers}); const data=await response.json(); if(!response.ok){alert(data.detail);return;} window.open(data.url,"_blank","noopener"); return; }
  const duplicate = event.target.closest("[data-duplicate]");
  if (duplicate) { event.stopPropagation(); const entity=state.items.find(item=>item.entity_key===duplicate.dataset.duplicate); if(entity)openEditor(entity,true); return; }
  const publish = event.target.closest("[data-publish]");
  if (publish) { event.stopPropagation(); await publishItem(publish.dataset.publish,Number(publish.dataset.version)); return; }
  const target = event.target.closest("[data-edit],[data-open]");
  if (target) { const key=target.dataset.edit||target.dataset.open; const entity=state.items.find(item=>item.entity_key===key); if(entity)openEditor(entity); }
});

$("#cards").addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)){const card=event.target.closest("[data-open]");if(card){event.preventDefault();const entity=state.items.find(item=>item.entity_key===card.dataset.open);if(entity)openEditor(entity);}}});
$("#editor").addEventListener("focusin", event => { const key=event.target.dataset.help; if(key)setHelp(key); });
$("#editor").addEventListener("mouseover", event => { const target=event.target.closest("[data-help]"); if(target)setHelp(target.dataset.help); });
$("#name").addEventListener("input", () => { if (!state.editing && !state.keyTouched) $("#key").value = technicalKey($("#name").value,"batiment"); });
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
    closeEditor(); await load();
  } catch(error) { $("#error").textContent=error.message; }
  finally { button.disabled=false; button.textContent="Enregistrer le brouillon"; }
};

$("#new").onclick=startCreate; $("#search").oninput=renderCards;
$$('#nav button').forEach(button=>button.onclick=()=>{const active=$("#nav .active");if(active)active.classList.remove("active");button.classList.add("active");state.type=button.dataset.type;$("#title").textContent=labels[state.type];$("#crumb").textContent=labels[state.type].toUpperCase();load();});
loadCatalogs().finally(load);
