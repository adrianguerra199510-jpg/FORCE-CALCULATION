// Empaqueta el servidor y los módulos de la app (cálculo + reporte) en dist/index.js,
// y copia junto a él los recursos que se leen en tiempo de ejecución.
import { build } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/fonts', { recursive: true });

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  legalComments: 'none',
  // Los módulos de la app (../src) importan 'docx'; se resuelve desde las dependencias de este paquete.
  nodePaths: ['node_modules'],
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __fu } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      'const require = __cr(import.meta.url);',
      'const __filename = __fu(import.meta.url);',
      'const __dirname = __dn(__filename);',
    ].join(' '),
  },
});

/** WOFF 1.0 → TTF/OTF (resvg no lee WOFF). */
function woffToSfnt(woff) {
  if (woff.readUInt32BE(0) !== 0x774f4646) throw new Error('No es un archivo WOFF');
  const flavor = woff.readUInt32BE(4);
  const n = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const [tag, off, comp, orig, sum] = [0, 4, 8, 12, 16].map((k) => woff.readUInt32BE(o + k));
    const raw = woff.subarray(off, off + comp);
    tables.push({ tag, sum, data: comp < orig ? inflateSync(raw) : raw });
  }
  const pow = 2 ** Math.floor(Math.log2(n));
  const head = Buffer.alloc(12 + 16 * n);
  head.writeUInt32BE(flavor, 0);
  head.writeUInt16BE(n, 4);
  head.writeUInt16BE(pow * 16, 6);
  head.writeUInt16BE(Math.log2(pow), 8);
  head.writeUInt16BE(n * 16 - pow * 16, 10);
  const chunks = [head];
  let offset = head.length;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    head.writeUInt32BE(t.tag, r);
    head.writeUInt32BE(t.sum, r + 4);
    head.writeUInt32BE(offset, r + 8);
    head.writeUInt32BE(t.data.length, r + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    chunks.push(t.data, Buffer.alloc(pad));
    offset += t.data.length + pad;
  });
  return Buffer.concat(chunks);
}

const fs = 'node_modules/@fontsource';
for (const [pkg, short] of [['barlow', 'barlow'], ['barlow-semi-condensed', 'barlow-sc']]) {
  for (const w of [400, 500, 600, 700]) {
    const f = `${fs}/${pkg}/files/${pkg}-latin-${w}-normal`;
    try { copyFileSync(`${f}.woff2`, `dist/fonts/${pkg}-latin-${w}-normal.woff2`); } catch { continue; }
    if (w === 400 || w === 600) writeFileSync(`dist/fonts/${short}-${w}.ttf`, woffToSfnt(readFileSync(`${f}.woff`)));
  }
}
copyFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm', 'dist/resvg.wasm');
copyFileSync('../src/data/rep-maps/grid.json', 'dist/grid.json');
cpSync('../src/data/rep-maps/sheets', 'dist/sheets', { recursive: true });
console.log('dist/ listo: index.js, grid.json, resvg.wasm, fonts/, sheets/');
