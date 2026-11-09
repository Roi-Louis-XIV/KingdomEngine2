import { h, clear, toast, field, selectField, ago, dateTime } from '../ui.ts';
import { del, get, put } from '../api.ts';
import { can, loadSession, server, state } from '../store.ts';
import { stripMd } from './overview.ts';
import { go, rerender } from '../main.ts';

/** Journal : activité des joueurs et historique des modifications. */
export async function journalPage(main: HTMLElement, params: string[]) {
  const s = server()!;
  const tab = params[0] === 'modifications' ? 'modifications' : 'activite';
  const rows = tab === 'activite' ? await get<any[]>(`/api/servers/${s.id}/activity`) : await get<any[]>(`/api/servers/${s.id}/audit`);
  clear(
    main,
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Journal'))),
      h(
        'div',
        { class: 'tabs', role: 'tablist' },
        h('a', { href: '#/journal/activite', class: tab === 'activite' ? 'on' : '', role: 'tab' }, 'Activité des joueurs'),
        h('a', { href: '#/journal/modifications', class: tab === 'modifications' ? 'on' : '', role: 'tab' }, 'Modifications et interventions'),
      ),
      rows.length
        ? h(
            'ol',
            { class: 'feed big' },
            rows.map((r) =>
              h(
                'li',
                null,
                h('time', { title: dateTime(r.at) }, ago(r.at)),
                tab === 'activite' ? (r.playerName ? h('a', { class: 'who', href: `#/joueur/${r.playerId}` }, r.playerName) : h('span', { class: 'who' }, 'Monde')) : h('span', { class: 'who' }, r.author),
                h('span', null, stripMd(r.text ?? r.summary)),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Rien à afficher pour l’instant.'),
    ),
  );
}

/** Paramètres du serveur : nom, Discord, membres, suppression. */
export async function settingsPage(main: HTMLElement) {
  const s = server()!;
  const owner = can('owner');
  const info = await get(`/api/servers/${s.id}`);
  const f = { name: info.name, guildId: info.guildId ?? '' };
  const member = { username: '', role: 'editor' };
  const ROLES = [
    { value: 'viewer', label: 'Lecture — consulter' },
    { value: 'editor', label: 'Éditeur — modifier et publier le contenu' },
    { value: 'manager', label: 'Gestionnaire — en plus : joueurs, Discord, sons' },
    { value: 'owner', label: 'Propriétaire — en plus : accès et suppression' },
  ];
  clear(
    main,
    h(
      'div',
      { class: 'page narrow' },
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Paramètres du serveur'))),
      h(
        'section',
        { class: 'block form' },
        h('h2', null, 'Identité'),
        field(f, 'name', { label: 'Nom du monde', disabled: !owner }, () => {}),
        field(f, 'guildId', { label: 'Identifiant du serveur Discord', disabled: !owner, hint: 'Mode développeur de Discord, puis clic droit sur le serveur › Copier l’identifiant.' }, () => {}),
        owner
          ? h(
              'button',
              {
                class: 'btn primary',
                onclick: async () => {
                  try {
                    await put(`/api/servers/${s.id}`, { name: f.name, guildId: f.guildId || null });
                    await loadSession();
                    toast('Paramètres enregistrés.');
                    rerender();
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  }
                },
              },
              'Enregistrer',
            )
          : null,
      ),
      owner
        ? h(
            'section',
            { class: 'block form' },
            h('h2', null, 'Accès'),
            h(
              'table',
              { class: 'grid' },
              h(
                'tbody',
                null,
                info.members.map((m: any) =>
                  h(
                    'tr',
                    null,
                    h('td', null, m.displayName, h('small', { class: 'muted' }, ` ${m.username}`)),
                    h('td', null, selectField(null, m.role, ROLES, async (v) => {
                      try {
                        await put(`/api/servers/${s.id}/members`, { username: m.username, role: v });
                        toast('Accès modifié.');
                      } catch (e) {
                        toast((e as Error).message, 'error');
                        void settingsPage(main);
                      }
                    })),
                    h('td', { class: 'r' }, m.username !== state.account?.username ? h('button', { class: 'icon-btn', 'aria-label': `Retirer ${m.username}`, onclick: async () => {
                      await put(`/api/servers/${s.id}/members`, { username: m.username, role: null }).catch((e) => toast(e.message, 'error'));
                      void settingsPage(main);
                    } }, '✕') : null),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { class: 'inline-form' },
              field(member, 'username', { label: 'Identifiant du compte', placeholder: 'louis' }, () => {}),
              selectField('Rôle', member.role, ROLES, (v) => (member.role = v)),
              h('button', { class: 'btn', onclick: async () => {
                try {
                  await put(`/api/servers/${s.id}/members`, member);
                  toast('Accès accordé.');
                  void settingsPage(main);
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
              } }, 'Donner l’accès'),
            ),
          )
        : null,
      owner
        ? h(
            'section',
            { class: 'block danger-zone' },
            h('h2', null, 'Supprimer ce monde'),
            h('p', null, 'Le contenu, les joueurs, leur progression et les sons de ce monde seront définitivement effacés. Les salons Discord ne sont pas supprimés.'),
            h('button', { class: 'btn danger', onclick: async () => {
              const confirmName = prompt(`Pour confirmer, recopie le nom du monde : ${s.name}`);
              if (confirmName === null) return;
              try {
                await del(`/api/servers/${s.id}`, { confirm: confirmName });
                toast('Monde supprimé.');
                localStorage.removeItem('kingdom.server');
                await loadSession();
                go('apercu');
                rerender();
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            } }, 'Supprimer définitivement'),
          )
        : null,
    ),
  );
}
