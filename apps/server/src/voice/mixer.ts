/**
 * Mixeur audio d'un Voice Worker : l'ambiance tourne en boucle et les répliques se jouent PAR-DESSUS,
 * sans la couper. Les répliques passent l'une après l'autre (un personnage ne parle pas en même temps que lui-même).
 *
 * Chaque son est décodé par ffmpeg en PCM 48 kHz stéréo 16 bits ; le mixeur additionne les échantillons
 * par trames de 20 ms et produit un flux brut que @discordjs/voice encode en Opus (StreamType.Raw).
 * Avec une ambiance, le flux ne s'arrête jamais. Sans ambiance (`endWhenIdle`), il s'arrête après la dernière
 * réplique : le personnage n'apparaît « en train de parler » sur Discord que lorsqu'il parle.
 */
import { Readable } from 'node:stream';
import { spawn, type ChildProcessByStdio } from 'node:child_process';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
/** Une trame de 20 ms : 960 échantillons × 2 canaux × 2 octets. */
export const FRAME_BYTES = (SAMPLE_RATE / 50) * CHANNELS * 2;
/** Au-delà d'une seconde d'avance, on met ffmpeg en pause (mémoire bornée). */
const MAX_BUFFER = SAMPLE_RATE * CHANNELS * 2;

/** Ajoute `src` (×gain) dans `acc` ; pur et testé. */
export function mixInto(acc: Int32Array, src: Int16Array, gain: number): void {
  const n = Math.min(acc.length, src.length);
  for (let i = 0; i < n; i++) acc[i]! += Math.round(src[i]! * gain);
}

/** Convertit l'accumulateur en échantillons 16 bits, en écrêtant. */
export function clip(acc: Int32Array): Int16Array {
  const out = new Int16Array(acc.length);
  for (let i = 0; i < acc.length; i++) out[i] = acc[i]! > 32767 ? 32767 : acc[i]! < -32768 ? -32768 : acc[i]!;
  return out;
}

/** Une piste : un fichier décodé par ffmpeg, lu au fil des trames. */
export class Track {
  private chunks: Buffer[] = [];
  private size = 0;
  private proc?: ChildProcessByStdio<null, Readable, null>;
  private done = false;
  readonly volume: number;

  constructor(ffmpeg: string, path: string, volume: number, loop: boolean) {
    this.volume = volume;
    const args = ['-hide_banner', '-loglevel', 'error', ...(loop ? ['-stream_loop', '-1'] : []), '-i', path, '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1'];
    try {
      this.proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      this.done = true;
      return;
    }
    this.proc.on('error', () => (this.done = true));
    this.proc.stdout.on('data', (b: Buffer) => {
      this.chunks.push(b);
      this.size += b.length;
      if (this.size > MAX_BUFFER) this.proc?.stdout.pause();
    });
    this.proc.stdout.on('end', () => (this.done = true));
  }

  /** Trame suivante (complétée de silence si le décodage est en retard), ou null si la piste est finie. */
  frame(): Int16Array | null {
    if (this.size === 0) return this.done ? null : new Int16Array(FRAME_BYTES / 2);
    const out = Buffer.alloc(FRAME_BYTES);
    let filled = 0;
    while (filled < FRAME_BYTES && this.chunks.length) {
      const c = this.chunks[0]!;
      const take = Math.min(c.length, FRAME_BYTES - filled);
      c.copy(out, filled, 0, take);
      filled += take;
      if (take === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(take);
    }
    this.size -= filled;
    if (this.size < MAX_BUFFER / 2) this.proc?.stdout.resume();
    return new Int16Array(out.buffer, out.byteOffset, FRAME_BYTES / 2);
  }

  get finished(): boolean {
    return this.done && this.size === 0;
  }

  stop(): void {
    this.done = true;
    this.chunks = [];
    this.size = 0;
    this.proc?.kill('SIGKILL');
  }
}

export class Mixer extends Readable {
  private ambience?: { path: string; track: Track };
  /** Répliques en file : toutes décodées d'avance (pas de blanc entre deux), seule la première est jouée. */
  private voices: Track[] = [];
  private readonly ffmpeg: string;
  /** Terminer le flux quand il n'y a plus ni ambiance ni réplique. */
  endWhenIdle = false;

  constructor(ffmpeg: string) {
    super({ highWaterMark: FRAME_BYTES * 5 });
    this.ffmpeg = ffmpeg;
  }

  /** Change l'ambiance en boucle (même fichier : rien ne change ; undefined : silence de fond). */
  setAmbience(path: string | undefined, volume: number): void {
    if (this.ambience?.path === path && this.ambience.track.volume === volume) return;
    this.ambience?.track.stop();
    this.ambience = path ? { path, track: new Track(this.ffmpeg, path, volume, true) } : undefined;
  }

  /** Réplique ou effet par-dessus l'ambiance ; s'il y en a déjà une, elle attend son tour (10 au plus). */
  say(path: string, volume: number): void {
    if (this.voices.length < 10) this.voices.push(new Track(this.ffmpeg, path, volume, false));
  }

  get speaking(): boolean {
    return this.voices.length > 0;
  }

  /** Trame mixée suivante (exposée pour les tests). */
  nextFrame(): Buffer {
    const acc = new Int32Array(FRAME_BYTES / 2);
    const amb = this.ambience?.track.frame();
    if (amb) mixInto(acc, amb, this.ambience!.track.volume);
    const v = this.voices[0];
    if (v) {
      const f = v.frame();
      if (f) mixInto(acc, f, v.volume);
      if (v.finished) this.voices.shift();
    }
    const out = clip(acc);
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  }

  get idle(): boolean {
    return !this.ambience && !this.voices.length;
  }

  override _read(): void {
    // Jamais en boucle synchrone : laisse ffmpeg livrer ses données entre deux trames.
    setImmediate(() => {
      if (this.destroyed) return;
      if (this.endWhenIdle && this.idle) this.push(null);
      else this.push(this.nextFrame());
    });
  }

  override _destroy(err: Error | null, cb: (e: Error | null) => void): void {
    this.ambience?.track.stop();
    this.voices.forEach((t) => t.stop());
    this.voices = [];
    cb(err);
  }
}
