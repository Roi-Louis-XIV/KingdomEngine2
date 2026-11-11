import type { Action, WorldDef } from '../../../../packages/engine/src/index.ts';
import { h, clear, ago, toast, modal, emptyState, selectField, dateTime } from '../ui.ts';
import { get, post } from '../api.ts';
import { can, server } from '../store.ts';
import { stripMd } from './overview.ts';

async function world(serverId: string): Promise<WorldDef | null> {
  return (await get(`/api/servers/${serverId}/world`)).world;
}

/** Liste des joueurs, avec recherche. */
export async function playersPage(main: HTMLElement) {
  const s = server()!;
  const [players, w] = await Promise.all([get<any[]>(`/api/servers/${s.id}/players`), world(s.id)]);
  const page = h('div', { class: 'page' });
  const list = h('tbody');
  const currency = w?.stats.find((x) => x.kind === 'currency');
  let q = '';
  const draw = () => {
    const rows = players
      .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    clear(
      list,
      rows.map((p) =>
        h(
          'tr',
          { class: 'clickable', tabindex: '0', onclick: () => (location.hash = `#/joueur/${p.id}`), onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && (location.hash = `#/joueur/${p.id}`) },
          h('td', null, h('span', { class: 'who-cell' }, p.avatarUrl ? h('img', { src: p.avatarUrl, alt: '', class: 'avatar' }) : h('span', { class: 'avatar' }, p.name[0]), p.name)),
          h('td', null, p.activeJobs.map((j: string) => w?.jobs.find((x) => x.id === j)?.name ?? j).join(', ') || h('span', { class: 'muted' }, 'Aucun')),
          currency ? h('td', { class: 'r' }, `${p.stats[currency.id] ?? 0} ${currency.unit ?? ''}`) : null,
          h('td', { class: 'r muted' }, ago(p.lastSeen)),
        ),
      ),
    );
  };
  clear(
    main,
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Joueurs'), h('p', { class: 'muted' }, `${players.length} joueur(s) connu(s) dans ce monde.`))),
      players.length
        ? [
            h('input', { class: 'search', type: 'search', placeholder: 'Rechercher un joueur…', 'aria-label': 'Rechercher un joueur', oninput: (e: Event) => ((q = (e.target as HTMLInputElement).value), draw()) }),
            h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'Joueur'), h('th', null, 'Métier'), currency ? h('th', { class: 'r' }, currency.name) : null, h('th', { class: 'r' }, 'Vu'))), list),
          ]
        : emptyState('Aucun joueur pour l’instant', 'Les joueurs apparaissent ici dès leur première entrée dans un bâtiment sur Discord.'),
    ),
  );
  void page;
  draw();
}

