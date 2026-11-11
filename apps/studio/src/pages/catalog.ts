import type { WorldDef } from '../../../../packages/engine/src/index.ts';
import { h, clear, field, selectField, toast, uniqueId } from '../ui.ts';
import { can, draft, touch } from '../store.ts';
import { effectsEditor, textEditor } from '../editors.ts';

const TABS = [
  ['objets', 'Objets'],
  ['statistiques', 'Statistiques'],
  ['bonus', 'Bonus'],
  ['metiers', 'Métiers'],
  ['variables', 'Variables du monde'],
  ['serment', 'Serment d’arrivée'],
  ['regles', 'Règles générales'],
] as const;

/** Catalogue global du monde : objets, statistiques, bonus, métiers, variables. */
export async function catalogPage(main: HTMLElement, params: string[]) {
  const d = await draft();
  const w = d.world;
  const tab = (params[0] as (typeof TABS)[number][0]) ?? 'objets';
  const body = h('div');
  clear(
    main,
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Objets & règles'), h('p', { class: 'muted' }, 'Tout ce que les bâtiments du monde partagent.'))),
      h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) => h('a', { href: `#/catalogue/${id}`, role: 'tab', class: id === tab ? 'on' : '', 'aria-selected': String(id === tab) }, label))),
      body,
    ),
  );
  const changed = () => touch();
  const redraw = () => void catalogPage(main, params);
  switch (tab) {
    case 'objets':
      body.append(itemsTab(w, changed, redraw));
      break;
    case 'statistiques':
      body.append(
        listEditor(w.stats, 'statistique', () => ({ id: uniqueId('stat', w.stats.map((s) => s.id)), name: 'Nouvelle statistique', min: 0, max: 100, initial: 50, kind: 'gauge' as const }), (s) =>
          h(
            'div',
            { class: 'row-fields' },
            field(s, 'emoji', { label: 'Symbole' }, changed),
            field(s, 'name', { label: 'Nom' }, changed),
            selectField('Type', s.kind ?? 'value', [{ value: 'gauge', label: 'Jauge' }, { value: 'currency', label: 'Monnaie' }, { value: 'value', label: 'Valeur' }], (v) => ((s.kind = v as 'gauge'), changed())),
            field(s, 'unit', { label: 'Unité', placeholder: 'écus' }, changed),
            field(s, 'min', { label: 'Minimum', type: 'number' }, changed),
            field(s, 'max', { label: 'Maximum', type: 'number' }, changed),
            field(s, 'initial', { label: 'Valeur de départ', type: 'number' }, changed),
          ),
          changed, redraw),
      );
      break;
    case 'bonus':
      body.append(
        h('p', { class: 'muted' }, 'Un bonus est temporaire. Deux bonus du même groupe ne se cumulent pas : le nouveau remplace l’ancien.'),
        listEditor(w.modifiers, 'bonus', () => ({ id: uniqueId('bonus', w.modifiers.map((s) => s.id)), name: 'Nouveau bonus', emoji: '✨', exclusiveGroup: 'repas' }), (m) =>
          h('div', { class: 'row-fields' }, field(m, 'emoji', { label: 'Symbole' }, changed), field(m, 'name', { label: 'Nom' }, changed), field(m, 'shortName', { label: 'Nom court (filtres)' }, changed), field(m, 'exclusiveGroup', { label: 'Groupe' }, changed), field(m, 'value', { label: 'Valeur', type: 'number', step: 0.01 }, changed)),
          changed, redraw),
      );
      break;
    case 'metiers':
      body.append(
        listEditor(w.jobs, 'métier', () => ({ id: uniqueId('metier', w.jobs.map((s) => s.id)), name: 'Nouveau métier', emoji: '⚒️', xpPerLevel: 100 }), (j) =>
          h('div', { class: 'row-fields' }, field(j, 'emoji', { label: 'Symbole' }, changed), field(j, 'name', { label: 'Nom' }, changed), field(j, 'xpPerLevel', { label: 'XP par niveau', type: 'number', min: 1 }, changed), field(j, 'maxLevel', { label: 'Niveau maximum', type: 'number', min: 1, placeholder: 'Illimité' }, changed)),
          changed, redraw),
      );
      break;
    case 'variables':
      body.append(
        h('p', { class: 'muted' }, 'Les variables décrivent l’état du monde (phase du scénario, saison…). Les textes, ambiances et conditions peuvent en dépendre.'),
        listEditor(w.variables, 'variable', () => ({ id: uniqueId('variable', w.variables.map((s) => s.id)), name: 'Nouvelle variable', initial: 'a', options: [{ value: 'a', label: 'État A' }, { value: 'b', label: 'État B' }] }), (v) =>
          h(
            'div',
            { class: 'form' },
            h('div', { class: 'row-fields' }, field(v, 'name', { label: 'Nom' }, changed), v.options ? selectField('Valeur de départ', String(v.initial), v.options.map((o) => ({ value: o.value, label: o.label })), (x) => ((v.initial = x), changed())) : field(v, 'initial', { label: 'Valeur de départ' }, changed)),
            v.options
              ? h(
                  'div',
                  { class: 'opts' },
                  v.options.map((o, i) =>
                    h('div', { class: 'row-fields' }, field(o, 'label', { label: `Valeur ${i + 1}` }, changed), h('code', { class: 'muted' }, o.value), v.options!.length > 1 ? h('button', { class: 'icon-btn', 'aria-label': 'Retirer', onclick: () => (v.options!.splice(i, 1), changed(), redraw()) }, '✕') : null),
                  ),
                  h(
                    'button',
                    {
                      class: 'btn small',
                      onclick: () => {
                        const label = prompt('Nom de la nouvelle valeur ?');
                        if (!label) return;
                        v.options!.push({ value: uniqueId(label, v.options!.map((o) => o.value)), label });
                        changed();
                        redraw();
                      },
                    },
                    '+ Valeur',
                  ),
                )
              : null,
          ),
          changed, redraw),
      );
      break;
    case 'serment': {
      const ob = w.onboarding;
      if (!ob) {
        body.append(
          h(
            'div',
            { class: 'block' },
            h('p', null, 'Sans serment, tout le monde voit les bâtiments du monde sur Discord. Avec un serment, un salon d’arrivée affiche tes règles et un bouton : le joueur qui le jure reçoit le rôle des habitants (qui ouvre les bâtiments) et sa dotation de départ, une seule fois.'),
            can('editor')
              ? h('button', {
                  class: 'btn primary',
                  onclick: () => {
                    const money = w.stats.find((x) => x.kind === 'currency')?.id;
                    w.onboarding = {
                      enabled: true,
                      channelName: 'serment',
                      title: '📜 Le serment de ' + w.name,
                      text: 'Avant d’entrer, jure de respecter les autres habitants et leurs créations, de ne pas tricher, et de suivre les indications de l’équipe.',
                      button: 'Je le jure',
                      buttonEmoji: '✋',
                      roleName: '🛡️ Habitant',
                      confirmation: 'Bienvenue ! Les bâtiments du monde te sont maintenant ouverts.',
                      actions: money ? [{ type: 'stat.add', stat: money, amount: 100 }] : [],
                    };
                    changed();
                    redraw();
                  },
                }, 'Demander un serment')
              : null,
          ),
        );
        break;
      }
      body.append(
        h(
          'div',
          { class: 'form' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ob.enabled, onchange: (e: Event) => ((ob.enabled = (e.target as HTMLInputElement).checked), changed()) }), 'Serment obligatoire pour accéder aux bâtiments'),
          h('div', { class: 'row-fields' }, field(ob, 'title', { label: 'Titre' }, changed), field(ob, 'channelName', { label: 'Salon d’arrivée', hint: 'Nom du salon Discord' }, changed)),
          h('label', null, 'Texte du serment (tes règles)', textEditor(w, undefined, () => ob.text, (t) => ((ob.text = t), changed()), 6)),
          h('div', { class: 'row-fields' }, field(ob, 'button', { label: 'Bouton' }, changed), field(ob, 'buttonEmoji', { label: 'Symbole du bouton' }, changed), field(ob, 'roleName', { label: 'Rôle donné', hint: 'Créé par le bot s’il n’existe pas' }, changed)),
          h('label', null, 'Message de bienvenue', textEditor(w, undefined, () => ob.confirmation, (t) => ((ob.confirmation = t), changed()), 2)),
          h('div', null, h('b', null, 'Dotation de départ'), h('p', { class: 'muted small' }, 'Donnée une seule fois, au premier serment.'), effectsEditor(w, ob.actions, changed)),
          h('p', { class: 'muted' }, 'Après publication, utilise « Créer les salons manquants » puis « Remettre les salons en ordre » dans Discord & voix.'),
        ),
      );
      break;
    }
    case 'regles':
      body.append(
        h(
          'div',
          { class: 'form' },
          field(w, 'name', { label: 'Nom du monde' }, changed),
          field(w, 'description', { label: 'Description', type: 'textarea' }, changed),
          field(w.settings, 'maxActiveJobs', { label: 'Métiers exercés en même temps', type: 'number', min: 1, max: 10 }, changed),
        ),
      );
      break;
  }
  if (!can('editor')) body.querySelectorAll('input, select, textarea, button').forEach((e) => ((e as HTMLInputElement).disabled = true));
}

