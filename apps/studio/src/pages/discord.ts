import { h, clear, toast, selectField } from '../ui.ts';
import { get, post, put } from '../api.ts';
import { can, server } from '../store.ts';

/** Connexion Discord : bot principal, salons des bâtiments, Voice Workers. */
export async function discordPage(main: HTMLElement) {
  const s = server()!;
  const page = h('div', { class: 'page' });
  main.append(page);
  const draw = async () => {
    const [d, wres] = await Promise.all([get(`/api/servers/${s.id}/discord`), get(`/api/servers/${s.id}/world`)]);
    const w = wres.world;
    const voiceChannels = d.guild.channels.filter((c: any) => c.type === 'voice').map((c: any) => ({ value: c.id, label: `🔊 ${c.name}` }));
    const textChannels = d.guild.channels.filter((c: any) => c.type === 'text').map((c: any) => ({ value: c.id, label: `# ${c.name}` }));
    const manager = can('manager');
    const step = (done: boolean, title: string, body: unknown) => h('li', { class: `step${done ? ' done' : ''}` }, h('span', { class: 'step-mark', 'aria-label': done ? 'fait' : 'à faire' }, done ? '✓' : ''), h('div', null, h('h3', null, title), body as HTMLElement));
    clear(
      page,
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Discord & voix'), h('p', { class: 'muted' }, 'Relie ce monde à ton serveur Discord, crée les salons des bâtiments et donne-leur une voix.'))),
      h(
        'ol',
        { class: 'steps' },
        step(
          !!s.guildId,
          'Associer le serveur Discord',
          s.guildId ? h('p', null, `Serveur Discord ${s.guildId}. `, h('a', { href: '#/parametres' }, 'Modifier')) : h('p', null, 'Renseigne l’identifiant du serveur dans ', h('a', { href: '#/parametres' }, 'Paramètres'), '.'),
        ),
        step(
          d.guild.inGuild,
          'Inviter le bot KingdomEngine',
          !d.core.configured
            ? h('p', { class: 'note' }, 'Le bot principal n’est pas configuré sur cette installation : l’administrateur doit renseigner KINGDOM_CORE_TOKEN.')
            : !d.core.online
              ? h('p', { class: 'note' }, 'Le bot principal est hors ligne. ', d.core.error ?? '')
              : d.guild.inGuild
                ? h('p', null, `${d.core.tag} est présent sur « ${d.guild.name} » (${d.guild.members} membres).`)
                : h('p', null, d.invite ? h('a', { class: 'btn primary', href: d.invite, target: '_blank', rel: 'noopener' }, `Inviter ${d.core.tag}`) : 'Associe d’abord le serveur Discord.', ' Puis reviens sur cette page.'),
        ),
        step(
          !!w && w.buildings.every((b: any) => d.channels[b.id]?.voice),
          'Créer les salons des bâtiments',
          h(
            'div',
            null,
            h('p', null, 'Chaque bâtiment reçoit sa catégorie, avec un salon vocal (la porte d’entrée, avec son ambiance) et un salon texte en lecture seule, visible seulement par les joueurs présents dans le salon vocal. Le bot y place le panneau d’entrée ; tout se fait au clic, sans commande. Si le monde demande un serment (Objets & règles › Serment), un salon d’arrivée est créé : les bâtiments n’apparaissent qu’après le serment. Place le rôle du bot au-dessus du rôle des habitants dans Discord.'),
            manager && d.guild.inGuild
              ? h(
                  'button',
                  {
                    class: 'btn',
                    onclick: async (e: Event) => {
                      (e.target as HTMLButtonElement).disabled = true;
                      try {
                        await post(`/api/servers/${s.id}/discord/provision`, {});
                        toast('Salons créés ou vérifiés.');
                      } catch (err) {
                        toast((err as Error).message, 'error');
                      }
                      void draw();
                    },
                  },
                  'Créer les salons manquants',
                )
              : null,
            manager && d.guild.inGuild
              ? h(
                  'button',
                  {
                    class: 'btn ghost',
                    title: 'Revérifie les permissions des salons texte, l’accès des joueurs présents et le panneau d’entrée de chaque bâtiment',
                    onclick: async (e: Event) => {
                      (e.target as HTMLButtonElement).disabled = true;
                      try {
                        await post(`/api/servers/${s.id}/discord/sync`, {});
                        toast('Salons remis en ordre : panneaux d’entrée et accès à jour.');
                      } catch (err) {
                        toast((err as Error).message, 'error');
                      }
                      (e.target as HTMLButtonElement).disabled = false;
                    },
                  },
                  'Remettre les salons en ordre',
                )
              : null,
            w?.buildings.length
              ? h(
                  'table',
                  { class: 'grid' },
                  h('thead', null, h('tr', null, h('th', null, 'Bâtiment'), h('th', null, 'Salon texte'), h('th', null, 'Salon vocal'))),
                  h(
                    'tbody',
                    null,
                    w.buildings.map((b: any) => {
                      const ch = d.channels[b.id] ?? {};
                      const save = (patch: object) =>
                        put(`/api/servers/${s.id}/discord/channels`, { building: b.id, ...ch, ...patch })
                          .then(() => toast('Salon associé.'))
                          .catch((err) => toast((err as Error).message, 'error'));
                      return h(
                        'tr',
                        null,
                        h('td', null, `${b.emoji ?? ''} ${b.name}`),
                        h('td', null, d.guild.inGuild && manager ? selectField(null, ch.text ?? '', textChannels, (v) => void save({ text: v }), { allowEmpty: '—' }) : ch.text ?? '—'),
                        h('td', null, d.guild.inGuild && manager ? selectField(null, ch.voice ?? '', voiceChannels, (v) => void save({ voice: v }), { allowEmpty: '—' }) : ch.voice ?? '—'),
                      );
                    }),
                  ),
                )
              : null,
          ),
        ),
        step(
          d.workers.some((x: any) => x.installed),
          'Inviter les Voice Workers',
          h(
            'div',
            null,
            d.voiceAlways
              ? h('p', null, `Ambiance permanente : un Voice Worker reste dans chacun des ${d.voiceNeed} salons vocaux de bâtiments, sous le nom de son personnage. Il en faut ${d.voiceNeed} installés sur ce serveur.`)
              : h('p', null, 'Un Voice Worker joue l’ambiance d’un bâtiment occupé sous le nom de son personnage. Deux bâtiments occupés en même temps demandent deux workers installés.'),
            (() => {
              const installed = d.workers.filter((x: any) => x.installed && x.online).length;
              return d.voiceAlways && installed < d.voiceNeed
                ? h('p', { class: 'note' }, `${installed} Voice Worker(s) en ligne sur ${d.voiceNeed} nécessaires : ${d.voiceNeed - installed} bâtiment(s) resteront silencieux quand personne n’y est. Ajoute des workers (VOICE_WORKER_${d.workers.length + 1}_TOKEN…) puis invite-les.`)
                : null;
            })(),
            !d.ffmpeg && d.workers.length ? h('p', { class: 'note' }, 'FFmpeg est introuvable sur le serveur : la lecture audio ne fonctionnera pas.') : null,
            d.workers.length
              ? h(
                  'table',
                  { class: 'grid' },
                  h('thead', null, h('tr', null, h('th', null, 'Worker'), h('th', null, 'État'), h('th', null, 'Ce serveur'), h('th', null, 'En ce moment'))),
                  h(
                    'tbody',
                    null,
                    d.workers.map((x: any) =>
                      h(
                        'tr',
                        null,
                        h('td', null, x.label, x.tag ? h('small', { class: 'muted' }, ` ${x.tag}`) : null),
                        h('td', null, h('span', { class: `tag ${x.online ? 'ok' : 'bad'}` }, x.online ? 'En ligne' : 'Hors ligne'), x.error ? h('small', { class: 'bad' }, ` ${x.error}`) : null),
                        h('td', null, x.installed ? h('span', { class: 'tag ok' }, 'Installé') : x.inviteUrl && s.guildId ? h('a', { class: 'btn small', href: `${x.inviteUrl}&guild_id=${s.guildId}&disable_guild_select=true`, target: '_blank', rel: 'noopener' }, 'Inviter') : '—'),
                        h('td', null, x.presence && x.presence.serverId === s.id ? `${x.presence.name} · ${x.presence.ambience ?? 'silence'}` : h('span', { class: 'muted' }, 'Libre')),
                      ),
                    ),
                  ),
                )
              : h('p', { class: 'note' }, 'Aucun Voice Worker configuré sur cette installation (variables VOICE_WORKER_1_TOKEN…).'),
            d.unplaced.length ? h('ul', { class: 'issues' }, d.unplaced.map((u: any) => h('li', { class: 'warning' }, h('b', null, u.building), ' — ', u.reason))) : null,
          ),
        ),
      ),
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Salon d’annonces'),
        h('p', { class: 'muted' }, 'Les débuts, étapes et fins d’événements, ainsi que les changements de météo annoncés, y sont publiés.'),
        d.guild.inGuild && manager
          ? selectField(null, d.announceChannel ?? '', textChannels, (v) =>
              void put(`/api/servers/${s.id}/discord/announce`, { channel: v || null })
                .then(() => toast(v ? 'Salon d’annonces enregistré.' : 'Annonces Discord désactivées.'))
                .catch((err) => toast((err as Error).message, 'error')), { allowEmpty: 'Ne pas publier sur Discord' })
          : h('p', { class: 'note' }, 'Disponible une fois le bot présent sur le serveur Discord.'),
      ),
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Salon d’aide'),
        h('p', { class: 'muted' }, 'Le salon où tu accueilles les joueurs bloqués. Dans tous les textes du monde (annonces, écrans, fermeture), {salon.aide} devient un lien cliquable vers ce salon.'),
        d.guild.inGuild && manager
          ? selectField(
              null,
              d.helpChannel ?? '',
              d.guild.channels.filter((c: any) => c.type === 'voice' || c.type === 'text').map((c: any) => ({ value: c.id, label: `${c.type === 'voice' ? '🔊' : '#'} ${c.name}` })),
              (v) =>
                void put(`/api/servers/${s.id}/discord/help`, { channel: v || null })
                  .then(() => toast(v ? 'Salon d’aide enregistré.' : 'Salon d’aide retiré.'))
                  .catch((err) => toast((err as Error).message, 'error')),
              { allowEmpty: 'Aucun' },
            )
          : h('p', { class: 'note' }, 'Disponible une fois le bot présent sur le serveur Discord.'),
      ),
      h('p', { class: 'muted small' }, 'Les ambiances se règlent dans chaque bâtiment, onglet Audio ; les sons s’importent dans la Médiathèque.'),
    );
  };
  await draw();
  const t = setInterval(() => void draw().catch(() => {}), 10_000);
  return () => clearInterval(t);
}
