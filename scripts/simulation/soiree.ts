// Voir docs/ARCHITECTURE.md › Simulation de la soirée. Exemple : TRAVEL=2 node --experimental-strip-types scripts/simulation/soiree.ts bucheron,mineur,forgeron,fermier,pecheur,cuisinier,brasseur forge 0.6 7
// Simulation de la bêta « La Nuit de la Sainte Pelle » avec des joueurs virtuels qui jouent par les vrais écrans.
// node --experimental-strip-types scripts/simulation/soiree.ts <répartition> <pierre: forge|mine> <efficacité 0..1> <graine>
import { readFileSync } from 'node:fs';
import { Engine } from '../../packages/engine/src/index.ts';
import { Bot } from './ui.ts';

const W = JSON.parse(readFileSync(new URL('../../content/sainte-pelle/world.json', import.meta.url), 'utf8'));
const jobsArg = (process.argv[2] ?? 'bucheron,mineur,forgeron,fermier,pecheur,cuisinier,brasseur').split(',');
const stone = process.argv[3] ?? 'forge';
const eff = Number(process.argv[4] ?? 1);
let seed = Number(process.argv[5] ?? 1);
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

let now = Date.UTC(2026, 10, 9, 18);
let n = 0;
const e = new Engine(W, undefined, { now: () => now, random: rnd, newId: () => `s${++n}` });
e.eventControl('scenario', 'start');
const T = () => Number(e.variables.t ?? 0);

const goals: Record<string, Record<string, number>> = {};
for (const b of W.buildings) for (const m of b.modules) if (m.type === 'objective') goals[`${b.id}/${m.id}`] = m.goals;
const progress = (key: string) => {
  const o = (e as any).state.objectives[key];
  const g = goals[key]!;
  let have = 0, need = 0;
  for (const [k, v] of Object.entries(g)) { have += Math.min(v, o?.progress?.[k] ?? 0); need += v; }
  return { pct: Math.floor((100 * have) / need), missing: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, Math.max(0, v - (o?.progress?.[k] ?? 0))])) };
};

// Où travaille chaque métier : bâtiment, écrans de lieux (du plus haut niveau au plus bas), écran du métier.
const JOB: Record<string, { b: string; places: string[]; desk: string }> = {
  bucheron: { b: 'foret', places: ['lieu-sombre', 'lieu-futaie', 'lieu-lisiere'], desk: 'metier-bucheron' },
  mineur: { b: 'mine', places: ['lieu-gouffre', 'lieu-profonde', 'lieu-fer', 'lieu-cuivre', 'lieu-carreau'], desk: 'metier-mineur' },
  fermier: { b: 'ferme', places: ['lieu-champs', 'lieu-basse-cour'], desk: 'metier-fermier' },
  pecheur: { b: 'pont', places: ['lieu-profond', 'lieu-arche', 'lieu-berge'], desk: 'metier-pecheur' },
  forgeron: { b: 'forge', places: ['atelier-fonderie'], desk: 'metier-forgeron' },
  cuisinier: { b: 'taverne', places: [], desk: 'metier' },
  brasseur: { b: 'taverne', places: [], desk: 'metier-brasseur' },
};
const KEEP = new Set(['buche', 'pierre', 'poisson', 'gerbe', 'ferrure', 'pain_emballe', 'gamelle_soupe', 'seau', 'deblai', 'lingot', 'hache', 'pioche', 'canne', 'gourde_eau']);

type B = Bot & { job: string; stats: Record<string, number>; nextPlace: number; wait: number };
const bots: B[] = jobsArg.map((job, i) => {
  const b = new Bot(e, `p${i}`, `Joueur${i + 1}`) as B;
  e.acceptOath(b.id);
  b.job = job; b.stats = {}; b.nextPlace = 0; b.wait = 0;
  return b;
});
const count = (b: B, k: string) => { b.stats[k] = (b.stats[k] ?? 0) + 1; };

