/**
 * Présences vocales souhaitées pour un serveur : un bâtiment dont le salon vocal
 * contient au moins un joueur, et qui possède une configuration audio, reçoit une présence.
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
  const out: Presence[] = [];
  for (const b of input.engine.world.buildings) {
    const voice = input.channels[b.id]?.voice;
    if (!voice || !b.audio) continue;
    if ((input.occupancy.get(voice) ?? 0) < 1) continue;
    out.push({
      key: `${input.serverId}:${b.id}`,
      guildId: input.guildId,
      channelId: voice,
      serverId: input.serverId,
      building: b.id,
      identity: { name: b.npc?.name ?? b.name, avatarUrl: b.npc?.avatarUrl },
      ambience: input.engine.ambienceFor(b.id),
      welcome: b.audio.welcome,
      volume: b.audio.volume ?? 0.6,
    });
  }
  return out;
}
