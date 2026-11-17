import { h, clear, toast, field, modal, dateTime, selectField, ago } from '../ui.ts';
import { del, get, post, put } from '../api.ts';
import { state, loadSession } from '../store.ts';

const WEEK = 7 * 24 * 3600 * 1000;
export const isNew = (a: { createdAt: number }) => Date.now() - a.createdAt < WEEK;

const ROLES = [
  { value: 'viewer', label: 'Lecture — consulter' },
  { value: 'editor', label: 'Éditeur — modifier et publier le contenu' },
  { value: 'manager', label: 'Gestionnaire — en plus : joueurs, Discord, sons' },
  { value: 'owner', label: 'Propriétaire — en plus : accès et suppression' },
];

/** Administration de la plateforme : comptes, mondes, connexions Discord. */
export async function adminPage(main: HTMLElement) {
  const o = await get('/api/admin/overview');
  const newAccount = () => {
    const f = { username: '', discordId: '', password: '', displayName: '', platformAdmin: false };
    modal(
      'Nouveau compte',
      h(
        'div',
        { class: 'form' },
        field(f, 'username', { label: 'Identifiant' }, () => {}),
        field(f, 'displayName', { label: 'Nom affiché' }, () => {}),
        field(f, 'discordId', {
          label: 'Identifiant Discord',
          placeholder: '17 à 20 chiffres',
          hint: 'Recommandé : la personne se connecte avec Discord, sans mot de passe. Dans Discord : Mode développeur, puis clic droit sur son nom › Copier l’identifiant.',
        }, () => {}),
        field(f, 'password', { label: 'Mot de passe provisoire', type: 'password', hint: 'Facultatif si l’identifiant Discord est renseigné. Sinon 8 caractères minimum, à transmettre à la personne.' }, () => {}),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e: Event) => (f.platformAdmin = (e.target as HTMLInputElement).checked) }), 'Administrateur de la plateforme'),
      ),
      [{ label: 'Créer', onclick: async (close) => {
        try {
          await post('/api/admin/accounts', f);
          toast('Compte créé.');
          close();
          void adminPage(main);
        } catch (e) {
          toast((e as Error).message, 'error');
        }
      } }],
    );
  };
  clear(
    main,
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Administration'), h('p', { class: 'muted' }, `KingdomEngine ${o.version} · inscriptions ${o.registration ? 'ouvertes' : 'fermées'}`)), h('button', { class: 'btn primary', onclick: newAccount }, 'Nouveau compte')),
      h(
        'div',
        { class: 'columns' },
        h(
          'section',
          { class: 'block' },
          h('h2', null, 'Connexions Discord'),
          h('p', null, 'Bot principal : ', o.core.configured ? h('span', { class: `tag ${o.core.online ? 'ok' : 'bad'}` }, o.core.online ? `En ligne · ${o.core.tag}` : 'Hors ligne') : h('span', { class: 'tag' }, 'Non configuré (KINGDOM_CORE_TOKEN)')),
          h('p', null, `Voice Workers : ${o.workers.filter((w: any) => w.online).length} en ligne sur ${o.workers.length}. FFmpeg : ${o.ffmpeg ? 'disponible' : 'introuvable'}.`),
          o.workers.length ? h('ul', { class: 'plain' }, o.workers.map((w: any) => h('li', null, `${w.label} — ${w.online ? 'en ligne' : 'hors ligne'} · ${w.guilds.length} serveur(s)${w.presence ? ` · joue pour ${w.presence.name}` : ''}`))) : null,
        ),
        h(
          'section',
          { class: 'block' },
          h('h2', null, `Mondes (${o.servers.length})`),
          h('table', { class: 'grid' }, h('tbody', null, o.servers.map((s: any) => h('tr', null, h('td', null, s.name), h('td', { class: 'muted' }, s.guildId ?? 'sans Discord'), h('td', { class: 'r' }, `v${s.content.published?.version ?? '—'} · ${s.members} accès`), h('td', { class: 'r actions' }, s.guildId ? h('button', { class: 'btn small ghost', title: 'Libère le serveur Discord pour le relier à un autre monde', onclick: async () => {
            if (!confirm(`Détacher le serveur Discord ${s.guildId} du monde « ${s.name} » ? Le monde est conservé.`)) return;
            try {
              await put(`/api/servers/${s.id}`, { guildId: null });
              toast('Serveur Discord détaché.');
            } catch (e) {
              toast((e as Error).message, 'error');
            }
            void adminPage(main);
          } }, 'Détacher Discord') : null))))),
        ),
      ),
      o.requests.length
        ? h(
            'section',
            { class: 'block requests' },
            h('h2', null, `Demandes d’accès (${o.requests.length})`),
            h('p', { class: 'muted small' }, 'Ces personnes ont essayé de se connecter avec Discord, mais n’ont pas encore de compte (inscriptions fermées).'),
            h(
              'table',
              { class: 'grid' },
              h(
                'tbody',
                null,
                o.requests.map((q: any) =>
                  h(
                    'tr',
                    null,
                    h('td', null, h('span', { class: 'who-cell' }, q.avatarUrl ? h('img', { src: q.avatarUrl, alt: '', class: 'avatar', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }, q.displayName[0]), h('span', null, h('b', null, q.displayName), h('small', { class: 'muted' }, ` @${q.username}`)))),
                    h('td', { class: 'muted', title: dateTime(q.lastAt) }, `${ago(q.lastAt)}${q.attempts > 1 ? ` · ${q.attempts} essais` : ''}`),
                    h(
                      'td',
                      { class: 'r actions' },
                      h('button', { class: 'btn small primary', onclick: () => acceptRequest(q, o.servers, () => void adminPage(main)) }, 'Créer son compte'),
                      h('button', { class: 'btn small ghost', onclick: async () => {
                        await del(`/api/admin/requests/${q.discordId}`).catch((e) => toast(e.message, 'error'));
                        void adminPage(main);
                      } }, 'Ignorer'),
                    ),
                  ),
                ),
              ),
            ),
          )
        : null,
      h(
        'section',
        { class: 'block' },
        h('h2', null, `Comptes (${o.accounts.length})`),
        h('p', { class: 'muted small' }, o.accounts.filter(isNew).length ? `${o.accounts.filter(isNew).length} compte(s) créé(s) cette semaine, en haut de la liste. Pour qu’une personne voie un monde, donne-lui l’accès.` : 'Les comptes les plus récents sont en haut. Pour qu’une personne voie un monde, donne-lui l’accès.'),
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, 'Compte'), h('th', null, 'Connexion'), h('th', null, 'Rôle'), h('th', null, 'Mondes'), h('th', null, 'Créé'), h('th', null, ''))),
          h(
            'tbody',
            null,
            o.accounts.map((a: any) =>
              h(
                'tr',
                null,
                h('td', null, a.displayName, h('small', { class: 'muted' }, ` ${a.username}`), isNew(a) ? h('span', { class: 'tag ok' }, 'Nouveau') : null),
                h('td', null, [a.discordId ? `Discord${a.discordName ? ` · ${a.discordName}` : ''}` : null, a.hasPassword ? 'mot de passe' : null].filter(Boolean).join(' + ') || '—', a.lastLoginAt ? h('small', { class: 'muted' }, ` · ${dateTime(a.lastLoginAt)}`) : null),
                h('td', null, a.platformRole === 'platform_admin' ? h('span', { class: 'tag ok' }, 'Administrateur') : 'Utilisateur'),
                h('td', null, a.servers ? String(a.servers) : h('span', { class: 'warn-text' }, 'aucun')),
                h('td', { title: dateTime(a.createdAt) }, ago(a.createdAt)),
                h(
                  'td',
                  { class: 'r actions' },
                  o.servers.length && a.platformRole !== 'platform_admin' ? h('button', { class: 'btn small primary', onclick: () => grantAccess(a, o.servers, () => void adminPage(main)) }, 'Donner l’accès') : null,
                  h('button', { class: 'btn small', onclick: () => {
                    const pw = prompt(`Nouveau mot de passe pour ${a.username} (8 caractères minimum) :`);
                    if (pw) void post(`/api/admin/accounts/${a.id}/password`, { password: pw }).then(() => toast('Mot de passe réinitialisé.')).catch((e) => toast(e.message, 'error'));
                  } }, 'Mot de passe'),
                  a.id !== state.account?.id
                    ? h('button', { class: 'btn small ghost danger-text', onclick: async () => {
                        if (!confirm(`Supprimer le compte ${a.username} ? Ses mondes sont conservés.`)) return;
                        await del(`/api/admin/accounts/${a.id}`).catch((e) => toast(e.message, 'error'));
                        void adminPage(main);
                      } }, 'Supprimer')
                    : null,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/** Donne à un compte l'accès à un monde (rôle au choix), sans passer par les paramètres du monde. */
export function grantAccess(a: { username: string; displayName: string }, servers: { id: string; name: string }[], done: () => void) {
  const f = { server: servers[0]!.id, role: 'viewer' };
  modal(
    `Donner l’accès à ${a.displayName}`,
    h(
      'div',
      { class: 'form' },
      selectField('Monde', f.server, servers.map((s) => ({ value: s.id, label: s.name })), (v) => (f.server = v)),
      selectField('Rôle', f.role, ROLES, (v) => (f.role = v)),
      h('p', { class: 'field-hint' }, 'Lecture suffit pour superviser. Gestionnaire permet aussi d’intervenir sur les joueurs et de piloter les événements.'),
    ),
    [{ label: 'Donner l’accès', kind: 'primary', onclick: async (close) => {
      try {
        await put(`/api/servers/${f.server}/members`, { username: a.username, role: f.role });
        toast(`Accès donné à ${a.displayName}.`);
        close();
        await loadSession();
        done();
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    } }],
  );
}

/** Accepte une demande d'accès : crée le compte relié à son Discord et, au choix, lui ouvre un monde. */
export function acceptRequest(q: { discordId: string; displayName: string }, servers: { id: string; name: string }[], done: () => void) {
  const f = { serverId: servers[0]?.id ?? '', role: 'viewer' };
  modal(
    `Créer le compte de ${q.displayName}`,
    h(
      'div',
      { class: 'form' },
      h('p', null, 'Il se connectera avec son compte Discord, sans mot de passe.'),
      selectField('Lui donner accès à', f.serverId, [...servers.map((s) => ({ value: s.id, label: s.name })), { value: '', label: 'Aucun monde pour l’instant' }], (v) => (f.serverId = v)),
      selectField('Rôle', f.role, ROLES, (v) => (f.role = v)),
      h('p', { class: 'field-hint' }, 'Lecture suffit pour superviser. Gestionnaire permet aussi d’intervenir sur les joueurs et de piloter les événements.'),
    ),
    [{ label: 'Créer le compte', kind: 'primary', onclick: async (close) => {
      try {
        await post(`/api/admin/requests/${q.discordId}/accept`, f.serverId ? f : {});
        toast(`Compte de ${q.displayName} créé.`);
        close();
        await loadSession();
        done();
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    } }],
  );
}
