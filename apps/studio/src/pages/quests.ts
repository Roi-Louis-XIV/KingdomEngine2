import type { Action, QuestDef, QuestStep, QuestSystem, WorldDef } from '../../../../packages/engine/src/index.ts';
import { h, clear, emptyState, field, selectField, uniqueId } from '../ui.ts';
import { can, draft, touch } from '../store.ts';
import { conditionEditor, effectsEditor, opts, textEditor } from '../editors.ts';

const STARS = ['', '★', '★★', '★★★'];
const DIFFICULTIES = [
  { value: '1', label: '★ Facile' },
  { value: '2', label: '★★ Moyenne' },
  { value: '3', label: '★★★ Difficile' },
];
const STEP_KINDS = [
  { value: 'visit', label: 'Visiter' },
  { value: 'deliver', label: 'Livrer' },
  { value: 'count', label: 'Faire (compter)' },
];

/** Repères connus du monde : ce que le moteur compte automatiquement, plus les repères posés à la main. */
function knownTags(w: WorldDef): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const name = (id: string) => w.items.find((i) => i.id === id)?.name ?? id;
  for (const b of w.buildings) {
    for (const m of b.modules) {
      if (m.type === 'activity') for (const a of m.activities) out.push({ value: `activity:${b.id}/${a.id}`, label: `${b.name} › terminer « ${a.name} »` });
      if (m.type === 'objective') {
        out.push({ value: `objective:${b.id}/${m.id}`, label: `${b.name} › apporter à « ${m.name} » (par unité)` });
        for (const it of Object.keys(m.goals)) out.push({ value: `objective:${b.id}/${m.id}:${it}`, label: `${b.name} › apporter ${name(it)} à « ${m.name} »` });
      }
      if (m.type === 'shop') {
        out.push({ value: `shop:${b.id}/${m.id}`, label: `${b.name} › acheter à « ${m.name} »` });
        for (const o of m.offers) out.push({ value: `buy:${b.id}/${o.id}`, label: `${b.name} › acheter « ${o.name} »` });
      }
      if (m.type === 'production') for (const r of m.recipes) out.push({ value: `cook:${b.id}/${r.id}`, label: `${b.name} › lancer « ${r.name} »` }, { value: `production:${b.id}/${r.id}`, label: `${b.name} › récupérer « ${r.name} »` });
      if (m.type === 'dialogue') for (const n of m.nodes) out.push({ value: `dialogue:${b.id}/${n.id}`, label: `${b.name} › écouter « ${n.title.replace(/^\S+\s/, '')} »` });
      if (m.type === 'dice') out.push({ value: `dice:${b.id}/${m.id}:win`, label: `${b.name} › gagner aux dés` });
    }
  }
  for (const it of w.items) if (it.consumable) out.push({ value: `consume:${it.id}`, label: `Consommer ${it.name}` });
  out.push({ value: 'repair', label: 'Faire réparer un outil' });
  // Repères posés par l'action « Faire avancer les quêtes ».
  const custom = new Set<string>();
  JSON.stringify(w).replace(/"type":"quest\.tag","tag":"([^"]+)"/g, (_, t: string) => (custom.add(t), ''));
  for (const t of custom) out.push({ value: t, label: `Repère « ${t} »` });
  return out;
}

const describeWindow = (q: QuestDef) => (q.when ? 'disponible sous conditions' : 'toujours disponible');

