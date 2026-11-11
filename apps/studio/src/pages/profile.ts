import { h, clear, toast, modal, field, selectField, ago, dateTime } from '../ui.ts';
import { del, get, post, put, ApiError } from '../api.ts';
import { loadSession, state, type Account } from '../store.ts';
import { accountAvatar, rerender } from '../main.ts';

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: number;
  lastSeen: number;
  ip: string | null;
  device: string;
  method: 'password' | 'discord';
}
interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  access: 'read' | 'draft' | 'publish';
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  expired: boolean;
}
interface Profile {
  account: Account;
  sessions: SessionRow[];
  tokens: TokenRow[];
  accessLevels: Record<TokenRow['access'], string>;
  discordLogin: boolean;
  mcpUrl: string;
}

const ACCESS_HINT: Record<TokenRow['access'], string> = {
  read: 'L’IA lit tes mondes, les vérifie et les essaie. Elle ne change rien.',
  draft: 'L’IA peut aussi modifier les brouillons. Les joueurs ne voient rien tant que tu ne publies pas.',
  publish: 'L’IA peut aussi publier : les joueurs voient ses changements immédiatement.',
};

/** Reconnexion Discord récente demandée (compte sans mot de passe) : on propose de le faire tout de suite. */
function handle(e: unknown) {
  if (e instanceof ApiError && e.data?.reauth) {
    modal('Confirme qu’il s’agit bien de toi', h('p', null, (e as Error).message), [
      { label: 'Me reconnecter avec Discord', onclick: () => void (location.href = '/api/auth/discord/start?next=profil') },
    ]);
    return;
  }
  toast((e as Error).message, 'error');
}

/** Champ « mot de passe actuel » à ajouter aux confirmations, seulement si le compte en a un. */
function confirmField(obj: { password?: string }, a: Account) {
  return a.hasPassword ? field(obj, 'password', { label: 'Ton mot de passe actuel', type: 'password', hint: 'Pour confirmer qu’il s’agit bien de toi.' }, () => {}) : null;
}

