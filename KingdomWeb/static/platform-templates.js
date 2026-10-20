const templateItems = [];
const templateFeedback = document.querySelector("#templates-feedback");
const templateSearch = document.querySelector("#templates-search");
const templateStatus = document.querySelector("#templates-status");
const templateSections = {
  official: document.querySelector("#templates-official"),
  community: document.querySelector("#templates-community"),
};

const escapeTemplate = (value) => String(value ?? "").replace(
  /[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
);

const templateStatusLabel = {
  published: "Publié",
  draft: "Brouillon",
  archived: "Archivé",
};

function templateMessage(message, kind = "") {
  templateFeedback.textContent = message;
  templateFeedback.dataset.kind = kind;
}

function templateDate(value) {
  if (!value) return "Date inconnue";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

function groupTemplates(scope) {
  const groups = new Map();
  for (const item of templateItems.filter((entry) => (entry.catalog_scope || "official") === scope)) {
    const groupKey = `${item.content_type}:${item.key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { key: item.key, name: item.name, versions: [] });
    const group = groups.get(groupKey);
    group.versions.push(item);
    if (item.version > (group.latestVersion || 0)) {
      group.latestVersion = item.version;
      group.name = item.name;
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, versions: group.versions.sort((a, b) => b.version - a.version) }))
    .sort((a, b) => {
      const shownName = (group) => (group.versions.find((item) => item.status === "published") || group.versions[0]).name;
      return shownName(a).localeCompare(shownName(b), "fr");
    });
}

function templateVersion(item, scope) {
  const status = templateStatusLabel[item.status] || item.status;
  const visible = item.status === "published";
  const editLink = `/platform-admin?official_key=${encodeURIComponent(item.key)}&official_version=${encodeURIComponent(item.version)}&official_type=world_template`;
  const actions = [
    item.status !== "published"
      ? `<button type="button" class="templates-primary" data-template-action="publish" data-template-key="${escapeTemplate(item.key)}" data-template-version="${item.version}">Publier</button>`
      : `<button type="button" data-template-action="unpublish" data-template-key="${escapeTemplate(item.key)}" data-template-version="${item.version}">Dépublier</button>`,
    item.status !== "archived"
      ? `<button type="button" data-template-action="archive" data-template-key="${escapeTemplate(item.key)}" data-template-version="${item.version}">Archiver</button>`
      : `<button type="button" data-template-action="unpublish" data-template-key="${escapeTemplate(item.key)}" data-template-version="${item.version}">Remettre en brouillon</button>`,
  ];
  if (scope === "official") actions.unshift(`<a href="${escapeTemplate(editLink)}">Ouvrir l’éditeur</a>`);
  return `<article class="templates-version">
    <div class="templates-version-info">
      <strong>Version ${Number(item.version)}</strong>
      <span class="templates-version-name">${escapeTemplate(item.name)}</span>
      <span class="templates-status ${escapeTemplate(item.status)}">${escapeTemplate(status)}</span>
      <span class="templates-visibility ${visible ? "visible" : "hidden"}">${visible ? "Visible par les joueurs" : "Masqué aux joueurs"}</span>
      <small>${Number(item.entity_count || 0)} entité(s) · ${escapeTemplate(templateDate(item.updated_at))}</small>
    </div>
    <div class="templates-version-actions">${actions.join("")}</div>
  </article>`;
}

function templateCard(group, scope, versions) {
  const latest = group.versions[0];
  const active = group.versions.find((item) => item.status === "published");
  const displayed = active || latest;
  const creator = scope === "community"
    ? `<span>Créé par ${escapeTemplate(latest.author || "un joueur")}</span>${latest.source_world_slug ? `<span>Monde source : ${escapeTemplate(latest.source_world_slug)}</span>` : ""}`
    : `<span>${escapeTemplate(displayed.category || "Payen Studio")}</span>`;
  return `<article class="templates-card">
    <header>
      <span class="templates-icon" aria-hidden="true">${escapeTemplate(displayed.emoji || "◇")}</span>
      <div>
        <div class="templates-card-heading"><h3>${escapeTemplate(displayed.name)}</h3><span class="templates-card-availability ${active ? "available" : "unavailable"}">${active ? `Disponible · v${Number(active.version)}` : "Indisponible"}</span></div>
        <p>${escapeTemplate(displayed.description || "Aucune description.")}</p>
        <div class="templates-card-meta"><code>${escapeTemplate(group.key)}</code>${creator}<span>${group.versions.length} version(s)</span></div>
      </div>
    </header>
    <div class="templates-versions">${versions.map((item) => templateVersion(item, scope)).join("")}</div>
  </article>`;
}

function renderTemplateSection(scope, title, description) {
  const query = templateSearch.value.trim().toLocaleLowerCase("fr");
  const status = templateStatus.value;
  const groups = groupTemplates(scope);
  const visibleGroups = groups.map((group) => {
    const haystack = group.versions.map((item) => [item.name, item.description, item.key, item.category, item.author, ...(item.tags || [])].join(" ")).join(" ").toLocaleLowerCase("fr");
    if (query && !haystack.includes(query)) return null;
    const versions = group.versions.filter((item) => !status || item.status === status);
    return versions.length ? { group, versions } : null;
  }).filter(Boolean);
  templateSections[scope].innerHTML = `<div class="templates-section-heading"><div><small>${scope === "official" ? "PAYEN STUDIO" : "CRÉATIONS DES JOUEURS"}</small><h2 id="templates-${scope}-title">${title} <span>${visibleGroups.length}</span></h2><p>${description}</p></div></div>
    <div class="templates-list">${visibleGroups.map(({ group, versions }) => templateCard(group, scope, versions)).join("") || `<p class="templates-empty">${query || status ? "Aucun résultat pour ces filtres." : "Aucun template dans cette catégorie."}</p>`}</div>
    ${scope === "official" ? '<p class="templates-system-note">Le « Monde vierge » est une option système toujours proposée à la création et ne se publie pas depuis cette page.</p>' : ""}`;
}

function renderTemplates() {
  const official = groupTemplates("official");
  const community = groupTemplates("community");
  const available = [...official, ...community].filter((group) => group.versions.some((item) => item.status === "published")).length;
  document.querySelector("#templates-summary").innerHTML = `
    <article><small>OFFICIELS</small><strong>${official.length}</strong><span>templates Payen Studio</span></article>
    <article><small>COMMUNAUTÉ</small><strong>${community.length}</strong><span>templates des joueurs</span></article>
    <article><small>PUBLIÉS</small><strong>${available}</strong><span>dans les catalogues joueurs</span></article>`;
  renderTemplateSection("official", "Templates officiels", "Modèles conçus et versionnés par Payen Studio.");
  renderTemplateSection("community", "Templates des joueurs", "Modèles publiés depuis les mondes de la communauté.");
}

async function loadTemplates() {
  const refresh = document.querySelector("#templates-refresh");
  refresh.disabled = true;
  try {
    const response = await fetch("/api/platform/official?content_type=world_template", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Chargement impossible.");
    templateItems.splice(0, templateItems.length, ...(data.content || []));
    renderTemplates();
    templateMessage("");
    return true;
  } catch (error) {
    templateMessage(error.message || "Chargement impossible.", "error");
    return false;
  } finally {
    refresh.disabled = false;
  }
}

async function changeTemplateStatus(button) {
  const key = button.dataset.templateKey;
  const version = Number(button.dataset.templateVersion);
  const action = button.dataset.templateAction;
  const item = templateItems.find((entry) => entry.key === key && entry.version === version && entry.content_type === "world_template");
  if (!item || !["publish", "unpublish", "archive"].includes(action)) return;
  const active = templateItems.find((entry) => entry.key === key && entry.status === "published" && entry.content_type === "world_template");
  const question = action === "publish" && active && active.version !== version
    ? `Publier la version ${version} de « ${item.name} » ? La version ${active.version} quittera le catalogue des joueurs.`
    : action === "unpublish" && item.status === "published"
      ? `Dépublier « ${item.name} » v${version} ? Il disparaîtra du catalogue pour les nouvelles créations de monde.`
      : action === "archive" && item.status === "published"
        ? `Archiver « ${item.name} » v${version} ? Il disparaîtra du catalogue pour les nouvelles créations de monde.`
        : "";
  if (question && !window.confirm(question)) return;
  button.disabled = true;
  templateMessage("Mise à jour en cours…");
  try {
    const response = await fetch(`/api/platform/official/${encodeURIComponent(key)}/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, content_type: "world_template" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Mise à jour refusée.");
    if (await loadTemplates()) {
      templateMessage(`« ${item.name} » v${version} : ${templateStatusLabel[data.status] || data.status}.`, "success");
    }
  } catch (error) {
    templateMessage(error.message || "Mise à jour impossible.", "error");
    button.disabled = false;
  }
}

templateSearch.addEventListener("input", renderTemplates);
templateStatus.addEventListener("change", renderTemplates);
document.querySelector("#templates-refresh").addEventListener("click", loadTemplates);
document.querySelector(".templates-page").addEventListener("click", (event) => {
  const button = event.target.closest("[data-template-action]");
  if (button) changeTemplateStatus(button);
});
loadTemplates();
