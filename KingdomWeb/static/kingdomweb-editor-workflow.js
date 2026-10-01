/* Editor workflow enhancement: presentation only; existing save/publish handlers remain authoritative. */
(() => {
 'use strict';
 const modal=document.getElementById('editor'), form=document.getElementById('editor-form');
 if(!modal||!form)return;
 let pending=false;
 const labelOf=f=>{const l=f.labels?.[0];return (l?.textContent||f.getAttribute('aria-label')||f.name||f.id||'Champ').trim().replace(/\s+/g,' ').slice(0,90)};
 function visible(el){return !el.hidden&&!!el.getClientRects().length}
 function fields(){return [...form.querySelectorAll('input,select,textarea')].filter(f=>visible(f)&&!f.closest('.kw-editor-workflow')&&f.type!=='hidden'&&f.type!=='search')}
 function sections(){return [...form.querySelectorAll('.form-section,#type-fields > section,details.advanced')].filter(visible)}
 function update(){
  if(modal.hidden)return;
  let panel=form.querySelector('.kw-editor-workflow');
  if(!panel){panel=document.createElement('aside');panel.className='kw-editor-workflow';panel.setAttribute('aria-label','Navigation dans l’éditeur');const head=form.querySelector('.dialog-head');head?.insertAdjacentElement('afterend',panel)}
  const ss=sections(), fs=fields(), required=fs.filter(f=>f.required), missing=required.filter(f=>!f.value.trim()), invalid=fs.filter(f=>f.value&&!f.checkValidity());
  const name=form.querySelector('#name')?.value.trim()||'Sans nom';
  const emoji=form.querySelector('#emoji')?.value.trim()||'◇';
  const description=form.querySelector('#description')?.value.trim()||'Renseignez une description pour identifier ce contenu.';
  let status=panel.querySelector('.kw-workflow-status');
  if(!status){panel.innerHTML='<div class="kw-workflow-top"><div><small>VOTRE PARCOURS</small><strong>Créez, vérifiez, puis enregistrez</strong></div><span class="kw-workflow-status" role="status"></span></div><nav class="kw-workflow-steps" aria-label="Sections du formulaire"></nav><div class="kw-workflow-bottom"><div class="kw-workflow-preview"><small>APERÇU DES INFORMATIONS</small><strong class="kw-preview-name"></strong><p class="kw-preview-description"></p></div><div class="kw-workflow-errors" role="status" aria-live="polite"></div></div>';status=panel.querySelector('.kw-workflow-status')}
  status.textContent=missing.length||invalid.length?`${missing.length+invalid.length} point(s) à vérifier`:'Champs obligatoires renseignés';
  status.dataset.ready=String(!missing.length&&!invalid.length);
  const nav=panel.querySelector('nav'),signature=ss.map((s,i)=>`${i}:${s.querySelector('h3,legend,.section-copy')?.textContent.trim().slice(0,45)||'Réglages'}`).join('|');
  if(nav.dataset.signature!==signature){nav.dataset.signature=signature;nav.replaceChildren();ss.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.className='kw-workflow-step';b.textContent=`${i+1}. ${s.querySelector('h3,legend,.section-copy')?.textContent.trim().replace(/\s+/g,' ').slice(0,48)||'Réglages'}`;b.addEventListener('click',()=>{if(s.tagName==='DETAILS')s.open=true;s.scrollIntoView({behavior:'smooth',block:'start'});s.querySelector('input,select,textarea,button')?.focus({preventScroll:true})});nav.append(b)})}
  panel.querySelector('.kw-preview-name').textContent=`${emoji} ${name}`;
  panel.querySelector('.kw-preview-description').textContent=description;
  const errors=panel.querySelector('.kw-workflow-errors');errors.replaceChildren();
  if(missing.length||invalid.length){const title=document.createElement('strong');title.textContent='À compléter avant de valider :';errors.append(title);[...new Set([...missing,...invalid])].slice(0,4).forEach(f=>{const b=document.createElement('button');b.type='button';b.textContent=`→ ${labelOf(f)}`;b.addEventListener('click',()=>{f.closest('details')?.setAttribute('open','');f.scrollIntoView({behavior:'smooth',block:'center'});f.focus({preventScroll:true})});errors.append(b)})}else errors.textContent='Vous pouvez vérifier le contenu et utiliser les boutons d’enregistrement existants.';
 }
 function schedule(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;update()})}
 form.addEventListener('input',schedule);form.addEventListener('change',schedule);
 const observer=new MutationObserver(schedule);observer.observe(modal,{attributes:true,attributeFilter:['hidden']});observer.observe(form,{childList:true,subtree:true});
 ['save','save-publish'].forEach(id=>document.getElementById(id)?.addEventListener('click',e=>{
  const invalid=fields().find(f=>f.required&&!f.value.trim()||f.value&&!f.checkValidity());
  if(!invalid)return;
  e.preventDefault();e.stopImmediatePropagation();invalid.closest('details')?.setAttribute('open','');invalid.focus();invalid.scrollIntoView({behavior:'smooth',block:'center'});update();
 },true));
 schedule();
})();
