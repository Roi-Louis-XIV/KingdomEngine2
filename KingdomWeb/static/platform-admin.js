const root = document.querySelector("#platform-root");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const panel = (title, content, subtitle = "", className = "") =>
  `<section class="ops-panel ${className}"><header><div><h2>${title}</h2>${subtitle ? `<small>${subtitle}</small>` : ""}</div></header>${content}</section>`;
const stateLabel = {
  running: "Opérationnel",
  stopped: "Arrêté",
  starting: "Démarrage",
  restarting: "Redémarrage",
  degraded: "Dégradé",
  unknown: "Inconnu",
};
const stateIcon = {
  running: "✓",
  stopped: "■",
  starting: "↗",
  restarting: "↻",
  degraded: "!",
  unknown: "?",
};
const relative = (value) => {
  if (!value) return "Non disponible";
  const elapsed = Date.now() - new Date(value).getTime(),
    minutes = Math.max(0, Math.round(elapsed / 60000));
  return minutes < 1
    ? "À l’instant"
    : minutes < 60
      ? `Il y a ${minutes} min`
      : `Il y a ${Math.round(minutes / 60)} h`;
};

function serviceCard(service) {
  const status = service.status || (service.running ? "running" : "stopped");
  const active = service.running || ["starting", "restarting"].includes(status);
  const actions = service.controllable
    ? `<div class="ops-service-actions"><button type="button" data-platform-service="${esc(service.key)}" data-platform-operation="start" ${active ? "disabled" : ""}>▶ Démarrer</button><button type="button" data-platform-service="${esc(service.key)}" data-platform-operation="restart">↻ Redémarrer</button><button type="button" class="danger" data-platform-service="${esc(service.key)}" data-platform-operation="stop" ${status === "stopped" ? "disabled" : ""}>■ Arrêter</button></div>`
    : "";
  return `<article class="ops-service" data-status="${esc(status)}"><div class="ops-service-icon">${stateIcon[status] || "?"}</div><div><small>${esc(service.key.toUpperCase())}</small><h3>${esc(service.name)}</h3><p>${esc(stateLabel[status] || status)} · vérifié ${relative(service.checked_at)}</p></div><span class="ops-state">${esc(stateLabel[status] || status)}</span><dl><div><dt>Source</dt><dd>${service.provider === "systemd" ? "Service Debian" : "Processus local"}</dd></div><div><dt>Depuis</dt><dd>${esc(service.started_at || "—")}</dd></div><div><dt>Redémarrages</dt><dd>${service.restart_count ?? "—"}</dd></div></dl>${service.last_error ? `<p class="ops-error">${esc(service.last_error)}</p>` : ""}${actions}<small class="ops-service-feedback" data-platform-feedback="${esc(service.key)}"></small></article>`;
}

function serviceLogPanels(logs, services) {
  return services
    .map((service) => {
      const log = logs?.[service.key] || {},
        journal = log.journal || [],
        errors = log.errors || [],
        output = log.output || [],
        lines = journal.length ? journal : [...errors, ...output],
        content = lines.length
          ? lines.join("\n")
          : "Aucune ligne disponible pour le moment.";
      return `<details class="ops-log" ${service.key === "core" ? "open" : ""}>
        <summary>
          <span>${stateIcon[service.status] || "◇"}</span>
          <div><b>${esc(service.name)}</b><small>${journal.length ? "Journal systemd" : "Fichiers de sortie"} · ${lines.length} ligne(s)</small></div>
          <button type="button" data-copy-service-log="${esc(service.key)}">▣ Copier</button>
        </summary>
        <pre data-service-log="${esc(service.key)}">${esc(content)}</pre>
      </details>`;
    })
    .join("");
}

