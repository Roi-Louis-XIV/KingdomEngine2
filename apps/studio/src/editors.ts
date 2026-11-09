/** Éditeurs réutilisables : effets (actions), tableaux objet → quantité, sélecteurs d'entités. */
import type { Action, Condition, WorldDef } from '../../../packages/engine/src/index.ts';
import { h, clear, selectField } from './ui.ts';

export const opts = {
  items: (w: WorldDef) => w.items.map((i) => ({ value: i.id, label: `${i.emoji ?? ''} ${i.name}`.trim() })),
  stats: (w: WorldDef) => w.stats.map((s) => ({ value: s.id, label: `${s.emoji ?? ''} ${s.name}`.trim() })),
  jobs: (w: WorldDef) => w.jobs.map((j) => ({ value: j.id, label: `${j.emoji ?? ''} ${j.name}`.trim() })),
  modifiers: (w: WorldDef) => w.modifiers.map((m) => ({ value: m.id, label: `${m.emoji ?? ''} ${m.name}`.trim() })),
  variables: (w: WorldDef) => w.variables.map((v) => ({ value: v.id, label: v.name })),
};

const EFFECT_TYPES: { value: Action['type']; label: string }[] = [
  { value: 'stat.add', label: 'Modifier une statistique' },
  { value: 'item.give', label: 'Donner un objet' },
  { value: 'item.take', label: 'Retirer un objet' },
  { value: 'modifier.apply', label: 'Activer un bonus temporaire' },
  { value: 'job.xp', label: 'Donner de l’expérience' },
  { value: 'variable.set', label: 'Changer une variable du monde' },
  { value: 'audio.play', label: 'Jouer un son' },
];

function defaultAction(type: Action['type'], w: WorldDef): Action {
  switch (type) {
    case 'stat.add':
      return { type, stat: w.stats[0]?.id ?? '', amount: 10 };
    case 'item.give':
    case 'item.take':
      return { type, item: w.items[0]?.id ?? '', qty: 1 };
    case 'modifier.apply':
      return { type, modifier: w.modifiers[0]?.id ?? '', durationSec: 600 };
    case 'job.xp':
      return { type, job: w.jobs[0]?.id ?? '', amount: 10 };
    case 'variable.set':
      return { type, variable: w.variables[0]?.id ?? '', value: String(w.variables[0]?.options?.[0]?.value ?? '') };
    case 'audio.play':
      return { type, sound: '' };
    default:
      return { type: 'stat.add', stat: w.stats[0]?.id ?? '', amount: 10 };
  }
}

const num = (value: number, onInput: (n: number) => void, attrs: Record<string, unknown> = {}) =>
  h('input', { type: 'number', value: String(value), class: 'num', ...attrs, oninput: (e: Event) => onInput(Number((e.target as HTMLInputElement).value) || 0) });