/** Quêtes personnelles : panneau, niveaux, récompenses, et chaque quête. */
export async function questsPage(main: HTMLElement) {
  const d = await draft();
  const w = d.world;
  const editable = can('editor');
  const redraw = () => void questsPage(main);
  const changed = () => touch();
  const head = h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Quêtes'), h('p', { class: 'muted' }, 'Les joueurs choisissent une quête à la fois sur le panneau des quêtes. Une quête réussie ne revient jamais.')));

  if (!w.quests) {
    clear(
      main,
      h(
        'div',
        { class: 'page' },
        head,
        emptyState(
          'Aucune quête dans ce monde',
          'Active les quêtes : une statistique d’XP sera utilisée pour les niveaux, et un panneau pourra être placé dans un bâtiment (widget « Panneau des quêtes »).',
          editable
            ? {
                label: 'Activer les quêtes',
                onclick: () => {
                  let xp = w.stats.find((s) => s.id === 'xp');
                  if (!xp) w.stats.push((xp = { id: 'xp', name: 'XP', emoji: '⭐', min: 0, initial: 0, kind: 'value', unit: 'XP' }));
                  const money = w.stats.find((s) => s.kind === 'currency')?.id;
                  const reward = (n: number): Action[] => [...(money ? [{ type: 'stat.add' as const, stat: money, amount: 15 * n }] : []), { type: 'stat.add', stat: xp!.id, amount: 10 * n }];
                  w.quests = {
                    xpStat: xp.id,
                    offers: 4,
                    rerollMinutes: 15,
                    levels: [
                      { name: 'Habitant', emoji: '🏠', minXp: 0, weights: [70, 30, 0] },
                      { name: 'Compagnon', emoji: '🛠️', minXp: 100, weights: [30, 50, 20] },
                      { name: 'Notable', emoji: '🎩', minXp: 250, weights: [10, 40, 50] },
                    ],
                    rewards: { 1: reward(1), 2: reward(2), 3: reward(4) },
                    quests: [],
                  };
                  changed();
                  redraw();
                },
              }
            : undefined,
        ),
      ),
    );
    return;
  }
  const sys = w.quests;
  let filter = 0;
  const list = h('div', { class: 'offers' });
  const tags = knownTags(w);

  const drawList = () =>
    clear(
      list,
      sys.quests
        .filter((q) => !filter || q.difficulty === filter)
        .map((q) => questEditor(w, sys, q, tags, changed, () => (sys.quests.splice(sys.quests.indexOf(q), 1), changed(), drawList()))),
      editable
        ? h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                sys.quests.push({ id: uniqueId('quete', sys.quests.map((q) => q.id)), name: 'Nouvelle quête', difficulty: 1, steps: [{ id: 'e1', kind: 'visit', label: 'Visiter un lieu', building: w.buildings[0]?.id }], rewards: [] });
                changed();
                drawList();
                (list.querySelector('details:last-of-type') as HTMLDetailsElement | null)?.setAttribute('open', '');
              },
            },
            '+ Nouvelle quête',
          )
        : null,
    );
  drawList();

  const counts = [1, 2, 3].map((n) => sys.quests.filter((q) => q.difficulty === n).length);
  clear(
    main,
    h(
      'div',
      { class: 'page' },
      head,
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Le panneau'),
        h('div', { class: 'row-fields' }, selectField('Statistique d’XP', sys.xpStat, opts.stats(w), (v) => ((sys.xpStat = v), changed())), field(sys, 'offers', { label: 'Quêtes proposées', type: 'number', min: 1, max: 5 }, changed), field(sys, 'rerollMinutes', { label: 'Délai entre deux nouveaux tirages (min)', type: 'number', min: 0 }, changed)),
        h('p', { class: 'muted' }, 'Pour afficher le panneau, ajoute le widget « Panneau des quêtes » à un écran (par exemple sur la place du village). La fiche du joueur (widget « Fiche du joueur ») montre la quête en cours et le bouton Livrer.'),
      ),
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Niveaux et difficulté'),
        h('p', { class: 'muted' }, 'Selon son XP, un joueur se voit proposer plus ou moins de quêtes difficiles. Les chances sont relatives (70 / 30 / 0 = 70 % faciles, 30 % moyennes, jamais difficiles).'),
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, 'Niveau'), h('th', null, 'Symbole'), h('th', null, 'À partir de (XP)'), h('th', null, '★'), h('th', null, '★★'), h('th', null, '★★★'), h('th', null, ''))),
          h(
            'tbody',
            null,
            sys.levels.map((l, i) =>
              h(
                'tr',
                null,
                h('td', null, h('input', { value: l.name, 'aria-label': 'Nom du niveau', oninput: (e: Event) => ((l.name = (e.target as HTMLInputElement).value), changed()) })),
                h('td', null, h('input', { value: l.emoji ?? '', class: 'num', 'aria-label': 'Symbole', oninput: (e: Event) => ((l.emoji = (e.target as HTMLInputElement).value || undefined), changed()) })),
                h('td', null, h('input', { type: 'number', class: 'num', value: String(l.minXp), 'aria-label': 'XP minimale', oninput: (e: Event) => ((l.minXp = Number((e.target as HTMLInputElement).value) || 0), changed()) })),
                [0, 1, 2].map((k) => h('td', null, h('input', { type: 'number', class: 'num', min: 0, value: String(l.weights[k]), 'aria-label': `Chances ${STARS[k + 1]}`, oninput: (e: Event) => ((l.weights[k] = Math.max(0, Number((e.target as HTMLInputElement).value) || 0)), changed()) }))),
                h('td', null, sys.levels.length > 1 ? h('button', { class: 'icon-btn', 'aria-label': 'Retirer ce niveau', onclick: () => (sys.levels.splice(i, 1), changed(), redraw()) }, '✕') : null),
              ),
            ),
          ),
        ),
        h('button', { class: 'btn small', onclick: () => (sys.levels.push({ name: 'Nouveau niveau', minXp: (sys.levels.at(-1)?.minXp ?? 0) + 200, weights: [10, 30, 60] }), changed(), redraw()) }, '+ Niveau'),
      ),
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Récompenses communes'),
        h('p', { class: 'muted' }, 'Données pour toute quête réussie, selon sa difficulté, en plus de ses récompenses propres.'),
        [1, 2, 3].map((n) => h('div', { class: 'reward-row' }, h('b', null, STARS[n]), effectsEditor(w, ((sys.rewards ??= {})[String(n) as '1'] ??= []), changed))),
      ),
      h(
        'section',
        { class: 'block' },
        h('h2', null, `Les quêtes `, h('span', { class: 'muted' }, `${sys.quests.length} · ★ ${counts[0]} · ★★ ${counts[1]} · ★★★ ${counts[2]}`)),
        h(
          'div',
          { class: 'chips', role: 'tablist' },
          [0, 1, 2, 3].map((n) =>
            h('button', { class: `chip${filter === n ? ' on' : ''}`, onclick: (e: Event) => ((filter = n), (e.currentTarget as HTMLElement).parentElement!.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', i === n)), drawList()) }, n ? STARS[n] : 'Toutes'),
          ),
        ),
        list,
      ),
    ),
  );
}

