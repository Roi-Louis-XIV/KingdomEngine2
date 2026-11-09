/**
 * Traduction du rendu neutre du moteur en charge utile Discord Components V2 (JSON brut de l'API).
 * Types : 1 rangée · 2 bouton · 3 menu · 9 section · 10 texte · 14 séparateur · 17 encadré.
 */
import type { RButton, RSelect, RTopLevel, RenderedMessage, RText } from '../../../packages/engine/src/index.ts';

const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4 } as const;

/** Drapeau « IS_COMPONENTS_V2 » (1 << 15). */
export const COMPONENTS_V2_FLAG = 1 << 15;

const button = (b: RButton) => ({
  type: 2,
  style: STYLE[b.style],
  label: b.label.slice(0, 80),
  custom_id: b.customId,
  ...(b.emoji ? { emoji: { name: b.emoji } } : {}),
  ...(b.disabled ? { disabled: true } : {}),
});

const select = (s: RSelect) => ({
  type: 3,
  custom_id: s.customId,
  placeholder: s.placeholder.slice(0, 150),
  min_values: 1,
  max_values: 1,
  options: s.options.slice(0, 25).map((o) => ({
    label: o.label.slice(0, 100),
    value: o.value,
    ...(o.description ? { description: o.description.slice(0, 100) } : {}),
    ...(o.emoji ? { emoji: { name: o.emoji } } : {}),
    ...(o.default ? { default: true } : {}),
  })),
});

const text = (t: RText) => ({ type: 10, content: t.content });

function convert(c: RTopLevel): unknown {
  switch (c.type) {
    case 'text':
      return text(c);
    case 'separator':
      return { type: 14, divider: true, spacing: c.large ? 2 : 1 };
    case 'section':
      return { type: 9, components: c.texts.map(text), accessory: button(c.accessory) };
    case 'row':
      return { type: 1, components: (c.items as (RButton | RSelect)[]).map((i) => (i.type === 'button' ? button(i) : select(i))) };
    case 'container':
      return {
        type: 17,
        ...(c.accent !== undefined ? { accent_color: c.accent } : {}),
        components: c.children.map((x) => convert(x as RTopLevel)),
      };
  }
}

export function toDiscord(msg: RenderedMessage): unknown[] {
  return msg.components.map(convert);
}