/** Liste d'effets éditable (consommables, offres, boutons…). */
export function effectsEditor(w: WorldDef, list: Action[], onChange: () => void, sounds: string[] = []): HTMLElement {
  const box = h('div', { class: 'effects' });
  const draw = () => {
    clear(
      box,
      list.map((a, i) => {
        const set = (patch: Partial<Action>) => {
          Object.assign(a, patch);
          onChange();
        };
        let fields: HTMLElement[] = [];
        switch (a.type) {
          case 'stat.add':
            fields = [selectField(null, a.stat, opts.stats(w), (v) => set({ stat: v })), num(a.amount, (n) => set({ amount: n }), { 'aria-label': 'Montant' })];
            break;
          case 'item.give':
          case 'item.take':
            fields = [num(a.qty, (n) => set({ qty: Math.max(1, n) }), { min: 1, 'aria-label': 'Quantité' }), selectField(null, a.item, opts.items(w), (v) => set({ item: v }))];
            break;
          case 'modifier.apply':
            fields = [selectField(null, a.modifier, opts.modifiers(w), (v) => set({ modifier: v })), num(Math.round(a.durationSec / 60), (n) => set({ durationSec: Math.max(1, n) * 60 }), { min: 1, 'aria-label': 'Durée en minutes' }), h('span', { class: 'unit' }, 'min')];
            break;
          case 'job.xp':
            fields = [selectField(null, a.job, opts.jobs(w), (v) => set({ job: v })), num(a.amount, (n) => set({ amount: n }), { 'aria-label': 'XP' }), h('span', { class: 'unit' }, 'XP')];
            break;
          case 'variable.set': {
            const v = w.variables.find((x) => x.id === a.variable);
            fields = [
              selectField(null, a.variable, opts.variables(w), (val) => set({ variable: val, value: w.variables.find((x) => x.id === val)?.options?.[0]?.value ?? '' }), {}),
              v?.options ? selectField(null, String(a.value), v.options.map((o) => ({ value: o.value, label: o.label })), (val) => set({ value: val })) : h('input', { value: String(a.value), oninput: (e: Event) => set({ value: (e.target as HTMLInputElement).value }) }),
            ];
            break;
          }
          case 'audio.play':
            fields = [
              sounds.length
                ? selectField(null, a.sound, sounds.map((s) => ({ value: s, label: s })), (v) => set({ sound: v }), { allowEmpty: 'Choisir un son…' })
                : h('input', { value: a.sound, placeholder: 'clé du son', oninput: (e: Event) => set({ sound: (e.target as HTMLInputElement).value }) }),
            ];
            break;
          default:
            fields = [h('code', null, JSON.stringify(a))];
        }
        return h(
          'div',
          { class: 'effect' },
          h('span', { class: 'effect-type' }, EFFECT_TYPES.find((t) => t.value === a.type)?.label ?? a.type),
          fields,
          h('button', { class: 'icon-btn', title: 'Retirer cet effet', 'aria-label': 'Retirer cet effet', onclick: () => (list.splice(i, 1), onChange(), draw()) }, '✕'),
        );
      }),
      h(
        'div',
        { class: 'effect-add' },
        selectField(null, '', EFFECT_TYPES, (v) => {
          list.push(defaultAction(v as Action['type'], w));
          onChange();
          draw();
        }, { allowEmpty: '+ Ajouter un effet…' }),
      ),
    );
  };
  draw();
  return box;
}

/** Tableau objet → quantité (stocks de départ, objectifs, ingrédients, prix…). */
export function qtyMapEditor(w: WorldDef, map: Record<string, number>, onChange: () => void, labels: { qty: string; add: string }): HTMLElement {
  const box = h('div', { class: 'qtymap' });
  const draw = () => {
    const keys = Object.keys(map);
    clear(
      box,
      keys.length
        ? h(
            'table',
            { class: 'grid compact' },
            h('thead', null, h('tr', null, h('th', null, 'Objet'), h('th', { class: 'r' }, labels.qty), h('th', null, ''))),
            h(
              'tbody',
              null,
              keys.map((k) =>
                h(
                  'tr',
                  null,
                  h('td', null, opts.items(w).find((o) => o.value === k)?.label ?? h('span', { class: 'bad' }, `${k} (inconnu)`)),
                  h('td', { class: 'r' }, num(map[k]!, (n) => ((map[k] = n), onChange()), { 'aria-label': labels.qty })),
                  h('td', { class: 'r' }, h('button', { class: 'icon-btn', 'aria-label': 'Retirer', onclick: () => (delete map[k], onChange(), draw()) }, '✕')),
                ),
              ),
            ),
          )
        : null,
      selectField(
        null,
        '',
        opts.items(w).filter((o) => !(o.value in map)),
        (v) => {
          if (!v) return;
          map[v] = 1;
          onChange();
          draw();
        },
        { allowEmpty: labels.add },
      ),
    );
  };
  draw();
  return box;
}

/** Sélecteur simple de condition « variable = valeur » (ex. phase du scénario). */
export function variableCondition(w: WorldDef, c: Condition | undefined, onChange: (c: Condition | undefined) => void): HTMLElement {
  const v = c?.type === 'variable' ? c : undefined;
  const variable = w.variables.find((x) => x.id === v?.variable) ?? w.variables[0];
  if (!variable) return h('span', { class: 'muted' }, 'Toujours');
  return h(
    'span',
    { class: 'cond' },
    selectField(null, v ? 'si' : '', [{ value: 'si', label: `Si ${variable.name} =` }], (x) => onChange(x ? { type: 'variable', variable: variable.id, op: 'eq', value: variable.options?.[0]?.value ?? '' } : undefined), { allowEmpty: 'Par défaut' }),
    v && variable.options
      ? selectField(null, String(v.value), variable.options.map((o) => ({ value: o.value, label: o.label })), (x) => onChange({ type: 'variable', variable: variable.id, op: 'eq', value: x }))
      : null,
  );
}
