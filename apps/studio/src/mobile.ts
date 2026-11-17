/**
 * Studio mobile : une vue épurée pour superviser depuis un téléphone.
 * Trois onglets (Accueil, En direct, Joueurs), en lecture seule — sauf le pilotage des événements
 * (lancer, arrêter, recommencer). Tout ce qui se crée ou se règle (bâtiments, météo, quêtes…) reste sur ordinateur.
 */
import type { WorldDef } from '../../../packages/engine/src/index.ts';
import { h, clear, toast, ago, initials, confirmDialog } from './ui.ts';
import { get, post, del } from './api.ts';
import { state, server, can, selectServer } from './store.ts';
import { stripMd } from './pages/overview.ts';
import { isNew, grantAccess, acceptRequest } from './pages/admin.ts';

const VIEW_KEY = 'ke-vue';
const narrow = matchMedia('(max-width: 760px)');

/** Vue mobile ? Choix mémorisé de la personne, sinon la largeur de l'écran. */
export function wantsMobile(): boolean {
  let pref: string | null = null;
  try {
    pref = localStorage.getItem(VIEW_KEY);
  } catch {
    /* stockage indisponible */
  }
  if (pref === 'complete') return false;
  if (pref === 'mobile') return true;
  return narrow.matches;
}

export function setView(v: 'mobile' | 'complete' | null) {
  try {
    if (v) localStorage.setItem(VIEW_KEY, v);
    else localStorage.removeItem(VIEW_KEY);
  } catch {
    /* stockage indisponible */
  }
}

export const onNarrowChange = (fn: () => void) => narrow.addEventListener('change', fn);

type Cleanup = (() => void) | void;
type MPage = (main: HTMLElement, params: string[]) => Promise<Cleanup>;

const TABS: { route: string; label: string; icon: string; page: MPage }[] = [
  { route: 'apercu', label: 'Accueil', icon: '◈', page: homePage },
  { route: 'direct', label: 'En direct', icon: '◉', page: livePage },
  { route: 'joueurs', label: 'Joueurs', icon: '☺', page: playersPage },
];

/** Construit l'écran mobile pour la route demandée et renvoie de quoi le nettoyer. */
export function mobileApp(root: HTMLElement, name: string, params: string[], rerender: () => void): Promise<Cleanup> {
  const s = server()!;
  const tab = name === 'joueur' ? 'joueurs' : TABS.some((t) => t.route === name) ? name : null;
  const main = h('main', { class: 'm-main', id: 'main', tabindex: '-1' });
  const menu = h(
    'div',
    { class: 'm-menu', role: 'menu' },
    state.servers.length > 1
      ? [
          h('p', { class: 'm-menu-title' }, 'Changer de serveur'),
          state.servers.map((x) =>
            h('button', { class: `m-menu-item${x.id === s.id ? ' on' : ''}`, role: 'menuitem', onclick: () => selectServer(x.id) && rerender() }, h('span', { class: 'crest' }, initials(x.name)), x.name),
          ),
        ]
      : null,
    state.account!.platformRole === 'platform_admin' ? h('a', { class: 'm-menu-item', role: 'menuitem', href: '#/comptes' }, '👥 Comptes de la plateforme', state.accessRequests ? h('span', { class: 'nav-badge' }, String(state.accessRequests)) : null) : null,
    h('button', { class: 'm-menu-item', role: 'menuitem', onclick: () => (setView('complete'), rerender()) }, '🖥️ Version complète (ordinateur)'),
    h(
      'button',
      {
        class: 'm-menu-item',
        role: 'menuitem',
        onclick: async () => {
          await post('/api/auth/logout').catch(() => {});
          state.account = null;
          location.hash = '';
          rerender();
        },
      },
      '↩ Me déconnecter',
    ),
  );
  const top = h(
    'header',
    { class: 'm-top' },
    h('img', { src: '/assets/logo-kingdomengine.svg', alt: '', width: 22, height: 24 }),
    h('div', { class: 'm-title' }, h('b', null, s.name), h('small', null, `${state.account!.displayName} · ${ROLE[s.role] ?? s.role}`)),
    h(
      'button',
      {
        class: 'm-more',
        'aria-label': 'Menu',
        'aria-haspopup': 'menu',
        onclick: (e: Event) => {
          e.stopPropagation();
          menu.classList.toggle('open');
        },
      },
      '⋯',
    ),
    menu,
  );
  document.onclick = () => menu.classList.remove('open');
  const tabs = h(
    'nav',
    { class: 'm-tabs', 'aria-label': 'Navigation' },
    TABS.map((t) =>
      h('a', { href: `#/${t.route}`, class: `m-tab${t.route === tab ? ' on' : ''}`, 'aria-current': t.route === tab ? 'page' : null }, h('span', { class: 'm-tab-icon', 'aria-hidden': 'true' }, t.icon), t.label),
    ),
  );
  clear(root, h('div', { class: 'm-app' }, top, main, tabs));
  if (name === 'comptes' && state.account!.platformRole === 'platform_admin') return accountsPage(main).catch((e) => void clear(main, h('p', { class: 'm-error' }, (e as Error).message)));
  if (!tab) return Promise.resolve(desktopOnly(main, rerender));
  const page = name === 'joueur' ? playerPage : TABS.find((t) => t.route === tab)!.page;
  return page(main, params).catch((e) => void clear(main, h('p', { class: 'm-error' }, (e as Error).message)));
}

