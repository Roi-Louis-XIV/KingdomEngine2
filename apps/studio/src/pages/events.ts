import type { EventDef, EventSchedule, WorldDef } from '../../../../packages/engine/src/index.ts';
import { describeSchedule } from '../../../../packages/engine/src/index.ts';
import { h, clear, field, selectField, toast, uniqueId, emptyState } from '../ui.ts';
import { can, draft, touch } from '../store.ts';
import { effectsEditor, textEditor } from '../editors.ts';

const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const SCHEDULES = [
  { value: 'manual', label: 'À la main uniquement' },
  { value: 'daily', label: 'Chaque jour à heure fixe' },
  { value: 'interval', label: 'À intervalle régulier' },
  { value: 'once', label: 'Une seule fois, à une date' },
];

/** Contenu : météo automatique et événements (programmation, étapes, annonces). */
export async function eventsPage(main: HTMLElement) {
  const d = await draft();
  const w = d.world;
  w.events ??= [];
  const changed = () => touch();
  const body = h('div');
  clear(
    main,
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Météo & événements'), h('p', { class: 'muted' }, 'Ce qui fait vivre le monde tout seul. Le pilotage en direct se fait dans « En direct ».'))),
      body,
    ),
  );
  const draw = () => clear(body, weatherEditor(w, changed, draw), eventsEditor(w, changed, draw));
  draw();
  if (!can('editor')) body.querySelectorAll('input, select, textarea, button').forEach((e) => ((e as HTMLInputElement).disabled = true));
}

function weatherEditor(w: WorldDef, changed: () => void, redraw: () => void): HTMLElement {
  if (!w.weather) {
    return h(
      'section',
      { class: 'block' },
      h('h2', null, 'Météo'),
      h('p', { class: 'muted' }, 'La météo change toute seule selon des probabilités. Elle pilote une variable du monde : textes, activités et ambiances peuvent en dépendre.'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            let v = w.variables.find((x) => x.id === 'meteo');
            if (!v) {
              v = { id: 'meteo', name: 'Météo', initial: 'soleil', options: [{ value: 'soleil', label: '☀️ Ensoleillé' }, { value: 'nuages', label: '⛅ Nuageux' }, { value: 'pluie', label: '🌧️ Pluie' }, { value: 'orage', label: '⛈️ Orage' }] };
              w.variables.push(v);
            }
            w.weather = {
              variable: v.id,
              states: (v.options ?? []).map((o, i) => ({ value: o.value, weight: [50, 30, 15, 5][i] ?? 10, minMinutes: 30, maxMinutes: 120 })),
            };
            changed();
            toast('Météo activée avec quatre temps : ajuste les probabilités.');
            redraw();
          },
        },
        'Activer la météo',
      ),
    );
  }
  const wd = w.weather;
  const v = w.variables.find((x) => x.id === wd.variable);
  const total = wd.states.reduce((a, s) => a + Math.max(0, s.weight), 0) || 1;
  const missing = (v?.options ?? []).filter((o) => !wd.states.some((s) => s.value === o.value));
  return h(
    'section',
    { class: 'block' },
    h('h2', null, 'Météo'),
    h('div', { class: 'row-fields' }, selectField('Variable pilotée', wd.variable, w.variables.filter((x) => x.options).map((x) => ({ value: x.id, label: x.name })), (x) => ((wd.variable = x), changed(), redraw()), { hint: 'Ses valeurs sont les temps possibles (modifiables dans Objets & règles › Variables).' })),
    h(
      'table',
      { class: 'grid weather-table' },
      h('thead', null, h('tr', null, h('th', null, 'Temps'), h('th', null, 'Probabilité'), h('th', null, 'Durée (min)'), h('th', null, 'Annonce à son arrivée'), h('th', null, ''))),
      h(
        'tbody',
        null,
        wd.states.map((st, i) =>
          h(
            'tr',
            null,
            h('td', null, v?.options?.find((o) => o.value === st.value)?.label ?? h('span', { class: 'bad' }, st.value)),
            h('td', null, h('div', { class: 'inline' }, h('input', { type: 'number', class: 'num', min: 0, value: String(st.weight), 'aria-label': 'Poids', oninput: (e: Event) => ((st.weight = Number((e.target as HTMLInputElement).value) || 0), changed()), onchange: redraw }), h('span', { class: 'muted small' }, `${Math.round((Math.max(0, st.weight) / total) * 100)} %`))),
            h('td', null, h('div', { class: 'inline' }, h('input', { type: 'number', class: 'num', min: 1, value: String(st.minMinutes), 'aria-label': 'Durée minimale', oninput: (e: Event) => ((st.minMinutes = Number((e.target as HTMLInputElement).value) || 1), changed()) }), '–', h('input', { type: 'number', class: 'num', min: 1, value: String(st.maxMinutes), 'aria-label': 'Durée maximale', oninput: (e: Event) => ((st.maxMinutes = Number((e.target as HTMLInputElement).value) || 1), changed()) }))),
            h('td', null, h('input', { value: typeof st.announce === 'string' ? st.announce : '', placeholder: 'Facultatif', oninput: (e: Event) => { const x = (e.target as HTMLInputElement).value; if (x) st.announce = x; else delete st.announce; changed(); } })),
            h('td', { class: 'r' }, h('button', { class: 'icon-btn', 'aria-label': 'Retirer ce temps', onclick: () => (wd.states.splice(i, 1), changed(), redraw()) }, '✕')),
          ),
        ),
      ),
    ),
    missing.length ? selectField(null, '', missing.map((o) => ({ value: o.value, label: o.label })), (x) => x && (wd.states.push({ value: x, weight: 10, minMinutes: 30, maxMinutes: 90 }), changed(), redraw()), { allowEmpty: '+ Ajouter un temps…' }) : null,
    h('button', { class: 'btn ghost danger-text small', onclick: () => (delete w.weather, changed(), redraw()) }, 'Désactiver la météo'),
  );
}

