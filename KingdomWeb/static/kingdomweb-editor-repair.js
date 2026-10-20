/* Non-destructive preview of existing fields; original editor save and publish untouched. */
(()=>{'use strict';
const modal=document.getElementById('editor'),form=document.getElementById('editor-form'),aside=document.getElementById('context-help');
if(!modal||!form||!aside)return;
const preview=document.createElement('section');preview.className='kw-repair-preview';preview.setAttribute('aria-label','Aperçu des informations saisies');
preview.innerHTML='<small>APERÇU DES INFORMATIONS · SAISIE EN COURS</small><strong class="kw-repair-name"></strong><p class="kw-repair-description"></p><span class="kw-repair-status" role="status"></span><p class="kw-repair-note">Cet aperçu reflète les champs existants. Il ne simule pas un message Discord publié.</p>';
aside.prepend(preview);
let pending=false;
function update(){pending=false;if(modal.hidden)return;
const name=form.querySelector('#name')?.value.trim()||'Sans nom';
const emoji=form.querySelector('#emoji')?.value.trim()||'◇';
const description=form.querySelector('#description')?.value.trim()||'Ajoutez une description dans le formulaire.';
preview.querySelector('.kw-repair-name').textContent=emoji+' '+name;
preview.querySelector('.kw-repair-description').textContent=description;
const required=[...form.querySelectorAll('[required]')].filter(f=>f.getClientRects().length&&f.type!=='hidden');
const invalid=required.filter(f=>!f.checkValidity());
const status=preview.querySelector('.kw-repair-status');status.dataset.ready=String(invalid.length===0);
status.textContent=invalid.length?invalid.length+' champ(s) obligatoire(s) à vérifier':'Champs obligatoires visibles renseignés';
}
function schedule(){if(!pending){pending=true;requestAnimationFrame(update)}}
form.addEventListener('input',schedule);form.addEventListener('change',schedule);
new MutationObserver(schedule).observe(modal,{attributes:true,attributeFilter:['hidden']});
new MutationObserver(schedule).observe(form.querySelector('#type-fields')||form,{childList:true,subtree:true});
schedule();
})();
