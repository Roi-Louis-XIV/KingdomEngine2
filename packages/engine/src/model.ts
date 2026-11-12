/**
 * KingdomEngine — modèle de contenu d'un monde.
 *
 * Tout ce qui est décrit ici est de la DONNÉE : un monde complet (bâtiments, objets,
 * métiers, écrans Discord…) est un simple document JSON édité par le Studio.
 * Le moteur ne contient aucun contenu propre à un univers.
 */

export type Id = string;

// ---------------------------------------------------------------------------
// Textes : un texte peut varier selon des conditions (phase du scénario, métier…)
// et contenir des variables {player.stat.energie}, {npc.name}…
// ---------------------------------------------------------------------------

export interface TextCase {
  /** Absent = cas par défaut. Le premier cas dont la condition est vraie l'emporte. */
  when?: Condition;
  text: string;
}
export type Text = string | { cases: TextCase[] };

// ---------------------------------------------------------------------------
// Conditions : toujours explicables (« pourquoi est-ce refusé ? »)
// ---------------------------------------------------------------------------

export type CompareOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export type Condition =
  | { type: 'all'; conditions: Condition[] }
  | { type: 'any'; conditions: Condition[] }
  | { type: 'not'; condition: Condition }
  /** Statistique du joueur (énergie, bourse…). */
  | { type: 'stat'; stat: Id; op: CompareOp; value: number }
  /** Le joueur exerce ce métier (ou n'importe lequel si job est omis). */
  | { type: 'hasJob'; job?: Id }
  | { type: 'jobLevel'; job: Id; op: CompareOp; value: number }
  /** Variable du monde (ex. phase du scénario). */
  | { type: 'variable'; variable: Id; op: CompareOp; value: string | number }
  /** Quantité d'un objet chez le joueur ou dans un inventaire de bâtiment. */
  | { type: 'item'; item: Id; op: CompareOp; value: number; inventory?: Id }
  | { type: 'modifierActive'; modifier?: Id }
  /** Le joueur possède cet outil, en état de servir (durabilité ≥ minDurability, 1 par défaut). */
  | { type: 'tool'; item: Id; minDurability?: number }
  /** Compare deux variables du monde (ex. votes pour / votes contre). */
  | { type: 'compare'; left: Id; op: CompareOp; right: Id }
  /** Avancement d'un objectif commun, en pourcentage (100 = atteint). */
  | { type: 'objective'; building: Id; objective: Id; op: CompareOp; value: number }
  /** État d'une quête pour le joueur. */
  | { type: 'quest'; quest: Id; status: 'done' | 'active' | 'none' };

// ---------------------------------------------------------------------------
// Actions : exécutées dans une transaction atomique (tout ou rien)
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'stat.add'; stat: Id; amount: number }
  | { type: 'stat.set'; stat: Id; value: number }
  | { type: 'item.give'; item: Id; qty: number; inventory?: Id }
  | { type: 'item.take'; item: Id; qty: number; inventory?: Id }
  | { type: 'job.join'; job: Id }
  | { type: 'job.leave'; job?: Id }
  | { type: 'job.xp'; job: Id; amount: number }
  | { type: 'job.setLevel'; job: Id; level: number }
  | { type: 'modifier.apply'; modifier: Id; durationSec: number }
  | { type: 'variable.set'; variable: Id; value: string | number }
  /** Joue un son de la médiathèque dans le vocal du bâtiment (celui de l'action, ou `building`). */
  /** Son joué dans un bâtiment ; avec `character`, c'est une réplique de ce personnage, dite là où il se trouve. */
  | { type: 'audio.play'; sound: Id; building?: Id; character?: Id }
  /** Ajoute (ou retire) une valeur numérique à une variable du monde. */
  | { type: 'variable.add'; variable: Id; amount: number }
  /** Si / sinon : actions selon une condition (branches du scénario). */
  | { type: 'if'; when: Condition; then: Action[]; else?: Action[] }
  /** Applique des actions à chaque joueur connu (récompense collective). */
  | { type: 'players.each'; actions: Action[] }
  /** Fait avancer les quêtes du joueur qui comptent ce repère. */
  | { type: 'quest.tag'; tag: string; amount?: number }
  /** Annonce publique dans le salon d'annonces. */
  | { type: 'announce'; text: Text }
  /** Contribue directement à un objectif commun (sans objet à livrer). */
  | { type: 'objective.add'; building: Id; objective: Id; item: Id; qty: number }
  /** Use un outil du joueur. Échoue si l'outil est absent ou cassé. */
  | { type: 'tool.wear'; item: Id; amount: number }
  /** Répare un outil (entièrement si amount est omis). */
  | { type: 'tool.repair'; item: Id; amount?: number }
  /** Impose une météo (pendant `minutes`, sinon pour sa durée habituelle). */
  | { type: 'weather.set'; value: string; minutes?: number };

