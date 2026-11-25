/** Bêta « La Nuit de la Sainte Pelle » : quêtes, vote, urgence, fins, limites Discord à chaque acte. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Engine, validateRendered, validateWorld, type WorldDef, type WorldState } from '../src/index.ts';
import { Clock, Player, seeded } from './harness.ts';

const load = (): WorldDef => JSON.parse(readFileSync(new URL('../../../content/sainte-pelle/world.json', import.meta.url), 'utf8'));

function setup(state?: WorldState, clock = new Clock()) {
  let n = 0;
  const world = load();
  const engine = new Engine(world, state, { now: clock.now, random: seeded(7), newId: () => `s${++n}` });
  return { engine, clock, world };
}

/** Avance l'horloge minute par minute en faisant tourner le monde. */
function minutes(engine: Engine, clock: Clock, n: number) {
  for (let i = 0; i < n; i++) {
    clock.advance(60);
    engine.tick();
  }
}

const started = () => {
  const s = setup();
  s.engine.eventControl('scenario', 'start');
  return s;
};

/** Donne une quête précise à un joueur (sans passer par le hasard du panneau). */
function withQuest(engine: Engine, clock: Clock, player: string, quest: string) {
  const snap = engine.snapshot();
  snap.players[player] ??= structuredClone(Object.values(snap.players)[0]!);
  snap.players[player]!.quest = { id: quest, since: clock.now(), progress: {} };
  return setup(snap, clock).engine;
}

test('le monde de la bêta est valide', () => {
  assert.deepEqual(validateWorld(load()), []);
});

test('avant le signal du Roi : la place attend, aucune quête', () => {
  const { engine } = setup();
  const p = new Player(engine, 'louis', 'place');
  assert.match(p.text, /n’a pas encore commencé/);
  assert.ok(!p.buttons.includes('Choisir'));
});

test('panneau des quêtes : 4 propositions, tutoriel en tête, une seule quête à la fois', () => {
  const { engine } = started();
  assert.equal(engine.variables.t, 0);
  const p = new Player(engine, 'louis', 'place');
  assert.match(p.text, /Panneau des quêtes/);
  assert.match(p.text, /Premiers pas/);
  assert.equal(p.buttons.filter((b) => b === 'Choisir').length, 4);
  // Le premier « Choisir » est la quête en vedette.
  p.click('Choisir');
  assert.match(p.text, /Quête acceptée : \*\*Premiers pas\*\*/);
  assert.match(p.text, /Tu mènes déjà une quête/);
  assert.ok(p.buttons.includes('Abandonner cette quête'));
  // La place compte déjà comme 1 lieu visité.
  assert.equal(p.state.quest?.progress.lieux, 1);
});

test('« Mon inventaire » : endurance, ivresse, XP, niveau, quête au-dessus du sac', () => {
  const { engine } = started();
  const p = new Player(engine, 'louis', 'place');
  p.click('Choisir');
  p.click('🎒 Mon inventaire');
  const t = p.text;
  assert.match(t, /Endurance :\*\* 80\/100/);
  assert.match(t, /Ivresse :\*\* 0\/100/);
  assert.match(t, /XP :\*\* 0 · 🏠 \*\*Habitant\*\* \(prochain : Compagnon à 100\)/);
  assert.match(t, /Premiers pas\*\* ★ · Maëlis/);
  assert.match(t, /▫️ Visiter 4 lieux différents \(1\/4\)/);
  assert.match(t, /🎁 💰 \+15 écus · ⭐ \+10 XP/);
  assert.ok(t.indexOf('Premiers pas') < t.indexOf('Mon inventaire'));
  assert.match(t, /Outils :\*\* 🪓 Hache de bûcheron ×1 \(40\/40\)/);
});

