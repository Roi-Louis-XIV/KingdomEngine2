/**
 * Présences vocales souhaitées pour un serveur : un bâtiment qui possède une configuration audio
 * et dont le salon vocal contient au moins un joueur reçoit une présence.
 * Avec « ambiance permanente » (world.settings.voiceAlways), tous ces bâtiments en reçoivent une,
 * occupés ou non ; les bâtiments occupés passent en premier si les workers manquent.
 * L'identité est celle du PNJ du bâtiment (ou le bâtiment lui-même).
 */
import type { Engine } from '../../../../packages/engine/src/index.ts';
import type { Presence } from './pool.ts';

export interface BuildingChannels {
  text?: string;
  voice?: string;
}

export function desiredPresences(input: {
  serverId: string;
  guildId: string;
  engine: Engine;
  channels: Record<string, BuildingChannels>;
  /** Nombre de joueurs humains par salon vocal. */
  occupancy: Map<string, number>;
}): Presence[] {
  const out: (Presence & { occupied: boolean })[] = [];
  const always = !!input.engine.world.settings.voiceAlways;
  for (const b of input.engine.world.buildings) {
    const voice = input.channels[b.id]?.voice;
    if (!voice || !b.audio) continue;
    const occupied = (input.occupancy.get(voice) ?? 0) >= 1;
    if (!occupied && !always) continue;
    out.push({
      occupied,
      key: `${input.serverId}:${b.id}`,
      guildId: input.guildId,
      channelId: voice,
      serverId: input.serverId,
      building: b.id,
      identity: { name: b.npc?.name ?? b.name, avatarUrl: b.npc?.avatarUrl },
      ambience: input.engine.ambienceFor(b.id),
      // L'accueil n'a de sens que si quelqu'un l'entend.
      welcome: occupied ? b.audio.welcome : undefined,
      volume: b.audio.volume ?? 0.6,
    });
  }
  // Bâtiments occupés d'abord : ce sont eux qui reçoivent un worker s'il n'y en a pas pour tout le monde.
  return out.sort((a, b) => Number(b.occupied) - Number(a.occupied)).map(({ occupied: _, ...p }) => p);
}

/** Nombre de Voice Workers nécessaires pour l'ambiance permanente : un par bâtiment avec ambiance et salon vocal. */
export function voiceNeed(world: { buildings: { id: string; audio?: unknown }[] }, channels: Record<string, BuildingChannels>): number {
  return world.buildings.filter((b) => b.audio && channels[b.id]?.voice).length;
}