function scheduleEditor(ev: EventDef, changed: () => void, redraw: () => void): HTMLElement {
  const s = ev.schedule;
  const set = (next: EventSchedule) => {
    ev.schedule = next;
    changed();
    redraw();
  };
  return h(
    'div',
    { class: 'row-fields' },
    selectField('Déclenchement', s.type, SCHEDULES, (v) =>
      set(v === 'daily' ? { type: 'daily', at: '20:00' } : v === 'interval' ? { type: 'interval', everyMinutes: 180 } : v === 'once' ? { type: 'once', at: new Date(Date.now() + 86400000).toISOString().slice(0, 16) } : { type: 'manual' }),
    ),
    s.type === 'daily'
      ? [
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Heure'), h('input', { type: 'time', value: s.at, oninput: (e: Event) => ((s.at = (e.target as HTMLInputElement).value), changed()) })),
          h(
            'div',
            { class: 'field' },
            h('span', { class: 'field-label' }, 'Jours (aucun = tous)'),
            h(
              'div',
              { class: 'chips' },
              DAYS.map((label, i) =>
                h('button', {
                  type: 'button',
                  class: `chip${s.days?.includes(i) ? ' on' : ''}`,
                  'aria-pressed': String(!!s.days?.includes(i)),
                  onclick: () => {
                    const days = new Set(s.days ?? []);
                    days.has(i) ? days.delete(i) : days.add(i);
                    s.days = [...days].sort();
                    if (!s.days.length) delete s.days;
                    changed();
                    redraw();
                  },
                }, label),
              ),
            ),
          ),
        ]
      : null,
    s.type === 'interval' ? field(s, 'everyMinutes', { label: 'Toutes les (minutes)', type: 'number', min: 1 }, changed) : null,
    s.type === 'once' ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Date et heure (heure du monde)'), h('input', { type: 'datetime-local', value: s.at.slice(0, 16), oninput: (e: Event) => ((s.at = (e.target as HTMLInputElement).value), changed()) })) : null,
  );
}

