// Mixe la séquence d'horreur de la fin de la bêta en UN seul fichier, joué en même temps dans tous les lieux :
//   1. un gros grondement monte de la montagne ;
//   2. les PNJ réagissent l'un après l'autre, en se chevauchant légèrement (assez pour rester compréhensibles) :
//      Roland d'abord (« Il est revenu ! »), puis Maëlis, Edgar, Agathe, Wagner, Sylvain, Anselme ;
//   3. le cri du monstre tombe aussitôt, le grondement se coupe net ;
//   4. silence (géré par le scénario), puis musique d'attente et message du narrateur.
// Le monde n'avance que toutes les 5 s : impossible de décaler des répliques d'une seconde une par une, d'où le mixage.
//
// Usage : node scripts/content/sainte-pelle-finale.mjs   (ffmpeg requis ; à relancer si une voix est réenregistrée)
// Produit : content/sainte-pelle/sons/finale-apocalypse.mp3 et finale-apocalypse.json (durée, début du cri).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SONS = new URL('../../content/sainte-pelle/sons/', import.meta.url).pathname;
const VOICES = ['roland-il-est-revenu', 'maelis-panique', 'edgar-panique', 'agathe-panique', 'wagner-panique', 'sylvain-panique', 'anselme-panique'];
const PAN = [0, -0.35, 0.35, -0.25, 0.25, -0.4, 0.4]; // voix réparties à gauche et à droite : on distingue qui parle
const RUMBLE_PEAK = 3.6; // le grondement culmine avant la première réplique
const NEXT = 0.72; // la réplique suivante commence aux 72 % de la précédente (~1 s de chevauchement)
const CRY_OVERLAP = 0.4; // le cri coupe la dernière réplique de 0,4 s

const tmp = mkdtempSync(join(tmpdir(), 'finale-'));
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const duration = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// Voix : silences du début et de la fin retirés, volume harmonisé (−16 LUFS), stéréo.
const voices = VOICES.map((key, i) => {
  const out = join(tmp, `${key}.wav`);
  ff(['-i', join(SONS, `${key}.mp3`), '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-2:LRA=11', '-ar', '48000', '-ac', '2', out]);
  return { key, file: out, dur: duration(out), pan: PAN[i] };
});
let at = RUMBLE_PEAK;
for (const v of voices) {
  v.at = at;
  at += v.dur * NEXT;
}
const last = voices.at(-1);
const cryAt = last.at + last.dur - CRY_OVERLAP;
const cry = join(tmp, 'cri.wav');
ff(['-i', join(SONS, 'monstre-cri.mp3'), '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-12:TP=-1:LRA=11', '-ar', '48000', '-ac', '2', cry]);
const total = cryAt + duration(cry);

// Grondement : bruit brun très grave + infra-basse qui ondule ; monte, gronde sous les voix, se coupe au cri.
const rumble = join(tmp, 'grondement.wav');
ff([
  '-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.9:duration=${cryAt.toFixed(2)}:seed=7`,
  '-f', 'lavfi', '-i', `sine=frequency=38:duration=${cryAt.toFixed(2)}`,
  '-f', 'lavfi', '-i', `sine=frequency=55:duration=${cryAt.toFixed(2)}`,
  '-filter_complex',
  `[0]lowpass=f=140,lowpass=f=140,volume=2.2[n];[1]volume=0.55,tremolo=f=3:d=0.6[s1];[2]volume=0.25,tremolo=f=5.5:d=0.5[s2];` +
    `[n][s1][s2]amix=inputs=3:normalize=0,` +
    // monte jusqu'au pic, puis redescend sous les voix (−9 dB) sans s'éteindre
    `volume='if(lt(t,${RUMBLE_PEAK}),pow(t/${RUMBLE_PEAK},1.6),if(lt(t,${RUMBLE_PEAK + 1.5}),1-0.65*(t-${RUMBLE_PEAK})/1.5,0.35))':eval=frame,` +
    `afade=t=in:d=0.3,aformat=channel_layouts=stereo,alimiter=limit=0.8`,
  '-ar', '48000', rumble,
]);

// Mixage final.
const inputs = [rumble, ...voices.map((v) => v.file), cry];
const filters = [
  '[0]volume=1.0[g]',
  ...voices.map((v, i) => `[${i + 1}]pan=stereo|c0=${(1 - Math.max(0, v.pan)).toFixed(2)}*c0|c1=${(1 + Math.min(0, v.pan)).toFixed(2)}*c1,adelay=${Math.round(v.at * 1000)}:all=1[v${i}]`),
  `[${voices.length + 1}]adelay=${Math.round(cryAt * 1000)}:all=1[c]`,
  `[g]${voices.map((_, i) => `[v${i}]`).join('')}[c]amix=inputs=${voices.length + 2}:normalize=0:duration=longest,alimiter=limit=0.95,atrim=0:${total.toFixed(2)}[out]`,
];
const out = join(SONS, 'finale-apocalypse.mp3');
ff([...inputs.flatMap((f) => ['-i', f]), '-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '192k', out]);
const timeline = { duration: Number(total.toFixed(2)), cry: Number(cryAt.toFixed(2)), voices: voices.map((v) => ({ key: v.key, at: Number(v.at.toFixed(2)) })) };
writeFileSync(join(SONS, 'finale-apocalypse.json'), JSON.stringify(timeline, null, 2) + '\n');
rmSync(tmp, { recursive: true, force: true });
console.log(timeline);