test('quête réussie : affichée terminée jusqu’à la récompense récupérée au panneau de la Place', () => {
  const { engine } = started();
  const p = new Player(engine, 'louis', 'place');
  p.click('Choisir');
  new Player(engine, 'louis', 'taverne');
  new Player(engine, 'louis', 'mine');
  const last = new Player(engine, 'louis', 'forge');
  assert.match(last.text, /Quête terminée : Premiers pas/);
  assert.match(last.text, /Va récupérer ta récompense au panneau des quêtes de la Place/);
  assert.equal(last.state.stats.ecus, 0, 'pas encore de récompense');
  assert.deepEqual(last.state.questsDone, ['q01']);
  // Tant qu'elle n'est pas récupérée, la fiche le rappelle, dans chaque bâtiment.
  const sac = new Player(engine, 'louis', 'mine').click('🎒 Mon inventaire');
  assert.match(sac.text, /🏆 \*\*Quête terminée : .*Premiers pas\*\*\n🎁 Va récupérer ta récompense/);
  // Au panneau : la récompense d'abord, pas de nouvelle quête ni d'abandon.
  const back = new Player(engine, 'louis', 'place');
  assert.ok(!back.buttons.includes('Choisir'));
  assert.ok(!back.buttons.some((b) => /Abandonner/.test(b)));
  back.click('Récupérer ma récompense');
  assert.match(back.text, /Récompense de \*\*Premiers pas\*\* récupérée/);
  assert.equal(back.state.stats.ecus, 15);
  assert.equal(back.state.stats.xp, 10);
  assert.equal(back.state.quest, undefined);
  // Nouvelles propositions, jamais la quête déjà faite.
  assert.doesNotMatch(back.text, /Premiers pas\*\* ★/);
  assert.equal(back.buttons.filter((b) => b === 'Choisir').length, 4);
  assert.deepEqual(validateRendered(back.message), []);
});

test('livrer depuis l’inventaire du bon bâtiment', () => {
  const s = started();
  s.engine.adminApply('louis', undefined, [{ type: 'item.give', item: 'oeuf', qty: 5 }]);
  const engine = withQuest(s.engine, s.clock, 'louis', 'q04');
  const ailleurs = new Player(engine, 'louis', 'forge');
  ailleurs.click('🎒 Mon inventaire');
  assert.ok(!ailleurs.buttons.some((b) => b.startsWith('Livrer')));
  const p = new Player(engine, 'louis', 'taverne');
  p.click('🎒 Mon inventaire');
  p.click(/^Livrer : /);
  assert.match(p.text, /Livré : 4 🥚 Œuf frais/);
  assert.match(p.text, /Quête terminée : Œufs frais/);
  assert.equal(p.state.items.oeuf, 1);
});

test('compter : activités, recharge, quête ordonnée', () => {
  const s = started();
  new Player(s.engine, 'louis', 'place');
  const engine = withQuest(s.engine, s.clock, 'louis', 'q03');
  const f = new Player(engine, 'louis', 'foret');
  f.click('🪓 Devenir bûcheron').click('Devenir bûcheron');
  f.click(/La lisière/);
  f.click('Lancer');
  s.clock.advance(80);
  f.refresh().click('Récupérer');
  assert.equal(f.state.quest?.progress.abattre, 1);
  assert.match(f.text, /Bûcheron/);
  engine.adminApply('louis', undefined, [{ type: 'item.give', item: 'buche', qty: 2 }]);
  // 4 bûches apportées à la fête.
  const pl = new Player(engine, 'louis', 'place');
  pl.click('🎉 Fête & Trésor');
  pl.choose(/Choisir ce que tu apportes/, 'buche');
  pl.click(/^Tout|×4/);
  pl.click(/^Apporter/);
  assert.match(pl.text, /Quête terminée : Le bois du bûcher/);
  const board = new Player(engine, 'louis', 'place').click(/Récupérer ma récompense/);
  assert.match(board.text, /récupérée ! .*\+\d+ XP/);
});

