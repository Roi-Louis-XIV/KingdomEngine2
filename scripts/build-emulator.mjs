// Construit apps/emulator/dist/index.html : une page autonome qui embarque le moteur
// (compilé depuis packages/engine/src) et un monde JSON. Aucune dépendance réseau.
// Usage : node scripts/build-emulator.mjs [chemin/du/world.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const worldPath = resolve(process.argv[2] ?? join(root, 'content/le-royaume/world.json'));
const ORDER = ['model', 'state', 'components', 'rules', 'widgets', 'engine', 'validate'];

const parts = ORDER.map((name) => {
  const src = readFileSync(join(root, 'packages/engine/src', `${name}.ts`), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  js = js
    .replace(/^import [\s\S]*?;\s*$/gm, '')
    .replace(/^export \{[^}]*\};?\s*$/gm, '')
    .replace(/^export (default )?/gm, '');
  return `// ---- ${name}.ts\n${js}`;
});

const world = readFileSync(worldPath, 'utf8');
JSON.parse(world); // validation de syntaxe
const html = readFileSync(join(root, 'apps/emulator/template.html'), 'utf8')
  .replace('/*__ENGINE__*/', () => parts.join('\n'))
  .replace('/*__WORLD__*/null', () => world.replace(/<\/script/gi, '<\\/script'));

mkdirSync(join(root, 'apps/emulator/dist'), { recursive: true });
const out = join(root, 'apps/emulator/dist/index.html');
writeFileSync(out, html);
console.log(`Émulateur généré : ${out} (${Math.round(html.length / 1024)} Ko)`);
