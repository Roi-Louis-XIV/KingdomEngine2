/**
 * Voice Workers : bots Discord techniques qui rejoignent le salon vocal d'un bâtiment occupé,
 * prennent le nom de son PNJ et jouent son ambiance (et les sons déclenchés par les actions).
 * L'allocation est décidée par VoicePool (testé) ; ce fichier applique ses décisions sur Discord.
 */
import { Client, Events, GatewayIntentBits } from 'discord.js';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Platform } from '../platform.ts';
import type { Runtimes } from '../runtime.ts';
import type { VoiceBridge } from '../bridges.ts';
import type { CoreBot } from '../discord/core.ts';
import { VoicePool, type Presence } from './pool.ts';
import { desiredPresences, type BuildingChannels } from './planner.ts';

export interface WorkerConfig {
  key: string;
  label: string;
  token: string;
  applicationId?: string;
}

interface Live {
  client: Client;
  config: WorkerConfig;
  connection?: VoiceConnection;
  player?: AudioPlayer;
  /** Son d'ambiance en boucle actuellement attendu. */
  ambience?: { path: string; volume: number };
  presence?: Presence;
}

/** Lit VOICE_WORKER_1_TOKEN … VOICE_WORKER_20_TOKEN (et leurs APPLICATION_ID). */
export function workersFromEnv(env: NodeJS.ProcessEnv): WorkerConfig[] {
  const out: WorkerConfig[] = [];
  for (let i = 1; i <= 20; i++) {
    const token = env[`VOICE_WORKER_${i}_TOKEN`];
    if (!token) continue;
    out.push({ key: `worker-${i}`, label: `Voice Worker ${i}`, token, applicationId: env[`VOICE_WORKER_${i}_APPLICATION_ID`] });
  }
  return out;
}

export class VoiceWorkers implements VoiceBridge {
  readonly pool = new VoicePool(30_000);
  private readonly live = new Map<string, Live>();
  private readonly platform: Platform;
  private readonly runtimes: Runtimes;
  private readonly core: CoreBot;
  private readonly audioDir: string;
  private unplaced: { serverId: string; building: string; reason: string }[] = [];
  private readonly ffmpeg: boolean;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private pending = false;