test('vote, verdict, incendie, urgence maîtrisée, éclats retrouvés et fin triomphante', () => {
  const { engine, clock } = started();
  minutes(engine, clock, 45);
  assert.equal(engine.variables.t, 45);
  for (const id of ['a', 'b', 'c']) {
    const p = new Player(engine, id, 'place');
    p.click('🗳️ Conseil de la pierre');
    p.click(id === 'c' ? 'Rendre à la mine' : 'Garder à la forge');
    assert.match(p.text, /Ta voix est comptée/);
    assert.ok(!p.buttons.includes('Garder à la forge'));
  }
  minutes(engine, clock, 20);
  assert.equal(engine.variables.pierre, 'forge');
  minutes(engine, clock, 25);
  assert.equal(engine.variables.urgence, 'incendie');
  // Pendant la tempête, la forêt est fermée.
  assert.match(new Player(engine, 'a', 'foret').text, /Forêt fermée/);
  // 30 seaux du puits jusqu'à la forge.
  engine.adminApply('a', undefined, [{ type: 'item.give', item: 'seau', qty: 30 }]);
  const f = new Player(engine, 'a', 'forge');
  for (let i = 0; i < 30; i++) {
    f.click('Lancer');
    clock.advance(4);
  }
  assert.match(f.text, /Objectif atteint/);
  minutes(engine, clock, 10);
  assert.equal(engine.variables.urgence_res, 'reussie');
  assert.equal(engine.variables.forge_etat, 'ok');
  minutes(engine, clock, 10);
  assert.equal(engine.variables.acte, 'releve');
  // Chantier et éclats menés « à la main ».
  engine.adminApply('a', 'eglise', [
    { type: 'objective.add', building: 'eglise', objective: 'arbre', item: 'branche', qty: 12 },
    { type: 'objective.add', building: 'eglise', objective: 'chantier', item: 'buche', qty: 40 },
    { type: 'objective.add', building: 'eglise', objective: 'chantier', item: 'pierre', qty: 30 },
    { type: 'objective.add', building: 'eglise', objective: 'assemblage', item: 'assemblage', qty: 3 },
  ]);
  const e = new Player(engine, 'b', 'eglise');
  e.click('Ramasser l’éclat');
  assert.match(e.text, /Éclat retrouvé/);
  assert.equal(engine.variables.eclats, 1);
  assert.ok(!e.buttons.includes('Ramasser l’éclat'));
  for (const n of [2, 3, 4, 5, 6]) engine.adminApply('a', undefined, [{ type: 'variable.add', variable: 'eclats', amount: 1 }, { type: 'variable.set', variable: `eclat${n}`, value: 'oui' }]);
  minutes(engine, clock, 60);
  assert.equal(engine.variables.fin, 'triomphe');
  for (let i = 0; i < 15 && engine.variables.acte !== 'fin'; i++) minutes(engine, clock, 1);
  assert.equal(engine.variables.acte, 'fin');
  const place = new Player(engine, 'a', 'place');
  assert.match(place.click('🏅 Tableau d’honneur').text, /Tableau d’honneur/);
  assert.equal(engine.ambienceFor('taverne'), 'taverne-calme');

  // Finale, toutes les 5 s comme sur le serveur : une bande unique (grondement, PNJ qui paniquent, cri) dans tous les lieux,
  // silence, puis musique d'attente et message du narrateur.
  const timeline: { at: number; e: { type: string; building?: string; sound?: string; character?: string; text?: string } }[] = [];
  const start = clock.now();
  for (let i = 0; i < 60 && engine.variables.monde !== 'ferme'; i++) {
    clock.advance(5);
    for (const e of engine.tick()) timeline.push({ at: Math.round((clock.now() - start) / 1000), e });
  }
  const events = timeline.map((x) => x.e);
  assert.equal(engine.variables.acte, 'apocalypse');
  assert.equal(engine.variables.monde, 'ferme');
  const sounds = timeline.filter((x) => x.e.type === 'audio.play');
  const BUILDINGS = ['place', 'taverne', 'mine', 'forge', 'foret', 'ferme', 'pont', 'eglise'];
  const bande = sounds.filter((x) => x.e.sound === 'finale-apocalypse');
  assert.deepEqual(bande.map((x) => x.e.building).sort(), [...BUILDINGS].sort(), 'la bande finale dans tous les lieux');
  assert.ok(bande.every((x) => !x.e.character && x.at === bande[0]!.at), 'au même instant, comme un son du lieu');
  assert.ok(!sounds.some((x) => /-panique$|^monstre-cri$/.test(x.e.sound!)), 'plus de répliques séparées : tout est dans la bande');
  const timing = JSON.parse(readFileSync(new URL('../../../content/sainte-pelle/sons/finale-apocalypse.json', import.meta.url), 'utf8'));
  const fermeAt = timeline.find((x) => x.e.type === 'announce' && x.e.text?.includes('{salon.aide}'))!.at;
  assert.ok(fermeAt - bande[0]!.at >= timing.duration + 3, `la musique d'attente vient après la bande et 3 s de silence (${fermeAt - bande[0]!.at} s)`);
  // Silence total entre le cri et l'attente, puis musique d'attente + message en boucle partout.
  for (const b of BUILDINGS) {
    assert.equal(engine.ambienceCase(b)?.sound, 'fin-attente');
    assert.equal(engine.ambienceCase(b)?.message, 'fin-rejoindre-aide');
  }
  // Tous les PNJ sont partis.
  assert.ok(engine.characters().every((c) => engine.characterLocation(c.id) === undefined));
  assert.ok(events.some((e) => e.type === 'announce' && e.text.includes('{salon.aide}')));
  // Le monde est fermé : chaque interface n'affiche que la fermeture, plus aucune action.
  place.refresh();
  assert.match(place.text, /Le Royaume est tombé/);
  assert.match(place.text, /\{salon\.aide\}/);
  assert.deepEqual(place.buttons, []);
  const taverne = new Player(engine, 'b', 'taverne');
  assert.match(taverne.text, /bêta « La Nuit de la Sainte Pelle » est terminée/);
  const forge = new Player(engine, 'c', 'forge');
  assert.deepEqual(forge.buttons, []);
  minutes(engine, clock, 5);
  assert.equal(engine.live().events.find((x) => x.id === 'scenario')?.status, 'finished');
  assert.equal(engine.variables.monde, 'ferme', 'le monde reste fermé après le scénario');
  // Rouvrir (En direct › variables) : tout redevient jouable.
  engine.setVariable('monde', 'ouvert');
  assert.ok(new Player(engine, 'a', 'place').buttons.length > 0);
});

