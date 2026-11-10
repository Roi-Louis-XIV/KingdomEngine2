/**
 * Bot principal KingdomEngine : un seul bot pour tous les serveurs Discord.
 * Chaque serveur Discord est relié à un monde ; les commandes sont générées depuis son contenu publié.
 * Aucune règle de jeu ici : ouverture d'interfaces, transmission des clics, rafraîchissement.
 */
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type MessageComponentInteraction,
} from 'discord.js';
import type { Platform } from '../platform.ts';
import type { Runtimes } from '../runtime.ts';
import type { DiscordBridge, GuildChannel } from '../bridges.ts';
import type { BuildingChannels } from '../voice/planner.ts';
import { COMPONENTS_V2_FLAG, toDiscord } from './render.ts';

const EPHEMERAL = 64;
const IDLE_MS = 30 * 60_000;

interface Live {
  serverId: string;
  message: Message;
  json: string;
  revision: number;
  wakeAt: number | null;
  touchedAt: number;
  busy: boolean;
}

export const commandName = (buildingId: string) =>
  buildingId
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 32);

export class CoreBot implements DiscordBridge {
  readonly client: Client;
  private readonly platform: Platform;
  private readonly runtimes: Runtimes;
  private readonly token: string;
  private readonly live = new Map<string, Live>();
  private lastError?: string;
  /** Prévenu quand l'occupation des salons vocaux change (pour les Voice Workers). */
  onVoiceActivity?: () => void;

  constructor(platform: Platform, runtimes: Runtimes, token: string) {
    this.platform = platform;
    this.runtimes = runtimes;
    this.token = token;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  }

  async start(): Promise<void> {
    const c = this.client;
    c.once(Events.ClientReady, async (ready) => {
      console.log(`✅ Bot principal connecté : ${ready.user.tag} (${ready.guilds.cache.size} serveur(s) Discord)`);
      for (const s of this.platform.allServers()) if (s.guildId) await this.syncCommands(s.id).catch((e) => console.warn(`Commandes de ${s.id} :`, e.message));
      setInterval(() => void this.refreshAll().catch((e) => console.error(e)), 1000);
    });
    c.on(Events.GuildCreate, (g) => {
      const s = this.platform.serverByGuild(g.id);
      console.log(`➕ Ajouté au serveur Discord ${g.name}${s ? ` (monde ${s.id})` : ' — aucun monde associé'}`);
      if (s) void this.syncCommands(s.id).catch(() => {});
    });
    c.on(Events.InteractionCreate, (i) => void this.onInteraction(i).catch((e) => console.error('Interaction :', e)));
    c.on(Events.VoiceStateUpdate, () => this.onVoiceActivity?.());
    c.on(Events.Error, (e) => (this.lastError = e.message));
    this.runtimes.on((sig) => {
      // Une publication ou une intervention du Studio rafraîchit les interfaces ouvertes.
      if (sig.type === 'reloaded') void this.syncCommands(sig.serverId).catch(() => {});
      // Annonces des événements et de la météo dans le salon choisi.
      if (sig.type === 'engine')
        for (const e of sig.events) if (e.type === 'announce') void this.announce(sig.serverId, e.text).catch((err) => console.warn('Annonce :', err.message));
    });
    await c.login(this.token);
  }

  // -------------------------------------------------------------------------
  // DiscordBridge (utilisé par l'API du Studio)
  // -------------------------------------------------------------------------

  status() {
    return {
      configured: true,
      online: this.client.isReady(),
      tag: this.client.user?.tag,
      applicationId: this.client.application?.id ?? this.client.user?.id,
      error: this.lastError,
    };
  }

  inviteUrl(guildId?: string | null): string | null {
    const id = this.client.application?.id ?? this.client.user?.id;
    if (!id) return null;
    const perms =
      PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.EmbedLinks |
      PermissionFlagsBits.ManageChannels |
      PermissionFlagsBits.ManageRoles |
      PermissionFlagsBits.Connect;
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', id);
    url.searchParams.set('scope', 'bot applications.commands');
    url.searchParams.set('permissions', perms.toString());
    if (guildId) {
      url.searchParams.set('guild_id', guildId);
      url.searchParams.set('disable_guild_select', 'true');
    }
    return url.toString();
  }