  constructor(platform: Platform, runtimes: Runtimes, core: CoreBot, audioDir: string, configs: WorkerConfig[]) {
    this.platform = platform;
    this.runtimes = runtimes;
    this.core = core;
    this.audioDir = audioDir;
    this.ffmpeg = hasFfmpeg();
    for (const c of configs) {
      this.pool.register(c.key, c.label);
      this.live.set(c.key, { client: new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] }), config: c });
    }
  }

  async start(): Promise<void> {
    for (const [key, l] of this.live) {
      const state = this.pool.workers.get(key)!;
      l.client.on(Events.ClientReady, (c) => {
        state.online = true;
        state.error = undefined;
        state.guilds = new Set(c.guilds.cache.keys());
        console.log(`🎙️  ${l.config.label} connecté : ${c.user.tag} (${state.guilds.size} serveur(s))`);
        this.refresh();
      });
      l.client.on(Events.GuildCreate, (g) => (state.guilds.add(g.id), this.refresh()));
      l.client.on(Events.GuildDelete, (g) => (state.guilds.delete(g.id), this.refresh()));
      l.client.on(Events.Error, (e) => (state.error = e.message));
      l.client.on(Events.ShardDisconnect, () => ((state.online = false), this.refresh()));
      l.client.login(l.config.token).catch((e) => {
        state.error = `Connexion impossible : ${e.message}`;
        console.warn(`${l.config.label} :`, e.message);
      });
    }
    this.core.onVoiceActivity = () => this.refresh();
    this.runtimes.on((sig) => {
      if (sig.type === 'engine') for (const e of sig.events) if (e.type === 'audio.play') void this.playOnce(sig.serverId, e.building, e.sound);
      if (sig.type === 'changed' || sig.type === 'reloaded') this.refresh();
    });
    this.timer = setInterval(() => this.refresh(), 5000);
  }

  // -------------------------------------------------------------------------
  // VoiceBridge
  // -------------------------------------------------------------------------

  status() {
    return {
      ffmpeg: this.ffmpeg,
      unplaced: this.unplaced,
      workers: this.pool.snapshot().map((w) => {
        const l = this.live.get(w.key)!;
        const appId = l.config.applicationId ?? l.client.user?.id;
        return {
          ...w,
          configured: true,
          tag: l.client.user?.tag,
          inviteUrl: appId ? `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${(1n << 20n) | (1n << 21n) | (1n << 10n) | (1n << 26n)}` : null,
        };
      }),
    };
  }

  /** Recalcule les présences (regroupe les appels rapprochés). */
  refresh(): void {
    if (this.busy) {
      this.pending = true;
      return;
    }
    this.busy = true;
    void this.reconcile()
      .catch((e) => console.error('Voix :', e))
      .finally(() => {
        this.busy = false;
        if (this.pending) {
          this.pending = false;
          this.refresh();
        }
      });
  }

  private async reconcile() {
    const desired: Presence[] = [];
    for (const s of this.platform.allServers()) {
      if (!s.guildId) continue;
      const engine = this.runtimes.engine(s.id);
      if (!engine) continue;
      const channels = this.platform.setting<Record<string, BuildingChannels>>(s.id, 'discord.channels', {});
      desired.push(...desiredPresences({ serverId: s.id, guildId: s.guildId, engine, channels, occupancy: this.core.occupancy(s.guildId) }));
    }
    const plan = this.pool.reconcile(desired, Date.now());
    this.unplaced = plan.unplaced.map((u) => ({ serverId: u.presence.serverId, building: u.presence.building, reason: u.reason }));
    for (const r of plan.release) await this.leave(r.worker);
    for (const a of plan.assign) await this.join(a.worker, a.presence, true);
    for (const u of plan.update) await this.join(u.worker, u.presence, false);
  }

  private soundPath(serverId: string, key: string | undefined): string | undefined {
    if (!key) return undefined;
    const a = this.platform.audio(serverId, key);
    const path = a && join(this.audioDir, serverId, a.file);
    if (!path || !existsSync(path)) {
      console.warn(`🔇 Son « ${key} » introuvable dans la médiathèque de ${serverId} (le jeu continue sans).`);
      return undefined;
    }
    return path;
  }

  private async join(workerKey: string, p: Presence, fresh: boolean) {
    const l = this.live.get(workerKey)!;
    const guild = l.client.guilds.cache.get(p.guildId);
    if (!guild) return;
    try {
      // Identité : le pseudonyme du worker devient le nom du PNJ sur ce serveur.
      if (guild.members.me && guild.members.me.nickname !== p.identity.name) await guild.members.me.setNickname(p.identity.name.slice(0, 32)).catch(() => {});
      if (!l.connection || l.presence?.channelId !== p.channelId) {
        l.connection?.destroy();
        l.connection = joinVoiceChannel({ channelId: p.channelId, guildId: p.guildId, adapterCreator: guild.voiceAdapterCreator, group: workerKey, selfDeaf: true });
        await entersState(l.connection, VoiceConnectionStatus.Ready, 20_000);
        l.player ??= this.createPlayer(l);
        l.connection.subscribe(l.player);
      }
      l.presence = p;
      const path = this.soundPath(p.serverId, p.ambience);
      const changed = path !== l.ambience?.path;
      l.ambience = path ? { path, volume: p.volume } : undefined;
      if (fresh && p.welcome) {
        const welcome = this.soundPath(p.serverId, p.welcome);
        if (welcome) return this.play(l, welcome, p.volume);
      }
      if (fresh || changed) this.playAmbience(l);
    } catch (e) {
      console.warn(`${l.config.label} n’a pas pu rejoindre le vocal :`, (e as Error).message);
      this.pool.release(workerKey, (e as Error).message);
      l.connection?.destroy();
      l.connection = undefined;
    }
  }

  private createPlayer(l: Live): AudioPlayer {
    const player = createAudioPlayer();
    // À la fin d'un son (accueil, effet ou boucle d'ambiance), l'ambiance reprend.
    player.on(AudioPlayerStatus.Idle, () => this.playAmbience(l));
    player.on('error', (e) => console.warn(`${l.config.label} lecture :`, e.message));
    return player;
  }

  private play(l: Live, path: string, volume: number) {
    if (!l.player) return;
    const res = createAudioResource(path, { inlineVolume: true });
    res.volume?.setVolume(volume);
    l.player.play(res);
  }

  private playAmbience(l: Live) {
    if (l.ambience && l.connection) this.play(l, l.ambience.path, l.ambience.volume);
    else l.player?.stop(true);
  }

  /** Son ponctuel (action d'un joueur) : interrompt l'ambiance, qui reprend ensuite. */
  private async playOnce(serverId: string, building: string, sound: string) {
    const key = `${serverId}:${building}`;
    const w = [...this.pool.workers.values()].find((x) => x.presence?.key === key);
    if (!w) return;
    const l = this.live.get(w.key)!;
    const path = this.soundPath(serverId, sound);
    if (path) this.play(l, path, l.presence?.volume ?? 0.8);
  }

  private async leave(workerKey: string) {
    const l = this.live.get(workerKey);
    if (!l) return;
    l.player?.stop(true);
    l.connection?.destroy();
    l.connection = undefined;
    l.ambience = undefined;
    const guild = l.presence && l.client.guilds.cache.get(l.presence.guildId);
    if (guild?.members.me?.nickname) await guild.members.me.setNickname(null).catch(() => {});
    l.presence = undefined;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const l of this.live.values()) {
      l.connection?.destroy();
      void l.client.destroy();
    }
  }
}

function hasFfmpeg(): boolean {
  try {
    // ffmpeg-static (installé avec le projet) est détecté automatiquement par @discordjs/voice.
    const bundled = createRequire(import.meta.url)('ffmpeg-static') as string | null;
    if (bundled && existsSync(bundled)) return true;
  } catch {
    /* paquet absent */
  }
  try {
    if (spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version']).status === 0) return true;
  } catch {
    /* absent du PATH */
  }
  return false;
}
