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
  Connect: 1n << 20n,
  Speak: 1n << 21n,
} as const;

import { panelMarker } from '../../../../packages/engine/src/index.ts';
import type { Onboarding, RenderedMessage, Text } from '../../../../packages/engine/src/index.ts';
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
  input: { botId: string; buildingId: string; knownPanelId?: string | null; marker?: string },
): { keep: string | null; remove: string[] } {
  const marker = input.marker ?? panelMarker(input.buildingId);
  const ours = messages.filter((m) => m.authorId === input.botId && m.text.includes(marker));
  const keep = (input.knownPanelId && ours.find((m) => m.id === input.knownPanelId)?.id) || ours[0]?.id || null;
  return { keep, remove: messages.filter((m) => m.id !== keep).map((m) => m.id) };
}

// ---------------------------------------------------------------------------
// Serment d'arrivée et catégories
// ---------------------------------------------------------------------------

export const OATH_ID = 'ke:oath';
export const OATH_MARKER = '-# KingdomEngine · serment';
export const isOath = (customId: string) => customId === OATH_ID;

/** Texte par défaut d'un texte variable (le panneau est commun à tous : pas de joueur). */
export function plainText(t: Text | undefined): string {
  if (!t) return '';
  if (typeof t === 'string') return t;
  return t.cases.find((c) => !c.when)?.text ?? t.cases[0]?.text ?? '';
}

/** Le serment est-il demandé dans ce monde ? */
export const oathRequired = (ob: Onboarding | undefined): ob is Onboarding => !!ob?.enabled;

/** Panneau du serment, dans le salon d'arrivée. */
export function oathPanel(ob: Onboarding, accent = 0x0a6b45): RenderedMessage {
  return {
    components: [
      {
        type: 'container',
        accent,
        children: [
          { type: 'text', content: `## ${ob.title}\n${plainText(ob.text)}`.slice(0, 3900) },
          { type: 'separator' },
          { type: 'row', items: [{ type: 'button', label: ob.button.slice(0, 80) || 'Je le jure', emoji: ob.buttonEmoji || '✋', style: 'success', customId: OATH_ID }] },
          { type: 'text', content: OATH_MARKER },
        ],
      },
    ],
  };
}

/**
 * Permissions du salon vocal et de la catégorie d'un bâtiment : sans serment, ouverts à tous ;
 * avec serment, réservés au rôle des habitants (et au bot).
 */
export function voiceOverwrites(everyoneRoleId: string, playerRoleId: string | null, botId: string): Overwrite[] {
  if (!playerRoleId) return [];
  const voice = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;
  return [
    { id: everyoneRoleId, type: 'role', allow: 0n, deny: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect },
    { id: playerRoleId, type: 'role', allow: voice, deny: 0n },
    { id: botId, type: 'member', allow: voice | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ReadMessageHistory, deny: 0n },
  ];
}

/** Salon d'arrivée : visible et lisible par tous, personne n'y écrit (sauf le bot). */
export function oathChannelOverwrites(everyoneRoleId: string, botId: string): Overwrite[] {
  return [
    { id: everyoneRoleId, type: 'role', allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory, deny: PermissionFlagsBits.SendMessages | PermissionFlagsBits.AddReactions | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads | PermissionFlagsBits.UseApplicationCommands },
    { id: botId, type: 'member', allow: BOT_TEXT_ALLOW, deny: 0n },
  ];
}

/** Nom de la catégorie d'un bâtiment. */
export const categoryName = (b: { name: string; emoji?: string }) => `${b.emoji ? b.emoji + ' ' : ''}${b.name}`.slice(0, 100);
