/** Éditeurs réutilisables : effets (actions), tableaux objet → quantité, sélecteurs d'entités. */
import type { Action, BuildingDef, ButtonDef, ButtonStyle, CompareOp, Condition, Rule, Text, WorldDef } from '../../../packages/engine/src/index.ts';
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
  { value: 'job.join', label: 'Faire entrer dans un métier' },
  { value: 'job.leave', label: 'Faire quitter son métier' },
  { value: 'tool.wear', label: 'User un outil' },
  { value: 'tool.repair', label: 'Réparer un outil' },
  { value: 'stat.set', label: 'Fixer une statistique' },
  { value: 'variable.add', label: 'Ajouter à une variable (compteur)' },
  { value: 'objective.add', label: 'Contribuer à un objectif commun' },
  { value: 'quest.tag', label: 'Faire avancer les quêtes (repère)' },
  { value: 'announce', label: 'Publier une annonce' },
  { value: 'if', label: 'Si… sinon… (branche)' },
  { value: 'players.each', label: 'Pour chaque joueur…' },
];

const objectiveOptions = (w: WorldDef) =>
  w.buildings.flatMap((b) => b.modules.filter((m) => m.type === 'objective').map((m) => ({ value: `${b.id}/${m.id}`, label: `${b.emoji ?? ''} ${b.name} › ${m.name}`.trim() })));

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
    case 'job.join':
      return { type, job: w.jobs[0]?.id ?? '' };
    case 'job.leave':
      return { type };
    case 'tool.wear':
      return { type, item: w.items.find((i) => i.tool)?.id ?? '', amount: 1 };
    case 'tool.repair':
      return { type, item: w.items.find((i) => i.tool)?.id ?? '' };
    case 'stat.set':
      return { type, stat: w.stats[0]?.id ?? '', value: 0 };
    case 'variable.add':
      return { type, variable: w.variables.find((v) => !v.options)?.id ?? w.variables[0]?.id ?? '', amount: 1 };
    case 'objective.add': {
      const [b, m] = (objectiveOptions(w)[0]?.value ?? '/').split('/');
      const goals = w.buildings.find((x) => x.id === b)?.modules.find((x) => x.id === m);
      return { type, building: b ?? '', objective: m ?? '', item: goals?.type === 'objective' ? (Object.keys(goals.goals)[0] ?? '') : '', qty: 1 };
    }
    case 'quest.tag':
      return { type, tag: 'mon-repere' };
    case 'announce':
      return { type, text: '📣 Nouvelle !' };
    case 'if':
      return { type, when: { type: 'variable', variable: w.variables[0]?.id ?? '', op: 'eq', value: w.variables[0]?.options?.[0]?.value ?? '' }, then: [], else: [] };
    case 'players.each':
      return { type, actions: [] };
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
          case 'job.join':
            fields = [selectField(null, a.job, opts.jobs(w), (v) => set({ job: v }))];
            break;
          case 'job.leave':
            fields = [selectField(null, a.job ?? '', opts.jobs(w), (v) => set({ job: v || undefined }), { allowEmpty: 'Son métier actuel' })];
            break;
          case 'tool.wear':
          case 'tool.repair': {
            const tools = w.items.filter((i) => i.tool).map((i) => ({ value: i.id, label: `${i.emoji ?? ''} ${i.name}` }));
            fields = [selectField(null, a.item, tools, (v) => set({ item: v }))];
            if (a.type === 'tool.wear') fields.push(num(a.amount, (n) => set({ amount: Math.max(1, n) }), { min: 1, 'aria-label': 'Usure' }), h('span', { class: 'unit' }, 'points'));
            break;
          }
          case 'stat.set':
            fields = [selectField(null, a.stat, opts.stats(w), (v) => set({ stat: v })), num(a.value, (n) => set({ value: n }), { 'aria-label': 'Valeur' })];
            break;
          case 'audio.play':
            fields = [
              sounds.length
                ? selectField(null, a.sound, sounds.map((s) => ({ value: s, label: s })), (v) => set({ sound: v }), { allowEmpty: 'Choisir un son…' })
                : h('input', { value: a.sound, placeholder: 'clé du son', oninput: (e: Event) => set({ sound: (e.target as HTMLInputElement).value }) }),
              w.characters?.length
                ? selectField(null, a.character ?? '', w.characters.map((c) => ({ value: c.id, label: `dit par ${c.emoji ?? ''} ${c.name}`.replace('  ', ' ') })), (v) => set({ character: v || undefined }), { allowEmpty: 'son du lieu (ambiance)' })
                : null,
            ].filter(Boolean) as HTMLElement[];
            break;
          case 'variable.add':
            fields = [selectField(null, a.variable, opts.variables(w), (v) => set({ variable: v })), num(a.amount, (n) => set({ amount: n }), { 'aria-label': 'Montant' })];
            break;
          case 'quest.tag':
            fields = [h('input', { value: a.tag, placeholder: 'repère', 'aria-label': 'Repère de quête', oninput: (e: Event) => set({ tag: (e.target as HTMLInputElement).value }) }), num(a.amount ?? 1, (n) => set({ amount: Math.max(1, n) }), { min: 1, 'aria-label': 'Quantité' })];
            break;
          case 'announce':
            fields = [h('input', { value: typeof a.text === 'string' ? a.text : '', placeholder: 'Texte de l’annonce', class: 'wide', oninput: (e: Event) => set({ text: (e.target as HTMLInputElement).value }) })];
            break;
          case 'objective.add': {
            const goals = w.buildings.find((x) => x.id === a.building)?.modules.find((x) => x.id === a.objective);
            const items = goals?.type === 'objective' ? Object.keys(goals.goals).map((id) => opts.items(w).find((o) => o.value === id) ?? { value: id, label: id }) : [];
            fields = [
              selectField(null, `${a.building}/${a.objective}`, objectiveOptions(w), (v) => {
                const [b, m] = v.split('/');
                const g = w.buildings.find((x) => x.id === b)?.modules.find((x) => x.id === m);
                set({ building: b, objective: m, item: g?.type === 'objective' ? (Object.keys(g.goals)[0] ?? '') : '' });
                draw();
              }),
              items.length ? selectField(null, a.item, items, (v) => set({ item: v })) : h('span', { class: 'muted' }, 'objectif vide'),
              num(a.qty, (n) => set({ qty: Math.max(1, n) }), { min: 1, 'aria-label': 'Quantité' }),
            ];
            break;
          }
          case 'if':
            fields = [
              h(
                'div',
                { class: 'effect-branch' },
                h('span', { class: 'muted' }, 'Si'),
                conditionEditor(w, undefined, a.when, (c) => set({ when: c ?? { type: 'all', conditions: [] } })),
                h('span', { class: 'muted' }, 'alors'),
                effectsEditor(w, a.then, onChange, sounds),
                h('span', { class: 'muted' }, 'sinon'),
                effectsEditor(w, (a.else ??= []), onChange, sounds),
              ),
            ];
            break;
          case 'players.each':
            fields = [h('div', { class: 'effect-branch' }, effectsEditor(w, a.actions, onChange, sounds))];
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

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const COND_TYPES: { value: string; label: string }[] = [
  { value: 'hasJob', label: 'Exerce un métier' },
  { value: 'noJob', label: 'N’exerce aucun métier' },
  { value: 'jobLevel', label: 'Niveau de métier' },
  { value: 'stat', label: 'Statistique' },
  { value: 'item', label: 'Possède un objet' },
  { value: 'tool', label: 'Possède un outil en état' },
  { value: 'variable', label: 'Variable du monde' },
  { value: 'modifierActive', label: 'Bonus actif' },
  { value: 'objective', label: 'Avancement d’un objectif commun' },
  { value: 'quest', label: 'État d’une quête' },
  { value: 'compare', label: 'Comparer deux variables' },
  { value: 'all', label: 'Toutes ces conditions' },
  { value: 'any', label: 'Au moins une de ces conditions' },
];
const OPS: { value: CompareOp; label: string }[] = [
  { value: 'gte', label: '≥' },
  { value: 'gt', label: '>' },
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'lte', label: '≤' },
  { value: 'lt', label: '<' },
];