/** Une règle : conditions → actions → résultat (écran suivant, message). */
export interface Rule {
  when?: Condition;
  actions?: Action[];
  onSuccess?: Outcome;
  /** Résultat si la condition est fausse ou si une action échoue. */
  onFailure?: Outcome;
}
export interface Outcome {
  goto?: Id;
  notice?: Text;
}

// ---------------------------------------------------------------------------
// Définitions globales du monde
// ---------------------------------------------------------------------------

export interface StatDef {
  id: Id;
  name: string;
  emoji?: string;
  min: number;
  max?: number;
  initial: number;
  /** gauge = jauge affichée avec barre ; currency = monnaie. */
  kind?: 'gauge' | 'currency' | 'value';
  /** Unité affichée après une valeur (« écus »). */
  unit?: string;
}

export interface ItemDef {
  id: Id;
  name: string;
  emoji?: string;
  category?: string;
  description?: string;
  /** Prix de référence (rachat, estimation). */
  baseValue?: number;
  /** Si présent : l'objet peut être consommé depuis l'inventaire du joueur. */
  consumable?: { effects: Action[] };
  /** Si présent : l'objet est un outil qui s'use (une durabilité par joueur et par outil). */
  tool?: { maxDurability: number };
  /** Équipement : emplacement, caractéristiques (pour un futur combat) et aide au travail. */
  equipment?: Equipment;
}

export interface Equipment {
  /** Emplacement : on compte le meilleur objet de chaque emplacement (arme, armure, tête…). */
  slot: string;
  attack?: number;
  defense?: number;
  /** Réduit d'autant le coût de cette statistique pour chaque activité (ex. endurance). */
  saving?: { stat: Id; amount: number };
}

export interface ModifierDef {
  id: Id;
  name: string;
  emoji?: string;
  /** Libellé court pour les filtres (« Mine », « XP métier »). */
  shortName?: string;
  /** Deux modificateurs du même groupe ne se cumulent pas : le nouveau remplace l'ancien. */
  exclusiveGroup?: string;
  /** Valeur exploitable par d'autres systèmes (ex. 0.15 pour +15 %). */
  value?: number;
}

export interface JobDef {
  id: Id;
  name: string;
  emoji?: string;
  xpPerLevel: number;
  maxLevel?: number;
}

export interface VariableDef {
  id: Id;
  name: string;
  options?: { value: string; label: string; emoji?: string }[];
  initial: string | number;
}

export interface WorldDef {
  format: 'kingdom-world@1';
  id: Id;
  name: string;
  description?: string;
  settings: {
    /** Nombre maximal de métiers exercés simultanément. */
    maxActiveJobs: number;
    /** Fuseau horaire des programmations (défaut : Europe/Paris). */
    timezone?: string;
    /**
     * Ambiance permanente : un Voice Worker reste dans chaque salon vocal de bâtiment (qui a une ambiance),
     * même vide. Il faut au moins autant de Voice Workers que de bâtiments avec ambiance.
     * Sinon (défaut) : un worker n'est présent que dans les salons où il y a des joueurs.
     */
    voiceAlways?: boolean;
  };
  /** Météo automatique (pilote une variable du monde). */
  weather?: WeatherDef;
  /** Événements programmés ou manuels. */
  events?: EventDef[];
  stats: StatDef[];
  items: ItemDef[];
  modifiers: ModifierDef[];
  jobs: JobDef[];
  variables: VariableDef[];
  /** Ce que reçoit un nouveau joueur. */
  newPlayer?: { items?: Record<Id, number> };
  /** Quêtes personnelles (panneau des quêtes). */
  quests?: QuestSystem;
  /** Arrivée dans le monde : serment à prêter avant d'accéder aux bâtiments. */
  onboarding?: Onboarding;
  /**
   * Fermeture du monde (fin de séance, maintenance…) : tant que la condition est vraie, chaque interface
   * de bâtiment n'affiche que ce texte et plus aucune action n'est possible.
   * Dans les textes, {salon.aide} devient un lien vers le salon d'aide choisi dans Discord & voix.
   */
  closure?: { when: Condition; text: Text };
  /**
   * Personnages (PNJ) présents en voix : chacun a son Voice Worker, à son nom, dans le salon vocal du bâtiment
   * où il se trouve (si des joueurs y sont). Sans cette liste, chaque bâtiment a pour personnage son `npc`.
   */
  characters?: CharacterDef[];
  buildings: BuildingDef[];
}

