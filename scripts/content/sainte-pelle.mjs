/**
 * Génère content/sainte-pelle/world.json : la bêta « La Nuit de la Sainte Pelle » (3 h, 8 testeurs).
 * Scénario : docs du projet « KE4 BETA — La Nuit de la Sainte Pelle ».
 *
 * Tout est de la donnée : ce script ne fait qu'écrire un monde JSON, modifiable ensuite dans le Studio.
 * La Taverne d'Edgar V11 est reprise telle quelle depuis content/le-royaume.
 *
 *   node scripts/content/sainte-pelle.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const royaume = JSON.parse(readFileSync(new URL('content/le-royaume/world.json', root), 'utf8'));

// ---------------------------------------------------------------------------
// Aides : conditions, actions, blocs
// ---------------------------------------------------------------------------

const all = (...conditions) => ({ type: 'all', conditions });
const any = (...conditions) => ({ type: 'any', conditions });
const not = (condition) => ({ type: 'not', condition });
const v = (variable, value, op = 'eq') => ({ type: 'variable', variable, op, value });
const T = (op, value) => v('t', value, op);
/** Fenêtre du scénario : T+a (inclus) à T+b (exclu). */
const between = (a, b) => all(T('gte', a), T('lt', b));
const from = (a) => T('gte', a);
const STORM = between(85, 110);
const notStorm = not(STORM);
const obj = (building, objective, op, value) => ({ type: 'objective', building, objective, op, value });

const set = (variable, value) => ({ type: 'variable.set', variable, value });
const add = (variable, amount) => ({ type: 'variable.add', variable, amount });
const give = (item, qty = 1) => ({ type: 'item.give', item, qty });
const take = (item, qty = 1) => ({ type: 'item.take', item, qty });
const stat = (s, amount) => ({ type: 'stat.add', stat: s, amount });
const xp = (amount) => stat('xp', amount);
const ifThen = (when, then, otherwise) => ({ type: 'if', when, then, ...(otherwise ? { else: otherwise } : {}) });
const voice = (sound, building) => ({ type: 'audio.play', sound, building });
const announce = (text) => ({ type: 'announce', text });
const tag = (t, amount) => ({ type: 'quest.tag', tag: t, ...(amount ? { amount } : {}) });
const contribute = (building, objective, item, qty = 1) => ({ type: 'objective.add', building, objective, item, qty });
const cases = (...list) => ({ cases: list.map(([when, text]) => (when ? { when, text } : { text })) });

const text = (t, visibleIf) => ({ type: 'text', text: t, ...(visibleIf ? { visibleIf } : {}) });
const box = (children, accent, visibleIf) => ({ type: 'container', children, ...(accent ? { accent } : {}), ...(visibleIf ? { visibleIf } : {}) });
const sep = () => ({ type: 'separator' });
const notice = () => ({ type: 'notice' });
const widget = (w, visibleIf) => ({ type: 'widget', widget: w, ...(visibleIf ? { visibleIf } : {}) });
const go = (label, screen, extra = {}) => ({ label, rule: { onSuccess: { goto: screen } }, ...extra });
const btn = (label, rule, extra = {}) => ({ label, rule, ...extra });
const buttons = (list, visibleIf) => ({ type: 'buttons', buttons: list, ...(visibleIf ? { visibleIf } : {}) });
const section = (t, button, visibleIf) => ({ type: 'section', text: t, button, ...(visibleIf ? { visibleIf } : {}) });

/** Activité : durée, recharge, coûts, résultats. */
const activity = (id, name, emoji, o) => ({
  id,
  name,
  emoji,
  description: o.description,
  durationSec: o.duration ?? 60,
  cooldownSec: o.cooldown ?? 0,
  ...(o.when ? { when: o.when } : {}),
  costs: o.costs ?? [stat('energie', -(o.energy ?? 5))],
  ...(o.tool ? { tool: { item: o.tool, wear: o.wear ?? 1 } } : {}),
  rolls: 1,
  results: o.results ?? [{ weight: 1, label: o.label ?? 'Terminé', actions: o.actions ?? [] }],
  ...(o.multipliers ? { multipliers: o.multipliers } : {}),
  ...(o.maxConcurrent ? { maxConcurrent: o.maxConcurrent } : {}),
});

const objective = (id, name, goals, o = {}) => ({
  type: 'objective',
  id,
  name,
  ...(o.description ? { description: o.description } : {}),
  goals,
  quantities: o.quantities ?? [1, 5],
  ...(o.when ? { when: o.when } : {}),
  ...(o.closed ? { closedText: o.closed } : {}),
  ...(o.xp ? { xpPerUnit: { stat: 'xp', amount: o.xp } } : {}),
  ...(o.onComplete ? { onComplete: o.onComplete } : {}),
});

/** Écran « Mon inventaire » commun à tous les lieux : fiche (endurance, ivresse, XP, quête), puis le sac. */
const inventoryScreen = (accent) => ({
  id: 'inventaire',
  name: 'Mon inventaire',
  blocks: [
    widget({ kind: 'player.sheet', stats: ['energie', 'alcool'], accent }),
    notice(),
    widget({ kind: 'player.consumables', title: '🎒 Mon inventaire', all: true, accent }),
    buttons([go('↩️ Retour', 'accueil'), go('🔄 Actualiser', 'inventaire')]),
  ],
});

const dialogueScreen = (dialogue, accent) => ({
  id: 'dialogue',
  name: 'Discussion',
  blocks: [notice(), widget({ kind: 'dialogue', dialogue, exitScreen: 'accueil', accent })],
});

/** Lieu fermé (tempête) : seul l'inventaire reste accessible. */
const closedScreen = (message) => ({
  id: 'ferme',
  name: 'Fermé',
  blocks: [box([text(message)], 0x7a2e2e), notice(), buttons([go('🎒 Mon inventaire', 'inventaire'), go('🔄 Actualiser', 'accueil')])],
});

const navRow = (talkLabel, extra = []) =>
  buttons([go(talkLabel, 'dialogue', { style: 'primary' }), ...extra, go('🎒 Mon inventaire', 'inventaire'), go('🔄 Actualiser', 'accueil')]);

const statusLine = '⚡ **Endurance :** {player.stat.energie}/100 · 💰 **Bourse :** {player.stat.ecus} écus · ⭐ **XP :** {player.stat.xp}\n🌦️ **Météo :** {var.meteo.label}';
const PRELUDE = text('*🕯️ La fête de la Sainte Pelle n’a pas encore commencé. Le Roi donnera le signal.*', T('lt', 0));

/** Bouton d'indice : une seule fois pour tout le village. */
const clue = (n, label, found, when) =>
  section(
    `**🔎 ${label}**\n*Un détail cloche…*`,
    btn('Examiner', { when, actions: [set(`indice${n}`, 'oui'), add('indices', 1), xp(15), tag('indice'), announce(`🔎 **Indice ${n}/6 trouvé :** ${found}`)], onSuccess: { notice: `🔎 **Indice trouvé !** ${found}\n+15 XP` } }, { emoji: '🔎', style: 'primary' }),
    all(when, v(`indice${n}`, 'non')),
  );

// ---------------------------------------------------------------------------
// Monde : statistiques, objets, variables
// ---------------------------------------------------------------------------

const stats = [
  { id: 'ecus', name: 'Bourse', emoji: '💰', min: 0, initial: 100, kind: 'currency', unit: 'écus' },
  { id: 'energie', name: 'Endurance', emoji: '⚡', min: 0, max: 100, initial: 80, kind: 'gauge' },
  { id: 'alcool', name: 'Ivresse', emoji: '🍺', min: 0, max: 100, initial: 0, kind: 'gauge' },
  { id: 'xp', name: 'XP', emoji: '⭐', min: 0, initial: 0, kind: 'value', unit: 'XP' },
  { id: 'a_vote', name: 'A voté', emoji: '🗳️', min: 0, max: 1, initial: 0, kind: 'value' },
];

const keep = new Set(['legumes', 'viande', 'farine', 'epices', 'eau', 'biere', 'hydromel', 'eau_potable', 'jus_pomme', 'vin', 'plat_soupe', 'plat_ragout', 'plat_pain', 'plat_festin', 'plat_royal', 'gourde_eau', 'bouteille_biere', 'flasque_hydromel', 'bouteille_jus', 'bouteille_vin', 'gamelle_soupe', 'gamelle_ragout', 'pain_emballe', 'hache', 'buche', 'champignon']);
const items = [
  ...royaume.items.filter((i) => keep.has(i.id)),
  { id: 'pierre', name: 'Pierre de taille', emoji: '🪨', category: 'Matériaux', baseValue: 2 },
  { id: 'minerai', name: 'Minerai de fer', emoji: '⛏️', category: 'Matériaux', baseValue: 3 },
  { id: 'lingot', name: 'Lingot de fer', emoji: '🔩', category: 'Matériaux', baseValue: 8 },
  { id: 'ferrure', name: 'Ferrure', emoji: '🔗', category: 'Matériaux', baseValue: 20 },
  { id: 'poisson', name: 'Poisson de rivière', emoji: '🐟', category: 'Vivres', baseValue: 3 },
  { id: 'oeuf', name: 'Œuf frais', emoji: '🥚', category: 'Vivres', baseValue: 1 },
  { id: 'gerbe', name: 'Gerbe de blé', emoji: '🌾', category: 'Vivres', baseValue: 1 },
  { id: 'seau', name: 'Seau d’eau', emoji: '🪣', category: 'Matériaux', baseValue: 1 },
  { id: 'eclat', name: 'Éclat de pierre-tonnerre', emoji: '✨', category: 'Curiosités', description: 'Il grésille au creux de la main.' },
  { id: 'eclat_poli', name: 'Éclat poli', emoji: '💎', category: 'Souvenirs', description: 'Souvenir de la nuit de la Sainte Pelle.' },
  { id: 'panier_agathe', name: 'Panier d’Agathe', emoji: '🧺', category: 'À emporter', consumable: { effects: [stat('energie', 40)] } },
  { id: 'pioche', name: 'Pioche', emoji: '⛏️', category: 'Outils', tool: { maxDurability: 25 } },
  { id: 'canne', name: 'Canne à pêche', emoji: '🎣', category: 'Outils', tool: { maxDurability: 30 } },
  { id: 'hache_maitre', name: 'Hache de maître', emoji: '🪓', category: 'Outils', tool: { maxDurability: 80 } },
  // Contributions « virtuelles » aux objectifs communs (jamais dans un sac).
  { id: 'branche', name: 'Branches dégagées', emoji: '🌿', category: 'Chantier' },
  { id: 'deblai', name: 'Gravats déblayés', emoji: '🪨', category: 'Chantier' },
  { id: 'assemblage', name: 'Assemblage de charpente', emoji: '🪚', category: 'Chantier' },
  { id: 'don', name: 'Écus versés', emoji: '🪙', category: 'Chantier' },
  // Titres (souvenirs de la séance).
  { id: 'titre_forgeron', name: 'Forgeron de la Sainte Pelle', emoji: '🎖️', category: 'Titres' },
  { id: 'titre_fine_gueule', name: 'Fine gueule', emoji: '🎖️', category: 'Titres' },
  { id: 'titre_heros', name: 'Héros de la tempête', emoji: '🎖️', category: 'Titres' },
  { id: 'titre_limier', name: 'Fin limier', emoji: '🎖️', category: 'Titres' },
  { id: 'titre_bienfaiteur', name: 'Bienfaiteur', emoji: '🎖️', category: 'Titres' },
];
// La hache du Royaume dure plus longtemps pour la bêta.
const hache = items.find((i) => i.id === 'hache');
if (hache?.tool) hache.tool.maxDurability = 40;