/** Mon profil : identité, connexion (Discord, mot de passe), appareils, jetons pour les IA. */
export async function profilePage(main: HTMLElement) {
  const p = await get<Profile>('/api/profile');
  const a = p.account;
  state.account = a;
  const reload = () => void profilePage(main);

  // --- Identité --------------------------------------------------------------
  const ident = { displayName: a.displayName, username: a.username } as { displayName: string; username: string; password?: string };
  const identity = h(
    'section',
    { class: 'block form' },
    h('h2', null, 'Identité'),
    field(ident, 'displayName', { label: 'Nom affiché', hint: 'Visible par les personnes avec qui tu partages un monde.' }, () => {}),
    field(ident, 'username', { label: 'Identifiant de connexion', hint: 'Sert à te connecter sans Discord, et à te donner accès à un monde.' }, () => {}),
    h(
      'button',
      {
        class: 'btn primary',
        onclick: async () => {
          const changingName = (ident.username ?? '').trim() !== a.username;
          const save = async (password?: string) => {
            await put('/api/profile', { displayName: ident.displayName, username: ident.username, password });
            await loadSession();
            toast('Profil enregistré.');
            rerender();
          };
          try {
            if (changingName && a.hasPassword) {
              const c: { password?: string } = {};
              modal('Changer d’identifiant', h('div', { class: 'form' }, h('p', null, `Ton nouvel identifiant sera « ${ident.username} ».`), confirmField(c, a)), [
                { label: 'Confirmer', onclick: async (close) => {
                  try {
                    await save(c.password);
                    close();
                  } catch (e) {
                    handle(e);
                  }
                } },
              ]);
            } else await save();
          } catch (e) {
            handle(e);
          }
        },
      },
      'Enregistrer',
    ),
  );

  // --- Connexion : Discord -------------------------------------------------------
  const discordCard = h(
    'div',
    { class: 'card login-card' },
    h('h3', null, 'Discord'),
    a.discordId
      ? [
          h('p', { class: 'login-who' }, accountAvatar(a, 36), h('span', null, h('b', null, a.discordName ?? 'Compte relié'), h('small', { class: 'muted' }, 'Tu peux te connecter avec Discord.'))),
          h(
            'button',
            {
              class: 'btn small',
              disabled: !a.hasPassword,
              title: a.hasPassword ? null : 'Choisis d’abord un mot de passe, sinon tu ne pourrais plus te connecter.',
              onclick: () => {
                const c: { password?: string } = {};
                modal('Détacher Discord', h('div', { class: 'form' }, h('p', null, 'Tu ne pourras plus te connecter avec Discord, seulement avec ton identifiant et ton mot de passe.'), confirmField(c, a)), [
                  { label: 'Détacher', kind: 'danger', onclick: async (close) => {
                    try {
                      await post('/api/auth/discord/unlink', c);
                      close();
                      toast('Compte Discord détaché.');
                      reload();
                    } catch (e) {
                      handle(e);
                    }
                  } },
                ]);
              },
            },
            'Détacher',
          ),
          a.hasPassword ? null : h('p', { class: 'field-hint' }, 'Pour détacher Discord, choisis d’abord un mot de passe.'),
        ]
      : p.discordLogin
        ? [h('p', { class: 'muted' }, 'Relie ton compte Discord pour te connecter en un clic, sans mot de passe.'), h('a', { class: 'btn primary discord-btn', href: '/api/auth/discord/start?mode=link' }, discordLogo(), 'Relier mon compte Discord')]
        : h('p', { class: 'muted' }, 'La connexion avec Discord n’est pas encore activée sur cette installation (voir docs/DEPLOIEMENT.md).'),
  );

  // --- Connexion : mot de passe ---------------------------------------------------
  const pw = { current: '', password: '', confirm: '' };
  const passwordCard = h(
    'div',
    { class: 'card login-card form' },
    h('h3', null, 'Mot de passe'),
    h('p', { class: 'muted' }, a.hasPassword ? 'Pour changer ton mot de passe, saisis d’abord l’actuel. Tes autres appareils seront déconnectés.' : 'Tu te connectes avec Discord. Un mot de passe te permet aussi de te connecter avec ton identifiant.'),
    a.hasPassword ? field(pw, 'current', { label: 'Mot de passe actuel', type: 'password' }, () => {}) : null,
    field(pw, 'password', { label: a.hasPassword ? 'Nouveau mot de passe' : 'Mot de passe', type: 'password', hint: '8 caractères minimum.' }, () => {}),
    field(pw, 'confirm', { label: 'Retape-le', type: 'password' }, () => {}),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            if ((pw.password ?? '') !== (pw.confirm ?? '')) return toast('Les deux mots de passe ne sont pas identiques.', 'error');
            try {
              await post('/api/auth/password', { current: pw.current, password: pw.password });
              toast(a.hasPassword ? 'Mot de passe modifié. Tes autres appareils ont été déconnectés.' : 'Mot de passe enregistré.');
              reload();
            } catch (e) {
              handle(e);
            }
          },
        },
        a.hasPassword ? 'Changer le mot de passe' : 'Choisir ce mot de passe',
      ),
      a.hasPassword && a.discordId
        ? h('button', { class: 'btn ghost small', onclick: () => {
            const c: { current?: string } = {};
            modal('Se connecter uniquement avec Discord', h('div', { class: 'form' }, h('p', null, 'Ton mot de passe sera supprimé. Tu te connecteras seulement avec Discord.'), field(c, 'current', { label: 'Mot de passe actuel', type: 'password' }, () => {})), [
              { label: 'Supprimer le mot de passe', kind: 'danger', onclick: async (close) => {
                try {
                  await del('/api/profile/password', c);
                  close();
                  toast('Mot de passe supprimé : connexion par Discord uniquement.');
                  reload();
                } catch (e) {
                  handle(e);
                }
              } },
            ]);
          } }, 'Me connecter seulement avec Discord')
        : null,
    ),
  );

  // --- Appareils ------------------------------------------------------------------
  const devices = h(
    'section',
    { class: 'block' },
    h('div', { class: 'section-head' }, h('h2', null, 'Appareils connectés'), p.sessions.length > 1 ? h('button', { class: 'btn small', onclick: async () => {
      try {
        const r = await post('/api/profile/sessions/revoke-others');
        toast(`${r.closed} appareil(s) déconnecté(s).`);
        reload();
      } catch (e) {
        handle(e);
      }
    } }, 'Déconnecter les autres appareils') : null),
    h('p', { class: 'muted' }, 'Si tu ne reconnais pas un appareil, déconnecte-le puis change ton mot de passe.'),
    h(
      'table',
      { class: 'grid' },
      h('thead', null, h('tr', null, h('th', null, 'Appareil'), h('th', null, 'Connexion'), h('th', null, 'Dernière activité'), h('th', null, 'Adresse'), h('th', null, ''))),
      h(
        'tbody',
        null,
        p.sessions.map((s) =>
          h(
            'tr',
            null,
            h('td', null, s.device, s.current ? h('span', { class: 'tag ok' }, 'cet appareil') : null),
            h('td', null, s.method === 'discord' ? 'Discord' : 'Mot de passe', h('small', { class: 'muted' }, ` · ${dateTime(s.createdAt)}`)),
            h('td', { title: dateTime(s.lastSeen) }, ago(s.lastSeen)),
            h('td', { class: 'muted' }, s.ip ?? '—'),
            h(
              'td',
              { class: 'r' },
              s.current
                ? h('button', { class: 'btn ghost small', onclick: logout }, 'Me déconnecter')
                : h('button', { class: 'btn ghost small', onclick: async () => {
                    try {
                      await del(`/api/profile/sessions/${s.id}`);
                      toast('Appareil déconnecté.');
                      reload();
                    } catch (e) {
                      handle(e);
                    }
                  } }, 'Déconnecter'),
            ),
          ),
        ),
      ),
    ),
  );

  // --- Jetons pour les IA (MCP) ---------------------------------------------------
  const tokens = h(
    'section',
    { class: 'block' },
    h('div', { class: 'section-head' }, h('h2', null, 'Jetons d’accès pour les IA'), h('button', { class: 'btn primary small', onclick: () => newToken(p, a, reload) }, 'Créer un jeton')),
    h(
      'p',
      { class: 'muted' },
      'Une IA comme Claude peut construire tes mondes avec toi : elle lit tes mondes, les modifie en brouillon, les vérifie, les essaie, et publie si tu l’autorises. Elle se connecte à KingdomEngine avec un jeton, que tu peux supprimer à tout moment.',
    ),
    p.tokens.length
      ? h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, 'Nom'), h('th', null, 'Accès'), h('th', null, 'Dernière utilisation'), h('th', null, 'Expiration'), h('th', null, ''))),
          h(
            'tbody',
            null,
            p.tokens.map((t) =>
              h(
                'tr',
                null,
                h('td', null, h('b', null, t.name), h('small', { class: 'muted' }, ` ${t.prefix}…`)),
                h('td', null, p.accessLevels[t.access]),
                h('td', null, t.lastUsedAt ? ago(t.lastUsedAt) : h('span', { class: 'muted' }, 'jamais')),
                h('td', null, t.expired ? h('span', { class: 'tag bad' }, 'expiré') : t.expiresAt ? dateTime(t.expiresAt) : h('span', { class: 'muted' }, 'jamais')),
                h('td', { class: 'r' }, h('button', { class: 'btn ghost small', onclick: async () => {
                  if (!confirm(`Supprimer le jeton « ${t.name} » ? L’IA qui l’utilise n’aura plus accès.`)) return;
                  try {
                    await del(`/api/profile/tokens/${t.id}`);
                    toast('Jeton supprimé.');
                    reload();
                  } catch (e) {
                    handle(e);
                  }
                } }, 'Supprimer')),
              ),
            ),
          ),
        )
      : h('p', { class: 'note' }, 'Aucun jeton pour l’instant.'),
    h('p', { class: 'field-hint' }, `Adresse du serveur MCP : ${p.mcpUrl}`),
  );

  // --- Zone dangereuse -------------------------------------------------------------
  const danger = h(
    'section',
    { class: 'block danger-zone' },
    h('h2', null, 'Supprimer mon compte'),
    h('p', null, 'Ton compte, tes appareils connectés et tes jetons seront supprimés. Les mondes que tu partages avec d’autres restent à leurs propriétaires. Si tu es seul propriétaire d’un monde, donne d’abord ce rôle à quelqu’un ou supprime le monde.'),
    h('button', { class: 'btn danger', onclick: () => {
      const c: { confirm?: string; password?: string } = {};
      modal('Supprimer mon compte', h('div', { class: 'form' }, field(c, 'confirm', { label: `Recopie ton identifiant : ${a.username}` }, () => {}), confirmField(c, a)), [
        { label: 'Supprimer définitivement', kind: 'danger', onclick: async (close) => {
          try {
            await del('/api/profile', c);
            close();
            state.account = null;
            state.draft = null;
            location.hash = '';
            rerender();
          } catch (e) {
            handle(e);
          }
        } },
      ]);
    } }, 'Supprimer mon compte'),
  );

  clear(
    main,
    h(
      'div',
      { class: 'page narrow' },
      h(
        'header',
        { class: 'page-head profile-head' },
        h(
          'div',
          { class: 'profile-id' },
          accountAvatar(a, 64),
          h(
            'div',
            null,
            h('h1', null, a.displayName),
            h(
              'p',
              { class: 'muted' },
              `@${a.username}`,
              a.platformRole === 'platform_admin' ? h('span', { class: 'tag ok' }, 'administration') : null,
              ` · compte créé le ${new Date(a.createdAt).toLocaleDateString('fr-FR')}`,
              a.lastLoginAt ? ` · dernière connexion ${ago(a.lastLoginAt)}` : '',
            ),
          ),
        ),
        h('button', { class: 'btn', onclick: logout }, 'Me déconnecter'),
      ),
      identity,
      h('section', { class: 'block' }, h('h2', null, 'Connexion'), h('div', { class: 'two' }, discordCard, passwordCard)),
      devices,
      tokens,
      danger,
    ),
  );
}