function eventsEditor(w: WorldDef, changed: () => void, redraw: () => void): HTMLElement {
  const events = w.events!;
  return h(
    'section',
    { class: 'block' },
    h('h2', null, 'Événements'),
    h('p', { class: 'muted' }, 'Un événement change le monde au début, au fil d’étapes, puis à la fin. Il agit sur les variables (phase, météo…) dont dépendent textes, activités et ambiances.'),
    events.length ? null : emptyState('Aucun événement', 'Crée ton premier événement : une soirée quotidienne, une invasion, une fête…'),
    events.map((ev, i) =>
      h(
        'details',
        { class: 'module' },
        h('summary', null, h('b', null, `${ev.emoji ?? '📅'} ${ev.name}`), h('span', { class: 'chip static' }, describeSchedule(ev.schedule)), ev.durationMinutes ? h('span', { class: 'muted small' }, `${ev.durationMinutes} min`) : null),
        h(
          'div',
          { class: 'form' },
          h('div', { class: 'row-fields' }, field(ev, 'emoji', { label: 'Symbole' }, changed), field(ev, 'name', { label: 'Nom' }, changed), field(ev, 'durationMinutes', { label: 'Durée (min, 0 = jusqu’à l’arrêt)', type: 'number', min: 0 }, changed)),
          field(ev, 'description', { label: 'Description (pour l’équipe)' }, changed),
          scheduleEditor(ev, changed, redraw),
          h('h3', null, 'Au début'),
          effectsEditor(w, ev.onStart, changed),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Annonce de début'), textEditor(w, undefined, () => ev.announce?.start ?? '', (t) => ((ev.announce ??= {}).start = t, changed()), 2)),
          h('h3', null, 'Étapes'),
          h('p', { class: 'muted small' }, 'Le temps des étapes ne compte pas pendant les pauses.'),
          ev.steps.map((st, j) =>
            h(
              'div',
              { class: 'result' },
              h('div', { class: 'row-fields' }, field(st, 'afterMinutes', { label: 'Après (min)', type: 'number', min: 0 }, changed), field(st, 'name', { label: 'Nom de l’étape' }, changed), h('button', { class: 'icon-btn', 'aria-label': 'Retirer l’étape', onclick: () => (ev.steps.splice(j, 1), changed(), redraw()) }, '✕')),
              effectsEditor(w, st.actions, changed),
              h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Annonce'), textEditor(w, undefined, () => st.announce ?? '', (t) => ((st.announce = t), changed()), 2)),
            ),
          ),
          h('button', { class: 'btn small', onclick: () => (ev.steps.push({ afterMinutes: Math.max(1, Math.floor(ev.durationMinutes / 2)), name: 'Nouvelle étape', actions: [] }), changed(), redraw()) }, '+ Étape'),
          h('h3', null, 'À la fin (ou à l’arrêt)'),
          effectsEditor(w, ev.onEnd, changed),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Annonce de fin'), textEditor(w, undefined, () => ev.announce?.end ?? '', (t) => ((ev.announce ??= {}).end = t, changed()), 2)),
          h('button', { class: 'btn ghost danger-text small', onclick: () => { if (confirm(`Supprimer « ${ev.name} » ?`)) { events.splice(i, 1); changed(); redraw(); } } }, 'Supprimer l’événement'),
        ),
      ),
    ),
    h(
      'button',
      {
        class: 'btn primary',
        onclick: () => {
          events.push({ id: uniqueId('evenement', events.map((e) => e.id)), name: 'Nouvel événement', emoji: '📅', schedule: { type: 'manual' }, durationMinutes: 30, onStart: [], onEnd: [], steps: [] });
          changed();
          redraw();
          (document.querySelectorAll('details.module') as NodeListOf<HTMLDetailsElement>).forEach((x, k, all) => k === all.length - 1 && (x.open = true));
        },
      },
      'Nouvel événement',
    ),
  );
}