const opt = (value, label) => ({ value, label });
const variables = [
  { id: 't', name: 'Minute du scénario (T+)', initial: -1 },
  { id: 'acte', name: 'Acte', initial: 'prelude', options: [opt('prelude', '🕯️ Avant la fête'), opt('veille', '🎉 Veille de fête'), opt('signes', '🌥️ Les signes'), opt('tempete', '⛈️ La tempête'), opt('releve', '⛪ Relever le Royaume'), opt('fin', '🔔 Fin de séance')] },
  // Compatibilité avec les textes de la Taverne d'Edgar V11.
  { id: 'phase', name: 'Phase (Taverne)', initial: 'calme', options: [opt('calme', '🟢 Calme'), opt('tempete', '🌩️ Tempête'), opt('apres', '⛪ Après-tempête')] },
  { id: 'soiree', name: 'Soirée à la taverne', initial: 'non', options: [opt('non', 'Non'), opt('oui', '🎻 En cours')] },
  { id: 'meteo', name: 'Météo', initial: 'soleil', options: [opt('soleil', '☀️ Ensoleillé'), opt('nuages', '⛅ Nuageux'), opt('pluie', '🌧️ Pluie'), opt('orage', '⛈️ Orage'), opt('pluie_fine', '🌦️ Pluie fine')] },
  { id: 'votes_mine', name: 'Votes : rendre la pierre à la mine', initial: 0 },
  { id: 'votes_forge', name: 'Votes : garder la pierre à la forge', initial: 0 },
  { id: 'pierre', name: 'Sort de la pierre', initial: 'inconnue', options: [opt('inconnue', '❔ Pas encore décidé'), opt('mine', '⛏️ Rendue à la mine'), opt('forge', '🔥 Gardée à la forge')] },
  { id: 'fete', name: 'Préparatifs de la fête', initial: 'en_cours', options: [opt('en_cours', '🎉 En cours'), opt('reussie', '✅ Réussis'), opt('maigre', '🥖 Maigres')] },
  { id: 'recolte', name: 'Dernière récolte', initial: 'en_cours', options: [opt('en_cours', '🌾 En cours'), opt('reussie', '✅ Rentrée'), opt('ratee', '❌ Perdue')] },
  { id: 'urgence', name: 'Urgence', initial: 'aucune', options: [opt('aucune', 'Aucune'), opt('incendie', '🔥 Incendie à la forge'), opt('eboulement', '🪨 Éboulement à la mine')] },
  { id: 'urgence_res', name: 'Issue de l’urgence', initial: 'aucune', options: [opt('aucune', '—'), opt('reussie', '✅ Maîtrisée'), opt('ratee', '❌ Dégâts')] },
  { id: 'forge_etat', name: 'État de la forge', initial: 'ok', options: [opt('ok', '🟢 En état'), opt('endommagee', '🔴 Endommagée')] },
  { id: 'mine_etat', name: 'État de la mine', initial: 'ok', options: [opt('ok', '🟢 En état'), opt('endommagee', '🔴 Galerie à 50 %')] },
  { id: 'indices', name: 'Indices trouvés', initial: 0 },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `indice${n}`, name: `Indice ${n}`, initial: 'non', options: [opt('non', '❔ Pas trouvé'), opt('oui', '🔎 Trouvé')] })),
  { id: 'eglise_ok', name: 'Église relevée', initial: 'non', options: [opt('non', 'Non'), opt('oui', 'Oui')] },
  { id: 'fin', name: 'Fin de la séance', initial: 'aucune', options: [opt('aucune', '—'), opt('triomphe', '🔔 La Sainte Pelle triomphante'), opt('sans_ame', '🧱 Des pierres sans âme'), opt('parvis', '🙏 La foi sur le parvis'), opt('report', '🌧️ La messe reportée')] },
];

// ---------------------------------------------------------------------------
// Place du village — Maëlis : panneau des quêtes, fête, vote, trésor, enquête
// ---------------------------------------------------------------------------

const PLACE = 0x0a6b45;
const place = {
  id: 'place',
  name: 'Place du village',
  emoji: '⛲',
  accentColor: PLACE,
  npc: { name: 'Maëlis', emoji: '📜', title: 'Intendante' },
  entrance: { text: 'Le cœur de Valbrume : le panneau des quêtes, les annonces et les comptes du Royaume.', button: 'Entrer sur la place', buttonEmoji: '⛲' },
  homeScreen: 'accueil',
  modules: [
    {
      type: 'activity',
      id: 'puits',
      name: '🪣 Le puits',
      activities: [activity('seau', 'Remplir un seau', '🪣', { duration: 0, cooldown: 10, energy: 1, label: 'Seau rempli', actions: [give('seau')], description: 'L’eau du puits sert partout : taverne, ferme… et en cas d’incendie.' })],
    },
    objective('fete', '🎉 Préparer la fête', { buche: 30, poisson: 15, pain_emballe: 10, gamelle_soupe: 10 }, {
      description: 'Le bûcher, le banquet : tout doit être prêt pour **T+60**.',
      when: between(0, 60),
      closed: cases([T('lt', 0), 'Les préparatifs commencent au signal du Roi.'], [null, 'Les préparatifs sont terminés.']),
      xp: 2,
      onComplete: { actions: [], announce: '🎉 **La fête est prête !** Le bûcher est dressé et le banquet servi. Valbrume vous remercie.' },
    }),
    objective('tresor', '🪙 Le Trésor du Royaume', { don: 500 }, {
      description: 'Chaque écu versé paie les ouvriers du chantier.',
      when: from(0),
      quantities: [1],
      onComplete: { actions: [{ type: 'players.each', actions: [xp(20)] }], announce: '🪙 **Le Trésor est rempli !** Les ouvriers sont payés : +20 XP pour tout le village.' },
    }),
    {
      type: 'dialogue',
      id: 'maelis',
      name: 'Discussion avec Maëlis',
      speaker: { name: 'Maëlis', emoji: '📜' },
      narration: 'Maëlis tient son registre serré contre elle, une plume derrière l’oreille.',
      start: 'accueil',
      nodes: [
        { id: 'accueil', title: '💬 Parler à Maëlis', lines: ['« Bienvenue à Valbrume ! Le panneau des quêtes est juste là. Tout le monde a du travail ce soir. »'], choices: [{ label: 'La fête', emoji: '🎉', goto: 'fete' }, { label: 'La pierre', emoji: '✨', goto: 'pierre', when: from(25) }, { label: 'La nuit de la tempête', emoji: '🌩️', goto: 'nuit', when: from(110) }] },
        { id: 'fete', title: '🎉 La Sainte Pelle', lines: ['« Chaque année, on bénit la pelle du fondateur : celle qui creusa le premier puits. Il nous faut du bois pour le bûcher et de quoi nourrir tout le monde. »'], choices: [] },
        { id: 'pierre', title: '✨ La pierre-tonnerre', lines: [cases([v('pierre', 'mine'), '« La pierre est retournée dans la montagne. Roland est soulagé, Wagner boude. »'], [v('pierre', 'forge'), '« La pierre est à la forge. Wagner jure qu’il est prudent… »'], [null, '« Roland, Wagner et le Père Anselme ne sont pas d’accord. Le village votera, ici même. »'])], choices: [] },
        { id: 'nuit', title: '🌩️ La nuit de la tempête', lines: ['« Mon registre des clés ? Seuls le Père Anselme et le sacristain ont la clé du reliquaire. Le sacristain, c’est… Edgar. Depuis douze ans. »'], choices: [] },
      ],
    },
  ],
  screens: [
    {
      id: 'accueil',
      name: 'Accueil',
      blocks: [
        box([
          text(cases([v('acte', 'tempete'), '## ⛲ Place du village\n*Les guirlandes arrachées volent dans le vent. Maëlis s’abrite sous l’auvent du puits.*'], [v('acte', 'releve'), '## ⛲ Place du village\n*Des branches jonchent les pavés. Maëlis organise les secours, registre en main.*'], [null, '## ⛲ Place du village\n*Guirlandes, lampions et odeur de pain chaud. Maëlis, l’intendante, accueille chacun avec son registre.*'])),
          text(statusLine),
        ], PLACE),
        PRELUDE,
        notice(),
        widget({ kind: 'quest.board', accent: PLACE }, from(0)),
        buttons([go('🎉 Fête & Trésor', 'royaume', { style: 'primary' }), go('🗳️ Conseil de la pierre', 'conseil', { style: 'danger', visibleIf: between(45, 65) }), go('🔎 Enquête', 'enquete', { visibleIf: from(100) }), go('🏅 Tableau d’honneur', 'honneur')]),
        widget({ kind: 'activity.board', activity: 'puits', accent: PLACE }),
        navRow('💬 Parler à Maëlis'),
      ],
    },
    {
      id: 'royaume',
      name: 'Fête & Trésor',
      blocks: [
        notice(),
        widget({ kind: 'objective.board', objective: 'fete', accent: PLACE }),
        widget({ kind: 'objective.board', objective: 'tresor', accent: 0xe0b04f }),
        buttons([
          btn('Verser 20 écus', { actions: [stat('ecus', -20), contribute('place', 'tresor', 'don', 20)], onSuccess: { notice: '🪙 Merci ! 20 écus versés au Trésor du Royaume.' } }, { emoji: '🪙', style: 'success', visibleIf: from(0) }),
          go('↩️ Retour', 'accueil'),
          go('🔄 Actualiser', 'royaume'),
        ]),
        text('**⛪ Chantier de l’église :** {objective.eglise.chantier} % des matériaux · arbre dégagé à {objective.eglise.arbre} % · charpente à {objective.eglise.assemblage} %', from(110)),
      ],
    },
    {
      id: 'conseil',
      name: 'Conseil de la pierre',
      guard: { when: between(45, 65), redirect: 'accueil', notice: '🗳️ Le conseil de la pierre est clos.' },
      blocks: [
        box([
          text('## 🗳️ Le conseil de la pierre\nRoland veut **rendre la pierre-tonnerre à la montagne**. Wagner veut **la garder à la forge** pour l’étudier. Une voix par habitant, jusqu’à **T+65**.\n*Écoute-les d’abord : Roland à la mine, Wagner à la forge, le Père Anselme à l’église.*'),
          text('⛏️ Rendre à la mine : **{var.votes_mine}** voix · 🔥 Garder à la forge : **{var.votes_forge}** voix'),
        ], 0x7a2e2e),
        notice(),
        buttons(
          [
            btn('Rendre à la mine', { when: { type: 'stat', stat: 'a_vote', op: 'eq', value: 0 }, actions: [{ type: 'stat.set', stat: 'a_vote', value: 1 }, add('votes_mine', 1), tag('vote'), xp(5)], onSuccess: { notice: '🗳️ Ta voix est comptée : **rendre la pierre à la mine**.' }, onFailure: { notice: '🗳️ Tu as déjà voté.' } }, { emoji: '⛏️', style: 'primary' }),
            btn('Garder à la forge', { when: { type: 'stat', stat: 'a_vote', op: 'eq', value: 0 }, actions: [{ type: 'stat.set', stat: 'a_vote', value: 1 }, add('votes_forge', 1), tag('vote'), xp(5)], onSuccess: { notice: '🗳️ Ta voix est comptée : **garder la pierre à la forge**.' }, onFailure: { notice: '🗳️ Tu as déjà voté.' } }, { emoji: '🔥', style: 'danger' }),
          ],
          { type: 'stat', stat: 'a_vote', op: 'eq', value: 0 },
        ),
        text('✅ *Tu as voté. Résultat à T+65.*', { type: 'stat', stat: 'a_vote', op: 'eq', value: 1 }),
        buttons([go('↩️ Retour', 'accueil'), go('🔄 Actualiser', 'conseil')]),
      ],
    },
    {
      id: 'enquete',
      name: 'Enquête',
      blocks: [
        box([
          text('## 🔎 Où est la Sainte Pelle ?\nLe reliquaire a été trouvé vide après la tempête. Chaque indice n’est trouvé qu’une fois, pour tout le village.\n**Indices : {var.indices}/6**'),
          text('1. 🔒 **Le reliquaire vide** : le verrou n’est pas forcé, on l’a ouvert avec une clé.', v('indice1', 'oui')),
          text('2. 👣 **Des traces de boue** sur le pont : de grosses bottes, une démarche titubante, vers la taverne.', v('indice2', 'oui')),
          text('3. 🏮 **La lanterne d’Edgar**, au pied de l’église, gravée « G.C. ».', v('indice3', 'oui')),
          text('4. 👁️ **Agathe** a vu quelqu’un courir sous la pluie avec un long paquet, la barbe au vent.', v('indice4', 'oui')),
          text('5. 🗝️ **Le registre des clés** : seuls le Père Anselme et le sacristain, Edgar, ont la clé.', v('indice5', 'oui')),
          text('6. 🍯 **La mémoire d’Edgar** : il a caché la relique dans sa cave pour la protéger… puis il a fêté ça.', v('indice6', 'oui')),
          text('*Les indices se cherchent à l’église, au pont, en forêt, à la ferme et ici. Le dernier se mérite à la taverne.*', not(v('indice6', 'oui'))),
        ], 0xe0b04f),
        notice(),
        clue(5, 'Le registre des clés de Maëlis', 'seuls le Père Anselme et le sacristain, Edgar, ont la clé du reliquaire.', from(110)),
        buttons([go('↩️ Retour', 'accueil'), go('🔄 Actualiser', 'enquete')]),
      ],
    },
    {
      id: 'honneur',
      name: 'Tableau d’honneur',
      blocks: [widget({ kind: 'ranking', stat: 'xp', title: '🏅 Tableau d’honneur de Valbrume', limit: 10, accent: 0xe0b04f }), text('**Fin de la séance :** {var.fin.label}', v('acte', 'fin')), buttons([go('↩️ Retour', 'accueil'), go('🔄 Actualiser', 'honneur')])],
    },
    dialogueScreen('maelis', PLACE),
    inventoryScreen(PLACE),
  ],
};

