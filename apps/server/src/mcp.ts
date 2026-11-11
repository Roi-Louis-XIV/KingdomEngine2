/**
 * Serveur MCP (Model Context Protocol) : permet à une IA (Claude Code, Claude Desktop…) de lire,
 * modifier, tester et publier les mondes d'un compte, avec un jeton d'accès créé dans le profil.
 *
 * Transport « Streamable HTTP » sans flux : POST /mcp, JSON-RPC 2.0, réponses JSON.
 * Authentification : « Authorization: Bearer ke4_… ». Le jeton porte un niveau d'accès
 * (lecture / brouillon / publication) ; les droits du compte sur chaque monde s'appliquent en plus.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine, validateRendered, validateWorld, type Issue, type RenderedMessage, type WorldDef } from '../../../packages/engine/src/index.ts';
import { RawReply, type Req, type Router } from './http.ts';
import { HttpError, TOKEN_ACCESS_LABEL, type Platform, type ServerRole, type TokenAccess, type TokenAccount } from './platform.ts';
import type { Runtimes } from './runtime.ts';
import type { DiscordBridge, VoiceBridge } from './bridges.ts';

export interface McpDeps {
  platform: Platform;
  runtimes: Runtimes;
  discord: () => DiscordBridge;
  voice: () => VoiceBridge;
  version: string;
  throttle?: (key: string) => void;
}

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const ACCESS_RANK: Record<TokenAccess, number> = { read: 0, draft: 1, publish: 2 };
const allowed = (tool: TokenAccess, token: TokenAccess) => (ACCESS_RANK[tool] ?? 9) <= (ACCESS_RANK[token] ?? -1);
const MAX_TEXT = 150_000;
const ROOT = resolve(import.meta.dirname, '../../..');

const readDoc = (rel: string) => {
  try {
    return readFileSync(resolve(ROOT, rel), 'utf8');
  } catch {
    return `(${rel} introuvable sur ce serveur)`;
  }
};

export const MCP_INSTRUCTIONS = `KingdomEngine 4 : plateforme de mondes de jeu de rôle joués sur Discord (bâtiments = salons, interfaces = messages à boutons).
Avant de créer ou modifier un monde : appelle get_guide (méthode et règles), puis get_reference (le modèle de données complet).
Méthode : list_worlds → get_world_outline → get_world (avec un pointeur JSON) → patch_draft (petites opérations) → validate_world → preview_play (essai sans risque) → publish_draft seulement si la personne l'a demandé.
Tu modifies toujours le BROUILLON : les joueurs ne voient rien tant qu'il n'est pas publié. Écris les textes en français.`;

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  title: string;
  description: string;
  access: TokenAccess;
  readOnly: boolean;
  inputSchema: Record<string, unknown>;
}

const worldId = { type: 'string', description: 'Identifiant du monde (list_worlds).' };
const source = { type: 'string', enum: ['draft', 'published'], description: 'draft (défaut) : le brouillon en cours ; published : la version jouée.' };
const revision = { type: 'integer', description: 'Révision du brouillon lue juste avant (get_world_outline / get_world). Évite d’écraser une modification faite entre-temps dans le Studio.' };

export const TOOLS: ToolDef[] = [
  {
    name: 'list_worlds',
    title: 'Mes mondes',
    description: 'Liste les mondes accessibles avec ce jeton : identifiant, nom, rôle, état du brouillon et de la version publiée, Discord relié ou non.',
    access: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_templates',
    title: 'Modèles de monde',
    description: 'Modèles disponibles pour create_world (vierge, Le Royaume, La Nuit de la Sainte Pelle…).',
    access: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_guide',
    title: 'Guide de création',
    description: 'Méthode de travail, conventions et pièges à éviter pour créer un monde KingdomEngine. À lire en premier.',
    access: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_reference',
    title: 'Modèle de données',
    description: 'Définition TypeScript complète et commentée d’un monde (WorldDef) : bâtiments, modules, écrans, blocs, widgets, actions, conditions, quêtes, événements.',
    access: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_world_outline',
    title: 'Plan d’un monde',
    description: 'Résumé compact d’un monde : objets, métiers, variables, quêtes, événements, bâtiments avec leurs modules et écrans, nombre d’erreurs. Donne la révision du brouillon.',
    access: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { world_id: worldId, source }, required: ['world_id'] },
  },
  {
    name: 'get_world',
    title: 'Lire une partie d’un monde',
    description:
      'Renvoie le JSON du monde, ou seulement la partie désignée par un pointeur JSON (RFC 6901), par ex. "/buildings/2", "/items", "/quests/quests/0". Les gros mondes dépassent la limite de taille : lis-les par parties. Pour trouver l’index d’un bâtiment, utilise get_world_outline.',
    access: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { world_id: worldId, source, pointer: { type: 'string', description: 'Pointeur JSON, vide = tout le monde.' } }, required: ['world_id'] },
  },
  {
    name: 'validate_world',
    title: 'Vérifier un monde',
    description: 'Liste les erreurs (bloquent la publication) et avertissements du brouillon ou de la version publiée.',
    access: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { world_id: worldId, source }, required: ['world_id'] },
  },
  {
    name: 'preview_play',
    title: 'Essayer un bâtiment',
    description:
      'Joue une courte partie d’essai, dans un monde neuf et isolé (aucun effet sur les vrais joueurs), et renvoie ce que voit le joueur sur Discord en texte, avec les boutons disponibles. Étapes possibles : {"press": "libellé du bouton, ou titre de sa section, ou identifiant"}, {"select": "texte du menu ou identifiant", "values": ["valeur"]}, {"enter": "id_du_bâtiment"}, {"wait_minutes": 10}, {"start_event": "id"} (lance un événement, ex. le scénario), {"set_variable": "id", "value": …}. Le serment d’arrivée est prêté automatiquement.',
    access: 'read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        world_id: worldId,
        source,
        building: { type: 'string', description: 'Bâtiment de départ (identifiant). Défaut : le premier.' },
        steps: { type: 'array', items: { type: 'object' }, description: 'Actions successives du joueur.' },
        seed: { type: 'integer', description: 'Graine du hasard (résultats reproductibles). Défaut : 1.' },
      },
      required: ['world_id'],
    },
  },
  {
    name: 'list_media',
    title: 'Sons du monde',
    description: 'Sons importés dans la médiathèque (clé à utiliser dans le monde, nom, type).',
    access: 'read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { world_id: worldId }, required: ['world_id'] },
  },
  {
    name: 'create_world',
    title: 'Créer un monde',
    description: 'Crée un nouveau monde (sans Discord relié) à partir d’un modèle. La personne le reliera à son serveur Discord depuis le Studio.',
    access: 'draft',
    readOnly: false,
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, template: { type: 'string', description: 'Identifiant du modèle (list_templates). Défaut : vierge.' } }, required: ['name'] },
  },
  {
    name: 'patch_draft',
    title: 'Modifier le brouillon',
    description:
      'Applique des opérations sur le brouillon, toutes ou aucune : {"op":"set","path":"/buildings/0/name","value":"…"} (remplace ou crée), {"op":"add","path":"/items/-","value":{…}} (insère ; "-" = à la fin), {"op":"remove","path":"/items/3"}, {"op":"merge","path":"/buildings/0","value":{…}} (fusionne les champs d’un objet). Renvoie la nouvelle révision et les erreurs de validation.',
    access: 'draft',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        world_id: worldId,
        revision,
        operations: { type: 'array', items: { type: 'object', properties: { op: { type: 'string', enum: ['set', 'add', 'remove', 'merge'] }, path: { type: 'string' }, value: {} }, required: ['op', 'path'] } },
      },
      required: ['world_id', 'revision', 'operations'],
    },
  },
  {
    name: 'save_draft',
    title: 'Remplacer le brouillon',
    description: 'Remplace le brouillon entier par un monde complet (format "kingdom-world@1"). Préfère patch_draft pour les retouches.',
    access: 'draft',
    readOnly: false,
    inputSchema: { type: 'object', properties: { world_id: worldId, revision, world: { type: 'object' } }, required: ['world_id', 'revision', 'world'] },
  },
  {
    name: 'discard_draft',
    title: 'Abandonner le brouillon',
    description: 'Supprime le brouillon : on repart de la version publiée.',
    access: 'draft',
    readOnly: false,
    inputSchema: { type: 'object', properties: { world_id: worldId }, required: ['world_id'] },
  },
  {
    name: 'publish_draft',
    title: 'Publier',
    description: 'Publie le brouillon : les joueurs le voient immédiatement sur Discord. Refusé s’il reste des erreurs. Ne publie que si la personne l’a explicitement demandé.',
    access: 'publish',
    readOnly: false,
    inputSchema: { type: 'object', properties: { world_id: worldId, revision, note: { type: 'string', description: 'Résumé des changements (journal).' } }, required: ['world_id', 'revision'] },
  },
];

// ---------------------------------------------------------------------------
// Pointeurs et opérations JSON
// ---------------------------------------------------------------------------

export function parsePointer(pointer: string): string[] {
  if (!pointer || pointer === '/') return [];
  if (!pointer.startsWith('/')) throw new ToolError(`Pointeur invalide « ${pointer} » : il commence par « / », ex. /buildings/0.`);
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function getAt(doc: unknown, pointer: string): unknown {
  let cur: any = doc;
  for (const key of parsePointer(pointer)) {
    if (cur === null || typeof cur !== 'object' || !(key in cur)) throw new ToolError(`Rien à l’emplacement ${pointer} (clé « ${key} » absente).`);
    cur = cur[key];
  }
  return cur;
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export interface PatchOp {
  op: 'set' | 'add' | 'remove' | 'merge';
  path: string;
  value?: unknown;
}

/** Applique les opérations sur une copie ; la moindre erreur annule tout. */
export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  if (!Array.isArray(ops) || !ops.length) throw new ToolError('Aucune opération.');
  if (ops.length > 200) throw new ToolError('200 opérations au maximum par appel.');
  const out = structuredClone(doc) as any;
  ops.forEach((o, i) => {
    const where = `Opération ${i + 1} (${o?.op} ${o?.path})`;
    if (!o || !['set', 'add', 'remove', 'merge'].includes(o.op)) throw new ToolError(`${where} : op doit valoir set, add, remove ou merge.`);
    const keys = parsePointer(String(o.path ?? ''));
    if (keys.some((k) => FORBIDDEN.has(k))) throw new ToolError(`${where} : clé interdite.`);
    if (!keys.length) throw new ToolError(`${where} : impossible de modifier la racine ; utilise save_draft.`);
    if (o.op !== 'remove' && o.value === undefined) throw new ToolError(`${where} : value manquante.`);
    const last = keys[keys.length - 1]!;
    let parent: any = out;
    for (const k of keys.slice(0, -1)) {
      if (parent === null || typeof parent !== 'object' || !(k in parent)) throw new ToolError(`${where} : emplacement inexistant (« ${k} »).`);
      parent = parent[k];
    }
    if (parent === null || typeof parent !== 'object') throw new ToolError(`${where} : le parent n’est pas un objet ni une liste.`);
    const value = o.value === undefined ? undefined : structuredClone(o.value);
    if (Array.isArray(parent)) {
      const idx = last === '-' ? parent.length : /^\d+$/.test(last) ? Number(last) : NaN;
      if (Number.isNaN(idx)) throw new ToolError(`${where} : index de liste invalide « ${last} ».`);
      if (o.op === 'add') {
        if (idx > parent.length) throw new ToolError(`${where} : index ${idx} au-delà de la fin (${parent.length}).`);
        parent.splice(idx, 0, value);
        return;
      }
      if (idx >= parent.length) throw new ToolError(`${where} : index ${idx} absent (la liste a ${parent.length} élément(s)).`);
      if (o.op === 'remove') parent.splice(idx, 1);
      else if (o.op === 'set') parent[idx] = value;
      else mergeInto(parent, idx, value, where);
      return;
    }
    if (o.op === 'remove') {
      if (!(last in parent)) throw new ToolError(`${where} : rien à supprimer.`);
      delete parent[last];
    } else if (o.op === 'merge') {
      if (!(last in parent)) throw new ToolError(`${where} : rien à fusionner (utilise set).`);
      mergeInto(parent, last, value, where);
    } else parent[last] = value;
  });
  return out;
}

