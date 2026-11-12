/**
 * Pool générique de Voice Workers — sans Discord, entièrement testable.
 *
 * - Une « présence » = un besoin vocal (l'ambiance et le PNJ d'un bâtiment occupé).
 * - Un « worker » = une connexion vocale (un bot Discord). Un worker sert une présence à la fois.
 * - reconcile() compare les présences souhaitées à l'existant et renvoie les changements à appliquer.
 *   Une présence garde son worker tant qu'elle est souhaitée (pas de saut d'un bot à l'autre).
 *   Une présence qui n'est plus souhaitée est libérée après un délai de grâce.
 */

export interface Presence {
  key: string;
  guildId: string;
  channelId: string;
  serverId: string;
  building: string;
  /** Personnage incarné (ses répliques passent par ce worker, où qu'il soit). */
  character?: string;
  /** Joue l'ambiance du bâtiment et ses sons sans personnage. */
  holder?: boolean;
  identity: { name: string; avatarUrl?: string };
  ambience?: string;
  /** Message répété par-dessus l'ambiance, toutes les `every` secondes. */
  message?: { sound: string; every: number };
  welcome?: string;
  volume: number;
}

export interface WorkerState {
  key: string;
  label: string;
  /** Serveurs Discord où ce worker est installé. */
  guilds: Set<string>;
  online: boolean;
  presence?: Presence;
  /** Dernier instant où la présence était souhaitée. */
  wantedAt?: number;
  error?: string;
}

export interface ReconcilePlan {
  assign: { worker: string; presence: Presence }[];
  update: { worker: string; presence: Presence }[];
  release: { worker: string; presenceKey: string }[];
  /** Présences sans worker disponible (capacité atteinte ou aucun worker installé sur le serveur). */
  unplaced: { presence: Presence; reason: string }[];
}

export class VoicePool {
  readonly workers = new Map<string, WorkerState>();
  private cursor = 0;
  /** Délai avant de libérer une présence devenue inutile (ms). */
  graceMs: number;

  constructor(graceMs = 30_000) {
    this.graceMs = graceMs;
  }

  register(key: string, label: string): WorkerState {
    const w = this.workers.get(key) ?? { key, label, guilds: new Set<string>(), online: false };
    this.workers.set(key, w);
    return w;
  }

  /** Calcule les changements nécessaires et met à jour l'état interne en conséquence. */
  reconcile(desired: Presence[], now: number, departed: Set<string> = new Set()): ReconcilePlan {
    const plan: ReconcilePlan = { assign: [], update: [], release: [], unplaced: [] };
    const wanted = new Map(desired.map((p) => [p.key, p]));

    // 1. Présences déjà servies : on garde le même worker et on rafraîchit la scène si besoin.
    for (const w of this.workers.values()) {
      if (!w.presence) continue;
      const p = wanted.get(w.presence.key);
      if (p && w.online) {
        w.wantedAt = now;
        if (p.ambience !== w.presence.ambience || p.channelId !== w.presence.channelId || p.identity.name !== w.presence.identity.name || p.volume !== w.presence.volume || p.holder !== w.presence.holder || p.building !== w.presence.building || JSON.stringify(p.message) !== JSON.stringify(w.presence.message)) {
          w.presence = p;
          plan.update.push({ worker: w.key, presence: p });
        }
        wanted.delete(p.key);
      } else if (!w.online || now - (w.wantedAt ?? 0) >= this.graceMs || departed.has(w.presence.key) || desired.some((d) => d.channelId === w.presence!.channelId && d.holder && w.presence!.holder)) {
        // Libération immédiate (sans délai de grâce) quand quelqu'un d'autre reprend l'ambiance de ce salon :
        // ex. le personnage du lieu arrive et remplace la présence au nom du bâtiment.
        plan.release.push({ worker: w.key, presenceKey: w.presence.key });
        w.presence = undefined;
        w.wantedAt = undefined;
      }
    }

    // 2. Nouvelles présences : premier worker libre, en ligne et installé sur ce serveur (tourniquet).
    const order = [...this.workers.values()];
    for (const p of wanted.values()) {
      // Une présence en délai de grâce (encore attribuée) n'est pas dupliquée.
      if (order.some((w) => w.presence?.key === p.key)) continue;
      let chosen: WorkerState | undefined;
      for (let i = 0; i < order.length; i++) {
        const w = order[(this.cursor + i) % order.length]!;
        if (w.online && !w.presence && w.guilds.has(p.guildId)) {
          chosen = w;
          this.cursor = (this.cursor + i + 1) % order.length;
          break;
        }
      }
      if (!chosen) {
        const installed = order.filter((w) => w.guilds.has(p.guildId) && w.online).length;
        plan.unplaced.push({
          presence: p,
          reason: installed ? 'Tous les Voice Workers de ce serveur sont occupés.' : 'Aucun Voice Worker en ligne n’est installé sur ce serveur.',
        });
        continue;
      }
      chosen.presence = p;
      chosen.wantedAt = now;
      plan.assign.push({ worker: chosen.key, presence: p });
    }
    return plan;
  }

  /** Libère immédiatement un worker (déconnexion, erreur). */
  release(workerKey: string, error?: string): void {
    const w = this.workers.get(workerKey);
    if (!w) return;
    w.presence = undefined;
    w.wantedAt = undefined;
    w.error = error;
  }

  snapshot() {
    return [...this.workers.values()].map((w) => ({
      key: w.key,
      label: w.label,
      online: w.online,
      guilds: [...w.guilds],
      presence: w.presence ? { key: w.presence.key, serverId: w.presence.serverId, building: w.presence.building, name: w.presence.identity.name, ambience: w.presence.ambience ?? null } : null,
      error: w.error ?? null,
    }));
  }
}
