/**
 * KingdomEngine — bot Discord.
 *
 * Ce fichier ne contient AUCUNE règle de jeu : il ouvre des interfaces, transmet les clics
 * au moteur, affiche le résultat et sauvegarde l'état. Tout le reste vient du fichier de monde.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type MessageComponentInteraction,
} from 'discord.js';
import { Engine, validateWorld, type WorldDef } from '../../../packages/engine/src/index.ts';
import { COMPONENTS_V2_FLAG, toDiscord } from './discord-render.ts';
import { JsonStateStore } from './store.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // recommandé en test : commandes instantanées
const WORLD_FILE = resolve(process.env.KINGDOM_WORLD ?? 'content/le-royaume/world.json');
const STATE_FILE = resolve(process.env.KINGDOM_STATE ?? 'var/le-royaume.state.json');
const IDLE_MINUTES = Number(process.env.KINGDOM_IDLE_MINUTES ?? 30);
const TICK_MS = 1000;

if (!TOKEN) {
  console.error('❌ Définis DISCORD_TOKEN (voir .env.example).');
  process.exit(1);
}

const world = JSON.parse(readFileSync(WORLD_FILE, 'utf8')) as WorldDef;
const errors = validateWorld(world).filter((i) => i.level === 'error');
if (errors.length) {
  console.error(`❌ Le monde ${WORLD_FILE} contient ${errors.length} erreur(s) :`);
  for (const e of errors) console.error(`   • ${e.where} : ${e.message}`);
  process.exit(1);
}

const store = new JsonStateStore(STATE_FILE);
const engine = new Engine(world, store.load());
let savedRevision = -1;
const persist = () => {
  if (engine.revision !== savedRevision) {
    store.save(engine.snapshot());
    savedRevision = engine.revision;
  }
};
persist();

// ---------------------------------------------------------------------------
// Interfaces ouvertes : rafraîchies automatiquement (minuteurs, actions des autres joueurs)
// ---------------------------------------------------------------------------

interface Live {
  message: Message;
  json: string;
  revision: number;
  wakeAt: number | null;
  touchedAt: number;
  busy: boolean;
}
const live = new Map<string, Live>();

async function refreshAll() {
  const now = Date.now();
  for (const [sessionId, l] of live) {
    if (l.busy) continue;
    if (now - l.touchedAt > IDLE_MINUTES * 60_000) {
      live.delete(sessionId); // reste cliquable, mais n'est plus rafraîchie d'elle-même
      continue;
    }
    const due = engine.revision !== l.revision || (l.wakeAt !== null && now >= l.wakeAt);
    if (!due) continue;
    const view = engine.view(sessionId);
    l.revision = engine.revision;
    l.wakeAt = view.wakeAt;
    const components = toDiscord(view.message);
    const json = JSON.stringify(components);
    if (json === l.json) continue;
    l.busy = true;
    try {
      await l.message.edit({ components: components as never });
      l.json = json;
    } catch (e: unknown) {
      const code = (e as { code?: number }).code;
      if (code === 10008 || code === 50001 || code === 50013) live.delete(sessionId); // message supprimé / accès perdu
      else console.warn('Actualisation différée :', (e as Error).message);
    } finally {
      l.busy = false;
    }
  }
  persist();
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 32);

function commandDefinitions() {
  const defs = world.buildings.map((b) =>
    new SlashCommandBuilder()
      .setName(slug(b.id))
      .setDescription(`Entrer : ${b.name}`.slice(0, 100))
      .setDMPermission(false),
  );
  const admin = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Outils de test du monde (administrateurs)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('variable')
        .setDescription('Changer une variable du monde (ex. phase du scénario)')
        .addStringOption((o) =>
          o.setName('variable').setDescription('Variable').setRequired(true).addChoices(...world.variables.slice(0, 25).map((v) => ({ name: v.name, value: v.id }))),
        )
        .addStringOption((o) => o.setName('valeur').setDescription('Nouvelle valeur').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('metier')
        .setDescription('Définir son métier actif')
        .addStringOption((o) =>
          o
            .setName('metier')
            .setDescription('Métier')
            .setRequired(true)
            .addChoices({ name: 'Aucun métier', value: '-' }, ...world.jobs.slice(0, 24).map((j) => ({ name: j.name, value: j.id }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('niveau')
        .setDescription('Définir son niveau dans un métier')
        .addStringOption((o) =>
          o.setName('metier').setDescription('Métier').setRequired(true).addChoices(...world.jobs.slice(0, 25).map((j) => ({ name: j.name, value: j.id }))),
        )
        .addIntegerOption((o) => o.setName('niveau').setDescription('Niveau').setRequired(true).setMinValue(1).setMaxValue(100)),
    );
  return [...defs, admin].map((d) => d.toJSON());
}

async function openBuilding(interaction: ChatInputCommandInteraction, buildingId: string) {
  const { sessionId, view } = engine.openSession(interaction.user.id, buildingId);
  const components = toDiscord(view.message);
  const response = await interaction.reply({ components: components as never, flags: COMPONENTS_V2_FLAG, withResponse: true });
  const message = response.resource?.message ?? (await interaction.fetchReply());
  live.set(sessionId, {
    message,
    json: JSON.stringify(components),
    revision: engine.revision,
    wakeAt: view.wakeAt,
    touchedAt: Date.now(),
    busy: false,
  });
  persist();
}

async function runAdmin(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const building = world.buildings[0]!.id;
  let summary = '';
  try {
    if (sub === 'variable') {
      const variable = interaction.options.getString('variable', true);
      const raw = interaction.options.getString('valeur', true);
      const def = world.variables.find((v) => v.id === variable);
      const value = typeof def?.initial === 'number' ? Number(raw) : raw;
      if (def?.options && !def.options.some((o) => o.value === value))
        throw new Error(`Valeurs possibles : ${def.options.map((o) => o.value).join(', ')}`);
      engine.adminApply(interaction.user.id, building, [{ type: 'variable.set', variable, value }]);
      summary = `🎭 ${def?.name ?? variable} → **${value}**`;
    } else if (sub === 'metier') {
      const job = interaction.options.getString('metier', true);
      const p = engine.player(interaction.user.id);
      const actions = (p?.activeJobs ?? []).map((j) => ({ type: 'job.leave' as const, job: j }));
      engine.adminApply(interaction.user.id, building, job === '-' ? actions : [...actions, { type: 'job.join', job }]);
      summary = `⚒️ Métier : **${job === '-' ? 'aucun' : world.jobs.find((j) => j.id === job)?.name}**`;
    } else if (sub === 'niveau') {
      const job = interaction.options.getString('metier', true);
      const level = interaction.options.getInteger('niveau', true);
      engine.adminApply(interaction.user.id, building, [{ type: 'job.setLevel', job, level }]);
      summary = `⭐ Niveau ${world.jobs.find((j) => j.id === job)?.name} : **${level}**`;
    }
    persist();
    await interaction.reply({ content: `${summary}\n*Les interfaces ouvertes se mettent à jour automatiquement.*`, flags: 64 });
  } catch (e) {
    await interaction.reply({ content: `⚠️ ${(e as Error).message}`, flags: 64 });
  }
}

async function onComponent(interaction: MessageComponentInteraction) {
  if (!interaction.customId.includes('|')) return;
  const values = interaction.isStringSelectMenu() ? interaction.values : [];
  const result = engine.interact(interaction.user.id, interaction.customId, values);
  persist();
  if (!result.message) {
    await interaction.reply({ content: result.private ?? 'Action impossible.', flags: 64 });
    return;
  }
  const sessionId = interaction.customId.split('|')[0]!;
  const components = toDiscord(result.message);
  const l = live.get(sessionId);
  if (l) l.busy = true;
  try {
    await interaction.update({ components: components as never });
  } finally {
    const view = engine.view(sessionId);
    live.set(sessionId, {
      message: interaction.message,
      json: JSON.stringify(components),
      revision: engine.revision,
      wakeAt: view.wakeAt,
      touchedAt: Date.now(),
      busy: false,
    });
  }
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Connecté : ${c.user.tag} — monde « ${world.name} » (${world.buildings.length} bâtiment(s))`);
  const defs = commandDefinitions();
  if (GUILD_ID) await (await c.guilds.fetch(GUILD_ID)).commands.set(defs);
  else await c.application.commands.set(defs);
  console.log(`   Commandes : ${defs.map((d) => '/' + d.name).join(' ')}${GUILD_ID ? ' (serveur de test)' : ' (globales, propagation jusqu’à 1 h)'}`);
  setInterval(() => void refreshAll().catch((e) => console.error(e)), TICK_MS);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'admin') return await runAdmin(interaction);
      const building = world.buildings.find((b) => slug(b.id) === interaction.commandName);
      if (building) return await openBuilding(interaction, building.id);
    } else if (interaction.isMessageComponent()) {
      return await onComponent(interaction);
    }
  } catch (e) {
    console.error('Erreur d’interaction :', e);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred)
      await interaction.reply({ content: '⚠️ Erreur inattendue. Réessaie.', flags: 64 }).catch(() => {});
  }
});

const shutdown = () => {
  persist();
  void client.destroy().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(TOKEN);
