// Compile le Studio (TypeScript → modules JS natifs) et copie ses fichiers statiques.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'apps/studio');
rmSync(join(studio, 'dist'), { recursive: true, force: true });
mkdirSync(join(studio, 'dist'), { recursive: true });
let tsc;
try {
  tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
} catch {
  console.error('TypeScript introuvable : lance « npm install » à la racine du projet.');
  process.exit(1);
}
execFileSync(process.execPath, [tsc, '-p', join(studio, 'tsconfig.json')], { stdio: 'inherit' });
cpSync(join(studio, 'index.html'), join(studio, 'dist/index.html'));
cpSync(join(studio, 'styles.css'), join(studio, 'dist/styles.css'));
cpSync(join(studio, 'assets'), join(studio, 'dist/assets'), { recursive: true });
console.log('Studio compilé dans apps/studio/dist');