function deliver(b: B, building: string, screen: string, key: string) {
  const miss = progress(key).missing;
  const items = b.st.items;
  const want = Object.keys(miss).filter((k) => miss[k]! > 0 && (items[k] ?? 0) > 0);
  if (!want.length) return false;
  if (!b.goto(building, screen)) return false;
  let done = false;
  for (const it of want) {
    const sel = b.ui.selects.find((s) => /Choisir ce que tu apportes/.test(s.placeholder) && s.options.some((o) => o.value === it));
    if (!sel) continue;
    b.choose(/Choisir ce que tu apportes/, it);
    b.click(/^Tout/);
    if (b.click(/^Apporter/)) { done = true; count(b, `livré:${key}`); }
  }
  return done;
}

function buy(b: B, building: string, screen: string, item: string, qty: number) {
  for (let i = 0; i < qty; i++) {
    if (!b.goto(building, screen)) return;
    if (!b.choose(/Choisir un article/, item)) return;
    if (!b.click(/^Acheter/) && !b.click(/À emporter/)) return;
    b.click(/Confirmer l’achat/);
  }
}

function eat(b: B) {
  if (!b.goto('taverne', 'repas')) return false;
  const opts = b.ui.selects.find((s) => /Choisir un article/.test(s.placeholder))?.options.map((o) => o.value) ?? [];
  for (const it of ['ragout', 'soupe', 'soupe_oignon', 'fromage_moines', 'pain']) {
    if (!opts.includes(it)) continue;
    const before = b.st.stats.energie;
    b.goto('taverne', 'repas');
    b.choose(/Choisir un article/, it);
    b.click(/Sur place/);
    b.click(/Confirmer/);
    if (b.st.stats.energie > before) { count(b, 'repas'); return true; }
  }
  count(b, 'faim');
  return false;
}

function sell(b: B) {
  const sellable = Object.entries(b.st.items).filter(([k, q]) => q > 0 && !KEEP.has(k));
  if (!sellable.length) return;
  for (const building of ['taverne', JOB[b.job]!.b]) {
    const scr = building === 'taverne' ? 'vente' : 'echoppe-vente';
    if (!b.goto(building, scr)) continue;
    for (const [k] of sellable) {
      if (!b.choose(/Choisir une ressource/, k)) continue;
      const qBtn = b.ui.buttons.filter((x) => /^×\d+|^Tout/.test(x.label)).pop();
      if (qBtn) b.click(new RegExp('^' + qBtn.label.replace(/[()×]/g, '.')));
      if (b.click(/Confirmer la vente/)) count(b, 'vente');
    }
  }
}

/** Le cuisinier ou le brasseur va remplir des seaux au puits et les revend à Edgar (eau de la réserve). */
function fetchWater(b: B) {
  if ((b.st.items.seau ?? 0) >= 4) {
    if (b.goto('taverne', 'vente') && b.choose(/Choisir une ressource/, 'seau')) {
      const q = b.ui.buttons.filter((x) => /^×\d+|^Tout/.test(x.label)).pop();
      if (q) b.click(new RegExp('^' + q.label.replace(/[()×]/g, '.')));
      if (b.click(/Confirmer la vente/)) count(b, 'eau livrée');
    }
    return;
  }
  b.goto('place', 'accueil');
  if (b.click(/^Lancer$/, /Remplir un seau/)) count(b, 'seau puisé');
}

// Ce qu'un joueur raisonnable fait en premier dans chaque métier (les ingrédients de la Taverne d'abord).
const PREF: Record<string, RegExp[]> = {
  fermier: [/Moissonner\*\*/, /légumes/, /fromage/, /Moissonner l’orge/, /houblon/, /pommes/],
  bucheron: [/Chasser/, /chêne/, /chablis/, /Abattre/, /miel/],
};

const TOOL: Record<string, string> = { bucheron: 'hache', mineur: 'pioche', pecheur: 'canne' };

