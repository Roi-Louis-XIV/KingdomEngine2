/** Mixeur des Voice Workers : l'ambiance continue pendant les répliques, qui s'enchaînent sans se couper. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FRAME_BYTES, Mixer, clip, mixInto } from '../src/voice/mixer.ts';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('mixage : addition avec volume, écrêtage sans déborder', () => {
  const acc = new Int32Array(4);
  mixInto(acc, Int16Array.from([1000, -1000, 30000, -30000]), 1);
  mixInto(acc, Int16Array.from([500, 500, 30000, -30000]), 0.5);
  assert.deepEqual([...clip(acc)], [1250, -750, 32767, -32768]);
});

/** Un son de test : une note pure (amplitude ~0,3) de la durée voulue. */
function tone(dir: string, name: string, freq: number, seconds: number) {
  const path = join(dir, `${name}.wav`);
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`, '-y', path]);
  return path;
}
/** Énergie moyenne d'une trame (0 = silence). */
const level = (b: Buffer) => {
  const s = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
  let sum = 0;
  for (const x of s) sum += Math.abs(x);
  return sum / s.length;
};
async function frames(m: Mixer, n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(level(m.nextFrame()));
    if (i % 10 === 0) await wait(2); // laisse ffmpeg décoder
  }
  return out;
}

test('mixeur : ambiance en boucle + réplique par-dessus, puis la suivante, puis l’ambiance seule', { skip: !hasFfmpeg && 'ffmpeg absent' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mix-'));
  const amb = tone(dir, 'amb', 220, 0.5); // courte : prouve la boucle
  const a = tone(dir, 'a', 440, 0.4);
  const b = tone(dir, 'b', 660, 0.4);
  const m = new Mixer(FFMPEG);
  t.after(() => m.destroy());
  assert.equal(level(m.nextFrame()), 0, 'silence tant qu’il n’y a rien');
  m.setAmbience(amb, 1);
  await wait(300);
  const ambOnly = (await frames(m, 20)).reduce((x, y) => x + y) / 20;
  assert.ok(ambOnly > 1000, `ambiance audible (${ambOnly})`);
  m.say(a, 1);
  m.say(b, 1);
  assert.ok(m.speaking);
  await wait(300);
  const both = await frames(m, 15);
  assert.ok(both.every((x) => x > ambOnly * 1.15), 'réplique mixée par-dessus l’ambiance, sans la couper');
  // 0,4 s + 0,4 s de répliques = 40 trames : après ~60 trames, il ne reste que l'ambiance (bouclée au-delà de 0,5 s).
  await frames(m, 60);
  assert.equal(m.speaking, false, 'les deux répliques sont passées');
  const after = await frames(m, 20);
  assert.ok(after.every((x) => x > 1000 && x < ambOnly * 1.3), 'l’ambiance continue seule, en boucle');
  m.destroy();
  assert.equal(FRAME_BYTES, 3840);
});

test('mixeur sans ambiance : le flux s’arrête après la dernière réplique (le PNJ ne « parle » que quand il parle)', { skip: !hasFfmpeg && 'ffmpeg absent' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mix-'));
  const m = new Mixer(FFMPEG);
  t.after(() => m.destroy());
  m.endWhenIdle = true;
  m.say(tone(dir, 'r', 330, 0.2), 1);
  let bytes = 0;
  const ended = new Promise<void>((resolve) => m.on('end', resolve));
  m.on('data', (b: Buffer) => (bytes += b.length));
  await Promise.race([ended, wait(3000)]);
  assert.ok(m.readableEnded, 'flux terminé');
  assert.ok(bytes >= FRAME_BYTES * 8, `la réplique a été jouée (${bytes} octets)`);
});
