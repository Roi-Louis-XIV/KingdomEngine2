/**
 * Bot principal KingdomEngine : un seul bot pour tous les serveurs Discord.
 * Chaque serveur Discord est relié à un monde. Aucune règle de jeu ici :
 * accès aux bâtiments par le salon vocal, panneau d'entrée, interfaces personnelles, rafraîchissement.
 * Aucune commande slash : tout se fait au clic (voir access.ts).
 */
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
  type Interaction,
  type Message,
  type MessageComponentInteraction,
  type OverwriteResolvable,
  type PermissionOverwriteOptions,
  type TextChannel,
  type VoiceState,
} from 'discord.js';
import type { Platform } from '../platform.ts';
import type { Runtimes } from '../runtime.ts';
import type { DiscordBridge, GuildChannel } from '../bridges.ts';
import type { BuildingChannels } from '../voice/planner.ts';
import { COMPONENTS_V2_FLAG, toDiscord } from './render.ts';
import { PLAYER_ACCESS, entrancePanel, panelCleanup, parseEnter, reconcileAccess, textChannelBase, voiceMove } from './access.ts';

const EPHEMERAL = 64;
/** Un jeton d'interaction Discord vit 15 minutes : au-delà, on ne peut plus modifier ni effacer l'interface. */
const TOKEN_MS = 14 * 60_000;

type Player = { id: string; name: string; avatarUrl: string };

/** Interface personnelle ouverte (message éphémère d'un joueur). */
interface Live {
  serverId: string;
  userId: string;
  buildingId: string;
  /** Dernière interaction reçue : son jeton permet de modifier ou d'effacer le message. */
  interaction: MessageComponentInteraction;
  tokenAt: number;
  json: string;
  revision: number;
  wakeAt: number | null;
  busy: boolean;
}

/** Convertit des masques de permissions en options discord.js. */
function permOptions(allow: bigint, deny: bigint): PermissionOverwriteOptions {
  const out: PermissionOverwriteOptions = {};
  for (const [name, bit] of Object.entries(PermissionFlagsBits)) {
    if (allow & bit) (out as Record<string, boolean>)[name] = true;
    else if (deny & bit) (out as Record<string, boolean>)[name] = false;
  }
  return out;
}

export class CoreBot implements DiscordBridge {
  readonly client: Client;
  private readonly platform: Platform;
  private readonly runtimes: Runtimes;
  private readonly token: string;
  private readonly live = new Map<string, Live>();
  /** Dernier panneau publié par salon texte (évite de toucher Discord quand rien n'a changé). */
  private readonly panels = new Map<string, string>();
  private readonly syncing = new Map<string, Promise<void>>();
  private lastError?: string;
  /** Prévenu quand l'occupation des salons vocaux change (pour les Voice Workers). */
  onVoiceActivity?: () => void;

