/**
 * Entrée d'un bâtiment : panneau commun affiché dans son salon texte, avant d'entrer.
 * Le bouton « Entrer » porte un identifiant sans état (valable après un redémarrage).
 * Utilisé par le bot Discord et par l'émulateur du Studio.
 */
import type { BuildingDef } from './model.ts';
import type { RenderedMessage } from './components.ts';

const ENTER_PREFIX = 'ke:enter|';

export const enterCustomId = (buildingId: string) => `${ENTER_PREFIX}${buildingId}`;

export function parseEnter(customId: string): string | null {
  return customId.startsWith(ENTER_PREFIX) ? customId.slice(ENTER_PREFIX.length) || null : null;
}

/** Mention discrète en bas du panneau, qui permet au bot de le retrouver. */
export const panelMarker = (buildingId: string) => `-# KingdomEngine · bâtiment ${buildingId}`;

export const DEFAULT_ENTRANCE_TEXT = 'Tu es devant l’entrée. Clique sur le bouton pour entrer.';

/** Panneau d'entrée commun, affiché dans le salon texte du bâtiment. */
export function entrancePanel(b: Pick<BuildingDef, 'id' | 'name' | 'emoji' | 'accentColor' | 'npc' | 'entrance'>): RenderedMessage {
  const title = `## ${b.emoji ? b.emoji + ' ' : ''}${b.name}`;
  const lines = [title];
  if (b.npc?.name) lines.push(`*${b.npc.emoji ? b.npc.emoji + ' ' : ''}${b.npc.name}${b.npc.title ? ', ' + b.npc.title : ''}*`);
  lines.push(b.entrance?.text?.trim() || DEFAULT_ENTRANCE_TEXT);
  return {
    components: [
      {
        type: 'container',
        accent: b.accentColor ?? 0x0a6b45,
        children: [
          { type: 'text', content: lines.join('\n') },
          { type: 'separator' },
          {
            type: 'row',
            items: [{ type: 'button', label: (b.entrance?.button?.trim() || 'Entrer').slice(0, 80), emoji: b.entrance?.buttonEmoji || '🚪', style: 'success', customId: enterCustomId(b.id) }],
          },
          { type: 'text', content: panelMarker(b.id) },
        ],
      },
    ],
  };
}
