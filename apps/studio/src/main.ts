/** Studio KingdomEngine : coque, navigation et routage. */
import { h, clear, initials, toast, modal, field } from './ui.ts';
import { post, setUnauthorizedHandler } from './api.ts';
import { state, loadSession, selectServer, server, can, subscribe, saveDraft, publish, notify } from './store.ts';
import { authPage, newServerPage } from './pages/auth.ts';
import { overviewPage } from './pages/overview.ts';
import { playersPage, playerPage } from './pages/players.ts';
import { buildingsPage, buildingPage } from './pages/buildings.ts';
import { catalogPage } from './pages/catalog.ts';
import { questsPage } from './pages/quests.ts';
import { testPage, publishPage } from './pages/publish.ts';
import { discordPage } from './pages/discord.ts';
import { mediaPage } from './pages/media.ts';
import { journalPage, settingsPage } from './pages/settings.ts';
import { adminPage } from './pages/admin.ts';
import { livePage } from './pages/live.ts';
import { eventsPage } from './pages/events.ts';
import { profilePage } from './pages/profile.ts';

export type Page = (main: HTMLElement, params: string[]) => void | (() => void) | Promise<void | (() => void)>;

interface NavItem {
  route: string;
  label: string;
  icon: string;
  page: Page;
  min?: 'viewer' | 'editor' | 'manager' | 'owner';
  group: string;
}

const NAV: NavItem[] = [
  { route: 'apercu', label: 'Vue d’ensemble', icon: '◈', page: overviewPage, group: 'Superviser' },
  { route: 'direct', label: 'En direct', icon: '◉', page: livePage, group: 'Superviser' },
  { route: 'joueurs', label: 'Joueurs', icon: '☺', page: playersPage, group: 'Superviser' },
  { route: 'journal', label: 'Journal', icon: '☰', page: journalPage, group: 'Superviser' },
  { route: 'batiments', label: 'Bâtiments', icon: '⌂', page: buildingsPage, group: 'Créer' },
  { route: 'quetes', label: 'Quêtes', icon: '❖', page: questsPage, group: 'Créer' },
  { route: 'catalogue', label: 'Objets & règles', icon: '◇', page: catalogPage, group: 'Créer' },
  { route: 'evenements', label: 'Météo & événements', icon: '☁', page: eventsPage, group: 'Créer' },
  { route: 'tester', label: 'Tester', icon: '▷', page: testPage, group: 'Créer' },
  { route: 'publier', label: 'Publier', icon: '⇪', page: publishPage, group: 'Créer' },
  { route: 'discord', label: 'Discord & voix', icon: '◎', page: discordPage, group: 'Serveur' },
  { route: 'mediatheque', label: 'Médiathèque', icon: '♫', page: mediaPage, group: 'Serveur' },
  { route: 'parametres', label: 'Paramètres', icon: '⚙', page: settingsPage, group: 'Serveur' },
];

const root = document.getElementById('app')!;
let cleanup: (() => void) | void;

function route(): { name: string; params: string[] } {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] ?? 'apercu', params: parts.slice(1) };
}

export function go(path: string) {
  location.hash = '#/' + path;
}

async function render() {
  cleanup?.();
  cleanup = undefined;
  if (!state.account) return clear(root, authPage(() => void boot()));
  const r = route();
  if (r.name === 'profil') return clear(root, shell('profil', async (main) => (cleanup = await profilePage(main))));
  if (r.name === 'nouveau-serveur' || !state.servers.length) return clear(root, shell(null, (main) => newServerPage(main, async (id) => (await loadSession(), selectServer(id), go('apercu')))));
  if (r.name === 'administration' && state.account.platformRole === 'platform_admin') return clear(root, shell('administration', (main) => adminPage(main)));
  const item = NAV.find((n) => n.route === r.name) ?? (r.name === 'joueur' ? { route: 'joueurs', page: playerPage } : r.name === 'batiment' ? { route: 'batiments', page: buildingPage } : NAV[0]!);
  clear(root, shell(item.route, async (main) => (cleanup = await item.page(main, r.params))));
}

function crest(name: string) {
  return h('span', { class: 'crest', 'aria-hidden': 'true' }, initials(name));
}