// ---------------------------------------------------------------------------
// Taverne d'Edgar (V11, reprise telle quelle) + ajouts du scénario
// ---------------------------------------------------------------------------

const taverne = structuredClone(royaume.buildings.find((b) => b.id === 'taverne'));
taverne.entrance = { text: 'La chaleur du foyer, l’odeur du ragoût et la voix d’Edgar qui couvre tout le reste.', button: 'Pousser la porte', buttonEmoji: '🍺' };
{
  const acc = taverne.screens.find((s) => s.id === 'accueil');
  // Retire le « laboratoire » (simulation manuelle des phases) : le scénario s'en charge.
  const lab = acc.blocks.findIndex((b) => b.type === 'text' && typeof b.text === 'string' && b.text.includes('Laboratoire'));
  if (lab >= 0) acc.blocks.splice(lab, 2);
  // Offres du scénario, juste après le message de retour.
  const at = acc.blocks.findIndex((b) => b.type === 'notice') + 1;
  acc.blocks.splice(at, 0, widget({ kind: 'activity.board', activity: 'scenario', accent: 0x885c34 }, any(between(10, 20), all(STORM, v('recolte', 'reussie')))));
  taverne.modules.push({
    type: 'activity',
    id: 'scenario',
    name: '🎉 Offert par la maison',
    activities: [
      activity('tournee', 'Tournée d’ouverture', '🍻', { duration: 0, cooldown: 3600, costs: [], when: between(10, 20), label: 'À la tienne !', actions: [stat('alcool', 5), stat('energie', 10)], description: 'Edgar offre la première chope. Une seule par personne !' }),
      activity('soupe', 'Bol de soupe chaude', '🥣', { duration: 0, cooldown: 1800, costs: [], when: all(STORM, v('recolte', 'reussie')), label: 'Ça réchauffe', actions: [stat('energie', 25)], description: 'Agathe a tout rentré à temps : la soupe est offerte pendant la tempête.' }),
    ],
  });
  // Inventaire : la fiche du joueur (endurance, ivresse, XP, quête) au-dessus du sac.
  const i = taverne.screens.findIndex((s) => s.id === 'inventaire');
  taverne.screens[i] = inventoryScreen(0x885c34);
  taverne.screens[i].blocks.at(-1).buttons[0] = go('↩️ Retour à la Taverne', 'accueil');
  // Edgar : rumeurs sur la pierre, la nuit de la tempête.
  const dlg = taverne.modules.find((m) => m.type === 'dialogue');
  const start = dlg.nodes.find((n) => n.id === dlg.start);
  start.choices.unshift({ label: 'La pierre de Roland', emoji: '✨', goto: 'pierre1', when: between(25, 85) }, { label: 'La relique ?', emoji: '⛪', goto: 'relique', when: from(110) });
  dlg.nodes.push(
    { id: 'pierre1', title: '✨ La pierre de Roland', lines: ['« Tu as entendu ? Roland a sorti un caillou qui crépite comme une bûche humide. Moi, je dis : un caillou qui fait du bruit, ça se met dans un tonneau et on n’en parle plus. »'], choices: [{ label: 'Et Wagner ?', emoji: '🔥', goto: 'pierre2' }] },
    { id: 'pierre2', title: '🔥 Wagner et la pierre', lines: ['« Wagner ? Il la regarde comme moi je regarde un tonneau d’hydromel. Ça ne présage rien de bon, crois-moi. Et le Père Anselme en a fait tomber son bréviaire. »'], choices: [] },
    { id: 'relique', title: '⛪ La relique', lines: [cases([v('indice6', 'oui'), '« Je… je l’avais mise à l’abri, tu comprends ? Dans ma cave, là où rien ne tombe jamais. Et puis j’ai fêté ça. Pardon, mon Père… »'], [null, '« La relique ? Disparue ? Oh, misère… Non, non, moi, cette nuit-là, j’étais ici. Enfin, je crois. Il y avait de l’hydromel. »'])], choices: [] },
  );
}

// ---------------------------------------------------------------------------
// Mine de Roland
// ---------------------------------------------------------------------------