function questEditor(w: WorldDef, sys: QuestSystem, q: QuestDef, tags: { value: string; label: string }[], changed: () => void, remove: () => void): HTMLElement {
  const summary = h('summary', null);
  const refresh = () => clear(summary, h('span', { class: 'stars' }, STARS[q.difficulty]), ` ${q.emoji ?? '📜'} ${q.name}`, h('span', { class: 'muted' }, ` · ${q.giver ?? 'sans personnage'} · ${q.steps.length} étape(s) · ${describeWindow(q)}`), h('code', { class: 'muted' }, ` ${q.id}`));
  refresh();
  const onChange = () => (changed(), refresh());
  const toggle = (key: 'featured' | 'unique' | 'ordered', label: string, hint: string) =>
    h('label', { class: 'check', title: hint }, h('input', { type: 'checkbox', checked: !!q[key], onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? (q[key] = true) : delete q[key], onChange()) }), label);
  const steps = h('div', { class: 'quest-steps' });
  const drawSteps = (): void => void
    clear(
      steps,
      q.steps.map((s, i): HTMLElement => stepEditor(w, s, tags, onChange, () => (q.steps.splice(i, 1), onChange(), drawSteps()), (next) => ((q.steps[i] = next), onChange(), drawSteps()))),
      h('button', { class: 'btn small', onclick: () => (q.steps.push({ id: uniqueId('e', q.steps.map((s) => s.id)), kind: 'count', label: 'Nouvelle étape', tags: [tags[0]?.value ?? 'mon-repere'], target: 1 }), onChange(), drawSteps()) }, '+ Étape'),
    );
  drawSteps();
  return h(
    'details',
    { class: 'offer quest' },
    summary,
    h(
      'div',
      { class: 'form' },
      h('div', { class: 'row-fields' }, field(q, 'emoji', { label: 'Symbole', placeholder: '📜' }, onChange), field(q, 'name', { label: 'Nom' }, onChange), field(q, 'giver', { label: 'Confiée par', placeholder: 'Edgar' }, onChange), selectField('Difficulté', String(q.difficulty), DIFFICULTIES, (v) => ((q.difficulty = Number(v) as 1), onChange()))),
      h('label', null, 'Description', textEditor(w, undefined, () => q.description ?? '', (t) => ((q.description = t || undefined), onChange()), 2)),
      h('div', { class: 'checks' }, toggle('featured', 'Toujours proposée en premier', 'Idéal pour un tutoriel'), toggle('unique', 'Un seul joueur à la fois', 'Les autres ne la voient pas tant qu’elle est en cours'), toggle('ordered', 'Étapes dans l’ordre', 'Une étape ne compte que lorsque la précédente est faite')),
      h('div', null, h('b', null, 'Disponible quand'), h('p', { class: 'muted small' }, 'Par exemple : minute du scénario ≥ 25. Hors de cette fenêtre, elle n’est plus proposée et une quête en cours est rendue.'), conditionEditor(w, undefined, q.when, (c) => ((q.when = c), onChange()))),
      h('div', null, h('b', null, 'Étapes'), steps),
      h('div', null, h('b', null, 'Récompenses propres'), h('p', { class: 'muted small' }, `En plus des récompenses communes ${STARS[q.difficulty]}.`), effectsEditor(w, q.rewards, onChange)),
      h('label', null, 'Message de réussite', textEditor(w, undefined, () => q.success ?? '', (t) => ((q.success = t || undefined), onChange()), 2)),
      h('button', { class: 'btn ghost danger-text small', onclick: () => confirm(`Supprimer la quête « ${q.name} » ?`) && remove() }, 'Supprimer cette quête'),
    ),
  );
  void sys;
}