const ROLE: Record<string, string> = { viewer: 'Lecture', editor: 'Éditeur', manager: 'Gestionnaire', owner: 'Propriétaire' };

/** Les pages de création et de réglage ne s'ouvrent pas sur téléphone. */
function desktopOnly(main: HTMLElement, rerender: () => void) {
  clear(
    main,
    h(
      'div',
      { class: 'm-empty' },
      h('span', { class: 'm-empty-icon', 'aria-hidden': 'true' }, '🖥️'),
      h('h2', null, 'À faire sur ordinateur'),
      h('p', null, 'Sur téléphone, on supervise seulement. Bâtiments, météo, quêtes et réglages se modifient depuis un ordinateur.'),
      h('a', { class: 'btn primary block', href: '#/apercu' }, 'Retour à l’accueil'),
      h('button', { class: 'btn ghost block', onclick: () => (setView('complete'), rerender()) }, 'Afficher quand même la version complète'),
    ),
  );
}

/** Rafraîchit une page toutes les `every` ms tant qu'elle est affichée. */
function poll(main: HTMLElement, draw: () => Promise<void> | void, every = 5000): () => void {
  const t = setInterval(() => {
    if (!main.isConnected) return clearInterval(t);
    void Promise.resolve(draw()).catch(() => {});
  }, every);
  return () => clearInterval(t);
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm}:${String(s % 60).padStart(2, '0')}`;
};

// ───────────────────────── Accueil ─────────────────────────

async function homePage(main: HTMLElement): Promise<Cleanup> {
  const s = server()!;
  const draw = async () => {
    const o = await get<any>(`/api/servers/${s.id}/overview`);
    const running = o.live?.running ?? [];
    clear(
      main,
      h(
        'a',
        { class: `m-card m-live${running.length ? ' on' : ''}`, href: '#/direct' },
        h('div', null, h('span', { class: 'm-kicker' }, 'En direct'), running.length ? running.map((e: any) => h('b', { class: 'm-live-name' }, `${e.emoji} ${e.name}${e.status === 'paused' ? ' · en pause' : ''}`)) : h('b', null, 'Aucun événement en cours')),
        o.live?.weather ? h('span', { class: 'm-weather' }, o.live.weather.label) : null,
        h('span', { class: 'm-chevron', 'aria-hidden': 'true' }, '›'),
      ),
      state.accessRequests
        ? h('a', { class: 'm-card m-requests', href: '#/comptes' }, h('b', null, `👥 ${state.accessRequests} demande(s) d’accès`), h('small', null, 'Des personnes attendent que tu crées leur compte.'), h('span', { class: 'm-chevron', 'aria-hidden': 'true' }, '›'))
        : null,
      h(
        'div',
        { class: 'm-stats' },
        h('a', { class: 'm-stat', href: '#/joueurs' }, h('b', null, String(o.counts.players)), h('span', null, 'joueurs')),
        h('div', { class: 'm-stat' }, h('b', null, String(o.counts.activeToday)), h('span', null, 'actifs aujourd’hui')),
        h('div', { class: 'm-stat' }, h('b', null, o.published ? `v${o.content.published?.version}` : '—'), h('span', null, 'version en ligne')),
      ),
      o.alerts.filter((a: any) => a.level === 'error').length
        ? h('section', { class: 'm-alerts' }, o.alerts.filter((a: any) => a.level === 'error').slice(0, 3).map((a: any) => h('p', { class: 'm-alert' }, a.text)))
        : null,
      h('h2', { class: 'm-h2' }, 'Activité récente'),
      o.activity.length
        ? h(
            'ol',
            { class: 'm-feed' },
            o.activity.slice(0, 15).map((a: any) =>
              h(
                'li',
                null,
                h('div', { class: 'm-feed-head' }, a.playerName ? h('a', { href: `#/joueur/${a.playerId}` }, a.playerName) : h('span', null, 'Monde'), h('time', null, ago(a.at))),
                h('p', null, stripMd(a.text)),
              ),
            ),
          )
        : h('p', { class: 'm-muted' }, 'Rien pour l’instant. Les actions des joueurs apparaîtront ici.'),
    );
  };
  await draw();
  return poll(main, draw);
}