/** Liste d'éléments repliables avec ajout / suppression. */
function listEditor<T extends { id: string; name: string; emoji?: string }>(list: T[], noun: string, make: () => T, render: (x: T) => HTMLElement, changed: () => void, redraw: () => void) {
  return h(
    'div',
    { class: 'offers' },
    list.map((x, i) =>
      h(
        'details',
        { class: 'offer' },
        h('summary', null, `${x.emoji ?? ''} ${x.name}`, h('code', { class: 'muted' }, ` ${x.id}`)),
        render(x),
        h(
          'button',
          {
            class: 'btn ghost danger-text small',
            onclick: () => {
              if (!confirm(`Supprimer « ${x.name} » ? Les éléments qui l’utilisent seront signalés en erreur.`)) return;
              list.splice(i, 1);
              changed();
              redraw();
            },
          },
          `Supprimer ce ${noun}`,
        ),
      ),
    ),
    h('button', { class: 'btn small', onclick: () => (list.push(make()), changed(), redraw()) }, `+ Ajouter un ${noun}`),
  );
}

function itemsTab(w: WorldDef, changed: () => void, redraw: () => void) {
  let q = '';
  const list = h('div');
  const cats = [...new Set(w.items.map((i) => i.category ?? 'Sans catégorie'))];
  const draw = () =>
    clear(
      list,
      cats.map((cat) => {
        const items = w.items.filter((i) => (i.category ?? 'Sans catégorie') === cat && i.name.toLowerCase().includes(q.toLowerCase()));
        if (!items.length) return null;
        return h(
          'section',
          { class: 'block' },
          h('h2', null, cat, h('span', { class: 'muted' }, ` ${items.length}`)),
          items.map((it) =>
            h(
              'details',
              { class: 'offer' },
              h('summary', null, `${it.emoji ?? ''} ${it.name}`, it.consumable ? h('span', { class: 'tag ok' }, 'consommable') : null),
              h(
                'div',
                { class: 'form' },
                h('div', { class: 'row-fields' }, field(it, 'emoji', { label: 'Symbole' }, changed), field(it, 'name', { label: 'Nom' }, changed), field(it, 'category', { label: 'Catégorie' }, changed), field(it, 'baseValue', { label: 'Valeur de référence', type: 'number', min: 0 }, changed)),
                field(it, 'description', { label: 'Description', type: 'textarea' }, changed),
                h(
                  'label',
                  { class: 'check' },
                  h('input', { type: 'checkbox', checked: !!it.consumable, onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? (it.consumable = { effects: [] }) : delete it.consumable, changed(), draw()) }),
                  'Le joueur peut le consommer depuis son inventaire',
                ),
                it.consumable ? effectsEditor(w, it.consumable.effects, changed) : null,
                h(
                  'label',
                  { class: 'check' },
                  h('input', { type: 'checkbox', checked: !!it.tool, onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? (it.tool = { maxDurability: 20 }) : delete it.tool, changed(), draw()) }),
                  'C’est un outil qui s’use',
                ),
                it.tool ? field(it.tool, 'maxDurability', { label: 'Durabilité maximale', type: 'number', min: 1, hint: 'Chaque joueur a sa propre durabilité. À 0, l’outil est cassé jusqu’à réparation.' }, changed) : null,
                h(
                  'button',
                  {
                    class: 'btn ghost danger-text small',
                    onclick: () => {
                      if (!confirm(`Supprimer « ${it.name} » ?`)) return;
                      w.items.splice(w.items.indexOf(it), 1);
                      changed();
                      redraw();
                    },
                  },
                  'Supprimer cet objet',
                ),
              ),
            ),
          ),
        );
      }),
    );
  draw();
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'inline-form' },
      h('input', { class: 'search', type: 'search', placeholder: `Rechercher parmi ${w.items.length} objets…`, 'aria-label': 'Rechercher un objet', oninput: (e: Event) => ((q = (e.target as HTMLInputElement).value), draw()) }),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            const name = prompt('Nom du nouvel objet ?');
            if (!name) return;
            w.items.push({ id: uniqueId(name, w.items.map((i) => i.id)), name, emoji: '📦', category: cats[0] ?? 'Divers' });
            changed();
            toast(`« ${name} » ajouté.`);
            redraw();
          },
        },
        'Nouvel objet',
      ),
    ),
    list,
  );
}
