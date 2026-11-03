export interface BuildingPayload {
  name: string;
  description?: string;
  emoji?: string;
  category?: string;
  entity_kind?: string;
  location_key?: string;
  parent_key?: string;
  actions?: Array<Record<string, unknown>>;
  modules?: Record<string, unknown>;
  relations?: Record<string, unknown>;
  interface?: {
    pages?: Array<{ key: string; name?: string; components?: unknown[] }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
export interface Entity {
  entity_type: string;
  entity_key: string;
  version: number;
  status: "draft" | "published" | "archived";
  payload: BuildingPayload;
  created_at?: string;
  published_at?: string;
}
export interface World {
  slug: string;
  name: string;
  role: string;
  permissions: string[];
  guild_id?: string;
  bot_installed?: boolean;
}
export interface Profile {
  account: { display_name: string; username: string; is_admin: boolean };
  servers: World[];
  current_server: string;
}
export interface Change {
  id: number;
  kind: string;
  aggregate_key: string;
  aggregate_type: string;
  created_at: string;
}
export interface Overview {
  generated_at: string;
  metrics: {
    players: number;
    buildings: number;
    published_buildings: number;
    pending_jobs: number;
    active_events: number;
  };
  services: Array<{ key: string; name: string; running: boolean }>;
  changes: Change[];
  activity: Array<{
    created_at: string;
    player_name?: string;
    display_name?: string;
    building_name?: string;
    action_name?: string;
  }>;
  buildings: Array<{
    key: string;
    stock_total: number;
    stock: Array<{ id: string; name: string; quantity: number }>;
    pending: number;
  }>;
}
export interface SyncStatus {
  scope?: string;
  status?: string;
  building_key?: string;
  summary?: string;
  error?: string;
  installed?: boolean;
}