// ───────────────────────── En direct ─────────────────────────

const STATUS: Record<string, { label: string; cls: string }> = {
  idle: { label: 'En attente', cls: '' },
  running: { label: 'En cours', cls: 'live' },
  paused: { label: 'En pause', cls: 'warn' },
  finished: { label: 'Terminé', cls: '' },
};

async function livePage(main: HTMLElement): Promise<Cleanup> {
  const s = server()!;
  const manager = can('manager');
  let data: any;
  let fetchedAt = Date.now();
  let busy = false;

  const load = async () => {
    data = await get(`/api/servers/${s.id}/live`);
    fetchedAt = Date.now();
    draw();
  };
  const command = async (e: any, cmd: 'start' | 'stop' | 'restart' | 'resume') => {
    if (busy) return;
    if (cmd === 'stop' && !(await confirmDialog(`Arrêter « ${e.name} » ?`, 'L’événement s’arrête tout de suite pour tous les joueurs.', 'Arrêter'))) return;
    if (cmd === 'restart' && !(await confirmDialog(`Recommencer « ${e.name} » ?`, 'L’événement repart de zéro pour tous les joueurs.', 'Recommencer', 'primary'))) return;
    busy = true;
    try {
      await post(`/api/servers/${s.id}/events/${e.id}/${cmd}`, {});
      toast({ start: `« ${e.name} » lancé.`, stop: `« ${e.name} » arrêté.`, restart: `« ${e.name} » recommencé.`, resume: `« ${e.name} » repris.` }[cmd]);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  };

  const draw = () => {
    if (!data.published) return void clear(main, h('div', { class: 'm-empty' }, h('h2', null, 'Rien n’est publié'), h('p', null, 'Publie le monde depuis un ordinateur pour piloter ses événements.')));
    const w = data.weather;
    const now = data.now + (Date.now() - fetchedAt);
    clear(
      main,
      w ? h('div', { class: 'm-card m-weather-card' }, h('span', { class: 'm-kicker' }, 'Météo'), h('b', null, w.label), h('small', null, w.auto ? `change dans ${clock(w.until - now)}` : 'figée')) : null,
      manager ? null : h('p', { class: 'm-note' }, 'Lecture seule : piloter les événements demande le droit gestionnaire.'),
      h('h2', { class: 'm-h2' }, 'Événements'),
      data.events.length
        ? data.events.map((e: any) => {
            const st = STATUS[e.status]!;
            const active = e.status === 'running' || e.status === 'paused';
            const elapsed = e.elapsedMs + (e.status === 'running' ? Date.now() - fetchedAt : 0);
            const pct = e.durationMs ? Math.min(100, (elapsed / e.durationMs) * 100) : 100;
            const step = active && e.stepsDone ? e.steps[e.stepsDone - 1]?.name : null;
            const btn = (label: string, cmd: 'start' | 'stop' | 'restart' | 'resume', kind: string) => h('button', { class: `btn ${kind}`, disabled: !manager, onclick: () => void command(e, cmd) }, label);
            return h(
              'article',
              { class: `m-card m-event ${st.cls}` },
              h('header', null, h('span', { class: 'm-event-emoji', 'aria-hidden': 'true' }, e.emoji), h('b', null, e.name), h('span', { class: `pill ${st.cls}` }, st.label)),
              active
                ? h(
                    'div',
                    { class: 'm-progress' },
                    h('div', { class: 'm-track', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Avancement' }, h('i', { style: `width:${pct}%` })),
                    h('small', null, e.durationMs ? `${clock(Math.min(elapsed, e.durationMs))} sur ${clock(e.durationMs)}` : `${clock(elapsed)} écoulées`, step ? ` · ${step}` : ''),
                  )
                : e.nextRunAt
                  ? h('small', { class: 'm-muted' }, `Prochain lancement : ${new Date(e.nextRunAt).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`)
                  : null,
              h(
                'div',
                { class: 'm-actions' },
                active
                  ? [e.status === 'paused' ? btn('Reprendre', 'resume', 'primary') : null, btn('Recommencer', 'restart', ''), btn('Arrêter', 'stop', 'danger')]
                  : btn('Lancer', 'start', 'primary'),
              ),
            );
          })
        : h('p', { class: 'm-muted' }, 'Aucun événement dans ce monde.'),
    );
  };

  await load();
  const tick = setInterval(() => !busy && main.isConnected && draw(), 1000);
  const stop = poll(main, load);
  return () => {
    clearInterval(tick);
    stop();
  };
}

// ───────────────────────── Joueurs ─────────────────────────

async function world(serverId: string): Promise<WorldDef | null> {
  return (await get(`/api/servers/${serverId}/world`)).world;
}

async function playersPage(main: HTMLElement): Promise<Cleanup> {
  const s = server()!;
  const w = await world(s.id);
  const currency = w?.stats.find((x) => x.kind === 'currency');
  let players: any[] = [];
  let q = '';
  const list = h('ul', { class: 'm-list' });
  const drawList = () =>
    clear(
      list,
      players
        .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
        .map((p) =>
          h(
            'li',
            null,
            h(
              'a',
              { href: `#/joueur/${p.id}`, class: 'm-row' },
              p.avatarUrl ? h('img', { src: p.avatarUrl, alt: '', class: 'avatar' }) : h('span', { class: 'avatar' }, p.name[0]),
              h('span', { class: 'm-row-main' }, h('b', null, p.name), h('small', null, p.activeJobs.map((j: string) => w?.jobs.find((x) => x.id === j)?.name ?? j).join(', ') || 'Sans métier')),
              h('span', { class: 'm-row-side' }, currency ? h('b', null, `${p.stats[currency.id] ?? 0} ${currency.unit ?? ''}`) : null, h('small', null, ago(p.lastSeen))),
            ),
          ),
        ),
    );
  const load = async () => {
    players = await get<any[]>(`/api/servers/${s.id}/players`);
    drawList();
  };
  await load();
  clear(
    main,
    h('h1', { class: 'm-h1' }, 'Joueurs ', h('span', { class: 'm-count' }, String(players.length))),
    players.length > 6 ? h('input', { class: 'search m-search', type: 'search', placeholder: 'Rechercher un joueur…', 'aria-label': 'Rechercher un joueur', oninput: (e: Event) => ((q = (e.target as HTMLInputElement).value), drawList()) }) : null,
    players.length ? list : h('p', { class: 'm-muted' }, 'Aucun joueur pour l’instant.'),
  );
  return poll(main, load, 10000);
}

/** Fiche d'un joueur, en lecture seule : statistiques, métiers, équipement et sac. */
async function playerPage(main: HTMLElement, params: string[]): Promise<Cleanup> {
  const s = server()!;
  const pid = params[0]!;
  const w = await world(s.id);
  if (!w) return void clear(main, h('p', { class: 'm-muted' }, 'Aucune version publiée.'));
  const draw = async () => {
    const p = await get<any>(`/api/servers/${s.id}/players/${pid}`);
    const st = p.state;
    const owned = w.items.filter((i) => (st.items[i.id] ?? 0) > 0);
    const gear = owned.filter((i) => i.equipment);
    const bag = owned.filter((i) => !i.equipment);
    const jobs = w.jobs.filter((j) => st.jobs[j.id]).sort((a, b) => Number(st.activeJobs.includes(b.id)) - Number(st.activeJobs.includes(a.id)));
    const running = Object.values(st.activities ?? {}).filter((a: any) => a.endsAt > Date.now()).length;
    clear(
      main,
      h('a', { href: '#/joueurs', class: 'm-back' }, '‹ Joueurs'),
      h(
        'header',
        { class: 'm-player-head' },
        p.avatarUrl ? h('img', { src: p.avatarUrl, alt: '', class: 'avatar' }) : h('span', { class: 'avatar' }, p.name[0]),
        h('div', null, h('h1', { class: 'm-h1' }, p.name), h('small', { class: 'm-muted' }, `vu ${ago(p.lastSeen)}${running ? ` · ${running} travail(aux) en cours` : ''}`)),
      ),
      h(
        'section',
        { class: 'm-card' },
        // Moins d'infos : les simples compteurs à zéro ne s'affichent pas.
        w.stats.filter((d) => d.kind === 'gauge' || d.kind === 'currency' || (st.stats[d.id] ?? d.initial)).map((d) => {
            const v = st.stats[d.id] ?? d.initial;
            return h(
              'div',
              { class: 'm-statline' },
              h('span', null, `${d.emoji ?? ''} ${d.name}`),
              d.kind === 'gauge' && d.max ? h('span', { class: 'm-track small', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.min(100, (v / d.max) * 100)}%` })) : h('span'),
              h('b', null, d.kind === 'gauge' && d.max ? `${v}/${d.max}` : String(v)),
            );
          }),
      ),
      jobs.length
        ? [
            h('h2', { class: 'm-h2' }, 'Métiers'),
            h(
              'section',
              { class: 'm-card' },
              jobs.map((j) =>
                h('div', { class: 'm-statline' }, h('span', null, `${j.emoji ?? ''} ${j.name}`), st.activeJobs.includes(j.id) ? h('span', { class: 'tag ok' }, 'actuel') : h('span'), h('b', null, `niv. ${st.jobs[j.id].level}`)),
              ),
            ),
          ]
        : null,
      gear.length ? [h('h2', { class: 'm-h2' }, 'Équipement'), h('ul', { class: 'm-chips' }, gear.map((i) => h('li', null, `${i.emoji ?? '•'} ${i.name}`)))] : null,
      h('h2', { class: 'm-h2' }, 'Sac'),
      bag.length ? h('ul', { class: 'm-chips' }, bag.map((i) => h('li', null, `${i.emoji ?? '•'} ${i.name} `, h('b', null, `×${st.items[i.id]}`)))) : h('p', { class: 'm-muted' }, 'Sac vide.'),
      p.activity?.length
        ? [
            h('h2', { class: 'm-h2' }, 'Dernières actions'),
            h('ol', { class: 'm-feed' }, p.activity.slice(0, 8).map((a: any) => h('li', null, h('div', { class: 'm-feed-head' }, h('span', null, ''), h('time', null, ago(a.at))), h('p', null, stripMd(a.text))))),
          ]
        : null,
    );
  };
  await draw();
  return poll(main, draw, 10000);
}

// ───────────────────────── Comptes (administrateur) ─────────────────────────

/** Comptes de la plateforme, les plus récents en haut, avec « Donner l'accès » à un monde. */
async function accountsPage(main: HTMLElement): Promise<Cleanup> {
  const draw = async () => {
    const o = await get<any>('/api/admin/overview');
    state.accessRequests = o.requests.length;
    const fresh = o.accounts.filter(isNew).length;
    clear(
      main,
      o.requests.length
        ? [
            h('h1', { class: 'm-h1' }, 'Demandes d’accès ', h('span', { class: 'm-count' }, String(o.requests.length))),
            h('p', { class: 'm-muted' }, 'Connexions Discord refusées : ces personnes n’ont pas encore de compte.'),
            h(
              'ul',
              { class: 'm-list' },
              o.requests.map((q: any) =>
                h(
                  'li',
                  null,
                  h(
                    'div',
                    { class: 'm-row' },
                    q.avatarUrl ? h('img', { src: q.avatarUrl, alt: '', class: 'avatar', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }, initials(q.displayName)),
                    h('span', { class: 'm-row-main' }, h('b', null, q.displayName), h('small', null, `@${q.username} · ${ago(q.lastAt)}${q.attempts > 1 ? ` · ${q.attempts} essais` : ''}`)),
                    h('button', { class: 'btn small primary', onclick: () => acceptRequest(q, o.servers, () => void draw()) }, 'Créer'),
                    h('button', { class: 'btn small ghost', 'aria-label': `Ignorer ${q.displayName}`, onclick: async () => {
                      await del(`/api/admin/requests/${q.discordId}`).catch((e) => toast(e.message, 'error'));
                      void draw();
                    } }, '✕'),
                  ),
                ),
              ),
            ),
          ]
        : null,
      h('h1', { class: 'm-h1' }, 'Comptes ', h('span', { class: 'm-count' }, String(o.accounts.length))),
      h('p', { class: 'm-muted' }, fresh ? `${fresh} nouveau(x) cette semaine. Un compte sans monde ne voit rien tant que tu ne lui donnes pas l’accès.` : 'Un compte sans monde ne voit rien tant que tu ne lui donnes pas l’accès.'),
      h(
        'ul',
        { class: 'm-list' },
        o.accounts.map((a: any) =>
          h(
            'li',
            null,
            h(
              'div',
              { class: 'm-row' },
              a.avatarUrl ? h('img', { src: a.avatarUrl, alt: '', class: 'avatar', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }, initials(a.displayName)),
              h(
                'span',
                { class: 'm-row-main' },
                h('b', null, a.displayName, isNew(a) ? h('span', { class: 'tag ok' }, 'Nouveau') : null),
                h('small', null, `${a.discordName ? `Discord · ${a.discordName}` : a.username} · créé ${ago(a.createdAt)}`),
                h('small', { class: a.servers ? '' : 'warn-text' }, a.servers ? `${a.servers} monde(s)` : 'Aucun monde'),
              ),
              o.servers.length && a.platformRole !== 'platform_admin' ? h('button', { class: 'btn small primary', onclick: () => grantAccess(a, o.servers, () => void draw()) }, 'Accès') : null,
            ),
          ),
        ),
      ),
    );
  };
  await draw();
  return poll(main, draw, 15000);
}
