/** État global du Studio : session, serveur actif, brouillon du monde en cours d'édition. */
import { validateWorld, type Issue, type WorldDef } from '../../../packages/engine/src/index.ts';
import { get, put, post, ApiError } from './api.ts';
import { toast } from './ui.ts';

export type ServerRole = 'viewer' | 'editor' | 'manager' | 'owner';
export const RANK: Record<ServerRole, number> = { viewer: 0, editor: 1, manager: 2, owner: 3 };

export interface Account {
  id: number;
  username: string;
  displayName: string;
  platformRole: 'user' | 'platform_admin';
  createdAt: number;
  discordId: string | null;
  discordName: string | null;
  avatarUrl: string | null;
  hasPassword: boolean;
  lastLoginAt: number | null;
}
export interface ServerInfo {
  id: string;
  name: string;
  guildId: string | null;
  template: string;
  role: ServerRole;
}

export const state = {
  account: null as Account | null,
  servers: [] as ServerInfo[],
  registration: false,
  firstRun: false,
  version: '',
  discordLogin: false,
  serverId: null as string | null,
  draft: null as null | { serverId: string; world: WorldDef; revision: number; basedOn: number | null; dirty: boolean; issues: Issue[] },
};

const listeners = new Set<() => void>();
export const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
export const notify = () => listeners.forEach((fn) => fn());

export const server = () => state.servers.find((s) => s.id === state.serverId) ?? null;
export const can = (min: ServerRole) => {
  const s = server();
  return !!s && RANK[s.role] >= RANK[min];
};

export async function loadSession() {
  const s = await get('/api/session');
  state.account = s.account;
  state.servers = s.servers;
  state.registration = s.registration;
  state.firstRun = s.firstRun;
  state.version = s.version;
  state.discordLogin = !!s.discordLogin;
  const saved = localStorage.getItem('kingdom.server');
  state.serverId = state.servers.find((x) => x.id === saved)?.id ?? state.servers[0]?.id ?? null;
}

export function selectServer(id: string) {
  if (state.draft?.dirty && state.draft.serverId !== id && !confirm('Des modifications ne sont pas enregistrées. Changer de serveur quand même ?')) return false;
  state.serverId = id;
  state.draft = null;
  localStorage.setItem('kingdom.server', id);
  notify();
  return true;
}

/** Charge le brouillon (ou la version publiée) du serveur actif, si ce n'est pas déjà fait. */
export async function draft(force = false) {
  const id = state.serverId!;
  if (!force && state.draft?.serverId === id) return state.draft;
  const d = await get(`/api/servers/${id}/content/draft`);
  state.draft = { serverId: id, world: d.world, revision: d.revision, basedOn: d.basedOn, dirty: false, issues: d.issues };
  notify();
  return state.draft;
}

/** À appeler après toute modification du monde. */
export function touch() {
  if (!state.draft) return;
  state.draft.dirty = true;
  state.draft.issues = validateWorld(state.draft.world);
  notify();
}

export async function saveDraft(): Promise<boolean> {
  const d = state.draft;
  if (!d) return false;
  try {
    const r = await put(`/api/servers/${d.serverId}/content/draft`, { world: d.world, revision: d.revision });
    d.revision = r.revision;
    d.dirty = false;
    d.issues = r.issues;
    notify();
    toast('Brouillon enregistré.');
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) toast('Quelqu’un d’autre a modifié ce brouillon. Recharge la page pour récupérer sa version.', 'error');
    else toast((e as Error).message, 'error');
    return false;
  }
}

export async function publish(note?: string): Promise<boolean> {
  const d = state.draft;
  if (!d) return false;
  if (d.dirty && !(await saveDraft())) return false;
  if (d.revision === 0) {
    toast('Rien à publier : aucune modification depuis la dernière publication.', 'info');
    return false;
  }
  try {
    const r = await post(`/api/servers/${d.serverId}/content/publish`, { revision: d.revision, note });
    toast(`Version ${r.version} publiée.${r.discordSync ? ` Discord : ${r.discordSync}` : ''}`);
    await draft(true);
    return true;
  } catch (e) {
    toast((e as Error).message, 'error');
    return false;
  }
}
