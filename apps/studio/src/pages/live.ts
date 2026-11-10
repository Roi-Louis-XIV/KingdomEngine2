import { h, clear, toast, ago, emptyState, dateTime } from '../ui.ts';
import { get, post } from '../api.ts';
import { can, server } from '../store.ts';
import { stripMd } from './overview.ts';
import { go } from '../main.ts';

const STATUS: Record<string, { label: string; cls: string }> = {
  idle: { label: 'En attente', cls: '' },
  running: { label: 'En cours', cls: 'live' },
  paused: { label: 'En pause', cls: 'warn' },
  finished: { label: 'Terminé', cls: '' },
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
};
const at = (ts: number) => new Date(ts).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Pilotage en direct : météo et événements, avec démarrer / pause / reprendre / arrêter / redémarrer. */
export async function livePage(main: HTMLElement) {
  const s = server()!;
  const page = h('div', { class: 'page' });
  main.append(page);
  const manager = can('manager');
  let data: any;
  let fetchedAt = Date.now();
  let busy = false;
  let minutes = 30;

  const act = async (path: string, body: object, done: string) => {
    if (busy) return;
    busy = true;
    try {
      data = await post(`/api/servers/${s.id}/${path}`, body);
      fetchedAt = Date.now();
      toast(done);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      busy = false;
    }
  };

  const load = async () => {
    data = await get(`/api/servers/${s.id}/live`);
    fetchedAt = Date.now();
    draw();
  };

  /** Heure du serveur estimée (pour des comptes à rebours fluides entre deux requêtes). */
  const now = () => data.now + (Date.now() - fetchedAt);

  const draw = () => {
    if (!data.published) return void clear(page, emptyState('Rien n’est publié', 'Publie le monde pour piloter sa météo et ses événements.', { label: 'Publier', onclick: () => go('publier') }));
    const w = data.weather;
    clear(
      page,
      h(
        'header',
        { class: 'page-head' },
        h('div', null, h('h1', null, 'En direct'), h('p', { class: 'muted' }, `Météo et événements du monde. Heure du monde : ${new Date(now()).toLocaleTimeString('fr-FR', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' })} (${data.timezone}).`)),
        h('button', { class: 'btn ghost', onclick: () => go('evenements') }, 'Modifier la météo et les événements'),
      ),
      manager ? null : h('p', { class: 'note' }, 'Lecture seule : le pilotage demande le droit gestionnaire.'),
      h(
        'section',
        { class: 'weather-panel' },
        w
          ? [
              h(
                'div',
                { class: 'weather-now' },
                h('span', { class: 'weather-label' }, w.label),
                h('span', { class: 'muted' }, w.auto ? `Change dans ${clock(w.until - now())}` : 'Météo figée : elle ne changera pas toute seule'),
                h('span', { class: 'muted small' }, `Depuis ${ago(w.since)}`),
              ),
              h(
                'div',
                { class: 'weather-controls' },
                h(
                  'label',
                  { class: 'switch' },
                  h('input', { type: 'checkbox', checked: w.auto, disabled: !manager, onchange: (e: Event) => void act('weather', { auto: (e.target as HTMLInputElement).checked }, (e.target as HTMLInputElement).checked ? 'Météo automatique reprise.' : 'Météo figée.') }),
                  h('span', null, 'Météo automatique'),
                ),
                h(
                  'div',
                  { class: 'weather-force' },
                  h('span', { class: 'muted small' }, 'Imposer pendant'),
                  h('input', { type: 'number', class: 'num', min: 1, value: String(minutes), 'aria-label': 'Durée en minutes', oninput: (e: Event) => (minutes = Number((e.target as HTMLInputElement).value) || 30) }),
                  h('span', { class: 'muted small' }, 'min :'),
                  data.weatherStates.map((st: any) =>
                    h('button', { class: `chip${st.value === w.value ? ' on' : ''}`, disabled: !manager, onclick: () => void act('weather', { value: st.value, minutes }, `Météo imposée : ${st.label}.`) }, st.label),
                  ),
                ),
              ),
            ]
          : h('p', { class: 'muted' }, 'Aucune météo configurée dans ce monde.'),
      ),
      h('h2', null, 'Événements'),
      data.events.length
        ? h(
            'div',
            { class: 'events' },
            data.events.map((e: any) => {
              const st = STATUS[e.status]!;
              const active = e.status === 'running' || e.status === 'paused';
              const elapsed = e.elapsedMs + (e.status === 'running' ? Date.now() - fetchedAt : 0);
              const pct = e.durationMs ? Math.min(100, (elapsed / e.durationMs) * 100) : 0;
              const DONE: Record<string, string> = { start: 'démarré', pause: 'mis en pause', resume: 'repris', stop: 'arrêté', restart: 'redémarré' };
              const btn = (label: string, cmd: string, kind = '') =>
                h('button', { class: `btn small ${kind}`, disabled: !manager, onclick: () => void act(`events/${e.id}/${cmd}`, {}, `« ${e.name} » ${DONE[cmd]}.`) }, label);
              return h(
                'article',
                { class: `event-card ${st.cls}` },
                h(
                  'header',
                  null,
                  h('span', { class: 'event-emoji', 'aria-hidden': 'true' }, e.emoji),
                  h('div', { class: 'event-title' }, h('h3', null, e.name), h('span', { class: 'muted small' }, `${e.schedule}${e.durationMs ? ` · ${clock(e.durationMs)}` : ' · jusqu’à l’arrêt'}`)),
                  h('span', { class: `pill ${st.cls}` }, st.label),
                ),
                e.description ? h('p', { class: 'muted' }, e.description) : null,
                active
                  ? h(
                      'div',
                      { class: 'event-progress' },
                      h(
                        'div',
                        { class: 'track', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Avancement' },
                        h('i', { style: `width:${e.durationMs ? pct : 100}%` }),
                        e.durationMs ? e.steps.map((sp: any, i: number) => h('span', { class: `marker${i < e.stepsDone ? ' done' : ''}`, style: `left:${Math.min(100, (sp.afterMinutes * 60000 / e.durationMs) * 100)}%`, title: sp.name })) : null,
                      ),
                      h('div', { class: 'progress-legend' }, h('b', null, clock(elapsed)), e.durationMs ? h('span', { class: 'muted' }, ` sur ${clock(e.durationMs)} · reste ${clock(e.durationMs - elapsed)}`) : h('span', { class: 'muted' }, ' écoulées')),
                      e.steps.length ? h('ol', { class: 'steps-mini' }, e.steps.map((sp: any, i: number) => h('li', { class: i < e.stepsDone ? 'done' : '' }, `${sp.afterMinutes} min — ${sp.name}`))) : null,
                    )
                  : h(
                      'p',
                      { class: 'small' },
                      e.nextRunAt ? ['Prochain lancement : ', h('b', null, at(e.nextRunAt))] : h('span', { class: 'muted' }, e.manual ? 'Se lance à la main.' : 'Programmation coupée.'),
                      e.runs ? h('span', { class: 'muted' }, ` · lancé ${e.runs} fois`) : null,
                    ),
                e.lastError ? h('p', { class: 'bad small' }, `Dernière erreur : ${e.lastError}`) : null,
                h(
                  'footer',
                  null,
                  h(
                    'div',
                    { class: 'event-actions' },
                    e.status === 'running' ? [btn('Pause', 'pause'), btn('Arrêter', 'stop', 'danger'), btn('Redémarrer', 'restart')] : null,
                    e.status === 'paused' ? [btn('Reprendre', 'resume', 'primary'), btn('Arrêter', 'stop', 'danger'), btn('Redémarrer', 'restart')] : null,
                    !active ? btn('Démarrer', 'start', 'primary') : null,
                  ),
                  !e.manual
                    ? h(
                        'label',
                        { class: 'switch' },
                        h('input', { type: 'checkbox', checked: e.auto, disabled: !manager, onchange: (ev: Event) => void act(`events/${e.id}/auto`, { enabled: (ev.target as HTMLInputElement).checked }, (ev.target as HTMLInputElement).checked ? 'Programmation activée.' : 'Programmation coupée.') }),
                        h('span', null, 'Programmation automatique'),
                      )
                    : null,
                ),
              );
            }),
          )
        : emptyState('Aucun événement', 'Crée des événements programmés ou manuels dans « Météo & événements ».', { label: 'Créer un événement', onclick: () => go('evenements') }),
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Annonces récentes'),
        h('p', { class: 'muted small' }, data.announceChannel ? 'Publiées aussi dans le salon d’annonces Discord.' : ['Les annonces ne sont pas publiées sur Discord : ', h('a', { href: '#/discord' }, 'choisir un salon d’annonces'), '.']),
        data.announcements?.length
          ? h('ol', { class: 'feed' }, data.announcements.map((a: any) => h('li', null, h('time', { title: dateTime(a.at) }, ago(a.at)), h('span', { class: 'who' }, 'Monde'), h('span', null, stripMd(a.text.replace(/^📣 /, ''))))))
          : h('p', { class: 'muted' }, 'Aucune annonce pour l’instant.'),
      ),
    );
  };

  await load();
  // Comptes à rebours chaque seconde ; données fraîches toutes les 5 s.
  const typing = () => document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'number' && page.contains(document.activeElement);
  const tick = setInterval(() => !busy && !typing() && draw(), 1000);
  const poll = setInterval(() => !typing() && void load().catch(() => {}), 5000);
  return () => {
    clearInterval(tick);
    clearInterval(poll);
  };
}