export interface CharacterDef {
  id: Id;
  name: string;
  title?: string;
  emoji?: string;
  /** Bâtiment où il se trouve d'habitude : il y joue l'ambiance. */
  home: Id;
  /** Déplacements : la première condition vraie l'emmène dans ce bâtiment (ex. tous à l'église pour la messe). */
  moves?: { when: Condition; building: Id }[];
}

// ---------------------------------------------------------------------------
// Arrivée (serment)
// ---------------------------------------------------------------------------

export interface Onboarding {
  enabled: boolean;
  /** Nom du salon d'arrivée sur Discord. */
  channelName: string;
  title: string;
  /** Texte du serment (règles du monde). */
  text: Text;
  button: string;
  buttonEmoji?: string;
  /** Nom du rôle Discord donné à ceux qui ont prêté serment. */
  roleName: string;
  /** Message affiché au joueur après le serment. */
  confirmation: Text;
  /** Dotation donnée une seule fois (écus, objets…). */
  actions: Action[];
}

// ---------------------------------------------------------------------------
// Quêtes personnelles
// ---------------------------------------------------------------------------

export interface QuestLevel {
  name: string;
  emoji?: string;
  /** XP minimale pour atteindre ce niveau. */
  minXp: number;
  /** Chances relatives de proposer une quête ★, ★★, ★★★. */
  weights: [number, number, number];
}

export interface QuestSystem {
  /** Statistique servant d'XP (gagnée par les quêtes, fixe le niveau). */
  xpStat: Id;
  levels: QuestLevel[];
  /** Nombre de quêtes proposées sur le panneau. */
  offers: number;
  /** Délai entre deux nouveaux tirages demandés par le joueur. */
  rerollMinutes: number;
  /** Récompenses par difficulté, ajoutées à celles de la quête. */
  rewards?: Partial<Record<'1' | '2' | '3', Action[]>>;
  quests: QuestDef[];
}

export type QuestStep =
  /** Visiter un bâtiment ; sans bâtiment : visiter `count` lieux différents. */
  | { id: Id; kind: 'visit'; label: string; building?: Id; count?: number }
  /** Livrer des objets (bouton « Livrer » dans l'inventaire, dans le bâtiment indiqué). */
  | { id: Id; kind: 'deliver'; label: string; item: Id; qty: number; building: Id }
  /** Compter des repères (activité récupérée, achat, dialogue, action quest.tag…). */
  | { id: Id; kind: 'count'; label: string; tags: string[]; target: number };

export interface QuestDef {
  id: Id;
  name: string;
  emoji?: string;
  /** Personnage qui confie la quête. */
  giver?: string;
  difficulty: 1 | 2 | 3;
  description?: Text;
  /** Fenêtre de disponibilité (phase du scénario…). */
  when?: Condition;
  /** Toujours proposée en premier tant qu'elle est disponible et non faite (tutoriel). */
  featured?: boolean;
  /** Une seule personne à la fois peut la mener. */
  unique?: boolean;
  /** Étapes à faire dans l'ordre. */
  ordered?: boolean;
  steps: QuestStep[];
  rewards: Action[];
  /** Texte affiché à la réussite. */
  success?: Text;
}

// ---------------------------------------------------------------------------
// Météo et événements
// ---------------------------------------------------------------------------

