import type { Block, BuildingDef, ModuleDef, ScreenDef, WidgetDef, WorldDef, SoundChoice } from '../../../../packages/engine/src/index.ts';
import { h, clear, field, selectField, toast, modal, confirmDialog, emptyState, uniqueId } from '../ui.ts';
import { get } from '../api.ts';
import { can, draft, server, state, touch } from '../store.ts';
import { effectsEditor, qtyMapEditor, opts, variableCondition } from '../editors.ts';
import { Emulator } from '../preview.ts';
import { go } from '../main.ts';

const MODULE_TYPES: { type: ModuleDef['type']; label: string; text: string }[] = [
  { type: 'inventory', label: 'Réserve', text: 'Un stock partagé du bâtiment, avec des objectifs indicatifs.' },
  { type: 'shop', label: 'Boutique', text: 'Vendre des articles sur place (effets immédiats) ou à emporter.' },
  { type: 'buyback', label: 'Rachat', text: 'Acheter des ressources aux joueurs à un prix qui suit les besoins.' },
  { type: 'production', label: 'Atelier de production', text: 'Postes partagés, recettes par niveau, durée et expérience.' },
  { type: 'dialogue', label: 'Dialogue', text: 'Un personnage avec des sujets de conversation.' },
  { type: 'dice', label: 'Jeu de dés', text: 'Un duel de dés contre un personnage.' },
];
const moduleLabel = (t: string) => MODULE_TYPES.find((m) => m.type === t)?.label ?? t;

/** Liste des bâtiments. */
export async function buildingsPage(main: HTMLElement) {
  const d = await draft();
  const w = d.world;
  const create = () => {
    const f = { name: '', emoji: '🏠' };
    modal(
      'Nouveau bâtiment',
      h('div', { class: 'form' }, field(f, 'name', { label: 'Nom', required: true, placeholder: 'La Forge' }, () => {}), field(f, 'emoji', { label: 'Symbole' }, () => {})),
      [
        {
          label: 'Créer',
          onclick: (close) => {
            if (!f.name.trim()) return toast('Donne un nom au bâtiment.', 'error');
            const id = uniqueId(f.name, w.buildings.map((b) => b.id));
            w.buildings.push(blankBuilding(id, f.name.trim(), f.emoji));
            touch();
            close();
            go(`batiment/${id}`);
          },
        },
      ],
    );
  };
  clear(
    main,
    h(
      'div',
      { class: 'page' },
      h(
        'header',
        { class: 'page-head' },
        h('div', null, h('h1', null, 'Bâtiments'), h('p', { class: 'muted' }, 'Chaque bâtiment est une interface Discord : des modules (boutique, atelier, dialogue…) et des écrans.')),
        can('editor') ? h('button', { class: 'btn primary', onclick: create }, 'Nouveau bâtiment') : null,
      ),
      w.buildings.length
        ? h(
            'div',
            { class: 'cards' },
            w.buildings.map((b) =>
              h(
                'a',
                { class: 'card building-card', href: `#/batiment/${b.id}` },
                h('span', { class: 'big-emoji', 'aria-hidden': 'true' }, b.emoji ?? '🏠'),
                h('b', null, b.name),
                h('span', { class: 'muted' }, b.npc ? `Tenu par ${b.npc.name}` : 'Sans personnage'),
                h('span', { class: 'chips' }, b.modules.map((m) => h('span', { class: 'chip static' }, moduleLabel(m.type)))),
                h('small', { class: 'muted' }, `${b.screens.length} écran(s)`),
              ),
            ),
          )
        : emptyState('Aucun bâtiment', 'Crée ton premier bâtiment : il deviendra une commande Discord.', can('editor') ? { label: 'Nouveau bâtiment', onclick: create } : undefined),
    ),
  );
}

function blankBuilding(id: string, name: string, emoji: string): BuildingDef {
  return {
    id,
    name,
    emoji,
    accentColor: 0x6fb59a,
    modules: [],
    homeScreen: 'accueil',
    screens: [
      {
        id: 'accueil',
        name: 'Accueil',
        blocks: [{ type: 'container', children: [{ type: 'text', text: `## ${emoji} ${name}\n*Bienvenue, {player} !*` }] }, { type: 'notice' }],
      },
    ],
  };
}

