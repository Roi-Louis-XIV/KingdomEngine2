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
  | { type: 'modifierActive'; modifier?: Id };

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
  | { type: 'variable.set'; variable: Id; value: string | number };

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
  };
  stats: StatDef[];
  items: ItemDef[];
  modifiers: ModifierDef[];
  jobs: JobDef[];
  variables: VariableDef[];
  /** Ce que reçoit un nouveau joueur. */
  newPlayer?: { items?: Record<Id, number> };
  buildings: BuildingDef[];
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
  npc?: { name: string; emoji?: string; title?: string };
  modules: ModuleDef[];
  screens: ScreenDef[];
  homeScreen: Id;
}

export type ModuleDef =
  | InventoryModule
  | ShopModule
  | BuybackModule
  | ProductionModule
  | DialogueModule
  | DiceModule;

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
  | { kind: 'player.consumables'; title?: string; accent?: number }
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
  | { kind: 'dice'; dice: Id; accent?: number };

export interface ScreenDef {
  id: Id;
  name: string;
  /** Accès conditionnel : sinon redirection (ex. cuisine réservée aux cuisiniers). */
  guard?: { when: Condition; redirect: Id; notice?: Text };
  blocks: Block[];
}