const MINE = 0x5b6470;
const mineDamaged = v('mine_etat', 'endommagee');
const half = [{ when: mineDamaged, factor: 0.5, label: 'galerie endommagée : rendement 50 %' }];
const mine = {
  id: 'mine',
  name: 'Mine de Roland',
  emoji: '⛏️',
  accentColor: MINE,
  npc: { name: 'Roland', emoji: '⛏️', title: 'Mineur' },
  entrance: { text: 'L’entrée de la galerie souffle un air froid. On entend Roland chanter faux tout au fond.', button: 'Descendre', buttonEmoji: '⛏️' },
  homeScreen: 'accueil',
  modules: [
    {
      type: 'activity',
      id: 'travaux',
      name: '⛏️ Travaux de la mine',
      activities: [
        activity('pierres', 'Extraire des pierres', '🪨', { duration: 75, cooldown: 0, energy: 6, tool: 'pioche', when: all(from(0), notStorm), results: [{ weight: 85, label: 'Bon filon', actions: [give('pierre', 4)] }, { weight: 15, label: 'Roche tendre', actions: [give('pierre', 6)] }], multipliers: half }),
        activity('minerai', 'Extraire du minerai', '⛏️', { duration: 90, cooldown: 0, energy: 7, tool: 'pioche', when: all(from(0), notStorm), results: [{ weight: 80, label: 'Veine de fer', actions: [give('minerai', 2)] }, { weight: 20, label: 'Belle veine', actions: [give('minerai', 3)] }], multipliers: half }),
        activity('galerie', 'Creuser la galerie profonde', '🕳️', { duration: 120, cooldown: 0, energy: 10, tool: 'pioche', wear: 2, when: between(25, 85), description: 'Ouverte depuis la trouvaille de Roland. On y trouve parfois des éclats…', results: [{ weight: 75, label: 'Du fer en quantité', actions: [give('minerai', 4)] }, { weight: 15, label: 'Un éclat de pierre-tonnerre !', actions: [give('minerai', 2), give('eclat', 1)] }, { weight: 10, label: 'Éboulis : rien du tout', actions: [] }] }),
      ],
    },
    {
      type: 'activity',
      id: 'secours',
      name: '🚨 Dégager Roland',
      activities: [activity('deblayer', 'Déblayer la galerie', '🪨', { duration: 0, cooldown: 8, energy: 3, tool: 'pioche', when: all(v('urgence', 'eboulement'), T('lt', 100)), label: 'Un bloc de moins', actions: [contribute('mine', 'eboulement', 'deblai', 1)], description: 'Chaque coup de pioche compte : Roland est coincé derrière !' })],
    },
    objective('eboulement', '🚨 Éboulement : dégager Roland', { deblai: 30 }, { description: 'L’eau monte. Il faut 30 coups de pioche avant **T+100** !', when: all(v('urgence', 'eboulement'), T('lt', 100)), closed: 'Le temps est écoulé.', xp: 3, onComplete: { actions: [voice('roland-sauve', 'mine')], announce: '🎉 **Roland est sauvé !** « De l’air ! Je vous dois une fière chandelle. »' } }),
    objective('reparation', '🛠️ Réparer la galerie', { buche: 20, pierre: 20 }, { description: 'Tant que la galerie n’est pas étayée, la mine ne rend que la moitié.', when: all(mineDamaged, from(110)), closed: 'Rien à réparer.', xp: 2, onComplete: { actions: [set('mine_etat', 'ok')], announce: '🛠️ **La galerie est étayée !** La mine retrouve son plein rendement.' } }),
    {
      type: 'dialogue',
      id: 'roland',
      name: 'Discussion avec Roland',
      speaker: { name: 'Roland', emoji: '⛏️' },
      narration: 'Roland s’essuie le front avec un mouchoir plus noir que son visage.',
      start: 'accueil',
      nodes: [
        { id: 'accueil', title: '💬 Parler à Roland', lines: ['« Ah, un nouveau visage ! Fais attention où tu mets les pieds : ici, les cailloux ne pardonnent pas. »'], choices: [{ label: 'La pierre-tonnerre', emoji: '✨', goto: 'pierre', when: from(25) }, { label: 'Ton avis pour le vote', emoji: '🗳️', goto: 'avis', when: between(45, 65) }, { label: 'La nuit de la tempête', emoji: '🌩️', goto: 'nuit', when: from(110) }] },
        { id: 'pierre', title: '✨ La pierre-tonnerre', lines: ['« Trente ans que je creuse, et jamais vu une pierre pareille. Elle grésille dans la main comme un orage en bouteille. »'], choices: [] },
        { id: 'avis', title: '🗳️ L’avis de Roland', lines: ['« Cette pierre vient de la montagne, elle doit y retourner. Il y a des choses qu’on ne remonte pas, camarade. »'], choices: [] },
        { id: 'nuit', title: '🌩️ La nuit de la tempête', lines: ['« Moi ? J’étais ici, à surveiller les étais. Mais en remontant, j’ai vu une lanterne filer vers le pont. Une lanterne qui zigzaguait drôlement. »'], choices: [] },
      ],
    },
  ],
  screens: [
    {
      id: 'accueil',
      name: 'Accueil',
      blocks: [
        box([
          text(cases([v('urgence', 'eboulement'), '## ⛏️ Mine de Roland\n*🚨 La galerie s’est effondrée ! On entend Roland appeler à l’aide derrière les gravats.*'], [STORM, '## ⛏️ Mine de Roland\n*L’eau ruisselle sur les parois. Roland a fait remonter tout le monde : la mine est fermée pendant la tempête.*'], [mineDamaged, '## ⛏️ Mine de Roland\n*Les étais ont cédé par endroits. On travaille, mais prudemment.*'], [between(25, 85), '## ⛏️ Mine de Roland\n*Une lueur bleutée filtre depuis la galerie profonde, ouverte depuis la trouvaille de Roland.*'], [null, '## ⛏️ Mine de Roland\n*Le tintement des pioches résonne. Roland surveille ses galeries comme un berger ses moutons.*'])),
          text(statusLine),
        ], MINE),
        PRELUDE,
        notice(),
        widget({ kind: 'objective.board', objective: 'eboulement', accent: 0x7a2e2e }, v('urgence', 'eboulement')),
        widget({ kind: 'activity.board', activity: 'secours', accent: 0x7a2e2e }, all(v('urgence', 'eboulement'), T('lt', 100))),
        widget({ kind: 'activity.board', activity: 'travaux', accent: MINE }, notStorm),
        widget({ kind: 'objective.board', objective: 'reparation', accent: MINE }, all(mineDamaged, from(110))),
        navRow('💬 Parler à Roland'),
      ],
    },
    dialogueScreen('roland', MINE),
    inventoryScreen(MINE),
  ],
};

// ---------------------------------------------------------------------------
// Forge du Dragon Noir — Wagner
// ---------------------------------------------------------------------------

const FORGE = 0x9a3b1d;
const forgeDamaged = v('forge_etat', 'endommagee');
const forgeOpen = all(from(0), notStorm, not(forgeDamaged));
const forge = {
  id: 'forge',
  name: 'Forge du Dragon Noir',
  emoji: '🔥',
  accentColor: FORGE,
  npc: { name: 'Wagner', emoji: '🔨', title: 'Maître forgeron' },
  entrance: { text: 'Le souffle du foyer, le chant de l’enclume. Wagner ne lève même pas les yeux.', button: 'Entrer dans la forge', buttonEmoji: '🔥' },
  homeScreen: 'accueil',
  modules: [
    {
      type: 'activity',
      id: 'atelier',
      name: '🔨 Atelier',
      activities: [
        activity('fondre', 'Fondre un lingot', '🔩', { duration: 60, cooldown: 0, costs: [stat('energie', -5), take('minerai', 2)], when: forgeOpen, label: 'Lingot coulé', actions: [give('lingot', 1)], description: '2 minerais → 1 lingot' }),
        activity('ferrure', 'Forger une ferrure', '🔗', { duration: 90, cooldown: 0, costs: [stat('energie', -6), take('lingot', 2)], when: forgeOpen, label: 'Ferrure forgée', actions: [give('ferrure', 1)], description: '2 lingots → 1 ferrure pour la charpente de l’église' }),
        activity('pioche', 'Forger une pioche', '⛏️', { duration: 60, cooldown: 0, costs: [stat('energie', -4), take('lingot', 1), take('buche', 1)], when: forgeOpen, label: 'Pioche neuve', actions: [give('pioche', 1)], description: '1 lingot + 1 bûche → 1 pioche' }),
      ],
    },
    {
      type: 'activity',
      id: 'pompiers',
      name: '🚒 Chaîne de seaux',
      activities: [activity('vider', 'Jeter un seau sur le feu', '🪣', { duration: 0, cooldown: 3, costs: [take('seau', 1)], when: all(v('urgence', 'incendie'), T('lt', 100)), label: 'Pschhh !', actions: [contribute('forge', 'incendie', 'seau', 1)], description: 'Les seaux se remplissent au puits de la Place.' })],
    },
    objective('incendie', '🔥 Incendie : sauver la forge', { seau: 30 }, { description: 'La foudre a frappé la pierre ! 30 seaux d’eau avant **T+100** (puits de la Place).', when: all(v('urgence', 'incendie'), T('lt', 100)), closed: 'Le temps est écoulé.', xp: 3, onComplete: { actions: [voice('wagner-sauve', 'forge')], announce: '🎉 **Le feu est éteint !** Wagner : « Roland avait raison, et je ne le lui dirai jamais. »' } }),
    objective('reparation', '🛠️ Rebâtir la forge', { buche: 20, pierre: 20 }, { description: 'Le toit a brûlé : plus rien ne se forge tant qu’il n’est pas refait.', when: all(forgeDamaged, from(100)), closed: 'Rien à rebâtir.', xp: 2, onComplete: { actions: [set('forge_etat', 'ok')], announce: '🛠️ **La forge est rebâtie !** Wagner rallume le foyer.' } }),
    {
      type: 'dialogue',
      id: 'wagner',
      name: 'Discussion avec Wagner',
      speaker: { name: 'Wagner', emoji: '🔨' },
      narration: 'Wagner pose son marteau, à regret.',
      start: 'accueil',
      nodes: [
        { id: 'accueil', title: '💬 Parler à Wagner', lines: ['« Bienvenue à la Forge du Dragon Noir. Fais attention aux braises : elles ne préviennent pas avant de brûler. »'], choices: [{ label: 'La pierre-tonnerre', emoji: '✨', goto: 'pierre', when: from(30) }, { label: 'Ton avis pour le vote', emoji: '🗳️', goto: 'avis', when: between(45, 65) }, { label: 'Les ferrures', emoji: '🔗', goto: 'ferrures', when: from(110) }, { label: 'La nuit de la tempête', emoji: '🌩️', goto: 'nuit', when: from(110) }] },
        { id: 'pierre', title: '✨ La pierre-tonnerre', lines: ['« Regarde ça. Elle attire la limaille comme un aimant, et elle chauffe sans feu. Avec un métal pareil, on forgerait des merveilles. »'], choices: [] },
        { id: 'avis', title: '🗳️ L’avis de Wagner', lines: ['« Rendre ça à la terre ? Autant jeter de l’or dans la rivière. Laissez-moi l’étudier, je vous promets d’être prudent. »'], choices: [] },
        { id: 'ferrures', title: '🔗 Les ferrures', lines: ['« Le prêtre a besoin de ferrures pour la charpente. Apportez-moi du fer : deux lingots par ferrure, et je vous forge les plus solides de la vallée. »'], choices: [] },
        { id: 'nuit', title: '🌩️ La nuit de la tempête', lines: ['« J’avais autre chose à faire que regarder dehors. Mais Edgar est passé emprunter une corde. En pleine tempête. Drôle d’idée. »'], choices: [] },
      ],
    },
  ],
  screens: [
    {
      id: 'accueil',
      name: 'Accueil',
      blocks: [
        box([
          text(cases([v('urgence', 'incendie'), '## 🔥 Forge du Dragon Noir\n*🚨 LE TOIT BRÛLE ! La foudre est tombée droit sur la pierre-tonnerre. Wagner hurle : « De l’eau ! »*'], [STORM, '## 🔥 Forge du Dragon Noir\n*Wagner a couvert le feu et barricadé la porte. Rien ne se forge pendant la tempête.*'], [forgeDamaged, '## 🔥 Forge du Dragon Noir\n*Le toit n’est plus qu’une charpente noircie. Wagner fouille les cendres.*'], [between(30, 85), '## 🔥 Forge du Dragon Noir\n*Sur l’enclume, une pierre bleutée grésille. Wagner la regarde comme un trésor.*'], [null, '## 🔥 Forge du Dragon Noir\n*Le foyer rugit. Wagner frappe le métal en cadence.*'])),
          text(statusLine),
        ], FORGE),
        PRELUDE,
        notice(),
        widget({ kind: 'objective.board', objective: 'incendie', accent: 0x7a2e2e }, v('urgence', 'incendie')),
        widget({ kind: 'activity.board', activity: 'pompiers', accent: 0x7a2e2e }, all(v('urgence', 'incendie'), T('lt', 100))),
        widget({ kind: 'activity.board', activity: 'atelier', accent: FORGE }, all(notStorm, not(forgeDamaged))),
        widget({ kind: 'objective.board', objective: 'reparation', accent: FORGE }, all(forgeDamaged, from(100))),
        widget({ kind: 'player.tools', title: '🧰 Faire réparer tes outils', repair: { currency: 'ecus', costPerPoint: 1 } }, all(notStorm, not(forgeDamaged))),
        navRow('💬 Parler à Wagner'),
      ],
    },
    dialogueScreen('wagner', FORGE),
    inventoryScreen(FORGE),
  ],
};