export interface WeatherState {
  /** Valeur de la variable (doit exister dans ses options). */
  value: string;
  /** Probabilité relative d'être tiré au prochain changement. */
  weight: number;
  minMinutes: number;
  maxMinutes: number;
  /** Annonce publiée quand ce temps s'installe. */
  announce?: Text;
}

export interface WeatherDef {
  /** Variable du monde pilotée (ex. « meteo »). */
  variable: Id;
  states: WeatherState[];
}

export type EventSchedule =
  | { type: 'manual' }
  /** Tous les jours (ou certains jours, 0 = dimanche) à l'heure locale HH:MM. */
  | { type: 'daily'; at: string; days?: number[] }
  | { type: 'interval'; everyMinutes: number }
  /** Une seule fois, à une date ISO (heure locale du monde si sans fuseau). */
  | { type: 'once'; at: string };

export interface EventStep {
  /** Minutes écoulées depuis le début de l'événement (hors pauses). */
  afterMinutes: number;
  name?: string;
  actions: Action[];
  announce?: Text;
}

export interface EventDef {
  id: Id;
  name: string;
  emoji?: string;
  description?: string;
  schedule: EventSchedule;
  /** Durée en minutes ; 0 = jusqu'à l'arrêt manuel. */
  durationMinutes: number;
  onStart: Action[];
  onEnd: Action[];
  steps: EventStep[];
  announce?: { start?: Text; end?: Text };
}

// ---------------------------------------------------------------------------
// Bâtiments = assemblage de modules génériques + écrans Discord
// ---------------------------------------------------------------------------

export interface BuildingDef {
  id: Id;
  name: string;
  emoji?: string;
  /** Couleur d'accent par défaut des encadrés (0xRRGGBB). */
  accentColor?: number;
  npc?: { name: string; emoji?: string; title?: string; avatarUrl?: string };
  /** Panneau d'entrée affiché dans le salon texte du bâtiment (avant d'entrer). */
  entrance?: { text?: string; button?: string; buttonEmoji?: string };
  /** Audio du salon vocal du bâtiment (joué par un Voice Worker). */
  audio?: BuildingAudio;
  modules: ModuleDef[];
  screens: ScreenDef[];
  homeScreen: Id;
}

/** Choix d'un son, éventuellement selon des conditions (phase du scénario…). */
export type SoundChoice = Id | { cases: { when?: Condition; sound: Id }[] };

export interface BuildingAudio {
  /** Fond sonore en boucle (tant que des joueurs sont présents, ou tout le temps avec settings.voiceAlways). */
  ambience?: SoundChoice;
  /** Son joué à l'arrivée du Voice Worker. */
  welcome?: Id;
  /** Volume 0–1 (défaut 0.6). */
  volume?: number;
}

export type ModuleDef =
  | InventoryModule
  | ShopModule
  | BuybackModule
  | ProductionModule
  | DialogueModule
  | DiceModule
  | ActivityModule
  | ObjectiveModule;

/** Inventaire partagé du bâtiment. Les objectifs sont des repères, jamais des plafonds. */
export interface InventoryModule {
  type: 'inventory';
  id: Id;
  name: string;
  emoji?: string;
  initial: Record<Id, number>;
  targets: Record<Id, number>;
}

export interface ShopOffer {
  id: Id;
  name: string;
  emoji?: string;
  category?: string;
  /** Objet prélevé dans l'inventaire du bâtiment à chaque vente. */
  stockItem: Id;
  price: number;
  /** Effets appliqués lors d'une consommation sur place. */
  effects: Action[];
  /** Vente à emporter : le joueur reçoit un objet (consommable plus tard). */
  takeaway?: { item: Id; surcharge: number };
  /** Modificateur mis en avant (filtres « par bonus »). Déduit des effets si absent. */
  highlightModifier?: Id;
}

export interface ShopModule {
  type: 'shop';
  id: Id;
  name: string;
  emoji?: string;
  inventory: Id;
  currency: Id;
  offers: ShopOffer[];
}