/** Fiche d'un joueur : état complet et interventions. */
export async function playerPage(main: HTMLElement, params: string[]) {
  const s = server()!;
  const pid = params[0]!;
  const w = await world(s.id);
  if (!w) return void clear(main, emptyState('Aucune version publiée', 'Publie le monde pour voir ses joueurs.'));
  const page = h('div', { class: 'page' });
  main.append(page);
  const manager = can('manager');

  const apply = async (actions: Action[], reason?: string) => {
    try {
      const r = await post(`/api/servers/${s.id}/players/${pid}/actions`, { actions, reason });
      toast(r.summary ? `Appliqué : ${stripMd(r.summary)}` : 'Intervention appliquée.');
      await draw();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  /** Petite fenêtre « quantité + motif ». */
  const ask = (title: string, label: string, initial: number, build: (n: number) => Action[]) => {
    const f = { n: initial, reason: '' };
    modal(
      title,
      h(
        'div',
        { class: 'form' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('input', { type: 'number', value: String(initial), oninput: (e: Event) => (f.n = Number((e.target as HTMLInputElement).value)) })),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Motif (journal)'), h('input', { placeholder: 'Ex. compensation après un bug', oninput: (e: Event) => (f.reason = (e.target as HTMLInputElement).value) })),
      ),
      [{ label: 'Appliquer', onclick: async (close) => (close(), await apply(build(f.n), f.reason || undefined)) }],
    );
  };

  const draw = async () => {
    const p = await get(`/api/servers/${s.id}/players/${pid}`);
    const st = p.state;
    const itemName = (id: string) => {
      const i = w.items.find((x) => x.id === id);
      return i ? `${i.emoji ?? ''} ${i.name}` : id;
    };
    const addItem = { item: w.items[0]?.id ?? '' };
    clear(
      page,
      h('a', { href: '#/joueurs', class: 'back' }, '‹ Joueurs'),
      h(
        'header',
        { class: 'page-head' },
        h('div', { class: 'who-cell big' }, p.avatarUrl ? h('img', { src: p.avatarUrl, alt: '', class: 'avatar' }) : h('span', { class: 'avatar' }, p.name[0]), h('div', null, h('h1', null, p.name), h('p', { class: 'muted' }, `Arrivé ${ago(p.firstSeen)} · vu ${ago(p.lastSeen)} · Discord ${pid}`))),
      ),
      manager ? null : h('p', { class: 'note' }, 'Lecture seule : les interventions demandent le droit gestionnaire.'),
      h(
        'div',
        { class: 'columns' },
        h(
          'section',
          { class: 'block' },
          h('h2', null, 'Statistiques'),
          h(
            'table',
            { class: 'grid' },
            h(
              'tbody',
              null,
              w.stats.map((def) =>
                h(
                  'tr',
                  null,
                  h('td', null, `${def.emoji ?? ''} ${def.name}`),
                  h('td', { class: 'r' }, h('b', null, String(st.stats[def.id] ?? def.initial)), def.max ? h('span', { class: 'muted' }, ` / ${def.max}`) : null),
                  manager
                    ? h(
                        'td',
                        { class: 'r actions' },
                        h('button', { class: 'btn small', onclick: () => ask(`Ajouter à ${def.name}`, 'Montant (négatif pour retirer)', 10, (n) => [{ type: 'stat.add', stat: def.id, amount: n }]) }, '±'),
                        h('button', { class: 'btn small', onclick: () => ask(`Fixer ${def.name}`, 'Nouvelle valeur', st.stats[def.id] ?? def.initial, (n) => [{ type: 'stat.set', stat: def.id, value: n }]) }, 'Fixer'),
                      )
                    : null,
                ),
              ),
            ),
          ),
          h('h2', null, 'Métiers'),
          w.jobs.length
            ? h(
                'table',
                { class: 'grid' },
                h(
                  'tbody',
                  null,
                  w.jobs.map((j) => {
                    const prog = st.jobs[j.id];
                    const active = st.activeJobs.includes(j.id);
                    return h(
                      'tr',
                      null,
                      h('td', null, `${j.emoji ?? ''} ${j.name}`, active ? h('span', { class: 'tag ok' }, 'actif') : null),
                      h('td', { class: 'r' }, prog ? `niveau ${prog.level} · ${prog.xp} XP` : h('span', { class: 'muted' }, 'jamais exercé')),
                      manager
                        ? h(
                            'td',
                            { class: 'r actions' },
                            active
                              ? h('button', { class: 'btn small', onclick: () => void apply([{ type: 'job.leave', job: j.id }]) }, 'Retirer')
                              : h('button', { class: 'btn small', onclick: () => void apply([...st.activeJobs.map((x: string) => ({ type: 'job.leave', job: x }) as Action), { type: 'job.join', job: j.id }]) }, 'Attribuer'),
                            h('button', { class: 'btn small', onclick: () => ask(`Niveau de ${j.name}`, 'Niveau', prog?.level ?? 1, (n) => [{ type: 'job.setLevel', job: j.id, level: Math.max(1, n) }]) }, 'Niveau'),
                          )
                        : null,
                    );
                  }),
                ),
              )
            : h('p', { class: 'muted' }, 'Aucun métier dans ce monde.'),
          w.items.some((i) => i.tool && st.items[i.id])
            ? [
                h('h2', null, 'Outils'),
                h(
                  'table',
                  { class: 'grid' },
                  h(
                    'tbody',
                    null,
                    w.items
                      .filter((i) => i.tool && st.items[i.id])
                      .map((i) => {
                        const dur = st.tools?.[i.id] ?? i.tool!.maxDurability;
                        return h(
                          'tr',
                          null,
                          h('td', null, `${i.emoji ?? ''} ${i.name}`),
                          h('td', { class: 'r' }, h('b', { class: dur === 0 ? 'bad' : '' }, `${dur}/${i.tool!.maxDurability}`)),
                          manager && dur < i.tool!.maxDurability ? h('td', { class: 'r' }, h('button', { class: 'btn small', onclick: () => void apply([{ type: 'tool.repair', item: i.id }], 'réparation gratuite') }, 'Réparer')) : h('td'),
                        );
                      }),
                  ),
                ),
              ]
            : null,
          Object.keys(st.activities ?? {}).length
            ? [h('h2', null, 'Activités en cours'), h('ul', { class: 'plain' }, Object.entries(st.activities).map(([k, a]: [string, any]) => h('li', null, `${k.split('/').pop()} — ${a.endsAt > Date.now() ? `fin ${ago(a.endsAt)}` : 'prête à récupérer'}`)))]
            : null,
          h('h2', null, 'Bonus actifs'),
          st.modifiers.filter((m: any) => m.expiresAt > Date.now()).length
            ? h(
                'ul',
                { class: 'plain' },
                st.modifiers
                  .filter((m: any) => m.expiresAt > Date.now())
                  .map((m: any) => h('li', null, `${w.modifiers.find((x) => x.id === m.id)?.name ?? m.id} — expire ${ago(m.expiresAt)}`)),
              )
            : h('p', { class: 'muted' }, 'Aucun.'),
        ),
        h(
          'section',
          { class: 'block' },
          h('h2', null, 'Inventaire'),
          Object.keys(st.items).length
            ? h(
                'table',
                { class: 'grid' },
                h(
                  'tbody',
                  null,
                  Object.entries(st.items).map(([id, q]) =>
                    h(
                      'tr',
                      null,
                      h('td', null, itemName(id)),
                      h('td', { class: 'r' }, h('b', null, String(q))),
                      manager
                        ? h(
                            'td',
                            { class: 'r actions' },
                            h('button', { class: 'btn small', onclick: () => ask(`Retirer : ${itemName(id)}`, 'Quantité', 1, (n) => [{ type: 'item.take', item: id, qty: Math.max(1, n) }]) }, 'Retirer'),
                          )
                        : null,
                    ),
                  ),
                ),
              )
            : h('p', { class: 'muted' }, 'Inventaire vide.'),
          manager && w.items.length
            ? h(
                'div',
                { class: 'inline-form' },
                selectField(null, addItem.item, w.items.map((i) => ({ value: i.id, label: `${i.emoji ?? ''} ${i.name}` })), (v) => (addItem.item = v)),
                h('button', { class: 'btn', onclick: () => ask(`Donner : ${itemName(addItem.item)}`, 'Quantité', 1, (n) => [{ type: 'item.give', item: addItem.item, qty: Math.max(1, n) }]) }, 'Donner'),
              )
            : null,
          h('h2', null, 'Dernières actions'),
          p.activity.length
            ? h('ol', { class: 'feed' }, p.activity.map((a: any) => h('li', null, h('time', { title: dateTime(a.at) }, ago(a.at)), h('span', null, stripMd(a.text)))))
            : h('p', { class: 'muted' }, 'Aucune action enregistrée.'),
        ),
      ),
    );
  };
  await draw();
}
