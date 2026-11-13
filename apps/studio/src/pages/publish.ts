import { h, clear, toast, dateTime, confirmDialog, emptyState } from '../ui.ts';
import { get, post, del } from '../api.ts';
import { can, draft, publish, server, state } from '../store.ts';
import { Emulator } from '../preview.ts';
import { go } from '../main.ts';

/** Tester tout le monde dans l'émulateur, sans rien publier. */
export async function testPage(main: HTMLElement) {
  const d = await draft();
  if (!d.world.buildings.length) return void clear(main, emptyState('Rien à tester', 'Crée d’abord un bâtiment.', { label: 'Créer un bâtiment', onclick: () => go('batiments') }));
  const emu = new Emulator(d.world);
  const page = h(
    'div',
    { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Tester'), h('p', { class: 'muted' }, d.dirty || d.revision ? 'Tu testes ton brouillon : les joueurs ne voient rien tant que tu ne publies pas.' : 'Tu testes la version publiée, avec des joueurs fictifs.'))),
  );
  clear(main, page);
  emu.mount(page);
  return () => emu.destroy();
}

/** Diagnostic, publication et historique des versions. */
export async function publishPage(main: HTMLElement) {
  const s = server()!;
  const d = await draft(true);
  const info = await get(`/api/servers/${s.id}/content`);
  const errors = d.issues.filter((i) => i.level === 'error');
  const warnings = d.issues.filter((i) => i.level === 'warning');
  let note = '';
  clear(
    main,
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Publier'), h('p', { class: 'muted' }, info.published ? `Version ${info.published.version} en ligne depuis le ${dateTime(info.published.publishedAt)}.` : 'Rien n’est encore publié.'))),
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Diagnostic du brouillon'),
        !errors.length && !warnings.length ? h('p', { class: 'ok-text' }, 'Aucun problème détecté.') : null,
        errors.length ? h('ul', { class: 'issues' }, errors.map((i) => h('li', { class: 'error' }, h('b', null, i.where), ' — ', i.message))) : null,
        warnings.length ? h('ul', { class: 'issues' }, warnings.map((i) => h('li', { class: 'warning' }, h('b', null, i.where), ' — ', i.message))) : null,
      ),
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Mettre en ligne'),
        d.revision === 0 && !d.dirty
          ? h('p', { class: 'muted' }, 'Aucune modification depuis la dernière publication.')
          : [
              h('p', null, 'La publication remplace le contenu sur Discord immédiatement. La progression des joueurs est conservée.'),
              h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Note de version (facultatif)'), h('input', { placeholder: 'Ex. nouvelles recettes', oninput: (e: Event) => (note = (e.target as HTMLInputElement).value) })),
              h(
                'div',
                { class: 'inline-form' },
                can('editor') ? h('button', { class: 'btn primary', disabled: errors.length > 0, onclick: async () => (await publish(note || undefined)) && void publishPage(main) }, 'Publier') : null,
                can('editor')
                  ? h(
                      'button',
                      {
                        class: 'btn ghost',
                        onclick: async () => {
                          if (!(await confirmDialog('Abandonner le brouillon ?', 'Toutes les modifications non publiées seront perdues.', 'Abandonner'))) return;
                          await del(`/api/servers/${s.id}/content/draft`);
                          state.draft = null;
                          toast('Brouillon abandonné.');
                          void publishPage(main);
                        },
                      },
                      'Abandonner le brouillon',
                    )
                  : null,
              ),
            ],
      ),
      can('editor') ? await templateSection(s.id, s.template, d.dirty, () => void publishPage(main)) : null,
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Historique'),
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, 'Version'), h('th', null, 'État'), h('th', null, 'Note'), h('th', null, 'Par'), h('th', null, 'Date'), h('th', null, ''))),
          h(
            'tbody',
            null,
            info.versions.map((v: any) =>
              h(
                'tr',
                null,
                h('td', null, String(v.version)),
                h('td', null, h('span', { class: `tag ${v.status === 'published' ? 'ok' : ''}` }, { published: 'En ligne', draft: 'Brouillon', archived: 'Archivée' }[v.status as string] ?? v.status)),
                h('td', null, v.note ?? ''),
                h('td', null, v.author ?? '—'),
                h('td', null, dateTime(v.publishedAt ?? v.updatedAt)),
                h(
                  'td',
                  { class: 'r' },
                  v.status === 'archived' && can('editor')
                    ? h(
                        'button',
                        {
                          class: 'btn small',
                          onclick: async () => {
                            if (d.dirty && !confirm('Le brouillon actuel sera remplacé. Continuer ?')) return;
                            await post(`/api/servers/${s.id}/content/restore`, { version: v.version });
                            state.draft = null;
                            toast(`Version ${v.version} restaurée en brouillon : vérifie-la puis publie.`);
                            void publishPage(main);
                          },
                        },
                        'Restaurer',
                      )
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

/** Reprendre la dernière version d'un modèle (le monde du serveur en est une copie qui ne le suit pas). */
async function templateSection(serverId: string, current: string, dirty: boolean, refresh: () => void): Promise<HTMLElement> {
  const templates = await get<{ id: string; name: string; description: string; buildings: number }[]>('/api/templates');
  let chosen = templates.some((t) => t.id === current) ? current : (templates.find((t) => t.id !== 'vierge')?.id ?? '');
  const mine = templates.find((t) => t.id === current);
  return h(
    'section',
    { class: 'block' },
    h('h2', null, 'Modèle du monde'),
    h(
      'p',
      null,
      mine ? ['Ton monde a été créé à partir du modèle ', h('b', null, `« ${mine.name} »`), '. '] : null,
      'À la création, le modèle est copié : quand le modèle s’enrichit (nouvelles créatures, quêtes, lieux…), ton monde ne change pas tout seul. Ce bouton met la dernière version du modèle dans ton brouillon.',
    ),
    h('p', { class: 'muted' }, 'Les joueurs gardent leur progression, la Médiathèque garde tes sons. Tes propres modifications du contenu sont remplacées, mais ta version actuelle reste dans l’historique (bouton « Restaurer »). Rien ne change sur Discord avant « Publier ».'),
    h(
      'div',
      { class: 'inline-form' },
      h('select', { onchange: (e: Event) => (chosen = (e.target as HTMLSelectElement).value) }, templates.map((t) => h('option', { value: t.id, selected: t.id === chosen }, `${t.name} (${t.buildings} lieux)`))),
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            const t = templates.find((x) => x.id === chosen);
            if (!t) return;
            const msg = dirty ? `Ton brouillon actuel sera remplacé par le modèle « ${t.name} ». ` : '';
            if (!(await confirmDialog('Reprendre le modèle ?', `${msg}Tu pourras tout vérifier (Tester), puis publier.`, 'Reprendre le modèle'))) return;
            await post(`/api/servers/${serverId}/content/from-template`, { template: t.id });
            state.draft = null;
            toast(`Modèle « ${t.name} » mis en brouillon : vérifie-le puis publie.`);
            refresh();
          },
        },
        '🔄 Reprendre la dernière version du modèle',
      ),
    ),
  );
}