function work(b: B) {
  const j = JOB[b.job]!;
  if (b.job === 'cuisinier' || b.job === 'brasseur') {
    const scr = b.job === 'cuisinier' ? 'cuisine' : 'brasserie';
    const rec = b.job === 'cuisinier' ? 'recettes' : 'brasserie-recettes';
    b.goto('taverne', scr);
    for (let g = 0; g < 4 && b.click(/^Récupérer$/); g++) count(b, 'fournée');
    for (let k = 0; k < 3; k++) {
      b.goto('taverne', scr);
      if (!b.click(/^Cuisiner$|^Brasser$|^Lancer un brassin$/)) break;
      const opts = b.ui.selects.find((s) => /Choisir une recette/.test(s.placeholder))?.options ?? [];
      if (!opts.length) { count(b, 'ingrédients-manquants'); fetchWater(b); return; }
      // Pour la soirée : soupe d'abord (gamelles pour la fête et le chantier), sinon la première réalisable.
      const pick = opts.find((o) => o.value === 'soupe') ?? opts[0]!;
      b.choose(/Choisir une recette/, pick.value);
      if (b.click(/Lancer la production/)) count(b, 'lancé');
    }
    return;
  }
  if (b.job === 'forgeron') {
    // Minerai de fer acheté à la mine, fondu en lingots, puis ferrures (niveau 3).
    const lvl = b.st.jobs.forgeron?.level ?? 1;
    // Avant le niveau 3, il revend ses lingots pour racheter du minerai ; ensuite il les garde pour les ferrures.
    if (lvl < 3 && (b.st.items.lingot ?? 0) > 0 && (b.st.stats.ecus ?? 0) < 40 && b.goto('forge', 'echoppe-vente') && b.choose(/Choisir une ressource/, 'lingot')) {
      const q = b.ui.buttons.filter((x) => /^×\d+|^Tout/.test(x.label)).pop();
      if (q) b.click(new RegExp('^' + q.label.replace(/[()×]/g, '.')));
      if (b.click(/Confirmer la vente/)) count(b, 'lingots vendus');
      return;
    }
    if ((b.st.items.minerai ?? 0) < 2 && (b.st.stats.ecus ?? 0) > 15) { buy(b, 'mine', 'echoppe', 'minerai', 2); if ((b.st.items.minerai ?? 0) < 2) buy(b, 'forge', 'echoppe', 'minerai', 2); }
    for (const scr of ['atelier-fonderie']) {
      b.goto('forge', scr);
      for (let g = 0; g < 4 && b.click(/^Récupérer$/); g++) count(b, 'forge');
      b.click(/^Lancer$/, /ferrure/i) || b.click(/^Lancer$/, /lingot de fer/i) || b.click(/^Lancer$/, /bronze/i);
    }
    return;
  }
  // Outil usé : on en rachète un à l'échoppe du métier.
  const tool = TOOL[b.job];
  if (tool && !Object.keys(b.st.items).some((k) => k.startsWith(tool) && (b.st.items[k] ?? 0) > 0)) { buy(b, j.b === 'mine' ? 'mine' : j.b, 'echoppe', tool, 1); if (!(b.st.items[tool])) buy(b, 'place', 'echoppe', tool, 1); count(b, 'outil racheté'); return; }
  // Récolte : un lieu par passage, en tournant sur les lieux accessibles.
  const places = j.places;
  for (let k = 0; k < places.length; k++) {
    const p = places[(b.nextPlace + k) % places.length]!;
    if (!b.goto(j.b, p)) continue;
    let did = false;
    for (let g = 0; g < 4 && b.click(/^Récupérer$/); g++) { did = true; count(b, 'récolte'); }
    // Pendant la dernière récolte, le fermier moissonne en priorité.
    if (b.job === 'fermier' && T() >= 55 && T() < 85 && b.click(/^Lancer$/, /Moissonner\*\*/)) did = true;
    // Le fermier garde ses gerbes pour la dernière récolte (pas de mouture entre T+45 et T+85).
    const skip = b.job === 'fermier' && T() >= 45 && T() < 85 ? /Moudre/ : null;
    const pref = PREF[b.job];
    const rank = (x: { section?: string }) => (pref ? (pref.findIndex((r) => r.test(x.section ?? '')) + 1 || 99) : 50);
    for (const x of b.ui.buttons.filter((x) => x.label === 'Lancer' && !x.disabled && !(skip && skip.test(x.section ?? ''))).sort((p, q) => rank(p) - rank(q))) {
      const sec = (x.section ?? '').split('\n')[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (b.click(/^Lancer$/, new RegExp(sec))) { did = true; count(b, 'L:' + (x.section ?? '').split('\n')[0]!.replace(/\*/g, '').slice(0, 22)); if (process.env.TRACE === b.job) console.log('LANCE', Math.round(elapsed()), T(), (x.section ?? '').split('\n')[0]); }
    }
    if (did) { b.nextPlace = (b.nextPlace + k + 1) % places.length; return; }
  }
  // Outil cassé (« état 0/25 ») : un joueur en rachète un.
  if (tool && b.ui.buttons.some((x) => x.disabled && /état 0\//.test(x.section ?? ''))) {
    b.e.adminApply(b.id, undefined, [{ type: 'item.take', item: tool, qty: 1 }]);
    buy(b, j.b, 'echoppe', tool, 1);
    if (!(b.st.items[tool])) buy(b, 'place', 'echoppe', tool, 1);
    count(b, 'outil cassé');
    return;
  }

}

function act(b: B) {
  if (b.wait > 0) { b.wait--; return; } // en chemin vers un autre lieu
  const from = b.building;
  actInner(b);
  if (from && b.building !== from) { b.wait = TRAVEL; count(b, 'trajet'); }
}
const TRAVEL = Number(process.env.TRAVEL ?? 1);
function actInner(b: B) {
  const t = T();
  if (rnd() > eff) return; // joueur distrait, en train de lire, de parler…
  if (!b.st.activeJobs.length) {
    const j = JOB[b.job]!;
    b.goto(j.b, j.desk);
    b.click(/^Devenir|Accepter le métier/);
    return;
  }
  // Vote du conseil (T+45 à T+65) : tout le monde vote pour la pierre choisie par le scénario simulé.
  if (t >= 45 && t < 65 && !(b.st.stats.a_vote)) {
    b.goto('place', 'accueil');
    for (const s of W.buildings.find((x: any) => x.id === 'place').screens) if (/conseil/i.test(s.id)) b.goto('place', s.id);
    b.click(stone === 'forge' ? /Garder à la forge/ : /Rendre à la mine/);
  }
  if ((b.st.stats.energie ?? 0) < 20) { count(b, 'step:manger'); eat(b); return; }
  // Urgence de la tempête (T+90 à T+100).
  if (t >= 90 && t < 100) {
    if (e.variables.urgence === 'incendie') {
      if ((b.st.items.seau ?? 0) >= 3) { b.goto('forge', 'accueil'); for (let g = 0; g < 4 && b.click(/^Lancer$/, /seau|Seau|feu/); g++) count(b, 'jeté'); deliver(b, 'forge', 'accueil', 'forge/incendie'); }
      else { b.goto('place', 'accueil'); if (b.click(/^Lancer$/, /Remplir un seau/)) count(b, 'seau'); }
    } else if (e.variables.urgence === 'eboulement') {
      b.goto('mine', 'accueil');
      if (b.click(/^Lancer$/, /Déblayer/)) count(b, 'déblai');
      deliver(b, 'mine', 'accueil', 'mine/eboulement');
    }
    return;
  }
  // Livraisons (fête avant T+60, récolte T+55–85, chantier T+110–170, réparations).
  if (t < 60 && deliver(b, 'place', 'royaume', 'place/fete')) return;
  if (t >= 55 && t < 85 && deliver(b, 'ferme', 'accueil', 'ferme/recolte')) return;
  if (t >= 100 && deliver(b, 'mine', 'accueil', 'mine/reparation')) return;
  if (t >= 100 && deliver(b, 'forge', 'accueil', 'forge/reparation')) return;
  if (t >= 110 && t < 170 && deliver(b, 'eglise', 'chantier', 'eglise/chantier')) return;
  // Achats pour les objectifs (pains à la Place, gamelles à la Taverne), quand on a de quoi.
  const ecus = b.st.stats.ecus ?? 0;
  const need = (key: string, it: string) => (progress(key).missing[it] ?? 0) > 0;
  if (t < 58 && ecus > 40 && need('place/fete', 'pain_emballe') && !(b.st.items.pain_emballe)) { buy(b, 'place', 'echoppe', 'pain_emballe', 2); return; }
  if (t < 58 && ecus > 45 && need('place/fete', 'gamelle_soupe') && !(b.st.items.gamelle_soupe)) { buy(b, 'taverne', 'echoppe', 'gamelle_soupe', 1); buy(b, 'taverne', 'repas', 'soupe', 1); return; }
  if (t >= 110 && t < 168 && ecus > 40 && need('eglise/chantier', 'pain_emballe') && !(b.st.items.pain_emballe)) { buy(b, 'place', 'echoppe', 'pain_emballe', 2); return; }
  if (t >= 110 && t < 168 && ecus > 45 && need('eglise/chantier', 'gamelle_soupe') && !(b.st.items.gamelle_soupe)) { buy(b, 'taverne', 'echoppe', 'gamelle_soupe', 1); buy(b, 'taverne', 'repas', 'soupe', 1); return; }
  // Chantier : dégager l'arbre et assembler la charpente (tout le monde, avec une hache).
  if (t >= 110 && t < 170) {
    b.goto('eglise', 'chantier');
    for (let g = 0; g < 4 && b.click(/^Récupérer$/); g++) count(b, 'chantier');
    if (progress('eglise/arbre').pct < 100 && b.click(/^Lancer$/, /Dégager l’arbre/)) { count(b, 'arbre'); return; }
    if (b.click(/^Lancer$/, /Assembler/)) { count(b, 'assemblage'); return; }
  }
  // Revendre de temps en temps pour payer les repas.
  if (rnd() < 0.08) sell(b);
  count(b, 'step:travail');
  work(b);
}

// ── La soirée : un passage par joueur toutes les 15 s, le monde avance toutes les 5 s ──
const marks: Record<string, string> = {};
const log: string[] = [];
let lastT = -1;
const loggedAt = new Set<number>();
const levelAt: Record<string, number> = {};
const STOP = Number(process.env.STOP ?? 176);
const START = now;
const elapsed = () => (now - START) / 60000;
while (elapsed() < STOP) {
  for (const b of bots) {
    try { act(b); } catch (err) { count(b, 'erreur'); if ((b.stats.erreur ?? 0) < 3) log.push(`T+${T()} ${b.job}: ${(err as Error).message.slice(0, 120)}`); }
  }
  for (let i = 0; i < 3; i++) { now += 5000; e.tick(); }
  for (const b of bots) { const l = b.st.jobs[b.job]?.level ?? 0; const k = `${b.job}${b.id}:${l}`; if (l >= 3 && !(k in levelAt)) levelAt[k] = Math.round(elapsed()); }
  const t = T();
  if (t !== lastT) {
    lastT = t;
    for (const key of Object.keys(goals)) {
      const p = progress(key).pct;
      if (p >= 100 && !marks[key]) marks[key] = `100 % à T+${t}`;
    }
    if ([55, 80, 97, 160].includes(t) && !loggedAt.has(t) && loggedAt.add(t)) for (const key of Object.keys(goals)) if (!marks[key]) log.push(`T+${t} ${key} : ${progress(key).pct} % (manque ${JSON.stringify(Object.fromEntries(Object.entries(progress(key).missing).filter(([, v]) => v > 0)))})`);
  }
}
const v = e.variables;
console.log(JSON.stringify({
  jobs: jobsArg.join(','), stone, eff, seed,
  fete: v.fete, recolte: v.recolte, urgence: v.urgence, urgence_res: v.urgence_res, eglise_ok: v.eglise_ok ?? 'non', fin: v.fin,
  marks,
  chantier: progress('eglise/chantier').pct, arbre: progress('eglise/arbre').pct, assemblage: progress('eglise/assemblage').pct,
  levels: bots.map((b) => `${b.job}:${b.st.jobs[b.job]?.level ?? 0}`).join(' '),
  ecus: bots.map((b) => b.st.stats.ecus).join(' '),
  faim: bots.reduce((s, b) => s + (b.stats.faim ?? 0), 0),
  repas: bots.reduce((s, b) => s + (b.stats.repas ?? 0), 0),
  niveaux: levelAt,
  bots: bots.map((b) => `${b.job} ${JSON.stringify(b.stats)}`),
  erreurs: bots.reduce((s, b) => s + (b.stats.erreur ?? 0), 0),
}));
for (const l of log) console.log('  ' + l);
console.log('RESERVE', JSON.stringify((e as any).state.inventories['taverne/reserve'] ?? Object.keys((e as any).state.inventories)));
console.log('PLATS', JSON.stringify((e as any).state.inventories['taverne/plats']));