function defaultModule(type: ModuleDef['type'], b: BuildingDef, w: WorldDef): ModuleDef {
  const id = uniqueId(moduleLabel(type), b.modules.map((m) => m.id));
  const inv = b.modules.find((m) => m.type === 'inventory')?.id ?? '';
  const cur = w.stats.find((s) => s.kind === 'currency')?.id ?? w.stats[0]?.id ?? '';
  switch (type) {
    case 'inventory':
      return { type, id, name: 'Réserve', emoji: '📦', initial: {}, targets: {} };
    case 'shop':
      return { type, id, name: 'Boutique', inventory: inv, currency: cur, offers: [] };
    case 'buyback':
      return { type, id, name: 'Rachat', inventory: inv, currency: cur, prices: {}, emptyFactor: 1.5, tiers: [{ maxRatio: 0.25, factor: 1.3 }, { maxRatio: 0.5, factor: 1.15 }, { maxRatio: 0.8, factor: 1 }], aboveFactor: 0.8, quantities: [1, 5, 10] };
    case 'production':
      return { type, id, name: 'Atelier', stationName: 'Poste', stationCount: 2, inputInventory: inv, outputInventory: inv, xp: { start: 10, collect: 5 }, recipes: [] };
    case 'dialogue':
      return { type, id, name: 'Discussion', speaker: { name: b.npc?.name ?? 'Personnage', emoji: '💬' }, start: 'accueil', nodes: [{ id: 'accueil', title: '💬 Discussion', lines: ['« Bonjour, voyageur ! »'], choices: [] }] };
    case 'dice':
      return { type, id, name: 'Dés', dice: 2, faces: 6, opponent: b.npc?.name ?? 'Le tavernier', texts: { win: '🏆 **Tu as gagné !**', lose: '😤 **Perdu !**', draw: '🤝 **Égalité !**' } };
  }
}

// ---------------------------------------------------------------------------
// Éditeur d'un bâtiment
// ---------------------------------------------------------------------------

const TABS = [
  ['general', 'Général'],
  ['modules', 'Fonctionnement'],
  ['ecrans', 'Écrans Discord'],
  ['audio', 'Audio'],
  ['avance', 'Avancé'],
] as const;

export async function buildingPage(main: HTMLElement, params: string[]) {
  const d = await draft();
  const w = d.world;
  const b = w.buildings.find((x) => x.id === params[0]);
  if (!b) return void clear(main, emptyState('Bâtiment introuvable', 'Il a peut-être été supprimé.', { label: 'Retour aux bâtiments', onclick: () => go('batiments') }));
  const tab = (params[1] as (typeof TABS)[number][0]) ?? 'general';
  const editable = can('editor');
  const sounds = await get(`/api/servers/${server()!.id}/audio`).then((r) => r.sounds.map((s: any) => s.key) as string[]).catch(() => []);

  const emu = new Emulator(w, b.id);
  let pending: number | undefined;
  const changed = () => {
    touch();
    clearTimeout(pending);
    pending = window.setTimeout(() => emu.update(w), 250);
  };

  const body = h('div', { class: 'editor-body' });
  const page = h(
    'div',
    { class: 'page wide' },
    h('a', { href: '#/batiments', class: 'back' }, '‹ Bâtiments'),
    h(
      'header',
      { class: 'page-head' },
      h('div', null, h('h1', null, `${b.emoji ?? ''} ${b.name}`), h('p', { class: 'muted' }, `Commande Discord : /${b.id}`)),
      editable
        ? h(
            'button',
            {
              class: 'btn ghost danger-text',
              onclick: async () => {
                if (!(await confirmDialog('Supprimer ce bâtiment ?', `« ${b.name} », ses modules et ses écrans seront retirés du brouillon. La progression des joueurs n’est pas touchée.`, 'Supprimer'))) return;
                w.buildings.splice(w.buildings.indexOf(b), 1);
                touch();
                go('batiments');
              },
            },
            'Supprimer',
          )
        : null,
    ),
    h(
      'div',
      { class: 'tabs', role: 'tablist' },
      TABS.map(([id, label]) => h('a', { href: `#/batiment/${b.id}/${id}`, role: 'tab', class: id === tab ? 'on' : '', 'aria-selected': String(id === tab) }, label)),
    ),
    h('div', { class: 'split' }, body, h('aside', { class: 'preview-pane', 'aria-label': 'Aperçu Discord' }, h('h2', { class: 'pane-title' }, 'Aperçu en direct'), h('p', { class: 'muted small' }, 'Le vrai moteur, sur ton brouillon. Clique comme un joueur.'))),
  );
  clear(main, page);
  emu.mount(page.querySelector('.preview-pane') as HTMLElement);
  if (!editable) body.append(h('p', { class: 'note' }, 'Lecture seule : l’édition demande le droit éditeur.'));

  switch (tab) {
    case 'general':
      body.append(generalTab(w, b, changed));
      break;
    case 'modules':
      body.append(modulesTab(w, b, changed, sounds));
      break;
    case 'ecrans':
      body.append(screensTab(w, b, changed));
      break;
    case 'audio':
      body.append(audioTab(w, b, changed, sounds));
      break;
    case 'avance':
      body.append(advancedTab(w, b, changed));
      break;
  }
  if (!editable) body.querySelectorAll('input, select, textarea, button').forEach((e) => ((e as HTMLInputElement).disabled = true));
  return () => emu.destroy();
}

