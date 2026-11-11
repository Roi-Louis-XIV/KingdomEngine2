import { h, clear, toast, field, modal, dateTime } from '../ui.ts';
import { del, get, post, put } from '../api.ts';
import { state } from '../store.ts';

/** Administration de la plateforme : comptes, mondes, connexions Discord. */
export async function adminPage(main: HTMLElement) {
  const o = await get('/api/admin/overview');
  const newAccount = () => {
    const f = { username: '', password: '', displayName: '', platformAdmin: false };
    modal(
      'Nouveau compte',
      h(
        'div',
        { class: 'form' },
        field(f, 'username', { label: 'Identifiant' }, () => {}),
        field(f, 'displayName', { label: 'Nom affiché' }, () => {}),
        field(f, 'password', { label: 'Mot de passe provisoire', type: 'password', hint: '8 caractères minimum. À transmettre à la personne.' }, () => {}),
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
      h(
        'section',
        { class: 'block' },
        h('h2', null, `Comptes (${o.accounts.length})`),
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, 'Compte'), h('th', null, 'Rôle'), h('th', null, 'Mondes'), h('th', null, 'Créé'), h('th', null, ''))),
          h(
            'tbody',
            null,
            o.accounts.map((a: any) =>
              h(
                'tr',
                null,
                h('td', null, a.displayName, h('small', { class: 'muted' }, ` ${a.username}`)),
                h('td', null, a.platformRole === 'platform_admin' ? h('span', { class: 'tag ok' }, 'Administrateur') : 'Utilisateur'),
                h('td', null, String(a.servers)),
                h('td', null, dateTime(a.createdAt)),
                h(
                  'td',
                  { class: 'r actions' },
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
