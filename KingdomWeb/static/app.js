const state = {
  type: "dashboard", items: [], editing: null, duplicate: false,
  selectedPreset: null, keyTouched: false, buildingBase: null,
  interfaceDraft: null, selectedPage: null, selectedComponent: null, adminTimer: null,
  supervisionTab: "overview", settingsTab: "onboarding", playerTab: "overview", playerId: null, playerPage: 1,
  itemFilters: {search:"",category:"",building:"",sort:"name_asc"},
  playerFilters: {search:"",profession:"",status:"",sort:"recent"}, expandedPlayers: [],
  audioFilters: {search:"",type:"",bot:"",sort:"name_asc"},
  catalogs: {item: [], itemEnriched: [], event: [], building: [], interface: [], audio: [], bot: [], location: []},
  token: "", profile: null, server: localStorage.getItem("kingdomServer")||"", editorDirty:false
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const kingdomSlug = window.kingdomSlug;
// Une clé générée doit rester valide, même lorsque le débutant choisit un nom très court.
function technicalKey(value, fallback="element") {
  const slug = kingdomSlug(value);
  return (slug.length >= 3 ? slug : `${fallback}_${slug || "nouveau"}`).slice(0, 64);
}
const headers = {"Content-Type": "application/json"};
function syncServerHeaders(){if(state.server)headers["X-Kingdom-Server"]=state.server;else delete headers["X-Kingdom-Server"]}
function multipartHeaders(){const result={};if(state.server)result["X-Kingdom-Server"]=state.server;if(state.token)result.Authorization=`Bearer ${state.token}`;return result}
syncServerHeaders();
const labels = {dashboard:"Le Royaume en un regard", live_world:"Monde en direct", players:"Joueurs & inventaires", building:"Bâtiments", profession:"Métiers du Royaume", item:"Objets du Royaume", event:"Événements", environment:"Météo & temps", location:"Carte & lieux", bot:"Bots Discord", audio:"Voix & audio", supervision:"Supervision en direct", settings:"Paramètres serveur",profile:"Mon profil & serveurs",academy:"Académie KingdomEngine"};
const icons = {dashboard:"◈", live_world:"🌍", players:"👥", building:"🏰", profession:"⚒️", item:"🎒", event:"⚡", environment:"🌦️", location:"🗺️", bot:"🤖", audio:"🔊", supervision:"🛡️", settings:"⚙️",profile:"♙"};
const pageDescriptions = {
  dashboard:"Créez, configurez et supervisez votre monde Discord.",
  live_world:"Observez l’heure, la météo, les événements, les chemins et les positions réelles.",
  players:"Consultez l’état des joueurs, leurs inventaires et leurs activités en direct.",
  building:"Construisez les lieux, mécaniques et interfaces Discord de votre royaume.",
  profession:"Comprenez les métiers, leurs outils, activités, productions et bâtiments.",
  item:"Gérez le catalogue utilisé par les inventaires, productions et commerces.",
  event:"Configurez les déclencheurs et les effets qui font évoluer le monde.",
  environment:"Pilotez l’heure, le jour, la météo et leurs influences temporaires.",
  location:"Reliez les villes, forêts et destinations de votre monde persistant.",
  bot:"Pilotez les identités Discord et les PNJ vocaux associés aux bâtiments.",
  audio:"Centralisez les voix, musiques, ambiances et effets sonores.",
  supervision:"Surveillez les services, l’activité du moteur et ses journaux.",
  settings:"Définissez les rôles, salons et règles générales du serveur Discord.",
  profile:"Gérez votre compte, vos serveurs Discord et les droits de votre équipe."
  ,academy:"Apprenez en créant réellement votre royaume, à votre rythme."
};

function setSaveState(kind="saved", text="Synchronisé") {
  const indicator=$("#save-state");
  if(!indicator)return;
  indicator.dataset.state=kind;
  indicator.querySelector("span").textContent=text;
}

const THEME_KEY="kingdomTheme";
function applyTheme(theme, persist=false) {
  const selected=theme==="dark"?"dark":"light";
  document.documentElement.dataset.theme=selected;
  if(persist)localStorage.setItem(THEME_KEY,selected);
  const button=$("#theme-toggle");
  if(!button)return;
  const dark=selected==="dark";
  const action=dark?"Activer le mode clair":"Activer le mode sombre";
  button.setAttribute("aria-label",action);
  button.title=action;
  button.setAttribute("aria-pressed",String(dark));
  button.querySelector(".theme-icon").textContent=dark?"☀":"☾";
  button.querySelector(".theme-label").textContent=dark?"Mode jour":"Mode nuit";
}

const HELP = {
  preset: ["Choisir un modèle", "Le modèle prépare une structure complète. Tout reste modifiable ensuite.", ["Récolte pour obtenir des ressources", "Production pour transformer", "Commerce pour vendre"]],
  name: ["Nom du lieu", "Choisis un nom court et évocateur. Il sera affiché dans Discord et utilisé pour nommer les salons.", ["Ferme du Royaume", "Atelier des alchimistes"]],
  emoji: ["Symbole", "Un emoji aide les joueurs à reconnaître instantanément le lieu.", ["🌾 pour une ferme", "⚒️ pour une forge"]],
  description: ["Description", "Explique simplement ce que le joueur peut faire ici, en une seule phrase.", ["Récoltez des céréales et nourrissez le village."]],
  actions: ["Actions des joueurs", "Chaque action devient un bouton Discord. Commence par une action claire, puis ajoute ses conséquences.", ["Récolter", "Acheter", "Discuter"]],
  action_name: ["Nom du bouton", "Utilise un verbe qui annonce clairement ce qui va se passer.", ["Couper du bois", "Commander un repas"]],
  effects: ["Résultat de l’action", "Les résultats sont exécutés dans l’ordre. Pour attribuer un métier, choisis « Gérer un métier », puis « Attribuer / rejoindre le métier » et sélectionne le métier concerné.", ["Attribuer le métier de Cuisinier", "Donner 25 XP de Bûcheron", "Retirer 5 énergie", "Donner 2 bois"]],
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
  if (state.type === "live_world") { await loadLiveWorld(); return; }
  if (state.type === "players") { await loadPlayers(); return; }
  if (state.type === "supervision") { await loadSupervision(); return; }
  if (state.type === "settings") { await loadSettings(); return; }
  if (state.type === "profile") { await loadProfile(); return; }
  if (state.type === "academy") { await KingdomTutorials.renderAcademy(); return; }
  $("#content-stats").hidden = false; $("#content-workspace").hidden = false; $("#admin-view").hidden = true; $("#new").hidden = false;
  if (state.type === "item") { await loadItemCatalog(); return; }
  if (state.type === "profession") { await loadProfessionCatalog(); return; }
  if (state.type === "audio") { await loadAudioBank(); return; }
  if (state.type === "location") { await loadLocationWorld(); return; }
  restoreContentToolbar();
  const response = await fetch(`/api/content?entity_type=${state.type}`, {headers});
  if (!response.ok) { alert("Accès refusé ou API indisponible."); return; }
  state.items = await response.json();
  renderCards();
}

async function loadCatalogs() {
  const [itemsResponse, eventsResponse, buildingsResponse, interfacesResponse, enrichedItemsResponse, audioResponse, botsResponse, locationsResponse] = await Promise.all([
    fetch("/api/content?entity_type=item", {headers}),
    fetch("/api/content?entity_type=event", {headers}),
    fetch("/api/content?entity_type=building", {headers}),
    fetch("/api/content?entity_type=interface", {headers}),
    fetch("/api/admin/items", {headers}),
    fetch("/api/content?entity_type=audio", {headers}),
    fetch("/api/content?entity_type=bot", {headers}),
    fetch("/api/content?entity_type=location", {headers}),
  ]);
  if (itemsResponse.ok) state.catalogs.item = await itemsResponse.json();
  if (eventsResponse.ok) state.catalogs.event = await eventsResponse.json();
  if (buildingsResponse.ok) state.catalogs.building = await buildingsResponse.json();
  if (interfacesResponse.ok) state.catalogs.interface = await interfacesResponse.json();
  if (enrichedItemsResponse.ok) state.catalogs.itemEnriched = (await enrichedItemsResponse.json()).items;
  if (audioResponse.ok) state.catalogs.audio = await audioResponse.json();
  if (botsResponse.ok) state.catalogs.bot = await botsResponse.json();
  if (locationsResponse.ok) state.catalogs.location = await locationsResponse.json();
}

function worldMapMarkup(geography){
  const nodes=geography.nodes||[],positions=new Map(nodes.map((node,index)=>[node.key,{x:Number(node.map?.x)||120+(index%4)*220,y:Number(node.map?.y)||80+Math.floor(index/4)*150}]));
  const width=Math.max(900,...[...positions.values()].map(point=>point.x+220)),height=Math.max(420,...[...positions.values()].map(point=>point.y+120));
  const lines=(geography.connections||[]).map(route=>{const a=positions.get(route.origin),b=positions.get(route.target);if(!a||!b)return'';return `<g><line x1="${a.x+80}" y1="${a.y+34}" x2="${b.x+80}" y2="${b.y+34}"/><text x="${(a.x+b.x)/2+80}" y="${(a.y+b.y)/2+26}">${escapeHtml(route.name)}</text></g>`}).join('');
  return `<div class="world-map" style="min-width:${width}px;height:${height}px"><svg viewBox="0 0 ${width} ${height}" aria-label="Connexions du monde">${lines}</svg>${nodes.map(node=>{const point=positions.get(node.key);return `<button type="button" class="world-node" data-world-node="${escapeHtml(node.key)}" style="left:${point.x}px;top:${point.y}px"><span>${escapeHtml(node.emoji||'📍')}</span><b>${escapeHtml(node.name||node.key)}</b><small>${escapeHtml(node.location_type||'lieu')} · ${node.buildings.length} bâtiment(s)</small></button>`}).join('')}</div>`;
}

async function loadLocationWorld(){
  restoreContentToolbar();const [contentResponse,geoResponse]=await Promise.all([fetch('/api/content?entity_type=location',{headers}),fetch('/api/world/geography',{headers})]);if(!contentResponse.ok||!geoResponse.ok){alert('La géographie est indisponible.');return}state.items=await contentResponse.json();const geography=await geoResponse.json();
  $('#count').textContent=state.items.length;$('#published').textContent=state.items.filter(item=>item.status==='published').length;$('#drafts').textContent=state.items.filter(item=>item.status==='draft').length;
  $('#cards').className='world-layout';$('#cards').innerHTML=`<section class="world-map-panel"><div class="section-head"><div><h2>Carte schématique</h2><p>Les traits représentent les chemins gameplay ; la position graphique sert uniquement à organiser la carte.</p></div></div><div class="world-map-scroll">${worldMapMarkup(geography)}</div></section><section class="world-location-list"><h2>Lieux</h2>${state.items.map(item=>`<article><button type="button" data-open="${escapeHtml(item.entity_key)}"><span>${escapeHtml(item.payload.emoji||'📍')}</span><b>${escapeHtml(item.payload.name)}</b><small>${escapeHtml(item.payload.location_type||'place')} · ${item.status}</small></button><div>${item.status==='draft'?`<button type="button" class="primary" data-publish-location="${escapeHtml(item.entity_key)}" data-version="${item.version}">Publier</button>`:''}<button type="button" class="danger-link" data-delete-location="${escapeHtml(item.entity_key)}">Supprimer</button></div></article>`).join('')||'<p class="simple-empty">Créez le premier lieu du monde.</p>'}</section>`;
  $$('[data-world-node],[data-open]').forEach(button=>button.onclick=()=>{const key=button.dataset.worldNode||button.dataset.open,entity=state.items.find(item=>item.entity_key===key);if(entity)openEditor(entity)});$$('[data-publish-location]').forEach(button=>button.onclick=()=>publishItem(button.dataset.publishLocation,Number(button.dataset.version)));$$('[data-delete-location]').forEach(button=>button.onclick=async()=>{if(!confirm('Supprimer ce lieu et archiver son historique ?'))return;const response=await fetch(`/api/content/location/${encodeURIComponent(button.dataset.deleteLocation)}`,{method:'DELETE',headers});if(!response.ok)alert((await response.json()).detail);else{await loadCatalogs();await loadLocationWorld()}});
}

async function loadLiveWorld(){
  clearInterval(state.adminTimer);state.adminTimer=null;showSystemView();const [stateResponse,geoResponse,impactResponse]=await Promise.all([fetch('/api/world/state',{headers,cache:'no-store'}),fetch('/api/world/geography',{headers,cache:'no-store'}),fetch('/api/world/impacts',{headers,cache:'no-store'})]);if(!stateResponse.ok||!geoResponse.ok){$('#admin-view').innerHTML='<p class="empty-admin">État du monde indisponible.</p>';return}const world=await stateResponse.json(),geography=await geoResponse.json(),impactData=impactResponse.ok?await impactResponse.json():{impacts:[]},weather=world.weather||{};
  const periods={morning:'Matin',day:'Jour',evening:'Soir',night:'Nuit'};$('#admin-view').innerHTML=`<div class="live-world"><section class="live-world-hero"><div><small>ROYAUME EN DIRECT</small><h2>Jour ${world.day} · ${String(world.hour).padStart(2,'0')}:${String(world.minute).padStart(2,'0')}</h2><p>${world.time_of_day==='night'?'🌙':world.time_of_day==='evening'?'🌆':'☀️'} ${periods[world.time_of_day]||escapeHtml(world.time_of_day)} · vitesse ×${world.speed}</p></div><div class="live-weather"><span>${escapeHtml(weather.emoji||'☀️')}</span><b>${escapeHtml(weather.name||weather.key||'Beau')}</b></div></section><section class="royal-metrics">${metricCard('LIEUX',world.world.locations)}${metricCard('CHEMINS',world.world.connections)}${metricCard('EN VOYAGE',(world.travels||[]).length)}${metricCard('JOUEURS POSITIONNÉS',(world.player_positions||[]).reduce((sum,item)=>sum+item.players,0))}</section><div class="dashboard-columns"><section class="royal-panel"><div class="royal-panel-title"><small>ÉVÉNEMENTS ACTIFS ET À VENIR</small></div>${(world.active_events||[]).map(event=>`<article class="dashboard-event"><span>${escapeHtml(event.emoji)}</span><div><b>${escapeHtml(event.name)}</b><small>${event.ends_at?`Jusqu’au ${formatDate(event.ends_at)}`:'Actif'}</small></div></article>`).join('')}${(world.upcoming_events||[]).map(event=>`<article class="dashboard-event"><span>${escapeHtml(event.emoji)}</span><div><b>${escapeHtml(event.name)}</b><small>Débute ${formatDate(event.starts_at)}</small></div></article>`).join('')||(!(world.active_events||[]).length?'<p class="empty-admin">Aucun événement actif ou imminent.</p>':'')}</section><section class="royal-panel"><div class="royal-panel-title"><small>VOYAGES EN COURS</small></div>${(world.travels||[]).map(travel=>`<p><b>${escapeHtml(travel.display_name||travel.discord_id)}</b><br>${escapeHtml(geography.nodes.find(node=>node.key===travel.origin_key)?.name||travel.origin_key)} → ${escapeHtml(geography.nodes.find(node=>node.key===travel.destination_key)?.name||travel.destination_key)} · ${travel.remaining_seconds} s</p>`).join('')||'<p class="empty-admin">Aucun voyage en cours.</p>'}</section></div><section class="royal-panel world-impacts"><div class="royal-panel-title"><small>IMPACTS ACTUELS</small><span>${impactData.impacts.length} valeur(s) modifiée(s)</span></div>${impactData.impacts.map(impact=>`<article class="impact-row"><div><b>${escapeHtml(impact.building_name)} · ${escapeHtml(impact.subject_name)}</b><small>${escapeHtml(impact.label)}</small></div><span>Base ${impact.base} → <strong>${impact.effective}</strong></span><small>${impact.modifiers.map(modifier=>`${escapeHtml(modifier.source)} ${escapeHtml(modifier.operator)} ${modifier.value}`).join(' · ')}</small></article>`).join('')||'<p class="empty-admin">Aucune valeur gameplay n’est actuellement modifiée.</p>'}</section><section class="world-map-panel"><div class="royal-panel-title"><small>CARTE DU MONDE</small><button data-go="location">Modifier</button></div><div class="world-map-scroll">${worldMapMarkup(geography)}</div></section></div>`;bindNavigationShortcuts();
  state.adminTimer=setInterval(()=>{if(state.type==='live_world')loadLiveWorld()},5000);
}

async function initializeAccount(){
  let response=await fetch("/api/profile",{headers,cache:"no-store"});
  if(response.status===403&&state.server){state.server="";localStorage.removeItem("kingdomServer");syncServerHeaders();response=await fetch("/api/profile",{headers,cache:"no-store"})}
  if(!response.ok){$("#login-screen").hidden=false;return false}
  state.profile=await response.json();
  const accessible=state.profile.servers.some(server=>server.slug===state.server);
  state.server=accessible?state.server:state.profile.current_server;
  localStorage.setItem("kingdomServer",state.server);syncServerHeaders();renderAccountShell();
  $("#login-screen").hidden=true;
  await loadCatalogs();await load();await KingdomTutorials.initialize();return true;
}

function renderAccountShell(){
  if(!state.profile)return;
  const account=state.profile.account,selector=$("#server-selector");
  selector.innerHTML=state.profile.servers.map(server=>`<option value="${escapeHtml(server.slug)}" ${server.slug===state.server?"selected":""}>${escapeHtml(server.name)}</option>`).join("");
  $("#account-name").textContent=account.display_name||account.username;
  $("#account-avatar").textContent=(account.display_name||account.username||"A").trim().charAt(0).toUpperCase();
}

async function selectServer(slug,navigate=true){
  if(!state.profile?.servers.some(server=>server.slug===slug))return;
  state.server=slug;localStorage.setItem("kingdomServer",slug);syncServerHeaders();renderAccountShell();
  state.catalogs={item:[],itemEnriched:[],event:[],building:[],interface:[],audio:[],bot:[]};
  setSaveState("saving","Changement de serveur…");await loadCatalogs();
  if(navigate)navigateTo("dashboard");else await load();
  setSaveState("saved","Serveur synchronisé");
}

function serverProfileCard(server){
  const current=server.slug===state.server;
  return `<article class="server-profile-card ${current?"current":""}"><div class="server-profile-head"><div><h3>${escapeHtml(server.name)}</h3><p>${server.guild_id?`Discord · ${escapeHtml(server.guild_id)}`:"Identifiant Discord à renseigner"}</p></div><span class="server-role">${escapeHtml(server.role)}</span></div><div class="server-meta"><span>Base indépendante · ${escapeHtml(server.slug)}</span><span>${server.bot_installed?"Bot déclaré comme installé":"Bot à installer sur ce serveur"}</span></div><div class="bot-list">${server.bots.map(bot=>`<div class="bot-row"><span><b>${escapeHtml(bot.name)}</b><small>${escapeHtml(bot.type)}</small></span><i class="bot-state ${bot.installed&&bot.available?"":"offline"}">${bot.installed&&bot.available?"Disponible":bot.available?"À installer":"Application non configurée"}</i></div>`).join("")||"<p>Aucun bot publié.</p>"}</div><div class="profile-actions">${current?'<button disabled>Serveur sélectionné</button>':`<button class="secondary" data-select-server="${escapeHtml(server.slug)}">Gérer ce serveur</button>`}${server.bots.filter(bot=>bot.available).map(bot=>`<button class="primary" data-profile-invite="${escapeHtml(bot.key)}" data-server="${escapeHtml(server.slug)}">Installer ${escapeHtml(bot.name)}</button>`).join("")}</div></article>`;
}

async function loadProfile(){
  clearInterval(state.adminTimer);$("#content-stats").hidden=true;$("#content-workspace").hidden=true;$("#admin-view").hidden=false;$("#new").hidden=true;
  const response=await fetch("/api/profile",{headers,cache:"no-store"});if(!response.ok){$("#login-screen").hidden=false;return}
  state.profile=await response.json();renderAccountShell();const account=state.profile.account;
  let accounts=[];if(account.is_admin){const result=await fetch("/api/accounts",{headers});if(result.ok)accounts=(await result.json()).accounts}
  $("#admin-view").innerHTML=`<div class="profile-page"><section class="profile-hero"><div class="profile-avatar">${escapeHtml((account.display_name||account.username).charAt(0).toUpperCase())}</div><div><small>${account.is_admin?"ADMINISTRATEUR KINGDOM":"COMPTE KINGDOM"}</small><h2>${escapeHtml(account.display_name||account.username)}</h2><p>@${escapeHtml(account.username)}${account.email?` · ${escapeHtml(account.email)}`:""}</p></div><button class="secondary" id="logout-account">Se déconnecter</button></section><section><div class="admin-section-head"><div><h2>Mes serveurs</h2><p>Chaque serveur possède ses propres données, bâtiments et réglages.</p></div></div><div class="profile-grid">${state.profile.servers.map(serverProfileCard).join("")||'<p>Aucun serveur ne vous a encore été attribué.</p>'}</div></section><section class="accounts-panel"><h3>Sécurité du compte</h3><form id="password-form" class="profile-actions"><input name="current_password" type="password" placeholder="Mot de passe actuel" required><input name="new_password" type="password" minlength="8" placeholder="Nouveau mot de passe" required><button class="secondary">Modifier le mot de passe</button></form></section>${account.is_admin?adminAccountsPanel(accounts):""}</div>`;
  $("#logout-account").onclick=logoutAccount;$$('[data-select-server]').forEach(button=>button.onclick=()=>selectServer(button.dataset.selectServer));$$('[data-profile-invite]').forEach(button=>button.onclick=()=>inviteBotForServer(button.dataset.profileInvite,button.dataset.server));
  $("#password-form").onsubmit=changePassword;
  if(account.is_admin)bindAccountAdministration();
}

function adminAccountsPanel(accounts){
  const serverOptions=state.profile.servers.map(server=>`<option value="${escapeHtml(server.slug)}">${escapeHtml(server.name)}</option>`).join("");
  return `<section class="accounts-panel"><h3>Administration des accès</h3><p>Créez les profils puis attribuez leur niveau d’accès à un serveur.</p><div class="admin-forms"><form id="create-account-form"><b>Nouveau profil</b><label>Identifiant<input name="username" required minlength="3"></label><label>Nom affiché<input name="display_name" required></label><label>E-mail<input name="email" type="email"></label><label>Mot de passe temporaire<input name="password" type="password" minlength="8" required></label><label>Serveur<select name="server_slug">${serverOptions}</select></label><label>Accès<select name="role"><option value="lecture">Lecture</option><option value="editeur">Éditeur</option><option value="gestionnaire">Gestionnaire</option><option value="proprietaire">Propriétaire</option></select></label><button class="primary">Créer le profil</button><small data-form-status></small></form><form id="create-server-form"><b>Nouveau serveur géré</b><label>Nom du serveur<input name="name" required minlength="3"></label><label>Identifiant du serveur Discord<input name="guild_id" inputmode="numeric" placeholder="123456789…"></label><button class="primary">Créer l’espace serveur</button><small data-form-status></small></form></div><table class="account-table"><thead><tr><th>Profil</th><th>Type</th><th>Accès actuels</th><th>Attribuer ou modifier</th></tr></thead><tbody>${accounts.map(item=>`<tr><td><b>${escapeHtml(item.display_name)}</b><small>@${escapeHtml(item.username)}</small></td><td>${item.is_admin?"Administrateur global":"Utilisateur"}</td><td><div class="access-list">${(item.access||[]).map(access=>`<span>${escapeHtml(access.name)} · ${escapeHtml(access.role)} ${item.is_admin?"":`<button type="button" title="Retirer cet accès" data-revoke-access="${item.id}|${escapeHtml(access.slug)}">×</button>`}</span>`).join("")||"Aucun accès"}</div></td><td>${item.is_admin?"Tous les serveurs":`<div class="access-editor"><select data-access-server>${serverOptions}</select><select data-access-role><option value="lecture">Lecture</option><option value="editeur">Éditeur</option><option value="gestionnaire">Gestionnaire</option><option value="proprietaire">Propriétaire</option></select><button type="button" data-grant-access="${item.id}">Appliquer</button></div>`}</td></tr>`).join("")}</tbody></table></section>`;
}

function bindAccountAdministration(){
  $("#create-account-form").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form));data.access=[{server_slug:data.server_slug,role:data.role}];delete data.server_slug;delete data.role;const response=await fetch("/api/accounts",{method:"POST",headers,body:JSON.stringify(data)});form.querySelector('[data-form-status]').textContent=response.ok?"Profil créé.":(await response.json()).detail;if(response.ok)await loadProfile()};
  $("#create-server-form").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form));const response=await fetch("/api/servers",{method:"POST",headers,body:JSON.stringify(data)});form.querySelector('[data-form-status]').textContent=response.ok?"Serveur créé.":(await response.json()).detail;if(response.ok){state.profile=null;await initializeAccount();state.type="profile";await loadProfile()}};
  $$('[data-grant-access]').forEach(button=>button.onclick=async()=>{const editor=button.closest('.access-editor'),body={server_slug:editor.querySelector('[data-access-server]').value,role:editor.querySelector('[data-access-role]').value};const response=await fetch(`/api/accounts/${button.dataset.grantAccess}/access`,{method:"POST",headers,body:JSON.stringify(body)});if(!response.ok){alert((await response.json()).detail);return}await loadProfile()});
  $$('[data-revoke-access]').forEach(button=>button.onclick=async()=>{const [accountId,serverSlug]=button.dataset.revokeAccess.split('|');if(!confirm("Retirer l’accès de ce profil à ce serveur ?"))return;const response=await fetch(`/api/accounts/${accountId}/access/${encodeURIComponent(serverSlug)}`,{method:"DELETE",headers});if(!response.ok){alert((await response.json()).detail);return}await loadProfile()});
}

