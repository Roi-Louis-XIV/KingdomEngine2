/**
 * Rendu neutre, calqué sur les Components V2 de Discord.
 * Le bot Discord et l'émulateur du Studio affichent exactement cet arbre.
 */
import type { ButtonStyle } from './model.ts';

export interface RButton {
  type: 'button';
  label: string;
  emoji?: string;
  style: ButtonStyle;
  customId: string;
  disabled?: boolean;
}
export interface RSelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: string;
  default?: boolean;
}
export interface RSelect {
  type: 'select';
  customId: string;
  placeholder: string;
  options: RSelectOption[];
}
export interface RText {
  type: 'text';
  content: string;
}
export interface RSeparator {
  type: 'separator';
  large?: boolean;
}
export interface RSection {
  type: 'section';
  texts: RText[];
  accessory: RButton;
}
export interface RActionRow {
  type: 'row';
  items: RButton[] | [RSelect];
}
export interface RContainer {
  type: 'container';
  accent?: number;
  children: (RText | RSeparator | RSection | RActionRow)[];
}

export type RTopLevel = RContainer | RText | RSeparator | RSection | RActionRow;

export interface RenderedMessage {
  components: RTopLevel[];
}

// Limites Discord (Components V2) — vérifiées dans validateRendered().
export const DISCORD_LIMITS = {
  totalComponents: 40,
  totalTextLength: 4000,
  customIdLength: 100,
  buttonLabel: 80,
  buttonsPerRow: 5,
  selectOptions: 25,
  optionLabel: 100,
  optionDescription: 100,
  placeholder: 150,
  sectionTexts: 3,
} as const;

export function countComponents(msg: RenderedMessage): number {
  let n = 0;
  const visit = (c: RTopLevel | RText | RButton | RSelect): void => {
    n += 1;
    if (c.type === 'container') c.children.forEach(visit);
    else if (c.type === 'section') {
      c.texts.forEach(visit);
      visit(c.accessory);
    } else if (c.type === 'row') (c.items as (RButton | RSelect)[]).forEach(visit);
  };
  msg.components.forEach(visit);
  return n;
}

/** Retourne la liste des violations des limites Discord (vide = valide). */
export function validateRendered(msg: RenderedMessage): string[] {
  const L = DISCORD_LIMITS;
  const issues: string[] = [];
  const total = countComponents(msg);
  if (total > L.totalComponents) issues.push(`${total} composants (max ${L.totalComponents})`);
  let textLength = 0;
  const checkButton = (b: RButton) => {
    if (b.customId.length > L.customIdLength) issues.push(`customId trop long : ${b.customId}`);
    if (b.label.length > L.buttonLabel) issues.push(`libellé de bouton trop long : ${b.label}`);
    if (!b.label && !b.emoji) issues.push('bouton sans libellé ni emoji');
  };
  const visit = (c: RTopLevel | RText): void => {
    switch (c.type) {
      case 'text':
        textLength += c.content.length;
        if (!c.content.trim()) issues.push('texte vide');
        break;
      case 'container':
        if (c.children.length === 0) issues.push('encadré vide');
        c.children.forEach(visit);
        break;
      case 'section':
        if (c.texts.length < 1 || c.texts.length > L.sectionTexts) issues.push('section : 1 à 3 textes');
        c.texts.forEach(visit);
        checkButton(c.accessory);
        break;
      case 'row': {
        const items = c.items as (RButton | RSelect)[];
        if (items.length === 0) issues.push('rangée vide');
        if (items.some((i) => i.type === 'select') && items.length !== 1)
          issues.push('un menu déroulant doit être seul dans sa rangée');
        if (items.length > L.buttonsPerRow) issues.push(`${items.length} boutons dans une rangée (max 5)`);
        for (const i of items) {
          if (i.type === 'button') checkButton(i);
          else {
            if (i.customId.length > L.customIdLength) issues.push(`customId trop long : ${i.customId}`);
            if (i.options.length < 1 || i.options.length > L.selectOptions)
              issues.push(`menu « ${i.placeholder} » : ${i.options.length} options (1 à 25)`);
            for (const o of i.options) {
              if (o.label.length > L.optionLabel) issues.push(`option trop longue : ${o.label}`);
              if ((o.description?.length ?? 0) > L.optionDescription) issues.push(`description trop longue : ${o.label}`);
            }
          }
        }
        break;
      }
      case 'separator':
        break;
    }
  };
  msg.components.forEach(visit);
  if (textLength > L.totalTextLength) issues.push(`${textLength} caractères de texte (max ${L.totalTextLength})`);
  const ids = new Set<string>();
  const collect = (c: RTopLevel | RText): void => {
    if (c.type === 'container') c.children.forEach(collect);
    if (c.type === 'section') {
      if (ids.has(c.accessory.customId)) issues.push(`customId en double : ${c.accessory.customId}`);
      ids.add(c.accessory.customId);
    }
    if (c.type === 'row')
      for (const i of c.items as (RButton | RSelect)[]) {
        if (ids.has(i.customId)) issues.push(`customId en double : ${i.customId}`);
        ids.add(i.customId);
      }
  };
  msg.components.forEach(collect);
  return issues;
}