function mergeInto(parent: any, key: string | number, value: unknown, where: string) {
  const target = parent[key];
  if (!target || typeof target !== 'object' || Array.isArray(target) || !value || typeof value !== 'object' || Array.isArray(value))
    throw new ToolError(`${where} : merge ne s’applique qu’à des objets (pas à des listes).`);
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN.has(k)) throw new ToolError(`${where} : clé interdite.`);
    if (v === null) delete target[k];
    else target[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Rendu texte d'un message Discord (pour l'essai)
// ---------------------------------------------------------------------------

export interface Control {
  kind: 'button' | 'select';
  label: string;
  id: string;
  disabled?: boolean;
  options?: string[];
  /** Pour un bouton de section : le titre de la section (distingue plusieurs « Lancer »). */
  context?: string;
}

const firstLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/[*_#>`~]/g, '').trim())
    .find(Boolean) ?? '';

export function renderText(msg: RenderedMessage): { text: string; controls: Control[] } {
  const lines: string[] = [];
  const controls: Control[] = [];
  const button = (b: { label: string; emoji?: string; customId: string; disabled?: boolean }, context?: string) => {
    const label = [b.emoji, b.label].filter(Boolean).join(' ');
    controls.push({ kind: 'button', label, id: b.customId, ...(b.disabled ? { disabled: true } : {}), ...(context ? { context } : {}) });
    return `[${label}${b.disabled ? ' (grisé)' : ''}]`;
  };
  const visit = (c: any, indent: string) => {
    if (c.type === 'text') lines.push(indent + c.content.replace(/\n/g, `\n${indent}`));
    else if (c.type === 'separator') lines.push(indent + (c.large ? '════════' : '────────'));
    else if (c.type === 'section') {
      c.texts.forEach((t: any) => lines.push(indent + t.content.replace(/\n/g, `\n${indent}`)));
      lines.push(`${indent}  → ${button(c.accessory, firstLine(c.texts.map((t: any) => t.content).join('\n')))}`);
    } else if (c.type === 'row') {
      const items = c.items as any[];
      if (items[0]?.type === 'select') {
        const s = items[0];
        controls.push({ kind: 'select', label: s.placeholder, id: s.customId, options: s.options.map((o: any) => `${o.value} = ${o.label}`) });
        lines.push(`${indent}<Menu « ${s.placeholder} » : ${s.options.map((o: any) => o.label).join(' | ')}>`);
      } else lines.push(indent + items.map((b) => button(b)).join(' '));
    } else if (c.type === 'container') {
      lines.push(`${indent}┌───`);
      c.children.forEach((x: any) => visit(x, `${indent}│ `));
      lines.push(`${indent}└───`);
    }
  };
  msg.components.forEach((c) => visit(c, ''));
  return { text: lines.join('\n'), controls };
}

/** Hasard reproductible (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Step = { press?: string; select?: string; values?: string[]; enter?: string; wait_minutes?: number; start_event?: string; set_variable?: string; value?: string | number };

export function previewPlay(world: WorldDef, opts: { building?: string; steps?: Step[]; seed?: number }): string {
  const steps = Array.isArray(opts.steps) ? opts.steps : [];
  if (steps.length > 60) throw new ToolError('60 étapes au maximum.');
  let offset = 0;
  const start = Date.UTC(2026, 0, 1, 18, 0);
  let ids = 0;
  const engine = new Engine(structuredClone(world), undefined, { now: () => start + offset, random: seeded(Number(opts.seed ?? 1)), newId: () => `s${++ids}` });
  const player = 'essai-ia';
  const log: string[] = [];
  if (world.onboarding?.enabled) {
    const oath = engine.acceptOath(player);
    log.push(`Serment prêté.${oath.gains ? ` Reçu : ${oath.gains}` : ''}`);
  }
  const findBuilding = (id: string | undefined) => {
    const b = id ? world.buildings.find((x) => x.id === id) : world.buildings[0];
    if (!b) throw new ToolError(id ? `Bâtiment inconnu « ${id} ». Bâtiments : ${world.buildings.map((x) => x.id).join(', ')}.` : 'Ce monde n’a aucun bâtiment.');
    return b;
  };
  let building = findBuilding(opts.building);
  let session = engine.openSession(player, building.id).sessionId;
  log.push(`Entrée dans « ${building.name} ».`);
  steps.forEach((step, i) => {
    const n = `Étape ${i + 1}`;
    if (step.enter) {
      building = findBuilding(step.enter);
      engine.closeSessionsOf(player);
      session = engine.openSession(player, building.id).sessionId;
      log.push(`${n} : entrée dans « ${building.name} ».`);
      return;
    }
    if (step.start_event) {
      if (!(world.events ?? []).some((e) => e.id === step.start_event)) throw new ToolError(`${n} : événement inconnu « ${step.start_event} ». Événements : ${(world.events ?? []).map((e) => e.id).join(', ') || 'aucun'}.`);
      engine.eventControl(step.start_event, 'start');
      engine.tick();
      log.push(`${n} : événement « ${step.start_event} » lancé.`);
      return;
    }
    if (step.set_variable) {
      if (!world.variables.some((v) => v.id === step.set_variable)) throw new ToolError(`${n} : variable inconnue « ${step.set_variable} ».`);
      if (step.value === undefined) throw new ToolError(`${n} : value manquante pour set_variable.`);
      engine.setVariable(step.set_variable, step.value);
      log.push(`${n} : variable ${step.set_variable} = ${step.value}.`);
      return;
    }
    if (step.wait_minutes !== undefined) {
      const m = Number(step.wait_minutes);
      if (!(m > 0 && m <= 24 * 60)) throw new ToolError(`${n} : wait_minutes entre 1 et 1440.`);
      for (let t = 0; t < m; t++) {
        offset += 60_000;
        engine.tick();
      }
      log.push(`${n} : ${m} minute(s) passent.`);
      return;
    }
    const { controls } = renderText(engine.view(session).message);
    const wanted = String(step.press ?? step.select ?? '').trim();
    if (!wanted) throw new ToolError(`${n} : indique press, select, enter, wait_minutes, start_event ou set_variable.`);
    const kind = step.select !== undefined ? 'select' : 'button';
    const pool = controls.filter((c) => c.kind === kind);
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const full = (c: Control) => norm(c.context ? `${c.label} ${c.context}` : c.label);
    const match =
      pool.find((c) => c.id === wanted) ??
      pool.find((c) => norm(c.label) === norm(wanted)) ??
      pool.find((c) => !!c.context && norm(c.context).includes(norm(wanted))) ??
      pool.find((c) => full(c).includes(norm(wanted)));
    if (!match) throw new ToolError(`${n} : aucun ${kind === 'select' ? 'menu' : 'bouton'} « ${wanted} » sur cet écran. Disponibles : ${pool.map((c) => `« ${c.label} »${c.context ? ` (${c.context})` : ''}`).join(', ') || 'aucun'}.`);
    if (match.disabled) log.push(`${n} : « ${match.label} » est grisé (clic tenté quand même).`);
    const r = engine.interact(player, match.id, step.values ?? []);
    log.push(`${n} : ${kind === 'select' ? `menu « ${match.label} » → ${(step.values ?? []).join(', ')}` : `clic sur « ${match.label} »`}${r.notice ? `\n   Message : ${r.notice.replace(/\n/g, '\n   ')}` : ''}${r.private ? `\n   ${r.private}` : ''}${r.events?.length ? `\n   Effets : ${r.events.map((e: any) => e.type + (e.sound ? ` ${e.sound}` : '')).join(', ')}` : ''}`);
  });
  const msg = engine.view(session).message;
  const { text, controls } = renderText(msg);
  const limits = validateRendered(msg);
  const p = engine.player(player) as any;
  const inventory = p?.items ? Object.entries(p.items as Record<string, number>).filter(([, q]) => q).map(([k, q]) => `${k}×${q}`).join(', ') : '';
  return [
    '## Déroulé',
    log.join('\n'),
    `\n## Écran affiché (${building.name})`,
    text,
    '\n## Commandes disponibles',
    controls.map((c) => `- ${c.kind === 'select' ? 'Menu' : 'Bouton'} « ${c.label} »${c.context ? ` — section « ${c.context} »` : ''}${c.disabled ? ' (grisé)' : ''}${c.options ? ` : ${c.options.join(' ; ')}` : ''}`).join('\n') || '(aucune)',
    p ? `\n## Joueur\n${JSON.stringify({ stats: p.stats, objets: inventory || '(aucun)', metiers: p.jobs, metiersActifs: p.activeJobs, quete: p.quest ?? null })}` : '',
    limits.length ? `\n## ⚠ Limites Discord dépassées\n${limits.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Résumé d'un monde
// ---------------------------------------------------------------------------

export function outline(world: WorldDef, issues: Issue[]) {
  const ids = (list: { id: string; name?: string }[] | undefined) => (list ?? []).map((x) => (x.name ? `${x.id} (${x.name})` : x.id));
  return {
    id: world.id,
    name: world.name,
    description: world.description,
    settings: world.settings,
    stats: ids(world.stats as any),
    items: ids(world.items as any),
    jobs: ids(world.jobs as any),
    variables: (world.variables ?? []).map((v: any) => v.id),
    modifiers: (world.modifiers ?? []).map((m: any) => m.id),
    newPlayer: world.newPlayer,
    onboarding: world.onboarding ? { enabled: world.onboarding.enabled, roleName: world.onboarding.roleName } : null,
    weather: world.weather ? { variable: (world.weather as any).variable } : null,
    events: ids(world.events as any),
    quests: world.quests ? { count: world.quests.quests?.length ?? 0, ids: (world.quests.quests ?? []).map((q: any) => `${q.id} (${q.title ?? q.name ?? ''})`) } : null,
    buildings: world.buildings.map((b, index) => ({
      index,
      id: b.id,
      name: b.name,
      npc: b.npc?.name,
      homeScreen: b.homeScreen,
      modules: b.modules.map((m: any) => `${m.id} [${m.type}]`),
      screens: b.screens.map((s: any) => `${s.id}${s.title ? ` (${s.title})` : ''} : ${s.blocks?.length ?? 0} bloc(s)`),
    })),
    issues: { errors: issues.filter((i) => i.level === 'error').length, warnings: issues.filter((i) => i.level === 'warning').length },
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

class ToolError extends Error {}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new RawReply(status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', ...extra });

export function registerMcp(router: Router, deps: McpDeps) {
  const { platform, runtimes } = deps;

  const notAllowed = () => json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Utilise POST /mcp (pas de flux SSE sur ce serveur).' } }, 405, { allow: 'POST' });
  router.add('GET', '/mcp', notAllowed, { bearer: true });
  router.add('DELETE', '/mcp', notAllowed, { bearer: true });

  router.add(
    'POST',
    '/mcp',
    async (r: Req) => {
      // Protection contre le « DNS rebinding » : une page web ne doit pas pouvoir parler à ce serveur.
      const origin = r.headers.origin;
      if (origin && origin !== 'null') {
        let host = '';
        try {
          host = new URL(origin).host;
        } catch {}
        if (host !== r.headers.host && host !== r.headers['x-forwarded-host']) return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Origine refusée.' } }, 403);
      }
      const account = platform.authenticateToken(r.bearer);
      if (!account) {
        deps.throttle?.(`mcp:${r.ip}`);
        return json(
          { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Jeton absent ou invalide. Crée un jeton dans le Studio : Profil › Jetons d’accès pour les IA.' } },
          401,
          { 'www-authenticate': 'Bearer realm="KingdomEngine"' },
        );
      }
      const body = r.body;
      const batch = Array.isArray(body);
      const messages: RpcMessage[] = batch ? body : [body];
      if (!messages.length) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Requête vide.' } }, 400);
      const replies = [];
      for (const m of messages) {
        const reply = await handle(account, m);
        if (reply) replies.push(reply);
      }
      if (!replies.length) return new RawReply(202, null);
      return json(batch ? replies : replies[0]);
    },
    { bearer: true },
  );

  async function handle(account: TokenAccount, m: RpcMessage) {
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string')
      return { jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'Requête JSON-RPC invalide.' } };
    const isNotification = m.id === undefined;
    const ok = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id: m.id, result });
    const err = (code: number, message: string) => (isNotification ? null : { jsonrpc: '2.0', id: m.id, error: { code, message } });
    switch (m.method) {
      case 'initialize': {
        const asked = String(m.params?.protocolVersion ?? '');
        return ok({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'kingdomengine', title: 'KingdomEngine', version: deps.version },
          instructions: `${MCP_INSTRUCTIONS}\nCompte : ${account.displayName}. Accès du jeton : ${TOKEN_ACCESS_LABEL[account.tokenAccess]}.`,
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({
          tools: TOOLS.filter((t) => allowed(t.access, account.tokenAccess)).map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: t.name === 'discard_draft' || t.name === 'save_draft', openWorldHint: false },
          })),
        });
      case 'tools/call': {
        const name = String(m.params?.name ?? '');
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return err(-32602, `Outil inconnu : ${name}`);
        if (!allowed(tool.access, account.tokenAccess))
          return ok(toolResult(`Ce jeton (« ${TOKEN_ACCESS_LABEL[account.tokenAccess]} ») ne permet pas « ${tool.title} ». Crée un jeton avec plus d’accès dans le Studio.`, true));
        try {
          const out = await callTool(account, name, m.params?.arguments ?? {});
          return ok(toolResult(out));
        } catch (e) {
          if (e instanceof ToolError || e instanceof HttpError) return ok(toolResult((e as Error).message + issuesOf(e), true));
          console.error(`MCP ${name} :`, e);
          return ok(toolResult('Erreur interne du serveur (voir les journaux).', true));
        }
      }
      default:
        if (m.method.startsWith('notifications/')) return null;
        if (m.method === 'resources/list') return ok({ resources: [] });
        if (m.method === 'prompts/list') return ok({ prompts: [] });
        return err(-32601, `Méthode non prise en charge : ${m.method}`);
    }
  }

  function issuesOf(e: unknown): string {
    const data = (e as HttpError).data as { issues?: Issue[] } | undefined;
    return data?.issues?.length ? `\n${formatIssues(data.issues)}` : '';
  }

  const need = (account: TokenAccount, id: unknown, min: ServerRole) => {
    if (typeof id !== 'string' || !id) throw new ToolError('world_id manquant (voir list_worlds).');
    return platform.require(account, id, min);
  };

  const loadWorld = (serverId: string, which: unknown): { world: WorldDef; revision: number | null; version: number | null } => {
    if (which === 'published') {
      const p = platform.published(serverId);
      if (!p) throw new ToolError('Ce monde n’a pas encore de version publiée.');
      return { world: p.world, revision: null, version: p.version };
    }
    const d = platform.draft(serverId);
    return { world: d.world, revision: d.revision, version: d.version };
  };

  const afterWrite = (serverId: string, account: TokenAccount, summary: string) =>
    platform.audit(serverId, account.id, 'mcp.write', `${summary} (IA, jeton ${account.tokenId})`);

  async function callTool(account: TokenAccount, name: string, a: any): Promise<string> {
    switch (name) {
      case 'list_worlds': {
        const list = platform.serversFor(account).map((s) => {
          const c = platform.contentStatus(s.id);
          return {
            world_id: s.id,
            name: s.name,
            role: s.role,
            discord: s.guildId ? 'relié' : 'non relié',
            published: c.published ? `version ${c.published.version}` : 'jamais publié',
            draft: c.draft ? `révision ${c.draft.revision}` : 'aucun (identique à la version publiée)',
          };
        });
        return list.length ? JSON.stringify(list, null, 1) : 'Aucun monde. Utilise create_world (jeton « brouillon ») ou crée-le dans le Studio.';
      }
      case 'list_templates':
        return JSON.stringify(platform.templates(), null, 1);
      case 'get_guide':
        return readDoc('docs/MCP_GUIDE.md');
      case 'get_reference':
        return readDoc('packages/engine/src/model.ts');
      case 'get_world_outline': {
        const s = need(account, a.world_id, 'viewer');
        const w = loadWorld(s.id, a.source);
        return JSON.stringify({ world_id: s.id, source: a.source === 'published' ? 'published' : 'draft', revision: w.revision, version: w.version, ...outline(w.world, validateWorld(w.world)) }, null, 1);
      }
      case 'get_world': {
        const s = need(account, a.world_id, 'viewer');
        const w = loadWorld(s.id, a.source);
        const pointer = String(a.pointer ?? '');
        const text = JSON.stringify(getAt(w.world, pointer), null, 1);
        if (text.length > MAX_TEXT)
          throw new ToolError(`Partie trop volumineuse (${Math.round(text.length / 1000)} k caractères). Lis-la par morceaux : get_world_outline, puis un pointeur plus précis (ex. ${pointer || ''}/buildings/0).`);
        return `révision du brouillon : ${w.revision ?? '—'} · pointeur : ${pointer || '(tout)'}\n${text}`;
      }
      case 'validate_world': {
        const s = need(account, a.world_id, 'viewer');
        const issues = validateWorld(loadWorld(s.id, a.source).world);
        return issues.length ? formatIssues(issues) : 'Aucune erreur ni avertissement.';
      }
      case 'preview_play': {
        const s = need(account, a.world_id, 'viewer');
        const w = loadWorld(s.id, a.source).world;
        try {
          return previewPlay(w, { building: a.building, steps: a.steps, seed: a.seed });
        } catch (e) {
          if (e instanceof ToolError) throw e;
          throw new ToolError(`Le moteur a refusé ce monde pendant l’essai : ${(e as Error).message}. Vérifie avec validate_world.`);
        }
      }
      case 'list_media': {
        const s = need(account, a.world_id, 'viewer');
        const list = platform.audioList(s.id) as any[];
        return list.length ? JSON.stringify(list.map((x) => ({ key: x.key, name: x.name, kind: x.kind })), null, 1) : 'Aucun son importé. La personne les ajoute dans le Studio (Médiathèque).';
      }
      case 'create_world': {
        const created = platform.createServer(account, { name: String(a.name ?? ''), template: String(a.template ?? 'vierge') });
        platform.audit(created.id, account.id, 'mcp.write', `Monde créé par une IA (jeton ${account.tokenId})`);
        return `Monde créé : world_id = ${created.id}. Relie-le à Discord depuis le Studio (Paramètres).`;
      }
      case 'patch_draft': {
        const s = need(account, a.world_id, 'editor');
        const d = platform.draft(s.id);
        if (!Number.isInteger(a.revision)) throw new ToolError(`revision manquante : la révision actuelle est ${d.revision}.`);
        if (a.revision !== d.revision) throw new ToolError(`Le brouillon a changé (révision ${d.revision}, tu as lu la ${a.revision}). Relis la partie concernée avant de modifier.`);
        const next = applyPatch(d.world, a.operations);
        const saved = platform.saveDraft(s.id, account, next, d.revision);
        afterWrite(s.id, account, `Brouillon modifié : ${(a.operations as PatchOp[]).length} opération(s)`);
        return `Brouillon enregistré : révision ${saved.revision}.\n${saved.issues.length ? formatIssues(saved.issues) : 'Aucune erreur.'}`;
      }
      case 'save_draft': {
        const s = need(account, a.world_id, 'editor');
        if (!a.world || typeof a.world !== 'object') throw new ToolError('world manquant.');
        if (!Number.isInteger(a.revision)) throw new ToolError(`revision manquante : la révision actuelle est ${platform.draft(s.id).revision}.`);
        const saved = platform.saveDraft(s.id, account, a.world as WorldDef, a.revision);
        afterWrite(s.id, account, 'Brouillon remplacé');
        return `Brouillon enregistré : révision ${saved.revision}.\n${saved.issues.length ? formatIssues(saved.issues) : 'Aucune erreur.'}`;
      }
      case 'discard_draft': {
        const s = need(account, a.world_id, 'editor');
        platform.discardDraft(s.id, account);
        return 'Brouillon abandonné.';
      }
      case 'publish_draft': {
        const s = need(account, a.world_id, 'editor');
        if (!Number.isInteger(a.revision)) throw new ToolError('revision manquante (get_world_outline).');
        const res = platform.publish(s.id, account, a.revision, a.note ? `${String(a.note).slice(0, 200)} (IA)` : 'Publié par une IA');
        runtimes.reload(s.id);
        deps.voice().refresh();
        let sync = '';
        try {
          await deps.discord().syncBuildings(s.id, true);
        } catch (e) {
          sync = `\nSalons Discord non mis à jour : ${(e as Error).message}`;
        }
        return `Version ${res.version} publiée : les joueurs la voient maintenant.${sync}`;
      }
    }
    throw new ToolError(`Outil inconnu : ${name}`);
  }
}

function toolResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

export function formatIssues(issues: Issue[]): string {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const list = (xs: Issue[]) => xs.slice(0, 40).map((i) => `- ${i.where} : ${i.message}`).join('\n') + (xs.length > 40 ? `\n… et ${xs.length - 40} autre(s)` : '');
  return [errors.length ? `${errors.length} erreur(s) (bloquent la publication) :\n${list(errors)}` : '', warnings.length ? `${warnings.length} avertissement(s) :\n${list(warnings)}` : '']
    .filter(Boolean)
    .join('\n');
}

