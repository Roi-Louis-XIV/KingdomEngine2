/**
 * Règles d'accès aux bâtiments sur Discord (logique pure, testée sans Discord).
 *
 * Mécanique (héritée de KingdomEngine2) :
 * - on n'entre dans un bâtiment que par son salon vocal ;
 * - rejoindre le salon vocal donne accès en lecture à son salon texte, qui ne contient
 *   qu'un message : l'entrée du bâtiment (panneau commun avec un bouton « Entrer ») ;
 * - personne n'écrit dans ce salon, tout se fait au clic, aucune commande slash ;
 * - le clic ouvre une interface personnelle (visible du seul joueur) qui se modifie à chaque clic ;
 * - en quittant le salon vocal, l'accès et les interfaces disparaissent ; au retour, seule l'entrée est visible.
 */
import type { BuildingChannels } from '../voice/planner.ts';

/** Bits de permission Discord utilisés ici (valeurs fixes de l'API ; pas de dépendance à discord.js). */
export const PermissionFlagsBits = {
  AddReactions: 1n << 6n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  UseApplicationCommands: 1n << 31n,
  CreatePublicThreads: 1n << 35n,
  CreatePrivateThreads: 1n << 36n,
  SendMessagesInThreads: 1n << 38n,
} as const;

import { panelMarker } from '../../../../packages/engine/src/index.ts';
export { enterCustomId, parseEnter, panelMarker, entrancePanel, DEFAULT_ENTRANCE_TEXT } from '../../../../packages/engine/src/index.ts';

// ---------------------------------------------------------------------------
// Salons
// ---------------------------------------------------------------------------

/** Bâtiment dont c'est le salon vocal. */
export function buildingOfVoice(channels: Record<string, BuildingChannels>, voiceChannelId: string | null | undefined): string | null {
  if (!voiceChannelId) return null;
  for (const [id, c] of Object.entries(channels)) if (c.voice === voiceChannelId) return id;
  return null;
}

/** Ce que les joueurs ne peuvent jamais faire dans le salon texte d'un bâtiment. */
const NO_WRITING =
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.CreatePrivateThreads |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.UseApplicationCommands;

/** Ce dont le bot a besoin dans le salon texte. */
export const BOT_TEXT_ALLOW =
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.EmbedLinks;

export interface Overwrite {
  id: string;
  type: 'role' | 'member';
  allow: bigint;
  deny: bigint;
}

/** Permissions de base du salon texte : caché à tous, lecture seule, ouvert au bot. */
export function textChannelBase(everyoneRoleId: string, botId: string): Overwrite[] {
  return [
    { id: everyoneRoleId, type: 'role', allow: 0n, deny: PermissionFlagsBits.ViewChannel | NO_WRITING },
    { id: botId, type: 'member', allow: BOT_TEXT_ALLOW, deny: 0n },
  ];
}

/** Droit accordé à un joueur présent dans le salon vocal : voir et lire, sans écrire. */
export const PLAYER_ACCESS = {
  allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory,
  deny: NO_WRITING,
};

/**
 * Réconciliation (au démarrage ou après une coupure) : qui doit recevoir ou perdre l'accès
 * au salon texte, d'après les joueurs réellement présents dans le salon vocal.
 */
export function reconcileAccess(input: { granted: string[]; present: string[]; botId: string }): { grant: string[]; revoke: string[] } {
  const granted = new Set(input.granted.filter((id) => id !== input.botId));
  const present = new Set(input.present.filter((id) => id !== input.botId));
  return {
    grant: [...present].filter((id) => !granted.has(id)),
    revoke: [...granted].filter((id) => !present.has(id)),
  };
}

/** Déplacement vocal d'un membre : bâtiment quitté et bâtiment rejoint. */
export function voiceMove(channels: Record<string, BuildingChannels>, from: string | null | undefined, to: string | null | undefined): { left: string | null; joined: string | null } {
  if (from === to) return { left: null, joined: null };
  return { left: buildingOfVoice(channels, from), joined: buildingOfVoice(channels, to) };
}

/**
 * Nettoyage du salon : parmi les messages présents, lequel garder comme panneau
 * (le connu s'il existe encore, sinon le plus récent du bot portant le repère) et lesquels supprimer.
 */
export function panelCleanup(
  messages: { id: string; authorId: string; text: string }[],
  input: { botId: string; buildingId: string; knownPanelId?: string | null },
): { keep: string | null; remove: string[] } {
  const marker = panelMarker(input.buildingId);
  const ours = messages.filter((m) => m.authorId === input.botId && m.text.includes(marker));
  const keep = (input.knownPanelId && ours.find((m) => m.id === input.knownPanelId)?.id) || ours[0]?.id || null;
  return { keep, remove: messages.filter((m) => m.id !== keep).map((m) => m.id) };
}
