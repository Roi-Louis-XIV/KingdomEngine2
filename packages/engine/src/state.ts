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
  for (const v of world.variables) if (!(v.id in state.variables)) state.variables[v.id] = v.initial;
  for (const b of world.buildings) {
    for (const m of b.modules) {
      const key = scopeKey(b.id, m.id);
      if (m.type === 'inventory' && !state.inventories[key]) state.inventories[key] = { ...m.initial };
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
  return { stats, items: { ...(world.newPlayer?.items ?? {}) }, activeJobs: [], jobs, modifiers: [] };
}