async function controlService(button) {
  const service = button.dataset.platformService,
    operation = button.dataset.platformOperation;
  const warning =
    service === "web" && operation === "stop"
      ? "Arrêter KingdomWeb coupera immédiatement cette interface. Le redémarrage devra être effectué par SSH. Continuer ?"
      : `${operation === "restart" ? "Redémarrer" : operation === "stop" ? "Arrêter" : "Démarrer"} ${service} ?`;
  if (!confirm(warning)) return;
  const feedback = document.querySelector(
      `[data-platform-feedback="${service}"]`,
    ),
    buttons = [
      ...document.querySelectorAll(`[data-platform-service="${service}"]`),
    ];
  buttons.forEach((item) => (item.disabled = true));
  feedback.className = "ops-service-feedback busy";
  feedback.textContent = "Commande en cours…";
  try {
    const response = await fetch(
      `/api/admin/services/${encodeURIComponent(service)}/${encodeURIComponent(operation)}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    const result = await response
      .json()
      .catch(() => ({ detail: "Réponse interrompue pendant le redémarrage." }));
    if (!response.ok) throw new Error(result.detail || "Commande refusée.");
    feedback.className = "ops-service-feedback success";
    feedback.textContent = result.message || "Commande systemd acceptée.";
    if (service === "web" && operation !== "start") {
      setTimeout(() => location.reload(), 5000);
      return;
    }
    setTimeout(load, 900);
  } catch (error) {
    feedback.className = "ops-service-feedback error";
    feedback.textContent = error.message;
    buttons.forEach((item) => (item.disabled = false));
  }
}

async function synchronizeWithGithub(button) {
  if (
    !confirm(
      "Vérifier GitHub et déployer la dernière version disponible ? Les services KingdomEngine redémarreront uniquement si le code change.",
    )
  )
    return;
  const feedback = document.querySelector("#deployment-feedback");
  button.disabled = true;
  feedback.className = "deployment-feedback busy";
  feedback.textContent = "Synchronisation en cours de lancement…";
  try {
    const response = await fetch("/api/platform/deployment/synchronize", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Synchronisation refusée.");
    feedback.className = "deployment-feedback success";
    feedback.textContent = result.message;
    setTimeout(load, 6000);
  } catch (error) {
    feedback.className = "deployment-feedback error";
    feedback.textContent = error.message;
    button.disabled = false;
  }
}

async function load() {
  const [response, officialResponse] = await Promise.all([
    fetch("/api/platform/overview", { credentials: "same-origin", cache: "no-store" }),
    fetch("/api/platform/official", { credentials: "same-origin", cache: "no-store" }),
  ]);
  if (!response.ok) {
    root.innerHTML =
      '<section class="access-denied"><span>◇</span><h2>Administration protégée</h2><p>Cette interface est exclusivement réservée aux administrateurs Payen Studio.</p><a href="/">Retour à KingdomWeb</a></section>';
    return;
  }
  const data = await response.json(),
    official = officialResponse.ok ? (await officialResponse.json()).content : [],
    m = data.metrics,
    services = data.services || [],
    deployment = data.deployment || {},
    serviceLogs = data.service_logs || {};
  const healthy = services.filter(
      (service) =>
        (service.status || (service.running ? "running" : "stopped")) ===
        "running",
    ).length,
    incidents = services.length - healthy;
  const accounts =
    data.accounts
      .map(
        (account) =>
          `<article class="ops-row"><div class="ops-avatar">${esc((account.display_name || account.username || "?")[0].toUpperCase())}</div><div><b>${esc(account.display_name)}</b><small>@${esc(account.username)}</small></div><span>${account.administered_server_count} monde(s)</span><i>${account.is_admin ? "ADMIN CLIENT" : "CLIENT"}</i>${account.is_admin ? "" : `<button type="button" class="ops-account-delete" data-delete-account="${account.id}" data-account-username="${esc(account.username)}">Supprimer</button>`}</article>`,
      )
      .join("") || '<p class="ops-empty">Aucun compte.</p>';
  const voice =
    `<div class="ops-platform-workers">${(data.platform_workers || [])
      .map(
        (worker) =>
          `<article class="ops-presence"><span>●</span><div><b>${esc(worker.name)}</b><small>${esc(worker.key)} · capacité plateforme</small></div><i>${worker.application_id_configured ? "Configuré" : "Application ID absent"}</i></article>`,
      )
      .join("") || '<p class="ops-empty">Aucun worker plateforme détecté.</p>'}</div>` +
    ((data.voice_worlds || [])
      .map(
        (world) =>
          `<article class="ops-world"><header><div><b>${esc(world.world_name)}</b><small>${esc(world.world_slug)} · ${esc(world.guild_id || "Discord non relié")}</small></div><strong>${world.active} / ${world.capacity}</strong></header><div class="capacity-track"><i style="width:${world.capacity ? Math.min(100, (world.active * 100) / world.capacity) : 0}%"></i></div>${world.error ? `<p class="ops-error">Diagnostic indisponible · ${esc(world.error)}</p>` : (world.presences || []).map((presence) => `<div class="ops-presence"><span>${presence.type === "npc" ? "♙" : presence.type === "ambience" ? "◖" : "◉"}</span><div><b>${esc(presence.name)}</b><small>${esc(presence.location_key || "Affectation dynamique")}</small></div><i>${esc(presence.state)}</i></div>`).join("") || '<p class="ops-empty">Aucune présence configurée.</p>'}</article>`,
      )
      .join("") || '<p class="ops-empty">Aucun monde actif.</p>');
  const support =
    (data.support || [])
      .map(
        (item) =>
          `<article class="ops-row"><div><b>${esc(item.world_slug)}</b><small>Expire ${esc(item.expires_at)}</small></div><span>${esc(JSON.parse(item.scopes_json || "[]").join(", "))}</span><i>${esc(item.status)}</i></article>`,
      )
      .join("") || '<p class="ops-empty">Aucun accès temporaire actif.</p>';
  const audit =
    data.audit
      .map(
        (item) =>
          `<article class="ops-timeline"><i></i><div><b>${esc(item.action)}</b><small>${esc(item.target_type)} · ${esc(item.target_id)}</small></div><time>${relative(item.created_at)}</time></article>`,
      )
      .join("") || '<p class="ops-empty">Aucune opération auditée.</p>';
  root.innerHTML = `<section class="ops-hero"><div><small>CENTRE D’EXPLOITATION</small><h2>${incidents ? "Attention requise" : "Plateforme opérationnelle"}</h2><p>${healthy}/${services.length} services disponibles · dernière vérification à l’instant</p></div><span class="ops-global ${incidents ? "warning" : "healthy"}"><i></i>${incidents ? `${incidents} incident(s)` : "Tous les systèmes sont stables"}</span></section><section class="ops-metrics"><article><span>♙</span><small>UTILISATEURS</small><strong>${m.users}</strong><p>${m.organizations} organisation(s)</p></article><article><span>◇</span><small>MONDES ACTIFS</small><strong>${m.worlds}</strong><p>Environnements clients</p></article><article><span>◖</span><small>CAPACITÉ VOCALE</small><strong>${(data.voice_worlds || []).reduce((sum, w) => sum + w.active, 0)} / ${(data.voice_worlds || []).reduce((sum, w) => sum + w.capacity, 0)}</strong><p>Allocations actives</p></article><article><span>⌁</span><small>SUPPORT ACTIF</small><strong>${m.active_support}</strong><p>Accès consentis</p></article></section>${officialContentPanel(official)}<section class="ops-services"><div class="ops-title"><div><small>SANTÉ PLATEFORME</small><h2>Services de production</h2></div><button type="button" id="refresh-platform">↻ Rafraîchir</button></div><div>${services.map(serviceCard).join("")}</div></section>${panel("Journaux système", serviceLogPanels(serviceLogs, services), "Sorties réelles de KingdomWeb, KingdomCore et KingdomVoice. Le journal Core contient les interactions Discord.", "system-logs")}<div class="ops-grid">${panel("Clients et mondes", accounts, "Comptes autorisés sur la plateforme.", "clients")}${panel("Capacité Voice", voice, "Allocations et présences par monde.", "voice")}${panel("Support Mode", support, "Consentements temporaires et périmètres.", "support")}${panel("Déploiement", `<article class="deployment-card"><span>${deployment.status === "success" ? "✓" : "◇"}</span><div><small>${esc(deployment.environment || "Production")}</small><h3>${esc(deployment.commit || "inconnu")}</h3><p>${esc(deployment.message || "Aucun rapport disponible.")}</p><div class="deployment-actions"><button type="button" id="sync-github">↻ Synchroniser avec GitHub</button><small id="deployment-feedback" class="deployment-feedback"></small></div></div><time>${relative(deployment.deployed_at)}</time></article>`, "Version actuellement déployée.", "deployment")}${panel("Journal d’exploitation", audit, "Actions administratives récentes.", "audit")}</div>`;
  document.querySelector("#refresh-platform").onclick = load;
  document.querySelector("#sync-github").onclick = (event) =>
    synchronizeWithGithub(event.currentTarget);
  document
    .querySelectorAll("[data-platform-service]")
    .forEach((button) => (button.onclick = () => controlService(button)));
  document.querySelectorAll("[data-copy-service-log]").forEach(
    (button) =>
      (button.onclick = async (event) => {
        event.preventDefault();
        const content = document.querySelector(
          `[data-service-log="${button.dataset.copyServiceLog}"]`,
        )?.textContent;
        if (content) await navigator.clipboard.writeText(content);
        button.textContent = "✓ Copié";
        setTimeout(() => (button.textContent = "▣ Copier"), 1200);
      }),
  );
  document.querySelectorAll("[data-delete-account]").forEach(
    (button) =>
      (button.onclick = async () => {
        const username = button.dataset.accountUsername;
        if (
          prompt(
            `Supprimer définitivement @${username} ?\n\nLes bases de ses anciens mondes resteront conservées et réinstallables.\n\nSaisissez « ${username} » pour confirmer.`,
          ) !== username
        )
          return;
        button.disabled = true;
        const deletion = await fetch(
            `/api/accounts/${button.dataset.deleteAccount}`,
            { method: "DELETE", credentials: "same-origin" },
          ),
          result = await deletion.json();
        if (!deletion.ok) {
          alert(result.detail);
          button.disabled = false;
          return;
        }
        await load();
      }),
  );
  bindOfficialContent();
}

// ==============================
// CONTENU OFFICIEL
// ==============================

function officialContentPanel(items) {
  const cards = items.map((item) => `<button class="official-card" type="button" data-official-key="${esc(item.key)}" data-official-version="${item.version}" data-official-type="${esc(item.content_type)}">
    <span>${esc(item.emoji)}</span><div><small>${item.catalog_scope === "community" ? "COMMUNAUTÉ" : "OFFICIEL PAYEN STUDIO"} · ${esc(item.category || item.content_type)}</small><b>${esc(item.name)}</b><p>${esc(item.description)}</p></div>
    <i class="official-status ${esc(item.status)}">${esc(item.status)} · v${item.version}</i><strong>${item.entity_count || 0} entités</strong>
  </button>`).join("");
  return `<section class="official-studio"><header><div><small>CONTENU OFFICIEL</small><h2>Bibliothèque Payen Studio</h2><p>Modèles versionnés proposés aux créateurs de mondes.</p></div><button type="button" id="new-official">+ Nouveau contenu</button></header><div class="official-toolbar"><input id="official-search" type="search" placeholder="Rechercher un modèle, un tag…"><select id="official-filter"><option value="">Tous les contenus</option><option value="world_template">Modèles de monde</option><option value="building_preset">Bâtiments</option><option value="npc_preset">PNJ</option><option value="event_preset">Events</option><option value="calendar_preset">Calendriers</option><option value="audio_pack">Audio</option><option value="item_preset">Objets</option><option value="activity_preset">Activités</option><option value="example">Exemples</option></select></div><div class="official-cards">${cards || '<p class="ops-empty">Aucun contenu officiel.</p>'}</div><div id="official-editor"></div></section>`;
}

async function openOfficialEditor(key = "", version = "", contentType = "world_template") {
  let item = { key: "", name: "", description: "", category: "", emoji: "◇", tags: [], content_type: "world_template", version: 1, status: "draft", entities: [], validation: { errors: [], warnings: [], coverage: { represented: [], count: 0, total: 17 } } };
  if (key) {
    const response = await fetch(`/api/platform/official/${encodeURIComponent(key)}?version=${encodeURIComponent(version)}&content_type=${encodeURIComponent(contentType)}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return alert("Impossible d’ouvrir ce contenu.");
    item = await response.json();
  }
  const validation = item.validation || { errors: [], warnings: [], coverage: { represented: [] } };
  document.querySelector("#official-editor").innerHTML = `<div class="official-editor-backdrop"><section class="official-editor-shell"><header><div><small>ÉDITEUR DE CONTENU OFFICIEL</small><h2>${esc(item.name || "Nouveau contenu")}</h2><p>Composez un pack complet sans toucher aux mondes déjà installés.</p></div>${key && item.content_type === "world_template" ? '<button type="button" class="publish official-full-studio" data-open-full-studio>Ouvrir le Studio complet →</button>' : ""}<button type="button" class="official-close" data-close-official aria-label="Fermer">×</button></header><form id="official-form"><aside class="official-identity"><div class="official-section-title"><span>1</span><div><b>Identité du contenu</b><small>Présentation dans la bibliothèque</small></div></div><label>Type<select name="content_type"><option value="world_template">Modèle de monde</option><option value="building_preset">Bâtiment</option><option value="npc_preset">PNJ</option><option value="event_preset">Event</option><option value="calendar_preset">Calendrier</option><option value="audio_pack">Pack audio</option><option value="item_preset">Objet</option><option value="activity_preset">Activité</option><option value="example">Exemple</option></select></label><label>Clé stable<input name="key" value="${esc(item.key)}" ${key ? "readonly" : ""}></label><label>Nom<input name="name" value="${esc(item.name)}" required></label><label>Description<textarea name="description" rows="4">${esc(item.description)}</textarea></label><div class="official-two"><label>Icône<input name="emoji" value="${esc(item.emoji)}"></label><label>Catégorie<input name="category" value="${esc(item.category)}"></label></div><label>Illustration ou ressource<input name="illustration_path" value="${esc(item.illustration_path || "")}" placeholder="Chemin de l’illustration"></label><label>Tags<input name="tags" value="${esc((item.tags || []).join(", "))}" placeholder="médiéval, débutant, économie"></label><div class="official-version-card"><small>RÉVISION ACTIVE</small><strong>v${item.version}</strong><span class="official-status ${esc(item.status)}">${esc(item.status)}</span></div></aside><main class="official-structure"><div class="official-validation"></div><div class="official-entities"><header><div><div class="official-section-title"><span>2</span><div><b>Structure du pack</b><small>${item.entities.length} entité(s) configurée(s)</small></div></div><div class="official-entity-filters" role="tablist"><button type="button" class="active" data-entity-filter="">Tout</button>${["building","location","profession","item","event","npc","environment","audio","voice_presence"].map(type => `<button type="button" data-entity-filter="${type}">${type}</button>`).join("")}</div></div><div class="official-structure-actions"><button type="button" data-validate-official>✓ Valider maintenant</button><button type="button" class="publish" data-add-official-entity>+ Ajouter une entité</button></div></header><div data-official-entities>${item.entities.map((entity, index) => officialEntityEditor(entity, index)).join("") || '<p class="ops-empty">Ajoutez les briques de contenu de ce modèle.</p>'}</div></div></main><footer><span>${esc(item.status)} · version ${item.version}</span><div><button type="button" data-close-official>Fermer</button>${key ? '<button type="button" data-duplicate-official>Dupliquer</button>' : ""}${key && item.status === "published" ? '<button type="button" data-archive-official>Archiver</button>' : ""}${key && item.status === "draft" ? '<button type="button" class="danger" data-delete-official>Supprimer</button>' : ""}<button type="submit">Enregistrer le brouillon</button>${key && item.status !== "published" ? '<button type="button" class="publish" data-publish-official>Publier</button>' : ""}</div></footer></form></section></div>`;
  document.querySelector('[name="content_type"]').value = item.content_type;
  renderOfficialValidation(validation);
  bindOfficialEditor(item);
}

function officialEntityEditor(entity, index) {
  const types = ["server_settings", "location", "building", "profession", "item", "event", "npc", "environment", "audio", "audio_group", "audio_story", "voice_profile", "voice_presence", "bot"];
  return `<details class="official-entity" data-entity-index="${index}" data-entity-kind="${esc(entity.type)}"><summary><span>${esc(entity.payload?.emoji || "◇")}</span><div><b>${esc(entity.payload?.name || entity.key)}</b><small>${esc(entity.type)} · ${esc(entity.key)}</small></div><div class="official-entity-actions"><button type="button" title="Monter" data-move-official-entity="up">↑</button><button type="button" title="Descendre" data-move-official-entity="down">↓</button><button type="button" class="danger" data-remove-official-entity>Supprimer</button></div></summary><div><label>Type<select data-entity-type>${types.map(type => `<option value="${type}" ${type === entity.type ? "selected" : ""}>${type}</option>`).join("")}</select></label><label>Clé technique<input data-entity-key value="${esc(entity.key)}"></label><label>Configuration de cette entité<textarea data-entity-payload rows="18" spellcheck="false">${esc(JSON.stringify(entity.payload || {}, null, 2))}</textarea></label></div></details>`;
}

function collectOfficialForm(form) {
  const entities = [...form.querySelectorAll(".official-entity")].map(node => ({ type: node.querySelector("[data-entity-type]").value.trim(), key: node.querySelector("[data-entity-key]").value.trim(), payload: JSON.parse(node.querySelector("[data-entity-payload]").value) }));
  const value = (name) => form.elements.namedItem(name)?.value ?? "";
  return {
    key: value("key").trim(),
    content_type: value("content_type"),
    name: value("name").trim(),
    description: value("description").trim(),
    category: value("category").trim(),
    emoji: value("emoji").trim() || "◇",
    illustration_path: value("illustration_path").trim(),
    tags: value("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
    entities,
  };
}

function bindOfficialEditor(item) {
  document.querySelectorAll("[data-close-official]").forEach(button => button.onclick = () => document.querySelector("#official-editor").replaceChildren());
  document.querySelector("[data-add-official-entity]").onclick = () => { const target = document.querySelector("[data-official-entities]"); if (target.querySelector(".ops-empty")) target.replaceChildren(); const number = target.querySelectorAll(".official-entity").length + 1; target.insertAdjacentHTML("beforeend", officialEntityEditor({ type: "item", key: `new_item_${number}`, payload: { name: `Nouvelle entité ${number}`, emoji: "◇", description: "", category: "other" } }, number - 1)); bindOfficialEditor(item); target.lastElementChild.open = true; target.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" }); };
  document.querySelectorAll("[data-remove-official-entity]").forEach(button => button.onclick = event => { event.preventDefault(); button.closest(".official-entity").remove(); });
  document.querySelectorAll("[data-move-official-entity]").forEach(button => button.onclick = event => { event.preventDefault(); event.stopPropagation(); const entity = button.closest(".official-entity"), direction = button.dataset.moveOfficialEntity; if (direction === "up" && entity.previousElementSibling) entity.parentElement.insertBefore(entity, entity.previousElementSibling); if (direction === "down" && entity.nextElementSibling) entity.parentElement.insertBefore(entity.nextElementSibling, entity); });
  document.querySelectorAll("[data-entity-filter]").forEach(button => button.onclick = () => { document.querySelectorAll("[data-entity-filter]").forEach(tab => tab.classList.toggle("active", tab === button)); document.querySelectorAll(".official-entity").forEach(entity => entity.hidden = Boolean(button.dataset.entityFilter && entity.dataset.entityKind !== button.dataset.entityFilter)); });
  const form = document.querySelector("#official-form");
  form.onsubmit = async event => { event.preventDefault(); const submit = event.submitter; if (submit) submit.disabled = true; try { const body = collectOfficialForm(form), response = await fetch(item.key ? `/api/platform/official/${encodeURIComponent(item.key)}` : "/api/platform/official", { method: item.key ? "PUT" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.detail); await load(); await openOfficialEditor(result.key, result.version, result.content_type); } catch (error) { alert(error.message); if (submit) submit.disabled = false; } };
  const validateButton = document.querySelector("[data-validate-official]");
  if (validateButton) validateButton.onclick = async () => { validateButton.disabled = true; try { const response = await fetch("/api/platform/official-validation", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(collectOfficialForm(form)) }); const result = await response.json(); if (!response.ok) throw new Error(result.detail); renderOfficialValidation(result); } catch (error) { alert(error.message); } finally { validateButton.disabled = false; } };
  const publishButton = document.querySelector("[data-publish-official]");
  if (publishButton) publishButton.onclick = async () => { publishButton.disabled = true; const response = await fetch(`/api/platform/official/${encodeURIComponent(item.key)}/publish`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: item.version, content_type: item.content_type }) }); const result = await response.json(); if (!response.ok) { publishButton.disabled = false; return alert(result.detail); } await load(); };
  const deleteButton = document.querySelector("[data-delete-official]");
  if (deleteButton) deleteButton.onclick = async () => { if (!confirm("Supprimer définitivement ce brouillon ?")) return; deleteButton.disabled = true; const response = await fetch(`/api/platform/official/${encodeURIComponent(item.key)}/versions/${item.version}?content_type=${encodeURIComponent(item.content_type)}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { deleteButton.disabled = false; return alert((await response.json()).detail); } await load(); };
  const archiveButton = document.querySelector("[data-archive-official]");
  if (archiveButton) archiveButton.onclick = async () => { archiveButton.disabled = true; const response = await fetch(`/api/platform/official/${encodeURIComponent(item.key)}/archive`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: item.version, content_type: item.content_type }) }); if (!response.ok) { archiveButton.disabled = false; return alert((await response.json()).detail); } await load(); };
  const duplicateButton = document.querySelector("[data-duplicate-official]");
  if (duplicateButton) duplicateButton.onclick = async () => { const copyKey = prompt("Clé de la copie", `${item.key}_copy`); if (!copyKey) return; duplicateButton.disabled = true; const response = await fetch(`/api/platform/official/${encodeURIComponent(item.key)}/duplicate`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: copyKey, name: `Copie de ${item.name}`, content_type: item.content_type }) }); const result = await response.json(); if (!response.ok) { duplicateButton.disabled = false; return alert(result.detail); } await load(); await openOfficialEditor(result.key, result.version, result.content_type); };
  const fullStudioButton = document.querySelector("[data-open-full-studio]");
  if (fullStudioButton) fullStudioButton.onclick = async () => { fullStudioButton.disabled = true; fullStudioButton.textContent = "Préparation du monde…"; const response = await fetch(`/api/platform/official/${encodeURIComponent(item.key)}/workspace`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: item.version, content_type: item.content_type }) }); const result = await response.json(); if (!response.ok) { fullStudioButton.disabled = false; fullStudioButton.textContent = "Ouvrir le Studio complet →"; return alert(result.detail); } window.location.assign(result.url); };
}

function renderOfficialValidation(validation) {
  const target = document.querySelector(".official-validation");
  if (!target) return;
  target.classList.toggle("invalid", validation.errors.length > 0);
  target.innerHTML = `<div><b>${validation.errors.length ? "Publication bloquée" : "Structure exploitable"}</b><span>${validation.coverage?.count || 0}/${validation.coverage?.total || 17} fonctionnalités représentées</span></div><div class="official-coverage">${(validation.coverage?.supported || []).map(feature => `<i class="${validation.coverage.represented.includes(feature) ? "covered" : ""}">${esc(feature)}</i>`).join("")}</div>${validation.errors.map(error => `<p class="error">${esc(error)}</p>`).join("")}${validation.warnings.map(warning => `<p class="warning">${esc(warning)}</p>`).join("")}`;
}

function bindOfficialContent() {
  document.querySelector("#new-official").onclick = () => openOfficialEditor();
  document.querySelectorAll("[data-official-key]").forEach(card => card.onclick = () => openOfficialEditor(card.dataset.officialKey, card.dataset.officialVersion, card.dataset.officialType));
  const apply = () => { const term = document.querySelector("#official-search").value.toLowerCase(), type = document.querySelector("#official-filter").value; document.querySelectorAll(".official-card").forEach(card => { const matches = card.textContent.toLowerCase().includes(term) && (!type || card.dataset.officialType === type); card.hidden = !matches; }); };
  document.querySelector("#official-search").oninput = apply;
  document.querySelector("#official-filter").onchange = apply;
}
load();