test('fermeture : une interface ouverte avant la fermeture refuse toute action', () => {
  const { engine } = started();
  const p = new Player(engine, 'a', 'place');
  const button = p.button(/.+/);
  engine.setVariable('monde', 'ferme');
  const r = engine.interact('a', button.customId);
  assert.equal(r.ok, false);
  assert.match(r.private ?? '', /Le Royaume est tombé/);
});

test('urgence ratée : la forge est endommagée jusqu’à ce qu’on la rebâtisse', () => {
  const { engine, clock } = started();
  minutes(engine, clock, 45);
  const p = new Player(engine, 'a', 'place');
  p.click('🗳️ Conseil de la pierre').click('Garder à la forge');
  minutes(engine, clock, 56);
  assert.equal(engine.variables.urgence_res, 'ratee');
  assert.equal(engine.variables.forge_etat, 'endommagee');
  const f = new Player(engine, 'a', 'forge');
  assert.match(f.text, /Rebâtir la forge/);
  assert.doesNotMatch(f.text, /Fondre un lingot/);
});

test('aucune urgence pour la mine si personne ne vote : égalité = la pierre retourne à la mine', () => {
  const { engine, clock } = started();
  minutes(engine, clock, 90);
  assert.equal(engine.variables.pierre, 'mine');
  assert.equal(engine.variables.urgence, 'eboulement');
  assert.match(new Player(engine, 'a', 'mine').text, /Dégager Roland/);
});

test('tous les écrans de tous les lieux respectent les limites Discord, à chaque acte', () => {
  const { engine, clock, world } = started();
  for (const t of [0, 30, 50, 60, 75, 92, 105, 120, 175]) {
    minutes(engine, clock, t - Number(engine.variables.t));
    for (const b of world.buildings)
      for (const s of b.screens) {
        const p = new Player(engine, `testeur-${t}`, b.id);
        const snap = engine.snapshot();
        snap.sessions[p.sessionId]!.screen = s.id;
        const e2 = new Engine(world, snap, { now: clock.now });
        const msg = e2.view(p.sessionId).message;
        assert.deepEqual(validateRendered(msg), [], `T+${t} ${b.id}/${s.id}`);
      }
  }
});

