import type { BuildingPayload, Entity, World, SyncStatus } from "./types";

export function editIdentity(
  payload: BuildingPayload,
  patch: Partial<BuildingPayload>,
): BuildingPayload {
  return { ...payload, ...patch };
}
export function newBuilding(): BuildingPayload {
  return {
    name: "",
    description: "",
    emoji: "◇",
    entity_kind: "place",
    actions: [],
    modules: {},
  };
}
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
export function filterEntities(
  rows: Entity[],
  search: string,
  status: string,
): Entity[] {
  return rows.filter(
    (row) =>
      (!status || row.status === status) &&
      normalize(
        `${row.payload.name} ${row.payload.category ?? ""} ${row.entity_key}`,
      ).includes(normalize(search)),
  );
}
export function canEdit(
  world: Pick<World, "role" | "permissions">,
  account?: { is_admin: boolean },
): boolean {
  return (
    account?.is_admin === true ||
    ["proprietaire", "gestionnaire", "editeur"].includes(world.role) ||
    world.permissions.some((p) => p === "*" || p === "contenu:modifier")
  );
}
export function buildingSyncMessage(sync: SyncStatus, key: string): string {
  if (sync.scope !== "building" || sync.building_key !== key)
    return "Une autre opération est affichée par le moteur. La synchronisation de ce bâtiment reste à vérifier.";
  if (sync.status === "done")
    return "Le moteur signale la synchronisation terminée.";
  if (sync.status === "failed" || sync.status === "error")
    return "La synchronisation a échoué. Consultez le diagnostic dans KingdomWeb classique.";
  return "Demande en attente de traitement par le bot Discord. Le panneau Discord n’est pas encore confirmé.";
}
export const date = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      }).format(new Date(value))
    : "—";
export const labels: Record<string, string> = {
  building: "Bâtiments",
  item: "Objets",
  recipe: "Recettes",
  profession: "Métiers",
  npc: "Personnages",
  location: "Lieux",
  environment: "Environnements",
  quest: "Quêtes",
  event: "Événements",
  audio: "Sons",
  audio_group: "Ambiances",
  audio_story: "Scènes audio",
  voice_presence: "Présences",
  voice_profile: "Profils vocaux",
  bot: "Workers Discord",
  interface: "Interfaces",
  server_settings: "Paramètres",
};
export const moduleLabels: Record<string, string> = {
  professions: "Métiers",
  recipes: "Recettes",
  workstations: "Postes de production",
  products: "Commerce",
  delivery: "Livraisons",
  npc: "Dialogue",
  audio: "Audio",
  games: "Jeux",
  activities: "Activités",
  rumors: "Récits",
  construction: "Construction",
};
