/**
 * Voice Workers : bots Discord techniques qui rejoignent le salon vocal d'un bâtiment occupé,
 * prennent le nom d'un personnage (ou du bâtiment) et y disent ses répliques ; l'un d'eux joue l'ambiance.
 * Chaque worker mixe l'ambiance et les répliques (mixer.ts) : on parle par-dessus le fond sonore.
 * L'allocation est décidée par VoicePool (testé) ; ce fichier applique ses décisions sur Discord.
 */
import { Client, Events, GatewayIntentBits } from 'discord.js';
import {
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { Mixer } from './mixer.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Platform } from '../platform.ts';
import type { Runtimes } from '../runtime.ts';
import type { VoiceBridge } from '../bridges.ts';
import type { CoreBot } from '../discord/core.ts';
import { VoicePool, type Presence } from './pool.ts';
import { departedKeys, desiredPresences, type BuildingChannels } from './planner.ts';

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
  /** Ambiance + répliques mixées, envoyées en continu au salon vocal. */
  mixer?: Mixer;
  presence?: Presence;
  /** Message répété par-dessus l'ambiance (ex. « rejoignez le salon d'aide »). */
  message?: { key: string; timer: NodeJS.Timeout };
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

  /** Prévenu quand un Voice Worker se connecte (pour mettre à jour les permissions des salons). */
  onBotsChanged?: () => void;

  /** Comptes Discord des Voice Workers (connus par la configuration ou à la connexion). */
  botIds(): string[] {
    return [...this.live.values()].map((l) => l.client.user?.id ?? l.config.applicationId ?? '').filter(Boolean);
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
        // Un nouveau Voice Worker doit être autorisé dans les salons réservés aux habitants.
        this.onBotsChanged?.();
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
      if (sig.type === 'engine') for (const e of sig.events) if (e.type === 'audio.play') this.playOnce(sig.serverId, e.building, e.sound, e.character);
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
    const departed = new Set<string>();
    for (const s of this.platform.allServers()) {
      if (!s.guildId) continue;
      const engine = this.runtimes.engine(s.id);
      if (!engine) continue;
      const channels = this.platform.setting<Record<string, BuildingChannels>>(s.id, 'discord.channels', {});
      desired.push(...desiredPresences({ serverId: s.id, guildId: s.guildId, engine, channels, occupancy: this.core.occupancy(s.guildId) }));
      for (const k of departedKeys(engine, s.id)) departed.add(k);
    }
    const plan = this.pool.reconcile(desired, Date.now(), departed);
    this.unplaced = plan.unplaced.map((u) => ({ serverId: u.presence.serverId, building: u.presence.building, reason: u.reason }));
    // En parallèle : un personnage qui finit sa phrase ne retarde pas les autres départs.
    await Promise.all(plan.release.map((r) => this.leave(r.worker)));
    for (const a of plan.assign) await this.join(a.worker, a.presence, true);
    for (const u of plan.update) await this.join(u.worker, u.presence, false);
  }

  private soundPath(serverId: string, key: string | undefined, quiet = false): string | undefined {
    if (!key) return undefined;
    const a = this.platform.audio(serverId, key);
    const path = a && join(this.audioDir, serverId, a.file);
    if (!path || !existsSync(path)) {
      if (quiet) return undefined;
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
      const ambience = this.soundPath(p.serverId, p.ambience);
      if (ambience) this.mixer(l).setAmbience(ambience, p.volume);
      else if (l.mixer) {
        l.mixer.setAmbience(undefined, p.volume);
        l.mixer.endWhenIdle = true;
      }
      if (fresh && p.welcome) {
        const welcome = this.soundPath(p.serverId, p.welcome);
        if (welcome) this.mixer(l).say(welcome, p.volume);
      }
      this.repeatMessage(l, p);
    } catch (e) {
      console.warn(`${l.config.label} n’a pas pu rejoindre le vocal :`, (e as Error).message);
      this.pool.release(workerKey, (e as Error).message);
      l.connection?.destroy();
      l.connection = undefined;
    }
  }

  /**
   * Mixeur du worker, créé à la demande. Avec une ambiance, il tourne en continu ; sans, il s'arrête
   * après la dernière réplique (le personnage ne paraît parler que lorsqu'il parle).
   */
  private mixer(l: Live): Mixer {
    if (!l.mixer) {
      const m = new Mixer(ffmpegPath());
      l.mixer = m;
      m.once('end', () => {
        if (l.mixer === m) l.mixer = undefined;
      });
      l.player ??= this.createPlayer(l);
      l.player.play(createAudioResource(m, { inputType: StreamType.Raw }));
    }
    l.mixer.endWhenIdle = !this.soundPath(l.presence?.serverId ?? '', l.presence?.ambience, true);
    return l.mixer;
  }

  /** Message répété : dit tout de suite, puis toutes les `every` secondes (sans se superposer à lui-même). */
  private repeatMessage(l: Live, p: Presence) {
    const key = p.message ? `${p.message.sound}|${p.message.every}` : '';
    if ((l.message?.key ?? '') === key) return;
    if (l.message) clearInterval(l.message.timer);
    l.message = undefined;
    if (!p.message) return;
    const say = () => {
      const path = this.soundPath(p.serverId, p.message!.sound);
      if (path && l.connection && !l.mixer?.speaking) this.mixer(l).say(path, p.volume);
    };
    say();
    const timer = setInterval(say, Math.max(5, p.message.every) * 1000);
    timer.unref();
    l.message = { key, timer };
  }

  private createPlayer(l: Live): AudioPlayer {
    const player = createAudioPlayer();
    player.on('error', (e) => console.warn(`${l.config.label} lecture :`, e.message));
    return player;
  }

  /**
   * Son déclenché par le jeu. Réplique d'un personnage : dite par son worker, là où il se trouve
   * (personne ne l'entend s'il est dans un salon vide). Sinon : jouée par le worker qui tient l'ambiance du bâtiment.
   */
  private playOnce(serverId: string, building: string, sound: string, character?: string) {
    const presences = [...this.pool.workers.values()].filter((w) => w.presence?.serverId === serverId);
    const w = character
      ? presences.find((x) => x.presence!.character === character)
      : (presences.find((x) => x.presence!.building === building && x.presence!.holder) ?? presences.find((x) => x.presence!.building === building));
    if (!w) return;
    const l = this.live.get(w.key)!;
    const path = this.soundPath(serverId, sound);
    if (path && l.connection) this.mixer(l).say(path, l.presence?.volume ?? 0.8);
  }

  private async leave(workerKey: string) {
    const l = this.live.get(workerKey);
    if (!l) return;
    if (l.message) clearInterval(l.message.timer);
    l.message = undefined;
    // Un personnage qui s'en va finit sa phrase (15 s au plus).
    for (let i = 0; i < 75 && l.mixer?.speaking && l.connection; i++) await new Promise((r) => setTimeout(r, 200));
    l.player?.stop(true);
    l.connection?.destroy();
    l.connection = undefined;
    l.mixer?.destroy();
    l.mixer = undefined;
    const guild = l.presence && l.client.guilds.cache.get(l.presence.guildId);
    if (guild?.members.me?.nickname) await guild.members.me.setNickname(null).catch(() => {});
    l.presence = undefined;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const l of this.live.values()) {
      l.mixer?.destroy();
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

/** Programme ffmpeg utilisé par le mixeur : FFMPEG_PATH, sinon ffmpeg-static, sinon celui du système. */
function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bundled = createRequire(import.meta.url)('ffmpeg-static') as string | null;
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    /* paquet absent */
  }
  return 'ffmpeg';
}
