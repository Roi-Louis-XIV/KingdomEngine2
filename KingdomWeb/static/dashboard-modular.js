/* KingdomWeb dashboard layout enhancement. UI only; existing metrics and actions remain intact. */
(function () {
  'use strict';
  const KEY = 'kingdomweb-dashboard-layout-v1';
  const definitions = [
    ['next', '.dashboard-welcome', 'Prochaine étape'],
    ['start', '.dashboard-start', 'Démarrage rapide'],
    ['players', '.dashboard-metrics > :nth-child(1)', 'Joueurs'],
    ['buildings', '.dashboard-metrics > :nth-child(2)', 'Bâtiments'],
    ['events', '.dashboard-metrics > :nth-child(3)', 'Événements'],
    ['jobs', '.dashboard-metrics > :nth-child(4)', 'Activités'],
    ['activity', '.dashboard-columns-simple > :nth-child(1)', 'Activité récente'],
    ['alerts', '.dashboard-columns-simple > :nth-child(2)', 'État du monde'],
    ['analytics', '[data-analytics="snapshot"]', 'Indicateurs graphiques'],
    ['player-table', '[data-analytics="players"]', 'Tableau des joueurs'],
    ['creator', '.kw-creator-launchpad', 'Accès aux outils de création'],
    ['projects', '.dashboard-secondary:nth-of-type(1)', 'Projets'],
    ['rankings', '.dashboard-secondary:last-child', 'Classements']
  ];
  const defaultIds = ['next', 'start', 'players', 'buildings', 'events', 'jobs', 'activity', 'alerts', 'analytics', 'player-table', 'creator', 'projects', 'rankings'];
  let saved;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (_) { /* unavailable */ }
  let order = Array.isArray(saved?.order) ? [...new Set(saved.order.filter(id => defaultIds.includes(id)))] : defaultIds.slice();
  order.push(...defaultIds.filter(id => !order.includes(id)));
  let hidden = Array.isArray(saved?.hidden) ? saved.hidden.filter(id => defaultIds.includes(id)) : [];
  let edit = false;
  let drag = null;
  let board = null;
  let catalog = null;
  let status = null;
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ order, hidden })); status.textContent = 'Disposition enregistrée dans ce navigateur.'; }
    catch (_) { status.textContent = 'Sauvegarde locale indisponible.'; }
  }
  function makeButton(text, label, callback, cls) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.setAttribute('aria-label', label); if (cls) button.className = cls;
    button.addEventListener('click', callback); return button;
  }
  function reorder(id, targetId) {
    if (!id || !targetId || id === targetId) return;
    order = order.filter(x => x !== id);
    order.splice(order.indexOf(targetId), 0, id);
    persist(); draw();
  }
  function draw() {
    if (!board) return;
    const cards = new Map([...board.children].filter(x => x.dataset.widget).map(x => [x.dataset.widget, x]));
    order.forEach(id => { const card = cards.get(id); if (card) { card.hidden = hidden.includes(id); board.append(card); } });
    board.classList.toggle('is-editing', edit);
    catalog.replaceChildren();
    definitions.forEach(([id, , label]) => {
      if (!cards.has(id)) return;
      const btn = makeButton(`${hidden.includes(id) ? '＋' : '✓'} ${label}`, `${hidden.includes(id) ? 'Afficher' : 'Masquer'} ${label}`, () => {
        hidden = hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id]; persist(); draw();
      });
      btn.setAttribute('aria-pressed', String(!hidden.includes(id))); catalog.append(btn);
    });
  }
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const { id, target, ghost, card } = drag;
    ghost?.remove(); card.classList.remove('is-drag-source');
    board.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    board.classList.remove('is-drop-at-end');
    document.body.classList.remove('kw-dragging'); drag = null;
    if (target === '__end__') { order = order.filter(x => x !== id); order.push(id); persist(); draw(); }
    else if (target) reorder(id, target);
  }
  function startDrag(e, card, id) {
    if (!edit || e.button !== 0 || drag) return;
    e.preventDefault(); const rect = card.getBoundingClientRect();
    drag = { id, card, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, rect, target: null, ghost: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveDrag(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const d = drag, dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.ghost) {
      if (Math.hypot(dx, dy) < 5) return;
      d.ghost = d.card.cloneNode(true); d.ghost.classList.add('kw-drag-ghost');
      Object.assign(d.ghost.style, { left: `${d.rect.left}px`, top: `${d.rect.top}px`, width: `${d.rect.width}px`, height: `${d.rect.height}px` });
      document.body.append(d.ghost); d.card.classList.add('is-drag-source'); document.body.classList.add('kw-dragging');
    }
    d.ghost.style.transform = `translate3d(${dx}px,${dy}px,0) rotate(-1deg)`;
    board.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    board.classList.remove('is-drop-at-end');
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const candidate = hit?.closest('[data-widget]');
    d.target = candidate && candidate !== d.card && board.contains(candidate) ? candidate.dataset.widget : null;
    if (d.target) candidate.classList.add('is-drop-target');
    else if (board.contains(hit)) {
      const visible = [...board.querySelectorAll('[data-widget]:not([hidden])')].filter(el => el !== d.card);
      const last = visible[visible.length - 1];
      if (last && e.clientY > last.getBoundingClientRect().bottom + 12) { d.target = '__end__'; board.classList.add('is-drop-at-end'); return; }
      const candidates = [...board.querySelectorAll('[data-widget]:not([hidden])')].filter(el => el !== d.card);
      const nearest = candidates.reduce((best, el) => {
        const r = el.getBoundingClientRect(); const distance = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        return !best || distance < best.distance ? { el, distance } : best;
      }, null);
      if (nearest) { d.target = nearest.el.dataset.widget; nearest.el.classList.add('is-drop-target'); }
    }
  }
  function setupCard(card, id, label) {
    card.dataset.widget = id; card.classList.add('kw-widget');
    const controls = document.createElement('div'); controls.className = 'kw-widget-controls';
    const handle = makeButton('', `Déplacer ${label}`, () => {}, 'kw-drag-handle');
    handle.innerHTML = '<i></i><i></i><i></i><i></i>';
    handle.addEventListener('pointerdown', e => startDrag(e, card, id));
    handle.addEventListener('pointermove', moveDrag); handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('lostpointercapture', () => endDrag());
    controls.append(handle,
      makeButton('←', `Déplacer ${label} vers le début`, () => { const i = order.indexOf(id); if (i > 0) reorder(id, order[i - 1]); }, 'kw-keyboard-move'),
      makeButton('→', `Déplacer ${label} vers la fin`, () => { const i = order.indexOf(id); if (i < order.length - 1) reorder(order[i + 1], id); }, 'kw-keyboard-move'),
      makeButton('×', `Masquer ${label}`, () => { hidden.push(id); persist(); draw(); }, 'kw-widget-hide'));
    card.prepend(controls);
  }
  function install(root) {
    if (!root || root.dataset.modularReady) return;
    root.dataset.modularReady = 'true';
    const toolbar = document.createElement('div'); toolbar.className = 'kw-dashboard-toolbar';
    const editButton = makeButton('Personnaliser', 'Personnaliser le tableau de bord', () => {
      edit = !edit; editButton.textContent = edit ? 'Terminer' : 'Personnaliser';
      catalog.hidden = !edit; resetButton.hidden = !edit; draw();
    });
    const resetButton = makeButton('Réinitialiser', 'Restaurer la disposition par défaut', () => {
      order = defaultIds.slice(); hidden = []; persist(); draw();
    }); resetButton.hidden = true;
    status = document.createElement('span'); status.className = 'kw-dashboard-status'; status.setAttribute('role', 'status');
    toolbar.append(editButton, resetButton, status);
    catalog = document.createElement('div'); catalog.className = 'kw-widget-catalog'; catalog.hidden = true;
    board = document.createElement('div'); board.className = 'kw-widget-board';
    const cards = definitions.map(([id, selector, label]) => [id, root.querySelector(selector), label]).filter(([, el]) => el);
    // Remove nested grid wrappers only after extracting their existing cards.
    cards.forEach(([id, el, label]) => { setupCard(el, id, label); board.append(el); });
    root.querySelector('.dashboard-metrics')?.remove(); root.querySelector('.dashboard-columns-simple')?.remove();
    root.prepend(toolbar, catalog, board); draw();
  }
  window.KingdomDashboardModular = { install };
})();
