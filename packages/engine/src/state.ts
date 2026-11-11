/** État d'exécution d'un monde : sérialisable en JSON, persistant entre redémarrages. */
import type { Id, WorldDef } from './model.ts';

export interface PlayerState {
  stats: Record<Id, number>;
  items: Record<Id, number>;
  /** Métiers exercés actuellement. */
  activeJobs: Id[];
  /** Progression conservée même après une démission. */
  jobs: Record<Id, { xp: number; level: number }>;
  modifiers: { id: Id; expiresAt: number }[];
  /** Durabilité actuelle de chaque outil possédé. */
  tools: Record<Id, number>;
  /** Fin de temps de recharge, par clé `${bâtiment}/${module}/${activité}`. */
  cooldowns: Record<string, number>;
  /** Activités en cours, par la même clé. Le hasard est tiré au lancement. */
  activities: Record<string, { startedAt: number; endsAt: number; results: number[] }>;
  /** Quête en cours (une seule à la fois). */
  quest?: { id: Id; since: number; progress: Record<Id, number>; seen?: Record<Id, Id[]> };
  /** Quêtes réussies (jamais reproposées). */
  questsDone: Id[];
  /** Compteur de tirages : les propositions du panneau en dépendent (stables d'un affichage à l'autre). */
  questDraws?: number;
  /** Instant du dernier nouveau tirage demandé. */
  questRerollAt?: number;
  /** Instant où le joueur a prêté serment (dotation versée une seule fois). */
  oathAt?: number;
}

export interface ObjectiveState {
  progress: Record<Id, number>;
  contributors: Record<Id, number>;
  completedAt?: number;
}

export interface StationState {
  recipe: Id;
  /** Joueur ayant lancé la production. */
  by: Id;
  startedAt: number;
  endsAt: number;
}

export interface SessionState {
  id: Id;
  player: Id;
  building: Id;
  screen: Id;
  notice?: string;
  /** État d'interface propre à chaque widget (filtres, sélections…). */
  ui: Record<string, unknown>;
  createdAt: number;
}

export interface WorldState {
  format: 'kingdom-state@1';
  revision: number;
  variables: Record<Id, string | number>;
  players: Record<Id, PlayerState>;
  /** Clé : `${bâtiment}/${module}`. */
  inventories: Record<string, Record<Id, number>>;
  /** Clé : `${bâtiment}/${module}` ; null = poste libre. */
  stations: Record<string, (StationState | null)[]>;
  sessions: Record<Id, SessionState>;
  /** Clé : `${bâtiment}/${module}`. */
  objectives: Record<string, ObjectiveState>;
  weather?: { value: string; since: number; until: number; auto: boolean };
  events: Record<Id, EventRunState>;
}

export type EventStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface EventRunState {
  status: EventStatus;
  /** Programmation automatique active (sinon : uniquement à la main). */
  auto: boolean;
  startedAt?: number;
  /** Temps écoulé (ms) accumulé avant la dernière reprise. */
  elapsedMs: number;
  resumedAt?: number;
  stepsDone: number;
  nextRunAt: number | null;
  lastEndedAt?: number;
  runs: number;
  /** Dernière erreur rencontrée en appliquant une action (le reste continue). */
  lastError?: string;
}

export const scopeKey = (building: Id, module: Id) => `${building}/${module}`;

export function createInitialState(world: WorldDef): WorldState {
  const state: WorldState = {
    format: 'kingdom-state@1',
    revision: 0,
    variables: {},
    players: {},
    inventories: {},
    stations: {},
    sessions: {},
    objectives: {},
    events: {},
  };
  for (const v of world.variables) state.variables[v.id] = v.initial;
  syncStructure(world, state);
  return state;
}

/**
 * Ajoute les structures manquantes après une modification du contenu
 * (nouvel inventaire, poste supplémentaire…) sans jamais effacer de progression.
 */
export function syncStructure(world: WorldDef, state: WorldState): void {
  state.objectives ??= {};
  state.events ??= {};
  for (const e of world.events ?? []) state.events[e.id] ??= { status: 'idle', auto: e.schedule.type !== 'manual', elapsedMs: 0, stepsDone: 0, nextRunAt: null, runs: 0 };
  // États antérieurs à la phase 2 : champs ajoutés sans perte.
  for (const p of Object.values(state.players)) normalizePlayer(p);
  for (const v of world.variables) if (!(v.id in state.variables)) state.variables[v.id] = v.initial;
  for (const b of world.buildings) {
    for (const m of b.modules) {
      const key = scopeKey(b.id, m.id);
      if (m.type === 'inventory' && !state.inventories[key]) state.inventories[key] = { ...m.initial };
      if (m.type === 'objective' && !state.objectives[key]) state.objectives[key] = { progress: {}, contributors: {} };
      if (m.type === 'production') {
        const current = state.stations[key] ?? [];
        while (current.length < m.stationCount) current.push(null);
        state.stations[key] = current;
      }
    }
  }
}

export function newPlayer(world: WorldDef): PlayerState {
  const stats: Record<Id, number> = {};
  for (const s of world.stats) stats[s.id] = s.initial;
  const jobs: PlayerState['jobs'] = {};
  const items = { ...(world.newPlayer?.items ?? {}) };
  const tools: Record<Id, number> = {};
  for (const id of Object.keys(items)) {
    const t = world.items.find((i) => i.id === id)?.tool;
    if (t) tools[id] = t.maxDurability;
  }
  return { stats, items, activeJobs: [], jobs, modifiers: [], tools, cooldowns: {}, activities: {}, questsDone: [] };
}

export function normalizePlayer(p: PlayerState): PlayerState {
  p.tools ??= {};
  p.cooldowns ??= {};
  p.activities ??= {};
  p.questsDone ??= [];
  return p;
}
