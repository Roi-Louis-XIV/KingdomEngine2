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

test('quête réussie : récompenses, message, retour obligatoire au panneau', () => {
  const { engine } = started();
  const p = new Player(engine, 'louis', 'place');
  p.click('Choisir');
  new Player(engine, 'louis', 'taverne');
  new Player(engine, 'louis', 'mine');
  const last = new Player(engine, 'louis', 'forge');
  assert.match(last.text, /Quête réussie : Premiers pas/);
  assert.match(last.text, /Retourne au panneau des quêtes/);
  assert.equal(last.state.stats.ecus, 15);
  assert.equal(last.state.stats.xp, 10);
  assert.deepEqual(last.state.questsDone, ['q01']);
  // Au panneau : nouvelles propositions, jamais la quête déjà faite.
  const back = new Player(engine, 'louis', 'place');
  assert.doesNotMatch(back.text, /Premiers pas/);
  assert.equal(back.buttons.filter((b) => b === 'Choisir').length, 4);
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
  assert.match(p.text, /Quête réussie : Œufs frais/);
  assert.equal(p.state.items.oeuf, 1);
});

test('compter : activités, recharge, quête ordonnée', () => {
  const s = started();
  new Player(s.engine, 'louis', 'place');
  const engine = withQuest(s.engine, s.clock, 'louis', 'q03');
  const f = new Player(engine, 'louis', 'foret');
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
  assert.match(pl.text, /Quête réussie : Le bois du bûcher/);
  assert.match(pl.text, /\+\d+ XP/);
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

  // Finale, toutes les 5 s comme sur le serveur : cri partout, silence, « Il est revenu ! », panique, attente.
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
  const cri = sounds.filter((x) => x.e.sound === 'monstre-cri');
  assert.deepEqual(cri.map((x) => x.e.building).sort(), [...BUILDINGS].sort(), 'le cri dans tous les lieux');
  assert.ok(cri.every((x) => !x.e.character), 'le cri est un son du lieu, pas une réplique');
  const revenu = sounds.find((x) => x.e.sound === 'roland-il-est-revenu')!;
  assert.equal(revenu.e.character, 'roland');
  assert.ok(revenu.at - cri[0]!.at >= 15 && revenu.at - cri[0]!.at <= 20, `le cri, 5 s de silence, puis Roland (${revenu.at - cri[0]!.at} s)`);
  const panique = sounds.filter((x) => x.e.sound!.endsWith('-panique'));
  assert.deepEqual(panique.map((x) => x.e.character).sort(), ['agathe', 'anselme', 'edgar', 'maelis', 'sylvain', 'wagner']);
  assert.ok(panique.every((x) => x.at > revenu.at), 'les autres hurlent après Roland');
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
  f.click(/La futaie de chênes/);
  assert.match(f.text, /🔒 Il faut être 🪓 Bûcheron niveau 2 pour aller là/);
  f.click(/La lisière/);
  for (let i = 0; i < 7; i++) {
    f.refresh().click('Lancer');
    clock.advance(61);
    f.refresh().click('Récupérer');
    engine.adminApply('louis', undefined, [{ type: 'stat.set', stat: 'energie', value: 100 }]);
  }
  assert.equal(f.state.jobs.bucheron?.level, 2);
  f.refresh().click('↩️ Retour à l’entrée').click(/La futaie de chênes/);
  assert.match(f.text, /Abattre un chêne/);
  f.refresh().click('🎒 Mon inventaire');
  assert.match(f.text, /🪓 Bûcheron · \*\*niv\. 2\*\* · 42\/80 XP/);
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
  p.click(/Le carreau/);
  const before = p.text.match(/🎲 (.*)/)![1]!;
  assert.match(before, /4 pierres 70 % · 6 pierres 15 % · Un peu de cuivre 15 %/);
  engine.adminApply('louis', undefined, [{ type: 'item.give', item: 'pioche_fer', qty: 1 }]);
  const after = p.refresh().text;
  assert.match(after, /Pioche de fer \(−1 durabilité · état 70\/70\)/);
  assert.match(after, /6 pierres 26 %/);
  // Le gouffre exige une pioche de fer, et Mineur niveau 4.
  p.click('↩️ Retour à l’entrée').click(/Le gouffre/);
  assert.match(p.text, /Il faut être ⛏️ Mineur niveau 4/);
});

test('forge : on paie en lingots, l’arme rejoint l’inventaire, l’armure allège l’effort', () => {
  const { engine, clock } = started();
  engine.adminApply('louis', undefined, [{ type: 'item.give', item: 'lingot_bronze', qty: 9 }]);
  const f = new Player(engine, 'louis', 'forge');
  f.click(/Les armes du champ de bataille/);
  assert.match(f.text, /Épée longue du Chevalier[\s\S]*Il faut être 🔨 Forgeron niveau 2/);
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
  assert.match(f.text, /⚔️ \*\*Attaque :\*\* 3 · 🛡️ \*\*Défense :\*\* 2/);
  assert.match(f.text, /Armes :\*\* 🗡️ Épée courte du Novice ×1 \[⚔️3\]/);
  // La cuirasse fait économiser 1 d'endurance par activité.
  const bois = new Player(engine, 'louis', 'foret');
  bois.click(/La lisière/);
  assert.match(bois.text, /Abattre un jeune arbre[\s\S]*?⚡ -4 endurance/);
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

test('combat : chasse en forêt avec l’épée de Wagner, duel sur la Place, quêtes de combat', () => {
  const { engine, clock } = started();
  minutes(engine, clock, 5);
  new Player(engine, 'louis', 'foret', 'Louis');
  const s2 = engine.snapshot();
  s2.players.louis!.items.epee_longue = 1;
  s2.players.louis!.items.cotte_mailles = 1;
  const e = setup(s2, clock).engine;
  const f = new Player(e, 'louis', 'foret', 'Louis');
  f.click('🏹 Chasser');
  assert.match(f.text, /⚔️ 9 · 🛡️ 5/, 'base 3/1 + épée longue 6 + cotte de mailles 4');
  assert.match(f.text, /🐺 Loup gris — ❤️ 22 · ⚔️ 6 · 🛡️ 1 · 🟢 à ta portée\n🐗 Sanglier furieux/);
  f.click('🔎 Chercher un adversaire');
  for (let i = 0; i < 20 && f.state.fight; i++) f.click('⚔️ Attaquer');
  assert.equal(f.state.fight, undefined);
  assert.match(f.text, /Victoire|mis à terre/);
  assert.ok(f.state.stats.sante! < 100 || /Victoire/.test(f.text));

  const a = new Player(e, 'alice', 'place', 'Alice');
  const b = new Player(e, 'bob', 'place', 'Bob');
  a.click('🤺 Duels');
  b.click('🤺 Duels');
  a.choose(/Défier un joueur/, 'bob');
  b.refresh().click(/✅ Accepter/);
  a.refresh().click('🏳️ Abandonner');
  assert.equal(e.player('bob')!.stats.gloire, 5);
  assert.match(b.refresh().text, /Les plus glorieux/);
});