  async guild(guildId: string) {
    const g = this.client.guilds.cache.get(guildId);
    if (!g) return { inGuild: false, channels: [] as GuildChannel[] };
    const channels = await g.channels.fetch();
    const list: GuildChannel[] = [];
    for (const ch of channels.values()) {
      if (!ch) continue;
      const type = ch.type === ChannelType.GuildText ? 'text' : ch.type === ChannelType.GuildVoice ? 'voice' : ch.type === ChannelType.GuildCategory ? 'category' : null;
      if (type) list.push({ id: ch.id, name: ch.name, type, parentId: ch.parentId });
    }
    return { inGuild: true, name: g.name, members: g.memberCount, channels: list.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  /** Occupation (joueurs humains) des salons vocaux d'un serveur Discord. */
  occupancy(guildId: string): Map<string, number> {
    const out = new Map<string, number>();
    const g = this.client.guilds.cache.get(guildId);
    if (!g) return out;
    for (const vs of g.voiceStates.cache.values()) {
      if (!vs.channelId || vs.member?.user.bot) continue;
      out.set(vs.channelId, (out.get(vs.channelId) ?? 0) + 1);
    }
    return out;
  }

  async provision(serverId: string, buildingIds?: string[]): Promise<Record<string, BuildingChannels>> {
    const s = this.platform.server(serverId);
    if (!s?.guildId) throw new Error('Aucun serveur Discord associé.');
    const g = this.client.guilds.cache.get(s.guildId);
    if (!g) throw new Error('Le bot principal n’est pas encore sur ce serveur Discord : utilise le lien d’invitation.');
    const engine = this.runtimes.require(serverId);
    const known = this.platform.setting<Record<string, BuildingChannels>>(serverId, 'discord.channels', {});
    const category = await this.ensureCategory(g, serverId, engine.world.name);
    const out: Record<string, BuildingChannels> = {};
    for (const b of engine.world.buildings) {
      if (buildingIds?.length && !buildingIds.includes(b.id)) continue;
      const label = `${b.emoji ? b.emoji + '・' : ''}${b.name}`.slice(0, 90);
      const text = await this.ensureChannel(g, known[b.id]?.text, label, ChannelType.GuildText, category);
      const voice = await this.ensureChannel(g, known[b.id]?.voice, label, ChannelType.GuildVoice, category);
      out[b.id] = { text, voice };
      // Message d'accueil du salon texte : la commande à utiliser.
      const ch = g.channels.cache.get(text);
      if (ch?.isTextBased() && !known[b.id]?.text)
        await ch.send(`**${b.name}** — tape \`/${commandName(b.id)}\` pour entrer.`).catch(() => {});
    }
    return out;
  }

  private async ensureCategory(g: Guild, serverId: string, name: string): Promise<string> {
    const id = this.platform.setting<string | null>(serverId, 'discord.category', null);
    if (id && g.channels.cache.has(id)) return id;
    const cat = await g.channels.create({ name: name.slice(0, 90), type: ChannelType.GuildCategory, reason: 'KingdomEngine : catégorie du monde' });
    this.platform.setSetting(serverId, 'discord.category', cat.id);
    return cat.id;
  }

  private async ensureChannel(g: Guild, existing: string | undefined, name: string, type: ChannelType.GuildText | ChannelType.GuildVoice, parent: string): Promise<string> {
    if (existing && g.channels.cache.has(existing)) return existing;
    const ch = await g.channels.create({ name, type, parent, reason: 'KingdomEngine : salon de bâtiment' });
    return ch.id;
  }

  private async announce(serverId: string, text: string) {
    const channelId = this.platform.setting<string | null>(serverId, 'discord.announceChannel', null);
    if (!channelId || !this.client.isReady()) return;
    const ch = await this.client.channels.fetch(channelId).catch(() => null);
    if (ch?.isTextBased() && 'send' in ch) await ch.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
  }

  async syncCommands(serverId: string): Promise<void> {
    const s = this.platform.server(serverId);
    if (!s?.guildId || !this.client.isReady()) return;
    const g = this.client.guilds.cache.get(s.guildId);
    if (!g) return;
    const engine = this.runtimes.engine(serverId);
    const defs = (engine?.world.buildings ?? []).map((b) =>
      new SlashCommandBuilder()
        .setName(commandName(b.id))
        .setDescription(`Entrer : ${b.name}`.slice(0, 100))
        .toJSON(),
    );
    await g.commands.set(defs);
  }

  // -------------------------------------------------------------------------
  // Jeu
  // -------------------------------------------------------------------------

  private async onInteraction(i: import('discord.js').Interaction) {
    if (!i.guildId) {
      if (i.isRepliable()) await i.reply({ content: 'Commandes réservées à un serveur Discord.', flags: EPHEMERAL });
      return;
    }
    const server = this.platform.serverByGuild(i.guildId);
    if (!server) {
      if (i.isRepliable()) await i.reply({ content: 'Ce serveur Discord n’est relié à aucun monde KingdomEngine.', flags: EPHEMERAL });
      return;
    }
    const player = { id: i.user.id, name: (i.member && 'displayName' in i.member ? i.member.displayName : null) ?? i.user.displayName ?? i.user.username, avatarUrl: i.user.displayAvatarURL({ size: 128 }) };
    try {
      if (i.isChatInputCommand()) await this.openBuilding(i, server.id, player);
      else if (i.isMessageComponent() && i.customId.includes('|')) await this.onComponent(i, server.id, player);
    } catch (e) {
      console.error('Interaction en échec :', e);
      if (i.isRepliable() && !i.replied && !i.deferred) await i.reply({ content: `⚠️ ${(e as Error).message}`, flags: EPHEMERAL }).catch(() => {});
    }
  }

  private async openBuilding(i: ChatInputCommandInteraction, serverId: string, player: { id: string; name: string; avatarUrl: string }) {
    const engine = this.runtimes.require(serverId);
    const b = engine.world.buildings.find((x) => commandName(x.id) === i.commandName);
    if (!b) {
      await i.reply({ content: 'Ce bâtiment n’existe plus.', flags: EPHEMERAL });
      return;
    }
    const { sessionId, view } = this.runtimes.open(serverId, player, b.id);
    const components = toDiscord(view.message);
    const response = await i.reply({ components: components as never, flags: COMPONENTS_V2_FLAG, withResponse: true });
    const message = response.resource?.message ?? (await i.fetchReply());
    this.live.set(sessionId, { serverId, message, json: JSON.stringify(components), revision: engine.revision, wakeAt: view.wakeAt, touchedAt: Date.now(), busy: false });
  }

  private async onComponent(i: MessageComponentInteraction, serverId: string, player: { id: string; name: string; avatarUrl: string }) {
    const values = i.isStringSelectMenu() ? i.values : [];
    const result = this.runtimes.interact(serverId, player, i.customId, values);
    if (!result.message) {
      await i.reply({ content: result.private ?? 'Action impossible.', flags: EPHEMERAL });
      return;
    }
    const sessionId = i.customId.split('|')[0]!;
    const components = toDiscord(result.message);
    const prev = this.live.get(sessionId);
    if (prev) prev.busy = true;
    try {
      await i.update({ components: components as never });
    } finally {
      const engine = this.runtimes.require(serverId);
      this.live.set(sessionId, {
        serverId,
        message: i.message,
        json: JSON.stringify(components),
        revision: engine.revision,
        wakeAt: engine.view(sessionId).wakeAt,
        touchedAt: Date.now(),
        busy: false,
      });
    }
  }

  /** Met à jour les interfaces ouvertes : minuteurs, actions des autres joueurs, interventions du Studio. */
  private async refreshAll() {
    const now = Date.now();
    for (const [sessionId, l] of this.live) {
      if (l.busy) continue;
      if (now - l.touchedAt > IDLE_MS) {
        this.live.delete(sessionId);
        continue;
      }
      const engine = this.runtimes.engine(l.serverId);
      if (!engine) {
        this.live.delete(sessionId);
        continue;
      }
      const due = engine.revision !== l.revision || (l.wakeAt !== null && now >= l.wakeAt);
      if (!due) continue;
      const view = this.runtimes.view(l.serverId, sessionId);
      if (!view) continue;
      l.revision = engine.revision;
      l.wakeAt = view.wakeAt;
      const components = toDiscord(view.message);
      const json = JSON.stringify(components);
      if (json === l.json) continue;
      l.busy = true;
      try {
        await l.message.edit({ components: components as never });
        l.json = json;
      } catch (e) {
        const code = (e as { code?: number }).code;
        if (code === 10008 || code === 50001 || code === 50013) this.live.delete(sessionId);
      } finally {
        l.busy = false;
      }
    }
  }

  stop() {
    void this.client.destroy();
  }
}