function stepEditor(w: WorldDef, s: QuestStep, tags: { value: string; label: string }[], onChange: () => void, remove: () => void, replace: (s: QuestStep) => void): HTMLElement {
  const buildings = w.buildings.map((b) => ({ value: b.id, label: `${b.emoji ?? ''} ${b.name}`.trim() }));
  const label = h('input', { value: s.label, class: 'wide', 'aria-label': 'Libellé affiché au joueur', oninput: (e: Event) => ((s.label = (e.target as HTMLInputElement).value), onChange()) });
  const num = (value: number, set: (n: number) => void, aria: string) => h('input', { type: 'number', class: 'num', min: 1, value: String(value), 'aria-label': aria, oninput: (e: Event) => (set(Math.max(1, Number((e.target as HTMLInputElement).value) || 1)), onChange()) });
  let fields: (HTMLElement | null)[] = [];
  switch (s.kind) {
    case 'visit':
      fields = [selectField(null, s.building ?? '', buildings, (v) => replace(v ? { id: s.id, kind: 'visit', label: s.label, building: v } : { id: s.id, kind: 'visit', label: s.label, count: 3 }), { allowEmpty: 'Plusieurs lieux différents' }), s.building ? null : num(s.count ?? 1, (n) => (s.count = n), 'Nombre de lieux')];
      break;
    case 'deliver':
      fields = [num(s.qty, (n) => (s.qty = n), 'Quantité'), selectField(null, s.item, opts.items(w), (v) => ((s.item = v), onChange())), h('span', { class: 'muted' }, 'à'), selectField(null, s.building, buildings, (v) => ((s.building = v), onChange()))];
      break;
    case 'count': {
      const chosen = h('div', { class: 'tag-list' });
      const drawTags = () =>
        clear(
          chosen,
          s.tags.map((t, i) => h('span', { class: 'chip static' }, tags.find((x) => x.value === t)?.label ?? t, h('button', { class: 'icon-btn', 'aria-label': 'Retirer', onclick: () => (s.tags.splice(i, 1), onChange(), drawTags()) }, '✕'))),
          selectField(null, '', tags.filter((t) => !s.tags.includes(t.value)), (v) => v && (s.tags.push(v), onChange(), drawTags()), { allowEmpty: '+ Ce qui compte…' }),
        );
      drawTags();
      fields = [num(s.target, (n) => (s.target = n), 'Nombre de fois'), h('span', { class: 'muted' }, 'fois :'), chosen];
      break;
    }
  }
  const make = (kind: string): QuestStep =>
    kind === 'deliver'
      ? { id: s.id, kind: 'deliver', label: s.label, item: w.items[0]?.id ?? '', qty: 1, building: w.buildings[0]?.id ?? '' }
      : kind === 'count'
        ? { id: s.id, kind: 'count', label: s.label, tags: [], target: 1 }
        : { id: s.id, kind: 'visit', label: s.label, building: w.buildings[0]?.id };
  return h(
    'div',
    { class: 'quest-step' },
    h('div', { class: 'row-fields' }, selectField(null, s.kind, STEP_KINDS, (v) => replace(make(v))), label, h('button', { class: 'icon-btn', 'aria-label': 'Retirer cette étape', onclick: remove }, '✕')),
    h('div', { class: 'step-fields' }, fields),
  );
}
