import { h, clear, toast, field, selectField, modal, slug } from '../ui.ts';
import { api, del, get, post, put } from '../api.ts';
import { can, server } from '../store.ts';

const KINDS = [
  { value: 'ambience', label: 'Ambiance' },
  { value: 'music', label: 'Musique' },
  { value: 'voice', label: 'Voix' },
  { value: 'sfx', label: 'Effet sonore' },
];

/** Médiathèque : sons du serveur, utilisés par les ambiances et les actions. */
export async function mediaPage(main: HTMLElement) {
  const s = server()!;
  const page = h('div', { class: 'page' });
  main.append(page);
  const draw = async () => {
    const { sounds, missing, bundled = [] } = await get(`/api/servers/${s.id}/audio`);
    const manager = can('manager');
    const upload = (key = '') => {
      const f = { name: key, key, kind: 'ambience' };
      let file: File | null = null;
      modal(
        'Importer un son',
        h(
          'div',
          { class: 'form' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Fichier'), h('input', { type: 'file', accept: 'audio/*', onchange: (e: Event) => {
            file = (e.target as HTMLInputElement).files?.[0] ?? null;
            if (file && !f.name) f.name = file.name.replace(/\.[^.]+$/, '');
          } })),
          field(f, 'name', { label: 'Nom' }, () => {}),
          field(f, 'key', { label: 'Clé', placeholder: 'Déduite du nom', hint: 'C’est elle que référencent les bâtiments (ex. taverne-calme).' }, () => {}),
          selectField('Type', f.kind, KINDS, (v) => (f.kind = v)),
        ),
        [
          {
            label: 'Importer',
            onclick: async (close) => {
              if (!file) return toast('Choisis un fichier.', 'error');
              const q = new URLSearchParams({ name: f.name || file.name, kind: f.kind, key: f.key || slug(f.name || file.name) });
              try {
                await api('POST', `/api/servers/${s.id}/audio?${q}`, undefined, { data: file, type: file.type || 'audio/mpeg' });
                toast('Son importé.');
                close();
                void draw();
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            },
          },
        ],
      );
    };
    clear(
      page,
      h(
        'header',
        { class: 'page-head' },
        h('div', null, h('h1', null, 'Médiathèque'), h('p', { class: 'muted' }, 'Les sons joués par les Voice Workers : ambiances, voix, effets. Pour varier un bruitage, importe plusieurs prises numérotées (« foret-hache-1 », « foret-hache-2 »…) : une est tirée au hasard à chaque fois.')),
        manager ? h('button', { class: 'btn primary', onclick: () => upload() }, 'Importer un son') : null,
      ),
      missing.length
        ? h(
            'section',
            { class: 'block' },
            h('h2', null, `Sons attendus par le contenu (${missing.length})`),
            h('p', { class: 'muted' }, 'Ces clés sont utilisées par tes bâtiments mais aucun fichier ne leur correspond. Le jeu fonctionne, en silence.'),
            manager && bundled.length
              ? h(
                  'div',
                  { class: 'callout' },
                  h('p', null, h('b', null, `${bundled.length} de ces sons sont fournis avec le modèle.`), ' Un clic suffit pour les ajouter (les sons que tu as déjà importés ne sont jamais remplacés).'),
                  h(
                    'button',
                    {
                      class: 'btn primary',
                      onclick: async (e: Event) => {
                        (e.target as HTMLButtonElement).disabled = true;
                        try {
                          const r = await post<{ imported: number }>(`/api/servers/${s.id}/audio/from-template`, {});
                          toast(`${r.imported} son${r.imported > 1 ? 's' : ''} importé${r.imported > 1 ? 's' : ''}.`);
                          void draw();
                        } catch (err) {
                          toast((err as Error).message, 'error');
                          (e.target as HTMLButtonElement).disabled = false;
                        }
                      },
                    },
                    `⬇️ Importer les ${bundled.length} sons fournis`,
                  ),
                )
              : null,
            h('ul', { class: 'missing' }, missing.map((k: string) => h('li', null, h('code', null, k), bundled.includes(k) ? h('span', { class: 'tag ok' }, 'fourni') : null, manager ? h('button', { class: 'btn small', onclick: () => upload(k) }, 'Importer') : null))),
          )
        : null,
      sounds.length
        ? h(
            'table',
            { class: 'grid' },
            h('thead', null, h('tr', null, h('th', null, 'Son'), h('th', null, 'Clé'), h('th', null, 'Type'), h('th', null, 'Écoute'), h('th', null, ''))),
            h(
              'tbody',
              null,
              sounds.map((a: any) =>
                h(
                  'tr',
                  null,
                  h('td', null, a.name, h('small', { class: 'muted' }, ` ${(a.size / 1024 / 1024).toFixed(1)} Mo`)),
                  h('td', null, h('code', null, a.key)),
                  h('td', null, manager ? selectField(null, a.kind, KINDS, (v) => void put(`/api/servers/${s.id}/audio/${a.key}`, { kind: v }).then(() => toast('Type modifié.'))) : KINDS.find((k) => k.value === a.kind)?.label),
                  h('td', null, h('audio', { controls: true, preload: 'none', src: `/api/servers/${s.id}/audio/${encodeURIComponent(a.key)}/file` })),
                  h(
                    'td',
                    { class: 'r' },
                    manager
                      ? h(
                          'button',
                          {
                            class: 'icon-btn',
                            'aria-label': `Supprimer ${a.name}`,
                            onclick: async () => {
                              if (!confirm(`Supprimer « ${a.name} » ?`)) return;
                              await del(`/api/servers/${s.id}/audio/${a.key}`);
                              void draw();
                            },
                          },
                          '✕',
                        )
                      : null,
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Aucun son importé pour l’instant.'),
    );
  };
  await draw();
}
