/* Contextual inspector: read-only companion to the existing creation form. */
(()=>{'use strict';
const modal=document.getElementById('editor'),form=document.getElementById('editor-form'),aside=document.getElementById('context-help');
if(!modal||!form||!aside)return;
const inspector=document.createElement('section');inspector.className='kw-inspector';inspector.setAttribute('aria-label','Inspecteur de création');
inspector.innerHTML='<div class="kw-inspector-head"><small>INSPECTEUR</small><strong id="kw-inspector-title">Sélectionnez un réglage</strong></div><p id="kw-inspector-hint">Cliquez sur un champ pour consulter sa valeur et son état.</p><div class="kw-inspector-value" id="kw-inspector-value"></div><div class="kw-inspector-validation" id="kw-inspector-validation" role="status"></div><div class="kw-inspector-links"><button type="button" id="kw-inspector-name">Nom</button><button type="button" id="kw-inspector-description">Description</button><button type="button" id="kw-inspector-key">Identifiant</button></div>';
aside.append(inspector);
const $=id=>inspector.querySelector('#'+id);
const label=f=>(f.labels?.[0]?.textContent||f.getAttribute('aria-label')||f.name||f.id||'Réglage').replace(/\s+/g,' ').trim().slice(0,100);
const eligible=f=>f&&form.contains(f)&&f.matches('input,select,textarea')&&f.type!=='hidden'&&f.type!=='search'&&!f.closest('.kw-editor-workflow');
let selected=null;
function display(){if(modal.hidden)return;const f=eligible(selected)?selected:form.querySelector('#name');if(!f)return;
$('kw-inspector-title').textContent=label(f);
const note=f.closest('label')?.querySelector('.field-note')?.textContent||f.getAttribute('placeholder')||f.getAttribute('title')||'';
$('kw-inspector-hint').textContent=note||'Modifiez ce réglage dans le formulaire à gauche.';
let value=f.type==='checkbox'?(f.checked?'Activé':'Désactivé'):f.tagName==='SELECT'?(f.selectedOptions[0]?.textContent||'Non sélectionné'):f.value;
$('kw-inspector-value').textContent=value?`Valeur actuelle : ${value.slice(0,220)}`:'Aucune valeur renseignée';
const validation=$('kw-inspector-validation');validation.classList.remove('kw-invalid');
if(f.required&&!f.value.trim()){validation.textContent='Champ obligatoire à compléter';validation.classList.add('kw-invalid')}
else if(!f.checkValidity()){validation.textContent=f.validationMessage||'Valeur à corriger';validation.classList.add('kw-invalid')}
else validation.textContent='Valeur conforme aux contraintes du champ';
}
form.addEventListener('focusin',e=>{if(eligible(e.target)){selected=e.target;display()}});
form.addEventListener('input',display);form.addEventListener('change',display);
[['kw-inspector-name','name'],['kw-inspector-description','description'],['kw-inspector-key','key']].forEach(([button,id])=>$(button).addEventListener('click',()=>{const f=form.querySelector('#'+id);if(!f)return;f.closest('details')?.setAttribute('open','');f.scrollIntoView({behavior:'smooth',block:'center'});f.focus({preventScroll:true});selected=f;display()}));
const observer=new MutationObserver(()=>{if(!modal.hidden){if(!eligible(selected)||!selected.getClientRects().length)selected=form.querySelector('#name');display()}});
observer.observe(modal,{attributes:true,attributeFilter:['hidden']});
display();
})();
