/**
 * Un moteur par serveur, chargé depuis la version publiée et l'état sauvegardé.
 * Toute modification est persistée immédiatement ; les abonnés (Discord, voix, Studio)
 * sont prévenus des changements.
 */
import { Engine, type Action, type EngineEvent, type InteractionResult, type View } from '../../../packages/engine/src/index.ts';
import type { Account, Platform } from './platform.ts';
import { HttpError } from './platform.ts';

export type RuntimeSignal =
  | { type: 'changed'; serverId: string }
  | { type: 'reloaded'; serverId: string; version: number }
  | { type: 'engine'; serverId: string; events: EngineEvent[] };

interface Loaded {
  engine: Engine;
  version: number;
  savedRevision: number;
}

export class Runtimes {
  private readonly platform: Platform;
  private readonly loaded = new Map<string, Loaded>();
  private readonly listeners = new Set<(s: RuntimeSignal) => void>();
  private readonly now?: () => number;

  constructor(platform: Platform, now?: () => number) {
    this.platform = platform;
    this.now = now;
  }

  on(fn: (s: RuntimeSignal) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(s: RuntimeSignal) {
    for (const fn of this.listeners) {
      try {
        fn(s);
      } catch (e) {
        console.error('Abonné en échec :', e);
      }
    }
  }

  /** Moteur du serveur (chargé à la demande), ou undefined si rien n'est publié. */
  engine(serverId: string): Engine | undefined {
    const hit = this.loaded.get(serverId);
    if (hit) return hit.engine;
    const pub = this.platform.published(serverId);
    if (!pub) return undefined;
    const engine = new Engine(pub.world, this.platform.loadState(serverId), this.now ? { now: this.now } : {});
    const entry = { engine, version: pub.version, savedRevision: -1 };
    this.loaded.set(serverId, entry);
    this.persist(serverId);
    return engine;
  }

  require(serverId: string): Engine {
    const e = this.engine(serverId);
    if (!e) throw new HttpError(409, 'Aucune version publiée pour ce serveur.');
    return e;
  }

  version(serverId: string): number | undefined {
    this.engine(serverId);
    return this.loaded.get(serverId)?.version;
  }

  /** Après publication : nouveau contenu, même état (aucune progression perdue). */
  reload(serverId: string): void {
    const current = this.loaded.get(serverId);
    const pub = this.platform.published(serverId);
    if (!pub) return;
    const state = current ? current.engine.snapshot() : this.platform.loadState(serverId);
    const engine = new Engine(pub.world, state, this.now ? { now: this.now } : {});
    this.loaded.set(serverId, { engine, version: pub.version, savedRevision: -1 });
    this.persist(serverId);
    this.emit({ type: 'reloaded', serverId, version: pub.version });
    this.emit({ type: 'changed', serverId });
  }

  unload(serverId: string): void {
    this.loaded.delete(serverId);
  }

  /** Sauvegarde si l'état a changé depuis la dernière écriture. */
  persist(serverId: string): boolean {
    const l = this.loaded.get(serverId);
    if (!l || l.engine.revision === l.savedRevision) return false;
    this.platform.saveState(serverId, l.engine.snapshot());
    l.savedRevision = l.engine.revision;
    return true;
  }

  // -------------------------------------------------------------------------
  // Opérations de jeu (appelées par l'adaptateur Discord)
  // -------------------------------------------------------------------------

  open(serverId: string, player: { id: string; name: string; avatarUrl?: string | null }, buildingId: string): { sessionId: string; view: View } {
    const engine = this.require(serverId);
    this.platform.touchPlayer(serverId, player.id, player.name, player.avatarUrl);
    const r = engine.openSession(player.id, buildingId);
    this.persist(serverId);
    return r;
  }

  view(serverId: string, sessionId: string): View | undefined {
    const engine = this.engine(serverId);
    if (!engine) return undefined;
    const v = engine.view(sessionId);
    if (this.persist(serverId)) this.emit({ type: 'changed', serverId });
    return v;
  }

  interact(serverId: string, player: { id: string; name: string; avatarUrl?: string | null }, customId: string, values: string[]): InteractionResult {
    const engine = this.require(serverId);
    const before = engine.revision;
    const r = engine.interact(player.id, customId, values);
    if (r.ok) this.platform.touchPlayer(serverId, player.id, player.name, player.avatarUrl);
    if (r.notice) {
      const building = engine.snapshot().sessions[customId.split('|')[0] ?? '']?.building ?? null;
      this.platform.logActivity(serverId, player.id, building, r.notice);
    }
    this.persist(serverId);
    if (r.events?.length) this.emit({ type: 'engine', serverId, events: r.events });
    if (engine.revision !== before) this.emit({ type: 'changed', serverId });
    return r;
  }

  // -------------------------------------------------------------------------
  // Interventions (Studio)
  // -------------------------------------------------------------------------

  adminApply(serverId: string, account: Account, playerId: string, actions: Action[], reason?: string): string {
    const engine = this.require(serverId);
    let summary: string;
    try {
      summary = engine.adminApply(playerId, undefined, actions);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    this.persist(serverId);
    const label = describeActions(actions);
    this.platform.audit(serverId, account.id, 'player.intervention', `${this.playerName(serverId, playerId)} : ${label}${reason ? ` (${reason})` : ''}`, { playerId, actions });
    this.platform.logActivity(serverId, playerId, null, `🛠️ Intervention de ${account.displayName} : ${label}`);
    this.emit({ type: 'changed', serverId });
    return summary;
  }

  setVariable(serverId: string, account: Account, variable: string, value: string | number): void {
    const engine = this.require(serverId);
    try {
      engine.setVariable(variable, value);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    this.persist(serverId);
    const def = engine.world.variables.find((v) => v.id === variable);
    const label = def?.options?.find((o) => o.value === value)?.label ?? value;
    this.platform.audit(serverId, account.id, 'world.variable', `${def?.name ?? variable} → ${label}`);
    this.platform.logActivity(serverId, null, null, `🎭 ${def?.name ?? variable} : ${label}`);
    this.emit({ type: 'changed', serverId });
  }

  private playerName(serverId: string, playerId: string) {
    return this.platform.playerMeta(serverId).get(playerId)?.name ?? playerId;
  }
}

export function describeActions(actions: Action[]): string {
  return actions
    .map((a) => {
      switch (a.type) {
        case 'stat.add':
          return `${a.stat} ${a.amount >= 0 ? '+' : ''}${a.amount}`;
        case 'stat.set':
          return `${a.stat} = ${a.value}`;
        case 'item.give':
          return `+${a.qty} ${a.item}`;
        case 'item.take':
          return `−${a.qty} ${a.item}`;
        case 'job.join':
          return `métier ${a.job}`;
        case 'job.leave':
          return `quitte ${a.job ?? 'son métier'}`;
        case 'job.setLevel':
          return `${a.job} niveau ${a.level}`;
        case 'job.xp':
          return `${a.job} +${a.amount} XP`;
        case 'modifier.apply':
          return `bonus ${a.modifier}`;
        case 'variable.set':
          return `${a.variable} = ${a.value}`;
        case 'audio.play':
          return `son ${a.sound}`;
      }
    })
    .join(', ');
}