// ---------------------------------------------------------------------------
// Forêt de Sylvain
// ---------------------------------------------------------------------------

const FORET = 0x3f6b45;
const foret = {
  id: 'foret',
  name: 'Forêt de Sylvain',
  emoji: '🌲',
  accentColor: FORET,
  npc: { name: 'Sylvain', emoji: '🌲', title: 'Garde-forestier' },
  entrance: { text: 'Sous les grands chênes, Sylvain lit les traces et écoute le vent.', button: 'Entrer dans le bois', buttonEmoji: '🌲' },
  homeScreen: 'accueil',
  audio: royaume.buildings.find((b) => b.id === 'foret')?.audio,
  modules: [
    {
      type: 'activity',
      id: 'bois',
      name: '🌲 Travaux de la forêt',
      activities: [
        activity('abattre', 'Abattre un arbre', '🪓', { duration: 75, cooldown: 0, energy: 6, tool: 'hache', when: all(from(0), notStorm), results: [{ weight: 80, label: 'Belle coupe', actions: [give('buche', 4)] }, { weight: 20, label: 'Chêne noueux', actions: [give('buche', 3), give('champignon', 1)] }], multipliers: [{ when: between(70, 85), factor: 0.75, label: 'vent : −25 %' }] }),
        activity('chablis', 'Débiter le chablis', '🌳', { duration: 60, cooldown: 0, energy: 5, tool: 'hache', when: from(110), description: 'La tempête a couché des arbres : du bois en abondance.', results: [{ weight: 1, label: 'Bois tombé', actions: [give('buche', 6)] }] }),
        activity('ramasser', 'Ramasser du bois mort', '🍂', { duration: 0, cooldown: 45, energy: 2, when: all(from(0), notStorm), label: 'Quelques branches', actions: [give('buche', 1)], description: 'Sans outil.' }),
        activity('champignons', 'Cueillir des champignons', '🍄', { duration: 30, cooldown: 30, energy: 3, when: all(from(0), notStorm), results: [{ weight: 60, label: 'Panier modeste', actions: [give('champignon', 1)] }, { weight: 40, label: 'Bonne cueillette', actions: [give('champignon', 2)] }] }),
        activity('ciel', 'Lire le ciel', '🔭', { duration: 0, cooldown: 60, energy: 1, when: between(35, 85), label: 'Le vent tourne…', actions: [xp(2)], description: 'Sylvain t’apprend à lire les signes de la tempête.' }),
      ],
    },
    {
      type: 'dialogue',
      id: 'sylvain',
      name: 'Discussion avec Sylvain',
      speaker: { name: 'Sylvain', emoji: '🌲' },
      narration: 'Sylvain s’adosse à un chêne, l’œil sur la cime des arbres.',
      start: 'accueil',
      nodes: [
        { id: 'accueil', title: '💬 Parler à Sylvain', lines: [cases([between(35, 85), '« Les oiseaux se taisent et les cerfs descendent vers la rivière. Ça, c’est jamais bon signe. »'], [from(110), '« La tempête a fait le travail de dix bûcherons. Ramassez tout ce bois : le chantier en aura besoin. »'], [null, '« Bienvenue dans mon bois. Coupe ce qu’il te faut, mais pas plus : les arbres ont la mémoire longue. »'])], choices: [{ label: 'La nuit de la tempête', emoji: '🌩️', goto: 'nuit', when: from(110) }] },
        { id: 'nuit', title: '🌩️ La nuit de la tempête', lines: ['« J’ai entendu le grand chêne céder vers l’église. Et juste avant… une silhouette qui chantait. Faux. Très faux. »'], choices: [] },
      ],
    },
  ],
  screens: [
    {
      id: 'accueil',
      name: 'Accueil',
      guard: { when: notStorm, redirect: 'ferme' },
      blocks: [
        box([
          text(cases([from(110), '## 🌲 Forêt de Sylvain\n*Des arbres couchés partout. Sylvain marque à la craie ceux qu’on peut débiter.*'], [between(70, 85), '## 🌲 Forêt de Sylvain\n*Le vent se lève. Les branches s’agitent ; Sylvain presse tout le monde.*'], [null, '## 🌲 Forêt de Sylvain\n*Les grands chênes bruissent. Sylvain, le garde-forestier, veille sur ses arbres.*'])),
          text(statusLine),
        ], FORET),
        PRELUDE,
        notice(),
        widget({ kind: 'activity.board', activity: 'bois', accent: FORET }),
        clue(3, 'Une lanterne au pied de l’église', 'la lanterne d’Edgar, gravée « G.C. », retrouvée au pied de l’église.', from(110)),
        navRow('💬 Parler à Sylvain'),
      ],
    },
    closedScreen('## 🌲 Forêt fermée\n*Sylvain barre le sentier : « Tout le monde dehors ! Les branches tombent comme des lances. » Revenez après la tempête.*'),
    dialogueScreen('sylvain', FORET),
    inventoryScreen(FORET),
  ],
};

// ---------------------------------------------------------------------------
// Ferme d'Agathe
// ---------------------------------------------------------------------------

const FERME = 0xb08d2f;
const ferme = {
  id: 'ferme',
  name: 'Ferme d’Agathe',
  emoji: '🌾',
  accentColor: FERME,
  npc: { name: 'Agathe', emoji: '🌾', title: 'Régisseuse' },
  entrance: { text: 'Poules, bottes de foin et Agathe qui distribue des ordres à tout le monde.', button: 'Entrer à la ferme', buttonEmoji: '🌾' },
  homeScreen: 'accueil',
  modules: [
    {
      type: 'activity',
      id: 'travaux',
      name: '🌾 Travaux de la ferme',
      activities: [
        activity('oeufs', 'Ramasser les œufs', '🥚', { duration: 45, cooldown: 0, energy: 3, when: all(from(0), notStorm), results: [{ weight: 1, label: 'Panier d’œufs', actions: [give('oeuf', 3)] }] }),
        activity('legumes', 'Cueillir des légumes', '🥕', { duration: 60, cooldown: 0, energy: 4, when: all(from(0), notStorm), results: [{ weight: 1, label: 'Légumes du potager', actions: [give('legumes', 3)] }], description: 'Edgar les rachète pour sa cuisine.' }),
        activity('moisson', 'Moissonner', '🌾', { duration: 60, cooldown: 0, energy: 5, when: all(from(0), notStorm), results: [{ weight: 1, label: 'Gerbes de blé', actions: [give('gerbe', 2)] }], multipliers: [{ when: between(55, 85), factor: 2, label: 'dernière récolte : ×2' }] }),
        activity('moudre', 'Moudre du grain', '⚙️', { duration: 0, cooldown: 20, costs: [stat('energie', -2), take('gerbe', 2)], when: all(from(0), notStorm), label: 'Farine fraîche', actions: [give('farine', 3)], description: '2 gerbes → 3 farines (pour le pain d’Edgar)' }),
      ],
    },
    objective('recolte', '🌾 La dernière récolte', { gerbe: 60 }, { description: 'Rentrer 60 gerbes avant l’orage (**T+85**). Sinon, pas de soupe pour personne pendant la tempête !', when: between(55, 85), closed: cases([T('lt', 55), 'Agathe sonnera l’heure de la dernière récolte à T+55.'], [null, 'La récolte est terminée.']), xp: 1, quantities: [2, 10], onComplete: { actions: [set('recolte', 'reussie'), voice('agathe-reussi', 'ferme')], announce: '🌾 **La récolte est rentrée !** Le grenier d’Agathe est plein à craquer.' } }),
    {
      type: 'dialogue',
      id: 'agathe',
      name: 'Discussion avec Agathe',
      speaker: { name: 'Agathe', emoji: '🌾' },
      narration: 'Agathe essuie ses mains sur son tablier.',
      start: 'accueil',
      nodes: [
        { id: 'accueil', title: '💬 Parler à Agathe', lines: [cases([between(55, 85), '« Tout le monde aux champs ! Si l’orage arrive avant qu’on ait rentré le grain, on mangera de la paille tout l’hiver. »'], [null, '« Des bras ! Enfin ! Les œufs sont au poulailler, le puits est sur la Place, et les bottes sont à tes risques. »'])], choices: [{ label: 'La nuit de la tempête', emoji: '🌩️', goto: 'nuit', when: from(110) }] },
        { id: 'nuit', title: '🌩️ La nuit de la tempête', lines: ['« Pendant la tempête, j’ai vu quelqu’un courir vers le pont avec un long paquet sous le bras. Gros, la barbe au vent… Je n’en dis pas plus. »'], choices: [] },
      ],
    },
  ],
  screens: [
    {
      id: 'accueil',
      name: 'Accueil',
      guard: { when: notStorm, redirect: 'ferme' },
      blocks: [
        box([text(cases([between(55, 85), '## 🌾 Ferme d’Agathe\n*Le ciel noircit. Agathe a sonné la dernière récolte : tout le monde aux champs !*'], [from(110), '## 🌾 Ferme d’Agathe\n*La grange a tenu bon. Agathe compte ses poules, une par une.*'], [null, '## 🌾 Ferme d’Agathe\n*Les poules caquettent, le blé ondule. Agathe distribue des paniers.*'])), text(statusLine)], FERME),
        PRELUDE,
        notice(),
        widget({ kind: 'objective.board', objective: 'recolte', accent: FERME }, from(55)),
        widget({ kind: 'activity.board', activity: 'travaux', accent: FERME }),
        clue(4, 'Le témoignage d’Agathe', 'Agathe a vu quelqu’un courir sous la pluie avec un long paquet, la barbe au vent.', from(110)),
        navRow('💬 Parler à Agathe'),
      ],
    },
    closedScreen('## 🌾 Ferme fermée\n*Agathe a tout barricadé. Les bêtes sont à l’abri, et toi aussi tu devrais l’être !*'),
    dialogueScreen('agathe', FERME),
    inventoryScreen(FERME),
  ],
};