/** Rachat de ressources aux joueurs, prix fonction du niveau de réserve. */
export interface BuybackModule {
  type: 'buyback';
  id: Id;
  name: string;
  inventory: Id;
  currency: Id;
  /** Prix de base par objet racheté. */
  prices: Record<Id, number>;
  /** Facteur appliqué si la réserve est vide. */
  emptyFactor: number;
  /** Paliers par ratio réserve/objectif, du plus bas au plus haut. */
  tiers: { maxRatio: number; factor: number }[];
  /** Facteur au-delà du dernier palier. */
  aboveFactor: number;
  /** Quantités proposées en raccourci. */
  quantities: number[];
}

export interface Recipe {
  id: Id;
  name: string;
  emoji?: string;
  level: number;
  durationSec: number;
  inputs: Record<Id, number>;
  outputs: Record<Id, number>;
  xp?: { start: number; collect: number };
}

/** Postes de production partagés (marmites, forges…) avec cuisson minutée. */
export interface ProductionModule {
  type: 'production';
  id: Id;
  name: string;
  stationName: string;
  stationCount: number;
  /** Métier requis pour lancer et récupérer. */
  job?: Id;
  inputInventory: Id;
  outputInventory: Id;
  /** XP par défaut : au lancement (préparateur) et à la récupération. */
  xp: { start: number; collect: number };
  recipes: Recipe[];
  /** Libellés des boutons de poste (par défaut : Lancer / Détails / Récupérer). */
  labels?: { start?: string; details?: string; collect?: string };
}

export interface DialogueChoice {
  label: string;
  emoji?: string;
  goto?: Id;
  /** Ouvre un écran au lieu d'un sujet. */
  screen?: Id;
  when?: Condition;
}
export interface DialogueNode {
  id: Id;
  title: string;
  /** Répliques ; plusieurs = rotation à chaque visite. Chacune peut varier selon des conditions. */
  lines: Text[];
  choices: DialogueChoice[];
}
export interface DialogueModule {
  type: 'dialogue';
  id: Id;
  name: string;
  speaker: { name: string; emoji?: string };
  narration?: Text;
  start: Id;
  nodes: DialogueNode[];
}

export interface DiceModule {
  type: 'dice';
  id: Id;
  name: string;
  dice: number;
  faces: number;
  opponent: string;
  texts: { win: Text; lose: Text; draw: Text };
}

/** Un résultat possible d'une activité, tiré au hasard selon son poids. */
export interface ActivityResult {
  weight: number;
  /** Libellé affiché au joueur (« Belle récolte ! »). */
  label: string;
  actions: Action[];
  /** Résultat possible seulement si… (niveau de métier, outil…). */
  when?: Condition;
  /** Poids ajouté quand la condition est vraie (meilleur outil, meilleur niveau…). */
  bonus?: { when: Condition; weight: number }[];
}

/** Activité personnelle temporisée : récolte, expédition, entraînement… */
export interface ActivityDef {
  id: Id;
  name: string;
  emoji?: string;
  description?: string;
  /** 0 = résultat immédiat. */
  durationSec: number;
  /** Délai avant de pouvoir recommencer (compté depuis la récupération). */
  cooldownSec: number;
  /** Condition d'accès (métier, niveau, phase…). */
  when?: Condition;
  /** Coûts payés au lancement (énergie…). */
  costs: Action[];
  /** Outil nécessaire, usé au lancement. `anyOf` : outils acceptés à la place, du meilleur au moins bon. */
  tool?: { item: Id; wear: number; anyOf?: Id[] };
  /** Expérience de métier gagnée à la récupération. */
  job?: { id: Id; xp: number };
  /** Nombre de tirages dans la table des résultats. */
  rolls: number;
  results: ActivityResult[];
  /** Bonus qui augmentent les objets obtenus (valeur du bonus : 0.10 = +10 %). */
  boostedBy?: Id[];
  /** Rendement selon l'état du monde : le premier facteur dont la condition est vraie s'applique aux objets reçus. */
  multipliers?: { when: Condition; factor: number; label?: string }[];
  /** Nombre maximal de joueurs menant cette activité en même temps. */
  maxConcurrent?: number;
  /** Message affiché quand la condition d'accès n'est pas remplie (sinon : l'explication automatique). */
  lockedText?: Text;
}