  constructor(platform: Platform, runtimes: Runtimes, token: string) {
    this.platform = platform;
    this.runtimes = runtimes;
    this.token = token;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages] });
  }

  async start(): Promise<void> {
    const c = this.client;
    c.once(Events.ClientReady, async (ready) => {
      console.log(`✅ Bot principal connecté : ${ready.user.tag} (${ready.guilds.cache.size} serveur(s) Discord)`);
      for (const s of this.platform.allServers())
        if (s.guildId) await this.syncBuildings(s.id, true).catch((e) => console.warn(`Bâtiments de ${s.id} :`, e.message));
      setInterval(() => void this.refreshAll().catch((e) => console.error(e)), 1000);
    });
    c.on(Events.GuildCreate, (g) => {
      const s = this.platform.serverByGuild(g.id);
      console.log(`➕ Ajouté au serveur Discord ${g.name}${s ? ` (monde ${s.id})` : ' — aucun monde associé'}`);
      if (s) void this.syncBuildings(s.id, true).catch(() => {});
    });
    c.on(Events.InteractionCreate, (i) => void this.onInteraction(i).catch((e) => console.error('Interaction :', e)));
    c.on(Events.VoiceStateUpdate, (before, after) => {
      void this.onVoiceState(before, after).catch((e) => console.warn('Accès vocal :', e.message));
      this.onVoiceActivity?.();
    });
    c.on(Events.MessageCreate, (m) => void this.onMessage(m).catch(() => {}));
    c.on(Events.Error, (e) => (this.lastError = e.message));
    this.runtimes.on((sig) => {
      // Une publication met à jour les panneaux d'entrée.
      if (sig.type === 'reloaded') void this.syncBuildings(sig.serverId).catch(() => {});
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
      PermissionFlagsBits.ReadMessageHistory |
      PermissionFlagsBits.ManageMessages |
      PermissionFlagsBits.EmbedLinks |
      PermissionFlagsBits.ManageChannels |
      PermissionFlagsBits.ManageRoles |
      PermissionFlagsBits.Connect;
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', id);
    url.searchParams.set('scope', 'bot');
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
    const known = this.channelsOf(serverId);
    const category = await this.ensureCategory(g, serverId, engine.world.name);
    const out: Record<string, BuildingChannels> = {};
    for (const b of engine.world.buildings) {
      if (buildingIds?.length && !buildingIds.includes(b.id)) continue;
      const label = `${b.emoji ? b.emoji + '・' : ''}${b.name}`.slice(0, 90);
      // Le salon texte naît caché et en lecture seule : seul le salon vocal y donne accès.
      const text = await this.ensureChannel(g, known[b.id]?.text, label, ChannelType.GuildText, category, this.baseOverwrites(g));
      const voice = await this.ensureChannel(g, known[b.id]?.voice, label, ChannelType.GuildVoice, category);
      out[b.id] = { text, voice };
    }
    return out;
  }

  /**
   * Met les salons des bâtiments en conformité : salon texte caché et en lecture seule,
   * accès des joueurs présents dans le salon vocal, panneau d'entrée à jour, salon nettoyé.
   * Retire aussi d'éventuelles commandes slash laissées par une ancienne version.
   */
  syncBuildings(serverId: string, force = false): Promise<void> {
    // Une synchronisation à la fois par serveur : deux publications rapprochées ne dupliquent pas les panneaux.
    const prev = this.syncing.get(serverId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.doSyncBuildings(serverId, force));
    this.syncing.set(serverId, next);
    return next;
  }

  private async doSyncBuildings(serverId: string, force: boolean): Promise<void> {
    const s = this.platform.server(serverId);
    if (!s?.guildId || !this.client.isReady()) return;
    const g = this.client.guilds.cache.get(s.guildId);
    const engine = this.runtimes.engine(serverId);
    if (!g || !engine) return;
    if (force) {
      const cmds = await g.commands.fetch().catch(() => null);
      if (cmds?.size) await g.commands.set([]).catch(() => {});
    }
    const channels = this.channelsOf(serverId);
    const panelIds = this.platform.setting<Record<string, string>>(serverId, 'discord.panels', {});
    let changed = false;
    for (const b of engine.world.buildings) {
      const textId = channels[b.id]?.text;
      if (!textId) continue;
      const ch = await g.channels.fetch(textId).catch(() => null);
      if (!ch || ch.type !== ChannelType.GuildText) continue;
      const components = toDiscord(entrancePanel(b));
      const json = JSON.stringify(components);
      if (!force && this.panels.get(textId) === json) continue;
      await this.lockChannel(g, ch, channels[b.id]?.voice).catch((e) => console.warn(`Permissions de ${b.id} :`, e.message));
      const id = await this.placePanel(ch, b.id, components, panelIds[b.id]);
      if (id && panelIds[b.id] !== id) {
        panelIds[b.id] = id;
        changed = true;
      }
      this.panels.set(textId, json);
    }
    if (changed) this.platform.setSetting(serverId, 'discord.panels', panelIds);
  }

  private channelsOf(serverId: string) {
    return this.platform.setting<Record<string, BuildingChannels>>(serverId, 'discord.channels', {});
  }

  private baseOverwrites(g: Guild): OverwriteResolvable[] {
    return textChannelBase(g.roles.everyone.id, this.client.user!.id).map((o) => ({ id: o.id, type: o.type === 'role' ? 0 : 1, allow: o.allow, deny: o.deny }));
  }

  /** Permissions du salon texte : base + joueurs présents dans le salon vocal ; les autres rôles configurés sont conservés. */
  private async lockChannel(g: Guild, ch: TextChannel, voiceId: string | undefined) {
    const me = this.client.user!.id;
    const present = voiceId ? [...g.voiceStates.cache.values()].filter((v) => v.channelId === voiceId && !v.member?.user.bot).map((v) => v.id) : [];
    const current = [...ch.permissionOverwrites.cache.values()];
    const granted = current.filter((o) => o.type === 1 && o.id !== me).map((o) => o.id);
    const everyone = current.find((o) => o.id === g.roles.everyone.id);
    const { grant, revoke } = reconcileAccess({ granted, present, botId: me });
    const baseOk = !!everyone?.deny.has(PermissionFlagsBits.ViewChannel) && !!everyone?.deny.has(PermissionFlagsBits.SendMessages) && current.some((o) => o.id === me);
    if (baseOk && !grant.length && !revoke.length) return;
    const keep: OverwriteResolvable[] = current
      .filter((o) => o.type === 0 && o.id !== g.roles.everyone.id)
      .map((o) => ({ id: o.id, type: 0, allow: o.allow.bitfield, deny: o.deny.bitfield }));
    const players: OverwriteResolvable[] = present.map((id) => ({ id, type: 1, allow: PLAYER_ACCESS.allow, deny: PLAYER_ACCESS.deny }));
    await ch.permissionOverwrites.set([...this.baseOverwrites(g), ...keep, ...players], 'KingdomEngine : accès par le salon vocal');
  }

  /** Garde un seul message dans le salon : le panneau d'entrée. */
  private async placePanel(ch: TextChannel, buildingId: string, components: unknown[], knownId?: string): Promise<string | null> {
    const fetched = await ch.messages.fetch({ limit: 50 }).catch(() => null);
    const messages = fetched ? [...fetched.values()] : [];
    const plan = panelCleanup(
      messages.map((m) => ({ id: m.id, authorId: m.author.id, text: JSON.stringify(m.components.map((c) => c.toJSON())) })),
      { botId: this.client.user!.id, buildingId, knownPanelId: knownId },
    );
    let id = plan.keep;
    if (id) {
      const msg = fetched!.get(id)!;
      await msg.edit({ components: components as never, flags: COMPONENTS_V2_FLAG } as never).catch(() => (id = null));
    }
    if (!id) {
      const sent = await ch.send({ components: components as never, flags: COMPONENTS_V2_FLAG } as never);
      id = sent.id;
    }
    const remove = plan.remove.filter((x) => x !== id);
    if (remove.length) {
      await ch.bulkDelete(remove, true).catch(() => {});
      for (const x of remove) if (ch.messages.cache.has(x)) await ch.messages.delete(x).catch(() => {});
    }
    return id;
  }

  private async ensureCategory(g: Guild, serverId: string, name: string): Promise<string> {
    const id = this.platform.setting<string | null>(serverId, 'discord.category', null);
    if (id && g.channels.cache.has(id)) return id;
    const cat = await g.channels.create({ name: name.slice(0, 90), type: ChannelType.GuildCategory, reason: 'KingdomEngine : catégorie du monde' });
    this.platform.setSetting(serverId, 'discord.category', cat.id);
    return cat.id;
  }

  private async ensureChannel(
    g: Guild,
    existing: string | undefined,
    name: string,
    type: ChannelType.GuildText | ChannelType.GuildVoice,
    parent: string,
    permissionOverwrites?: OverwriteResolvable[],
  ): Promise<string> {
    if (existing && g.channels.cache.has(existing)) return existing;
    const ch = await g.channels.create({ name, type, parent, permissionOverwrites, reason: 'KingdomEngine : salon de bâtiment' });
    return ch.id;
  }

  private async announce(serverId: string, text: string) {
    const channelId = this.platform.setting<string | null>(serverId, 'discord.announceChannel', null);
    if (!channelId || !this.client.isReady()) return;
    const ch = await this.client.channels.fetch(channelId).catch(() => null);
    if (ch?.isTextBased() && 'send' in ch) await ch.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
  }

  // -------------------------------------------------------------------------
  // Accès par le salon vocal
  // -------------------------------------------------------------------------

  private async onVoiceState(before: VoiceState, after: VoiceState) {
    const member = after.member ?? before.member;
    if (!member || member.user.bot) return;
    const server = this.platform.serverByGuild(after.guild.id);
    if (!server) return;
    const channels = this.channelsOf(server.id);
    const { left, joined } = voiceMove(channels, before.channelId, after.channelId);
    if (left) {
      await this.closeInterfaces(server.id, member.id, left);
      await this.setAccess(after.guild, channels[left]?.text, member.id, false);
    }
    if (joined) await this.setAccess(after.guild, channels[joined]?.text, member.id, true);
  }

  private async setAccess(g: Guild, textId: string | undefined, memberId: string, open: boolean) {
    if (!textId) return;
    const ch = g.channels.cache.get(textId);
    if (!ch || ch.type !== ChannelType.GuildText) return;
    if (open) await ch.permissionOverwrites.create(memberId, permOptions(PLAYER_ACCESS.allow, PLAYER_ACCESS.deny), { reason: 'KingdomEngine : entrée dans le salon vocal', type: 1 });
    else if (ch.permissionOverwrites.cache.has(memberId)) await ch.permissionOverwrites.delete(memberId, 'KingdomEngine : sortie du salon vocal');
  }

  /** Efface les interfaces personnelles du joueur et ferme ses sessions : au retour, il retrouve l'entrée. */
  private async closeInterfaces(serverId: string, userId: string, buildingId: string) {
    for (const [sessionId, l] of this.live) {
      if (l.serverId !== serverId || l.userId !== userId || l.buildingId !== buildingId) continue;
      this.live.delete(sessionId);
      if (Date.now() - l.tokenAt < TOKEN_MS) await l.interaction.deleteReply().catch(() => {});
    }
    this.runtimes.leave(serverId, userId, buildingId);
  }

  private inVoice(g: Guild | null, userId: string, voiceId: string | undefined): boolean {
    return !!g && !!voiceId && g.voiceStates.cache.get(userId)?.channelId === voiceId;
  }

  /** Personne n'écrit dans le salon d'un bâtiment : les messages postés malgré tout sont retirés. */
  private async onMessage(m: Message) {
    if (!m.guildId || m.author.id === this.client.user?.id) return;
    const server = this.platform.serverByGuild(m.guildId);
    if (!server) return;
    const channels = this.channelsOf(server.id);
    if (Object.values(channels).some((c) => c.text === m.channelId)) await m.delete();
  }

  // -------------------------------------------------------------------------
  // Jeu
  // -------------------------------------------------------------------------

  private async onInteraction(i: Interaction) {
    if (!i.isMessageComponent()) return;
    if (!i.guildId) return;
    const server = this.platform.serverByGuild(i.guildId);
    if (!server) {
      await i.reply({ content: 'Ce serveur Discord n’est relié à aucun monde KingdomEngine.', flags: EPHEMERAL });
      return;
    }
    const player: Player = {
      id: i.user.id,
      name: (i.member && 'displayName' in i.member ? i.member.displayName : null) ?? i.user.displayName ?? i.user.username,
      avatarUrl: i.user.displayAvatarURL({ size: 128 }),
    };
    try {
      const enter = parseEnter(i.customId);
      if (enter && i.isButton()) await this.enter(i, server.id, enter, player);
      else if (i.customId.includes('|')) await this.onComponent(i, server.id, player);
    } catch (e) {
      console.error('Interaction en échec :', e);
      if (!i.replied && !i.deferred) await i.reply({ content: `⚠️ ${(e as Error).message}`, flags: EPHEMERAL }).catch(() => {});
    }
  }

  /** Clic sur « Entrer » : ouvre l'interface personnelle du bâtiment (visible du seul joueur). */
  private async enter(i: ButtonInteraction, serverId: string, buildingId: string, player: Player) {
    const engine = this.runtimes.require(serverId);
    const b = engine.world.buildings.find((x) => x.id === buildingId);
    if (!b) {
      await i.reply({ content: 'Ce bâtiment n’existe plus.', flags: EPHEMERAL });
      return;
    }
    const voice = this.channelsOf(serverId)[b.id]?.voice;
    if (!this.inVoice(i.guild, i.user.id, voice)) {
      await i.reply({ content: '❌ Rejoins d’abord le salon vocal de ce bâtiment.', flags: EPHEMERAL });
      return;
    }
    // Une seule interface par joueur et par bâtiment : les anciennes disparaissent.
    await this.closeInterfaces(serverId, player.id, b.id);
    const { sessionId, view } = this.runtimes.open(serverId, player, b.id);
    const components = toDiscord(view.message);
    await i.reply({ components: components as never, flags: EPHEMERAL | COMPONENTS_V2_FLAG });
    this.live.set(sessionId, {
      serverId,
      userId: player.id,
      buildingId: b.id,
      interaction: i,
      tokenAt: Date.now(),
      json: JSON.stringify(components),
      revision: engine.revision,
      wakeAt: view.wakeAt,
      busy: false,
    });
  }

  /** Clic dans l'interface : le message se modifie sur place. */
  private async onComponent(i: MessageComponentInteraction, serverId: string, player: Player) {
    const engine = this.runtimes.require(serverId);
    const sessionId = i.customId.split('|')[0]!;
    const session = engine.session(sessionId);
    if (!session) {
      await i.update({ components: [{ type: 10, content: '-# Cette interface est fermée. Utilise le bouton d’entrée du bâtiment.' }] as never }).catch(() => {});
      return;
    }
    if (!this.inVoice(i.guild, player.id, this.channelsOf(serverId)[session.building]?.voice)) {
      await this.closeInterfaces(serverId, player.id, session.building);
      await i.reply({ content: '❌ Tu n’es plus dans le salon vocal de ce bâtiment.', flags: EPHEMERAL });
      return;
    }
    const values = i.isStringSelectMenu() ? i.values : [];
    const result = this.runtimes.interact(serverId, player, i.customId, values);
    if (!result.message) {
      await i.reply({ content: result.private ?? 'Action impossible.', flags: EPHEMERAL });
      return;
    }
    const components = toDiscord(result.message);
    const prev = this.live.get(sessionId);
    if (prev) prev.busy = true;
    try {
      await i.update({ components: components as never });
    } finally {
      this.live.set(sessionId, {
        serverId,
        userId: player.id,
        buildingId: session.building,
        interaction: i,
        tokenAt: Date.now(),
        json: JSON.stringify(components),
        revision: engine.revision,
        wakeAt: engine.view(sessionId).wakeAt,
        busy: false,
      });
    }
  }

  /** Met à jour les interfaces ouvertes : minuteurs, actions des autres joueurs, interventions du Studio. */
  private async refreshAll() {
    const now = Date.now();
    for (const [sessionId, l] of this.live) {
      if (l.busy) continue;
      // Jeton expiré : l'interface reste figée jusqu'au prochain clic du joueur.
      if (now - l.tokenAt > TOKEN_MS) {
        this.live.delete(sessionId);
        continue;
      }
      const engine = this.runtimes.engine(l.serverId);
      if (!engine || !engine.session(sessionId)) {
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
        await l.interaction.editReply({ components: components as never });
        l.json = json;
      } catch (e) {
        const code = (e as { code?: number }).code;
        if (code === 10008 || code === 10015 || code === 50027 || code === 50001 || code === 50013) this.live.delete(sessionId);
      } finally {
        l.busy = false;
      }
    }
  }

  stop() {
    void this.client.destroy();
  }
}