// ---------------------------------------------------------------------------
// Vieux pont de Valbrume
// ---------------------------------------------------------------------------

const PONT = 0x3b6e8f;
const pont = {
  id: 'pont',
  name: 'Vieux pont de Valbrume',
  emoji: '🌉',
  accentColor: PONT,
  entrance: { text: 'Le passage vers l’autre rive, et vers l’église. La rivière chante sous les arches.', button: 'S’avancer sur le pont', buttonEmoji: '🌉' },
  homeScreen: 'accueil',
  modules: [
    {
      type: 'activity',
      id: 'riviere',
      name: '🎣 La rivière',
      activities: [activity('peche', 'Pêcher', '🎣', { duration: 60, cooldown: 0, energy: 3, tool: 'canne', when: from(0), results: [{ weight: 75, label: 'Une truite', actions: [give('poisson', 1)] }, { weight: 25, label: 'Deux poissons !', actions: [give('poisson', 2)] }], multipliers: [{ when: between(70, 85), factor: 2, label: 'rivière gonflée : ×2' }] })],
    },
  ],
  screens: [
    {
      id: 'accueil',
      name: 'Accueil',
      guard: { when: notStorm, redirect: 'ferme' },
      blocks: [
        box([text(cases([from(110), '## 🌉 Vieux pont de Valbrume\n*Le pont a tenu. Sur l’autre rive, l’église éventrée fait peine à voir.*'], [between(70, 85), '## 🌉 Vieux pont de Valbrume\n*La rivière gonfle et charrie des branches. Les poissons se pressent sous les arches.*'], [null, '## 🌉 Vieux pont de Valbrume\n*Le vieux pont enjambe la rivière. De l’autre côté, le clocher de la Sainte Pelle.*'])), text(statusLine)], PONT),
        PRELUDE,
        notice(),
        widget({ kind: 'activity.board', activity: 'riviere', accent: PONT }),
        clue(2, 'Des traces de boue', 'de grosses bottes, une démarche titubante, qui filent vers la taverne.', from(110)),
        buttons([go('🎒 Mon inventaire', 'inventaire'), go('🔄 Actualiser', 'accueil')]),
      ],
    },
    closedScreen('## 🌉 Pont fermé\n*Les eaux déchaînées lèchent le tablier. Personne ne passe tant que l’orage n’est pas fini.*'),
    inventoryScreen(PONT),
  ],
};

// ---------------------------------------------------------------------------
// Église de la Sainte Pelle — Père Anselme
// ---------------------------------------------------------------------------

const EGLISE = 0x6e5a9a;
const eglise = {
  id: 'eglise',
  name: 'Église de la Sainte Pelle',
  emoji: '⛪',
  accentColor: EGLISE,
  npc: { name: 'Père Anselme', emoji: '⛪', title: 'Prêtre' },
  entrance: { text: 'La petite église de Valbrume, de l’autre côté du pont. Sur l’autel brille la Sainte Pelle.', button: 'Entrer dans l’église', buttonEmoji: '⛪' },
  homeScreen: 'accueil',
  modules: [
    {
      type: 'activity',
      id: 'priere',
      name: '🙏 Recueillement',
      activities: [activity('prier', 'Prier', '🙏', { duration: 0, cooldown: 300, costs: [], when: all(from(0), T('lt', 170)), label: 'Un moment de paix', actions: [stat('energie', 5)], multipliers: [], description: 'Un instant de calme rend des forces.' })],
    },
    {
      type: 'activity',
      id: 'travaux',
      name: '🪚 Travaux du chantier',
      activities: [
        activity('arbre', 'Dégager l’arbre', '🌿', { duration: 90, cooldown: 0, energy: 6, tool: 'hache', when: between(110, 170), maxConcurrent: 4, label: 'Branches dégagées', actions: [contribute('eglise', 'arbre', 'branche', 1), xp(5)], description: '4 personnes au maximum en même temps.' }),
        activity('assembler', 'Assembler la charpente', '🪚', { duration: 120, cooldown: 0, energy: 8, when: all(between(110, 170), obj('eglise', 'arbre', 'gte', 100), obj('eglise', 'chantier', 'gte', 70)), maxConcurrent: 3, label: 'Poutres en place', actions: [contribute('eglise', 'assemblage', 'assemblage', 1), xp(10)], description: 'Possible quand l’arbre est dégagé et 70 % des matériaux livrés.' }),
      ],
    },
    objective('arbre', '🌿 Dégager l’arbre', { branche: 12 }, { description: 'Le grand chêne bloque la nef.', when: between(110, 170), closed: 'Hors des heures du chantier.', onComplete: { actions: [], announce: '🌿 **L’arbre est dégagé !** La nef de la Sainte Pelle est accessible.' } }),
    objective('chantier', '⛪ Matériaux du chantier', { buche: 40, pierre: 30, ferrure: 6, gamelle_soupe: 6, pain_emballe: 6 }, { description: 'Le bois, la pierre, les ferrures de Wagner et de quoi nourrir les ouvriers.', when: between(110, 170), closed: cases([T('lt', 110), 'Le chantier ouvrira après la tempête.'], [null, 'La messe a commencé : le chantier est clos.']), xp: 2, onComplete: { actions: [], announce: '⛪ **Tous les matériaux sont livrés !**' } }),
    objective('assemblage', '🪚 La charpente', { assemblage: 3 }, { description: 'Trois assemblages pour couvrir la nef.', when: between(110, 170), closed: 'Hors des heures du chantier.', onComplete: { actions: [], announce: '🪚 **La charpente est posée !** L’église a de nouveau un toit.' } }),
    {
      type: 'dialogue',
      id: 'anselme',
      name: 'Discussion avec le Père Anselme',
      speaker: { name: 'Père Anselme', emoji: '⛪' },
      narration: 'Le Père Anselme range ses cierges avec soin.',
      start: 'accueil',
      nodes: [
        { id: 'accueil', title: '💬 Parler au Père Anselme', lines: [cases([from(110), '« L’arbre a crevé la nef, mais les murs tiennent. Avec vos bras, nous relèverons cette église avant la messe. »'], [null, '« Entre, mon enfant. Voici la Sainte Pelle : celle qui creusa le premier puits de Valbrume. Ce soir, nous la bénirons comme chaque année. »'])], choices: [{ label: 'Ton avis pour le vote', emoji: '🗳️', goto: 'avis', when: between(45, 65) }, { label: 'La relique', emoji: '✨', goto: 'relique', when: from(100) }] },
        { id: 'avis', title: '🗳️ L’avis du Père Anselme', lines: ['« Ce qui dort sous la montagne doit y dormir. Rendez cette pierre à la terre, je vous en prie. »'], choices: [] },
        { id: 'relique', title: '✨ La Sainte Pelle', lines: [cases([v('indice6', 'oui'), '« Edgar… Notre sacristain l’a mise à l’abri dans sa cave. Je ne sais pas si je dois le bénir ou le gronder. »'], [null, '« Le reliquaire est vide. Qui a pu faire une chose pareille, par une nuit pareille ? »'])], choices: [] },
      ],
    },
  ],
  screens: [
    {
      id: 'accueil',
      name: 'Accueil',
      guard: { when: notStorm, redirect: 'ferme' },
      blocks: [
        box([
          text(cases([v('acte', 'fin'), '## ⛪ Église de la Sainte Pelle\n{var.fin.label}'], [from(110), '## ⛪ Église de la Sainte Pelle\n*Un chêne a crevé la nef. Le reliquaire est vide. Le Père Anselme organise le chantier sur le parvis.*'], [null, '## ⛪ Église de la Sainte Pelle\n*Sur l’autel brille la Sainte Pelle, la pelle du fondateur. Le Père Anselme allume les cierges.*'])),
          text(statusLine),
        ], EGLISE),
        PRELUDE,
        notice(),
        widget({ kind: 'activity.board', activity: 'priere', accent: EGLISE }, T('lt', 110)),
        buttons([go('🪚 Le chantier', 'chantier', { style: 'success' })], from(110)),
        clue(1, 'Le reliquaire vide', 'le verrou du reliquaire n’est pas forcé : on l’a ouvert avec une clé.', from(110)),
        navRow('💬 Parler au Père Anselme'),
      ],
    },
    {
      id: 'chantier',
      name: 'Chantier',
      blocks: [
        notice(),
        widget({ kind: 'objective.board', objective: 'arbre', accent: EGLISE }),
        widget({ kind: 'objective.board', objective: 'chantier', accent: EGLISE }),
        widget({ kind: 'objective.board', objective: 'assemblage', accent: EGLISE }),
        widget({ kind: 'activity.board', activity: 'travaux', accent: EGLISE }),
        buttons([go('↩️ Retour', 'accueil'), go('🎒 Mon inventaire', 'inventaire'), go('🔄 Actualiser', 'chantier')]),
      ],
    },
    closedScreen('## ⛪ Église inaccessible\n*Le pont est fermé : impossible de rejoindre l’église tant que l’orage gronde.*'),
    dialogueScreen('anselme', EGLISE),
    inventoryScreen(EGLISE),
  ],
};

// ---------------------------------------------------------------------------
// Quêtes personnelles
// ---------------------------------------------------------------------------

const q = (id, name, giver, difficulty, when, steps, o = {}) => ({ id, name, giver, difficulty, ...(when ? { when } : {}), steps, rewards: o.rewards ?? [], ...(o.description ? { description: o.description } : {}), ...(o.featured ? { featured: true } : {}), ...(difficulty === 3 ? { unique: true } : {}), ...(o.ordered ? { ordered: true } : {}), ...(o.success ? { success: o.success } : {}), ...(o.emoji ? { emoji: o.emoji } : {}) });
const visit = (id, label, building) => ({ id, kind: 'visit', label, building });
const deliver = (id, label, item, qty, building) => ({ id, kind: 'deliver', label, item, qty, building });
const count = (id, label, tags, target = 1) => ({ id, kind: 'count', label, tags: Array.isArray(tags) ? tags : [tags], target });
const revealClue = (n, found) => ifThen(v(`indice${n}`, 'non'), [set(`indice${n}`, 'oui'), add('indices', 1), announce(`🔎 **Indice ${n}/6 trouvé :** ${found}`)]);