function newCondition(type: string, w: WorldDef): Condition {
  switch (type) {
    case 'hasJob':
      return { type: 'hasJob', job: w.jobs[0]?.id };
    case 'noJob':
      return { type: 'not', condition: { type: 'hasJob' } };
    case 'jobLevel':
      return { type: 'jobLevel', job: w.jobs[0]?.id ?? '', op: 'gte', value: 2 };
    case 'stat':
      return { type: 'stat', stat: w.stats[0]?.id ?? '', op: 'gte', value: 10 };
    case 'item':
      return { type: 'item', item: w.items[0]?.id ?? '', op: 'gte', value: 1 };
    case 'tool':
      return { type: 'tool', item: w.items.find((i) => i.tool)?.id ?? '' };
    case 'variable':
      return { type: 'variable', variable: w.variables[0]?.id ?? '', op: 'eq', value: w.variables[0]?.options?.[0]?.value ?? '' };
    case 'modifierActive':
      return { type: 'modifierActive' };
    case 'any':
      return { type: 'any', conditions: [] };
    case 'objective': {
      const [b, m] = (objectiveOptions(w)[0]?.value ?? '/').split('/');
      return { type: 'objective', building: b ?? '', objective: m ?? '', op: 'gte', value: 100 };
    }
    case 'quest':
      return { type: 'quest', quest: w.quests?.quests[0]?.id ?? '', status: 'done' };
    case 'compare':
      return { type: 'compare', left: w.variables[0]?.id ?? '', op: 'gt', right: w.variables[1]?.id ?? w.variables[0]?.id ?? '' };
    default:
      return { type: 'all', conditions: [] };
  }
}

