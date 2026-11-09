import { h, clear, ago, toast, emptyState } from '../ui.ts';
import { get, post } from '../api.ts';
import { can, server } from '../store.ts';
import { go } from '../main.ts';

/** Vue d'ensemble : santé du monde, alertes, scénario, réserves, postes et activité en direct. */
export async function overviewPage(main: HTMLElement) {
  const s = server()!;
  const page = h('div', { class: 'page' });
  main.append(page);
  let alive = true;

  const draw = async () => {
    let o: any;
    try {
      o = await get(`/api/servers/${s.id}/overview`);
    } catch (e) {
      clear(page, h('p', { class: 'bad' }, (e as Error).message));
      return;
    }
    if (!alive) return;
    const scroll = main.scrollTop;
    clear(
      page,
      h(
        'header',
        { class: 'page-head' },
        h('div', null, h('h1', null, s.name), h('p', { class: 'muted' }, o.published ? `Version ${o.content.published?.version} en ligne` : 'Aucune version publiée', o.discord.guildId ? '' : ' — pas encore relié à Discord')),
        h(
          'dl',
          { class: 'ledger' },
          h('div', null, h('dt', null, 'Joueurs'), h('dd', null, String(o.counts.players))),
          h('div', null, h('dt', null, 'Actifs aujourd’hui'), h('dd', null, String(o.counts.activeToday))),
          h('div', null, h('dt', null, 'Bâtiments'), h('dd', null, String(o.counts.buildings))),
          h('div', null, h('dt', null, 'Objets'), h('dd', null, String(o.counts.items))),
        ),
      ),
      o.alerts.length
        ? h(
            'section',
            { class: 'alerts', 'aria-label': 'Points d’attention' },
            o.alerts.map((a: any) =>
              h(
                'button',
                {
                  class: `alert ${a.level}`,
                  onclick: () => {
                    if (!a.link) return;
                    if (a.link.startsWith('building:')) go(`batiment/${a.link.slice(9)}`);
                    else go(a.link === 'publish' ? 'publier' : a.link);
                  },
                },
                a.text,
              ),
            ),
          )
        : null,
      o.variables.length
        ? h(
            'section',
            { class: 'block' },
            h('h2', null, 'Scénario en cours'),
            o.variables.map((v: any) =>
              h(
                'div',
                { class: 'variable' },
                h('span', { class: 'variable-name' }, v.name),
                v.options
                  ? h(
                      'div',
                      { class: 'segmented', role: 'radiogroup', 'aria-label': v.name },
                      v.options.map((opt: any) =>
                        h(
                          'button',
                          {
                            class: opt.value === v.value ? 'on' : '',
                            role: 'radio',
                            'aria-checked': String(opt.value === v.value),
                            disabled: !can('manager'),
                            title: can('manager') ? 'Change immédiatement le monde pour tous les joueurs' : 'Droit gestionnaire requis',
                            onclick: async () => {
                              if (opt.value === v.value) return;
                              try {
                                await post(`/api/servers/${s.id}/variables`, { variable: v.id, value: opt.value });
                                toast(`${v.name} : ${opt.label}`);
                                void draw();
                              } catch (e) {
                                toast((e as Error).message, 'error');
                              }
                            },
                          },
                          opt.label,
                        ),
                      ),
                    )
                  : h('b', null, String(v.value)),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'columns' },
        h(
          'section',
          { class: 'block' },
          h('h2', null, 'Bâtiments en direct'),
          o.buildings.length
            ? o.buildings.map((b: any) =>
                h(
                  'article',
                  { class: 'live-building' },
                  h('h3', null, h('a', { href: `#/batiment/${b.id}` }, `${b.emoji} ${b.name}`), b.channels.voice ? h('span', { class: 'tag ok' }, 'Discord') : h('span', { class: 'tag' }, 'Sans salon')),
                  b.stations.map((m: any) =>
                    h(
                      'div',
                      { class: 'stations' },
                      m.stations.map((st: any, i: number) =>
                        h(
                          'div',
                          { class: `station ${!st ? 'free' : st.ready ? 'ready' : 'busy'}` },
                          h('span', null, `${m.stationName} ${i + 1}`),
                          h('b', null, !st ? 'Libre' : st.ready ? `${st.recipe} prêt` : `${st.recipe} · ${countdown(st.endsAt)}`),
                          st ? h('small', null, `par ${st.by}`) : null,
                        ),
                      ),
                    ),
                  ),
                  b.objectives.map((ob: any) =>
                    h(
                      'div',
                      { class: 'objective-line' },
                      h('span', null, ob.name),
                      h('span', { class: 'bar', role: 'meter', 'aria-valuenow': ob.percent, 'aria-valuemax': 100, 'aria-label': ob.name }, h('i', { style: `width:${ob.percent}%` })),
                      h('b', null, ob.completed ? 'Atteint' : `${ob.percent} %`),
                      h('small', { class: 'muted' }, `${ob.contributors} contributeur(s)`),
                    ),
                  ),
                  b.stocks.map((inv: any) =>
                    h(
                      'details',
                      { class: 'stock', open: inv.items.some((x: any) => x.urgency === 0) },
                      h('summary', null, inv.name, ' ', h('span', { class: 'muted' }, `${inv.items.filter((x: any) => x.urgency === 0).length} en alerte`)),
                      h(
                        'ul',
                        { class: 'bars' },
                        inv.items.map((it: any) =>
                          h(
                            'li',
                            { class: `u${it.urgency}` },
                            h('span', null, it.name),
                            h('span', { class: 'bar', role: 'meter', 'aria-valuenow': it.qty, 'aria-valuemax': it.target || it.qty, 'aria-label': it.name }, h('i', { style: `width:${Math.min(100, it.target ? (it.qty / it.target) * 100 : 100)}%` })),
                            h('b', null, it.target ? `${it.qty}/${it.target}` : String(it.qty)),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : emptyState('Aucun bâtiment', 'Ce monde est vide pour l’instant.', { label: 'Créer un bâtiment', onclick: () => go('batiments') }),
        ),
        h(
          'section',
          { class: 'block' },
          h('h2', null, 'Activité récente'),
          o.activity.length
            ? h(
                'ol',
                { class: 'feed' },
                o.activity.map((a: any) =>
                  h(
                    'li',
                    null,
                    h('time', { title: new Date(a.at).toLocaleString('fr-FR') }, ago(a.at)),
                    a.playerName ? h('a', { href: `#/joueur/${a.playerId}`, class: 'who' }, a.playerName) : h('span', { class: 'who' }, 'Monde'),
                    h('span', null, stripMd(a.text)),
                  ),
                ),
              )
            : h('p', { class: 'muted' }, 'Rien pour l’instant. Les actions des joueurs apparaîtront ici en direct.'),
        ),
      ),
    );
    main.scrollTop = scroll;
  };
  await draw();
  const timer = setInterval(() => void draw(), 5000);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}

export const stripMd = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/<@(\d+)>/g, '@$1');
const countdown = (t: number) => {
  const s = Math.max(0, Math.round((t - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