function shell(active: string | null, mount: (main: HTMLElement) => void): HTMLElement {
  const s = server();
  const main = h('main', { class: 'main entering', id: 'main', tabindex: '-1' });
  // L'animation d'entrée ne joue qu'au changement de page, pas lors des rafraîchissements automatiques.
  setTimeout(() => main.classList.remove('entering'), 900);
  const groups = [...new Set(NAV.map((n) => n.group))];
  const switcher = h(
    'div',
    { class: 'switcher' },
    h(
      'button',
      {
        class: 'switcher-btn',
        'aria-haspopup': 'listbox',
        'aria-label': 'Changer de serveur',
        onclick: (e: Event) => {
          e.stopPropagation();
          switcher.classList.toggle('open');
        },
      },
      s ? crest(s.name) : crest('+'),
      h('span', { class: 'switcher-name' }, h('b', null, s?.name ?? 'Aucun serveur'), h('small', null, s ? roleLabel(s.role) : 'Crée ton premier monde')),
      h('span', { class: 'caret' }, '▾'),
    ),
    h(
      'div',
      { class: 'switcher-menu', role: 'listbox' },
      state.servers.map((x) =>
        h(
          'button',
          {
            class: `switcher-item${x.id === s?.id ? ' on' : ''}`,
            role: 'option',
            'aria-selected': String(x.id === s?.id),
            onclick: () => {
              if (selectServer(x.id)) void render();
            },
          },
          crest(x.name),
          h('span', null, h('b', null, x.name), h('small', null, x.guildId ? `Discord ${x.guildId}` : 'Pas encore relié à Discord')),
        ),
      ),
      h('button', { class: 'switcher-item add', onclick: () => go('nouveau-serveur') }, h('span', { class: 'crest ghost' }, '+'), h('span', null, h('b', null, 'Ajouter un serveur'))),
    ),
  );
  document.onclick = () => switcher.classList.remove('open');

  const nav = h(
    'nav',
    { class: 'rail', 'aria-label': 'Navigation principale' },
    h('a', { class: 'skip', href: '#main' }, 'Aller au contenu'),
    h('div', { class: 'rail-brand' }, h('img', { src: '/assets/logo-kingdomengine.svg', alt: '', width: 26, height: 28 }), h('span', null, 'KingdomEngine')),
    h('div', { class: 'rail-top' }, switcher, h('button', { class: 'btn ghost small menu-toggle', 'aria-label': 'Menu', 'aria-expanded': 'false', onclick: (e: Event) => {
      const rail = (e.currentTarget as HTMLElement).closest('.rail')!;
      const open = rail.classList.toggle('open');
      (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(open));
    } }, 'Menu')),
    s
      ? groups.map((g) =>
          h(
            'div',
            { class: 'nav-group' },
            h('span', { class: 'nav-title' }, g),
            NAV.filter((n) => n.group === g && (!n.min || can(n.min))).map((n) =>
              h('a', { href: `#/${n.route}`, class: `nav-link${n.route === active ? ' on' : ''}`, 'aria-current': n.route === active ? 'page' : null }, h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, n.icon), n.label),
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'rail-foot' },
      state.account?.platformRole === 'platform_admin' ? h('a', { href: '#/administration', class: `nav-link${active === 'administration' ? ' on' : ''}` }, h('span', { class: 'nav-icon' }, '♛'), 'Administration') : null,
      h(
        'a',
        { class: `me${active === 'profil' ? ' on' : ''}`, href: '#/profil', 'aria-label': 'Mon profil', 'aria-current': active === 'profil' ? 'page' : null },
        accountAvatar(state.account!),
        h('span', null, h('b', null, state.account!.displayName), h('small', null, `Mon profil · KingdomEngine ${state.version}`)),
      ),
      h('div', { class: 'rail-signature' }, h('span', null, 'Une création'), h('img', { src: '/assets/logo-payen-studio.png', alt: 'Payen Studio', width: 54, height: 44 })),
    ),
  );
  const bar = saveBar();
  const page = h('div', { class: 'app' }, nav, h('div', { class: 'stage' }, main, bar));
  queueMicrotask(() => mount(main));
  return page;
}

function roleLabel(r: string) {
  return { viewer: 'Lecture', editor: 'Éditeur', manager: 'Gestionnaire', owner: 'Propriétaire' }[r] ?? r;
}

/** Barre qui apparaît dès qu'une modification n'est pas enregistrée. */
function saveBar(): HTMLElement {
  const bar = h('div', { class: 'savebar', role: 'region', 'aria-label': 'Modifications' });
  const draw = () => {
    const d = state.draft;
    const visible = !!d && d.serverId === state.serverId && (d.dirty || d.revision > 0);
    bar.classList.toggle('show', visible);
    if (!d || !visible) return clear(bar);
    const errors = d.issues.filter((i) => i.level === 'error').length;
    clear(
      bar,
      h(
        'span',
        { class: 'savebar-text' },
        d.dirty ? 'Modifications non enregistrées.' : 'Brouillon enregistré, pas encore publié.',
        errors ? h('a', { href: '#/publier', class: 'bad' }, ` ${errors} erreur(s) à corriger.`) : null,
      ),
      d.dirty ? h('button', { class: 'btn', onclick: () => void saveDraft() }, 'Enregistrer le brouillon') : null,
      can('editor') ? h('button', { class: 'btn primary', disabled: errors > 0, onclick: () => void publish() }, 'Publier') : null,
    );
  };
  const off = subscribe(draw);
  draw();
  const obs = new MutationObserver(() => {
    if (!bar.isConnected) {
      off();
      obs.disconnect();
    }
  });
  queueMicrotask(() => obs.observe(document.body, { childList: true, subtree: true }));
  return bar;
}

/** Avatar Discord du compte, sinon ses initiales. */
export function accountAvatar(a: { displayName: string; avatarUrl: string | null }, size = 32) {
  return a.avatarUrl
    ? h('img', { class: 'avatar', src: a.avatarUrl, alt: '', width: size, height: size, style: `width:${size}px;height:${size}px`, referrerpolicy: 'no-referrer' })
    : h('span', { class: 'avatar', 'aria-hidden': 'true', style: `width:${size}px;height:${size}px` }, initials(a.displayName));
}

/** Messages laissés dans l'adresse par le retour de Discord (?erreur=… / ?info=…). */
function flashFromUrl() {
  const q = new URLSearchParams(location.search);
  const err = q.get('erreur');
  const info = q.get('info');
  if (!err && !info) return;
  history.replaceState(null, '', location.pathname + location.hash);
  queueMicrotask(() => (err ? toast(err, 'error') : toast(info!, 'ok')));
}

async function boot() {
  flashFromUrl();
  try {
    await loadSession();
  } catch (e) {
    clear(root, h('div', { class: 'fatal' }, h('h1', null, 'KingdomEngine'), h('p', null, (e as Error).message)));
    return;
  }
  void render();
}

setUnauthorizedHandler(() => {
  state.account = null;
  void render();
});
window.addEventListener('hashchange', () => void render());
window.addEventListener('beforeunload', (e) => {
  if (state.draft?.dirty) e.preventDefault();
});
subscribe(() => document.title = `${server()?.name ? server()!.name + ' · ' : ''}KingdomEngine`);
export const rerender = () => void render();
void notify;
void boot();