test('métiers : les gestes avancés demandent un niveau, l’expérience s’affiche dans la fiche', () => {
  const { engine, clock } = started();
  const f = new Player(engine, 'louis', 'foret');
  f.click('🪓 Devenir bûcheron').click('Devenir bûcheron');
  // La futaie (niveau 2) n'apparaît qu'une fois le niveau atteint.
  assert.ok(!f.buttons.some((b) => /futaie/i.test(b)));
  f.click(/La lisière/);
  // L'XP par niveau est calculée par le générateur (environ 1 h pour le niveau 5) : on travaille jusqu'au niveau 2.
  const per = engine.world.jobs.find((j) => j.id === 'bucheron')!.xpPerLevel;
  for (let i = 0; i < 40 && (f.state.jobs.bucheron?.level ?? 1) < 2; i++) {
    f.refresh().click('Lancer');
    clock.advance(61);
    f.refresh().click('Récupérer');
    engine.adminApply('louis', undefined, [{ type: 'stat.set', stat: 'energie', value: 100 }]);
  }
  assert.equal(f.state.jobs.bucheron?.level, 2);
  f.refresh().click('↩️ Retour à l’entrée').click(/La futaie de chênes/);
  assert.match(f.text, /Abattre un chêne/);
  f.refresh().click('🎒 Mon inventaire');
  assert.match(f.text, new RegExp(`🪓 Bûcheron · \\*\\*niv\\. 2\\*\\* · ${f.state.jobs.bucheron!.xp}/${2 * per} XP`));
});

test('échoppes : acheter un outil, revendre ses ressources', () => {
  const { engine } = started();
  engine.adminApply('louis', undefined, [{ type: 'stat.add', stat: 'ecus', amount: 50 }, { type: 'item.give', item: 'poisson', qty: 3 }]);
  const p = new Player(engine, 'louis', 'forge');
  p.click('🛒 Échoppe');
  assert.match(p.text, /L’étal de Wagner/);
  p.choose(/Choisir un article/, 'pioche_bronze');
  p.click(/Acheter · 30 écus/);
  p.click('Confirmer l’achat');
  assert.match(p.text, /Pioche de bronze ajouté à ton inventaire/);
  assert.equal(p.state.items.pioche_bronze, 1);
  const pont = new Player(engine, 'louis', 'pont');
  pont.click('🛒 Échoppe').click('💰 Vendre mes ressources');
  assert.match(pont.text, /Vendre à le vieux pêcheur|Vendre/);
});

test('serment : dotation une seule fois', () => {
  const { engine } = started();
  const first = engine.acceptOath('louis');
  assert.equal(first.first, true);
  assert.match(first.gains, /\+100 écus/);
  const again = engine.acceptOath('louis');
  assert.equal(again.first, false);
  assert.equal(engine.snapshot().players.louis!.stats.ecus, 100);
});

test('lieux de récolte : chances selon le lieu, le niveau et l’outil ; meilleur outil utilisé', () => {
  const { engine } = started();
  const p = new Player(engine, 'louis', 'mine');
  p.click('⛏️ Devenir mineur').click('Devenir mineur');
  p.click(/Le carreau/);
  const before = p.text.match(/🎲 (.*)/)![1]!;
  assert.match(before, /4 pierres 70 % · 6 pierres 15 % · Un peu de cuivre 15 %/);
  engine.adminApply('louis', undefined, [{ type: 'item.give', item: 'pioche_fer', qty: 1 }]);
  const after = p.refresh().text;
  assert.match(after, /Pioche de fer \(−1 durabilité · état 70\/70\)/);
  assert.match(after, /6 pierres 26 %/);
  // Le gouffre exige Mineur niveau 4 : tant qu'on n'y est pas, il n'apparaît même pas.
  p.click('↩️ Retour à l’entrée');
  assert.ok(!p.buttons.some((b) => /gouffre/i.test(b)));
  engine.adminApply('louis', undefined, [{ type: 'job.setLevel', job: 'mineur', level: 4 }]);
  assert.ok(p.refresh().buttons.some((b) => /gouffre/i.test(b)));
});