const quests = [
  q('q01', 'Premiers pas', 'Maëlis', 1, from(0), [{ id: 'lieux', kind: 'visit', label: 'Visiter 4 lieux différents', count: 4 }], { featured: true, description: 'Fais le tour du village : chaque lieu a son salon vocal.' }),
  q('q02', 'Une chope pour la route', 'Edgar', 1, between(0, 85), [count('boire', 'Commander une boisson au comptoir de la taverne', 'shop:taverne/comptoir')]),
  q('q03', 'Le bois du bûcher', 'Sylvain', 1, between(0, 60), [count('abattre', 'Abattre un arbre en forêt', 'activity:foret/abattre'), count('bucher', 'Apporter 4 bûches à la fête (Place)', 'objective:place/fete:buche', 4)], { ordered: true }),
  q('q04', 'Œufs frais', 'Agathe', 1, between(0, 85), [deliver('oeufs', 'Livrer 4 œufs à Edgar (Taverne)', 'oeuf', 4, 'taverne')]),
  q('q05', 'Premier coup de pioche', 'Roland', 1, between(0, 85), [count('pierres', 'Extraire des pierres à la mine', 'activity:mine/pierres')]),
  q('q06', 'Le poisson du soir', 'Maëlis', 1, between(0, 85), [count('peche', 'Pêcher 2 fois au vieux pont', 'activity:pont/peche', 2)]),
  q('q07', 'Bénédiction', 'Père Anselme', 1, between(0, 85), [count('prier', 'Prier à l’église', 'activity:eglise/prier')]),
  q('q08', 'Un manche neuf', 'Wagner', 1, from(0), [deliver('bois', 'Livrer 2 bûches à la forge', 'buche', 2, 'forge')]),
  q('q09', 'Le panier de champignons', 'Sylvain', 1, between(0, 85), [count('cueillir', 'Cueillir des champignons 2 fois', 'activity:foret/champignons', 2)]),
  q('q10', 'L’eau du puits', 'Agathe', 1, between(0, 85), [deliver('seaux', 'Livrer 3 seaux d’eau à la taverne', 'seau', 3, 'taverne')]),
  q('q11', 'Rumeurs de comptoir', 'Edgar', 1, between(25, 85), [count('rumeurs', 'Écouter Edgar parler de la pierre (2 rumeurs)', ['dialogue:taverne/pierre1', 'dialogue:taverne/pierre2'], 2)]),
  q('q12', 'Lanternes de fête', 'Maëlis', 1, between(0, 60), [count('fete', 'Contribuer à « Préparer la fête »', 'objective:place/fete')]),
  q('q13', 'Ramasser les branches', 'Sylvain', 1, from(110), [count('chablis', 'Débiter le chablis 2 fois', 'activity:foret/chablis', 2)]),
  q('q14', 'Soupe pour les sinistrés', 'Edgar', 1, between(110, 170), [count('soupe', 'Apporter 2 soupes en gamelle au chantier', 'objective:eglise/chantier:gamelle_soupe', 2)]),
  q('q15', 'Le repas du travailleur', 'Edgar', 2, from(0), [count('travail', 'Travailler en forêt ou à la mine', ['activity:foret/abattre', 'activity:foret/chablis', 'activity:mine/pierres', 'activity:mine/minerai']), count('ragout', 'Manger un ragoût de sanglier', ['consume:plat_ragout', 'consume:gamelle_ragout'])]),
  q('q16', 'Fer pour Wagner', 'Wagner', 2, from(0), [deliver('minerai', 'Livrer 4 minerais à la forge', 'minerai', 4, 'forge')]),
  q('q17', 'Métal utile', 'Wagner', 2, from(0), [count('fondre', 'Fondre 2 lingots', 'activity:forge/fondre', 2)]),
  q('q18', 'Outil fatigué', 'Wagner', 2, from(0), [count('reparer', 'Faire réparer un outil à la forge', 'repair')]),
  q('q19', 'Les poissons d’Edgar', 'Edgar', 2, between(0, 85), [deliver('poissons', 'Livrer 4 poissons à Edgar', 'poisson', 4, 'taverne')]),
  q('q20', 'La galerie profonde', 'Roland', 2, between(25, 85), [count('galerie', 'Creuser 2 fois dans la galerie profonde', 'activity:mine/galerie', 2)]),
  q('q21', 'Lire le ciel', 'Sylvain', 2, between(35, 85), [count('ciel', 'Lire le ciel 3 fois en forêt', 'activity:foret/ciel', 3)]),
  q('q22', 'Sacs de grain', 'Agathe', 2, between(55, 85), [count('gerbes', 'Rentrer 8 gerbes pour la dernière récolte', 'objective:ferme/recolte', 8)]),
  q('q23', 'Ma voix compte', 'Maëlis', 2, between(45, 65), [count('roland', 'Écouter l’avis de Roland (mine)', 'dialogue:mine/avis'), count('wagner', 'Écouter l’avis de Wagner (forge)', 'dialogue:forge/avis'), count('vote', 'Voter au conseil de la pierre (Place)', 'vote')], { ordered: true }),
  q('q24', 'Bâcher les toits', 'Maëlis', 2, between(70, 85), [deliver('bois', 'Livrer 4 bûches sur la Place', 'buche', 4, 'place')]),
  q('q25', 'Pierres pour les murs', 'Père Anselme', 2, between(110, 170), [count('pierres', 'Apporter 8 pierres au chantier', 'objective:eglise/chantier:pierre', 8)]),
  q('q26', 'Le témoin', 'Maëlis', 2, from(110), [count('temoins', 'Interroger 2 habitants sur la nuit de la tempête', ['dialogue:place/nuit', 'dialogue:mine/nuit', 'dialogue:forge/nuit', 'dialogue:foret/nuit', 'dialogue:ferme/nuit', 'dialogue:taverne/relique'], 2)], { rewards: [revealClue(4, 'Agathe a vu quelqu’un courir sous la pluie avec un long paquet, la barbe au vent.')] }),
  q('q27', 'La ferrure sacrée', 'Wagner', 3, between(110, 170), [count('forger', 'Forger 2 ferrures', 'activity:forge/ferrure', 2), count('livrer', 'Apporter 2 ferrures au chantier', 'objective:eglise/chantier:ferrure', 2)], { ordered: true, rewards: [give('titre_forgeron')] }),
  q('q28', 'Le banquet royal', 'Edgar', 3, from(0), [count('banquet', 'Cuisiner ou commander un Banquet royal', ['cook:taverne/royal', 'buy:taverne/royal'])], { rewards: [give('flasque_hydromel')] }),
  q('q29', 'Le cœur de la montagne', 'Roland', 3, from(25), [deliver('eclat', 'Trouver un éclat de pierre-tonnerre (galerie profonde) et le porter à Wagner', 'eclat', 1, 'forge')], { rewards: [give('eclat_poli')] }),
  q('q30', 'Maître des dés', 'Edgar', 3, between(0, 85), [count('des', 'Gagner 3 parties de dés contre Edgar', 'dice:taverne/des:win', 3)], { rewards: [give('titre_fine_gueule')] }),
  q('q31', 'Le grenier plein', 'Agathe', 3, between(55, 85), [count('gerbes', 'Rentrer 20 gerbes pour la dernière récolte', 'objective:ferme/recolte', 20)], { rewards: [give('panier_agathe', 2)] }),
  q('q32', 'Charpentier', 'Sylvain', 3, between(110, 170), [count('bois', 'Apporter 15 bûches au chantier', 'objective:eglise/chantier:buche', 15)], { rewards: [give('hache_maitre')] }),
  q('q33', 'Héros de la tempête', 'Maëlis', 3, between(90, 100), [count('urgence', 'Contribuer 5 fois à l’urgence (forge ou mine)', ['objective:forge/incendie', 'objective:mine/eboulement'], 5)], { rewards: [give('titre_heros')] }),
  q('q34', 'Pister la relique', 'Sylvain', 3, from(110), [visit('pont', 'Suivre les traces jusqu’au vieux pont', 'pont'), visit('foret', 'Puis jusqu’à la forêt', 'foret'), visit('taverne', 'Puis jusqu’à la taverne', 'taverne')], { ordered: true, rewards: [revealClue(2, 'de grosses bottes, une démarche titubante, qui filent vers la taverne.')] }),
  q('q35', 'La cave d’Edgar', 'Edgar', 3, all(from(110), v('indices', 5, 'gte'), v('indice6', 'non')), [deliver('hydromel', 'Offrir 3 flasques d’hydromel à Edgar', 'flasque_hydromel', 3, 'taverne')], { rewards: [give('titre_limier'), set('indice6', 'oui'), add('indices', 1), voice('edgar-aveu', 'taverne'), announce('🍯 **Indice 6/6 : Edgar se souvient !** Il a caché la Sainte Pelle dans sa cave pour la protéger de la tempête… puis il a fêté ça. La relique est retrouvée !')], success: '« Attends… La cave ! Pardonnez-moi, mon Père ! »' }),
  q('q36', 'La dîme du Royaume', 'Maëlis', 3, from(0), [count('don', 'Verser 100 écus au Trésor du Royaume (Place)', 'objective:place/tresor', 100)], { rewards: [give('titre_bienfaiteur')] }),
];

// ---------------------------------------------------------------------------
// Le scénario : 180 minutes, lancé depuis la page « En direct » du Studio
// ---------------------------------------------------------------------------

const step = (afterMinutes, name, actions, text) => ({ afterMinutes, name, actions: [set('t', afterMinutes), ...actions], ...(text ? { announce: text } : {}) });