const kindOf = (c: Condition) => (c.type === 'not' && c.condition.type === 'hasJob' && !c.condition.job ? 'noJob' : c.type);

/**
 * Éditeur de condition, récursif. `value` peut être undefined (= toujours vrai).
 * onChange reçoit la nouvelle condition (ou undefined).
 */
export function conditionEditor(w: WorldDef, b: BuildingDef | undefined, value: Condition | undefined, onChange: (c: Condition | undefined) => void, depth = 0): HTMLElement {
  const box = h('div', { class: `cond-box depth${depth}` });
  let c = value;
  const emit = () => onChange(c);
  const draw = () => {
    if (!c) {
      clear(box, selectField(null, '', COND_TYPES, (v) => ((c = newCondition(v, w)), emit(), draw()), { allowEmpty: depth ? 'Choisir…' : 'Toujours (aucune condition)' }));
      return;
    }
    const cur = c;
    const negated = cur.type === 'not' && kindOf(cur) !== 'noJob';
    const inner: Condition = negated ? (cur as Extract<Condition, { type: 'not' }>).condition : cur;
    const setInner = (next: Condition) => {
      c = negated ? { type: 'not', condition: next } : next;
      emit();
    };
    const fields: (HTMLElement | null)[] = [];
    const num = (v: number, set: (n: number) => void) => h('input', { type: 'number', class: 'num', value: String(v), oninput: (e: Event) => set(Number((e.target as HTMLInputElement).value) || 0) });
    switch (inner.type) {
      case 'hasJob':
        fields.push(selectField(null, inner.job ?? '', opts.jobs(w), (v) => setInner({ type: 'hasJob', job: v || undefined }), { allowEmpty: 'n’importe lequel' }));
        break;
      case 'jobLevel':
        fields.push(selectField(null, inner.job, opts.jobs(w), (v) => setInner({ ...inner, job: v })), selectField(null, inner.op, OPS, (v) => setInner({ ...inner, op: v as CompareOp })), num(inner.value, (n) => setInner({ ...inner, value: n })));
        break;
      case 'stat':
        fields.push(selectField(null, inner.stat, opts.stats(w), (v) => setInner({ ...inner, stat: v })), selectField(null, inner.op, OPS, (v) => setInner({ ...inner, op: v as CompareOp })), num(inner.value, (n) => setInner({ ...inner, value: n })));
        break;
      case 'item': {
        const invs = (b?.modules ?? []).filter((m) => m.type === 'inventory').map((m) => ({ value: m.id, label: `Réserve : ${m.name}` }));
        fields.push(
          selectField(null, inner.item, opts.items(w), (v) => setInner({ ...inner, item: v })),
          selectField(null, inner.op, OPS, (v) => setInner({ ...inner, op: v as CompareOp })),
          num(inner.value, (n) => setInner({ ...inner, value: n })),
          invs.length ? selectField(null, inner.inventory ?? '', invs, (v) => setInner({ ...inner, inventory: v || undefined }), { allowEmpty: 'chez le joueur' }) : null,
        );
        break;
      }
      case 'tool':
        fields.push(selectField(null, inner.item, w.items.filter((i) => i.tool).map((i) => ({ value: i.id, label: `${i.emoji ?? ''} ${i.name}` })), (v) => setInner({ ...inner, item: v })));
        break;
      case 'variable': {
        const v = w.variables.find((x) => x.id === inner.variable);
        fields.push(
          selectField(null, inner.variable, opts.variables(w), (x) => setInner({ type: 'variable', variable: x, op: 'eq', value: w.variables.find((y) => y.id === x)?.options?.[0]?.value ?? '' })),
          v?.options
            ? selectField(null, inner.op === 'neq' ? 'neq' : 'eq', [{ value: 'eq', label: '=' }, { value: 'neq', label: '≠' }], (x) => setInner({ ...inner, op: x as CompareOp }))
            : selectField(null, inner.op, OPS, (x) => setInner({ ...inner, op: x as CompareOp })),
          v?.options
            ? selectField(null, String(inner.value), v.options.map((o) => ({ value: o.value, label: o.label })), (x) => setInner({ ...inner, value: x }))
            : h('input', {
                value: String(inner.value),
                class: 'num',
                oninput: (e: Event) => {
                  const raw = (e.target as HTMLInputElement).value;
                  setInner({ ...inner, value: raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw });
                },
              }),
        );
        break;
      }
      case 'objective':
        fields.push(
          selectField(null, `${inner.building}/${inner.objective}`, objectiveOptions(w), (x) => {
            const [bb, m] = x.split('/');
            setInner({ ...inner, building: bb ?? '', objective: m ?? '' });
          }),
          selectField(null, inner.op, OPS, (x) => setInner({ ...inner, op: x as CompareOp })),
          num(inner.value, (n) => setInner({ ...inner, value: n })),
          h('span', { class: 'unit' }, '%'),
        );
        break;
      case 'quest':
        fields.push(
          selectField(null, inner.quest, (w.quests?.quests ?? []).map((q) => ({ value: q.id, label: q.name })), (x) => setInner({ ...inner, quest: x })),
          selectField(null, inner.status, [{ value: 'done', label: 'réussie' }, { value: 'active', label: 'en cours' }, { value: 'none', label: 'pas commencée' }], (x) => setInner({ ...inner, status: x as 'done' })),
        );
        break;
      case 'compare':
        fields.push(
          selectField(null, inner.left, opts.variables(w), (x) => setInner({ ...inner, left: x })),
          selectField(null, inner.op, OPS, (x) => setInner({ ...inner, op: x as CompareOp })),
          selectField(null, inner.right, opts.variables(w), (x) => setInner({ ...inner, right: x })),
        );
        break;
      case 'modifierActive':
        fields.push(selectField(null, inner.modifier ?? '', opts.modifiers(w), (v) => setInner({ type: 'modifierActive', modifier: v || undefined }), { allowEmpty: 'n’importe lequel' }));
        break;
      case 'all':
      case 'any': {
        const group = inner;
        fields.push(
          h(
            'div',
            { class: 'cond-children' },
            group.conditions.map((sub, i) =>
              conditionEditor(w, b, sub, (next) => {
                if (next) group.conditions[i] = next;
                else group.conditions.splice(i, 1);
                emit();
                draw();
              }, depth + 1),
            ),
            h('button', { class: 'btn small', onclick: () => (group.conditions.push(newCondition('hasJob', w)), emit(), draw()) }, '+ Condition'),
          ),
        );
        break;
      }
    }
    const kind = kindOf(inner) === 'not' ? 'noJob' : kindOf(cur) === 'noJob' ? 'noJob' : kindOf(inner);
    clear(
      box,
      h(
        'div',
        { class: 'cond-line' },
        kind !== 'noJob' && inner.type !== 'all' && inner.type !== 'any'
          ? h('label', { class: 'check small', title: 'Inverser la condition' }, h('input', { type: 'checkbox', checked: negated, onchange: (e: Event) => ((c = (e.target as HTMLInputElement).checked ? { type: 'not', condition: inner } : inner), emit(), draw()) }), 'Ne… pas')
          : null,
        selectField(null, kind, COND_TYPES, (v) => ((c = newCondition(v, w)), emit(), draw())),
        inner.type === 'all' || inner.type === 'any' ? null : fields,
        h('button', { class: 'icon-btn', 'aria-label': 'Retirer la condition', onclick: () => ((c = undefined), emit(), draw()) }, '✕'),
      ),
      inner.type === 'all' || inner.type === 'any' ? fields : null,
    );
  };
  draw();
  return box;
}