function generalTab(w: WorldDef, b: BuildingDef, changed: () => void) {
  b.npc ??= undefined;
  const npc = (b.npc ??= { name: '' }) as NonNullable<BuildingDef['npc']>;
  const onNpc = () => {
    if (!npc.name) delete b.npc;
    else b.npc = npc;
    changed();
  };
  return h(
    'div',
    { class: 'form' },
    h('section', { class: 'block' }, h('h2', null, 'Identité'), h('div', { class: 'row-fields' }, field(b, 'name', { label: 'Nom' }, changed), field(b, 'emoji', { label: 'Symbole' }, changed), field(b, 'accentColor', { label: 'Couleur des encadrés', type: 'color' }, changed))),
    h(
      'section',
      { class: 'block' },
      h('h2', null, 'Personnage'),
      h('p', { class: 'muted' }, 'Le personnage tient le bâtiment. Son nom est repris par le bot vocal qui l’incarne.'),
      h('div', { class: 'row-fields' }, field(npc, 'name', { label: 'Nom', placeholder: 'Edgar Brassebarbe' }, onNpc), field(npc, 'title', { label: 'Rôle', placeholder: 'Tavernier' }, onNpc), field(npc, 'emoji', { label: 'Symbole' }, onNpc)),
    ),
    h(
      'section',
      { class: 'block' },
      h('h2', null, 'Écran d’accueil'),
      selectField('Écran affiché à l’ouverture', b.homeScreen, b.screens.map((s) => ({ value: s.id, label: s.name })), (v) => ((b.homeScreen = v), changed())),
    ),
  );
  void w;
}

function modulesTab(w: WorldDef, b: BuildingDef, changed: () => void, sounds: string[]) {
  const box = h('div', { class: 'modules' });
  const draw = () =>
    clear(
      box,
      b.modules.length ? null : h('p', { class: 'muted' }, 'Ce bâtiment ne fait encore rien. Ajoute un module ci-dessous.'),
      b.modules.map((m, i) =>
        h(
          'details',
          { class: 'module', open: b.modules.length <= 2 },
          h('summary', null, h('b', null, m.name), h('span', { class: 'chip static' }, moduleLabel(m.type)), h('code', { class: 'muted' }, m.id)),
          moduleEditor(w, b, m, changed, sounds),
          h(
            'div',
            { class: 'module-foot' },
            h(
              'button',
              {
                class: 'btn ghost danger-text small',
                onclick: async () => {
                  if (!(await confirmDialog('Retirer ce module ?', `« ${m.name} » sera retiré. Les écrans qui l’utilisent seront signalés en erreur jusqu’à correction.`, 'Retirer'))) return;
                  b.modules.splice(i, 1);
                  changed();
                  draw();
                },
              },
              'Retirer le module',
            ),
          ),
        ),
      ),
      h(
        'section',
        { class: 'block' },
        h('h2', null, 'Ajouter un module'),
        h(
          'div',
          { class: 'module-picker' },
          MODULE_TYPES.map((t) =>
            h(
              'button',
              {
                class: 'picker',
                onclick: () => {
                  b.modules.push(defaultModule(t.type, b, w));
                  changed();
                  draw();
                },
              },
              h('b', null, t.label),
              h('span', null, t.text),
            ),
          ),
        ),
      ),
    );
  draw();
  return box;
}