test('forge : on paie en lingots, l’arme rejoint l’inventaire et le profil (décoratives en bêta)', () => {
  const { engine, clock } = started();
  engine.adminApply('louis', undefined, [{ type: 'item.give', item: 'lingot_bronze', qty: 9 }]);
  const f = new Player(engine, 'louis', 'forge');
  f.click('🔨 Devenir forgeron').click('Devenir forgeron');
  f.click(/Les armes du champ de bataille/);
  // Pas le niveau : l'épée longue (niveau 2) n'apparaît pas ; l'épée courte (niveau 1), si.
  assert.match(f.text, /Épée courte du Novice/);
  assert.doesNotMatch(f.text, /Épée longue du Chevalier|Il faut être 🔨 Forgeron niveau/);
  f.click('Lancer');
  clock.advance(70);
  f.refresh().click('Récupérer');
  assert.equal(f.state.items.epee_courte, 1);
  f.click('↩️ Retour à la forge').click(/Les armures/);
  f.click('Lancer');
  clock.advance(70);
  f.refresh().click('Récupérer');
  assert.equal(f.state.items.cuirasse_cuir, 1);
  f.click('🎒 Mon inventaire');
  // Décoratives : visibles dans le profil (meilleur objet par emplacement) et le sac, sans valeurs de combat.
  assert.match(f.text, /\*\*🛡️ Équipement\*\*\n🗡️ Arme : \*\*Épée courte du Novice\*\*\n🦺 Armure : \*\*Cuirasse de cuir renforcé\*\*/);
  assert.match(f.text, /Armes :\*\* 🗡️ Épée courte du Novice ×1(?! \[)/);
  assert.doesNotMatch(f.text, /Attaque :|\[⚔️/);
  // La cuirasse ne fait plus économiser d'endurance.
  engine.adminApply('louis', undefined, [{ type: 'job.leave', job: 'forgeron' }, { type: 'job.join', job: 'bucheron' }]);
  const bois = new Player(engine, 'louis', 'foret');
  bois.click(/La lisière/);
  assert.match(bois.text, /Abattre un jeune arbre[\s\S]*?⚡ -5 endurance/);
});

test('taverne : la carte de la Gueuse Cocue et la brasserie', () => {
  const { engine } = started();
  engine.adminApply('louis', undefined, [{ type: 'stat.add', stat: 'ecus', amount: 30 }]);
  const t = new Player(engine, 'louis', 'taverne');
  t.click(/Devenir brasseur/);
  t.click('Devenir brasseur');
  assert.match(t.text, /Les cuves d’Edgar/);
  assert.match(t.text, /Brasseur niveau 1/);
});

test('la bêta n’a pas de combat (retiré à la demande de Louis le 16 novembre)', () => {
  const w = load();
  assert.equal((w.creatures ?? []).length, 0);
  assert.ok(w.buildings.every((b) => b.modules.every((m) => m.type !== 'combat')));
  assert.ok(!w.stats.some((s) => s.id === 'sante' || s.id === 'gloire'));
});

test('ivresse : boire rend pompette puis éméché, l’eau dessoûle, ivre mort on ne travaille plus, ça redescend tout seul', () => {
  const { engine, clock } = started();
  minutes(engine, clock, 5);
  const p = new Player(engine, 'louis', 'foret', 'Louis');
  const st = engine.snapshot();
  st.players.louis!.stats.alcool = 55;
  const e = setup(st, clock).engine;
  const f = new Player(e, 'louis', 'foret', 'Louis');
  void p;
  f.click('🎒 Mon inventaire');
  assert.match(f.text, /🍺 \*\*Ivresse :\*\* 55\/100 .* · 🥴 \*\*Éméché\*\* : récoltes −15 % · 10 % de risque de tout rater/);
  assert.match(f.text, /↘️ redescend de 5 toutes les 90 s/);
  const s2 = e.snapshot();
  s2.players.louis!.stats.alcool = 100;
  s2.players.louis!.activeJobs = ['bucheron'];
  const e2 = setup(s2, clock).engine;
  const g = new Player(e2, 'louis', 'foret', 'Louis');
  const places = g.buttons.filter((b) => !/inventaire|Actualiser|Parler|Échoppe/.test(b));
  g.click(places[0]!);
  assert.match(g.text, /🔒 😵 Ivre mort : Tu titubes : impossible de travailler/);
  // −5 toutes les 90 s, comptées à partir du premier passage de l’horloge (à 45 s) : 2 pas en 4 min 30.
  for (let i = 0; i < 6; i++) {
    clock.advance(45);
    e2.tick();
  }
  assert.equal(e2.player('louis')!.stats.alcool, 90);
});

test('toutes les répliques du document du scénario sont jouées quelque part', () => {
  const json = JSON.stringify(load());
  for (const key of ['agathe-accueil', 'anselme-accueil', 'sylvain-eclat', 'agathe-eclat', 'maelis-quete-finie', 'edgar-rumeur-pierre', 'edgar-innocent', 'roland-galerie', 'roland-avis', 'wagner-avis', 'anselme-avis'])
    assert.ok(json.includes(`"${key}"`), key);
});

test('métiers : on prend un métier pour travailler, un seul à la fois, on démissionne pour en changer ; la fiche ne montre que les métiers exercés', () => {
  const { engine, clock } = started();
  minutes(engine, clock, 2);
  const f = new Player(engine, 'louis', 'forge', 'Louis');
  assert.match(f.text, /🔨 \*Pour travailler ici, prends le métier de forgeron\.\* Un seul métier à la fois\./);
  // Sans le métier, les menus de travail n'apparaissent pas (catalogue, fonderie)…
  assert.ok(!f.buttons.includes('🔥 La fonderie'));
  assert.doesNotMatch(f.text, /Le catalogue du maître forgeron/);
  // … mais les services pour tous restent : réparer ses outils, l'échoppe, parler à Wagner.
  assert.match(f.text, /Faire réparer tes outils/);
  assert.ok(f.buttons.includes('🛒 Échoppe') && f.buttons.includes('💬 Parler à Wagner'));
  // Même chose à la Mine : pas de galeries sans le métier de mineur.
  assert.ok(!new Player(engine, 'louis', 'mine', 'Louis').buttons.some((b) => /carreau/i.test(b)));
  // La fiche : aucun métier exercé.
  f.refresh().click('🎒 Mon inventaire');
  assert.match(f.text, /\*\*🛠️ Métiers\*\*\n\*Aucun métier exercé pour l’instant\.\*/);
  // Prendre le métier.
  f.click('↩️ Retour').click('🔨 Devenir forgeron');
  assert.match(f.text, /## 🔨 Devenir forgeron[\s\S]*Niveau retrouvé :\*\* 1\/5[\s\S]*Un seul métier à la fois/);
  f.click('Devenir forgeron');
  assert.match(f.text, /Te voilà forgeron/);
  assert.match(f.text, /🔨 \*\*Tu es forgeron\*\* · niveau 1\/5 · 0 XP/);
  assert.ok(f.buttons.includes('📜 Démissionner') && !f.buttons.includes('🔨 Devenir forgeron'));
  assert.match(f.text, /Le catalogue du maître forgeron/);
  f.click('🔥 La fonderie');
  assert.match(f.text, /Fondre un lingot de fer/);
  assert.doesNotMatch(f.text, /Prends le métier/);
  // Un seul métier : à la Mine, impossible de devenir mineur tant qu'on est forgeron.
  const m = new Player(engine, 'louis', 'mine', 'Louis');
  m.click('⛏️ Devenir mineur');
  assert.match(m.text, /⚠️ \*\*Tu exerces déjà le métier Forgeron\.\*\*/);
  assert.ok(!m.buttons.includes('Devenir mineur'));
  // Démission à la forge : le niveau est conservé, et le mineur devient possible.
  engine.adminApply('louis', undefined, [{ type: 'job.xp', job: 'forgeron', amount: engine.world.jobs.find((j) => j.id === 'forgeron')!.xpPerLevel + 5 }]);
  const f2 = new Player(engine, 'louis', 'forge', 'Louis');
  f2.click('📜 Démissionner');
  assert.match(f2.text, /Démission du métier de forgeron[\s\S]*Niveau conservé :\*\* 2\/5/);
  f2.click('Confirmer la démission');
  assert.match(f2.text, /Démission enregistrée/);
  m.refresh().click('Devenir mineur');
  assert.deepEqual(engine.player('louis')!.activeJobs, ['mineur']);
  m.click('🎒 Mon inventaire');
  const perMineur = engine.world.jobs.find((j) => j.id === 'mineur')!.xpPerLevel;
  assert.ok(m.text.includes(`⛏️ Mineur · **niv. 1** · 0/${perMineur} XP · *métier actuel*\n🔨 Forgeron · **niv. 2**`), m.text);
  assert.doesNotMatch(m.text, /Bûcheron|Pêcheur|Fermier/);
});

test('économie jouable (simulation du 23 novembre) : eau du puits, minerai pour le forgeron, pas d’argent infini', () => {
  const w = load();
  const tav = w.buildings.find((b) => b.id === 'taverne')!;
  // Toute matière d'une recette de la Taverne a une source : récoltée, vendue dans une échoppe, ou brassée/cuisinée.
  const harvested = new Set<string>();
  for (const b of w.buildings)
    for (const m of b.modules) {
      if (m.type === 'activity') for (const a of m.activities) for (const r of a.results) for (const x of r.actions ?? []) if (x.type === 'item.give') harvested.add(x.item);
      if (m.type === 'shop') for (const o of m.offers) if (o.takeaway) harvested.add(o.takeaway.item); // en vente dans une échoppe
    }
  for (const m of tav.modules)
    if (m.type === 'production')
      for (const r of m.recipes) for (const it of Object.keys(r.inputs)) assert.ok(harvested.has(it) || tav.modules.some((p) => p.type === 'production' && p.recipes.some((o) => it in o.outputs)), `${r.id} : « ${it} » n'a aucune source`);
  assert.ok(harvested.has('seau'), 'le puits donne des seaux');
  const rachat = tav.modules.find((m) => m.type === 'buyback')!;
  assert.ok(rachat.type === 'buyback' && rachat.prices.seau, 'Edgar rachète les seaux');
  // Le forgeron trouve du minerai à acheter (à la mine et à la forge).
  for (const id of ['mine', 'forge']) {
    const shop = w.buildings.find((b) => b.id === id)!.modules.find((m) => m.type === 'shop' && m.id === 'echoppe')!;
    assert.ok(shop.type === 'shop' && shop.offers.some((o) => o.stockItem === 'minerai'), `minerai en vente : ${id}`);
  }
  // Aucune échoppe ne vend moins cher que son propre rachat le plus généreux.
  for (const b of w.buildings) {
    const bb = b.modules.find((m) => m.type === 'buyback');
    if (!bb || bb.type !== 'buyback') continue;
    for (const m of b.modules)
      if (m.type === 'shop') for (const o of m.offers) if (o.stockItem && bb.prices[o.stockItem]) assert.ok(o.price > bb.prices[o.stockItem]! * (bb.emptyFactor ?? 1), `${b.id}/${o.stockItem} : vendu ${o.price}, racheté jusqu'à ${bb.prices[o.stockItem]! * (bb.emptyFactor ?? 1)}`);
  }
});

test('bruitages de travail : la hache en forêt, la pioche à la mine, au lancement du travail', () => {
  const w = load();
  const sounds = (bid: string) =>
    w.buildings.find((b) => b.id === bid)!.modules.flatMap((m) => (m.type === 'activity' ? m.activities : [])).filter((a) => a.costs.some((c) => c.type === 'audio.play')).map((a) => a.costs.find((c) => c.type === 'audio.play')!);
  assert.ok(sounds('foret').length >= 3 && sounds('foret').every((c) => c.type === 'audio.play' && c.sound === 'foret-hache'));
  assert.ok(sounds('mine').length >= 5 && sounds('mine').every((c) => c.type === 'audio.play' && c.sound === 'mine-pioche'));
  const keys = (bid: string) => new Set(sounds(bid).map((c) => (c.type === 'audio.play' ? c.sound : '')));
  assert.deepEqual([...keys('ferme')], ['ferme-faux']);
  assert.deepEqual([...keys('pont')], ['pont-ligne']);
  assert.deepEqual([...keys('forge')].sort(), ['forge-fonte', 'forge-marteau']);
  // À la Taverne, lancer une fournée fait bouillir la marmite dans le salon vocal.
  const tav = w.buildings.find((b) => b.id === 'taverne')!.modules.filter((m) => m.type === 'production');
  assert.deepEqual(tav.map((m) => (m.type === 'production' ? m.startSound : '')).sort(), ['taverne-brassin', 'taverne-marmite']);
});