const scenario = {
  id: 'scenario',
  name: 'La Nuit de la Sainte Pelle',
  emoji: '🔔',
  description: 'Bêta KE4 : 3 heures, de la veille de fête à la messe. À lancer depuis cette page ; la pause fige l’horloge.',
  schedule: { type: 'manual' },
  durationMinutes: 181,
  onStart: [set('t', 0), set('acte', 'veille'), set('phase', 'calme'), set('meteo', 'soleil'), set('pierre', 'inconnue'), set('votes_mine', 0), set('votes_forge', 0), set('fete', 'en_cours'), set('recolte', 'en_cours'), set('urgence', 'aucune'), set('urgence_res', 'aucune'), set('forge_etat', 'ok'), set('mine_etat', 'ok'), set('indices', 0), ...[1, 2, 3, 4, 5, 6].map((n) => set(`indice${n}`, 'non')), set('eglise_ok', 'non'), set('fin', 'aucune'), voice('maelis-ouverture', 'place')],
  steps: [
    step(10, 'Tournée d’ouverture', [voice('edgar-tournee', 'taverne')], '🍻 **Tournée d’ouverture à la taverne !** Edgar offre la première chope pendant 10 minutes.'),
    step(20, 'Bénédiction des outils', [voice('anselme-benediction', 'eglise')], '⛪ Le Père Anselme bénit les outils avant la fête. Passez prier à l’église !'),
    step(25, 'La trouvaille de Roland', [voice('roland-trouvaille', 'mine')], '✨ **Roland a trouvé quelque chose !** Une pierre qui grésille au fond de la mine. La galerie profonde est ouverte.'),
    step(30, 'Wagner étudie la pierre', [voice('wagner-etude', 'forge')], '🔥 Wagner a emporté la pierre-tonnerre à la forge pour l’étudier.'),
    step(35, 'Les signes', [set('acte', 'signes'), set('meteo', 'nuages'), voice('sylvain-signes', 'foret')], '⛅ Des nuages lourds glissent sur la vallée. Sylvain trouve les oiseaux bien silencieux…'),
    step(45, 'Le conseil de la pierre', [voice('maelis-conseil', 'place')], '🗳️ **Le conseil de la pierre est ouvert sur la Place !** Rendre la pierre à la mine, ou la garder à la forge ? Une voix chacun, jusqu’à T+65.'),
    step(55, 'La dernière récolte', [voice('agathe-recolte', 'ferme')], '🌾 **Agathe sonne la dernière récolte !** 60 gerbes à rentrer avant l’orage (T+85). La moisson rapporte double.'),
    step(60, 'Fin des préparatifs', [ifThen(obj('place', 'fete', 'gte', 100), [set('fete', 'reussie'), { type: 'players.each', actions: [xp(20)] }], [set('fete', 'maigre')])], cases([v('fete', 'reussie'), '🎉 **Les préparatifs sont terminés : la fête sera belle !** +20 XP pour tout le village.'], [null, '🥖 Les préparatifs sont terminés… le banquet sera maigre.'])),
    step(65, 'Verdict du conseil', [ifThen({ type: 'compare', left: 'votes_forge', op: 'gt', right: 'votes_mine' }, [set('pierre', 'forge'), voice('maelis-verdict-forge', 'place'), voice('roland-victoire', 'mine')], [set('pierre', 'mine'), voice('maelis-verdict-mine', 'place')])], cases([v('pierre', 'forge'), '🔥 **Le village a parlé : la pierre reste à la forge.** ({var.votes_forge} voix contre {var.votes_mine}). Roland marmonne que ça finira mal.'], [null, '⛏️ **Le village a parlé : la pierre retourne au fond de la mine.** ({var.votes_mine} voix contre {var.votes_forge}). Wagner fait la tête.'])),
    step(70, 'Le vent tourne', [set('meteo', 'pluie'), voice('sylvain-vent', 'foret')], '🌧️ **Le vent tourne.** La pluie tombe ; en forêt, on coupe moins vite. Au pont, la rivière gonflée regorge de poissons.'),
    step(80, 'Les cloches', [voice('anselme-cloches', 'eglise')], '🔔 **Les cloches sonnent l’alerte !** Mettez-vous à l’abri, le ciel n’a jamais été aussi noir.'),
    step(85, 'La tempête éclate', [set('acte', 'tempete'), set('phase', 'tempete'), set('meteo', 'orage'), ifThen(v('recolte', 'reussie'), [voice('edgar-refuge-soupe', 'taverne')], [set('recolte', 'ratee'), voice('agathe-rate', 'ferme'), voice('edgar-refuge-cher', 'taverne')]), voice('sylvain-fermeture', 'foret')], cases([v('recolte', 'reussie'), '⛈️ **LA TEMPÊTE ÉCLATE !** Forêt, ferme, pont et église sont fermés. Réfugiez-vous à la taverne : la soupe y est offerte !'], [null, '⛈️ **LA TEMPÊTE ÉCLATE !** Forêt, ferme, pont et église sont fermés. Réfugiez-vous à la taverne… la récolte est perdue, Edgar rationne.'])),
    step(90, 'La foudre', [ifThen(v('pierre', 'forge'), [set('urgence', 'incendie'), voice('wagner-incendie', 'forge'), voice('maelis-puits', 'place')], [set('urgence', 'eboulement'), voice('roland-eboulement', 'mine')])], cases([v('urgence', 'incendie'), '🔥🚨 **LA FOUDRE EST TOMBÉE SUR LA FORGE !** La pierre-tonnerre l’a attirée. Seaux au puits de la Place, puis à la forge : 30 seaux en 10 minutes !'], [null, '🪨🚨 **ÉBOULEMENT À LA MINE !** La pierre-tonnerre a fait trembler la montagne. Roland est coincé : 30 coups de pioche en 10 minutes !'])),
    step(97, 'Craquement', [voice('sylvain-craquement', 'foret')], '🌳 Un craquement immense dans la vallée… Un grand chêne vient de céder, vers l’autre rive. Vers l’église.'),
    step(100, 'La relique a disparu', [ifThen(any(all(v('urgence', 'incendie'), obj('forge', 'incendie', 'gte', 100)), all(v('urgence', 'eboulement'), obj('mine', 'eboulement', 'gte', 100))), [set('urgence_res', 'reussie'), { type: 'players.each', actions: [xp(10)] }], [set('urgence_res', 'ratee'), ifThen(v('urgence', 'incendie'), [set('forge_etat', 'endommagee')], [set('mine_etat', 'endommagee')])]), set('urgence', 'aucune'), voice('anselme-disparition', 'eglise')], cases([v('urgence_res', 'reussie'), '✅ **L’urgence est maîtrisée !** +10 XP pour tous.\n⛪ Mais à l’église, le Père Anselme découvre l’impensable : **la Sainte Pelle a disparu !**'], [null, '❌ **Trop tard : les dégâts sont lourds.** Il faudra réparer.\n⛪ Et à l’église, le Père Anselme découvre l’impensable : **la Sainte Pelle a disparu !**'])),
    step(105, 'Le vent faiblit', [set('meteo', 'pluie_fine')], '🌦️ Le vent faiblit. La pluie n’est plus qu’une bruine.'),
    step(110, 'Relever le Royaume', [set('acte', 'releve'), set('phase', 'apres'), voice('anselme-chantier', 'eglise'), voice('sylvain-chablis', 'foret'), voice('wagner-ferrures', 'forge')], '⛪ **Le pont rouvre. Relevons le Royaume !** Un chêne a crevé la nef de l’église : le chantier est ouvert. Et l’enquête commence : où est la Sainte Pelle ?'),
    step(130, 'Éclaircie', [set('meteo', 'soleil')], '☀️ Une éclaircie perce les nuages au-dessus de Valbrume.'),
    step(135, 'Point d’étape', [voice('maelis-etape', 'place')], '📜 **Point d’étape de Maëlis :** chantier à {objective.eglise.chantier} %, arbre dégagé à {objective.eglise.arbre} %, indices {var.indices}/6. Plus que 35 minutes avant la messe !'),
    step(160, 'Appel à la messe', [voice('anselme-appel-messe', 'eglise')], '🔔 **Dans dix minutes, le Père Anselme célèbre la messe de la Sainte Pelle.** Dernières livraisons !'),
    step(170, 'La messe', [
      ifThen(all(obj('eglise', 'arbre', 'gte', 100), obj('eglise', 'chantier', 'gte', 70), obj('eglise', 'assemblage', 'gte', 100)), [set('eglise_ok', 'oui')]),
      ifThen(v('eglise_ok', 'oui'), [ifThen(v('indices', 6, 'gte'), [set('fin', 'triomphe'), voice('anselme-messe-triomphe', 'eglise')], [set('fin', 'sans_ame'), voice('anselme-messe-vide', 'eglise')])], [ifThen(v('indices', 6, 'gte'), [set('fin', 'parvis'), voice('anselme-messe-parvis', 'eglise')], [set('fin', 'report'), voice('anselme-messe-report', 'eglise')])]),
    ], cases([v('fin', 'triomphe'), '🔔 **LA SAINTE PELLE TRIOMPHANTE !** Messe dans la nef rebâtie, la relique sur l’autel. Les cloches sonnent dans toute la vallée !'], [v('fin', 'sans_ame'), '🧱 **Des pierres sans âme.** Messe dans l’église neuve, mais l’autel est vide. Quelqu’un a vu une lueur au fond de la galerie profonde…'], [v('fin', 'parvis'), '🙏 **La foi sur le parvis.** Messe en plein air devant les échafaudages, la relique brandie par le Père Anselme.'], [null, '🌧️ **La messe reportée.** Le Père Anselme prie depuis le pont, devant une église en ruine. Le chantier continue la semaine prochaine.'])),
    step(180, 'Fin de séance', [set('acte', 'fin'), voice('maelis-fin', 'place'), ifThen(v('fin', 'triomphe'), [voice('edgar-tournee-finale', 'taverne')])], cases([v('fete', 'reussie'), '🎉 **Fin de la séance bêta.** Le banquet de la Sainte Pelle est servi ! Merci à tous : le tableau d’honneur est sur la Place, et le monde reste ouvert.'], [null, '🔔 **Fin de la séance bêta.** Merci à tous ! Le tableau d’honneur est sur la Place, et le monde reste ouvert.'])),
  ],
  onEnd: [],
  announce: { start: '🔔 **La fête de la Sainte Pelle commence à Valbrume !** Rendez-vous sur la Place du village : Maëlis vous attend avec le panneau des quêtes.' },
};

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

const world = {
  format: 'kingdom-world@1',
  id: 'sainte-pelle',
  name: 'La Nuit de la Sainte Pelle',
  description: 'Bêta KE4 : 3 heures pour 8 joueurs. Une pierre tombée du ciel, une tempête, une relique disparue. Lancez le scénario depuis la page En direct.',
  settings: { maxActiveJobs: 1, timezone: 'Europe/Paris' },
  events: [scenario],
  stats,
  items,
  modifiers: royaume.modifiers,
  jobs: royaume.jobs.filter((j) => j.id === 'cuisinier'),
  variables,
  newPlayer: { items: { hache: 1, pioche: 1, canne: 1 } },
  quests: {
    xpStat: 'xp',
    offers: 4,
    rerollMinutes: 15,
    levels: [
      { name: 'Habitant', emoji: '🏠', minXp: 0, weights: [70, 30, 0] },
      { name: 'Compagnon', emoji: '🛠️', minXp: 100, weights: [30, 50, 20] },
      { name: 'Notable', emoji: '🎩', minXp: 250, weights: [10, 40, 50] },
    ],
    rewards: { 1: [stat('ecus', 15), xp(10)], 2: [stat('ecus', 30), xp(25)], 3: [stat('ecus', 60), xp(50)] },
    quests,
  },
  buildings: [place, taverne, mine, forge, foret, ferme, pont, eglise],
};

// La Taverne V11 parle d'« Énergie » : même statistique, renommée « Endurance » pour la bêta.
const json = JSON.stringify(world, null, 2).replaceAll('Énergie', 'Endurance');
mkdirSync(new URL('content/sainte-pelle/', root), { recursive: true });
writeFileSync(new URL('content/sainte-pelle/world.json', root), json + '\n');
console.log(`content/sainte-pelle/world.json : ${world.buildings.length} lieux, ${quests.length} quêtes, ${scenario.steps.length} étapes.`);
