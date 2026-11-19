// Copia las dependencias del navegador (Three.js) a src/renderer/vendor.
// electron-builder excluye las carpetas "examples" de node_modules al empaquetar,
// por eso OrbitControls se sirve desde una copia local. Se ejecuta en postinstall.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'renderer', 'vendor');
fs.mkdirSync(out, { recursive: true });
const files = {
  'three.module.js': 'node_modules/three/build/three.module.js',
  'OrbitControls.js': 'node_modules/three/examples/jsm/controls/OrbitControls.js',
};
for (const [dst, src] of Object.entries(files)) {
  fs.copyFileSync(path.join(root, src), path.join(out, dst));
}
console.log('vendor: Three.js copiado a src/renderer/vendor');
