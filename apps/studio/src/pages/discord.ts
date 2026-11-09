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
            h('p', null, 'Chaque bâtiment reçoit un salon texte (pour sa commande) et un salon vocal (pour son ambiance).'),
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
            h('p', null, 'Un Voice Worker joue l’ambiance d’un bâtiment occupé sous le nom de son personnage. Deux bâtiments occupés en même temps demandent deux workers installés.'),
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
      h('p', { class: 'muted small' }, 'Les ambiances se règlent dans chaque bâtiment, onglet Audio ; les sons s’importent dans la Médiathèque.'),
    );
  };
  await draw();
  const t = setInterval(() => void draw().catch(() => {}), 10_000);
  return () => clearInterval(t);
}
