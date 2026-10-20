/* Progressive creator assistance: DOM-only, no API or save changes. */
(() => {
  'use strict';
  const TYPES = {
    building: ['Bâtiment', 'Définissez le lieu, puis configurez ses interactions avant de publier.'],
    item: ['Objet', 'Définissez l’objet, vérifiez ses propriétés puis enregistrez.'],
    npc: ['Personnage', 'Créez son identité puis associez ses interactions aux lieux.'],
    event: ['Événement', 'Définissez les conditions et vérifiez le résultat avant activation.'],
  };
  const root = document.getElementById('admin-view');
  if (!root) return;
  let pending = false;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function activeType() {
    const active = document.querySelector('#nav [data-type].active');
    return active && TYPES[active.dataset.type] ? active.dataset.type : null;
  }
  function headings() {
    return [...root.querySelectorAll('h2,h3,legend')].filter(el => !el.closest('.kw-creator-assist') && el.getClientRects().length && el.textContent.trim()).slice(0, 14);
  }
  function refresh() {
    const type = activeType();
    const previous = root.querySelector('.kw-creator-assist');
    if (!type || root.hidden || !root.querySelector('input,select,textarea,button')) { previous?.remove(); return; }
    const [name, description] = TYPES[type];
    const sections = headings();
    const signature = type + '|' + sections.map(h => h.textContent.trim()).join('|');
    if (previous?.dataset.signature === signature) return;
    previous?.remove();
    const panel = document.createElement('section');
    panel.className = 'kw-creator-assist';
    panel.dataset.signature = signature;
    panel.setAttribute('aria-label', 'Assistant de création');
    panel.innerHTML = `<div class="kw-creator-assist-head"><div><small>ATELIER · AIDE À LA NAVIGATION</small><h2>Créer un ${escape(name.toLowerCase())}</h2><p>${escape(description)}</p></div><button type="button" class="kw-assist-toggle" aria-expanded="true">Masquer l’aide</button></div><div class="kw-assist-body"><label for="kw-assist-find">Rechercher un réglage dans cet écran</label><input id="kw-assist-find" type="search" placeholder="Nom, description, propriété…" autocomplete="off"><p class="kw-assist-result" role="status" aria-live="polite">Saisissez un mot pour trouver un champ.</p><div class="kw-assist-sections" aria-label="Accès rapide aux sections">${sections.map((h,i) => `<button type="button" data-kw-section="${i}">${escape(h.textContent.trim().slice(0,65))} ↗</button>`).join('') || '<span>Les sections apparaîtront dès que le formulaire sera ouvert.</span>'}</div><p class="kw-assist-disclaimer">Aide à la navigation uniquement : aucun champ n’est enregistré automatiquement. Utilisez les commandes d’enregistrement de l’éditeur.</p></div>`;
    root.prepend(panel);
    const body = panel.querySelector('.kw-assist-body');
    panel.querySelector('.kw-assist-toggle').addEventListener('click', e => {
      body.hidden = !body.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!body.hidden));
      e.currentTarget.textContent = body.hidden ? 'Afficher l’aide' : 'Masquer l’aide';
    });
    panel.querySelectorAll('[data-kw-section]').forEach(button => button.addEventListener('click', () => {
      const target = sections[Number(button.dataset.kwSection)];
      if (!target?.isConnected) return;
      target.scrollIntoView({behavior:'smooth',block:'center'});
      target.classList.add('kw-assist-highlight');
      target.addEventListener('animationend', () => target.classList.remove('kw-assist-highlight'), {once:true});
    }));
    panel.querySelector('input').addEventListener('input', e => {
      const term = e.target.value.trim().toLocaleLowerCase('fr');
      const result = panel.querySelector('.kw-assist-result');
      if (term.length < 2) {result.textContent = 'Saisissez au moins deux caractères.';return;}
      const fields = [...root.querySelectorAll('input,select,textarea')].filter(f => !f.closest('.kw-creator-assist') && f.getClientRects().length);
      const match = fields.find(f => {
        const label = f.labels ? [...f.labels].map(l=>l.textContent).join(' ') : '';
        return [label,f.getAttribute('placeholder'),f.getAttribute('aria-label'),f.name,f.id].filter(Boolean).join(' ').toLocaleLowerCase('fr').includes(term);
      });
      if (!match) {result.textContent = 'Aucun champ correspondant sur cet écran.';return;}
      result.textContent = 'Champ trouvé : utilisez Entrée pour y accéder.';
      e.target.onkeydown = key => {if (key.key === 'Enter') {key.preventDefault();match.scrollIntoView({behavior:'smooth',block:'center'});match.focus({preventScroll:true});}};
    });
  }
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {pending = false;refresh();});
  });
  observer.observe(root,{childList:true,subtree:true});
  const nav = document.getElementById('nav');
  if (nav) observer.observe(nav,{attributes:true,subtree:true,attributeFilter:['class']});
  refresh();
})();
