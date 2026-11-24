// Empaqueta el servidor y el motor de cálculo de la app en un único archivo dist/index.js.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
copyFileSync('../src/data/rep-maps/grid.json', 'dist/grid.json');
console.log('dist/index.js + dist/grid.json listos');
