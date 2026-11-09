import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDiscord } from '../src/discord-render.ts';
import { Player, makeEngine } from '../../../packages/engine/test/harness.ts';

test('conversion en Components V2 (types et champs de l’API Discord)', () => {
  const { engine } = makeEngine();
  const p = new Player(engine, 'alice');
  p.click('Boissons');
  const payload = toDiscord(p.message) as any[];
  const types = new Set<number>();
  const visit = (c: any) => {
    types.add(c.type);
    (c.components ?? []).forEach(visit);
    if (c.accessory) visit(c.accessory);
  };
  payload.forEach(visit);
  for (const t of [17, 10, 1, 3, 2]) assert.ok(types.has(t), `type ${t} présent`);
  const container = payload.find((c) => c.type === 17);
  assert.equal(typeof container.accent_color, 'number');
  const selectRow = payload.find((c) => c.type === 1 && c.components[0].type === 3);
  const opt = selectRow.components[0].options[0];
  assert.ok(opt.label && opt.value);
  assert.ok(selectRow.components[0].custom_id.length <= 100);
});