async function logout() {
  await post('/api/auth/logout').catch(() => {});
  state.account = null;
  state.draft = null;
  location.hash = '';
  rerender();
}

function newToken(p: Profile, a: Account, reload: () => void) {
  const f: { name: string; access: TokenRow['access']; days: string; password?: string } = { name: 'Claude', access: 'draft', days: '90' };
  const hint = h('p', { class: 'field-hint' }, ACCESS_HINT[f.access]);
  modal(
    'Nouveau jeton pour une IA',
    h(
      'div',
      { class: 'form' },
      field(f, 'name', { label: 'Nom', hint: 'Pour le reconnaître : « Claude Code sur mon PC »…' }, () => {}),
      selectField('Ce que l’IA peut faire', f.access, (Object.keys(p.accessLevels) as TokenRow['access'][]).map((k) => ({ value: k, label: p.accessLevels[k] })), (v) => {
        f.access = v as TokenRow['access'];
        hint.textContent = ACCESS_HINT[f.access];
      }),
      hint,
      selectField('Valable', f.days, [{ value: '30', label: '30 jours' }, { value: '90', label: '90 jours' }, { value: '365', label: '1 an' }, { value: '', label: 'Sans limite' }], (v) => (f.days = v)),
      confirmField(f, a),
    ),
    [
      {
        label: 'Créer le jeton',
        onclick: async (close) => {
          try {
            const r = await post('/api/profile/tokens', { name: f.name, access: f.access, days: f.days === '' ? null : Number(f.days), password: f.password });
            close();
            showToken(r.token, p.mcpUrl);
            reload();
          } catch (e) {
            handle(e);
          }
        },
      },
    ],
  );
}