function moduleEditor(w: WorldDef, b: BuildingDef, m: ModuleDef, changed: () => void, sounds: string[]): HTMLElement {
  const invs = b.modules.filter((x) => x.type === 'inventory').map((x) => ({ value: x.id, label: x.name }));
  const stats = opts.stats(w);
  const name = field(m, 'name', { label: 'Nom' }, changed);
  switch (m.type) {
    case 'inventory':
      return h(
        'div',
        { class: 'form' },
        h('div', { class: 'row-fields' }, name, field(m, 'emoji', { label: 'Symbole' }, changed)),
        h('p', { class: 'muted' }, 'Le stockage n’a pas de plafond. Les objectifs servent à afficher les priorités et à calculer les prix de rachat.'),
        h('div', { class: 'two' }, h('div', null, h('h3', null, 'Stock de départ'), qtyMapEditor(w, m.initial, changed, { qty: 'Quantité', add: '+ Ajouter un objet…' })), h('div', null, h('h3', null, 'Objectifs'), qtyMapEditor(w, m.targets, changed, { qty: 'Objectif', add: '+ Ajouter un objectif…' }))),
      );
    case 'shop': {
      const list = h('div', { class: 'offers' });
      const drawOffers = () =>
        clear(
          list,
          m.offers.map((o, i) =>
            h(
              'details',
              { class: 'offer' },
              h('summary', null, `${o.emoji ?? ''} ${o.name}`, h('span', { class: 'muted' }, ` — ${o.price} · ${o.category ?? 'sans catégorie'}`)),
              h(
                'div',
                { class: 'form' },
                h('div', { class: 'row-fields' }, field(o, 'name', { label: 'Nom' }, changed), field(o, 'emoji', { label: 'Symbole' }, changed), field(o, 'category', { label: 'Catégorie' }, changed), field(o, 'price', { label: 'Prix', type: 'number', min: 0 }, changed)),
                selectField('Prélevé dans la réserve', o.stockItem, opts.items(w), (v) => ((o.stockItem = v), changed()), { hint: 'Chaque vente retire une unité de cet objet de la réserve.' }),
                h('h3', null, 'Effets sur place'),
                effectsEditor(w, o.effects, changed, sounds),
                h(
                  'label',
                  { class: 'check' },
                  h('input', {
                    type: 'checkbox',
                    checked: !!o.takeaway,
                    onchange: (e: Event) => {
                      if ((e.target as HTMLInputElement).checked) o.takeaway = { item: w.items.find((x) => x.consumable)?.id ?? w.items[0]?.id ?? '', surcharge: 1 };
                      else delete o.takeaway;
                      changed();
                      drawOffers();
                    },
                  }),
                  'Aussi à emporter',
                ),
                o.takeaway
                  ? h('div', { class: 'row-fields' }, selectField('Objet remis au joueur', o.takeaway.item, opts.items(w), (v) => ((o.takeaway!.item = v), changed())), field(o.takeaway, 'surcharge', { label: 'Supplément', type: 'number', min: 0 }, changed))
                  : null,
                h('button', { class: 'btn ghost danger-text small', onclick: () => (m.offers.splice(i, 1), changed(), drawOffers()) }, 'Retirer cet article'),
              ),
            ),
          ),
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                m.offers.push({ id: uniqueId('article', m.offers.map((x) => x.id)), name: 'Nouvel article', emoji: '🛒', stockItem: w.items[0]?.id ?? '', price: 5, effects: [] });
                changed();
                drawOffers();
                (list.lastElementChild?.previousElementSibling as HTMLDetailsElement | null)?.setAttribute('open', '');
              },
            },
            '+ Ajouter un article',
          ),
        );
      drawOffers();
      return h('div', { class: 'form' }, h('div', { class: 'row-fields' }, name, selectField('Réserve utilisée', m.inventory, invs, (v) => ((m.inventory = v), changed())), selectField('Monnaie', m.currency, stats, (v) => ((m.currency = v), changed()))), h('h3', null, 'Articles'), list);
    }
    case 'buyback':
      return h(
        'div',
        { class: 'form' },
        h('div', { class: 'row-fields' }, name, selectField('Réserve alimentée', m.inventory, invs, (v) => ((m.inventory = v), changed())), selectField('Monnaie', m.currency, stats, (v) => ((m.currency = v), changed()))),
        h('h3', null, 'Prix de base'),
        qtyMapEditor(w, m.prices, changed, { qty: 'Prix', add: '+ Racheter un objet…' }),
        h('h3', null, 'Variation selon la réserve'),
        h('p', { class: 'muted' }, 'Le prix de base est multiplié selon le remplissage de la réserve par rapport à son objectif.'),
        h(
          'div',
          { class: 'row-fields' },
          field(m, 'emptyFactor', { label: 'Si la réserve est vide', type: 'number', step: 0.05 }, changed),
          ...m.tiers.map((t) => field(t, 'factor', { label: `Jusqu’à ${Math.round(t.maxRatio * 100)} %`, type: 'number', step: 0.05 }, changed)),
          field(m, 'aboveFactor', { label: 'Au-delà', type: 'number', step: 0.05 }, changed),
        ),
      );
    case 'production': {
      const list = h('div', { class: 'offers' });
      const drawRecipes = () =>
        clear(
          list,
          m.recipes.map((r, i) =>
            h(
              'details',
              { class: 'offer' },
              h('summary', null, `${r.emoji ?? ''} ${r.name}`, h('span', { class: 'muted' }, ` — niveau ${r.level} · ${r.durationSec} s`)),
              h(
                'div',
                { class: 'form' },
                h('div', { class: 'row-fields' }, field(r, 'name', { label: 'Nom' }, changed), field(r, 'emoji', { label: 'Symbole' }, changed), field(r, 'level', { label: 'Niveau requis', type: 'number', min: 1 }, changed), field(r, 'durationSec', { label: 'Durée (secondes)', type: 'number', min: 1 }, changed)),
                h('div', { class: 'two' }, h('div', null, h('h3', null, 'Ingrédients'), qtyMapEditor(w, r.inputs, changed, { qty: 'Qté', add: '+ Ingrédient…' })), h('div', null, h('h3', null, 'Production'), qtyMapEditor(w, r.outputs, changed, { qty: 'Qté', add: '+ Produit…' }))),
                h('button', { class: 'btn ghost danger-text small', onclick: () => (m.recipes.splice(i, 1), changed(), drawRecipes()) }, 'Retirer cette recette'),
              ),
            ),
          ),
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                m.recipes.push({ id: uniqueId('recette', m.recipes.map((x) => x.id)), name: 'Nouvelle recette', level: 1, durationSec: 60, inputs: {}, outputs: {} });
                changed();
                drawRecipes();
              },
            },
            '+ Ajouter une recette',
          ),
        );
      drawRecipes();
      m.labels ??= {};
      return h(
        'div',
        { class: 'form' },
        h('div', { class: 'row-fields' }, name, field(m, 'stationName', { label: 'Nom d’un poste', placeholder: 'Marmite' }, changed), field(m, 'stationCount', { label: 'Nombre de postes', type: 'number', min: 1, max: 10 }, changed), field(m.labels, 'start', { label: 'Bouton de lancement', placeholder: 'Lancer' }, changed)),
        h(
          'div',
          { class: 'row-fields' },
          selectField('Métier requis', m.job ?? '', opts.jobs(w), (v) => (v ? (m.job = v) : delete m.job, changed()), { allowEmpty: 'Aucun' }),
          selectField('Ingrédients pris dans', m.inputInventory, invs, (v) => ((m.inputInventory = v), changed())),
          selectField('Production déposée dans', m.outputInventory, invs, (v) => ((m.outputInventory = v), changed())),
        ),
        h('div', { class: 'row-fields' }, field(m.xp, 'start', { label: 'XP au lancement', type: 'number', min: 0 }, changed), field(m.xp, 'collect', { label: 'XP à la récupération', type: 'number', min: 0 }, changed)),
        h('h3', null, 'Recettes'),
        list,
      );
    }
    case 'dialogue': {
      const list = h('div', { class: 'offers' });
      const drawNodes = () =>
        clear(
          list,
          m.nodes.map((n, i) =>
            h(
              'details',
              { class: 'offer' },
              h('summary', null, n.title, n.id === m.start ? h('span', { class: 'tag ok' }, 'départ') : null),
              h(
                'div',
                { class: 'form' },
                field(n, 'title', { label: 'Titre du sujet' }, changed),
                h('h3', null, 'Répliques'),
                h('p', { class: 'muted small' }, 'Plusieurs répliques = une différente à chaque visite.'),
                n.lines.map((line, j) =>
                  typeof line === 'string'
                    ? h('div', { class: 'line-row' }, h('textarea', { rows: 2, oninput: (e: Event) => ((n.lines[j] = (e.target as HTMLTextAreaElement).value), changed()) }, line), h('button', { class: 'icon-btn', 'aria-label': 'Retirer', onclick: () => (n.lines.splice(j, 1), changed(), drawNodes()) }, '✕'))
                    : h('p', { class: 'note' }, `Réplique conditionnelle (${line.cases.length} variantes) — modifiable dans l’onglet Avancé.`),
                ),
                h('button', { class: 'btn small', onclick: () => (n.lines.push('« … »'), changed(), drawNodes()) }, '+ Réplique'),
                h('h3', null, 'Choix proposés'),
                n.choices.map((c, j) =>
                  h(
                    'div',
                    { class: 'row-fields choice' },
                    field(c, 'emoji', { label: 'Symbole' }, changed),
                    field(c, 'label', { label: 'Libellé' }, changed),
                    selectField('Mène vers', c.screen ? `ecran:${c.screen}` : c.goto ? `sujet:${c.goto}` : '', [...m.nodes.map((x) => ({ value: `sujet:${x.id}`, label: `Sujet : ${x.title}` })), ...b.screens.map((s) => ({ value: `ecran:${s.id}`, label: `Écran : ${s.name}` }))], (v) => {
                      delete c.goto;
                      delete c.screen;
                      if (v.startsWith('sujet:')) c.goto = v.slice(6);
                      if (v.startsWith('ecran:')) c.screen = v.slice(6);
                      changed();
                    }),
                    h('button', { class: 'icon-btn', 'aria-label': 'Retirer ce choix', onclick: () => (n.choices.splice(j, 1), changed(), drawNodes()) }, '✕'),
                  ),
                ),
                n.choices.length < 10 ? h('button', { class: 'btn small', onclick: () => (n.choices.push({ label: 'Nouveau choix', goto: m.start }), changed(), drawNodes()) }, '+ Choix') : null,
                n.id !== m.start ? h('button', { class: 'btn ghost danger-text small', onclick: () => (m.nodes.splice(i, 1), changed(), drawNodes()) }, 'Retirer ce sujet') : null,
              ),
            ),
          ),
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                m.nodes.push({ id: uniqueId('sujet', m.nodes.map((x) => x.id)), title: 'Nouveau sujet', lines: ['« … »'], choices: [] });
                changed();
                drawNodes();
              },
            },
            '+ Ajouter un sujet',
          ),
        );
      drawNodes();
      return h('div', { class: 'form' }, h('div', { class: 'row-fields' }, name, field(m.speaker, 'name', { label: 'Personnage' }, changed), field(m.speaker, 'emoji', { label: 'Symbole' }, changed)), field(m, 'narration', { label: 'Description de la scène', type: 'textarea' }, changed), h('h3', null, 'Sujets'), list);
    }
    case 'dice':
      return h(
        'div',
        { class: 'form' },
        h('div', { class: 'row-fields' }, name, field(m, 'opponent', { label: 'Adversaire' }, changed), field(m, 'dice', { label: 'Dés par joueur', type: 'number', min: 1, max: 5 }, changed), field(m, 'faces', { label: 'Faces', type: 'number', min: 2, max: 100 }, changed)),
        typeof m.texts.win === 'string' ? field(m.texts, 'win', { label: 'Texte de victoire' }, changed) : null,
        typeof m.texts.lose === 'string' ? field(m.texts, 'lose', { label: 'Texte de défaite' }, changed) : null,
        typeof m.texts.draw === 'string' ? field(m.texts, 'draw', { label: 'Texte d’égalité' }, changed) : null,
      );
  }
}