// ---------------------------------------------------------------------------
// Textes variables
// ---------------------------------------------------------------------------

/** Éditeur de texte : simple, ou variable selon des conditions (premier cas vrai). */
export function textEditor(w: WorldDef, b: BuildingDef | undefined, get: () => Text, set: (t: Text) => void, rows = 3): HTMLElement {
  const box = h('div', { class: 'text-editor' });
  const draw = () => {
    const t = get();
    if (typeof t === 'string') {
      clear(
        box,
        h('textarea', { rows: Math.min(10, Math.max(rows, t.split('\n').length + 1)), oninput: (e: Event) => set((e.target as HTMLTextAreaElement).value) }, t),
        h('button', { class: 'link small', onclick: () => (set({ cases: [{ when: w.variables[0] ? { type: 'variable', variable: w.variables[0].id, op: 'eq', value: w.variables[0].options?.[0]?.value ?? '' } : undefined, text: t }, { text: t }] }), draw()) }, 'Faire varier ce texte selon une condition'),
      );
      return;
    }
    clear(
      box,
      h('p', { class: 'muted small' }, 'Le premier cas dont la condition est vraie est affiché. Le dernier, sans condition, sert de défaut.'),
      t.cases.map((cs, i) =>
        h(
          'div',
          { class: 'text-case' },
          h('div', { class: 'text-case-head' }, h('span', { class: 'muted small' }, i === t.cases.length - 1 && !cs.when ? 'Sinon' : 'Si'), i === t.cases.length - 1 && !cs.when ? null : conditionEditor(w, b, cs.when, (c) => { cs.when = c; if (!c) delete cs.when; set(t); }, 1), h('button', { class: 'icon-btn', 'aria-label': 'Retirer ce cas', onclick: () => { t.cases.splice(i, 1); set(t.cases.length === 1 && !t.cases[0]!.when ? t.cases[0]!.text : t); draw(); } }, '✕')),
          h('textarea', { rows, oninput: (e: Event) => ((cs.text = (e.target as HTMLTextAreaElement).value), set(t)) }, cs.text),
        ),
      ),
      h('button', { class: 'btn small', onclick: () => { t.cases.splice(t.cases.length - 1, 0, { when: undefined, text: '' }); set(t); draw(); } }, '+ Cas'),
    );
  };
  draw();
  return box;
}