async function inviteBotForServer(botKey,serverSlug){const response=await fetch(`/api/bots/${encodeURIComponent(botKey)}/invite`,{headers:{...headers,"X-Kingdom-Server":serverSlug}}),data=await response.json();if(!response.ok){alert(data.detail);return}window.open(data.url,"_blank","noopener")}
async function logoutAccount(){await fetch("/api/auth/logout",{method:"POST",headers});state.profile=null;$("#login-screen").hidden=false}
async function changePassword(event){event.preventDefault();const response=await fetch("/api/profile/password",{method:"POST",headers,body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}),data=await response.json();if(!response.ok){alert(data.detail);return}alert(data.message);await logoutAccount()}

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
  $("#cards").classList.toggle("building-card-grid",state.type==="building");
  $("#cards").innerHTML = items.map(item => state.type==="building"?buildingCardMarkup(item):`
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

async function loadProfessionCatalog(){const response=await fetch('/api/world/professions',{headers});if(!response.ok){alert('Catalogue des métiers indisponible.');return}const professions=await response.json();state.items=professions;$('#count').textContent=professions.length;$('#published').textContent=professions.filter(item=>item.buildings.length).length;$('#drafts').textContent=professions.filter(item=>!item.buildings.length).length;$('#cards').innerHTML=professions.map(item=>`<article class="card profession-world-card"><div class="card-head"><span class="emoji">${escapeHtml(item.emoji||'⚒️')}</span><span class="badge published">${item.buildings.length?'UTILISÉ':'AUTONOME'}</span></div><h3>${escapeHtml(item.name||item.key)}</h3><p>${item.activities.length} activité(s) · ${item.buildings.length} bâtiment(s)</p><div class="item-tags">${item.required_item?`<span>${escapeHtml(itemDisplay(item.required_item).name)}</span>`:''}${item.produced_items.slice(0,3).map(key=>`<span>${escapeHtml(itemDisplay(key).name)}</span>`).join('')}</div><button type="button" class="primary" data-open-profession-world="${escapeHtml(item.key)}">Ouvrir la fiche</button></article>`).join('')||'<p class="empty">Aucun métier. Créez-en un ou ajoutez-en depuis un bâtiment.</p>';$$('[data-open-profession-world]').forEach(button=>button.onclick=()=>openProfessionProjection(professions.find(item=>item.key===button.dataset.openProfessionWorld)))}
function openProfessionProjection(item){let dialog=$('#profession-world-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='profession-world-dialog';dialog.className='simple-building-dialog';document.body.append(dialog)}dialog.innerHTML=`<div class="dialog-head"><div><small>FICHE MÉTIER</small><h2>${escapeHtml(item.emoji||'⚒️')} ${escapeHtml(item.name||item.key)}</h2></div><button type="button" data-close>×</button></div><div class="simple-zone-form"><section><h3>Bâtiments</h3>${item.buildings.map(building=>`<article class="world-relation-row"><b>${escapeHtml(building.name)}</b><small>${building.primary?'Métier principal':'Métier associé'}</small></article>`).join('')||'<p class="simple-empty">Aucun bâtiment.</p>'}</section><section><h3>Outil principal</h3><article class="world-relation-row"><b>${escapeHtml(itemDisplay(item.required_item).name)}</b><small>Relation dérivée du métier</small></article></section><section><h3>Activités</h3>${item.activities.map(activity=>`<article class="world-relation-row"><b>${escapeHtml(activity.name)}</b><small>${escapeHtml(activity.building_key)}</small></article>`).join('')||'<p class="simple-empty">Aucune activité.</p>'}</section><section><h3>Objets produits</h3>${item.produced_items.map(key=>`<article class="world-relation-row"><b>${escapeHtml(itemDisplay(key).name)}</b></article>`).join('')||'<p class="simple-empty">Aucune production.</p>'}</section></div>`;dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close()}

function buildingCardMarkup(item){
  const modules=item.payload.modules||{},professions=modules.professions||[],bot=state.catalogs.bot.find(entity=>entity.payload.building_key===item.entity_key),productionCount=(modules.products||[]).length+(modules.recipes||[]).length;
  return `<article class="card building-card" data-open="${escapeHtml(item.entity_key)}" tabindex="0"><div class="card-head"><span class="emoji">${escapeHtml(item.payload.emoji||"🏰")}</span><span class="badge ${item.status}">${item.status==="published"?"PUBLIÉ":"BROUILLON"}</span></div><h3>${escapeHtml(item.payload.name)}</h3><p>${escapeHtml(item.payload.description||"Aucune description")}</p><div class="building-card-relations"><span>🛠️ ${escapeHtml(professions[0]?.name||"Aucun métier")}</span><span>🤖 ${escapeHtml(bot?.payload.name||"Aucun bot")}</span><span>📦 ${productionCount} production(s)</span></div><div class="building-card-actions"><button type="button" class="primary" data-edit="${escapeHtml(item.entity_key)}" data-tutorial="building-open">Modifier</button>${item.status==="draft"?`<button type="button" data-publish="${escapeHtml(item.entity_key)}" data-version="${item.version}">Publier</button>`:""}<details><summary aria-label="Actions secondaires">•••</summary><div><button type="button" data-duplicate="${escapeHtml(item.entity_key)}">Dupliquer</button><button type="button" class="danger-link" data-delete="${escapeHtml(item.entity_key)}">Supprimer</button></div></details></div><small class="building-card-version">Version ${item.version}</small></article>`;
}

function showModal() {
  $("#editor").hidden = false;
  document.body.classList.add("modal-open");
}

function resetEditor() {
  state.editing = null; state.duplicate = false; state.selectedPreset = null; state.keyTouched = false; state.buildingBase = null; state.editorDirty=false;
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

async function openEditor(entity, duplicate=false) {
  // Les migrations et publications Discord peuvent créer une version entre
  // le chargement de la liste et le clic sur Modifier. Toujours repartir de
  // la fiche la plus récente évite un faux conflit dès l'ouverture.
  if(!duplicate){
    const fresh=await fetch(`/api/content/${state.type}/${encodeURIComponent(entity.entity_key)}`,{headers,cache:"no-store"});
    if(fresh.ok)entity=await fresh.json();
  }
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
  KingdomTutorials.notify("building_editor_opened", entity.entity_key);
}

async function loadAudioBank() {
  closeAudioPreview();
  restoreContentToolbar();
  state.items=state.catalogs.audio;
  const filters=state.audioFilters;
  const items=state.items.filter(entity=>{
    const payload=entity.payload,query=filters.search.toLowerCase();
    return (!query||`${entity.entity_key} ${payload.name} ${(payload.tags||[]).join(" ")}`.toLowerCase().includes(query))&&(!filters.type||(payload.audio_type||payload.channel)===filters.type)&&(!filters.bot||payload.speaker_bot_key===filters.bot);
  }).sort((a,b)=>filters.sort==="recent"?String(b.created_at).localeCompare(String(a.created_at)):filters.sort==="type"?String(a.payload.audio_type||a.payload.channel).localeCompare(String(b.payload.audio_type||b.payload.channel)):String(a.payload.name).localeCompare(String(b.payload.name),"fr"));
  $("#count").textContent=state.items.length;$("#published").textContent=state.items.filter(x=>x.status==="published").length;$("#drafts").textContent=state.items.filter(x=>x.status==="draft").length;
  $("#content-workspace .toolbar").innerHTML=`<input id="audio-search" value="${escapeHtml(filters.search)}" placeholder="Rechercher un son ou un mot-clé…"><select id="audio-type-filter"><option value="">Tous les types</option><option value="voice">Voix</option><option value="music">Musiques</option><option value="ambience">Ambiances</option><option value="sfx">SFX</option></select><select id="audio-bot-filter"><option value="">Tous les bots</option>${voiceBotOptions("").slice(1).map(([key,label])=>`<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}</select><select id="audio-sort"><option value="name_asc">Nom A–Z</option><option value="type">Type audio</option><option value="recent">Plus récents</option></select>`;
  $("#audio-type-filter").value=filters.type;$("#audio-bot-filter").value=filters.bot;$("#audio-sort").value=filters.sort;
  $("#cards").innerHTML=`<section class="audio-upload-card"><div><small>BANQUE SONORE KINGDOMDATA</small><h3>Importer un nouveau son</h3><p>Le fichier sera copié, référencé et publié automatiquement.</p></div><form id="audio-upload-form"><input name="file" type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.opus" required><input name="name" placeholder="Nom du son" required><select name="audio_type"><option value="sfx">Effet sonore</option><option value="ambience">Ambiance</option><option value="music">Musique</option><option value="voice">Voix / phrase</option></select><select name="speaker_bot_key">${voiceBotOptions("").map(([key,label])=>`<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}</select><input name="tags" placeholder="Mots-clés : forêt, bois, hache"><button class="primary">Télécharger dans KingdomData</button><span id="audio-upload-status"></span></form></section><section id="audio-preview-panel" class="audio-preview-panel" hidden><div><small>ÉCOUTE AVANT ATTRIBUTION</small><b id="audio-preview-title">Aperçu du son</b></div><audio id="audio-preview-player" controls preload="metadata"></audio><button type="button" id="audio-preview-close" aria-label="Fermer le lecteur">×</button></section>${items.map(entity=>{const p=entity.payload,type=p.audio_type||p.channel||"sfx",bot=state.catalogs.bot.find(x=>x.entity_key===p.speaker_bot_key);return `<article class="card audio-card" data-open="${escapeHtml(entity.entity_key)}"><div class="card-head"><span class="emoji">${{voice:"🗣️",music:"🎵",ambience:"🌲",sfx:"💥"}[type]||"🔊"}</span><span class="badge ${entity.status}">${type.toUpperCase()}</span></div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description||p.file_name||"Fichier audio")}</p><div class="item-tags">${(p.tags||[]).map(tag=>`<span>${escapeHtml(tag)}</span>`).join("")}${bot?`<span>🤖 ${escapeHtml(bot.payload.name)}</span>`:""}</div><div class="meta"><span>${Math.round(Number(p.size_bytes||0)/1024)} Ko · v${entity.version}</span><span><button data-audio-preview="${escapeHtml(entity.entity_key)}">▶ Écouter</button> · <button data-edit="${escapeHtml(entity.entity_key)}">Modifier</button> · <button class="danger-link" data-delete="${escapeHtml(entity.entity_key)}">Supprimer</button></span></div></article>`}).join("")||'<p class="empty">Aucun son ne correspond à ces filtres.</p>'}`;
  let timer;$("#audio-search").oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{filters.search=e.target.value;loadAudioBank()},250)};$("#audio-type-filter").onchange=e=>{filters.type=e.target.value;loadAudioBank()};$("#audio-bot-filter").onchange=e=>{filters.bot=e.target.value;loadAudioBank()};$("#audio-sort").onchange=e=>{filters.sort=e.target.value;loadAudioBank()};
  $("#audio-upload-form").onsubmit=uploadAudio;
  $("#audio-preview-close").onclick=closeAudioPreview;
  $("#new").hidden=true;
}

async function uploadAudio(event) {
  event.preventDefault();const form=event.currentTarget,status=$("#audio-upload-status"),button=form.querySelector("button");
  button.disabled=true;status.textContent="Téléchargement…";
  try{const response=await fetch("/api/audio/upload",{method:"POST",headers:multipartHeaders(),body:new FormData(form)});const data=await response.json();if(!response.ok)throw Error(data.detail||"Import impossible.");status.textContent="Son publié.";await loadCatalogs();await loadAudioBank();}
  catch(error){status.textContent=error.message;}finally{button.disabled=false;}
}

async function previewAudio(key) {
  const response=await fetch(`/api/audio/${encodeURIComponent(key)}/file`,{headers});if(!response.ok){alert((await response.json()).detail);return;}
  closeAudioPreview();const url=URL.createObjectURL(await response.blob()),player=$("#audio-preview-player"),panel=$("#audio-preview-panel"),entity=state.catalogs.audio.find(item=>item.entity_key===key);
  player.src=url;player.dataset.objectUrl=url;$("#audio-preview-title").textContent=entity?.payload?.name||key;panel.hidden=false;panel.scrollIntoView({behavior:"smooth",block:"nearest"});
  try{await player.play()}catch(_){/* Le navigateur laisse alors l'utilisateur cliquer sur les contrôles visibles. */}
}

function closeAudioPreview(){const player=$("#audio-preview-player");if(!player)return;player.pause();if(player.dataset.objectUrl)URL.revokeObjectURL(player.dataset.objectUrl);player.removeAttribute("src");player.load();delete player.dataset.objectUrl;const panel=$("#audio-preview-panel");if(panel)panel.hidden=true;}

function voiceBotOptions(current="") {
  const entries=state.catalogs.bot.filter(entity=>entity.payload.bot_type==="voice").map(entity=>[entity.entity_key,`🤖 ${entity.payload.name}`]);
  if(current&&!entries.some(([key])=>key===current))entries.push([current,`⚠ ${current} (introuvable)`]);
  return [["","Choisir un bot vocal…"],...entries];
}

function audioOptions(current="", type="") {
  const entries=state.catalogs.audio.filter(entity=>!type||(entity.payload.audio_type||entity.payload.channel)==type).map(entity=>[entity.entity_key,`🔊 ${entity.payload.name}`]);
  if(current&&!entries.some(([key])=>key===current))entries.push([current,`⚠ ${current} (introuvable)`]);
  return [["","Choisir un son…"],...entries];
}

function renderBotFields(payload) {
  const root=$("#type-fields");
  root.innerHTML=`<section class="form-section"><h3>Identité et connexion Discord</h3><div class="form-grid">${select("Type de bot","bot_type",payload.bot_type||"text",[["text","Bot textuel"],["voice","Bot vocal"]])}${input("Variable de l’Application ID","application_id_env",payload.application_id_env||"")}${input("Variable du token","token_env",payload.token_env||"KINGDOM_CORE_TOKEN")}${input("Identifiant du serveur","guild_id",payload.guild_id||"")}${input("Présence Discord","presence",payload.presence||"")}</div><div class="checks">${check("Bot activé","enabled",!!payload.enabled)}${check("Connexion vocale automatique","auto_join",payload.auto_join!==false)}</div><section class="audio-assignment"><h3>Attribution au bâtiment</h3><p class="field-note">Le salon vocal est récupéré automatiquement depuis le bâtiment provisionné. Le bot choisi devient une identité sonore disponible pour ce lieu.</p>${select("Bâtiment pris en charge","building_key",payload.building_key||"",catalogOptions("building",payload.building_key||""))}</section><details class="advanced"><summary>Réglages vocaux avancés</summary><div class="advanced-content form-grid">${input("Identifiant du salon (secours)","voice_channel_id",payload.voice_channel_id||0)}${input("Variable du salon (secours)","voice_channel_env",payload.voice_channel_env||"")}${input("Déconnexion après (secondes)","leave_delay",payload.leave_delay||10,"number")}${input("Volume voix","volume_voice",payload.volume?.voice??.8,"number",'min="0" max="1" step="0.05"')}${input("Volume musique","volume_music",payload.volume?.music??.05,"number",'min="0" max="1" step="0.05"')}${input("Volume ambiance","volume_ambience",payload.volume?.ambience??.35,"number",'min="0" max="1" step="0.05"')}${input("Volume effets","volume_sfx",payload.volume?.sfx??.2,"number",'min="0" max="1" step="0.05"')}</div></details></section>`;
}

function renderAudioFields(payload) {
  const root=$("#type-fields");
  root.innerHTML=`<section class="form-section"><h3>Classement du son</h3><p class="field-note">Le fichier est conservé dans KingdomData. Modifie ici uniquement sa fiche et son comportement.</p><div class="form-grid">${select("Type d’audio","audio_type",payload.audio_type||payload.channel||"sfx",[["voice","Voix / phrase"],["music","Musique"],["ambience","Ambiance"],["sfx","Effet sonore"]])}${select("Bot qui parle (facultatif)","speaker_bot_key",payload.speaker_bot_key||"",voiceBotOptions(payload.speaker_bot_key||""))}${input("Mots-clés (séparés par des virgules)","audio_tags",(payload.tags||[]).join(", "))}${input("Volume","volume",payload.volume??.5,"number",'min="0" max="1" step="0.05"')}</div><div class="checks">${check("Lecture en boucle","loop",!!payload.loop)}</div><details class="advanced"><summary>Informations du fichier</summary><div class="advanced-content"><p><b>${escapeHtml(payload.file_name||"Ancien fichier")}</b> · ${Math.round(Number(payload.size_bytes||0)/1024)} Ko</p><code>${escapeHtml(payload.storage_path||payload.source||"")}</code></div></details></section>`;
}

function modifierTargetOptions(type,current=''){let rows=[];if(type==='building')rows=catalogOptions('building',current);else if(type==='item')rows=catalogOptions('item',current);else if(type==='location')rows=locationOptions(current);else if(type==='profession')rows=professionOptions(current);else if(['activity','recipe','action'].includes(type)){rows=[['','Choisir…']];for(const building of state.catalogs.building){const entries=type==='action'?building.payload.actions||[]:building.payload.modules?.[`${type}s`]||[];entries.forEach(entry=>rows.push([entry.key,`${building.payload.emoji||'🏰'} ${building.payload.name} · ${entry.name||entry.key}`]))}}else rows=[['','Tout le royaume']];return rows}
function addWorldModifier(root,modifier={}){const row=document.createElement('div');row.className='builder world-modifier';const type=modifier.target?.type||'kingdom';row.innerHTML=`<button type="button" class="remove">×</button><div class="modifier-support">✓ Pris en charge par le gameplay</div><div class="form-grid">${select('Cible','modifier_target_type',type,[['kingdom','Tout le royaume'],['building','Bâtiment'],['profession','Métier'],['activity','Activité'],['recipe','Recette'],['item','Objet'],['action','Action'],['location','Lieu']])}<label data-modifier-target>Élément ciblé<select data-field="modifier_target_key">${modifierTargetOptions(type,modifier.target?.key||'').map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===(modifier.target?.key||'')?'selected':''}>${escapeHtml(label)}</option>`).join('')}</select></label>${select('Valeur modifiée','modifier_property',modifier.property||'production.quantity',[['production.quantity','Quantité produite'],['activity.duration','Durée activité'],['energy.cost','Coût énergétique'],['recipe.ingredient_quantity','Quantité d’ingrédient'],['economy.price','Prix'],['cooldown.duration','Cooldown'],['availability','Disponibilité']])}${select('Opération','modifier_operator',modifier.operator||'multiply',[['multiply','Multiplier'],['add','Ajouter'],['set','Définir'],['min','Maximum autorisé'],['max','Minimum garanti']])}${input('Valeur','modifier_value',modifier.value??1,'number','step="0.01"')}</div>`;root.append(row);row.querySelector('.remove').onclick=()=>row.remove();row.querySelector('[data-field="modifier_target_type"]').onchange=event=>{const target=row.querySelector('[data-modifier-target]'),options=modifierTargetOptions(event.target.value);target.innerHTML=`Élément ciblé<select data-field="modifier_target_key">${options.map(([key,label])=>`<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('')}</select>`}}
function readWorldModifiers(){return $$('.world-modifier').map(row=>({target:{type:fieldValue('modifier_target_type',row),key:fieldValue('modifier_target_key',row)||undefined},property:fieldValue('modifier_property',row),operator:fieldValue('modifier_operator',row),value:fieldValue('modifier_value',row)}))}

function locationOptions(current="",exclude="") {
  const depth=key=>{let count=0,cursor=state.catalogs.location.find(item=>item.entity_key===key);while(cursor?.payload?.parent_key&&count<8){count++;cursor=state.catalogs.location.find(item=>item.entity_key===cursor.payload.parent_key)}return count};
  const rows=state.catalogs.location.filter(item=>item.entity_key!==exclude).sort((a,b)=>depth(a.entity_key)-depth(b.entity_key)||(a.payload.name||a.entity_key).localeCompare(b.payload.name||b.entity_key,"fr")).map(item=>[item.entity_key,`${"　".repeat(depth(item.entity_key))}${item.payload.emoji||"📍"} ${item.payload.name||item.entity_key}`]);
  if(current&&!rows.some(([key])=>key===current))rows.push([current,`⚠ Lieu indisponible`]);return [["","Choisir un lieu…"],...rows];
}
function routeRequirementOptions(type,current=''){return type==='item'?catalogOptions('item',current):type==='profession'?professionOptions(current):[['','Aucun prérequis']]}
function addLocationConnection(root,connection={}){const condition=(connection.conditions||[])[0]||{},conditionType=condition.type||'none';const row=document.createElement('article');row.className='location-connection-editor';row.innerHTML=`<button type="button" class="remove" aria-label="Supprimer la connexion">×</button><div class="form-grid">${select('Destination','connection_target',connection.target||'',locationOptions(connection.target||'',state.editing?.entity_key||''))}${input('Nom du chemin','connection_name',connection.name||'')}${select('Direction','connection_direction',connection.direction||'one_way',[['one_way','Sens unique'],['bidirectional','Aller-retour']])}${input('Durée (secondes)','connection_duration',connection.duration_seconds||0,'number','min="0"')}${input('Coût en écus','connection_cost',connection.cost||0,'number','min="0"')}${select('Visibilité','connection_visibility',connection.visibility||'visible',[['visible','Visible immédiatement'],['discovered','Après découverte'],['secret','Passage secret']])}${select('Prérequis','connection_condition_type',conditionType,[['none','Aucun'],['item','Objet possédé'],['profession','Métier actif']])}<label data-route-requirement>Élément requis<select data-field="connection_condition_key">${routeRequirementOptions(conditionType,condition.key||'').map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===(condition.key||'')?'selected':''}>${escapeHtml(label)}</option>`).join('')}</select></label>${input('Quantité / niveau minimum','connection_condition_minimum',condition.minimum||1,'number','min="1"')}</div>`;root.append(row);row.querySelector('.remove').onclick=()=>row.remove();row.querySelector('[data-field="connection_condition_type"]').onchange=event=>{row.querySelector('[data-route-requirement]').innerHTML=`Élément requis<select data-field="connection_condition_key">${routeRequirementOptions(event.target.value).map(([key,label])=>`<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('')}</select>`}}
function readLocationConnections(){return $$('.location-connection-editor').map((row,index)=>{const type=fieldValue('connection_condition_type',row),key=fieldValue('connection_condition_key',row);return {key:technicalKey(`${state.editing?.entity_key||fieldValue('location_type')}_${fieldValue('connection_target',row)}_${index+1}`,'route'),target:fieldValue('connection_target',row),name:fieldValue('connection_name',row),direction:fieldValue('connection_direction',row),duration_seconds:fieldValue('connection_duration',row),cost:fieldValue('connection_cost',row),visibility:fieldValue('connection_visibility',row),conditions:type!=='none'&&key?[{type,key,minimum:fieldValue('connection_condition_minimum',row)||1}]:[]}}).filter(item=>item.target)}
function localActivityOptions(current=''){const rows=[['','Choisir une activité…']];for(const building of state.catalogs.building)for(const activity of building.payload.modules?.activities||[])rows.push([`${building.entity_key}|${activity.key}`,`${building.payload.emoji||'🏰'} ${building.payload.name} · ${activity.emoji||'⚙️'} ${activity.name||activity.key}`]);if(current&&!rows.some(([key])=>key===current))rows.push([current,'⚠ Activité indisponible']);return rows}
function addLocationActivity(root,reference={}){const value=reference.building_key&&reference.activity_key?`${reference.building_key}|${reference.activity_key}`:'';const row=document.createElement('div');row.className='location-activity-editor';row.innerHTML=`${select('Activité disponible ici','location_activity_ref',value,localActivityOptions(value))}<button type="button" class="danger-link">Retirer</button>`;root.append(row);row.querySelector('button').onclick=()=>row.remove()}
function readLocationActivities(){return $$('.location-activity-editor').map(row=>fieldValue('location_activity_ref',row)).filter(Boolean).map(value=>{const [building_key,activity_key]=value.split('|');return {building_key,activity_key}})}
function addWeatherOption(root,weather={}){const row=document.createElement('article');row.className='weather-option-editor';row.innerHTML=`<button type="button" class="remove">×</button><div class="form-grid">${input('Nom','weather_option_name',weather.name||'')}${input('Emoji','weather_option_emoji',weather.emoji||'☀️')}${input('Poids','weather_option_weight',weather.weight??1,'number','min="0" step="0.1"')}${input('À partir de l’heure','weather_option_hour',weather.hour??0,'number','min="0" max="23"')}</div>`;root.append(row);row.querySelector('.remove').onclick=()=>row.remove()}
function readWeatherOptions(){return $$('.weather-option-editor').map(row=>({key:technicalKey(fieldValue('weather_option_name',row),'meteo'),name:fieldValue('weather_option_name',row),emoji:fieldValue('weather_option_emoji',row),weight:fieldValue('weather_option_weight',row),hour:fieldValue('weather_option_hour',row),modifiers:[]})).filter(item=>item.name)}

function renderFields(payload) {
  if (state.type === "building") { renderBuildingFields(payload); return; }
  if (state.type === "interface") { renderInterfaceFields(payload); return; }
  if (state.type === "bot") { renderBotFields(payload); return; }
  if (state.type === "audio") { renderAudioFields(payload); return; }
  const root = $("#type-fields");
  if (state.type === "item") { const relations=payload.building_relations||[];root.innerHTML = `<section class="form-section"><h3>Propriétés de l’objet</h3><p class="field-note">Le nom est destiné aux joueurs. L’identifiant technique reste stable après la création afin de protéger les recettes et inventaires existants.</p><div class="form-grid">${select("Catégorie","category",payload.category||"resources",[["drinks","Boisson / repas"],["equipment","Équipement"],["ingredients","Ingrédient"],["resources","Ressource"],["tools","Outil"],["other","Autre"]])}${input("Type","type",payload.type||"ressource")}${select("Rareté","rarity",payload.rarity||"commun",[["commun","Commun"],["peu_commun","Peu commun"],["rare","Rare"],["epique","Épique"],["legendaire","Légendaire"]])}${input("Prix","price",payload.price||0,"number",'min="0"')}${input("Taille maximale de pile","stack_limit",payload.stack_limit||999,"number",'min="1"')}</div><div class="checks">${check("Empilable","stackable",payload.stackable!==false)}${check("Consommable","consumable",!!payload.consumable)}${check("Vendable","sellable",payload.sellable!==false)}</div><details><summary>Bâtiments associés explicitement</summary><p class="field-note">Les usages dans les recettes, productions et livraisons sont détectés automatiquement. Ajoute seulement les associations complémentaires.</p><div class="item-relations">${state.catalogs.building.map(building=>{const existing=relations.find(x=>x.building_key===building.entity_key);return `<div class="item-relation"><label class="check"><input type="checkbox" data-item-building="${escapeHtml(building.entity_key)}" ${existing?"checked":""}><span>${escapeHtml(`${building.payload.emoji||"🏰"} ${building.payload.name}`)}</span></label><select data-item-relation="${escapeHtml(building.entity_key)}"><option value="related">Associé à</option><option value="produced_by">Produit par</option><option value="used_by">Utilisé par</option><option value="sold_by">Vendu par</option><option value="accepted_by">Accepté par</option></select></div>`}).join("")}</div></details></section>`;relations.forEach(x=>{const field=root.querySelector(`[data-item-relation="${CSS.escape(x.building_key)}"]`);if(field)field.value=x.relation||"related"}); }
  if (state.type === "event") { root.innerHTML = `<section class="form-section"><h3>Déclenchement</h3><div class="form-grid">${select("Type","trigger_type",payload.trigger?.type||"manual",[["manual","Manuel"],["scheduled","Date programmée"],["recurring","Récurrent"],["action","Action de jeu"],["players","Nombre de joueurs"]])}${input("Expression / valeur","trigger_value",payload.trigger?.value||"")}${input("Début","starts_at",payload.starts_at||"","datetime-local")}${input("Fin","ends_at",payload.ends_at||"","datetime-local")}${input("Priorité","priority",payload.priority||0,"number")}</div><div class="checks">${check("Événement activé","enabled",payload.enabled!==false)}</div><div id="effects"></div><button type="button" class="secondary" id="add-effect">＋ Ajouter un résultat</button></section>`; (payload.effects||[]).forEach(effect => addEffect($("#effects"),effect)); $("#add-effect").onclick=()=>addEffect($("#effects"),{}); }
  if(state.type==="event"){root.insertAdjacentHTML('beforeend','<section class="form-section"><div class="section-head"><div><h3>Modificateurs du monde</h3><p class="field-note">Ils changent les valeurs effectives sans modifier les configurations de base.</p></div><button type="button" class="secondary" id="add-world-modifier">＋ Ajouter</button></div><div id="world-modifiers"></div></section>');(payload.modifiers||[]).forEach(item=>addWorldModifier($('#world-modifiers'),item));$('#add-world-modifier').onclick=()=>addWorldModifier($('#world-modifiers'),{})}
  if(state.type==="profession")root.innerHTML=`<section class="form-section"><h3>Fiche métier</h3><div class="form-grid">${input('Emoji','profession_emoji',payload.emoji||'⚒️')}${select('Outil principal','profession_item',payload.required_item||'',catalogOptions('item',payload.required_item||''))}${input('Niveau initial','profession_level',payload.initial_level||1,'number','min="1"')}${input('XP par niveau','profession_xp',payload.experience_per_level||100,'number','min="1"')}</div><p class="field-note">Les bâtiments et activités associés sont calculés depuis leurs usages réels.</p></section>`;
  if(state.type==="environment"){const weather=payload.weather||{};root.innerHTML=`<section class="form-section"><h3>Horloge du royaume</h3><div class="form-grid">${select('Horloge','clock_mode',payload.clock_mode||'accelerated',[['manual','Heure administrée'],['accelerated','Temps autonome']])}${input('Jour de départ','environment_day',payload.day||1,'number','min="1"')}${input('Heure de départ','environment_hour',payload.hour??12,'number','min="0" max="23"')}${input('Minute de départ','environment_minute',payload.minute??0,'number','min="0" max="59"')}${input('Vitesse du temps','environment_speed',payload.speed??1,'number','min="0" step="0.1"')}</div></section><section class="form-section"><h3>Météo</h3><div class="form-grid">${select('Mode','environment_mode',payload.mode||'manual',[['manual','Manuel'],['weighted','Aléatoire pondéré'],['scheduled','Selon l’heure']])}${input('Météo actuelle','weather_name',weather.name||'Beau')}${input('Emoji','weather_emoji',weather.emoji||'☀️')}${input('Changer toutes les (secondes)','weather_interval',payload.weather_interval_seconds||3600,'number','min="1"')}</div><div class="section-head"><h3>Météos possibles</h3><button type="button" class="secondary" id="add-weather-option">＋ Ajouter une météo</button></div><div id="weather-options"></div><div class="section-head"><h3>Influences de la météo actuelle</h3><button type="button" class="secondary" id="add-world-modifier">＋ Ajouter</button></div><div id="world-modifiers"></div></section>`;(payload.weather_options||[]).forEach(item=>addWeatherOption($('#weather-options'),item));$('#add-weather-option').onclick=()=>addWeatherOption($('#weather-options'),{});(weather.modifiers||[]).forEach(item=>addWorldModifier($('#world-modifiers'),item));$('#add-world-modifier').onclick=()=>addWorldModifier($('#world-modifiers'),{})}
  if(state.type==="location"){root.innerHTML=`<section class="form-section"><h3>Place dans le monde</h3><p class="field-note">Choisissez ce que représente ce lieu et l’endroit qui le contient. Aucun identifiant technique n’est nécessaire.</p><div class="form-grid">${select('Type','location_type',payload.location_type||'place',[['kingdom','Royaume'],['region','Région'],['city','Ville'],['village','Village'],['forest','Forêt'],['mountain','Montagne'],['wilderness','Zone sauvage'],['place','Lieu'],['gate','Porte'],['river','Rivière'],['crossroads','Carrefour'],['road','Route'],['secret','Passage secret'],['special','Destination spéciale']])}${select('Appartient à','location_parent',payload.parent_key||'',locationOptions(payload.parent_key||'',state.editing?.entity_key||''))}${input('Tags','location_tags',(payload.tags||[]).join(', '))}${input('Position carte X','location_map_x',payload.map?.x??0,'number')}${input('Position carte Y','location_map_y',payload.map?.y??0,'number')}</div><div class="checks">${check('Exploration autorisée','location_exploration',!!payload.exploration_enabled)}</div></section><section class="form-section"><div class="section-head"><div><h3>Activités disponibles ici</h3><p class="field-note">Associez les activités existantes : leur gameplay reste défini dans leur bâtiment.</p></div><button type="button" class="secondary" id="add-location-activity">＋ Associer une activité</button></div><div id="location-activities"></div></section><section class="form-section"><div class="section-head"><div><h3>Chemins depuis ce lieu</h3><p class="field-note">Les chemins secrets restent invisibles au joueur jusqu’à leur découverte.</p></div><button type="button" class="secondary" id="add-location-connection">＋ Créer une connexion</button></div><div id="location-connections"></div></section>`;(payload.activities||[]).forEach(reference=>addLocationActivity($('#location-activities'),reference));$('#add-location-activity').onclick=()=>addLocationActivity($('#location-activities'),{});(payload.connections||[]).forEach(connection=>addLocationConnection($('#location-connections'),connection));$('#add-location-connection').onclick=()=>addLocationConnection($('#location-connections'),{})}
  if (state.type === "bot") root.innerHTML = `<section class="form-section"><h3>Identité et connexion Discord</h3><div class="form-grid">${select("Type de bot","bot_type",payload.bot_type||"text",[["text","Bot textuel"],["voice","Bot vocal"]])}${input("Variable de l’Application ID","application_id_env",payload.application_id_env||"")}${input("Variable du token","token_env",payload.token_env||"KINGDOM_CORE_TOKEN")}${input("Identifiant du serveur","guild_id",payload.guild_id||"")}${input("Présence Discord","presence",payload.presence||"")}</div><div class="checks">${check("Bot activé","enabled",!!payload.enabled)}${check("Connexion vocale automatique","auto_join",payload.auto_join!==false)}</div><details class="advanced"><summary>Configuration vocale avancée</summary><div class="advanced-content form-grid">${input("Identifiant du salon vocal","voice_channel_id",payload.voice_channel_id||0)}${input("Variable du salon","voice_channel_env",payload.voice_channel_env||"")}${input("Bâtiment associé","building_key",payload.building_key||"")}${input("Déconnexion après (secondes)","leave_delay",payload.leave_delay||10,"number")}${input("Dossier de bienvenue","welcome_folder",payload.welcome_folder||"")}${input("Dossier musique","music_folder",payload.music_folder||"")}${input("Dossier ambiance","ambience_folder",payload.ambience_folder||"")}${input("Dossier phrases","phrase_folder",payload.phrase_folder||"")}${input("Volume voix","volume_voice",payload.volume?.voice??.8,"number",'min="0" max="1" step="0.05"')}${input("Volume musique","volume_music",payload.volume?.music??.05,"number",'min="0" max="1" step="0.05"')}${input("Volume ambiance","volume_ambience",payload.volume?.ambience??.35,"number",'min="0" max="1" step="0.05"')}${input("Volume effets","volume_sfx",payload.volume?.sfx??.2,"number",'min="0" max="1" step="0.05"')}</div></details></section>`;
  if (state.type === "audio") root.innerHTML = `<section class="form-section"><h3>Fichier et déclenchement</h3><div class="form-grid">${input("Chemin du fichier audio","source",payload.source||"")}${input("Événements déclencheurs","triggers",(payload.triggers||[]).join(", "))}${select("Canal audio","channel",payload.channel||"sfx",[["voice","Voix"],["music","Musique"],["ambience","Ambiance"],["sfx","Effet sonore"]])}${input("Volume","volume",payload.volume??.5,"number",'min="0" max="1" step="0.05"')}</div>${check("Lecture en boucle","loop",!!payload.loop)}</section>`;
  if(state.type==="item"&&state.editing?.entity_key){root.insertAdjacentHTML('beforeend','<section class="form-section" id="item-world-usage"><h3>Relations calculées</h3><p>Chargement des usages réels…</p></section>');fetch(`/api/world/items/${encodeURIComponent(state.editing.entity_key)}/usage`,{headers}).then(response=>response.json()).then(usage=>{const panel=$('#item-world-usage');if(!panel)return;const rows=[...usage.tools.map(item=>`Utilisé comme outil · ${item.profession||item.activity} · ${item.building}`),...usage.produced.map(item=>`Produit par ${item.activity||item.recipe} · ${item.building}`),...usage.consumed.map(item=>`Consommé par ${item.recipe} · ${item.building}`),...usage.deliveries.map(item=>`Livré de ${item.from} vers ${item.to}`)];panel.innerHTML=`<h3>Relations calculées</h3>${rows.map(text=>`<article class="world-relation-row"><b>${escapeHtml(text)}</b></article>`).join('')||'<p class="simple-empty">Aucun usage détecté.</p>'}`})}
}

const COMPONENT_LIBRARY = {
  hero: {name:"En-tête", icon:"👑", props:{title:"Titre de la page",subtitle:"Une courte introduction",emoji:"🏰"}},
  text: {name:"Texte", icon:"¶", props:{text:"Votre texte ici."}},
  sequence: {name:"Texte animé", icon:"▶", props:{steps:[{text:"Premier texte affiché",delay_seconds:0},{text:"Texte suivant",delay_seconds:2}]}},
  card: {name:"Carte", icon:"▣", props:{title:"Titre de la carte",text:"Contenu de la carte"}},
  stat: {name:"Indicateur", icon:"◫", props:{label:"Indicateur",value:"42"}},
  divider: {name:"Séparateur", icon:"—", props:{}},
  image: {name:"Image", icon:"🖼️", props:{url:"",alt:"Illustration"}},
  player_inventory: {name:"Inventaire du joueur", icon:"🎒", props:{title:"Contenu du sac"}},
  building_inventory: {name:"Inventaire du bâtiment", icon:"📦", props:{title:"Stock commun",building:""}},
  button: {name:"Bouton", icon:"◉", props:{label:"Continuer",emoji:"",style:"primary"},interaction:{type:"navigate",page:"home"}},
  select: {name:"Menu déroulant", icon:"⌄", props:{placeholder:"Choisir une option…"},options:[{key:"option_1",label:"Option 1",emoji:"",description:"",interaction:{type:"navigate",page:"home"}}]},
};
const PREDEFINED_INTERACTIONS = {
  back: {name:"Retour",icon:"↩️",component:{type:"button",props:{label:"Retour",emoji:"↩️",style:"secondary"},interaction:{type:"navigate",page:"home"}}},
  refresh: {name:"Actualiser",icon:"🔄",component:{type:"button",props:{label:"Actualiser",emoji:"🔄",style:"secondary"},interaction:{type:"refresh"}}},
  close: {name:"Quitter",icon:"✖️",component:{type:"button",props:{label:"Quitter",emoji:"✖️",style:"danger"},interaction:{type:"close"}}},
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

function componentTiles(types){return types.map(key=>{const item=COMPONENT_LIBRARY[key];return `<button type="button" class="component-tile" draggable="true" data-component-type="${key}"><span>${item.icon}</span><b>${item.name}</b></button>`}).join("");}
function visualStudioMarkup() { return `<section class="visual-studio">
    <aside class="studio-panel component-palette"><div class="studio-panel-head"><h3>Composants</h3><small>Glisser</small></div><div class="component-group"><h4>📝 Contenu de l’embed</h4><p>Éléments affichés dans le message Discord.</p><div class="component-library">${componentTiles(["hero","text","sequence","card","stat","divider","image","player_inventory","building_inventory"])}</div></div><div class="component-group interaction-components"><h4>🖱️ Boutons et menus</h4><p>Éléments interactifs placés dans la grille.</p><div class="component-library">${componentTiles(["button","select"])}</div><h5>Prêts à l’emploi</h5><div class="component-library preset-library">${Object.entries(PREDEFINED_INTERACTIONS).map(([key,item])=>`<button type="button" class="component-tile preset-tile" draggable="true" data-component-preset="${key}"><span>${item.icon}</span><b>${item.name}</b></button>`).join("")}</div></div></aside>
    <section class="studio-panel canvas-shell"><div class="canvas-toolbar"><strong id="canvas-page-name"></strong><span>Contenu puis grille Discord de 25 emplacements.</span></div><div class="page-link-graph" id="page-link-graph"></div><div class="builder-canvas" id="builder-canvas"></div><div class="interaction-zone"><div class="interaction-title"><b>Interactions Discord</b><small>5 lignes × 5 emplacements</small></div><div class="interaction-grid" id="interaction-grid"></div></div></section>
    <aside class="studio-panel studio-inspector"><div class="studio-panel-head"><h3>Pages</h3><button type="button" class="secondary" id="add-page">＋</button></div><div class="page-tree" id="page-tree"></div><div class="property-panel" id="property-panel"></div></aside>
  </section>`; }

function currentInterfacePage() { return state.interfaceDraft.pages.find(page=>page.key===state.selectedPage) || state.interfaceDraft.pages[0]; }
function currentInterfaceComponent() { return currentInterfacePage().components.find(component=>component.id===state.selectedComponent); }
function simpleDiscordMarkup(){const pages=state.interfaceDraft.pages||[],components=pages.reduce((sum,page)=>sum+(page.components||[]).length,0),actions=new Set(pages.flatMap(page=>(page.components||[]).flatMap(component=>[component.interaction?.action,...(component.options||[]).map(option=>option.interaction?.action)].filter(Boolean))));return `<section class="simple-discord-panel"><div class="simple-section-head"><div><small>INTERFACE DISCORD</small><h3>${pages.length} page(s) · ${components} composant(s)</h3><p>${actions.size} action(s) moteur reliée(s), sans modifier leurs identifiants.</p></div><button type="button" data-open-full-builder>Ouvrir le builder complet</button></div><div class="simple-discord-pages">${pages.map((page,index)=>{const linked=[...new Set((page.components||[]).flatMap(component=>[component.interaction?.action,...(component.options||[]).map(option=>option.interaction?.action)].filter(Boolean)))];return `<article><span>${page.key===state.interfaceDraft.start_page?"🏠":"📄"}</span><div><small>${page.key===state.interfaceDraft.start_page?"PAGE D’ACCUEIL":"PAGE"}</small><h4>${escapeHtml(page.name||page.key)}</h4><p>${page.components.length} composant(s)${linked.length?` · ${linked.slice(0,3).map(key=>escapeHtml(actionDisplayName(key))).join(" · ")}`:""}</p></div><button type="button" data-simple-page="${index}">Modifier</button></article>`}).join("")||'<p class="simple-empty">Aucune page Discord.</p>'}</div><button type="button" class="secondary" data-add-simple-page>＋ Ajouter une page</button></section>`}
function actionDisplayName(key){const action=$$("#actions > .action-builder").find(element=>fieldValue("action_key",element)===key);return action?fieldValue("action_name",action):key}
function refreshSimpleDiscord(){const panel=$('[data-building-panel="visual"]');if(!panel)return;panel.querySelector('.simple-discord-panel')?.remove();panel.insertAdjacentHTML('afterbegin',simpleDiscordMarkup());bindSimpleDiscord()}
function openSimplePageEditor(index,created=false){const page=state.interfaceDraft.pages[index];if(!page)return;const simpleTypes=new Set(['hero','text','sequence','button']),advancedCount=page.components.filter(component=>!simpleTypes.has(component.type)).length,components=page.components.map((component,i)=>{const label=component.props?.title||component.props?.label||component.props?.text||COMPONENT_LIBRARY[component.type]?.name||component.type;return `<article><span>${COMPONENT_LIBRARY[component.type]?.icon||"⚙"}</span><div><b>${escapeHtml(String(label).slice(0,80))}</b><small>${escapeHtml(COMPONENT_LIBRARY[component.type]?.name||"Composant avancé")}</small></div>${simpleTypes.has(component.type)?`<button type="button" data-simple-component="${i}">Modifier</button>`:'<em>⚙ Avancé</em>'}</article>`}).join("");const dialog=simpleDialog('simple-page-dialog','DISCORD › PAGES',`📄 ${escapeHtml(page.name||page.key)}`,`<div class="simple-zone-form"><label>Nom de la page<input name="name" value="${escapeHtml(page.name||"")}" required></label><label class="check"><input name="start" type="checkbox" ${page.key===state.interfaceDraft.start_page?"checked":""}><span>Page d’accueil</span></label><section class="simple-results"><div><h3>Composants</h3><small>Les composants complexes restent intacts.</small></div>${components||'<p class="simple-empty">Aucun composant.</p>'}<button type="button" class="secondary" data-add-simple-text>＋ Ajouter un texte</button><button type="button" class="secondary" data-add-simple-button>＋ Ajouter un bouton</button></section>${advancedCount?`<p class="field-note">⚙ ${advancedCount} composant(s) avancé(s) conservé(s).</p>`:""}<button type="button" class="secondary" data-page-full-builder>Ouvrir dans le builder complet</button></div>`,(data,current)=>{page.name=data.get('name');if(data.get('start')==='on')state.interfaceDraft.start_page=page.key;current.close();markEditorDirty();refreshSimpleDiscord()});dialog.querySelectorAll('[data-simple-component]').forEach(button=>button.onclick=()=>openSimpleComponentEditor(index,Number(button.dataset.simpleComponent)));dialog.querySelector('[data-add-simple-text]').onclick=()=>{page.components.push(newComponent('text'));openSimplePageEditor(index)};dialog.querySelector('[data-add-simple-button]').onclick=()=>{page.components.push(newComponent('button'));openSimplePageEditor(index)};dialog.querySelector('[data-page-full-builder]').onclick=()=>{dialog.close();state.selectedPage=page.key;const panel=$('[data-building-panel="visual"]');panel.querySelector('.simple-discord-panel').hidden=true;panel.querySelector('.visual-studio').hidden=false;renderVisualStudio()};if(created)dialog.querySelectorAll('[data-local-cancel]').forEach(button=>button.onclick=()=>{state.interfaceDraft.pages.splice(index,1);dialog.close();refreshSimpleDiscord()})}
function openSimpleComponentEditor(pageIndex,componentIndex){const page=state.interfaceDraft.pages[pageIndex],component=page?.components[componentIndex];if(!component)return;if(!['hero','text','sequence','button'].includes(component.type)){state.selectedPage=page.key;state.selectedComponent=component.id;$('#simple-page-dialog')?.close();$('[data-open-full-builder]').click();return}const isButton=component.type==='button',value=isButton?component.props.label:(component.props.title||component.props.text||component.props.subtitle||''),actionOptions=[["","Aucune action"],...$$("#actions > .action-builder").map(element=>[fieldValue('action_key',element),fieldValue('action_name',element)||fieldValue('action_key',element)])];const dialog=simpleDialog('simple-component-dialog','DISCORD › COMPOSANT',`${COMPONENT_LIBRARY[component.type]?.icon||"📝"} ${COMPONENT_LIBRARY[component.type]?.name||component.type}`,`<div class="simple-zone-form"><label>${isButton?'Texte du bouton':'Contenu'}<textarea name="content" rows="4">${escapeHtml(value)}</textarea></label>${isButton?`<label>Action<select name="action">${actionOptions.map(([id,label])=>`<option value="${escapeHtml(id)}" ${component.interaction?.action===id?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><label>Style<select name="style"><option value="primary">Principal</option><option value="secondary" ${component.props.style==='secondary'?"selected":""}>Secondaire</option><option value="success" ${component.props.style==='success'?"selected":""}>Succès</option><option value="danger" ${component.props.style==='danger'?"selected":""}>Danger</option></select></label>`:""}</div>`,(data,current)=>{if(isButton){component.props.label=data.get('content');component.props.style=data.get('style');const old=component.interaction||{};component.interaction={...old,type:'action',building:state.interfaceDraft.target_building_key,action:data.get('action')}}else if(component.type==='hero')component.props.title=data.get('content');else component.props.text=data.get('content');current.close();markEditorDirty();openSimplePageEditor(pageIndex)});return dialog}
function bindSimpleDiscord(){$$('[data-simple-page]').forEach(button=>button.onclick=()=>openSimplePageEditor(Number(button.dataset.simplePage)));$('[data-add-simple-page]')?.addEventListener('click',()=>{const index=state.interfaceDraft.pages.length,key=technicalKey(`page_${index+1}`);state.interfaceDraft.pages.push({key,name:`Page ${index+1}`,components:[]});openSimplePageEditor(index,true)});$('[data-open-full-builder]')?.addEventListener('click',()=>{const panel=$('[data-building-panel="visual"]');panel.querySelector('.simple-discord-panel').hidden=true;panel.querySelector('.visual-studio').hidden=false;renderVisualStudio()})}
function newComponent(type) {
  const template=COMPONENT_LIBRARY[type];
  return {id:technicalKey(`component_${Date.now()}_${Math.floor(Math.random()*9999)}`),type,props:clone(template.props),...(template.interaction?{interaction:clone(template.interaction)}:{}),...(template.options?{options:clone(template.options)}:{})};
}

function bindVisualStudio() {
  $$("[data-component-type]").forEach(tile=>tile.addEventListener("dragstart",event=>event.dataTransfer.setData("text/plain",`new:${tile.dataset.componentType}`)));
  $$("[data-component-preset]").forEach(tile=>tile.addEventListener("dragstart",event=>event.dataTransfer.setData("text/plain",`preset:${tile.dataset.componentPreset}`)));
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

function pageLinks(page){const links=[];for(const component of page.components||[]){if(component.interaction?.type==="navigate")links.push(component.interaction.page);for(const option of component.options||[])if(option.interaction?.type==="navigate")links.push(option.interaction.page);}return [...new Set(links)].filter(key=>state.interfaceDraft.pages.some(page=>page.key===key));}
function renderPageLinkGraph(){
  const pages=state.interfaceDraft.pages,byKey=Object.fromEntries(pages.map(page=>[page.key,page]));
  const depth={[state.interfaceDraft.start_page]:0},queue=[state.interfaceDraft.start_page];
  while(queue.length){const source=queue.shift();for(const target of pageLinks(byKey[source]||{components:[]})){if(depth[target]===undefined){depth[target]=depth[source]+1;queue.push(target);}}}
  const maxDepth=Math.max(0,...Object.values(depth));pages.forEach(page=>{if(depth[page.key]===undefined)depth[page.key]=maxDepth+1;});
  const columns={};pages.forEach(page=>(columns[depth[page.key]]||=[]).push(page));
  const nodeWidth=180,nodeHeight=54,columnGap=85,rowGap=24,padding=28;
  const columnCount=Math.max(...Object.keys(columns).map(Number))+1,maxRows=Math.max(...Object.values(columns).map(items=>items.length));
  const width=padding*2+columnCount*nodeWidth+(columnCount-1)*columnGap,height=padding*2+maxRows*nodeHeight+(maxRows-1)*rowGap;
  const positions={};Object.entries(columns).forEach(([column,items])=>items.forEach((page,index)=>{positions[page.key]={x:padding+Number(column)*(nodeWidth+columnGap),y:padding+index*(nodeHeight+rowGap)};}));
  const edges=pages.flatMap(page=>pageLinks(page).map(target=>({source:page.key,target}))).filter(edge=>positions[edge.source]&&positions[edge.target]);
  const lines=edges.map(edge=>{const from=positions[edge.source],to=positions[edge.target],x1=from.x+nodeWidth,y1=from.y+nodeHeight/2,x2=to.x,y2=to.y+nodeHeight/2,bend=(x1+x2)/2;return `<path d="M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}" class="page-graph-edge" marker-end="url(#page-arrow)"/>`;}).join("");
  const nodes=pages.map(page=>{const position=positions[page.key],active=page.key===state.selectedPage?" active":"",label=`${page.key===state.interfaceDraft.start_page?"★ ":""}${page.name}`.slice(0,24);return `<g class="page-graph-svg-node${active}" data-graph-page="${page.key}" transform="translate(${position.x} ${position.y})"><rect width="${nodeWidth}" height="${nodeHeight}" rx="9"/><text x="12" y="23">${escapeHtml(label)}</text><text class="node-key" x="12" y="41">${escapeHtml(page.key)}</text></g>`;}).join("");
  return `<div class="page-graph-head"><b>🗺️ Schéma de liaison des pages</b><small>Les flèches montrent quelle page découle de laquelle</small></div><div class="page-graph-scroll"><svg class="page-graph-svg" viewBox="0 0 ${width} ${height}" style="width:${Math.max(width,650)}px;height:${Math.max(height,120)}px"><defs><marker id="page-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${lines}${nodes}</svg></div>`;
}

function renderVisualStudio() {
  const page=currentInterfacePage(); if(!page)return;
  $("#canvas-page-name").textContent=page.name;
  $("#page-link-graph").innerHTML=renderPageLinkGraph();
  $$("[data-graph-page]").forEach(button=>button.onclick=()=>{state.selectedPage=button.dataset.graphPage;state.selectedComponent=null;renderVisualStudio();});
  $("#page-tree").innerHTML=state.interfaceDraft.pages.map(item=>`<div class="page-row"><button type="button" class="page-button ${item.key===page.key?"active":""}" data-page="${item.key}">${item.key===state.interfaceDraft.start_page?"★ ":""}${escapeHtml(item.name)}</button><div class="mini-actions"><button type="button" title="Dupliquer" data-copy-page="${item.key}">⧉</button></div></div>`).join("");
  $$("[data-page]").forEach(button=>button.onclick=()=>{state.selectedPage=button.dataset.page;state.selectedComponent=null;renderVisualStudio();});
  $$("[data-copy-page]").forEach(button=>button.onclick=()=>{const source=state.interfaceDraft.pages.find(item=>item.key===button.dataset.copyPage);const copy=clone(source);copy.key=technicalKey(`page_copy_${Date.now()}`);copy.name=`${source.name} (copie)`;copy.components.forEach((component,index)=>component.id=technicalKey(`${component.type}_${Date.now()}_${index}`));state.interfaceDraft.pages.push(copy);state.selectedPage=copy.key;state.selectedComponent=null;renderVisualStudio();});
  const contentComponents=page.components.filter(component=>!["button","select"].includes(component.type));
  $("#builder-canvas").innerHTML=`<div class="canvas-page">${contentComponents.length?contentComponents.map(renderCanvasComponent).join(""):`<div class="canvas-empty"><div><strong>Le contenu de cette page est vide</strong><p>Glissez un composant visuel depuis la bibliothèque.</p></div></div>`}</div>`;
  $("#interaction-grid").innerHTML=renderInteractionGrid(page);
  $$("[data-component-id]").forEach(element=>{element.onclick=()=>{state.selectedComponent=element.dataset.componentId;renderVisualStudio();};element.ondragstart=event=>event.dataTransfer.setData("text/plain",`move:${element.dataset.componentId}`);});
  $$("#interaction-grid [data-slot]").forEach(cell=>{cell.ondragover=event=>event.preventDefault();cell.ondrop=event=>{event.preventDefault();const token=event.dataTransfer.getData("text/plain"),slot=Number(cell.dataset.slot);if(token.startsWith("new:")){const type=token.slice(4);if(["button","select"].includes(type))placeInteraction(type,slot);}else if(token.startsWith("preset:")){placePresetInteraction(token.slice(7),slot);}else if(token.startsWith("move:")){const component=page.components.find(item=>item.id===token.slice(5));if(component&&["button","select"].includes(component.type)){page.components=page.components.filter(item=>item!==component);const occupied=slotComponent(page,slot);if(occupied){page.components.push(component);alert("Cet emplacement est déjà occupé.");}else{component.slot=component.type==="select"?Math.floor(slot/5)*5:slot;page.components.push(component);}renderVisualStudio();}}};});
  renderPropertyPanel();
}

function renderCanvasComponent(component) {
  const props=component.props||{}; let content="";
  if(component.type==="hero")content=`<div class="preview-hero"><small>${escapeHtml(props.emoji||"")}</small><h2>${escapeHtml(props.title||"Sans titre")}</h2><p>${escapeHtml(props.subtitle||"")}</p></div>`;
  if(component.type==="text")content=`<div class="preview-text">${escapeHtml(props.text||"")}</div>`;
  if(component.type==="sequence")content=`<div class="preview-card sequence-preview"><b>▶ Séquence de texte</b>${(props.steps||[]).map((step,index)=>`<p><small>Après ${step.delay_seconds||0} s</small> ${escapeHtml(step.text||`Étape ${index+1}`)}</p>`).join("")}</div>`;
  if(component.type==="card")content=`<div class="preview-card"><b>${escapeHtml(props.title||"Carte")}</b><p>${escapeHtml(props.text||"")}</p></div>`;
  if(component.type==="stat")content=`<div class="preview-stat"><small>${escapeHtml(props.label||"Indicateur")}</small><strong>${escapeHtml(props.value||"—")}</strong></div>`;
  if(component.type==="divider")content=`<div class="preview-divider"></div>`;
  if(component.type==="image")content=`<div class="preview-image">${props.url?`<img src="${escapeHtml(props.url)}" alt="${escapeHtml(props.alt||"")}">`:"Ajoutez une URL d’image"}</div>`;
  if(component.type==="player_inventory")content=`<div class="preview-card"><b>🎒 ${escapeHtml(props.title||"Inventaire du joueur")}</b><p>Le contenu, la monnaie, l’énergie et les métiers du joueur seront affichés ici.</p></div>`;
  if(component.type==="building_inventory")content=`<div class="preview-card"><b>📦 ${escapeHtml(props.title||"Stock commun")}</b><p>Les ressources stockées dans ce bâtiment seront affichées ici.</p></div>`;
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
  if(component.type==="sequence")fields=sequencePropertyFields(component);
  if(component.type==="card"){const access=component.access_when?.profession_level||{};fields=propertyInput("Titre","title",props.title)+`<label>Contenu<textarea data-prop="text" rows="4">${escapeHtml(props.text||"")}</textarea></label>`+propertySelect("Disposition Discord","inline",String(!!props.inline),[["false","Une carte par ligne"],["true","Cartes côte à côte"]])+propertyInput("Texte si verrouillé","locked_label",props.locked_label||"Niveau {level} requis")+propertySelect("Condition d'accès","access_type",access.profession?"profession_level":"none",[["none","Toujours accessible"],["profession_level","Niveau de métier minimum"]])+(access.profession?propertyInput("Identifiant du métier","access_profession",access.profession)+propertyInput("Niveau minimum","access_minimum",access.minimum||1,"number"):"");}
  if(component.type==="stat")fields=propertyInput("Libellé","label",props.label)+propertyInput("Valeur","value",props.value);
  if(component.type==="image")fields=propertyInput("URL","url",props.url)+propertyInput("Texte alternatif","alt",props.alt);
  if(component.type==="player_inventory")fields=propertyInput("Titre","title",props.title||"Contenu du sac");
  if(component.type==="building_inventory")fields=propertyInput("Titre","title",props.title||"Stock commun")+propertySelect("Bâtiment affiché","building",props.building||state.interfaceDraft.target_building_key,buildingTargetOptions(props.building||state.interfaceDraft.target_building_key));
  if(component.type==="button")fields=buttonPropertyFields(component);
  if(component.type==="select")fields=selectPropertyFields(component);
  panel.innerHTML=`${pageFields}<hr><h4>${COMPONENT_LIBRARY[component.type].icon} ${COMPONENT_LIBRARY[component.type].name}</h4>${fields}<button type="button" class="delete-component secondary">Supprimer le composant</button>`;bindPropertyPanel();
}

function buttonPropertyFields(component) {
  const props=component.props||{},interaction=component.interaction||{type:"navigate",page:state.interfaceDraft.start_page};
  let fields=propertyInput("Libellé","label",props.label)+propertyInput("Emoji","emoji",props.emoji)+propertySelect("Style","style",props.style||"primary",[["primary","Principal"],["secondary","Secondaire"],["success","Succès"],["danger","Danger"]])+propertySelect("Au clic","interaction_type",interaction.type,[["navigate","Ouvrir une page"],["action","Lancer une action"],["world_state","Afficher l’état du monde"],["world_travel","Voyager vers un lieu"],["refresh","Actualiser la page"],["close","Quitter / fermer"]]);
  if(interaction.type==="navigate")fields+=propertySelect("Page cible","target_page",interaction.page,state.interfaceDraft.pages.map(page=>[page.key,page.name]));
  else if(interaction.type==="action") {
    const building=state.type==="building"?($("#key").value||state.interfaceDraft.target_building_key):interaction.building||state.interfaceDraft.target_building_key||state.catalogs.building[0]?.entity_key||"";
    const actions=availableActions(building);
    fields+=propertySelect("Bâtiment","target_building",building,buildingTargetOptions(building));
    fields+=propertySelect("Action","target_action",interaction.action||"",[["","Choisir…"],...actions.map(action=>[action.key,action.name||action.key])]);
    fields+=`<div class="timing-fields">${propertyInput("Cooldown joueur (secondes)","cooldown_seconds",interaction.cooldown_seconds||0,"number")}${propertyInput("Cooldown global (secondes)","global_cooldown_seconds",interaction.global_cooldown_seconds||0,"number")}</div>`;
  }
  else if(interaction.type==="world_travel")fields+=propertySelect("Destination","world_destination",interaction.destination||"",locationOptions(interaction.destination||""));
  return fields;
}

function buildingTargetOptions(current){const options=state.catalogs.building.map(item=>[item.entity_key,`${item.payload.emoji||"🏰"} ${item.payload.name}`]);if(current&&!options.some(([key])=>key===current))options.unshift([current,"🏰 Bâtiment courant"]);return options;}

function availableActions(building){
  const currentKey=$("#key")?.value;
  if(state.type==="building"&&building===currentKey&&$("#actions"))return $$('#actions > .action-builder').map((element,index)=>({key:fieldValue("action_key",element)||technicalKey(fieldValue("action_name",element),`action_${index+1}`),name:fieldValue("action_name",element)||`Action ${index+1}`}));
  return state.catalogs.building.find(item=>item.entity_key===building)?.payload?.actions||[];
}

function interactionFields(interaction,prefix="") {
  let fields=propertySelect("Au choix",`${prefix}interaction_type`,interaction.type||"navigate",[["navigate","Ouvrir une page"],["action","Lancer une action"],["purchase","Acheter l’objet sélectionné"]]);
  if((interaction.type||"navigate")==="navigate")return fields+propertySelect("Page cible",`${prefix}target_page`,interaction.page||state.interfaceDraft.start_page,state.interfaceDraft.pages.map(page=>[page.key,page.name]));
  if(interaction.type==="purchase")return fields+propertySelect("Objet vendu",`${prefix}purchase_item`,interaction.item_key||"",state.catalogs.item.map(item=>[item.entity_key,`${item.payload.emoji||"📦"} ${item.payload.name}`]))+`<p class="field-note">Le prix et le stock viennent des Produits du bâtiment.</p>`;
  const building=state.type==="building"?($("#key").value||state.interfaceDraft.target_building_key):interaction.building||state.interfaceDraft.target_building_key||"";
  const actions=availableActions(building);
  return fields+propertySelect("Bâtiment",`${prefix}target_building`,building,buildingTargetOptions(building))+propertySelect("Action",`${prefix}target_action`,interaction.action||"",[["","Choisir…"],...actions.map(action=>[action.key,action.name||action.key])])+propertyInput("Cooldown joueur (s)",`${prefix}cooldown_seconds`,interaction.cooldown_seconds||0,"number");
}

function placePresetInteraction(preset,slot){
  const page=currentInterfacePage();
  if(slotComponent(page,slot)){alert("Cet emplacement est déjà occupé.");return;}
  const component=newPresetComponent(preset);component.slot=slot;page.components.push(component);state.selectedComponent=component.id;renderVisualStudio();
}
function newPresetComponent(preset){const template=PREDEFINED_INTERACTIONS[preset];const component=clone(template.component);component.id=technicalKey(`component_${preset}_${Date.now()}_${Math.floor(Math.random()*9999)}`);if(preset==="back")component.interaction.page=state.interfaceDraft.start_page;return component;}

function sequencePropertyFields(component){
  const steps=(component.props?.steps)||[];
  return `<p class="field-note">Le moteur remplace automatiquement le texte après chaque délai. Une étape conditionnelle est ignorée si le joueur ne remplit pas la condition.</p><div class="sequence-steps">${steps.map((step,index)=>{const rule=step.visible_when?.profession_level||{};return `<article class="sequence-step"><button type="button" class="remove-option" data-remove-step="${index}">×</button><b>Étape ${index+1}</b><label>Texte<textarea data-prop="sequence_${index}_text" rows="4">${escapeHtml(step.text||"")}</textarea></label>${propertyInput("Attendre avant affichage (secondes)",`sequence_${index}_delay_seconds`,step.delay_seconds||0,"number")}${propertySelect("Condition",`sequence_${index}_condition`,rule.profession?"profession_level":"none",[["none","Toujours afficher"],["profession_level","Niveau de métier minimum"]])}${rule.profession?propertyInput("Identifiant du métier",`sequence_${index}_profession`,rule.profession)+propertyInput("Niveau minimum",`sequence_${index}_minimum`,rule.minimum||1,"number"):""}</article>`}).join("")}</div><button type="button" class="secondary add-sequence-step">＋ Ajouter une étape</button>`;
}

function selectPropertyFields(component){
  const options=component.options||=[];
  return propertyInput("Texte du menu","placeholder",component.props?.placeholder||"Choisir une option…")+itemMenuPicker(component)+`<div class="select-options"><div class="section-head"><b>Options du menu (${options.length}/25)</b><button type="button" class="secondary add-select-option">＋ Option libre</button></div>${options.map((option,index)=>{const access=option.access_when?.profession_level||{};return `<article class="select-option"><button type="button" class="remove-option" data-remove-option="${index}">×</button>${propertyInput("Libellé",`option_${index}_label`,option.label||"")}${propertyInput("Emoji",`option_${index}_emoji`,option.emoji||"")}${propertyInput("Description",`option_${index}_description`,option.description||"")}${propertySelect("Condition d'accès",`option_${index}_access_type`,access.profession?"profession_level":"none",[["none","Toujours proposée"],["profession_level","Niveau de métier minimum"]])}${access.profession?propertyInput("Métier",`option_${index}_access_profession`,access.profession)+propertyInput("Niveau minimum",`option_${index}_access_minimum`,access.minimum||1,"number"):""}${interactionFields(option.interaction||{type:"navigate",page:state.interfaceDraft.start_page},`option_${index}_`)}</article>`}).join("")}</div>`;
}

function professionCatalog() {
  const byKey=new Map();
  for(const building of state.catalogs.building){
    for(const profession of building.payload.modules?.professions||[]){
      if(!profession.key)continue;
      const current=byKey.get(profession.key)||{key:profession.key,name:profession.name||profession.key,emoji:profession.emoji||"🛠️",buildings:[],definition:profession};
      current.buildings.push({key:building.entity_key,name:building.payload.name});byKey.set(profession.key,current);
    }
  }
  return [...byKey.values()].sort((a,b)=>a.name.localeCompare(b.name,"fr"));
}

function buildingRelationMarkup(payload,buildingKey,modules) {
  const localProfessions=modules.professions||[],knownProfessions=professionCatalog(),primary=payload.relations?.primary_profession_key||localProfessions[0]?.key||"";
  const assignedBots=state.catalogs.bot.filter(entity=>entity.payload.building_key===buildingKey),selectedBot=assignedBots[0]?.entity_key||"";
  const ambience=payload.relations?.ambience_audio_key||"";
  const itemKeys=new Set();
  for(const product of modules.products||[])if(product.item_key||product.resource)itemKeys.add(product.item_key||product.resource);
  for(const recipe of modules.recipes||[]){if(recipe.output_item||recipe.output_resource)itemKeys.add(recipe.output_item||recipe.output_resource);Object.keys(recipe.ingredients||{}).forEach(key=>itemKeys.add(key));}
  const itemNames=[...itemKeys].map(key=>itemDisplay(key)).filter(item=>!item.missing);
  return `<section class="building-relation-layout"><div class="building-relation-main"><div class="section-copy"><span class="step-dot">↔</span><div><h3>Relations du bâtiment</h3><p>Ces sélections utilisent les définitions existantes du Royaume.</p></div></div>
  <div class="relation-picker-grid"><article class="relation-picker"><span>🛠️</span><div><b>Métier principal</b><small>${localProfessions.length?`${localProfessions.length} métier(s) configuré(s)`:"Aucun métier associé"}</small></div><input data-entity-search="profession" placeholder="Rechercher un métier…"><select data-field="relation_primary_profession"><option value="">Aucun métier principal</option>${knownProfessions.map(item=>`<option value="${escapeHtml(item.key)}" ${item.key===primary?"selected":""}>${escapeHtml(`${item.emoji} ${item.name}`)}</option>`).join("")}</select><button type="button" class="secondary" id="create-related-profession">＋ Créer et associer</button></article>
  <article class="relation-picker"><span>🤖</span><div><b>Bot / PNJ Discord</b><small>${assignedBots.length?"Association active":"Aucun bot associé"}</small></div><input data-entity-search="bot" placeholder="Rechercher un bot…"><select data-field="relation_bot_key">${voiceBotOptions(selectedBot).map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===selectedBot?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select><div class="relation-actions"><button type="button" class="secondary" data-open-related="bot">Ouvrir</button><button type="button" class="danger-link" id="dissociate-building-bot" ${selectedBot?"":"disabled"}>Dissocier</button></div></article>
  <article class="relation-picker"><span>🔊</span><div><b>Ambiance globale</b><small>Une ambiance pour le salon vocal du bâtiment</small></div><input data-entity-search="ambience" placeholder="Rechercher une ambiance…"><select data-field="relation_ambience_key">${audioOptions(ambience,"ambience").map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===ambience?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select><div class="relation-actions"><button type="button" class="secondary" data-open-related="audio">Ouvrir Audio</button><button type="button" class="danger-link" id="remove-building-ambience" ${ambience?"":"disabled"}>Retirer</button></div></article></div></div>
  <aside class="building-relations-summary"><small>APERÇU DES RELATIONS</small><dl><div><dt>Métiers</dt><dd>${localProfessions.length?localProfessions.map(item=>escapeHtml(item.name||item.key)).join(", "):"Non configuré"}</dd></div><div><dt>Bot</dt><dd>${assignedBots.length?assignedBots.map(item=>escapeHtml(item.payload.name)).join(", "):"Non associé"}</dd></div><div><dt>Productions / objets</dt><dd>${itemNames.length?itemNames.slice(0,4).map(item=>`${escapeHtml(item.emoji)} ${escapeHtml(item.name)}`).join(" · "):"Aucun contenu"}</dd></div><div><dt>Ambiance</dt><dd>${ambience?escapeHtml(state.catalogs.audio.find(item=>item.entity_key===ambience)?.payload.name||ambience):"Aucune"}</dd></div><div><dt>Interface Discord</dt><dd>${state.interfaceDraft?.pages?.length||0} page(s)</dd></div></dl></aside></section>`;
}

function derivedBuildingRelationsMarkup(modules){
  const used=new Map(),produced=new Map(),consumed=new Map(),destinations=new Map(),add=(map,key,reason)=>{if(!key)return;if(!map.has(key))map.set(key,[]);if(!map.get(key).includes(reason))map.get(key).push(reason)};
  for(const profession of modules.professions||[])add(used,profession.required_item,`Outil du métier ${profession.name||profession.key}`);
  for(const activity of modules.activities||[]){add(used,activity.tool,`Outil de ${activity.name||activity.key}`);for(const outcome of activity.outcomes||[])for(const effect of outcome.effects||[])if(["reward","stock_reward"].includes(effect.type))add(produced,effect.resource||effect.item,`Produit dans ${activity.name||activity.key}`)}
  for(const recipe of modules.recipes||[]){Object.keys(recipe.ingredients||{}).forEach(key=>add(consumed,key,`Ingrédient de ${recipe.name||recipe.key}`));add(produced,recipe.output_item_key,`Produit par ${recipe.name||recipe.key}`)}
  for(const delivery of modules.deliveries||[]){const target=delivery.target_building_key||delivery.building;if(target){if(!destinations.has(target))destinations.set(target,[]);destinations.get(target).push(delivery.item_key||delivery.resource)}}
  const itemCards=(title,map)=>`<section><h4>${title}</h4><div class="derived-relation-grid">${[...map].map(([key,reasons])=>{const item=itemDisplay(key);return `<article><span>${item.emoji}</span><div><b>${escapeHtml(item.name)}</b>${reasons.map(reason=>`<small>${escapeHtml(reason)}</small>`).join("")}</div><button type="button" data-open-derived="item" data-key="${escapeHtml(key)}">Voir ↗</button></article>`}).join("")||'<p class="simple-empty">Aucune relation.</p>'}</div></section>`;
  return `<section class="derived-relations"><div class="section-copy"><span class="step-dot">⌁</span><div><small>RELATIONS DÉRIVÉES</small><h3>Relations calculées depuis le gameplay</h3><p>Aucune relation supplémentaire n’est stockée.</p></div></div>${itemCards("OBJETS UTILISÉS",used)}${itemCards("OBJETS PRODUITS",produced)}${itemCards("OBJETS CONSOMMÉS",consumed)}<section><h4>DESTINATIONS DE LIVRAISON</h4><div class="derived-relation-grid">${[...destinations].map(([key,items])=>{const building=state.catalogs.building.find(item=>item.entity_key===key);return `<article><span>${escapeHtml(building?.payload.emoji||"🏰")}</span><div><b>${escapeHtml(building?.payload.name||key)}</b><small>${items.length} ressource(s) livrée(s)</small></div><button type="button" data-open-derived="building" data-key="${escapeHtml(key)}">Voir ↗</button></article>`}).join("")||'<p class="simple-empty">Aucune destination.</p>'}</div></section></section>`;
}

function buildingOverviewMarkup(payload,buildingKey,modules){
  const professions=modules.professions||[],bot=state.catalogs.bot.find(item=>item.payload.building_key===buildingKey),ambienceKey=payload.relations?.ambience_audio_key||"",ambience=state.catalogs.audio.find(item=>item.entity_key===ambienceKey),productions=(modules.products||[]).length+(modules.recipes||[]).length,actions=(payload.actions||[]).length+(modules.activities||[]).length,pages=state.interfaceDraft?.pages?.length||0;
  const metric=(icon,label,value,empty="Non configuré")=>`<article><span>${icon}</span><small>${label}</small><b>${escapeHtml(value||empty)}</b></article>`;
  return `<section class="building-overview"><div class="building-overview-grid">${metric("🛠️","Métier principal",professions.find(item=>item.key===payload.relations?.primary_profession_key)?.name||professions[0]?.name)}${metric("🤖","Bot / PNJ",bot?.payload.name)}${metric("🔊","Ambiance",ambience?.payload.name)}${metric("📦","Productions",String(productions),"0")}${metric("⚡","Actions",String(actions),"0")}${metric("🧩","Pages Discord",String(pages),"0")}</div><div class="building-overview-actions"><button type="button" data-open-building-tab="mechanics">⚙️ Configurer le fonctionnement</button><button type="button" data-open-building-tab="visual">🧩 Modifier Discord</button><button type="button" data-open-building-tab="sound">🔊 Gérer l’audio</button><button type="button" data-open-building-tab="relations">↔ Gérer les relations</button></div></section>`;
}

function simpleAudioMarkup(payload,buildingKey,modules){
  const ambienceKey=payload.relations?.ambience_audio_key||"",ambience=state.catalogs.audio.find(item=>item.entity_key===ambienceKey),bots=state.catalogs.bot.filter(item=>item.payload.bot_type==="voice"&&item.payload.building_key===buildingKey),actions=(payload.actions||[]).map((action,index)=>({action,index,sounds:(action.effects||[]).filter(effect=>effect.type==="play_audio")})).filter(item=>!item.action.key.startsWith('claim_'));
  return `<section class="simple-audio-panel"><div class="simple-section-head"><div><small>AUDIO DU BÂTIMENT</small><h3>Ce qu’entendent les joueurs</h3><p>Une ambiance globale pour le salon vocal et des sons liés aux actions.</p></div><button type="button" data-open-audio-advanced>⚙ Audio avancé</button></div><div class="simple-audio-grid"><article><span>🌲</span><small>AMBIANCE GLOBALE</small><h4>${escapeHtml(ambience?.payload.name||"Aucune ambiance")}</h4><p>Groupe moteur : global_ambience</p><div><button type="button" data-change-ambience>Changer</button><button type="button" class="danger-link" data-remove-simple-ambience ${ambienceKey?"":"disabled"}>Retirer</button></div></article><article><span>🤖</span><small>BOT AUDIO</small><h4>${bots.length?bots.map(bot=>escapeHtml(bot.payload.name)).join(", "):"Aucun bot audio"}</h4><p>Salon vocal : ${escapeHtml(payload.name||buildingKey)}</p><button type="button" data-open-related="bot">${bots.length?"Ouvrir le bot":"Associer un bot"}</button></article></div><section class="simple-audio-actions"><div class="simple-section-head compact"><div><small>SONS DU GAMEPLAY</small><h3>Actions sonorisées</h3></div></div>${actions.map(({action,index,sounds})=>`<article><span>${escapeHtml(action.emoji||"🔊")}</span><div><b>${escapeHtml(action.name||action.key)}</b><small>${sounds.length?`${sounds.length} son(s) configuré(s)`:"Aucun son"}</small></div><button type="button" data-simple-sfx="${index}">${sounds.length?"Modifier":"Associer un son"}</button></article>`).join("")||'<p class="simple-empty">Aucune action pouvant recevoir un SFX.</p>'}</section></section>`;
}

function openSimpleSfxEditor(index){
  const element=$$("#actions > .action-builder")[index];if(!element)return;const effects=readEffects(element.querySelector('.action-effects')),audioEffects=effects.map((effect,i)=>({effect,i})).filter(item=>item.effect.type==="play_audio"),actionName=fieldValue("action_name",element)||`Action ${index+1}`,selected=audioEffects[0]?.effect.audio_key||"";
  const dialog=simpleDialog('simple-sfx-dialog','AUDIO › SONS DU GAMEPLAY',`🔊 ${escapeHtml(actionName)}`,`<div class="simple-zone-form"><label>Son<select name="audio">${audioOptions(selected,"sfx").map(([id,label])=>`<option value="${escapeHtml(id)}" ${id===selected?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><p class="field-note">Le son sera joué lors de l’exécution réussie de l’action par le bot vocal du bâtiment.</p>${audioEffects.length>1?`<p class="field-note">⚙ ${audioEffects.length-1} autre(s) effet(s) audio seront conservés.</p>`:""}<button type="button" class="danger-link" data-remove-simple-sfx ${selected?"":"disabled"}>Retirer le SFX</button><button type="button" class="secondary" data-sfx-advanced>Options avancées</button></div>`,(data,current)=>{const root=element.querySelector('.action-effects'),existing=root.querySelectorAll('.effect');if(audioEffects.length){const target=existing[audioEffects[0].i],typeField=target.querySelector('[data-field="effect_type"]');typeField.value='play_audio';typeField.dispatchEvent(new Event('change'));target.querySelector('[data-field="effect_audio_key"]').value=data.get('audio')}else if(data.get('audio'))addEffect(root,{type:'play_audio',audio_key:data.get('audio')});current.close();markEditorDirty();refreshSimpleAudio()});
  dialog.querySelector('[data-remove-simple-sfx]').onclick=()=>{if(audioEffects.length)element.querySelectorAll('.action-effects > .effect')[audioEffects[0].i]?.remove();dialog.close();markEditorDirty();refreshSimpleAudio()};dialog.querySelector('[data-sfx-advanced]').onclick=()=>{dialog.close();$('[data-building-tab="advanced"]').click();element.open=true;element.scrollIntoView({behavior:'smooth',block:'start'})};
}

function refreshSimpleAudio(){const panel=$('[data-building-panel="sound"]'),key=$("#key")?.value||"";if(!panel)return;panel.querySelector('.simple-audio-panel')?.remove();panel.insertAdjacentHTML('afterbegin',simpleAudioMarkup(buildPayload(),key,buildPayload().modules||{}));bindSimpleAudio()}
function bindSimpleAudio(){
  $('[data-change-ambience]')?.addEventListener('click',()=>{const current=fieldValue('relation_ambience_key'),dialog=simpleDialog('simple-ambience-dialog','AUDIO › AMBIANCE','🌲 Choisir une ambiance',`<div class="simple-zone-form"><input data-ambience-search placeholder="Rechercher une ambiance…"><label>Ambiance<select name="ambience">${audioOptions(current,'ambience').map(([id,label])=>`<option value="${escapeHtml(id)}" ${id===current?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><button type="button" class="secondary" data-open-audio-bank>Ouvrir la banque Audio</button></div>`,(data,currentDialog)=>{$('[data-field="relation_ambience_key"]').value=data.get('ambience');currentDialog.close();markEditorDirty();refreshSimpleAudio()});dialog.querySelector('[data-ambience-search]').oninput=event=>{const q=event.target.value.toLowerCase();[...dialog.querySelector('select').options].forEach((option,i)=>option.hidden=i>0&&!option.textContent.toLowerCase().includes(q))};dialog.querySelector('[data-open-audio-bank]').onclick=()=>{dialog.close();closeEditor();navigateTo('audio')}});
  $('[data-remove-simple-ambience]')?.addEventListener('click',()=>{$('[data-field="relation_ambience_key"]').value='';markEditorDirty();refreshSimpleAudio()});
  $$('[data-simple-sfx]').forEach(button=>button.onclick=()=>openSimpleSfxEditor(Number(button.dataset.simpleSfx)));$('[data-open-audio-advanced]')?.addEventListener('click',()=>{$('[data-building-tab="advanced"]').click()});
  $('[data-building-panel="sound"] [data-open-related="bot"]')?.addEventListener('click',()=>{closeEditor();navigateTo('bot')});
}

function mechanicIcon(name="") { const value=name.toLowerCase();if(/chass|hunt/.test(value))return "🏹";if(/forge|forger|smith/.test(value))return "⚒️";if(/cuis|boul|cook|baker/.test(value))return "🍳";if(/mine|minier/.test(value))return "⛏️";return "🪓"; }
function effectResourceSummary(effect){const resource=effect.resource||effect.item||effect.item_key||effect.audio_key||effect.event||"Effet avancé",display=itemDisplay(resource);return `${display.missing?"⚙️":display.emoji} ${display.missing?resource:display.name}`;}
function gameplayProjection(){
  const professions=readProfessionModules(),activities=readActivityModules(),deliveries=readDeliveryModules().map(delivery=>({...delivery,resource:delivery.item_key||delivery.resource})),products=readProductModules(),recipes=readRecipeModules();
  const activityKeys=new Set(activities.flatMap(activity=>[activity.key,`claim_${activity.key}`]));
  const customActions=$$('#actions > .action-builder').map((element,index)=>({element,index,key:fieldValue("action_key",element),name:fieldValue("action_name",element)||`Action ${index+1}`,emoji:fieldValue("action_emoji",element)||"⚡"})).filter(action=>{
    if(activityKeys.has(action.key)||/^(join|leave|claim|deliver)(_|$)/.test(action.key))return false;
    const effectTypes=readEffects(action.element.querySelector('.action-effects')).map(effect=>effect.type);
    return !effectTypes.some(type=>["profession","schedule","claim_scheduled","deliver_inventory"].includes(type));
  });
  const mechanics=professions.map((profession,index)=>{const zones=activities.map((zone,zoneIndex)=>({...zone,zoneIndex})).filter(zone=>zone.profession===profession.key),results=zones.reduce((sum,zone)=>sum+zone.outcomes.length,0),tool=zones.find(zone=>zone.tool)?.tool||profession.required_item,toolName=tool?itemDisplay(tool).name:"Aucun";return `<article class="simple-mechanic-card"><header><span>${mechanicIcon(profession.name)}</span><div><small>TRAVAIL / ACTIVITÉ</small><h4>${escapeHtml(profession.name||profession.key)}</h4></div><button type="button" data-simple-profession="${index}">Configurer</button></header><div class="mechanic-stats"><span><b>${zones.length}</b> zone(s)</span><span><b>${results}</b> résultat(s)</span><span><b>${escapeHtml(toolName)}</b> outil</span></div><div class="simple-zone-list">${zones.map(zone=>`<button type="button" data-simple-zone="${zone.zoneIndex}"><span>${zone.emoji||"🌿"}</span><b>${escapeHtml(zone.name||zone.key)}</b><small>${zone.duration_seconds||0} sec · ${zone.energy_cost||0} énergie · ${zone.outcomes.length} résultat(s)</small><i>›</i></button>`).join("")||'<p class="simple-empty">Aucune zone pour ce métier.</p>'}</div><button type="button" class="secondary add-simple-zone" data-add-simple-zone="${escapeHtml(profession.key)}">＋ Ajouter une zone</button></article>`;}).join("");
  const exchanges=[...deliveries.map((delivery,index)=>`<article class="simple-exchange-card"><span>📦</span><div><small>LIVRAISON</small><b>${escapeHtml(itemDisplay(delivery.resource).name)}</b><p>${escapeHtml(delivery.source||"Inventaire joueur")} <i>→</i> ${escapeHtml(delivery.destination||"Stock bâtiment")}</p></div><button type="button" data-open-advanced-section="delivery-modules">Configurer</button></article>`),...products.map(product=>`<article class="simple-exchange-card"><span>🛒</span><div><small>PRODUIT</small><b>${escapeHtml(itemDisplay(product.item_key||product.resource).name)}</b><p>Commerce du bâtiment</p></div><button type="button" data-open-advanced-section="product-modules">Configurer</button></article>`),...recipes.map(recipe=>`<article class="simple-exchange-card"><span>⚒️</span><div><small>RECETTE</small><b>${escapeHtml(recipe.name||recipe.key)}</b><p>${Object.keys(recipe.ingredients||{}).length} ingrédient(s) · ${recipe.duration_seconds||0} sec</p></div><button type="button" data-open-advanced-section="recipe-modules">Configurer</button></article>`)].join("");
  const generatedCount=professions.length*2+activities.length*2+(deliveries.length?1:0);
  return `<section class="simple-gameplay"><div class="simple-section-head"><div><small>QUE PEUT-ON FAIRE ICI ?</small><h3>Mécaniques de gameplay</h3><p>Les actions techniques nécessaires restent générées automatiquement.</p></div><button type="button" class="primary" id="add-simple-mechanic">＋ Ajouter une mécanique</button></div><div class="simple-mechanic-grid">${mechanics||'<div class="simple-empty-state"><b>Aucune mécanique de travail.</b><span>Ajoutez un métier pour commencer.</span></div>'}</div><div class="simple-section-head compact"><div><small>AUTRES INTERACTIONS</small><h3>Actions personnalisées</h3></div></div><div class="simple-action-list">${customActions.map(action=>`<button type="button" data-simple-action="${action.index}"><span>${escapeHtml(action.emoji)}</span><b>${escapeHtml(action.name)}</b><small>Action créée par le concepteur</small><i>Configurer ›</i></button>`).join("")||'<p class="simple-empty">Aucune action personnalisée.</p>'}</div><div class="simple-section-head compact"><div><small>PRODUCTIONS & ÉCHANGES</small><h3>Flux du bâtiment</h3></div></div><div class="simple-exchange-grid">${exchanges||'<p class="simple-empty">Aucune production, recette ou livraison configurée.</p>'}</div><aside class="technical-generation"><span>⚙️</span><div><b>Configuration technique générée</b><small>${generatedCount} action(s) technique(s) estimée(s) · ${professions.length} métier(s) · ${activities.length} zone(s) · ${customActions.length} action(s) personnalisée(s)</small></div><button type="button" data-gameplay-mode="advanced">Gérer en mode avancé</button></aside></section>`;
}

function openSimpleZoneEditor(index,discardOnCancel=false){
  const activityElement=$$("#activity-modules > .activity-module")[index];if(!activityElement)return;
  let dialog=$("#simple-zone-dialog");if(!dialog){dialog=document.createElement("dialog");dialog.id="simple-zone-dialog";document.body.append(dialog)}
  const activity=readActivityModules()[index],professionOptions=readProfessionModules().map(item=>`<option value="${escapeHtml(item.key)}" ${item.key===activity.profession?"selected":""}>${escapeHtml(item.name||item.key)}</option>`).join(""),totalWeight=activity.outcomes.reduce((sum,item)=>sum+Number(item.weight||0),0);
  dialog.innerHTML=`<form method="dialog"><div class="dialog-head"><div><small>MODE SIMPLE · ZONE</small><h2>${escapeHtml(activity.emoji||"🌿")} ${escapeHtml(activity.name||activity.key)}</h2></div><button value="cancel">×</button></div><div class="simple-zone-form"><label>Nom visible<input name="name" value="${escapeHtml(activity.name||"")}" required></label><div class="form-grid"><label>Métier<select name="profession">${professionOptions}</select></label><label>Durée en secondes<input name="duration" type="number" min="0" value="${activity.duration_seconds||0}"></label><label>Coût énergétique<input name="energy" type="number" min="0" value="${activity.energy_cost||0}"></label><label>Niveau requis<input name="level" type="number" min="0" value="${activity.required_level||0}"></label><label>Outil requis<select name="tool">${catalogOptions("item",activity.tool||"").map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===activity.tool?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><label>Usure de l’outil<input name="durability" type="number" min="0" value="${activity.durability_cost||0}"></label></div><section class="simple-results"><div><h3>Résultats possibles</h3><small>Les pourcentages sont informatifs ; le moteur conserve les poids.</small></div>${activity.outcomes.map((outcome,outcomeIndex)=>{const simple=outcome.effects.length===1&&["reward","cost","stock_reward"].includes(outcome.effects[0]?.type);return `<article><span>${effectResourceSummary(outcome.effects[0]||{})}</span><b>Poids ${outcome.weight}</b><small>≈ ${totalWeight?Math.round(Number(outcome.weight||0)*100/totalWeight):0} %</small><em>${simple?"Résultat simple":`⚙ ${outcome.effects.length} effets`}</em><div><button type="button" data-edit-simple-result="${outcomeIndex}">${simple?"Modifier":"Voir"}</button><button type="button" class="danger-link" data-delete-simple-result="${outcomeIndex}">Supprimer</button></div></article>`}).join("")||'<p class="simple-empty">Aucun résultat configuré.</p>'}<button type="button" class="secondary" id="add-simple-result">＋ Ajouter un résultat</button><button type="button" class="secondary" id="zone-advanced-results">Configurer les résultats avancés</button></section></div><div class="actions"><button value="cancel">Annuler</button><button value="save" class="primary">Appliquer</button></div></form>`;dialog.showModal();
  const syncSimpleZoneFields=()=>{const data=new FormData(dialog.querySelector("form"));activityElement.querySelector('[data-field="module_activity_name"]').value=data.get("name");activityElement.querySelector('[data-field="module_activity_profession"]').value=data.get("profession");activityElement.querySelector('[data-field="module_activity_duration"]').value=data.get("duration");activityElement.querySelector('[data-field="module_activity_energy"]').value=data.get("energy");activityElement.querySelector('[data-field="module_activity_level"]').value=data.get("level");activityElement.querySelector('[data-field="module_activity_tool"]').value=data.get("tool");activityElement.querySelector('[data-field="module_activity_durability"]').value=data.get("durability");markEditorDirty()};
  const cancelZoneCreation=event=>{event?.preventDefault();dialog.close();if(discardOnCancel){activityElement.remove();refreshSimpleGameplay()}};
  dialog.querySelectorAll('[value="cancel"]').forEach(button=>button.onclick=cancelZoneCreation);
  dialog.oncancel=cancelZoneCreation;
  $("#zone-advanced-results").onclick=()=>{syncSimpleZoneFields();dialog.close();switchGameplayMode("advanced");activityElement.open=true;activityElement.scrollIntoView({behavior:"smooth",block:"start"})};
  dialog.querySelectorAll('[data-edit-simple-result]').forEach(button=>button.onclick=()=>{syncSimpleZoneFields();openSimpleResultEditor(index,Number(button.dataset.editSimpleResult),()=>openSimpleZoneEditor(index))});
  dialog.querySelectorAll('[data-delete-simple-result]').forEach(button=>button.onclick=()=>{if(!confirm("Supprimer ce résultat de cette zone ?"))return;activityElement.querySelectorAll('.outcome-modules > .outcome-module')[Number(button.dataset.deleteSimpleResult)]?.remove();openSimpleZoneEditor(index);markEditorDirty()});
  $("#add-simple-result").onclick=()=>{syncSimpleZoneFields();addOutcomeModule(activityElement.querySelector('.outcome-modules'),{key:"",weight:1,effects:[{type:"reward",resource:"",amount:[1,1]}]});openSimpleResultEditor(index,activityElement.querySelectorAll('.outcome-modules > .outcome-module').length-1,()=>openSimpleZoneEditor(index))};
  dialog.querySelector("form").onsubmit=event=>{if(event.submitter?.value!=="save")return;event.preventDefault();const data=new FormData(event.currentTarget);activityElement.querySelector('[data-field="module_activity_name"]').value=data.get("name");activityElement.querySelector('[data-field="module_activity_profession"]').value=data.get("profession");activityElement.querySelector('[data-field="module_activity_duration"]').value=data.get("duration");activityElement.querySelector('[data-field="module_activity_energy"]').value=data.get("energy");activityElement.querySelector('[data-field="module_activity_level"]').value=data.get("level");activityElement.querySelector('[data-field="module_activity_tool"]').value=data.get("tool");activityElement.querySelector('[data-field="module_activity_durability"]').value=data.get("durability");dialog.close();refreshSimpleGameplay();markEditorDirty()};
}

function openSimpleResultEditor(activityIndex,outcomeIndex,onClose){
  const activityElement=$$("#activity-modules > .activity-module")[activityIndex],outcomeElement=activityElement?.querySelectorAll('.outcome-modules > .outcome-module')[outcomeIndex];if(!outcomeElement)return;const outcome=readActivityModules()[activityIndex].outcomes[outcomeIndex],effect=outcome.effects[0]||{},simple=outcome.effects.length===1&&["reward","cost","stock_reward"].includes(effect.type);
  if(!simple){$("#simple-zone-dialog")?.close();switchGameplayMode("advanced");activityElement.open=true;outcomeElement.open=true;activityElement.scrollIntoView({behavior:"smooth",block:"start"});return}
  let dialog=$("#simple-result-dialog");if(!dialog){dialog=document.createElement("dialog");dialog.id="simple-result-dialog";document.body.append(dialog)}const amount=effect.amount??1,min=Array.isArray(amount)?amount[0]:amount,max=Array.isArray(amount)?amount[1]:amount;
  $("#simple-zone-dialog")?.close();dialog.innerHTML=`<form method="dialog"><div class="dialog-head"><div><small>MODE SIMPLE · RÉSULTAT</small><h2>${effectResourceSummary(effect)}</h2></div><button value="cancel">×</button></div><div class="simple-zone-form"><label>Type<select name="type"><option value="reward" ${effect.type==="reward"?"selected":""}>Donner au joueur</option><option value="stock_reward" ${effect.type==="stock_reward"?"selected":""}>Ajouter au stock</option><option value="cost" ${effect.type==="cost"?"selected":""}>Retirer au joueur</option></select></label><label>Objet ou ressource<select name="resource">${catalogOptions("item",effect.resource||effect.item||"").map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===(effect.resource||effect.item)?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><div class="form-grid"><label>Quantité minimum<input name="minimum" type="number" value="${min}"></label><label>Quantité maximum<input name="maximum" type="number" value="${max}"></label><label>Poids<input name="weight" type="number" min="0.01" step="0.01" value="${outcome.weight||1}"></label></div><p class="field-note">Le moteur conserve le poids. La probabilité sera recalculée avec les autres résultats.</p></div><div class="actions"><button value="cancel">Annuler</button><button value="save" class="primary">Appliquer</button></div></form>`;dialog.showModal();dialog.querySelector("form").onsubmit=event=>{if(event.submitter?.value!=="save")return;event.preventDefault();const data=new FormData(event.currentTarget),effectElement=outcomeElement.querySelector('.outcome-effects > .outcome-effect'),typeField=effectElement.querySelector('[data-field="outcome_effect_type"]');typeField.value=data.get("type");typeField.dispatchEvent(new Event("change"));const refreshed=outcomeElement.querySelector('.outcome-effects > .outcome-effect');refreshed.querySelector('[data-field="outcome_effect_resource"]').value=data.get("resource");refreshed.querySelector('[data-field="outcome_effect_min"]').value=data.get("minimum");refreshed.querySelector('[data-field="outcome_effect_max"]').value=data.get("maximum");outcomeElement.querySelector('[data-field="module_outcome_weight"]').value=data.get("weight");dialog.close();markEditorDirty();onClose?.()};
}

// A weighted outcome may combine a tangible reward with XP, messages or events.
// Simple mode edits the tangible effect and preserves every companion effect.
function openSimpleResultEditor(activityIndex,outcomeIndex,onClose){
  const activityElement=$$("#activity-modules > .activity-module")[activityIndex];
  const outcomeElement=activityElement?.querySelectorAll('.outcome-modules > .outcome-module')[outcomeIndex];
  if(!outcomeElement)return;
  const outcome=readActivityModules()[activityIndex].outcomes[outcomeIndex];
  const editableTypes=["reward","cost","stock_reward"];
  const effectIndex=outcome.effects.findIndex(effect=>editableTypes.includes(effect.type));
  if(effectIndex<0){
    $("#simple-zone-dialog")?.close();switchGameplayMode("advanced");activityElement.open=true;outcomeElement.open=true;
    activityElement.scrollIntoView({behavior:"smooth",block:"start"});return;
  }
  const effect=outcome.effects[effectIndex];
  let dialog=$("#simple-result-dialog");
  if(!dialog){dialog=document.createElement("dialog");dialog.id="simple-result-dialog";document.body.append(dialog)}
  const amount=effect.amount??1,min=Array.isArray(amount)?amount[0]:amount,max=Array.isArray(amount)?amount[1]:amount;
  const companionCount=Math.max(0,outcome.effects.length-1);
  $("#simple-zone-dialog")?.close();
  dialog.innerHTML=`<form method="dialog"><div class="dialog-head"><div><small>MODE SIMPLE · RÉSULTAT</small><h2>${effectResourceSummary(effect)}</h2></div><button value="cancel">×</button></div><div class="simple-zone-form"><label>Type<select name="type"><option value="reward" ${effect.type==="reward"?"selected":""}>Donner au joueur</option><option value="stock_reward" ${effect.type==="stock_reward"?"selected":""}>Ajouter au stock</option><option value="cost" ${effect.type==="cost"?"selected":""}>Retirer au joueur</option></select></label><label>Objet ou ressource<select name="resource">${catalogOptions("item",effect.resource||effect.item||"").map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===(effect.resource||effect.item)?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><div class="form-grid"><label>Quantité minimum<input name="minimum" type="number" value="${min}"></label><label>Quantité maximum<input name="maximum" type="number" value="${max}"></label><label>Poids<input name="weight" type="number" min="0.01" step="0.01" value="${outcome.weight||1}"></label></div>${companionCount?`<p class="field-note">${companionCount} autre(s) effet(s), comme l’expérience ou un message, seront conservés sans modification.</p>`:""}<p class="field-note">Le moteur conserve le poids. La probabilité sera recalculée avec les autres résultats.</p></div><div class="actions"><button value="cancel">Annuler</button><button value="save" class="primary">Appliquer</button></div></form>`;
  dialog.showModal();
  dialog.querySelector("form").onsubmit=event=>{
    if(event.submitter?.value!=="save")return;event.preventDefault();
    const data=new FormData(event.currentTarget),effectElement=outcomeElement.querySelectorAll('.outcome-effects > .outcome-effect')[effectIndex];
    const typeField=effectElement.querySelector('[data-field="outcome_effect_type"]');typeField.value=data.get("type");typeField.dispatchEvent(new Event("change"));
    const refreshed=outcomeElement.querySelectorAll('.outcome-effects > .outcome-effect')[effectIndex];
    refreshed.querySelector('[data-field="outcome_effect_resource"]').value=data.get("resource");
    refreshed.querySelector('[data-field="outcome_effect_min"]').value=data.get("minimum");
    refreshed.querySelector('[data-field="outcome_effect_max"]').value=data.get("maximum");
    outcomeElement.querySelector('[data-field="module_outcome_weight"]').value=data.get("weight");
    dialog.close();markEditorDirty();onClose?.();
  };
}

function openSimpleProfessionEditor(index){
  const element=$$("#profession-modules > .module-card")[index],profession=readProfessionModules()[index];if(!element)return;let dialog=$("#simple-profession-dialog");if(!dialog){dialog=document.createElement("dialog");dialog.id="simple-profession-dialog";document.body.append(dialog)}const zones=readActivityModules().filter(item=>item.profession===profession.key);
  dialog.innerHTML=`<form method="dialog"><div class="dialog-head"><div><small>MODE SIMPLE · MÉTIER</small><h2>${mechanicIcon(profession.name)} ${escapeHtml(profession.name)}</h2></div><button value="cancel">×</button></div><div class="simple-zone-form"><label>Nom du métier<input name="name" value="${escapeHtml(profession.name)}" required></label><label>Outil principal<select name="tool">${catalogOptions("item",profession.required_item||"").map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===profession.required_item?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><label class="check"><input name="grant" type="checkbox" ${profession.grant_required_item?"checked":""}><span>Donner automatiquement l’outil</span></label><section class="simple-results"><div><h3>Zones accessibles</h3><small>${zones.length} zone(s) utilisent ce métier.</small></div>${zones.map(zone=>`<article><span>${escapeHtml(zone.emoji||"🌿")} ${escapeHtml(zone.name)}</span><small>${zone.duration_seconds}s · ${zone.energy_cost} énergie</small></article>`).join("")||'<p class="simple-empty">Aucune zone.</p>'}</section></div><div class="actions"><button value="cancel">Annuler</button><button value="save" class="primary">Appliquer</button></div></form>`;dialog.showModal();dialog.querySelector("form").onsubmit=event=>{if(event.submitter?.value!=="save")return;event.preventDefault();const data=new FormData(event.currentTarget);element.querySelector('[data-field="module_profession_name"]').value=data.get("name");element.querySelector('[data-field="module_profession_item"]').value=data.get("tool");element.querySelector('[data-field="module_profession_grant"]').checked=data.get("grant")==="on";dialog.close();refreshSimpleGameplay();markEditorDirty()};
}

function openSimpleActionEditor(index){
  const element=$$("#actions > .action-builder")[index];if(!element)return;let dialog=$("#simple-action-dialog");if(!dialog){dialog=document.createElement("dialog");dialog.id="simple-action-dialog";document.body.append(dialog)}const name=fieldValue("action_name",element),emoji=fieldValue("action_emoji",element),effects=readEffects(element.querySelector('.action-effects'));
  dialog.innerHTML=`<form method="dialog"><div class="dialog-head"><div><small>MODE SIMPLE · ACTION</small><h2>${escapeHtml(emoji||"⚡")} ${escapeHtml(name)}</h2></div><button value="cancel">×</button></div><div class="simple-zone-form"><label>Nom affiché<input name="name" value="${escapeHtml(name)}" required></label><label>Icône<input name="emoji" value="${escapeHtml(emoji)}"></label><label class="check"><input name="enabled" type="checkbox" ${fieldValue("action_enabled",element)?"checked":""}><span>Disponible pour les joueurs</span></label><section class="simple-results"><div><h3>Résultats</h3><small>${effects.length} effet(s). L’identifiant technique reste inchangé.</small></div>${effects.slice(0,5).map(effect=>`<article><span>${escapeHtml(effectResourceSummary(effect))}</span><small>${escapeHtml(effect.type)}</small></article>`).join("")||'<p class="simple-empty">Aucun résultat.</p>'}<button type="button" class="secondary" id="simple-action-advanced">Configurer les effets avancés</button></section></div><div class="actions"><button value="cancel">Annuler</button><button value="save" class="primary">Appliquer</button></div></form>`;dialog.showModal();$("#simple-action-advanced").onclick=()=>{dialog.close();switchGameplayMode("advanced");element.open=true;element.scrollIntoView({behavior:"smooth",block:"start"})};dialog.querySelector('form').onsubmit=event=>{if(event.submitter?.value!=="save")return;event.preventDefault();const data=new FormData(event.currentTarget);element.querySelector('[data-field="action_name"]').value=data.get("name");element.querySelector('[data-field="action_emoji"]').value=data.get("emoji");element.querySelector('[data-field="action_enabled"]').checked=data.get("enabled")==="on";dialog.close();refreshSimpleGameplay();markEditorDirty()};
}

function simpleDialog(id,eyebrow,title,content,onApply){
  let dialog=$("#"+id);if(!dialog){dialog=document.createElement("dialog");dialog.id=id;dialog.className="simple-building-dialog";document.body.append(dialog)}
  dialog.innerHTML=`<form method="dialog"><div class="dialog-head"><div><small>${eyebrow}</small><h2>${title}</h2></div><button type="button" data-local-cancel>×</button></div>${content}<div class="actions"><button type="button" data-local-cancel>Annuler</button><button value="save" class="primary">Appliquer au brouillon</button></div></form>`;
  dialog.querySelectorAll('[data-local-cancel]').forEach(button=>button.onclick=()=>dialog.close());dialog.oncancel=()=>dialog.close();
  dialog.querySelector('form').onsubmit=event=>{event.preventDefault();if(event.submitter?.value!=="save")return;onApply(new FormData(event.currentTarget),dialog)};dialog.showModal();return dialog;
}

function bindContextualItemCreation(dialog){
  dialog.querySelectorAll('select[name="output"],select[name="item"],select[name="ingredient_item"]').forEach(selectField=>{if(selectField.nextElementSibling?.matches('[data-create-context-item]'))return;const button=document.createElement('button');button.type='button';button.className='secondary';button.dataset.createContextItem='';button.textContent='＋ Créer un objet';selectField.after(button);button.onclick=()=>openContextualItemCreator(selectField)});
}

function openContextualItemCreator(targetSelect){
  return simpleDialog('context-item-dialog','CRÉATION CONTEXTUELLE','📦 Créer un objet',`<div class="simple-zone-form"><label>Nom<input name="name" required></label><label>Type<select name="type"><option value="resource">Ressource</option><option value="tool">Outil</option><option value="consumable">Consommable</option><option value="equipment">Équipement</option></select></label><label>Description<textarea name="description" rows="3"></textarea></label><div class="form-grid"><label>Emoji<input name="emoji" value="📦"></label><label>Valeur de base<input name="price" type="number" min="0" value="0"></label></div><label class="check"><input name="stackable" type="checkbox" checked><span>Objet empilable</span></label></div>`,async(data,current)=>{const name=String(data.get('name')||'').trim(),key=technicalKey(name,'objet'),payload={name,emoji:data.get('emoji')||'📦',description:data.get('description')||'',category:data.get('type')||'resource',type:data.get('type')||'resource',stackable:data.get('stackable')==='on',price:Number(data.get('price')||0)};const response=await fetch(`/api/content/item/${encodeURIComponent(key)}`,{method:'POST',headers,body:JSON.stringify({payload,expected_version:null})});if(!response.ok){alert((await response.json()).detail||'Création impossible.');return}const saved=await response.json();state.catalogs.item.push({...saved,payload});const option=document.createElement('option');option.value=key;option.textContent=`${payload.emoji} ${payload.name}`;option.selected=true;targetSelect.append(option);targetSelect.value=key;current.close();markEditorDirty()});
}

function openContextualLocationCreator(targetSelect){
  return simpleDialog('context-location-dialog','CRÉATION CONTEXTUELLE','📍 Créer un lieu',`<div class="simple-zone-form"><label>Nom<input name="name" required></label><label>Type<select name="type"><option value="city">Ville</option><option value="village">Village</option><option value="forest">Forêt</option><option value="wilderness">Zone sauvage</option><option value="place">Lieu</option><option value="gate">Porte</option></select></label><label>Appartient à<select name="parent">${locationOptions('').map(([key,label])=>`<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('')}</select></label><label>Description<textarea name="description" rows="3"></textarea></label><label>Emoji<input name="emoji" value="📍"></label></div>`,async(data,current)=>{const name=String(data.get('name')||'').trim(),key=technicalKey(name,'lieu'),payload={name,emoji:data.get('emoji')||'📍',description:data.get('description')||'',location_type:data.get('type')||'place',parent_key:data.get('parent')||'',tags:[],connections:[],map:{x:0,y:0}};const response=await fetch(`/api/content/location/${encodeURIComponent(key)}`,{method:'POST',headers,body:JSON.stringify({payload,expected_version:null})});if(!response.ok){alert((await response.json()).detail||'Création impossible.');return}const saved=await response.json();state.catalogs.location.push({...saved,payload});const option=document.createElement('option');option.value=key;option.textContent=`${payload.emoji} ${payload.name}`;option.selected=true;targetSelect.append(option);targetSelect.value=key;current.close();markEditorDirty()});
}

function openSimpleRecipeEditor(index,created=false){
  const element=$$("#recipe-modules > .recipe-module")[index];if(!element)return;const recipe=readRecipeModules()[index],original=JSON.parse(element.dataset.original||"{}"),advancedCount=[original.hooks,original.conditions,original.outputs].filter(Boolean).length;
  const ingredientRows=Object.entries(recipe.ingredients||{}).map(([key,amount])=>`<div class="simple-ingredient-row"><label>Objet<select name="ingredient_item">${catalogOptions("item",key).map(([id,label])=>`<option value="${escapeHtml(id)}" ${id===key?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><label>Quantité<input name="ingredient_amount" type="number" min="1" value="${amount}"></label><button type="button" class="danger-link" data-remove-simple-row>Supprimer</button></div>`).join("");
  const dialog=simpleDialog("simple-recipe-dialog","FONCTIONNEMENT › RECETTES",`🍲 ${escapeHtml(recipe.name||"Nouvelle recette")}`,`<div class="simple-zone-form"><label>Nom visible<input name="name" value="${escapeHtml(recipe.name||"")}" required></label><label>Produit obtenu<select name="output">${catalogOptions("item",recipe.output_item_key||"").map(([id,label])=>`<option value="${escapeHtml(id)}" ${id===recipe.output_item_key?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><div class="form-grid"><label>Quantité produite<input name="output_quantity" type="number" min="1" value="${recipe.output_quantity||1}"></label><label>Destination<select name="destination"><option value="building_stock" ${recipe.output_destination==="building_stock"?"selected":""}>Stock du bâtiment</option><option value="player" ${recipe.output_destination==="player"?"selected":""}>Inventaire du joueur</option></select></label><label>Durée en secondes<input name="duration" type="number" min="0" value="${recipe.duration_seconds||0}"></label><label>Niveau requis<input name="level" type="number" min="1" value="${recipe.required_level||1}"></label><label>Coût énergétique<input name="energy" type="number" min="0" value="${recipe.energy_cost||0}"></label><label>Métier<select name="profession">${professionOptions(recipe.profession||"").map(([id,label])=>`<option value="${escapeHtml(id)}" ${id===recipe.profession?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label></div><section class="simple-results"><div><h3>Ingrédients</h3><small>Objets retirés du stock lors de la fabrication.</small></div><div data-simple-ingredients>${ingredientRows}</div><button type="button" class="secondary" data-add-simple-ingredient>＋ Ajouter un ingrédient</button></section>${advancedCount?`<p class="field-note">⚙ ${advancedCount} configuration(s) avancée(s) seront conservées.</p>`:""}<button type="button" class="danger-link" data-delete-simple-recipe>Supprimer la recette</button></div>`,(data,current)=>{
    element.querySelector('[data-field="recipe_name"]').value=data.get("name");element.querySelector('[data-field="recipe_output"]').value=data.get("output");element.querySelector('[data-field="recipe_output_quantity"]').value=data.get("output_quantity");element.querySelector('[data-field="recipe_destination"]').value=data.get("destination");element.querySelector('[data-field="recipe_duration"]').value=data.get("duration");element.querySelector('[data-field="recipe_level"]').value=data.get("level");element.querySelector('[data-field="recipe_energy"]').value=data.get("energy");element.querySelector('[data-field="recipe_profession"]').value=data.get("profession");const root=element.querySelector('.recipe-ingredients');root.innerHTML="";const items=data.getAll("ingredient_item"),amounts=data.getAll("ingredient_amount");items.forEach((key,i)=>{if(key)addRecipeIngredient(root,key,amounts[i]||1)});current.close();markEditorDirty();refreshSimpleGameplay();
  });
  const addRow=()=>{dialog.querySelector('[data-simple-ingredients]').insertAdjacentHTML('beforeend',`<div class="simple-ingredient-row"><label>Objet<select name="ingredient_item">${catalogOptions("item","").map(([id,label])=>`<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join("")}</select></label><label>Quantité<input name="ingredient_amount" type="number" min="1" value="1"></label><button type="button" class="danger-link" data-remove-simple-row>Supprimer</button></div>`);bindRows();bindContextualItemCreation(dialog)};const bindRows=()=>dialog.querySelectorAll('[data-remove-simple-row]').forEach(button=>button.onclick=()=>button.closest('.simple-ingredient-row').remove());bindRows();bindContextualItemCreation(dialog);dialog.querySelector('[data-add-simple-ingredient]').onclick=addRow;dialog.querySelector('[data-delete-simple-recipe]').onclick=()=>{if(confirm("Supprimer cette recette du brouillon ?")){element.remove();dialog.close();markEditorDirty();refreshSimpleGameplay()}};if(created)dialog.querySelectorAll('[data-local-cancel]').forEach(button=>button.onclick=()=>{element.remove();dialog.close();refreshSimpleGameplay()});
}

function openSimpleDeliveryEditor(index,created=false){
  const element=$$("#delivery-modules > .delivery-module")[index];if(!element)return;const delivery=readDeliveryModules()[index],original=JSON.parse(element.dataset.original||"{}"),advancedCount=(original.conditions?1:0)+(original.events?1:0)+(Number(original.unit_price||0)>0?1:0);
  const dialog=simpleDialog("simple-delivery-dialog","FONCTIONNEMENT › LIVRAISONS","📦 Livraison",`<div class="simple-zone-form"><label>Objet transféré<select name="item">${catalogOptions("item",delivery.item_key||"").map(([id,label])=>`<option value="${escapeHtml(id)}" ${id===delivery.item_key?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><div class="delivery-flow-preview"><span>Inventaire joueur</span><b>→ ${escapeHtml(itemDisplay(delivery.item_key).name)} →</b><span>Stock du bâtiment</span></div><div class="form-grid"><label>Depuis<select name="source"><option value="player_inventory">Inventaire du joueur</option></select></label><label>Vers quel bâtiment<select name="building">${catalogOptions("building",delivery.target_building_key||"").map(([id,label])=>`<option value="${escapeHtml(id)}" ${id===delivery.target_building_key?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><label>Stock destinataire<select name="destination"><option value="building_stock">Stock du bâtiment</option><option value="player_inventory" ${delivery.destination==="player_inventory"?"selected":""}>Inventaire joueur</option></select></label><label>Quantité minimum<input name="minimum" type="number" min="1" value="${delivery.minimum_quantity||1}"></label><label>Quantité maximum<input name="maximum" type="number" min="0" value="${delivery.maximum_quantity||0}"></label></div>${advancedCount?`<p class="field-note">⚙ ${advancedCount} réglage(s) avancé(s) seront conservés.</p>`:""}<button type="button" class="danger-link" data-delete-simple-delivery>Supprimer la livraison</button></div>`,(data,current)=>{element.querySelector('[data-field="delivery_resource"]').value=data.get("item");element.querySelector('[data-field="delivery_source"]').value=data.get("source");element.querySelector('[data-field="delivery_destination"]').value=data.get("destination");element.querySelector('[data-field="delivery_building"]').value=data.get("building");element.querySelector('[data-field="delivery_min"]').value=data.get("minimum");element.querySelector('[data-field="delivery_max"]').value=data.get("maximum");current.close();markEditorDirty();refreshSimpleGameplay()});
  bindContextualItemCreation(dialog);dialog.querySelector('[data-delete-simple-delivery]').onclick=()=>{if(confirm("Supprimer cette livraison du brouillon ?")){element.remove();dialog.close();markEditorDirty();refreshSimpleGameplay()}};if(created)dialog.querySelectorAll('[data-local-cancel]').forEach(button=>button.onclick=()=>{element.remove();dialog.close();refreshSimpleGameplay()});
}

function openSimpleProductEditor(index,created=false){const element=$$("#product-modules > .product-module")[index];if(!element)return;const product=readProductModules()[index];const dialog=simpleDialog("simple-product-dialog","FONCTIONNEMENT › PRODUCTIONS","🛒 Produit",`<div class="simple-zone-form"><label>Objet<select name="item">${catalogOptions("item",product.item_key||"").map(([id,label])=>`<option value="${escapeHtml(id)}" ${id===product.item_key?"selected":""}>${escapeHtml(label)}</option>`).join("")}</select></label><label>Nom visible<input name="name" value="${escapeHtml(product.name||"")}"></label><div class="form-grid"><label>Prix<input name="price" type="number" min="0" value="${product.price||0}"></label><label>Stock initial<input name="stock" type="number" min="0" value="${product.initial_stock||0}"></label><label>Maximum par achat<input name="maximum" type="number" min="1" value="${product.maximum_per_purchase||1}"></label></div><button type="button" class="danger-link" data-delete-simple-product>Supprimer le produit</button></div>`,(data,current)=>{element.querySelector('[data-field="product_item"]').value=data.get("item");element.querySelector('[data-field="product_name"]').value=data.get("name");element.querySelector('[data-field="product_price"]').value=data.get("price");element.querySelector('[data-field="product_stock"]').value=data.get("stock");element.querySelector('[data-field="product_max"]').value=data.get("maximum");current.close();markEditorDirty();refreshSimpleGameplay()});bindContextualItemCreation(dialog);dialog.querySelector('[data-delete-simple-product]').onclick=()=>{element.remove();dialog.close();markEditorDirty();refreshSimpleGameplay()};if(created)dialog.querySelectorAll('[data-local-cancel]').forEach(button=>button.onclick=()=>{element.remove();dialog.close();refreshSimpleGameplay()})}

function switchGameplayMode(mode){const simple=$("#simple-gameplay-root"),advanced=$("#advanced-gameplay-root");if(!simple||!advanced)return;if(mode==="simple")refreshSimpleGameplay();simple.hidden=mode!=="simple";advanced.hidden=mode!=="advanced";$$('[data-gameplay-toggle]').forEach(button=>button.classList.toggle("active",button.dataset.gameplayToggle===mode));}
function refreshSimpleGameplay(){const root=$("#simple-gameplay-root");if(!root)return;root.innerHTML=gameplayProjection();bindSimpleGameplay();}
function bindSimpleGameplay(){
  $$('[data-simple-zone]').forEach(button=>button.onclick=()=>openSimpleZoneEditor(Number(button.dataset.simpleZone)));
  $$('[data-simple-profession]').forEach(button=>button.onclick=()=>openSimpleProfessionEditor(Number(button.dataset.simpleProfession)));
  $$('[data-simple-action]').forEach(button=>button.onclick=()=>{switchGameplayMode("advanced");const card=$$("#actions > .action-builder")[Number(button.dataset.simpleAction)];if(card){card.open=true;card.scrollIntoView({behavior:"smooth",block:"start"})}});
  $$('[data-open-advanced-section]').forEach(button=>button.onclick=()=>{switchGameplayMode("advanced");$("#"+button.dataset.openAdvancedSection)?.scrollIntoView({behavior:"smooth",block:"start"})});
  $$('[data-add-simple-zone]').forEach(button=>button.onclick=()=>{addActivityModule({profession:button.dataset.addSimpleZone,outcomes:[]});refreshSimpleGameplay();openSimpleZoneEditor($$("#activity-modules > .module-card").length-1,true)});
  $$('[data-gameplay-mode]').forEach(button=>button.onclick=()=>switchGameplayMode(button.dataset.gameplayMode));
  $("#add-simple-mechanic")?.addEventListener("click",()=>{$("#create-related-profession").click()});
  const flowButtons=$$('.simple-exchange-card button'),deliveries=readDeliveryModules(),products=readProductModules(),recipes=readRecipeModules();
  flowButtons.forEach((button,index)=>button.onclick=()=>{if(index<deliveries.length)return openSimpleDeliveryEditor(index);if(index<deliveries.length+products.length)return openSimpleProductEditor(index-deliveries.length);return openSimpleRecipeEditor(index-deliveries.length-products.length)});
  const flowGrid=$('.simple-exchange-grid');if(flowGrid)flowGrid.insertAdjacentHTML('afterend','<div class="simple-flow-actions"><button type="button" class="secondary" id="add-simple-recipe">＋ Ajouter une recette</button><button type="button" class="secondary" id="add-simple-delivery">＋ Ajouter une livraison</button><button type="button" class="secondary" id="add-simple-product">＋ Ajouter un produit</button></div>');
  if(flowGrid&&deliveries.length){const groups=new Map();deliveries.forEach((delivery,index)=>{const key=delivery.target_building_key||delivery.building||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push({delivery,index})});const grouped=document.createElement('div');grouped.className='grouped-deliveries';grouped.innerHTML=[...groups].map(([key,rows])=>{const building=state.catalogs.building.find(item=>item.entity_key===key);return `<article><header><div><small>DESTINATION</small><h4>${escapeHtml(building?.payload.name||key||'Bâtiment actuel')}</h4><p>${rows.length} ressource(s)</p></div><button type="button" data-add-delivery-target="${escapeHtml(key)}">＋ Ajouter une ressource</button></header>${rows.map(({delivery,index})=>{const item=itemDisplay(delivery.item_key||delivery.resource);return `<button type="button" data-edit-grouped-delivery="${index}"><span>${item.emoji}</span><b>${escapeHtml(item.name)}</b><small>${delivery.minimum_quantity||1}–${delivery.maximum_quantity||'∞'}</small><i>Configurer ›</i></button>`}).join('')}</article>`}).join('');flowGrid.before(grouped);[...flowGrid.children].slice(0,deliveries.length).forEach(card=>card.hidden=true);$$('[data-edit-grouped-delivery]').forEach(button=>button.onclick=()=>openSimpleDeliveryEditor(Number(button.dataset.editGroupedDelivery)));$$('[data-add-delivery-target]').forEach(button=>button.onclick=()=>{addDeliveryModule({source:'player_inventory',destination:'building_stock',target_building_key:button.dataset.addDeliveryTarget,minimum_quantity:1,maximum_quantity:10});refreshSimpleGameplay();openSimpleDeliveryEditor($$("#delivery-modules > .delivery-module").length-1,true)})}
  $("#add-simple-recipe")?.addEventListener("click",()=>{addRecipeModule({active:true,ingredients:{},duration_seconds:30,output_quantity:1});refreshSimpleGameplay();openSimpleRecipeEditor($$("#recipe-modules > .recipe-module").length-1,true)});
  $("#add-simple-delivery")?.addEventListener("click",()=>{addDeliveryModule({source:"player_inventory",destination:"building_stock",minimum_quantity:1,maximum_quantity:10});refreshSimpleGameplay();openSimpleDeliveryEditor($$("#delivery-modules > .delivery-module").length-1,true)});
  $("#add-simple-product")?.addEventListener("click",()=>{addProductModule({active:true,initial_stock:0,maximum_per_purchase:1});refreshSimpleGameplay();openSimpleProductEditor($$("#product-modules > .product-module").length-1,true)});
  $$('[data-simple-action]').forEach(button=>button.onclick=()=>openSimpleActionEditor(Number(button.dataset.simpleAction)));
}

function setupSimpleGameplay(root){
  const panel=root.querySelector('[data-building-panel="mechanics"]'),children=[...panel.children],toolbar=document.createElement("div"),simple=document.createElement("div"),advanced=document.createElement("div");toolbar.className="gameplay-mode-switch";toolbar.innerHTML='<div><small>ÉDITION DU GAMEPLAY</small><b>Choisissez votre niveau de détail</b></div><span><button type="button" class="active" data-gameplay-toggle="simple">Mode simple</button><button type="button" data-gameplay-toggle="advanced">Mode avancé</button></span>';simple.id="simple-gameplay-root";advanced.id="advanced-gameplay-root";children.forEach(child=>advanced.append(child));panel.append(toolbar,simple,advanced);refreshSimpleGameplay();advanced.hidden=true;$$('[data-gameplay-toggle]').forEach(button=>button.onclick=()=>switchGameplayMode(button.dataset.gameplayToggle));
}

function bindEntitySearches(root=document){
  root.querySelectorAll('[data-entity-search]').forEach(search=>search.oninput=()=>{const selectField=search.nextElementSibling;if(!(selectField instanceof HTMLSelectElement))return;const query=search.value.trim().toLowerCase();[...selectField.options].forEach((option,index)=>option.hidden=index>0&&query&&!option.textContent.toLowerCase().includes(query));});
}

function itemMenuPicker(component){
  const items=state.catalogs.item||[],selected=new Set((component.options||[]).map(option=>option.interaction?.item_key||option.item_key||option.key));
  const categories=[...new Set(items.map(item=>String(item.payload.category||"Autres")))].sort((a,b)=>a.localeCompare(b,"fr"));
  return `<section class="item-menu-picker"><div class="section-head"><div><b>Ajouter depuis les objets</b><small>Recherche et sélection multiple</small></div><button type="button" class="primary add-catalog-items">Ajouter la sélection</button></div><div class="item-menu-tools"><input type="search" data-item-menu-search placeholder="Rechercher une bière, un repas, un outil…"><select data-item-menu-category><option value="">Toutes les catégories</option>${categories.map(category=>`<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select><select data-item-menu-sort><option value="name">Nom A–Z</option><option value="category">Catégorie</option><option value="price">Prix croissant</option></select></div><div class="item-menu-results">${items.map(item=>{const p=item.payload,category=String(p.category||"Autres"),name=String(p.name||item.entity_key),search=`${name} ${item.entity_key} ${category}`.toLowerCase();return `<label class="item-menu-result" data-name="${escapeHtml(name.toLowerCase())}" data-search="${escapeHtml(search)}" data-category="${escapeHtml(category)}" data-price="${Number(p.price||0)}"><input type="checkbox" value="${escapeHtml(item.entity_key)}" ${selected.has(item.entity_key)?"disabled":""}><span>${escapeHtml(p.emoji||"📦")}</span><b>${escapeHtml(name)}</b><small>${escapeHtml(category)} · ${Number(p.price||0)} écus</small></label>`}).join("")||'<p class="field-note">Aucun objet disponible.</p>'}</div><p class="field-note">Discord limite un menu à 25 options. Un objet déjà ajouté est grisé. Pour un achat, configure aussi son prix et son stock dans la section Produits.</p></section>`;
}

function bindPropertyPanel() {
  const page=currentInterfacePage(),component=currentInterfaceComponent(),panel=$("#property-panel");
  panel.querySelectorAll("[data-prop]").forEach(field=>field.onchange=()=>{
    const key=field.dataset.prop,value=field.type==="number"?Number(field.value):field.value;
    const optionMatch=key.match(/^option_(\d+)_(.+)$/);
    if(component&&optionMatch){const option=component.options[Number(optionMatch[1])],property=optionMatch[2];option.interaction||={type:"navigate",page:state.interfaceDraft.start_page};if(property==="interaction_type")option.interaction=value==="navigate"?{type:"navigate",page:state.interfaceDraft.start_page}:value==="purchase"?{type:"purchase",item_key:option.item_key||""}:{type:"action",building:state.type==="building"?$("#key").value:state.interfaceDraft.target_building_key||"",action:""};else if(property==="target_page")option.interaction={type:"navigate",page:value};else if(property==="target_building")option.interaction={type:"action",building:value,action:""};else if(property==="target_action")option.interaction.action=value;else if(property==="purchase_item"){option.item_key=value;option.interaction={type:"purchase",item_key:value};}else if(property==="cooldown_seconds")option.interaction.cooldown_seconds=Number(value)||0;else if(property==="access_type"){if(value==="none")delete option.access_when;else option.access_when={profession_level:{profession:state.buildingBase?.modules?.professions?.[0]?.key||"profession",minimum:1}};}else if(property==="access_profession"){option.access_when||={profession_level:{}};option.access_when.profession_level.profession=value;}else if(property==="access_minimum"){option.access_when||={profession_level:{}};option.access_when.profession_level.minimum=Number(value)||1;}else option[property]=value;renderVisualStudio();return;}
    const sequenceMatch=key.match(/^sequence_(\d+)_(.+)$/);
    if(component&&sequenceMatch){const step=component.props.steps[Number(sequenceMatch[1])],property=sequenceMatch[2];if(property==="condition"){if(value==="none")delete step.visible_when;else{const firstProfession=state.buildingBase?.modules?.professions?.[0]?.key||"profession";step.visible_when={profession_level:{profession:firstProfession,minimum:1}};}}else if(property==="profession"){step.visible_when||={profession_level:{}};step.visible_when.profession_level.profession=value;}else if(property==="minimum"){step.visible_when||={profession_level:{}};step.visible_when.profession_level.minimum=Number(value)||1;}else if(property==="delay_seconds")step.delay_seconds=Math.max(0,Number(value)||0);else step[property]=value;renderVisualStudio();return;}
    if(key==="interface_building")state.interfaceDraft.target_building_key=value;
    else if(key==="theme_color"){state.interfaceDraft.theme||={};state.interfaceDraft.theme.color=value;}
    else if(key==="theme_density"){state.interfaceDraft.theme||={};state.interfaceDraft.theme.density=value;}
    else if(key==="page_name")page.name=value;
    else if(key==="page_key"){const old=page.key,newKey=technicalKey(value,"page");page.key=newKey;if(state.interfaceDraft.start_page===old)state.interfaceDraft.start_page=newKey;state.interfaceDraft.pages.forEach(item=>item.components.forEach(child=>{if(child.interaction?.type==="navigate"&&child.interaction.page===old)child.interaction.page=newKey;(child.options||[]).forEach(option=>{if(option.interaction?.type==="navigate"&&option.interaction.page===old)option.interaction.page=newKey;});}));state.selectedPage=newKey;}
    else if(component&&key==="interaction_type"){component.interaction=value==="navigate"?{type:"navigate",page:state.interfaceDraft.start_page}:value==="action"?{type:"action",building:state.type==="building"?$("#key").value:state.interfaceDraft.target_building_key||"",action:""}:{type:value};}
    else if(component&&key==="target_page")component.interaction={type:"navigate",page:value};
    else if(component&&key==="target_building")component.interaction={type:"action",building:value,action:""};
    else if(component&&key==="target_action")component.interaction.action=value;
    else if(component&&key==="world_destination")component.interaction.destination=value;
    else if(component&&["cooldown_seconds","global_cooldown_seconds"].includes(key))component.interaction[key]=Math.max(0,Number(value)||0);
    else if(component&&key==="inline")component.props.inline=value==="true";
    else if(component&&key==="access_type"){if(value==="none")delete component.access_when;else component.access_when={profession_level:{profession:state.buildingBase?.modules?.professions?.[0]?.key||"profession",minimum:1}};}
    else if(component&&key==="access_profession"){component.access_when||={profession_level:{}};component.access_when.profession_level.profession=value;}
    else if(component&&key==="access_minimum"){component.access_when||={profession_level:{}};component.access_when.profession_level.minimum=Number(value)||1;}
    else if(component)component.props[key]=value;
    renderVisualStudio();
  });
  const start=panel.querySelector('[data-field="page_start"]');if(start)start.onchange=()=>{if(start.checked)state.interfaceDraft.start_page=page.key;renderVisualStudio();};
  panel.querySelector(".delete-component")?.addEventListener("click",()=>{page.components=page.components.filter(item=>item.id!==state.selectedComponent);state.selectedComponent=null;renderVisualStudio();});
  panel.querySelector(".add-select-option")?.addEventListener("click",()=>{if(component.options.length>=25)return;const index=component.options.length+1;component.options.push({key:`option_${index}`,label:`Option ${index}`,emoji:"",description:"",interaction:{type:"navigate",page:state.interfaceDraft.start_page}});renderVisualStudio();});
  const itemResults=panel.querySelector(".item-menu-results"),itemSearch=panel.querySelector("[data-item-menu-search]"),itemCategory=panel.querySelector("[data-item-menu-category]"),itemSort=panel.querySelector("[data-item-menu-sort]");
  const refreshItemPicker=()=>{if(!itemResults)return;const query=(itemSearch?.value||"").trim().toLowerCase(),category=itemCategory?.value||"",rows=[...itemResults.querySelectorAll(".item-menu-result")];rows.sort((a,b)=>itemSort?.value==="price"?Number(a.dataset.price)-Number(b.dataset.price):itemSort?.value==="category"?`${a.dataset.category} ${a.dataset.name}`.localeCompare(`${b.dataset.category} ${b.dataset.name}`,"fr"):a.dataset.name.localeCompare(b.dataset.name,"fr"));rows.forEach(row=>{row.hidden=!!query&&!row.dataset.search.includes(query)||!!category&&row.dataset.category!==category;itemResults.append(row);});};
  if(itemSearch)itemSearch.oninput=refreshItemPicker;if(itemCategory)itemCategory.onchange=refreshItemPicker;if(itemSort)itemSort.onchange=refreshItemPicker;
  panel.querySelector(".add-catalog-items")?.addEventListener("click",()=>{const keys=[...panel.querySelectorAll('.item-menu-result input:checked')].map(input=>input.value),remaining=Math.max(0,25-component.options.length);if(!keys.length){alert("Sélectionnez au moins un objet.");return}if(keys.length>remaining){alert(`Il reste ${remaining} place(s) dans ce menu Discord.`);return}for(const key of keys){const entity=state.catalogs.item.find(item=>item.entity_key===key);if(!entity)continue;const p=entity.payload;component.options.push({key,item_key:key,label:p.name||key,emoji:p.emoji||"📦",description:`${p.category||"Objet"}${p.price!=null?` · ${p.price} écus`:""}`,interaction:{type:"purchase",item_key:key}});}renderVisualStudio();});
  panel.querySelectorAll("[data-remove-option]").forEach(button=>button.onclick=()=>{component.options.splice(Number(button.dataset.removeOption),1);renderVisualStudio();});
  panel.querySelector(".add-sequence-step")?.addEventListener("click",()=>{component.props.steps||=[];component.props.steps.push({text:"Nouveau texte",delay_seconds:1});renderVisualStudio();});
  panel.querySelectorAll("[data-remove-step]").forEach(button=>button.onclick=()=>{component.props.steps.splice(Number(button.dataset.removeStep),1);renderVisualStudio();});
  panel.querySelector(".remove-page")?.addEventListener("click",()=>{const fallback=state.interfaceDraft.pages.find(item=>item.key!==page.key);state.interfaceDraft.pages=state.interfaceDraft.pages.filter(item=>item.key!==page.key);state.interfaceDraft.pages.forEach(item=>item.components.forEach(child=>{if(child.interaction?.type==="navigate"&&child.interaction.page===page.key)child.interaction.page=fallback.key;(child.options||[]).forEach(option=>{if(option.interaction?.type==="navigate"&&option.interaction.page===page.key)option.interaction.page=fallback.key;});}));if(state.interfaceDraft.start_page===page.key)state.interfaceDraft.start_page=fallback.key;state.selectedPage=fallback.key;state.selectedComponent=null;renderVisualStudio();});
}

function soundTrackChecklist(type, selected=[]) {
  const entries=state.catalogs.audio.filter(entity=>(entity.payload.audio_type||entity.payload.channel||"sfx")===type);
  return `<div class="sound-track-list" data-sound-type="${type}">${entries.map(entity=>`<label class="check"><input type="checkbox" value="${escapeHtml(entity.entity_key)}" ${selected.includes(entity.entity_key)?"checked":""}><span>${escapeHtml(entity.payload.name)}</span></label>`).join("")||'<small class="field-note">Aucun son de ce type dans la banque.</small>'}</div>`;
}

function addSoundGroup(group={}) {
  const element=document.createElement("details");element.className="module-card sound-group";element.open=!group.key;element.dataset.original=JSON.stringify(group);const tracks=group.tracks||{};
  element.innerHTML=`<summary><strong>🎼 ${escapeHtml(group.name||group.key||"Nouveau groupe")}</strong><small>${Object.values(tracks).flat().length||0} piste(s)</small></summary><div class="module-content"><button type="button" class="remove">×</button><div class="form-grid">${input("Nom du groupe","sound_group_name",group.name||"")}${input("Identifiant","sound_group_key",group.key||"")}${input("Volume général","sound_group_volume",group.volume??1,"number",'min="0" max="1" step="0.05"')}</div><div class="sound-lanes"><section><h4>🎵 Musique</h4>${soundTrackChecklist("music",tracks.music||[])}</section><section><h4>🌲 Ambiance</h4>${soundTrackChecklist("ambience",tracks.ambience||[])}</section><section><h4>💥 SFX</h4>${soundTrackChecklist("sfx",tracks.sfx||[])}</section><section><h4>🗣️ Voix</h4>${soundTrackChecklist("voice",tracks.voice||[])}</section></div></div>`;
  $("#sound-groups").append(element);element.querySelector(".remove").onclick=()=>{element.remove();refreshSoundGroupSelectors();};element.querySelector('[data-field="sound_group_name"]').oninput=e=>{if(!element.querySelector('[data-field="sound_group_key"]').dataset.touched)element.querySelector('[data-field="sound_group_key"]').value=technicalKey(e.target.value,"ambiance");element.querySelector("summary strong").textContent=`🎼 ${e.target.value||"Nouveau groupe"}`;refreshSoundGroupSelectors();};element.querySelector('[data-field="sound_group_key"]').oninput=e=>{e.target.dataset.touched="true";refreshSoundGroupSelectors();};
}

function readSoundGroups(){return $$("#sound-groups > .sound-group").map((element,index)=>{const tracks={};element.querySelectorAll("[data-sound-type]").forEach(lane=>tracks[lane.dataset.soundType]=[...lane.querySelectorAll('input:checked')].map(input=>input.value));return {key:fieldValue("sound_group_key",element)||`ambiance_${index+1}`,name:fieldValue("sound_group_name",element)||`Ambiance ${index+1}`,volume:fieldValue("sound_group_volume",element)??1,tracks};});}
function currentSoundGroupOptions(value=""){const groups=readSoundGroups();return [["","Choisir un groupe…"],...groups.map(group=>[group.key,group.name]),...(value&&!groups.some(group=>group.key===value)?[[value,`⚠ ${value}`]]:[])];}
function refreshSoundGroupSelectors(){$$('[data-sound-group-selector]').forEach(field=>{const value=field.value;field.innerHTML=currentSoundGroupOptions(value).map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===value?"selected":""}>${escapeHtml(label)}</option>`).join("");});}
function addSoundRoute(route={}){const row=document.createElement("div");row.className="builder sound-route";row.innerHTML=`<button type="button" class="remove">×</button><div class="form-grid">${select("Événement","sound_route_event",route.event||"",catalogOptions("event",route.event||""))}${select("Groupe à activer","sound_route_group",route.group_key||"",currentSoundGroupOptions(route.group_key||"")).replace('data-field="sound_route_group"','data-field="sound_route_group" data-sound-group-selector')}</div>`;$("#sound-routes").append(row);row.querySelector(".remove").onclick=()=>row.remove();}
function readSoundRoutes(){return $$("#sound-routes > .sound-route").map(row=>({event:fieldValue("sound_route_event",row),group_key:fieldValue("sound_route_group",row)})).filter(route=>route.event&&route.group_key);}

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
  root.innerHTML = `<section class="building-sheet-hero"><div><small>FICHE BÂTIMENT</small><h3>${escapeHtml(payload.emoji||"🏰")} ${escapeHtml(payload.name||"Nouveau bâtiment")}</h3><p>Configurez le lieu sans exposer la structure technique du moteur.</p></div><span class="status-pill ${state.editing?.status||"draft"}">${state.editing?.status==="published"?"PUBLIÉ":"BROUILLON"}</span></section><div class="building-editor-tabs"><button type="button" class="active" data-building-tab="overview">◈ Aperçu</button><button type="button" data-building-tab="mechanics" data-tutorial="building-tab-mechanics">⚙️ Fonctionnement</button><button type="button" data-building-tab="visual" data-tutorial="building-tab-discord">🧩 Discord</button><button type="button" data-building-tab="relations" data-tutorial="building-tab-relations">↔ Relations</button></div><div data-building-panel="overview">${buildingOverviewMarkup(payload,buildingKey,modules)}</div><div data-building-panel="relations" data-tutorial="building-panel-relations" hidden>${buildingRelationMarkup(payload,buildingKey,modules)}</div>
  <div data-building-panel="mechanics" hidden><section class="form-section mechanics-guide" data-help="building_mechanics"><div class="section-copy"><span class="step-dot">?</span><div><h3>Comment construire une mécanique ?</h3><p><b>Métier</b> = rôle du joueur et outil d’entrée. <b>Zone</b> = activité temporisée accessible à ce métier. <b>Résultat</b> = tirage pondéré. <b>Effet</b> = conséquence obtenue : objet, XP, message ou événement.</p></div></div><ol><li>Crée d’abord le métier et choisis l’objet requis.</li><li>Ajoute une zone, puis sélectionne ce métier et son outil.</li><li>Règle niveau, durée, énergie et usure.</li><li>Ajoute les résultats possibles : un poids élevé les rend plus fréquents.</li><li>Dans chaque résultat, ajoute une ou plusieurs récompenses ou conséquences.</li></ol><p class="field-note">Les actions de recrutement, de démission, de départ et de récupération sont générées automatiquement.</p></section><section class="form-section module-editor"><div class="section-copy"><span class="step-dot">2</span><div><h3>Métiers et zones d’activité</h3><p>Configure plusieurs métiers, leurs outils, leurs zones et leurs résultats sans écrire de JSON.</p></div></div><div class="section-head"><b>Métiers</b><button type="button" class="secondary" id="add-profession">＋ Ajouter un métier</button></div><div id="profession-modules"></div><div class="section-head"><b>Zones et activités</b><button type="button" class="secondary" id="add-activity">＋ Ajouter une zone</button></div><div id="activity-modules"></div></section><section class="form-section"><div class="section-copy"><span class="step-dot">3</span><div><h3>Actions complémentaires</h3><p>Les métiers et zones ci-dessus génèrent automatiquement leurs actions. Ajoute ici les autres actions du lieu.</p></div></div>${presetInfo?`<span class="preset-badge">${presetInfo.icon} Modèle ${presetInfo.name}</span>`:""}<div class="section-head"><span></span><button type="button" class="secondary" id="add-action">＋ Ajouter une action</button></div><div id="actions"></div></section>
  <details class="advanced"><summary>🏗️ Configuration modulaire complète ${moduleCount ? `(${moduleCount} éléments)` : ""}</summary><div class="advanced-content"><p class="field-note">Cette configuration est la source de vérité du bâtiment. Pour les bâtiments importés, les actions sont régénérées automatiquement à partir de ces valeurs.</p><label>Paramètres du bâtiment (JSON)<textarea data-field="modules_json" data-help="modules_json" rows="12" spellcheck="false">${escapeHtml(JSON.stringify(modules,null,2))}</textarea></label>${select("Origine des actions","action_mode",payload.action_mode||"manual",[["manual","Actions éditées ci-dessus"],["generated","Actions générées depuis les modules"]])}</div></details>
  <details class="advanced"><summary>🎭 Apparence et accès Discord</summary><div class="advanced-content form-grid">${input("Couleur Discord","color",payload.color||"7a1f1f")}${input("Personnage associé (facultatif)","npc_name",payload.npc_name||"")}${input("Rôles spéciaux autorisés (séparés par des virgules)","required_roles",(access.required_roles||[]).join(", "))}${check("Bâtiment visible dans le Royaume","building_visible",access.visible!==false)}${check("Salon textuel visible uniquement dans le vocal","temporary_text",access.temporary_text!==false)}</div></details></div>
  <div data-building-panel="visual" hidden>${visualStudioMarkup()}</div>`;
  root.querySelector('.building-editor-tabs').insertAdjacentHTML("beforeend",'<button type="button" data-building-tab="sound" data-tutorial="building-tab-audio">🔊 Audio</button><button type="button" data-building-tab="advanced">⚙ Avancé</button>');
  root.querySelector('[data-building-panel="relations"]').insertAdjacentHTML('beforeend',derivedBuildingRelationsMarkup(modules));
  root.querySelector('[data-building-panel="overview"]').insertAdjacentHTML('afterbegin',`<section class="form-section building-location-card"><div class="section-head"><div><h3>📍 Localisation dans le monde</h3><p class="field-note">Le bâtiment reste une entité gameplay complète ; ce choix indique simplement où il se trouve.</p></div></div><div class="form-grid">${select('Ville, zone ou lieu','building_location',payload.location_key||'',locationOptions(payload.location_key||''))}</div><button type="button" class="secondary" id="create-building-location">＋ Créer un lieu</button></section>`);
  $('#create-building-location').onclick=()=>openContextualLocationCreator($('[data-field="building_location"]'));
  const sound=modules.audio||{},assignedBots=state.catalogs.bot.filter(entity=>entity.payload.bot_type==="voice"&&entity.payload.building_key===buildingKey);
  root.insertAdjacentHTML("beforeend",`<div data-building-panel="sound" hidden><section class="form-section"><div class="section-copy"><span class="step-dot">🔊</span><div><h3>Ambiance du bâtiment</h3><p>Le bot attribué rejoint le vocal de ce bâtiment et exécute les sons configurés dans les actions.</p></div></div><div class="audio-bot-summary"><b>Bot attribué</b><span>${assignedBots.length?assignedBots.map(bot=>`🤖 ${escapeHtml(bot.payload.name)}`).join(", "):"⚠ Aucun bot vocal attribué — ouvrez Bots Discord pour en choisir un."}</span></div><div class="form-grid">${select("Ambiance générale","audio_default_group",sound.default_group_key||"",[["","Aucune ambiance automatique"]]).replace('data-field="audio_default_group"','data-field="audio_default_group" data-sound-group-selector')}</div><div class="section-head"><div><b>Groupes sonores</b><small class="field-note">Cliquez sur un groupe pour modifier ses musiques, ambiances, SFX et voix.</small></div><button type="button" class="secondary" id="add-sound-group">＋ Ajouter un groupe</button></div><div id="sound-groups"></div></section><section class="form-section"><div class="section-head"><div><b>Changements selon les événements</b><small class="field-note">Quand KingdomEvent émet l’événement choisi, le bot bascule vers ce groupe.</small></div><button type="button" class="secondary" id="add-sound-route">＋ Ajouter une règle</button></div><div id="sound-routes"></div></section></div>`);
  root.insertAdjacentHTML("beforeend",'<div data-building-panel="advanced" class="building-advanced-panel" hidden><div class="empty-admin">Les réglages techniques et Discord avancés sont regroupés ici.</div></div>');
  (sound.groups||[]).forEach(addSoundGroup);(sound.event_routes||[]).forEach(addSoundRoute);refreshSoundGroupSelectors();$("#add-sound-group").onclick=()=>{addSoundGroup({tracks:{music:[],ambience:[],sfx:[],voice:[]}});refreshSoundGroupSelectors();};$("#add-sound-route").onclick=()=>addSoundRoute({});
  root.querySelector('[data-building-panel="mechanics"] > details').insertAdjacentHTML("beforebegin",`<section class="form-section"><div class="section-copy"><span class="step-dot">🚚</span><div><h3>Livraisons et transferts</h3><p>Discord propose uniquement les ressources acceptées réellement présentes dans l’inventaire.</p></div></div><div class="section-head"><b>Ressources livrables</b><button type="button" class="secondary" id="add-delivery">＋ Ajouter une ressource livrable</button></div><div id="delivery-modules"></div><div class="checks">${check("Autoriser Tout livrer","delivery_all",modules.delivery_mode==="all_available")}</div></section>`);
  root.querySelector('[data-building-panel="mechanics"] > details').insertAdjacentHTML("beforebegin",`<section class="form-section"><div class="section-copy"><span class="step-dot">🛒</span><div><h3>Commerce, recettes, récits et jeux</h3><p>Ces réglages alimentent directement les menus Discord. Aucun JSON n'est nécessaire pour les opérations courantes.</p></div></div><div class="section-head"><b>Produits</b><button type="button" class="secondary" id="add-product">＋ Ajouter un produit</button></div><div id="product-modules"></div><div class="section-head"><b>Recettes temporisées</b><button type="button" class="secondary" id="add-recipe">＋ Ajouter une recette</button></div><div id="recipe-modules"></div><div class="section-head"><b>Rumeurs et récits pondérés</b><button type="button" class="secondary" id="add-rumor">＋ Ajouter un récit</button></div><div id="rumor-modules"></div><div class="form-grid">${input("Cooldown joueur (secondes)","rumor_player_cooldown",modules.rumors?.player_cooldown_seconds||0,"number","min=0")}${input("Cooldown global (secondes)","rumor_global_cooldown",modules.rumors?.global_cooldown_seconds||0,"number","min=0")}</div><div class="section-head"><b>Jeux configurables</b><button type="button" class="secondary" id="add-game">＋ Ajouter un jeu</button></div><div id="game-modules"></div></section>`);
  const advancedPanel=root.querySelector('[data-building-panel="advanced"]');root.querySelectorAll('[data-building-panel="mechanics"] > details.advanced').forEach(details=>advancedPanel.append(details));
  (payload.actions||[]).forEach(addAction);
  (modules.professions||[]).forEach(addProfessionModule);
  (modules.activities||[]).forEach(addActivityModule);
  (modules.deliveries||[]).forEach(addDeliveryModule);
  (modules.products||[]).forEach(addProductModule);
  (modules.recipes||[]).forEach(addRecipeModule);
  (modules.rumors?.catalogue||[]).forEach(addRumorModule);
  Object.values(modules.games||{}).forEach(addGameModule);
  $("#add-profession").onclick=()=>{addProfessionModule({});refreshActivityProfessionOptions();};
  $("#create-related-profession").onclick=()=>{addProfessionModule({name:"Nouveau métier"});refreshActivityProfessionOptions();refreshSimpleGameplay();$('[data-building-tab="mechanics"]').click();const cards=$$("#profession-modules > .module-card");cards.at(-1)?.scrollIntoView({behavior:"smooth",block:"center"});};
  $('[data-field="relation_primary_profession"]').onchange=event=>{const selected=professionCatalog().find(item=>item.key===event.target.value);if(!selected||readProfessionModules().some(item=>item.key===selected.key))return;addProfessionModule(clone(selected.definition));refreshActivityProfessionOptions();};
  $$('[data-open-related]').forEach(button=>button.onclick=()=>{closeEditor();navigateTo(button.dataset.openRelated)});
  $$('[data-open-derived]').forEach(button=>button.onclick=()=>{closeEditor();navigateTo(button.dataset.openDerived)});
  bindEntitySearches(root);
  $("#dissociate-building-bot").onclick=()=>{if(!confirm("Dissocier ce bot du bâtiment sans supprimer le bot ?"))return;$('[data-field="relation_bot_key"]').value="";markEditorDirty()};
  $("#remove-building-ambience").onclick=()=>{$('[data-field="relation_ambience_key"]').value="";markEditorDirty()};
  $$('[data-open-building-tab]').forEach(button=>button.onclick=()=>root.querySelector(`[data-building-tab="${button.dataset.openBuildingTab}"]`)?.click());
  $("#add-activity").onclick=()=>addActivityModule({outcomes:[]});
  $("#add-delivery").onclick=()=>addDeliveryModule({source:"player_inventory",destination:"building_stock",minimum_quantity:1,unit_price:0,payment_resource:"money"});
  $("#add-product").onclick=()=>addProductModule({active:true,initial_stock:0,maximum_per_purchase:1});
  $("#add-recipe").onclick=()=>addRecipeModule({active:true,ingredients:{},duration_seconds:60,output_quantity:1});
  $("#add-rumor").onclick=()=>addRumorModule({enabled:true,weight:1});
  $("#add-game").onclick=()=>addGameModule({key:"",name:"Nouveau jeu",stake:1,sides:6,stake_resource:"money"});
  $("#add-action").onclick = () => { addAction({effects:[]}); setHelp("action_name"); };
  $("#add-action").dataset.help = "actions";
  const simpleSoundPanel=root.querySelector('[data-building-panel="sound"]');simpleSoundPanel.querySelectorAll(':scope > section').forEach(section=>{section.hidden=true;section.dataset.advancedAudio='true'});simpleSoundPanel.insertAdjacentHTML('afterbegin',simpleAudioMarkup(payload,buildingKey,modules));bindSimpleAudio();
  const simpleVisualPanel=root.querySelector('[data-building-panel="visual"]');simpleVisualPanel.querySelector('.visual-studio').hidden=true;simpleVisualPanel.insertAdjacentHTML('afterbegin',simpleDiscordMarkup());bindSimpleDiscord();
  bindVisualStudio();renderVisualStudio();
  setupSimpleGameplay(root);
  $$('[data-building-tab]').forEach(button=>button.onclick=()=>{$$('[data-building-tab]').forEach(item=>item.classList.toggle("active",item===button));$$('[data-building-panel]').forEach(panel=>panel.hidden=panel.dataset.buildingPanel!==button.dataset.buildingTab);if(button.dataset.buildingTab==="visual")renderVisualStudio();KingdomTutorials.notify("building_tab_changed",button.dataset.buildingTab);});
}

function itemMatchesFilter(entity, filter="any"){
  if(filter==="any")return true;const value=`${entity.payload.category||""} ${entity.payload.type||""}`.toLowerCase();
  if(filter==="tool")return /(tool|outil|equipment|équipement)/.test(value);
  if(filter==="resource")return /(resource|ressource|ingredient|ingrédient)/.test(value);
  if(filter==="consumable")return entity.payload.consumable===true||/(drink|food|boisson|repas|consommable)/.test(value);
  return value.includes(filter.toLowerCase());
}
function itemReferenceOptions(currentValue="",filter="any",building="",extraItems=[]){
  const system=filter==="tool"?[]:[["money","💰 Monnaie"],["energy","⚡ Énergie"]];
  const entries=state.catalogs.item.filter(entity=>itemMatchesFilter(entity,filter)&&(!building||state.catalogs.itemEnriched.find(item=>item.id===entity.entity_key)?.buildings.some(link=>link.key===building))).map(entity=>[entity.entity_key,`${entity.payload.emoji||"📦"} ${entity.payload.name}`]);
  for(const item of extraItems)if(item?.item_key&&!system.concat(entries).some(([key])=>key===item.item_key))entries.unshift([item.item_key,`⚠️ Objet inconnu — ${item.item_key} (référence manquante)`]);
  if(currentValue&&!system.concat(entries).some(([key])=>key===currentValue)){const missing=itemDisplay(currentValue);entries.unshift([currentValue,`${missing.emoji} ${missing.name} — ${currentValue} (référence manquante)`]);}
  return [["","Choisir un objet…"],...system,...entries];
}
function itemSelector(label,name,value="",filter="any",building="",extraItems=[]){
  return `<label class="item-selector">${label}<input class="item-selector-search" data-item-search-for="${name}" placeholder="🔎 Rechercher dans les objets…"><select name="${name}" data-field="${name}" data-item-filter="${filter}" data-item-building="${escapeHtml(building)}">${itemReferenceOptions(value,filter,building,extraItems).map(([key,text])=>`<option value="${escapeHtml(key)}" ${key===value?"selected":""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
}
function bindItemSelectors(root=document){
  root.querySelectorAll("[data-item-search-for]").forEach(search=>{
    search.oninput=()=>{
      const container=search.closest(".item-selector")||root;
      const selectField=container.querySelector(`[data-field="${CSS.escape(search.dataset.itemSearchFor)}"]`);
      if(!selectField)return;
      const query=search.value.trim().toLowerCase();
      [...selectField.options].forEach((option,index)=>option.hidden=index>0&&query&&!option.textContent.toLowerCase().includes(query));
    };
  });
}
function restoreContentToolbar(){const toolbar=$("#content-workspace .toolbar");if(!$("#search"))toolbar.innerHTML='<input id="search" placeholder="Rechercher…"><span>Les changements publiés sont chargés par tous les modules.</span>';$("#search").oninput=renderCards;if(state.type!=="location")$("#cards").className="cards";}

function itemDisplay(id){
  if(["money","energy"].includes(id))return {id,name:id==="money"?"Monnaie":"Énergie",emoji:id==="money"?"💰":"⚡",category:"system"};
  const entity=state.catalogs.item.find(item=>item.entity_key===id);
  return entity?{id,name:entity.payload.name,emoji:entity.payload.emoji||"📦",category:entity.payload.category||entity.payload.type||"other"}:{id,name:"Objet inconnu",emoji:"⚠️",category:"missing",missing:true};
}

async function loadItemCatalog(){
  const filters=state.itemFilters, query=new URLSearchParams(filters), response=await fetch(`/api/admin/items?${query}`,{headers});
  if(!response.ok){alert("Catalogue d’objets indisponible.");return}
  const data=await response.json();state.items=data.items.map(item=>({entity_key:item.id,payload:item.payload,status:item.status,version:item.version,created_at:item.created_at,buildings:item.buildings}));
  $("#count").textContent=data.total;$("#published").textContent=state.items.filter(x=>x.status==="published").length;$("#drafts").textContent=state.items.filter(x=>x.status==="draft").length;
  const toolbar=$("#content-workspace .toolbar");toolbar.innerHTML=`<div class="catalog-toolbar"><input id="item-search" value="${escapeHtml(filters.search)}" placeholder="🔎 Rechercher un objet…"><select id="item-category"><option value="">Tous les types</option>${data.categories.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}</select><select id="item-building"><option value="">Tous les bâtiments</option>${data.buildings.map(x=>`<option value="${escapeHtml(x.key)}">${escapeHtml(`${x.emoji} ${x.name}`)}</option>`).join("")}</select><select id="item-sort"><option value="name_asc">Nom A → Z</option><option value="name_desc">Nom Z → A</option><option value="type">Type</option><option value="building">Bâtiment</option><option value="recent">Création récente</option></select></div><div id="active-item-filters" class="active-filters"></div>`;
  $("#item-category").value=filters.category;$("#item-building").value=filters.building;$("#item-sort").value=filters.sort;
  const chips=[];if(filters.category)chips.push(`<button data-clear-item="category">${escapeHtml(filters.category)} ×</button>`);if(filters.building){const b=data.buildings.find(x=>x.key===filters.building);chips.push(`<button data-clear-item="building">${escapeHtml(b?.name||filters.building)} ×</button>`)}$("#active-item-filters").innerHTML=`<span>${data.count} objet(s) sur ${data.total}</span>${chips.join("")}${chips.length||filters.search?'<button data-clear-item="all">Réinitialiser les filtres</button>':""}`;
  $("#cards").innerHTML=data.items.map(item=>`<article class="card item-card" data-open="${escapeHtml(item.id)}" tabindex="0"><div class="card-head"><span class="emoji">${escapeHtml(item.emoji)}</span><span class="badge ${item.status}">${item.status==="published"?"PUBLIÉ":"BROUILLON"}</span></div><h3>${escapeHtml(item.name)}</h3><div class="item-tags"><span>${escapeHtml(item.category)}</span>${item.buildings.map(b=>`<span title="${escapeHtml(b.relation_labels.join(', '))}">${escapeHtml(b.name)}</span>`).join("")}</div><p>${escapeHtml(item.description||"Aucune description")}</p><div class="technical-id">ID technique : <code>${escapeHtml(item.id)}</code></div><div class="meta"><span>v${item.version}</span><span><button data-edit="${escapeHtml(item.id)}">Modifier</button>${item.status==="draft"?` · <button data-publish="${escapeHtml(item.id)}" data-version="${item.version}">Publier</button>`:""} · <button class="danger-link" data-delete="${escapeHtml(item.id)}">Supprimer</button></span></div></article>`).join("")||'<p class="empty">Aucun objet ne correspond à ces filtres.</p>';
  let timer;$("#item-search").oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{filters.search=e.target.value;loadItemCatalog()},300)};[["#item-category","category"],["#item-building","building"],["#item-sort","sort"]].forEach(([selector,key])=>$(selector).onchange=e=>{filters[key]=e.target.value;loadItemCatalog()});$$('[data-clear-item]').forEach(b=>b.onclick=()=>{if(b.dataset.clearItem==="all")Object.assign(filters,{search:"",category:"",building:"",sort:"name_asc"});else filters[b.dataset.clearItem]="";loadItemCatalog()});
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
  const element=document.createElement("details");element.className="builder profession-module module-card";element.open=!profession.key;element.dataset.original=JSON.stringify(profession);
  element.innerHTML=`<summary><strong>📜 ${escapeHtml(profession.name||"Nouveau métier")}</strong><small>${escapeHtml(profession.key||"à configurer")}</small></summary><div class="module-content"><button type="button" class="remove">×</button><div class="form-grid">${input("Nom du métier","module_profession_name",profession.name||"")}${input("Identifiant","module_profession_key",profession.key||"")}${input("Emoji","module_profession_emoji",profession.emoji||"📜")}${select("Outil ou objet requis","module_profession_item",profession.required_item||"",catalogOptions("item",profession.required_item||""))}${input("Niveau initial de l’outil","module_profession_tool_level",profession.tool_level||1,"number","min=1")}${input("Durabilité initiale","module_profession_initial_durability",profession.initial_durability||profession.max_durability||1,"number","min=0")}${input("Durabilité maximale","module_profession_max_durability",profession.max_durability||1,"number","min=1")}</div><div class="checks">${check("Donner automatiquement cet outil","module_profession_grant",profession.grant_required_item===true)}</div></div>`;
  $("#profession-modules").append(element);element.querySelector(".remove").onclick=()=>{element.remove();refreshActivityProfessionOptions();};
  element.querySelector('[data-field="module_profession_name"]').oninput=event=>{if(!element.querySelector('[data-field="module_profession_key"]').dataset.touched)element.querySelector('[data-field="module_profession_key"]').value=technicalKey(event.target.value,"metier");element.querySelector("summary strong").textContent=`📜 ${event.target.value||"Nouveau métier"}`;refreshActivityProfessionOptions();};
  element.querySelector('[data-field="module_profession_key"]').oninput=event=>{event.target.dataset.touched="true";element.querySelector("summary small").textContent=event.target.value||"à configurer";refreshActivityProfessionOptions();};
}

function refreshActivityProfessionOptions(){
  $$("#activity-modules .activity-module").forEach(element=>{const field=element.querySelector('[data-field="module_activity_profession"]'),value=field.value;field.innerHTML=professionOptions(value).map(([key,label])=>`<option value="${escapeHtml(key)}" ${key===value?"selected":""}>${escapeHtml(label)}</option>`).join("");});
}

function addActivityModule(activity={}) {
  const element=document.createElement("details");element.className="builder activity-module module-card";element.open=!activity.key;element.dataset.original=JSON.stringify(activity);
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
  const outcomeTypes=[["reward","Donner au joueur"],["stock_reward","Ajouter au stock d’un bâtiment"],["cost","Retirer au joueur"],["play_audio","Jouer un son"],["set_audio_group","Changer l’ambiance"],["message","Afficher un message"],["profession","Donner de l’expérience"],["emit","Envoyer un événement"],["state","Modifier un état"]];
  const render=()=>{const type=element.querySelector('[data-field="outcome_effect_type"]')?.value||effect.type||"reward";let fields="";
    if(["reward","cost","stock_reward"].includes(type)){const amount=effect.amount??1,min=Array.isArray(amount)?amount[0]:amount,max=Array.isArray(amount)?amount[1]:amount;fields=`${itemSelector("Ressource","outcome_effect_resource",effect.resource||effect.item||"","resource")}${input("Minimum","outcome_effect_min",min,"number")}${input("Maximum","outcome_effect_max",max,"number")}${type==="stock_reward"?select("Stock du bâtiment","outcome_effect_building",effect.building||"",catalogOptions("building",effect.building||"")):""}`;}
    else if(type==="play_audio")fields=select("Son joué","outcome_effect_audio_key",effect.audio_key||"",audioOptions(effect.audio_key||""));
    else if(type==="set_audio_group")fields=select("Nouvelle ambiance","outcome_effect_group_key",effect.group_key||"",currentSoundGroupOptions(effect.group_key||""));
    else if(type==="message")fields=input("Message","outcome_effect_text",effect.text||"");
    else if(type==="profession")fields=`${select("Métier","outcome_effect_profession",effect.profession||"",professionOptions(effect.profession||""))}${input("Expérience","outcome_effect_experience",effect.experience||0,"number")}${input("XP par niveau","outcome_effect_xp_level",effect.experience_per_level||100,"number")}`;
    else if(type==="emit")fields=`${select("Événement","outcome_effect_event",effect.event||"",catalogOptions("event",effect.event||""))}`;
    else fields=`${input("État à modifier","outcome_effect_state",effect.key||"")}${select("Opération","outcome_effect_operation",effect.operation||"set",[["set","Définir"],["increment","Ajouter"]])}${input("Valeur","outcome_effect_value",effect.value??1,"number")}`;
    element.innerHTML=`<button type="button" class="remove">×</button><div class="outcome-effect-grid">${select("Type","outcome_effect_type",type,outcomeTypes)}${fields}</div>`;element.querySelector('[data-field="outcome_effect_type"]').onchange=event=>{effect={type:event.target.value};render();};element.querySelector(".remove").onclick=()=>element.remove();};render();
}

function addAction(action={}) {
  const container = $("#actions");
  const element = document.createElement("details");
  element.className = "builder action-builder";
  element.open = !action.key;
  const number = container.children.length + 1;
  const conditionGroup=action.conditions?.any?"any":"all";const hooks=action.hooks||{};const hookEvent=name=>(Array.isArray(hooks[name])?hooks[name][0]:hooks[name])?.event||"";
  element.innerHTML = `<summary><span class="action-number">Action ${number}</span><strong data-action-summary>${escapeHtml(action.emoji||"⚙️")} ${escapeHtml(action.name||"Nouvelle action")}</strong><small data-action-key-summary>${escapeHtml(action.key||"à configurer")}</small></summary><div class="action-configuration"><button type="button" class="remove" aria-label="Supprimer cette action">×</button><div class="form-grid">${input("Nom du bouton","action_name",action.name||"")}${input("Symbole","action_emoji",action.emoji||"")}</div><div class="checks">${check("Disponible pour les joueurs","action_enabled",action.enabled!==false)}</div><div class="section-head"><b>Conditions d’accès</b><button type="button" class="secondary add-condition">＋ Ajouter</button></div><div class="form-grid">${select("Combinaison","condition_group",conditionGroup,[["all","Toutes les conditions"],["any","Au moins une condition"]])}</div><div class="condition-editors"></div><div class="section-head"><div><b>Résultats</b><small class="field-note">Pour attribuer un métier : Ajouter → Gérer un métier → Attribuer.</small></div><button type="button" class="secondary add-inner">＋ Ajouter</button></div><div class="action-effects"></div><details><summary>⚡ Événements</summary><div class="form-grid">${select("Au lancement","action_hook_start",hookEvent("on_start"),catalogOptions("event",hookEvent("on_start")))}${select("Après réussite","action_hook_success",hookEvent("on_success"),catalogOptions("event",hookEvent("on_success")))}${select("En cas d’échec","action_hook_failure",hookEvent("on_failure"),catalogOptions("event",hookEvent("on_failure")))}${select("À la récupération","action_hook_claim",hookEvent("on_claim"),catalogOptions("event",hookEvent("on_claim")))}</div></details><details class="advanced"><summary>Identifiant technique</summary><div class="advanced-content">${input("Identifiant","action_key",action.key||"")}</div></details></div>`;
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
  const element=document.createElement("div");element.className="builder effect-builder";element.dataset.originalEffect=JSON.stringify(effect);container.append(element);
  const types=[["message","Afficher un message"],["reward","Donner une ressource"],["cost","Retirer une ressource"],["profession","Gérer un métier / XP"],["schedule","Lancer une activité temporisée"],["claim_scheduled","Récupérer une activité terminée"],["emit","Déclencher un événement"],["stock_cost","Retirer du stock du bâtiment"],["stock_reward","Ajouter au stock du bâtiment"],["durability","User un outil"],["repair","Réparer un outil"],["random_reward","Butin aléatoire avancé"],["random_bundle","Résultat groupé avancé"],["random_message","Message aléatoire avancé"],["upgrade","Amélioration avancée"]];
  types.splice(3,0,["play_audio","Jouer un son"],["set_audio_group","Changer l’ambiance"]);
  const render=()=>{const type=effect.type||"message";let fields="",afterRender=()=>{};
    if(type==="message")fields=`<label class="effect-wide">Message affiché au joueur<textarea data-field="effect_text" rows="3" placeholder="Décris clairement ce qui vient de se passer.">${escapeHtml(effect.text||"")}</textarea></label><p class="effect-help">Un message n’a pas de quantité : seul ce texte sera affiché.</p>`;
    else if(["reward","cost"].includes(type))fields=`${itemSelector(type==="reward"?"Ressource donnée":"Ressource retirée","effect_resource",effect.resource||"","any")}${input("Quantité","effect_amount",effect.amount??1,"number","min=0")}`;
    else if(type==="emit")fields=`${select("Événement déclenché","effect_event",effect.event||"",catalogOptions("event",effect.event||""))}<p class="effect-help">KingdomEvent prévient les autres modules, notamment KingdomVoice.</p>`;
    else if(type==="profession"){const operation=effect.operation||"experience";fields=`${select("Ce résultat doit…","effect_profession_operation",operation,[["join","Attribuer / rejoindre le métier"],["leave","Faire quitter le métier"],["experience","Donner de l’expérience métier"]])}${select("Métier concerné","effect_profession",effect.profession||"",professionOptions(effect.profession||""))}${operation==="experience"?input("Points d’expérience gagnés","effect_profession_experience",effect.experience||effect.amount||0,"number","min=0"):""}<p class="effect-help">L’expérience augmente automatiquement le niveau selon le seuil configuré dans le bâtiment.</p>`;afterRender=()=>{element.querySelector('[data-field="effect_profession_operation"]').onchange=event=>{effect={...effect,type,operation:event.target.value,profession:fieldValue("effect_profession",element)};render();};};}
    else if(["stock_cost","stock_reward"].includes(type))fields=`${itemSelector("Objet du stock","effect_stock_item",effect.item||"")}${input("Quantité","effect_amount",effect.amount??1,"number","min=0")}${select("Bâtiment concerné","effect_stock_building",effect.building||state.interfaceDraft.target_building_key,buildingTargetOptions(effect.building||state.interfaceDraft.target_building_key))}`;
    else if(type==="durability")fields=`${itemSelector("Outil utilisé","effect_tool",effect.tool||"","tool")}${input("Points de durabilité retirés","effect_amount",effect.amount??1,"number","min=0")}`;
    else if(type==="repair")fields=`${itemSelector("Outil réparé","effect_tool",effect.tool||"","tool")}${input("Durabilité maximale","effect_max_durability",effect.max_durability||1,"number","min=1")}${input("Prix par point","effect_price_per_point",effect.price_per_point||1,"number","min=0")}`;
    else if(type==="claim_scheduled")fields=`${input("Identifiant de l’activité à récupérer","effect_action",effect.action||"")}<p class="effect-help">Utilise exactement le même identifiant que dans « Lancer une activité temporisée ».</p>`;
    else if(type==="schedule"){fields=`<div class="effect-schedule-guide"><b>⏳ Déroulement</b><span>1. Le joueur paie les coûts placés avant cet effet.</span><span>2. Le moteur attend la durée configurée.</span><span>3. Le bouton de récupération remet les résultats ci-dessous.</span></div><div class="form-grid">${input("Identifiant de l’activité","effect_action",effect.action||"activite","text")}${input("Durée (secondes)","effect_duration",effect.duration_seconds||0,"number","min=0")}${select("Limite appliquée","effect_limit_scope",effect.limit_scope||"player_action",[["player","Toutes les activités du joueur"],["player_building","Dans ce bâtiment"],["player_action","Cette activité seulement"],["category","Cette catégorie"]])}${input("Maximum simultané","effect_max_active",effect.max_active||1,"number","min=1")}${input("Catégorie facultative","effect_category",effect.category||"")}</div><div class="section-head"><div><b>Récompenses remises à la récupération</b><small class="field-note">Ajoute ici ressources, XP métier, messages ou événements.</small></div><button type="button" class="secondary add-scheduled-effect">＋ Ajouter un résultat final</button></div><div class="scheduled-effects"></div>`;afterRender=()=>{const nested=element.querySelector(".scheduled-effects");(effect.effects||[]).forEach(child=>addEffect(nested,child));element.querySelector(".add-scheduled-effect").onclick=()=>addEffect(nested,{});};}
    else fields=`<p class="effect-help">Ce résultat avancé conserve sa configuration actuelle. Pour une nouvelle activité, préfère les zones et résultats pondérés de la section Métiers.</p>`;
    element.innerHTML=`<button type="button" class="remove" aria-label="Supprimer ce résultat">×</button><div class="effect-editor-head">${select("Résultat","effect_type",type,types)}</div><div class="effect-specific-fields">${fields}</div>`;
    element.querySelector('[data-field="effect_type"]').onchange=event=>{effect={type:event.target.value};element.dataset.originalEffect=JSON.stringify(effect);render();};element.querySelector(".remove").onclick=()=>element.remove();bindItemSelectors(element);afterRender();
    if(type==="play_audio")element.querySelector(".effect-specific-fields").innerHTML=`${select("Son joué dans le bâtiment","effect_audio_key",effect.audio_key||"",audioOptions(effect.audio_key||""))}<p class="effect-help">Le bot vocal attribué au bâtiment joue ce son, puis reprend l’ambiance générale.</p>`;
    if(type==="set_audio_group")element.querySelector(".effect-specific-fields").innerHTML=`${select("Nouvelle ambiance","effect_group_key",effect.group_key||"",currentSoundGroupOptions(effect.group_key||""))}<p class="effect-help">Le changement reste actif jusqu’au prochain groupe.</p>`;
  };render();
}

function readEffects(container) {
  return [...container.querySelectorAll(":scope > .effect-builder")].map(element => {
    const type = fieldValue("effect_type",element);
    if(type==="profession"){
      const operation=fieldValue("effect_profession_operation",element)||"experience",profession=fieldValue("effect_profession",element);
      return operation==="experience"?{type,operation,profession,experience:fieldValue("effect_profession_experience",element)||0,experience_per_level:100}:{type,operation,profession,exclusive:true,block_when_pending:true};
    }
    if(type==="play_audio")return {type,audio_key:fieldValue("effect_audio_key",element)};
    if(type==="set_audio_group")return {type,group_key:fieldValue("effect_group_key",element)};
    if(type==="schedule")return {...JSON.parse(element.dataset.originalEffect||"{}"),type,action:fieldValue("effect_action",element),duration_seconds:fieldValue("effect_duration",element),limit_scope:fieldValue("effect_limit_scope",element),max_active:fieldValue("effect_max_active",element),category:fieldValue("effect_category",element)||"",effects:readEffects(element.querySelector(".scheduled-effects"))};
    if(type==="claim_scheduled")return {type,action:fieldValue("effect_action",element)};
    if(["stock_cost","stock_reward"].includes(type))return {type,item:fieldValue("effect_stock_item",element),amount:fieldValue("effect_amount",element),building:fieldValue("effect_stock_building",element)};
    if(type==="durability")return {type,tool:fieldValue("effect_tool",element),amount:fieldValue("effect_amount",element)};
    if(type==="repair")return {type,tool:fieldValue("effect_tool",element),max_durability:fieldValue("effect_max_durability",element),price_per_point:fieldValue("effect_price_per_point",element)};
    if (["random_reward","random_bundle","random_message","upgrade"].includes(type)) return {...JSON.parse(element.dataset.originalEffect || '{}'),type};
    if (type === "message") return {type,text:fieldValue("effect_text",element)};
    if (type === "emit") return {type,event:fieldValue("effect_event",element),payload:{}};
    return {type,resource:fieldValue("effect_resource",element),amount:fieldValue("effect_amount",element)};
  });
}

function addConditionEditor(container,source={}) {
  let negated=!!source.not,condition=clone(source.not||source);const element=document.createElement("div");element.className="builder condition-editor";container.append(element);
  const render=()=>{const type=condition.type||"resource";let reference="";
    if(type==="resource")reference=itemSelector("Ressource","condition_ref",condition.resource||"","resource");
    else if(["item_present","item_absent","building_stock"].includes(type))reference=itemSelector("Objet","condition_ref",condition.item||"","any");
    else if(["profession_active","profession_level"].includes(type))reference=select("Métier","condition_ref",condition.profession||"",professionOptions(condition.profession||""));
    else if(["tool_present","tool_level","tool_durability"].includes(type))reference=itemSelector("Outil","condition_ref",condition.tool||"","tool");
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

function addProductModule(product={}){const element=document.createElement("details");element.className="module-card product-module";element.open=!product.item_key;element.innerHTML=`<summary><strong>${escapeHtml(product.emoji||"🛒")} ${escapeHtml(product.name||itemDisplay(product.item_key).name||"Nouveau produit")}</strong><small>${Number(product.price||0)} écus</small></summary><div class="module-content"><button type="button" class="remove">×</button><div class="form-grid">${itemSelector("Objet vendu","product_item",product.item_key||"","consumable")}${input("Nom affiché","product_name",product.name||"")}${input("Emoji","product_emoji",product.emoji||"🛒")}${input("Prix","product_price",product.price||0,"number","min=0")}${input("Stock initial","product_stock",product.initial_stock||0,"number","min=0")}${input("Maximum par commande","product_max",product.maximum_per_purchase||1,"number","min=1")}</div><div class="checks">${check("Disponible au comptoir","product_active",product.active!==false)}</div></div>`;$("#product-modules").append(element);bindItemSelectors(element);element.querySelector(".remove").onclick=()=>element.remove();}
function readProductModules(){return $$("#product-modules > .product-module").map(element=>({item_key:fieldValue("product_item",element),name:fieldValue("product_name",element)||itemDisplay(fieldValue("product_item",element)).name,emoji:fieldValue("product_emoji",element)||"🛒",price:fieldValue("product_price",element),initial_stock:fieldValue("product_stock",element),maximum_per_purchase:fieldValue("product_max",element),active:fieldValue("product_active",element)}));}

function addRecipeIngredient(root,key="",amount=1){const row=document.createElement("div");row.className="form-grid recipe-ingredient";row.innerHTML=`${itemSelector("Ingrédient","recipe_ingredient_item",key,"resource")}${input("Quantité","recipe_ingredient_amount",amount,"number","min=1")}<button type="button" class="remove">×</button>`;root.append(row);bindItemSelectors(row);row.querySelector(".remove").onclick=()=>row.remove();}
function addRecipeModule(recipe={}){const element=document.createElement("details");element.className="module-card recipe-module";element.open=!recipe.key;element.dataset.original=JSON.stringify(recipe);element.innerHTML=`<summary><strong>🍲 ${escapeHtml(recipe.name||recipe.title||recipe.key||"Nouvelle recette")}</strong><small>${Number(recipe.duration_seconds||0)} s</small></summary><div class="module-content"><button type="button" class="remove">×</button><div class="form-grid">${input("Identifiant","recipe_key",recipe.key||"")}${input("Nom","recipe_name",recipe.name||recipe.title||"")}${select("Métier","recipe_profession",recipe.profession||"",professionOptions(recipe.profession||""))}${input("Niveau requis","recipe_level",recipe.required_level||1,"number","min=1")}${input("Durée (secondes)","recipe_duration",recipe.duration_seconds||0,"number","min=0")}${input("Énergie","recipe_energy",recipe.energy_cost||0,"number","min=0")}${itemSelector("Produit obtenu","recipe_output",recipe.output_item_key||"")}${input("Quantité produite","recipe_output_quantity",recipe.output_quantity||1,"number","min=1")}${select("Destination","recipe_destination",recipe.output_destination||"building_stock",[["building_stock","Stock du bâtiment"],["player","Inventaire du joueur"]])}${input("Salaire","recipe_reward",recipe.reward||0,"number","min=0")}${input("Expérience","recipe_experience",recipe.experience||0,"number","min=0")}</div><div class="section-head"><b>Ingrédients</b><button type="button" class="secondary add-recipe-ingredient">＋ Ajouter</button></div><div class="recipe-ingredients"></div><div class="checks">${check("Recette active","recipe_active",recipe.active!==false)}</div></div>`;$("#recipe-modules").append(element);bindItemSelectors(element);Object.entries(recipe.ingredients||{}).forEach(([key,amount])=>addRecipeIngredient(element.querySelector(".recipe-ingredients"),key,amount));element.querySelector(".add-recipe-ingredient").onclick=()=>addRecipeIngredient(element.querySelector(".recipe-ingredients"));element.querySelector(":scope > .module-content > .remove").onclick=()=>element.remove();}
function readRecipeModules(){return $$("#recipe-modules > .recipe-module").map((element,index)=>{const original=JSON.parse(element.dataset.original||"{}");const ingredients=Object.fromEntries($$(".recipe-ingredient",element).filter(row=>fieldValue("recipe_ingredient_item",row)).map(row=>[fieldValue("recipe_ingredient_item",row),fieldValue("recipe_ingredient_amount",row)]));return {...original,key:fieldValue("recipe_key",element)||`recipe_${index+1}`,name:fieldValue("recipe_name",element),profession:fieldValue("recipe_profession",element),required_level:fieldValue("recipe_level",element),duration_seconds:fieldValue("recipe_duration",element),energy_cost:fieldValue("recipe_energy",element),output_item_key:fieldValue("recipe_output",element),output_quantity:fieldValue("recipe_output_quantity",element),output_destination:fieldValue("recipe_destination",element),reward:fieldValue("recipe_reward",element),experience:fieldValue("recipe_experience",element),ingredient_source:original.ingredient_source||"building_stock",ingredients,active:fieldValue("recipe_active",element)};});}

function addRumorModule(rumor={}){const element=document.createElement("details");element.className="module-card rumor-module";element.open=!rumor.key;element.innerHTML=`<summary><strong>🗣️ ${escapeHtml(rumor.key||"Nouveau récit")}</strong><small>poids ${Number(rumor.weight||1)}</small></summary><div class="module-content"><button type="button" class="remove">×</button><div class="form-grid">${input("Identifiant","rumor_key",rumor.key||"")}${input("Poids","rumor_weight",rumor.weight||1,"number","min=0.01 step=0.01")}${input("Événement / audio facultatif","rumor_event",rumor.event||rumor.audio||"")}</div><label>Texte raconté<textarea data-field="rumor_text" rows="4">${escapeHtml(rumor.text||"")}</textarea></label><div class="checks">${check("Récit actif","rumor_enabled",rumor.enabled!==false)}</div></div>`;$("#rumor-modules").append(element);element.querySelector(".remove").onclick=()=>element.remove();}
function readRumorModules(){return $$("#rumor-modules > .rumor-module").map((element,index)=>({key:fieldValue("rumor_key",element)||`story_${index+1}`,text:fieldValue("rumor_text",element),weight:fieldValue("rumor_weight",element)||1,event:fieldValue("rumor_event",element)||undefined,enabled:fieldValue("rumor_enabled",element)}));}

function addGameChoice(root,choice={}){const row=document.createElement("div");row.className="module-card game-choice";row.innerHTML=`<button type="button" class="remove">×</button><div class="form-grid">${input("Identifiant du choix","game_choice_key",choice.key||"")}${input("Libellé","game_choice_name",choice.name||"")}${input("Issues gagnantes (séparées par des virgules)","game_choice_wins",(choice.winning_outcomes||choice.winning_faces||[]).join(", "))}${input("Multiplicateur","game_choice_multiplier",choice.multiplier||1,"number","min=0 step=0.1")}</div>`;root.append(row);row.querySelector(".remove").onclick=()=>row.remove();}
function addGameModule(game={}){const element=document.createElement("details");element.className="module-card game-module";element.open=!game.key;element.dataset.original=JSON.stringify(game);element.innerHTML=`<summary><strong>🎲 ${escapeHtml(game.name||game.key||"Nouveau jeu")}</strong><small>${Number(game.sides||6)} issues</small></summary><div class="module-content"><button type="button" class="remove">×</button><div class="form-grid">${input("Identifiant","game_key",game.key||"")}${input("Nom","game_name",game.name||"")}${input("Mise","game_stake",game.stake||0,"number","min=0")}${itemSelector("Monnaie de mise","game_currency",game.stake_resource||"money")}${input("Nombre d'issues","game_sides",game.sides||6,"number","min=2")}</div><div class="section-head"><b>Choix proposés au joueur</b><button type="button" class="secondary add-game-choice">＋ Ajouter un choix</button></div><div class="game-choices"></div></div>`;$("#game-modules").append(element);bindItemSelectors(element);(game.choices||game.bets||[]).forEach(choice=>addGameChoice(element.querySelector(".game-choices"),choice));element.querySelector(".add-game-choice").onclick=()=>addGameChoice(element.querySelector(".game-choices"));element.querySelector(":scope > .module-content > .remove").onclick=()=>element.remove();}
function readGameModules(){return Object.fromEntries($$("#game-modules > .game-module").map((element,index)=>{const original=JSON.parse(element.dataset.original||"{}");const key=fieldValue("game_key",element)||`game_${index+1}`;const choices=$$(".game-choice",element).map((row,choiceIndex)=>({key:fieldValue("game_choice_key",row)||`choice_${choiceIndex+1}`,name:fieldValue("game_choice_name",row),winning_outcomes:String(fieldValue("game_choice_wins",row)||"").split(",").map(value=>Number(value.trim())).filter(Number.isFinite),multiplier:fieldValue("game_choice_multiplier",row)||1}));return [key,{...original,key,name:fieldValue("game_name",element)||key,stake:fieldValue("game_stake",element),stake_resource:fieldValue("game_currency",element)||"money",sides:fieldValue("game_sides",element)||6,choices}];}));}

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
    if(type==="play_audio")return {type,audio_key:fieldValue("outcome_effect_audio_key",element)};
    if(type==="set_audio_group")return {type,group_key:fieldValue("outcome_effect_group_key",element)};
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
  const payload = state.type === "building" ? clone(state.buildingBase || {}) : state.type === "interface" ? clone(state.interfaceDraft || {}) : ["audio","bot"].includes(state.type) ? clone(state.editing?.payload||{}) : {};
  Object.assign(payload,{name:$("#name").value.trim(),emoji:$("#emoji").value.trim(),description:$("#description").value.trim()});
  if (state.type === "building") {
    let modules = {};
    try { modules = JSON.parse(fieldValue("modules_json") || "{}"); }
    catch (_) { throw Error("La configuration modulaire contient un JSON invalide."); }
    modules.professions=readProfessionModules();
    modules.activities=readActivityModules();
    modules.deliveries=readDeliveryModules();
    modules.products=readProductModules();
    modules.recipes=readRecipeModules();
    modules.rumors={...(modules.rumors||{}),catalogue:readRumorModules(),player_cooldown_seconds:fieldValue("rumor_player_cooldown"),global_cooldown_seconds:fieldValue("rumor_global_cooldown")};
    modules.games=readGameModules();
    modules.delivery_mode=fieldValue("delivery_all")?"all_available":"selected_quantity";
    const soundGroups=readSoundGroups(),simpleAmbience=fieldValue("relation_ambience_key")||"";
    if(simpleAmbience){let globalGroup=soundGroups.find(group=>group.key==="global_ambience");if(!globalGroup){globalGroup={key:"global_ambience",name:"Ambiance globale",volume:1,tracks:{music:[],ambience:[],sfx:[],voice:[]}};soundGroups.unshift(globalGroup)}globalGroup.tracks||={};globalGroup.tracks.ambience=[simpleAmbience];}
    else{const globalGroup=soundGroups.find(group=>group.key==="global_ambience");if(globalGroup){globalGroup.tracks||={};globalGroup.tracks.ambience=[]}}
    const selectedAudioGroup=fieldValue("audio_default_group")||"";
    modules.audio={...(modules.audio||{}),default_group_key:simpleAmbience?"global_ambience":selectedAudioGroup==="global_ambience"?"":selectedAudioGroup,groups:soundGroups,event_routes:readSoundRoutes()};
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
    Object.assign(payload,{building_kind:state.selectedPreset||state.editing?.payload?.building_kind||"custom",location_key:fieldValue("building_location")||"",color:fieldValue("color")||"7c5cff",npc_name:fieldValue("npc_name")||"",action_mode:fieldValue("action_mode")||"manual",modules,relations:{...(payload.relations||{}),primary_profession_key:fieldValue("relation_primary_profession")||modules.professions[0]?.key||"",ambience_audio_key:fieldValue("relation_ambience_key")||""},interface:interfaceDefinition,access:{visible:fieldValue("building_visible")!==false,required_roles:(fieldValue("required_roles")||"").split(",").map(value=>value.trim()).filter(Boolean),temporary_text:fieldValue("temporary_text")!==false},actions:$$('#actions > .action-builder').map((element,index)=>{const action={...JSON.parse(element.dataset.originalAction||"{}"),key:fieldValue("action_key",element)||technicalKey(fieldValue("action_name",element),`action_${index+1}`),name:fieldValue("action_name",element),emoji:fieldValue("action_emoji",element),enabled:fieldValue("action_enabled",element),effects:readEffects(element.querySelector(".action-effects")),hooks:readHooks(element)};const conditions=readConditions(element);if(conditions)action.conditions=conditions;else delete action.conditions;return action;})});
  }
  if (state.type === "item") Object.assign(payload,{category:fieldValue("category"),type:fieldValue("type"),rarity:fieldValue("rarity"),price:fieldValue("price"),stack_limit:fieldValue("stack_limit"),stackable:fieldValue("stackable"),consumable:fieldValue("consumable"),sellable:fieldValue("sellable"),building_relations:$$('[data-item-building]:checked').map(field=>({building_key:field.dataset.itemBuilding,relation:$(`[data-item-relation="${CSS.escape(field.dataset.itemBuilding)}"]`).value}))});
  if (state.type === "event") Object.assign(payload,{trigger:{type:fieldValue("trigger_type"),value:fieldValue("trigger_value")},starts_at:fieldValue("starts_at")||null,ends_at:fieldValue("ends_at")||null,priority:fieldValue("priority"),enabled:fieldValue("enabled"),active:fieldValue("enabled"),effects:readEffects($("#effects")),modifiers:readWorldModifiers()});
  if(state.type==="profession")Object.assign(payload,{emoji:fieldValue('profession_emoji')||'⚒️',required_item:fieldValue('profession_item')||'',initial_level:fieldValue('profession_level')||1,experience_per_level:fieldValue('profession_xp')||100});
  if(state.type==="environment")Object.assign(payload,{mode:fieldValue('environment_mode')||'manual',clock_mode:fieldValue('clock_mode')||'accelerated',day:fieldValue('environment_day')||1,hour:fieldValue('environment_hour')??12,minute:fieldValue('environment_minute')??0,speed:fieldValue('environment_speed')??1,weather_interval_seconds:fieldValue('weather_interval')||3600,weather_options:readWeatherOptions(),weather:{...(payload.weather||{}),key:technicalKey(fieldValue('weather_name')||'beau','meteo'),name:fieldValue('weather_name')||'Beau',emoji:fieldValue('weather_emoji')||'☀️',modifiers:readWorldModifiers()}});
  if(state.type==="location")Object.assign(payload,{location_type:fieldValue('location_type')||'place',parent_key:fieldValue('location_parent')||'',tags:(fieldValue('location_tags')||'').split(',').map(value=>value.trim()).filter(Boolean),map:{x:fieldValue('location_map_x')||0,y:fieldValue('location_map_y')||0},exploration_enabled:fieldValue('location_exploration'),activities:readLocationActivities(),connections:readLocationConnections()});
  if (state.type === "bot") Object.assign(payload,{bot_type:fieldValue("bot_type"),application_id_env:fieldValue("application_id_env"),token_env:fieldValue("token_env"),guild_id:fieldValue("guild_id"),presence:fieldValue("presence"),enabled:fieldValue("enabled"),auto_join:fieldValue("auto_join"),voice_channel_id:fieldValue("voice_channel_id")||"0",voice_channel_env:fieldValue("voice_channel_env"),building_key:fieldValue("building_key"),leave_delay:fieldValue("leave_delay"),welcome_folder:fieldValue("welcome_folder"),music_folder:fieldValue("music_folder"),ambience_folder:fieldValue("ambience_folder"),phrase_folder:fieldValue("phrase_folder"),volume:{voice:fieldValue("volume_voice"),music:fieldValue("volume_music"),ambience:fieldValue("volume_ambience"),sfx:fieldValue("volume_sfx")}});
  if (state.type === "audio") Object.assign(payload,{audio_type:fieldValue("audio_type"),channel:fieldValue("audio_type"),speaker_bot_key:fieldValue("speaker_bot_key")||"",tags:(fieldValue("audio_tags")||"").split(",").map(value=>value.trim()).filter(Boolean),volume:fieldValue("volume"),loop:fieldValue("loop")});
  return payload;
}

async function publishItem(key, version) {
  setSaveState("saving","Publication…");
  const response = await fetch(`/api/content/${state.type}/${key}/${version}/publish`,{method:"POST",headers,body:"{}"});
  if (!response.ok) { setSaveState("error","Publication échouée"); alert((await response.json()).detail); return; }
  setSaveState("saved","Publié");
  await loadCatalogs(); await load();
}

function markEditorDirty(){if($("#editor").hidden)return;state.editorDirty=true;setSaveState("saving","Modifications non enregistrées");}
function closeEditor(force=false) { if(state.editorDirty&&!force&&!confirm("Des modifications ne sont pas enregistrées. Fermer quand même ?"))return false;resetEditor(); $("#editor").hidden=true; document.body.classList.remove("modal-open");return true; }

function metricCard(label,value,detail="") { return `<article class="admin-metric"><span>${label}</span><strong>${escapeHtml(value)}</strong>${detail?`<small>${escapeHtml(detail)}</small>`:""}</article>`; }
function inventoryChips(inventory) { const entries=Array.isArray(inventory)?inventory:Object.entries(inventory||{}).map(([id,quantity])=>({id,quantity,...itemDisplay(id)}));return entries.length?`<div class="inventory-chips">${entries.map(item=>`<span class="inventory-chip ${item.missing?'missing-reference':''}" title="ID : ${escapeHtml(item.id)}">${escapeHtml(item.emoji||'📦')} ${escapeHtml(item.name||'Objet inconnu')} × ${item.quantity}${item.missing?' · ⚠ Référence manquante':''}</span>`).join("")}</div>`:"<span class=\"empty-admin\">Vide</span>"; }
function adminTable(headersList,rows) { return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headersList.map(item=>`<th>${item}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`; }
function formatDate(value) { if(!value)return "—";try{return new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"medium"}).format(new Date(value));}catch(_){return value;} }

function renderAdministration(data) {
  if(data.item_catalog)state.catalogs.item=data.item_catalog.items.map(item=>({entity_key:item.id,payload:item.payload,status:item.status,version:item.version}));
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
  if(state.type!=="dashboard")return; // Une réponse lente ne doit pas écraser la page choisie entre-temps.
  const metrics=data.metrics, activeToday=data.players.filter(player=>Date.now()-new Date(player.updated_at).getTime()<86400000).length;
  const serviceMetric=key=>data.services.find(service=>service.key===key)||data.services.find(service=>service.name.toLowerCase().includes(key));
  const rank=(items,kind)=>items.map((player,index)=>{const xp=(player.professions||[]).reduce((sum,job)=>sum+job.experience,0);const detail=kind==="wealth"?`${player.money} écus`:`${player.professions.length} métier(s) · ${xp} XP`;return `<li><span class="rank">${index+1}</span>${player.avatar_url?`<img src="${escapeHtml(player.avatar_url)}" alt="">`:`<i>${escapeHtml((player.display_name||'?')[0])}</i>`}<b>${escapeHtml(player.display_name||player.discord_id)}</b><strong>${detail}</strong></li>`}).join("")||`<li class="empty-admin">Aucun habitant classé.</li>`;
  const projects=(data.projects||[]).map(project=>`<section class="royal-project"><div class="project-head"><div><small>CHANTIER COLLECTIF</small><h2>${project.emoji} ${escapeHtml(project.name)}</h2><p>${escapeHtml(project.description)}</p></div><strong>${project.progress} %</strong></div><progress max="100" value="${project.progress}"></progress><div class="project-stages">${project.stages.map((stage,index)=>`<article class="${stage.complete?'complete':''}"><h3>${stage.complete?'✓':'◆'} Étape ${index+1} · ${escapeHtml(stage.name)}</h3>${stage.requirements.map(item=>`<p><span>${item.emoji} ${escapeHtml(item.name)}</span><b>${item.current} / ${item.required}</b></p>`).join('')}</article>`).join('')}</div></section>`).join("");
  const activity=data.activity.slice(0,10).map(item=>`<li><span class="activity-dot"></span><b>${escapeHtml(item.player_name)}</b><span>${escapeHtml(item.action_name)}</span><small>${escapeHtml(item.building_name)} · ${formatDate(item.created_at)}</small></li>`).join("")||"<li class='empty-admin'>Aucune activité récente.</li>";
  const core=serviceMetric("core"),voice=serviceMetric("voice"),connectedBots=data.services.filter(service=>service.running).length;
  const activeEvents=(data.events||[]).filter(event=>event.status==="published"&&event.enabled).slice(0,4).map(event=>`<article class="dashboard-event"><span>${escapeHtml(event.emoji)}</span><div><b>${escapeHtml(event.name)}</b><small>${escapeHtml(event.trigger==="manual"?"Déclenchement manuel":event.trigger)}</small></div><i>${escapeHtml(event.status)}</i></article>`).join("")||`<p class="empty-admin">Aucun événement actif pour le moment.</p>`;
  const alerts=[...data.services.filter(service=>!service.running).map(service=>({icon:"□",title:`${service.name} arrêté`,detail:"Service à vérifier dans la supervision",kind:"danger"})),...(metrics.pending_jobs?[]:[{icon:"✓",title:"Aucune tâche bloquée",detail:"Les files d’activité sont disponibles",kind:"success"}])].slice(0,5);
  $("#admin-view").innerHTML=`<div class="royal-dashboard"><section class="dashboard-welcome"><div><small>BIENVENUE DANS</small><h2>KINGDOM<span>WEB</span></h2><p>Créez, gérez et donnez vie à votre serveur Discord.</p></div><i aria-hidden="true">K</i></section><section class="royal-metrics dashboard-metrics">${metricCard("JOUEURS",metrics.players,`${activeToday} actif(s) aujourd’hui`)}${metricCard("BÂTIMENTS ACTIFS",metrics.published_buildings,`${metrics.buildings} définition(s)`)}${metricCard("ÉVÉNEMENTS ACTIFS",metrics.active_events,"publiés et activés")}${metricCard("SERVICES CONNECTÉS",`${connectedBots}/${data.services.length}`,core?.running?"KingdomCore en ligne":"KingdomCore arrêté")}${metricCard("DONNÉES","Synchronisées",formatDate(data.generated_at))}</section><div class="dashboard-columns"><section class="royal-panel dashboard-activity"><div class="royal-panel-title"><small>ACTIVITÉ RÉCENTE</small><button data-go="supervision">Voir tout</button></div><ol class="royal-activity">${activity}</ol></section><section class="royal-panel"><div class="royal-panel-title"><small>ÉVÉNEMENTS ACTIFS</small><button data-go="event">Gérer</button></div><div class="dashboard-events">${activeEvents}</div></section><section class="royal-panel"><div class="royal-panel-title"><small>ALERTES</small><button data-go="supervision">Superviser</button></div><div class="dashboard-alerts">${alerts.map(alert=>`<article class="${alert.kind}"><span>${alert.icon}</span><div><b>${escapeHtml(alert.title)}</b><small>${escapeHtml(alert.detail)}</small></div></article>`).join("")}</div></section></div>${projects}<section class="dashboard-quick"><small>ACCÈS RAPIDE</small><div><button data-go="building">♜ <span><b>Créer un bâtiment</b><small>Ajouter un nouveau lieu</small></span></button><button data-go="item">⚔ <span><b>Créer un objet</b><small>Enrichir le catalogue</small></span></button><button data-go="event">✦ <span><b>Créer un événement</b><small>Animer le Royaume</small></span></button><button data-go="bot">♙ <span><b>Gérer les bots</b><small>Configurer Discord</small></span></button></div></section><div class="royal-rankings dashboard-rankings"><section class="royal-panel"><div class="royal-panel-title"><small>FORTUNES</small><h2>Les plus riches</h2></div><ol>${rank(data.rankings?.wealth||[],"wealth")}</ol></section><section class="royal-panel"><div class="royal-panel-title"><small>MÉTIERS</small><h2>Les plus expérimentés</h2></div><ol>${rank(data.rankings?.experience||[],"experience")}</ol></section></div></div>`;
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
  const settingsTabs=$('.section-tabs');
  settingsTabs.insertAdjacentHTML('beforeend',`<button data-settings-tab="channels" class="${state.settingsTab==="channels"?"active":""}">Doublons Discord</button>`);
  $('.settings-grid').insertAdjacentHTML('beforeend',`<section class="admin-section settings-card discord-audit" data-settings-panel="channels"><h3>🧹 Doublons de salons Discord</h3><p>KingdomWeb compare les salons réels aux bâtiments publiés. Rien ne sera supprimé sans votre sélection et une confirmation.</p><button type="button" class="primary" id="audit-discord-channels">Analyser les salons</button><div id="discord-channel-audit" class="discord-audit-results"><p class="field-note">L’analyse protège les salons manuels et les catégories qui en contiennent.</p></div></section>`);
  $$('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==state.settingsTab);
  $$('[data-settings-tab]').forEach(button=>button.onclick=()=>{state.settingsTab=button.dataset.settingsTab;$$('[data-settings-tab]').forEach(item=>item.classList.toggle("active",item===button));$$('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==state.settingsTab);});
  bindNavigationShortcuts();$("#save-settings").onclick=saveSettings;$("#audit-discord-channels").onclick=loadDiscordChannelAudit;
}

async function persistBuildingBotRelation(buildingKey, botKey) {
  const selected=state.catalogs.bot.find(item=>item.entity_key===botKey),currentlyAssigned=state.catalogs.bot.filter(item=>item.payload.building_key===buildingKey&&item.entity_key!==botKey);
  if(selected?.payload.building_key&&selected.payload.building_key!==buildingKey){const former=state.catalogs.building.find(item=>item.entity_key===selected.payload.building_key)?.payload.name||selected.payload.building_key;if(!confirm(`${selected.payload.name} est actuellement associé à ${former}. Voulez-vous le transférer vers ce bâtiment ?`))throw Error("Transfert du bot annulé.");}
  const update=async(entity,target)=>{const payload={...clone(entity.payload),building_key:target,voice_channel_id:entity.payload.voice_channel_id||"0"};const response=await fetch(`/api/content/bot/${encodeURIComponent(entity.entity_key)}`,{method:"POST",headers,body:JSON.stringify({payload,expected_version:entity.version,author:"studio-building-relation"})});if(!response.ok)throw Error(`Le bâtiment a été enregistré, mais la relation du bot n’a pas pu être modifiée : ${(await response.json()).detail}`);const saved=await response.json();if(entity.status==="published"){const publication=await fetch(`/api/content/bot/${encodeURIComponent(entity.entity_key)}/${saved.version}/publish`,{method:"POST",headers,body:"{}"});if(!publication.ok)throw Error("La nouvelle association du bot n’a pas pu être publiée.");}};
  if(selected&&selected.payload.building_key!==buildingKey)await update(selected,buildingKey);
  for(const entity of currentlyAssigned)await update(entity,"");
}

async function loadDiscordChannelAudit(){
  const button=$("#audit-discord-channels"),target=$("#discord-channel-audit");button.disabled=true;button.textContent="Analyse en cours…";
  const response=await fetch("/api/admin/discord/channels/audit",{headers,cache:"no-store"}),data=await response.json();button.disabled=false;button.textContent="Analyser à nouveau";
  if(!response.ok){target.innerHTML=`<p class="warning-box">${escapeHtml(data.detail||"Analyse impossible")}</p>`;return}
  if(!data.configured){target.innerHTML=`<p class="warning-box">${escapeHtml(data.message)}</p>`;return}
  const affected=data.buildings.filter(item=>item.duplicates.length||item.stale_mapping);
  target.innerHTML=`<div class="discord-audit-summary"><b>${data.duplicate_count} doublon(s) supprimable(s)</b><span>${data.stale_mapping_count} association(s) à corriger</span></div>${affected.map(building=>`<article class="discord-audit-building"><h4>${escapeHtml(building.name)} ${building.stale_mapping?'<span>Association obsolète</span>':''}</h4><small>Référence : ${escapeHtml(building.expected.text)} · ${escapeHtml(building.expected.voice)}</small>${building.duplicates.map(item=>item.safe?`<label class="discord-duplicate"><input type="checkbox" data-duplicate-channel="${item.id}" checked><span><b>${escapeHtml(item.name)}</b> · ${item.type}<small>${escapeHtml(item.reason)} · ID ${item.id}</small></span></label>`:`<div class="discord-protected">🔒 ${escapeHtml(item.name)} · ${escapeHtml(item.reason)}</div>`).join("")}${building.protected.map(item=>`<div class="discord-protected">🔒 ${escapeHtml(item.name)} · ${escapeHtml(item.reason)}</div>`).join("")}</article>`).join("")||'<p class="success-box">Aucun doublon détecté et toutes les associations sont à jour.</p>'}${data.duplicate_count||data.stale_mapping_count?'<button type="button" class="danger" id="cleanup-discord-channels">Appliquer la correction sélectionnée</button>':''}`;
  const cleanup=$("#cleanup-discord-channels");if(cleanup){cleanup.dataset.allowEmpty=String(data.stale_mapping_count>0);cleanup.onclick=cleanupDiscordChannels;}
}

async function cleanupDiscordChannels(){
  const channel_ids=$$('[data-duplicate-channel]:checked').map(item=>item.dataset.duplicateChannel),allowEmpty=$("#cleanup-discord-channels")?.dataset.allowEmpty==="true";if(!channel_ids.length&&!allowEmpty){alert("Sélectionnez au moins un doublon.");return}
  if(!confirm(`Supprimer définitivement ${channel_ids.length} salon(s) Discord sélectionné(s) ? Les salons non reconnus restent protégés.`))return;
  const response=await fetch("/api/admin/discord/channels/cleanup",{method:"POST",headers,body:JSON.stringify({confirmed:true,channel_ids})}),data=await response.json();if(!response.ok){alert(data.detail);return}alert(`${data.deleted_count} doublon(s) supprimé(s). ${data.message}`);await loadDiscordChannelAudit();
}

function setNested(target,path,value){const parts=path.split(".");const last=parts.pop();const parent=parts.reduce((current,key)=>current[key]||={},target);parent[last]=value;}
async function saveSettings(){
  const button=$("#save-settings"),payload=clone(state.settingsEntity.payload);$$('[data-setting]').forEach(field=>setNested(payload,field.dataset.setting,field.type==="checkbox"?field.checked:field.value));button.disabled=true;button.textContent="Publication…";
  const response=await fetch("/api/server/settings",{method:"POST",headers,body:JSON.stringify({payload,expected_version:state.settingsEntity.version})});const data=await response.json();button.disabled=false;button.textContent="Enregistrer et publier";if(!response.ok){alert(data.detail);return;}state.settingsEntity=data;renderSettings(data.payload);
}

function bindNavigationShortcuts(){$$('[data-go]').forEach(button=>button.onclick=()=>navigateTo(button.dataset.go));}
function playerSystemView(){showSystemView();$("#new").hidden=true;}
const playerName=p=>p.display_name||`Joueur ${p.discord_id}`;
const optionList=(entries,key="key",label="name")=>entries.map(x=>`<option value="${escapeHtml(x[key])}">${escapeHtml(`${x.emoji||""} ${x[label]}`.trim())}</option>`).join("");

function relativeActivity(activity){if(!activity)return "En attente";return `${activity.action_name||activity.action_key}${activity.remaining_seconds>0?` · fin dans ${activity.remaining_seconds} s`:" · prêt"}`;}
function unifiedInventory(items){return items.map(item=>`<div class="live-inventory-item ${item.missing?'missing-reference':''}"><span>${escapeHtml(item.emoji||"📦")}</span><div><b>${escapeHtml(item.name)}</b> <strong>×${item.quantity}</strong>${item.tool_state?`<small>Durabilité ${item.tool_state.durability}/${item.tool_state.max_durability} · niv. ${item.tool_state.level}${item.tool_state.loot_bonus?` · bonus +${item.tool_state.loot_bonus}%`:""}</small>`:""}${item.missing?`<small>⚠ Référence manquante · ${escapeHtml(item.item_key)}</small>`:""}</div></div>`).join("")||'<em>Inventaire vide</em>'}
function playerLiveCard(p){const active=p.professions.find(job=>job.active),activity=p.current_activity,expanded=state.expandedPlayers.includes(String(p.discord_id));return `<article class="live-player-card ${p.online?'player-online':'player-offline'}" data-live-player="${escapeHtml(p.discord_id)}"><div class="live-player-top"><div class="player-avatar">${p.avatar_url?`<img src="${escapeHtml(p.avatar_url)}" alt="">`:escapeHtml(playerName(p).slice(0,1).toUpperCase())}</div><div><h2>${escapeHtml(playerName(p))}</h2><span class="presence"><i></i>${p.online?'En vocal':'Hors vocal'}</span></div><strong>${Number(p.money).toLocaleString("fr-FR")} ¤</strong></div><div class="live-current"><span><small>Lieu actuel</small><b>📍 ${escapeHtml(p.location||"Aucun salon vocal")}</b></span><span><small>Action en cours</small><b class="${activity?'action-running':''}">${escapeHtml(relativeActivity(activity))}</b></span></div><div class="live-stats"><span><small>Métier actuel</small><b>${escapeHtml(active?.name||"Aucun")}</b></span><span><small>Niveau métier</small><b>${active?.level||0}</b></span><span><small>Énergie</small><b>${p.energy} %</b></span><span><small>État</small><b>${escapeHtml(p.condition||"Normal")}</b></span></div><div class="live-professions">${p.professions.map(job=>`<span class="${job.active?'active':''}">${job.active?'●':'○'} ${escapeHtml(job.name)} · niv. ${job.level} · ${job.experience} XP</span>`).join("")||'<span>Aucun métier connu</span>'}</div><section class="live-inventory"><h3>Inventaire <small>${p.inventory_total} unité(s)</small></h3><div class="live-inventory-list">${unifiedInventory(p.inventory)}</div></section><details class="player-inline-admin" ${expanded?'open':''}><summary>Modifier ce joueur</summary><div class="inline-admin-actions"><button data-card-mutation="resource" data-resource="money">💰 Argent</button><button data-card-mutation="resource" data-resource="energy">⚡ Énergie</button><button data-card-mutation="inventory">🎒 Inventaire</button><button data-card-mutation="profession">🛠️ Métier / XP</button><button data-card-mutation="tool">🔧 État d’un outil</button><button data-player-advanced>Administration avancée</button></div></details></article>`}

async function loadPlayers(background=false){
  playerSystemView();const filters=state.playerFilters,query=new URLSearchParams({...filters,page:state.playerPage,page_size:50});
  if(!background)$("#admin-view").innerHTML='<div class="empty-admin"><span class="refresh-spin">⟳</span> Chargement des habitants…</div>';
  const response=await fetch(`/api/admin/players?${query}`,{headers,cache:"no-store"});if(!response.ok){if(!background)$("#admin-view").innerHTML=`<div class="empty-admin">${escapeHtml((await response.json()).detail||"Accès refusé")}</div>`;return}
  const data=await response.json();state.playerSnapshots=Object.fromEntries(data.players.map(player=>[String(player.discord_id),player]));
  if(background&&$(".live-player-grid")){$(".live-player-grid").innerHTML=data.players.map(playerLiveCard).join("")||'<div class="empty-admin">Aucun joueur ne correspond à cette recherche.</div>';bindLivePlayerCards();return}
  $("#admin-view").innerHTML=`<div class="players-live-page"><section class="live-toolbar"><label><span>⌕</span><input id="player-search" value="${escapeHtml(filters.search)}" placeholder="Rechercher un joueur par pseudo…"></label><b>${data.total} habitant${data.total!==1?'s':''}</b><span class="direct"><i></i> DIRECT · 5 S</span></section><div class="live-secondary-filters"><select id="player-status"><option value="">Tous les statuts</option><option value="online">En vocal</option><option value="offline">Hors vocal</option><option value="active_activity">Activité en cours</option><option value="without_profession">Sans métier</option></select><select id="player-profession"><option value="">Tous les métiers</option>${optionList(data.catalogs.professions)}</select><button id="refresh-players">⟳ Actualiser</button></div><section class="live-player-grid">${data.players.map(playerLiveCard).join("")||'<div class="empty-admin">Aucun joueur ne correspond à cette recherche.</div>'}</section><div class="pagination"><button id="player-prev" ${data.page<=1?'disabled':''}>← Précédent</button><span>Page ${data.page} / ${data.pages}</span><button id="player-next" ${data.page>=data.pages?'disabled':''}>Suivant →</button></div></div>`;
  $("#player-status").value=filters.status;$("#player-profession").value=filters.profession;let timer;$("#player-search").oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{filters.search=e.target.value;state.playerPage=1;loadPlayers()},300)};[["#player-status","status"],["#player-profession","profession"]].forEach(([selector,key])=>$(selector).onchange=e=>{filters[key]=e.target.value;state.playerPage=1;loadPlayers()});$("#refresh-players").onclick=()=>loadPlayers();$("#player-prev").onclick=()=>{state.playerPage--;loadPlayers()};$("#player-next").onclick=()=>{state.playerPage++;loadPlayers()};
  bindLivePlayerCards();
  clearInterval(state.adminTimer);state.adminTimer=setInterval(()=>{if(state.type==="players"&&!document.hidden)loadPlayers(true)},5000);
}

function bindLivePlayerCards(){$$(".player-inline-admin").forEach(details=>details.ontoggle=()=>{const id=details.closest('[data-live-player]').dataset.livePlayer;state.expandedPlayers=details.open?[...new Set([...state.expandedPlayers,id])]:state.expandedPlayers.filter(value=>value!==id)});$$('[data-card-mutation]').forEach(button=>button.onclick=async()=>{const id=button.closest('[data-live-player]').dataset.livePlayer,detail=await fetchPlayerDetail(id);if(detail)showPlayerMutation(detail,button.dataset.cardMutation,button.dataset.resource)});$$('[data-player-advanced]').forEach(button=>button.onclick=async()=>{const id=button.closest('[data-live-player]').dataset.livePlayer,detail=await fetchPlayerDetail(id);if(detail)showPlayerAdvanced(detail)})}

async function fetchPlayerDetail(id){const response=await fetch(`/api/admin/players/${encodeURIComponent(id)}`,{headers,cache:"no-store"});if(!response.ok){alert((await response.json()).detail);return null}return response.json()}
function showPlayerAdvanced(data){let dialog=$("#player-advanced-dialog");if(!dialog){dialog=document.createElement("dialog");dialog.id="player-advanced-dialog";document.body.append(dialog)}dialog.innerHTML=`<div class="dialog-head"><div><small>ADMINISTRATION AVANCÉE</small><h2>${escapeHtml(playerName(data.player))}</h2></div><button data-close>×</button></div><div class="advanced-player-content"><h3>Activités</h3>${data.activities.map(item=>`<div class="activity-row"><span><b>${escapeHtml(item.building_key)} · ${escapeHtml(item.action_key)}</b><small>${escapeHtml(item.status)}</small></span>${item.status==='pending'?`<button data-advanced-activity="${item.id}" data-operation="finish">Terminer</button><button class="danger" data-advanced-activity="${item.id}" data-operation="cancel">Annuler</button>`:""}</div>`).join("")||'<p>Aucune activité.</p>'}<h3>Cooldowns</h3>${data.cooldowns.map(item=>`<div class="activity-row"><span>${escapeHtml(item.building_key)} · ${escapeHtml(item.action_key)}</span><button data-advanced-cooldown="${escapeHtml(item.building_key)}|${escapeHtml(item.action_key)}">Réinitialiser</button></div>`).join("")||'<p>Aucun cooldown.</p>'}<h3>Historique administratif</h3>${data.history.administration.map(item=>`<div class="audit-row"><b>${escapeHtml(item.action)} · ${escapeHtml(item.target)}</b><small>${formatDate(item.created_at)} — ${escapeHtml(item.reason)}</small></div>`).join("")||'<p>Aucune modification.</p>'}<h3>Historique joueur</h3><div class="table-scroll"><table class="player-table"><tbody>${historyRows(data)}</tbody></table></div></div>`;dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelectorAll('[data-advanced-activity]').forEach(button=>button.onclick=()=>{dialog.close();showPlayerMutation(data,"activity",null,{id:Number(button.dataset.advancedActivity),operation:button.dataset.operation})});dialog.querySelectorAll('[data-advanced-cooldown]').forEach(button=>button.onclick=()=>{const [building_key,action_key]=button.dataset.advancedCooldown.split('|');dialog.close();showPlayerMutation(data,"cooldown",null,{building_key,action_key})})}

function historyRows(data){const entries=[...data.history.actions.map(x=>({...x,origin:"Moteur",summary:`${x.building_key} · ${x.action_key}`})),...data.history.deliveries.map(x=>{const item=itemDisplay(x.resource_key);return {...x,origin:"Livraison",summary:`${x.quantity} ${item.name}${item.missing?` (${x.resource_key} · référence manquante)`:""} · ${x.total_payment} ¤`}}),...data.history.administration.map(x=>({...x,origin:"Administration",summary:`${x.action} · ${x.target} — ${x.reason}`}))].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));return entries.map(x=>`<tr><td>${formatDate(x.created_at)}</td><td>${escapeHtml(x.origin)}</td><td>${escapeHtml(x.summary)}</td></tr>`).join("")||'<tr><td colspan="3">Aucun historique conservé.</td></tr>'}
function playerPanel(data){const p=data.player, active=data.professions.find(x=>x.active), pending=data.activities.find(x=>x.status==="pending");
  if(state.playerTab==="overview")return `<div class="player-cards">${metricCard("💰 ARGENT",Number(p.money).toLocaleString("fr-FR"),"écus")}${metricCard("⚡ ÉNERGIE",`${p.energy} / 100`)}${metricCard("🛠️ MÉTIER",active?.name||"Aucun",active?`niveau ${active.level} · ${active.experience} XP`:"")}${metricCard("🕒 ACTIVITÉ",pending?pending.action_key:"Aucune",pending?pending.building_key:"")}</div><div class="admin-split"><section class="admin-section"><h3>Informations</h3><p>Discord ID : <b>${escapeHtml(p.discord_id)}</b></p><p>Création : ${p.created_at?formatDate(p.created_at):"Non conservée"}</p><p>Dernière activité : ${formatDate(p.updated_at)}</p></section><section class="admin-section"><h3>États et cooldowns</h3>${data.states.map(x=>`<p><b>${escapeHtml(x.key)}</b> : ${escapeHtml(JSON.stringify(x.value))}</p>`).join("")||'<p class="muted">Aucun état temporaire.</p>'}${data.cooldowns.map(x=>`<p>${escapeHtml(x.building_key)} / ${escapeHtml(x.action_key)} <button data-cooldown="${escapeHtml(x.building_key)}|${escapeHtml(x.action_key)}">Réinitialiser</button></p>`).join("")}</section></div>`;
  if(state.playerTab==="inventory")return `<section class="admin-section"><div class="admin-section-head"><h3>Inventaire</h3><button class="primary" data-mutation="inventory">Modifier</button></div><div class="inventory-grid">${data.inventory.map(x=>`<article class="${x.missing?'missing-reference':''}"><span>${escapeHtml(x.emoji)}</span><div><b>${escapeHtml(x.name)}</b><small>${x.missing?`⚠ Référence manquante · ${escapeHtml(x.item_key)}`:escapeHtml(x.category)}</small></div><strong>× ${x.quantity}</strong></article>`).join("")||'<p class="muted">Inventaire vide.</p>'}</div></section>`;
  if(state.playerTab==="professions")return `<section class="admin-section"><div class="admin-section-head"><h3>Métiers</h3><button class="primary" data-mutation="profession">Administrer</button></div>${data.professions.map(x=>`<article class="profession-row"><div><b>${x.active?'● ':''}${escapeHtml(x.name)}</b><small>${x.active?'Actif':'Historique'}</small></div><div>Niveau ${x.level} · ${x.experience} XP</div><progress max="${x.experience_per_level}" value="${x.experience%x.experience_per_level}"></progress></article>`).join("")||'<p class="muted">Aucun métier pratiqué.</p>'}</section>`;
  if(state.playerTab==="tools")return `<section class="admin-section"><div class="admin-section-head"><h3>Équipements et outils</h3><button class="primary" data-mutation="tool">Administrer</button></div><div class="inventory-grid">${data.tools.map(x=>`<article class="${x.missing?'missing-reference':''}"><span>${escapeHtml(x.emoji)}</span><div><b>${escapeHtml(x.name)}</b><small>${x.missing?`⚠ Référence manquante · ${escapeHtml(x.tool_key)}`:`Niveau ${x.level} · bonus +${x.loot_bonus}`}</small><progress max="${x.max_durability}" value="${x.durability}"></progress></div><strong>${x.durability} / ${x.max_durability}</strong></article>`).join("")||'<p class="muted">Aucun outil persistant.</p>'}</div></section>`;
  if(state.playerTab==="activities")return `<section class="admin-section"><h3>Activités persistantes</h3>${data.activities.map(x=>`<article class="activity-row"><div><b>${escapeHtml(x.building_key)} · ${escapeHtml(x.action_key)}</b><small>${escapeHtml(x.category||"activité")} · ${escapeHtml(x.status)} · ${formatDate(x.created_at)}</small></div>${x.status==="pending"?`<div><button data-activity="${x.id}" data-operation="finish">Terminer maintenant</button><button class="danger" data-activity="${x.id}" data-operation="cancel">Annuler</button></div>`:""}</article>`).join("")||'<p class="muted">Aucune activité.</p>'}</section>`;
  if(state.playerTab==="history")return `<section class="admin-section"><h3>Historique réellement journalisé</h3><div class="table-scroll"><table class="player-table"><thead><tr><th>Date</th><th>Origine</th><th>Résumé</th></tr></thead><tbody>${historyRows(data)}</tbody></table></div></section>`;
  return `<section class="admin-section"><h3>Administration</h3><p class="warning-box">Toutes les opérations nécessitent un motif et sont enregistrées dans le journal.</p><div class="admin-actions"><button class="primary" data-mutation="resource" data-resource="money">Modifier l’argent</button><button class="primary" data-mutation="resource" data-resource="energy">Modifier l’énergie</button><button data-mutation="inventory">Modifier l’inventaire</button><button data-mutation="profession">Gérer un métier / XP</button><button data-mutation="tool">Gérer un outil</button></div><h3>Journal administratif</h3>${data.history.administration.map(x=>`<article class="audit-row"><b>${escapeHtml(x.admin_id)}</b> · ${escapeHtml(x.action)} sur ${escapeHtml(x.target)}<small>${formatDate(x.created_at)} — ${escapeHtml(x.reason)}</small></article>`).join("")||'<p class="muted">Aucune correction administrative.</p>'}</section>`;
}

async function openPlayer(id){playerSystemView();const response=await fetch(`/api/admin/players/${encodeURIComponent(id)}`,{headers});if(!response.ok){state.playerId=null;await loadPlayers();return}const data=await response.json(),p=data.player;$("#admin-view").innerHTML=`<div class="player-detail"><button id="back-players">← Retour aux joueurs</button><header class="player-hero"><div class="player-avatar">${p.avatar_url?`<img src="${escapeHtml(p.avatar_url)}">`:"👤"}</div><div><small>FICHE JOUEUR</small><h2>${escapeHtml(playerName(p))}</h2><p>${escapeHtml(p.discord_id)}</p></div><button id="refresh-player">⟳ Actualiser</button></header><nav class="section-tabs player-tabs">${[["overview","Vue générale"],["inventory","Inventaire"],["professions","Métiers"],["tools","Équipements"],["activities","Activités"],["history","Historique"],["administration","Administration"]].map(([k,l])=>`<button data-player-tab="${k}" class="${state.playerTab===k?'active':''}">${l}</button>`).join("")}</nav><div id="player-panel">${playerPanel(data)}</div></div>`;
  $("#back-players").onclick=()=>{state.playerId=null;loadPlayers()};$("#refresh-player").onclick=()=>openPlayer(id);$$('[data-player-tab]').forEach(b=>b.onclick=()=>{state.playerTab=b.dataset.playerTab;openPlayer(id)});
  $$('[data-mutation]').forEach(b=>b.onclick=()=>showPlayerMutation(data,b.dataset.mutation,b.dataset.resource));$$('[data-activity]').forEach(b=>b.onclick=()=>showPlayerMutation(data,"activity",null,{id:Number(b.dataset.activity),operation:b.dataset.operation}));$$('[data-cooldown]').forEach(b=>b.onclick=()=>{const [building,action]=b.dataset.cooldown.split('|');showPlayerMutation(data,"cooldown",null,{building_key:building,action_key:action})});
}

function showPlayerMutation(data,type,resource=null,preset={}){let dialog=$("#player-admin-dialog");if(!dialog){dialog=document.createElement("dialog");dialog.id="player-admin-dialog";document.body.append(dialog)}const itemOptions=optionList(data.catalogs.items), professionOptions=optionList(data.catalogs.professions), tools=optionList(data.catalogs.items);let fields="";
  if(type==="resource")fields=`<input type="hidden" name="resource" value="${resource}"><label>Valeur actuelle<input disabled value="${data.player[resource]}"></label><label>Opération<select name="operation"><option value="add">Ajouter</option><option value="remove">Retirer</option><option value="set">Définir</option></select></label><label>Montant<input name="amount" type="number" min="0" required></label>`;
  if(type==="inventory")fields=`${itemSelector("Objet","item_key","","any","",data.inventory.filter(item=>item.missing))}<label>Opération<select name="operation"><option value="add">Ajouter</option><option value="remove">Retirer</option><option value="set">Définir la quantité</option></select></label><label>Quantité<input name="amount" type="number" min="0" required></label><p class="field-note">Une référence manquante peut uniquement être retirée ou définie à zéro.</p>`;
  if(type==="profession")fields=`<label>Métier<select name="profession_key">${professionOptions}</select></label><label>Opération<select name="operation"><option value="join">Attribuer</option><option value="leave">Faire quitter</option><option value="add_xp">Ajouter de l’XP</option><option value="set_xp">Définir l’XP</option></select></label><label>Expérience<input name="experience" type="number" min="0" value="0"></label>`;
  if(type==="tool")fields=`${itemSelector("Outil","tool_key","","tool")}<label>Opération<select name="operation"><option value="grant">Attribuer</option><option value="repair">Réparer</option><option value="update">Modifier</option><option value="remove">Retirer</option></select></label><div class="cols"><label>Durabilité<input name="durability" type="number" min="0" value="100"></label><label>Maximum<input name="max_durability" type="number" min="1" value="100"></label></div><div class="cols"><label>Niveau<input name="level" type="number" min="1" value="1"></label><label>Bonus<input name="loot_bonus" type="number" value="0"></label></div>`;
  if(type==="activity")fields=`<input type="hidden" name="operation" value="${preset.operation}"><p class="warning-box">${preset.operation==='cancel'?'Les coûts consommés ne seront pas remboursés.':'L’activité deviendra immédiatement récupérable.'}</p>`;
  if(type==="cooldown")fields=`<p>Réinitialiser ${escapeHtml(preset.building_key)} / ${escapeHtml(preset.action_key)} ?</p>`;
  dialog.innerHTML=`<form method="dialog" id="player-mutation-form"><div class="dialog-head"><div><small>OPÉRATION ADMINISTRATIVE</small><h2>${escapeHtml(playerName(data.player))}</h2></div><button value="cancel">×</button></div><div class="mutation-fields">${fields}<label>Motif de la modification<textarea name="reason" minlength="3" required placeholder="Ex. correction après un blocage"></textarea></label><div id="player-mutation-error"></div></div><div class="actions"><button value="cancel">Annuler</button><button value="confirm" class="primary">Confirmer</button></div></form>`;dialog.showModal();dialog.querySelector('form').onsubmit=async event=>{if(event.submitter?.value!=="confirm")return;event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));["amount","experience","durability","max_durability","level","loot_bonus"].forEach(k=>{if(k in body)body[k]=Number(body[k])});Object.assign(body,preset);const path=type==="activity"?`activities/${preset.id}`:type==="cooldown"?"cooldowns/reset":type==="resource"?"resources":type==="profession"?"professions":type==="tool"?"tools":"inventory";const destructive=["remove","leave","cancel","reset"].includes(body.operation)||type==="cooldown";if(destructive&&!confirm("Confirmer cette opération difficilement réversible ?"))return;const response=await fetch(`/api/admin/players/${encodeURIComponent(data.player.discord_id)}/${path}`,{method:"POST",headers,body:JSON.stringify(body)});if(!response.ok){dialog.querySelector('#player-mutation-error').textContent=(await response.json()).detail;return}dialog.close();await openPlayer(data.player.discord_id)};
}

function navigateTo(type){const button=$(`#nav [data-type="${type}"]`);if(button){const submenu=button.closest('[data-nav-submenu]');if(submenu)openNavigationGroup(submenu.dataset.navSubmenu);button.click();}}

function openNavigationGroup(group){
  // La navigation de KingdomWeb appartient à la coque globale. Les modules
  // ne doivent jamais masquer les autres familles lorsqu'ils sont ouverts.
  $$('[data-nav-submenu]').forEach(menu=>{menu.hidden=false;const trigger=$(`[data-nav-group="${menu.dataset.navSubmenu}"]`);trigger?.setAttribute("aria-expanded","true");});
}

function activateNavigation(button){
  const parent=button.closest('[data-nav-submenu]');
  openNavigationGroup(parent?.dataset.navSubmenu||"");
  $$('#nav [data-type]').forEach(item=>item.classList.toggle("active",item===button));
  $$('#nav [data-nav-group]').forEach(item=>item.classList.toggle("active",parent?.dataset.navSubmenu===item.dataset.navGroup));
}

$("#cards").addEventListener("click", async event => {
  const preview=event.target.closest("[data-audio-preview]");
  if(preview){event.stopPropagation();await previewAudio(preview.dataset.audioPreview);return;}
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
    button.disabled=true; button.textContent="Enregistrement…"; setSaveState("saving","Enregistrement…");
    const key=$("#key").value,selectedBuildingBot=state.type==="building"?fieldValue("relation_bot_key")||"":"",payload=buildPayload();
    let response=await fetch(`/api/content/${state.type}/${key}`,{method:"POST",headers,body:JSON.stringify({payload,expected_version:state.editing?.version})});
    if(response.status===409&&state.editing){
      const latestResponse=await fetch(`/api/content/${state.type}/${encodeURIComponent(key)}`,{headers,cache:"no-store"});
      if(!latestResponse.ok)throw Error((await response.json()).detail);
      const latest=await latestResponse.json(),automatic=/^(migration|seed|import)/i.test(String(latest.author||""));
      if(!automatic&&!confirm(`Une autre modification a créé la version ${latest.version}. Voulez-vous enregistrer vos changements par-dessus cette version ?`))throw Error("Enregistrement annulé : recharge le bâtiment pour voir la version la plus récente.");
      state.editing=latest;
      response=await fetch(`/api/content/${state.type}/${key}`,{method:"POST",headers,body:JSON.stringify({payload,expected_version:latest.version})});
    }
    if(!response.ok) throw Error((await response.json()).detail);
    const saved=await response.json();
    if(state.type==="building")await persistBuildingBotRelation(key,selectedBuildingBot);
    if(state.type==="audio"){
      const published=await fetch(`/api/content/audio/${saved.entity_key}/${saved.version}/publish`,{method:"POST",headers,body:"{}"});
      if(!published.ok)throw Error((await published.json()).detail);
    }
    state.editorDirty=false;closeEditor(true); await loadCatalogs(); await load(); setSaveState("saved",state.type==="audio"?"Publié":"Brouillon enregistré");
  } catch(error) { $("#error").textContent=error.message; setSaveState("error","Échec de sauvegarde"); }
  finally { button.disabled=false; button.textContent="Enregistrer le brouillon"; }
};

$("#new").onclick=startCreate; $("#search").oninput=renderCards;
$("#editor-form").addEventListener("input",markEditorDirty);$("#editor-form").addEventListener("change",markEditorDirty);
window.addEventListener("beforeunload",event=>{if(!state.editorDirty)return;event.preventDefault();event.returnValue=""});
applyTheme(document.documentElement.dataset.theme);
$("#theme-toggle").onclick=()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark",true);
$("#account-button").onclick=()=>navigateTo("profile");
$("#server-selector").onchange=event=>selectServer(event.target.value);
const setSidebarOpen=open=>document.body.classList.toggle("sidebar-open",open);
$("#mobile-menu").onclick=()=>setSidebarOpen(true);
$("#sidebar-scrim").onclick=()=>setSidebarOpen(false);
$("#sidebar-collapse").onclick=()=>{document.body.classList.toggle("sidebar-collapsed");localStorage.setItem("kingdomSidebarCollapsed",document.body.classList.contains("sidebar-collapsed")?"1":"0")};
if(localStorage.getItem("kingdomSidebarCollapsed")==="1")document.body.classList.add("sidebar-collapsed");
$("#login-form").onsubmit=async event=>{event.preventDefault();const error=$("#login-error"),button=event.currentTarget.querySelector('button[type="submit"]');error.textContent="";button.disabled=true;try{const response=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});let data={};try{data=await response.json()}catch(_){data={detail:"Le serveur n’a pas renvoyé de réponse exploitable."}}if(!response.ok){error.textContent=data.detail||"Connexion impossible.";return}await initializeAccount()}catch(_){error.textContent="KingdomWeb est momentanément inaccessible."}finally{button.disabled=false}};
$$('#nav [data-nav-group]').forEach(button=>button.onclick=()=>openNavigationGroup(button.dataset.navGroup));
openNavigationGroup("");
$$('#nav [data-type]').forEach(button=>button.onclick=async()=>{KingdomTutorials.pauseForNavigation(button.dataset.type);activateNavigation(button);setSidebarOpen(false);state.type=button.dataset.type;$("#title").textContent=labels[state.type];$("#crumb").textContent=labels[state.type].toUpperCase();$("#page-description").textContent=pageDescriptions[state.type]||"Administrez le Royaume depuis un espace unique.";setSaveState("saved","Synchronisé");await load();KingdomTutorials.resumeForPage(state.type);});
initializeAccount();
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state.type==="players")loadPlayers(true)});
