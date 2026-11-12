/**
 * Présences vocales souhaitées pour un serveur. Pour chaque bâtiment dont le salon vocal contient
 * au moins un joueur (ou tous, avec « ambiance permanente » : world.settings.voiceAlways) :
 * - chaque personnage qui s'y trouve (engine.charactersIn) reçoit sa présence, à son nom : il y dit ses répliques ;
 * - l'ambiance du bâtiment (et ses sons sans personnage) est jouée par celui qui y habite,
 *   sinon par un autre personnage présent, sinon par une présence au nom du bâtiment.
 * Sans world.characters, le personnage de chaque bâtiment est son `npc` (comportement d'origine).
 * Les bâtiments occupés passent en premier si les workers manquent.
 */
import type { Engine } from '../../../../packages/engine/src/index.ts';
import type { Presence } from './pool.ts';

export interface BuildingChannels {
  text?: string;
  voice?: string;
}

export const characterKey = (serverId: string, character: string) => `${serverId}:pnj:${character}`;
export const buildingKey = (serverId: string, building: string) => `${serverId}:lieu:${building}`;

export function desiredPresences(input: {
  serverId: string;
  guildId: string;
  engine: Engine;
  channels: Record<string, BuildingChannels>;
  /** Nombre de joueurs humains par salon vocal. */
  occupancy: Map<string, number>;
}): Presence[] {
  const { engine, serverId, guildId } = input;
  const out: (Presence & { occupied: boolean })[] = [];
  const always = !!engine.world.settings.voiceAlways;
  const explicit = !!engine.world.characters;
  for (const b of engine.world.buildings) {
    const voice = input.channels[b.id]?.voice;
    if (!voice) continue;
    // Sans liste de personnages : rien sans configuration audio (comportement d'origine).
    if (!explicit && !b.audio) continue;
    const occupied = (input.occupancy.get(voice) ?? 0) >= 1;
    if (!occupied && !always) continue;
    const amb = engine.ambienceCase(b.id);
    const ambience = amb?.sound || undefined;
    const message = amb?.message ? { sound: amb.message, every: amb.every ?? 30 } : undefined;
    const volume = b.audio?.volume ?? 0.6;
    // L'accueil n'a de sens que si quelqu'un l'entend.
    const welcome = occupied ? b.audio?.welcome : undefined;
    const here = engine.charactersIn(b.id);
    here.forEach((c, i) => {
      const holder = i === 0; // charactersIn place ceux qui habitent ici en premier
      out.push({
        occupied,
        key: characterKey(serverId, c.id),
        guildId,
        channelId: voice,
        serverId,
        building: b.id,
        character: c.id,
        holder,
        // Pas de bavardage sans public : les présences « permanentes » des salons vides se taisent.
        chatter: occupied ? engine.chatterFor(c.id) : undefined,
        identity: { name: c.name, avatarUrl: c.home === b.id ? b.npc?.avatarUrl : undefined },
        ambience: holder ? ambience : undefined,
        message: holder ? message : undefined,
        welcome: holder ? welcome : undefined,
        volume,
      });
    });
    if (!here.length && b.audio)
      out.push({ occupied, key: buildingKey(serverId, b.id), guildId, channelId: voice, serverId, building: b.id, holder: true, identity: { name: b.name }, ambience, message, welcome, volume });
  }
  // Bâtiments occupés d'abord (et, dans un bâtiment, celui qui joue l'ambiance) : ils sont servis en priorité.
  return out.sort((a, b) => Number(b.occupied) - Number(a.occupied) || Number(b.holder) - Number(a.holder)).map(({ occupied: _, ...p }) => p);
}

/** Personnages partis (déplacés « nulle part ») : leur Voice Worker quitte le vocal sans délai de grâce. */
export function departedKeys(engine: Engine, serverId: string): Set<string> {
  return new Set(engine.characters().filter((c) => !engine.characterLocation(c.id)).map((c) => characterKey(serverId, c.id)));
}

/** Nombre de Voice Workers nécessaires si tous les salons vocaux étaient occupés en même temps. */
export function voiceNeed(engine: Engine, channels: Record<string, BuildingChannels>): number {
  const occupancy = new Map(Object.values(channels).flatMap((c) => (c.voice ? [[c.voice, 1] as [string, number]] : [])));
  return desiredPresences({ serverId: 's', guildId: 'g', engine, channels, occupancy }).length;
}