/** Affiché une seule fois : le jeton complet et la façon de le brancher. */
function showToken(token: string, url: string) {
  const code = (text: string) =>
    h(
      'div',
      { class: 'copy-box' },
      h('pre', null, text),
      h('button', { class: 'btn small', onclick: async (e: Event) => {
        await navigator.clipboard?.writeText(text).catch(() => {});
        (e.currentTarget as HTMLButtonElement).textContent = 'Copié ✓';
      } }, 'Copier'),
    );
  const claudeCode = `claude mcp add --transport http kingdomengine ${url} --header "Authorization: Bearer ${token}"`;
  // Variable d'environnement : évite le bogue des espaces dans les arguments sous Windows.
  const desktop = JSON.stringify({ mcpServers: { kingdomengine: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${KE4_AUTH}', ...(url.startsWith('http://') ? ['--allow-http'] : [])], env: { KE4_AUTH: `Bearer ${token}` } } } }, null, 2);
  modal(
    'Ton jeton est prêt',
    h(
      'div',
      { class: 'form' },
      h('p', { class: 'note' }, 'Copie-le maintenant : il ne sera plus jamais affiché. Ne le partage pas : il donne accès à tes mondes.'),
      code(token),
      h('h3', null, 'Avec Claude Code'),
      code(claudeCode),
      h('h3', null, 'Avec Claude Desktop'),
      h('p', { class: 'field-hint' }, 'Réglages › Développeur › Modifier la configuration, puis ajoute :'),
      code(desktop),
      h('p', { class: 'field-hint' }, 'Demande ensuite à Claude : « Liste mes mondes KingdomEngine et lis le guide de création. »'),
    ),
    [{ label: 'C’est noté', onclick: (close) => close() }],
  );
}

function discordLogo() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute(
    'd',
    'M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.6 19.6 0 0 0-4.9 1.5C.6 9 .0 13.6.3 18.1a19.8 19.8 0 0 0 6 3l1.3-2a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 11.8 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.7-3.4-13.7ZM8.5 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z',
  );
  svg.append(path);
  return svg as unknown as HTMLElement;
}

export { discordLogo };
