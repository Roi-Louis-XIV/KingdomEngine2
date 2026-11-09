/** Contrats entre l'API et les connexions Discord (bot principal et Voice Workers). */
import type { BuildingChannels } from './voice/planner.ts';

export interface GuildChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'category';
  parentId?: string | null;
}

export interface DiscordBridge {
  /** État du bot principal. */
  status(): { configured: boolean; online: boolean; tag?: string; applicationId?: string; error?: string };
  inviteUrl(guildId?: string | null): string | null;
  guild(guildId: string): Promise<{ inGuild: boolean; name?: string; members?: number; channels: GuildChannel[] }>;
  /** Crée (ou retrouve) la catégorie et les salons texte/vocal de chaque bâtiment. */
  provision(serverId: string, buildingIds?: string[]): Promise<Record<string, BuildingChannels>>;
  /** Réenregistre les commandes du serveur (après publication). */
  syncCommands(serverId: string): Promise<void>;
}

export interface VoiceBridge {
  status(): {
    workers: { key: string; label: string; online: boolean; configured: boolean; tag?: string; inviteUrl: string | null; guilds: string[]; presence: unknown; error: string | null }[];
    ffmpeg: boolean;
    unplaced: { serverId: string; building: string; reason: string }[];
  };
  /** Recalcule immédiatement les présences (après un changement de salons ou de contenu). */
  refresh(): void;
}

/** Implémentations neutres utilisées quand Discord n'est pas configuré (et dans les tests). */
export const offlineDiscord: DiscordBridge = {
  status: () => ({ configured: false, online: false }),
  inviteUrl: () => null,
  guild: async () => ({ inGuild: false, channels: [] }),
  provision: async () => {
    throw new Error('Bot principal non connecté : renseigne KINGDOM_CORE_TOKEN puis redémarre.');
  },
  syncCommands: async () => {},
};

export const offlineVoice: VoiceBridge = {
  status: () => ({ workers: [], ffmpeg: false, unplaced: [] }),
  refresh: () => {},
};