// ---------------------------------------------------------------------------
// Boutons et règles
// ---------------------------------------------------------------------------

const STYLES: { value: ButtonStyle; label: string }[] = [
  { value: 'secondary', label: 'Gris' },
  { value: 'primary', label: 'Bleu' },
  { value: 'success', label: 'Vert' },
  { value: 'danger', label: 'Rouge' },
];

/** Éditeur complet d'un bouton : apparence, visibilité, règle (quand → actions → résultat). */
export function buttonEditor(w: WorldDef, b: BuildingDef, btn: ButtonDef, onChange: () => void, sounds: string[] = []): HTMLElement {
  const screens = b.screens.map((s) => ({ value: s.id, label: s.name }));
  const rule: Rule = btn.rule;
  rule.actions ??= [];
  const outcome = (key: 'onSuccess' | 'onFailure', title: string, hint: string) => {
    const o = (rule[key] ??= {});
    return h(
      'div',
      { class: 'outcome' },
      h('h4', null, title),
      h('p', { class: 'muted small' }, hint),
      h(
        'div',
        { class: 'row-fields' },
        selectField('Écran suivant', o.goto ?? '', screens, (v) => (v ? (o.goto = v) : delete o.goto, onChange()), { allowEmpty: 'Rester sur l’écran' }),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Message'), h('input', { value: typeof o.notice === 'string' ? o.notice : '', placeholder: key === 'onSuccess' ? 'Ex. ✅ C’est fait ! {changes}' : 'Par défaut : la raison du refus', oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) o.notice = v; else delete o.notice; onChange(); } })),
      ),
    );
  };
  return h(
    'div',
    { class: 'button-editor form' },
    h(
      'div',
      { class: 'row-fields' },
      typeof btn.label === 'string'
        ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Libellé'), h('input', { value: btn.label, oninput: (e: Event) => ((btn.label = (e.target as HTMLInputElement).value), onChange()) }))
        : h('span', { class: 'muted' }, 'Libellé variable'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Symbole'), h('input', { value: btn.emoji ?? '', oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) btn.emoji = v; else delete btn.emoji; onChange(); } })),
      selectField('Couleur', btn.style ?? 'secondary', STYLES, (v) => ((btn.style = v as ButtonStyle), onChange())),
    ),
    h('h4', null, 'Affiché seulement si'),
    conditionEditor(w, b, btn.visibleIf, (c) => (c ? (btn.visibleIf = c) : delete btn.visibleIf, onChange())),
    h('h4', null, 'Au clic, vérifier que'),
    conditionEditor(w, b, rule.when, (c) => (c ? (rule.when = c) : delete rule.when, onChange())),
    h('h4', null, 'Puis faire'),
    effectsEditor(w, rule.actions, onChange, sounds),
    outcome('onSuccess', 'Si tout réussit', 'Dans le message, {changes} résume les effets (« ⚡ Énergie 70 → 80 »).'),
    outcome('onFailure', 'Si c’est refusé', 'Rien n’est appliqué : les actions sont annulées en bloc.'),
  );
}