// ---------------------------------------------------------------------------
// Écrans
// ---------------------------------------------------------------------------

const WIDGETS: { kind: WidgetDef['kind']; label: string; needs?: ModuleDef['type'] }[] = [
  { kind: 'player.status', label: 'État du joueur' },
  { kind: 'player.consumables', label: 'Inventaire à consommer' },
  { kind: 'shop.catalog', label: 'Catalogue d’une boutique', needs: 'shop' },
  { kind: 'shop.checkout', label: 'Validation d’achat' },
  { kind: 'production.stations', label: 'Postes de production', needs: 'production' },
  { kind: 'production.priorities', label: 'Priorités de production', needs: 'production' },
  { kind: 'production.recipes', label: 'Livre de recettes', needs: 'production' },
  { kind: 'inventory.stock', label: 'Réserves', needs: 'inventory' },
  { kind: 'buyback.sell', label: 'Vente au bâtiment', needs: 'buyback' },
  { kind: 'dialogue', label: 'Dialogue', needs: 'dialogue' },
  { kind: 'dice', label: 'Jeu de dés', needs: 'dice' },
];

function newWidget(kind: WidgetDef['kind'], b: BuildingDef, w: WorldDef, screen: ScreenDef): WidgetDef {
  const mod = (t: ModuleDef['type']) => b.modules.find((m) => m.type === t)?.id ?? '';
  const home = b.homeScreen;
  switch (kind) {
    case 'player.status':
      return { kind, stats: w.stats.map((s) => s.id) };
    case 'player.consumables':
      return { kind };
    case 'shop.catalog':
      return { kind, shop: mod('shop'), checkoutScreen: b.screens.find((s) => s.blocks.some((x) => x.type === 'widget' && x.widget.kind === 'shop.checkout'))?.id ?? screen.id };
    case 'shop.checkout':
      return { kind, backScreen: home };
    case 'production.stations':
      return { kind, production: mod('production'), recipeScreen: screen.id };
    case 'production.priorities':
      return { kind, production: mod('production') };
    case 'production.recipes':
      return { kind, production: mod('production'), backScreen: home };
    case 'inventory.stock':
      return { kind, views: b.modules.filter((m) => m.type === 'inventory').map((m) => ({ label: m.name, inventory: m.id })) };
    case 'buyback.sell':
      return { kind, buyback: mod('buyback') };
    case 'dialogue':
      return { kind, dialogue: mod('dialogue'), exitScreen: home };
    case 'dice':
      return { kind, dice: mod('dice') };
  }
}

