import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRendered } from '../../../packages/engine/src/index.ts';
import {
  PLAYER_ACCESS,
  PermissionFlagsBits as P,
  buildingOfVoice,
  enterCustomId,
  entrancePanel,
  panelCleanup,
  panelMarker,
  parseEnter,
  reconcileAccess,
  textChannelBase,
  voiceMove,
} from '../src/discord/access.ts';
import { toDiscord } from '../src/discord/render.ts';
import { loadWorld, makeEngine } from '../../../packages/engine/test/harness.ts';

const channels = { taverne: { text: 't1', voice: 'v1' }, foret: { text: 't2', voice: 'v2' } };

test('le bouton d’entrée porte un identifiant sans état, distinct des interfaces', () => {
  assert.equal(parseEnter(enterCustomId('taverne')), 'taverne');
  assert.equal(parseEnter('abc|b|home|0'), null);
  assert.equal(parseEnter('ke:enter|'), null);
});

test('panneau d’entrée : nom, texte, bouton Entrer et repère, dans les limites Discord', () => {
  const world = loadWorld();
  for (const b of world.buildings) {
    const panel = entrancePanel(b);
    assert.deepEqual(validateRendered(panel), []);
    const json = JSON.stringify(toDiscord(panel));
    assert.ok(json.includes(b.name));
    assert.ok(json.includes(enterCustomId(b.id)));
    assert.ok(json.includes(panelMarker(b.id)));
  }
  const custom = JSON.stringify(entrancePanel({ id: 'x', name: 'X', entrance: { text: 'Pousse la porte.', button: 'Pousser', buttonEmoji: '🍺' } }));
  assert.ok(custom.includes('Pousse la porte.') && custom.includes('Pousser') && custom.includes('🍺'));
});

test('seul le salon vocal d’un bâtiment donne accès à son salon texte', () => {
  assert.equal(buildingOfVoice(channels, 'v2'), 'foret');
  assert.equal(buildingOfVoice(channels, 't1'), null);
  assert.deepEqual(voiceMove(channels, null, 'v1'), { left: null, joined: 'taverne' });
  assert.deepEqual(voiceMove(channels, 'v1', 'v2'), { left: 'taverne', joined: 'foret' });
  assert.deepEqual(voiceMove(channels, 'v1', null), { left: 'taverne', joined: null });
  assert.deepEqual(voiceMove(channels, 'v1', 'v1'), { left: null, joined: null });
  assert.deepEqual(voiceMove(channels, 'autre', null), { left: null, joined: null });
});

test('salon texte : caché à tous, personne n’écrit, le joueur présent peut lire', () => {
  const [everyone, bot] = textChannelBase('guild', 'bot');
  assert.ok(everyone!.deny & P.ViewChannel);
  assert.ok(everyone!.deny & P.SendMessages);
  assert.ok(bot!.allow & P.SendMessages && bot!.allow & P.ManageMessages);
  assert.ok(PLAYER_ACCESS.allow & P.ViewChannel && PLAYER_ACCESS.allow & P.ReadMessageHistory);
  assert.ok(PLAYER_ACCESS.deny & P.SendMessages && PLAYER_ACCESS.deny & P.UseApplicationCommands);
  assert.equal(PLAYER_ACCESS.allow & PLAYER_ACCESS.deny, 0n);
});

test('après un redémarrage, les accès suivent les joueurs réellement présents', () => {
  assert.deepEqual(reconcileAccess({ granted: ['a', 'b', 'bot'], present: ['b', 'c'], botId: 'bot' }), { grant: ['c'], revoke: ['a'] });
  assert.deepEqual(reconcileAccess({ granted: [], present: [], botId: 'bot' }), { grant: [], revoke: [] });
});

test('nettoyage : un seul message reste, le panneau du bâtiment', () => {
  const msgs = [
    { id: 'm4', authorId: 'joueur', text: 'coucou' },
    { id: 'm3', authorId: 'bot', text: `… ${panelMarker('taverne')}` },
    { id: 'm2', authorId: 'bot', text: 'tape /taverne pour entrer' },
    { id: 'm1', authorId: 'bot', text: `… ${panelMarker('taverne')}` },
  ];
  assert.deepEqual(panelCleanup(msgs, { botId: 'bot', buildingId: 'taverne', knownPanelId: 'm1' }), { keep: 'm1', remove: ['m4', 'm3', 'm2'] });
  assert.deepEqual(panelCleanup(msgs, { botId: 'bot', buildingId: 'taverne', knownPanelId: 'disparu' }), { keep: 'm3', remove: ['m4', 'm2', 'm1'] });
  assert.deepEqual(panelCleanup(msgs, { botId: 'bot', buildingId: 'foret' }), { keep: null, remove: ['m4', 'm3', 'm2', 'm1'] });
});

test('quitter le bâtiment ferme les interfaces du joueur : au retour, on repart de l’entrée', () => {
  const { engine } = makeEngine();
  const a = engine.openSession('louis', 'taverne').sessionId;
  const b = engine.openSession('louis', 'taverne').sessionId;
  const other = engine.openSession('marie', 'taverne').sessionId;
  assert.deepEqual(engine.session(a), { player: 'louis', building: 'taverne' });
  assert.deepEqual(engine.closeSessionsOf('louis', 'taverne').sort(), [a, b].sort());
  assert.equal(engine.session(a), undefined);
  assert.ok(engine.session(other));
  assert.equal(engine.interact('louis', `${a}|b|home|0`).ok, false);
});