export interface ActivityModule {
  type: 'activity';
  id: Id;
  name: string;
  activities: ActivityDef[];
}

/** Objectif collectif : tous les joueurs apportent des objets jusqu'à atteindre les quantités visées. */
export interface ObjectiveModule {
  type: 'objective';
  id: Id;
  name: string;
  description?: Text;
  goals: Record<Id, number>;
  /** Récompense par unité apportée (ex. 3 écus par planche). */
  currency?: Id;
  unitRewards?: Record<Id, number>;
  quantities: number[];
  /** L'objectif n'accepte de contributions que si… (fenêtre du scénario). */
  when?: Condition;
  /** Message affiché quand il est fermé. */
  closedText?: Text;
  /** XP (ou autre statistique) gagnée par unité apportée. */
  xpPerUnit?: { stat: Id; amount: number };
  /** Quand l'objectif est atteint : actions sur le monde (variable.set…) et annonce. */
  onComplete?: { actions: Action[]; announce?: Text };
}

// ---------------------------------------------------------------------------
// Écrans : une interface Discord = un message, navigation par écrans
// ---------------------------------------------------------------------------

export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger';

export interface ButtonDef {
  label: Text;
  emoji?: string;
  style?: ButtonStyle;
  /** Bouton affiché seulement si… */
  visibleIf?: Condition;
  /** Ce qui se passe au clic. Sans actions ni condition : simple navigation. */
  rule: Rule;
}

export type Block =
  | { type: 'text'; text: Text; visibleIf?: Condition }
  | { type: 'container'; accent?: number; children: Block[]; visibleIf?: Condition }
  | { type: 'separator'; large?: boolean; visibleIf?: Condition }
  | { type: 'section'; text: Text; button: ButtonDef; visibleIf?: Condition }
  | { type: 'buttons'; buttons: ButtonDef[]; visibleIf?: Condition }
  /** Emplacement du message de retour (succès, erreur). */
  | { type: 'notice'; visibleIf?: Condition }
  | { type: 'widget'; widget: WidgetDef; visibleIf?: Condition };

export type WidgetDef =
  | { kind: 'player.status'; title?: string; stats: Id[]; showModifier?: boolean; accent?: number }
  | { kind: 'player.consumables'; title?: string; accent?: number; /** Montre aussi les objets non consommables. */ all?: boolean }
  | { kind: 'shop.catalog'; shop: Id; checkoutScreen: Id; accent?: number; filters?: boolean }
  | { kind: 'shop.checkout'; backScreen: Id; prompt?: Text; accent?: number }
  | { kind: 'production.stations'; production: Id; recipeScreen: Id }
  | { kind: 'production.priorities'; production: Id; limit?: number; title?: string; accent?: number }
  | { kind: 'production.recipes'; production: Id; backScreen: Id; accent?: number }
  | {
      kind: 'inventory.stock';
      views: { label: string; emoji?: string; inventory: Id; buyback?: Id }[];
    }
  | { kind: 'buyback.sell'; buyback: Id; accent?: number }
  | { kind: 'dialogue'; dialogue: Id; exitScreen: Id; accent?: number }
  | { kind: 'dice'; dice: Id; accent?: number }
  | { kind: 'activity.board'; activity: Id; accent?: number }
  | { kind: 'objective.board'; objective: Id; accent?: number }
  | { kind: 'player.tools'; title?: string; repair?: { currency: Id; costPerPoint: number }; accent?: number }
  /** Panneau des quêtes : propositions, choix, abandon, nouveau tirage. */
  | { kind: 'quest.board'; title?: string; accent?: number }
  /** Fiche du joueur : statistiques, XP et niveau, quête en cours (bouton Livrer si besoin). */
  | { kind: 'player.sheet'; stats: Id[]; /** Affiche les métiers (niveau et expérience). */ jobs?: boolean; accent?: number }
  /** Classement des joueurs selon une statistique. */
  | { kind: 'ranking'; stat: Id; title?: string; limit?: number; accent?: number };

export interface ScreenDef {
  id: Id;
  name: string;
  /** Accès conditionnel : sinon redirection (ex. cuisine réservée aux cuisiniers). */
  guard?: { when: Condition; redirect: Id; notice?: Text };
  blocks: Block[];
}