function blockSummary(bl: Block): string {
  switch (bl.type) {
    case 'text':
      return typeof bl.text === 'string' ? bl.text.split('\n')[0]!.replace(/[#*_]/g, '').slice(0, 70) : `Texte variable (${bl.text.cases.length} cas)`;
    case 'container':
      return `Encadré · ${bl.children.length} élément(s)`;
    case 'separator':
      return 'Séparateur';
    case 'section':
      return `Ligne avec bouton « ${typeof bl.button.label === 'string' ? bl.button.label : '…'} »`;
    case 'buttons':
      return `Boutons : ${bl.buttons.map((x) => (typeof x.label === 'string' ? x.label : '…')).join(' · ')}`;
    case 'notice':
      return 'Message de retour (succès, erreurs)';
    case 'widget':
      return WIDGETS.find((x) => x.kind === bl.widget.kind)?.label ?? bl.widget.kind;
  }
}

function screensTab(w: WorldDef, b: BuildingDef, changed: () => void) {
  const box = h('div');
  let current = b.screens[0]?.id ?? '';
  const draw = () => {
    const screen = b.screens.find((s) => s.id === current);
    clear(
      box,
      h(
        'div',
        { class: 'screen-list' },
        b.screens.map((s) => h('button', { class: `chip${s.id === current ? ' on' : ''}`, onclick: () => ((current = s.id), draw()) }, s.name, s.id === b.homeScreen ? ' ⌂' : '')),
        h(
          'button',
          {
            class: 'chip ghost',
            onclick: () => {
              const id = uniqueId('ecran', b.screens.map((s) => s.id));
              b.screens.push({ id, name: 'Nouvel écran', blocks: [{ type: 'container', children: [{ type: 'text', text: '## Nouvel écran' }] }, { type: 'notice' }, { type: 'buttons', buttons: [{ label: 'Retour', rule: { onSuccess: { goto: b.homeScreen } } }] }] });
              current = id;
              changed();
              draw();
            },
          },
          '+ Écran',
        ),
      ),
      screen ? screenEditor(w, b, screen, changed, draw) : null,
    );
  };
  draw();
  return box;
}

function screenEditor(w: WorldDef, b: BuildingDef, screen: ScreenDef, changed: () => void, redraw: () => void) {
  const nav = b.screens.map((s) => ({ value: s.id, label: s.name }));
  const move = (list: Block[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    changed();
    redraw();
  };
  const blockRow = (list: Block[], bl: Block, i: number, depth: number): HTMLElement =>
    h(
      'li',
      { class: `blk depth${depth}` },
      h(
        'div',
        { class: 'blk-head' },
        h('span', { class: 'blk-kind' }, { text: 'Texte', container: 'Encadré', separator: 'Séparateur', section: 'Ligne', buttons: 'Boutons', notice: 'Retour', widget: 'Module' }[bl.type]),
        h('span', { class: 'blk-sum' }, blockSummary(bl)),
        h('button', { class: 'icon-btn', 'aria-label': 'Monter', onclick: () => move(list, i, -1) }, '↑'),
        h('button', { class: 'icon-btn', 'aria-label': 'Descendre', onclick: () => move(list, i, 1) }, '↓'),
        h('button', { class: 'icon-btn', 'aria-label': 'Supprimer', onclick: () => (list.splice(i, 1), changed(), redraw()) }, '✕'),
      ),
      bl.type === 'text' && typeof bl.text === 'string'
        ? h('textarea', { rows: Math.min(8, bl.text.split('\n').length + 1), class: 'blk-text', 'aria-label': 'Texte', oninput: (e: Event) => ((bl.text = (e.target as HTMLTextAreaElement).value), changed()) }, bl.text)
        : null,
      bl.type === 'buttons'
        ? h(
            'div',
            { class: 'blk-buttons' },
            bl.buttons.map((btn, j) =>
              h(
                'div',
                { class: 'row-fields' },
                typeof btn.label === 'string' ? field(btn, 'label', { label: 'Libellé' }, changed) : h('span', { class: 'muted' }, 'Libellé variable'),
                !btn.rule.actions?.length && !btn.rule.when
                  ? selectField('Ouvre l’écran', btn.rule.onSuccess?.goto ?? '', nav, (v) => ((btn.rule.onSuccess = { ...btn.rule.onSuccess, goto: v }), changed()))
                  : h('span', { class: 'note' }, 'Bouton avec règle (onglet Avancé)'),
                h('button', { class: 'icon-btn', 'aria-label': 'Retirer le bouton', onclick: () => (bl.buttons.splice(j, 1), changed(), redraw()) }, '✕'),
              ),
            ),
            bl.buttons.length < 5 ? h('button', { class: 'btn small', onclick: () => (bl.buttons.push({ label: 'Bouton', rule: { onSuccess: { goto: b.homeScreen } } }), changed(), redraw()) }, '+ Bouton') : null,
          )
        : null,
      bl.type === 'container' ? h('ul', { class: 'blk-children' }, bl.children.map((c, j) => blockRow(bl.children, c, j, depth + 1))) : null,
    );
  return h(
    'div',
    { class: 'form' },
    h(
      'div',
      { class: 'row-fields' },
      field(screen, 'name', { label: 'Nom de l’écran' }, changed),
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', checked: screen.id === b.homeScreen, onchange: (e: Event) => (e.target as HTMLInputElement).checked && ((b.homeScreen = screen.id), changed(), redraw()) }),
        'Écran d’accueil',
      ),
    ),
    h('ul', { class: 'blocks' }, screen.blocks.map((bl, i) => blockRow(screen.blocks, bl, i, 0))),
    h(
      'div',
      { class: 'inline-form' },
      selectField(
        null,
        '',
        [
          { value: 'text', label: 'Texte' },
          { value: 'container', label: 'Encadré avec texte' },
          { value: 'separator', label: 'Séparateur' },
          { value: 'buttons', label: 'Rangée de boutons' },
          { value: 'notice', label: 'Message de retour' },
          ...WIDGETS.filter((x) => !x.needs || b.modules.some((m) => m.type === x.needs)).map((x) => ({ value: `widget:${x.kind}`, label: `Module : ${x.label}` })),
        ],
        (v) => {
          if (!v) return;
          const add: Block =
            v === 'text'
              ? { type: 'text', text: 'Nouveau texte' }
              : v === 'container'
                ? { type: 'container', children: [{ type: 'text', text: '### Titre\nTexte' }] }
                : v === 'separator'
                  ? { type: 'separator' }
                  : v === 'buttons'
                    ? { type: 'buttons', buttons: [{ label: 'Retour', rule: { onSuccess: { goto: b.homeScreen } } }] }
                    : v === 'notice'
                      ? { type: 'notice' }
                      : { type: 'widget', widget: newWidget(v.slice(7) as WidgetDef['kind'], b, w, screen) };
          screen.blocks.push(add);
          changed();
          redraw();
        },
        { allowEmpty: '+ Ajouter un élément à l’écran…' },
      ),
      b.screens.length > 1 && screen.id !== b.homeScreen
        ? h(
            'button',
            {
              class: 'btn ghost danger-text small',
              onclick: () => {
                b.screens.splice(b.screens.indexOf(screen), 1);
                changed();
                redraw();
              },
            },
            'Supprimer l’écran',
          )
        : null,
    ),
  );
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

function audioTab(w: WorldDef, b: BuildingDef, changed: () => void, sounds: string[]) {
  const box = h('div', { class: 'form' });
  const soundOpts = sounds.map((s) => ({ value: s, label: s }));
  const soundSelect = (label: string | null, value: string, set: (v: string) => void) =>
    sounds.length ? selectField(label, value, value && !sounds.includes(value) ? [{ value, label: `${value} (manquant)` }, ...soundOpts] : soundOpts, set, { allowEmpty: 'Aucun' }) : field({ v: value }, 'v', { label: label ?? undefined, placeholder: 'clé du son' }, () => {});
  const draw = () => {
    const audio = b.audio;
    const cases: { when?: any; sound: string }[] = !audio?.ambience ? [] : typeof audio.ambience === 'string' ? [{ sound: audio.ambience }] : audio.ambience.cases;
    const write = () => {
      if (!b.audio) return;
      const clean = cases.filter((c) => c.sound);
      b.audio.ambience = clean.length === 0 ? undefined : clean.length === 1 && !clean[0]!.when ? clean[0]!.sound : ({ cases: clean } as SoundChoice);
      changed();
    };
    clear(
      box,
      h('p', { class: 'muted' }, 'Quand un joueur entre dans le salon vocal du bâtiment, un Voice Worker le rejoint sous le nom du personnage et joue cette ambiance.'),
      !audio
        ? h('button', { class: 'btn', onclick: () => ((b.audio = { volume: 0.6 }), changed(), draw()) }, 'Activer l’audio pour ce bâtiment')
        : [
            h(
              'section',
              { class: 'block' },
              h('h2', null, 'Ambiance'),
              h('p', { class: 'muted small' }, 'La première ligne dont la condition est vraie est jouée. Exemple : une ambiance d’orage pendant la Tempête, sinon l’ambiance calme.'),
              cases.map((c, i) =>
                h(
                  'div',
                  { class: 'row-fields' },
                  variableCondition(w, c.when, (cond) => ((c.when = cond), cond || delete c.when, write(), draw())),
                  soundSelect(null, c.sound, (v) => ((c.sound = v), write())),
                  h('button', { class: 'icon-btn', 'aria-label': 'Retirer', onclick: () => (cases.splice(i, 1), write(), draw()) }, '✕'),
                ),
              ),
              h('button', { class: 'btn small', onclick: () => (cases.push({ sound: sounds[0] ?? '' }), write(), draw()) }, '+ Ambiance'),
            ),
            h(
              'section',
              { class: 'block' },
              h('h2', null, 'Accueil et volume'),
              h(
                'div',
                { class: 'row-fields' },
                soundSelect('Son d’arrivée', audio.welcome ?? '', (v) => (v ? (audio.welcome = v) : delete audio.welcome, changed())),
                h(
                  'label',
                  { class: 'field' },
                  h('span', { class: 'field-label' }, `Volume ${Math.round((audio.volume ?? 0.6) * 100)} %`),
                  h('input', { type: 'range', min: 0, max: 100, value: String(Math.round((audio.volume ?? 0.6) * 100)), oninput: (e: Event) => ((audio.volume = Number((e.target as HTMLInputElement).value) / 100), changed()), onchange: () => draw() }),
                ),
              ),
            ),
            h('button', { class: 'btn ghost danger-text small', onclick: () => (delete b.audio, changed(), draw()) }, 'Désactiver l’audio'),
          ],
      sounds.length ? null : h('p', { class: 'note' }, 'La médiathèque est vide : importe des sons dans Médiathèque pour les choisir ici.'),
    );
  };
  draw();
  return box;
}

// ---------------------------------------------------------------------------
// Avancé : édition directe du document
// ---------------------------------------------------------------------------

function advancedTab(w: WorldDef, b: BuildingDef, changed: () => void) {
  const ta = h('textarea', { class: 'code', rows: 30, spellcheck: 'false', 'aria-label': 'Définition du bâtiment' }, JSON.stringify(b, null, 2));
  const status = h('p', { class: 'muted small' }, 'Pour les réglages qui n’ont pas encore d’éditeur (conditions, règles de boutons, textes variables).');
  return h(
    'div',
    { class: 'form' },
    status,
    ta,
    h(
      'button',
      {
        class: 'btn primary',
        onclick: () => {
          try {
            const next = JSON.parse(ta.value) as BuildingDef;
            if (next.id !== b.id) throw new Error('L’identifiant du bâtiment ne peut pas changer ici.');
            for (const k of Object.keys(b)) delete (b as unknown as Record<string, unknown>)[k];
            Object.assign(b, next);
            changed();
            toast('Bâtiment mis à jour dans le brouillon.');
          } catch (e) {
            toast(`JSON invalide : ${(e as Error).message}`, 'error');
          }
        },
      },
      'Appliquer',
    ),
  );
  void w;
  void state;
}
