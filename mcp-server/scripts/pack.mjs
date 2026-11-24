// Arma la carpeta del paquete y genera release/force-calculation.mcpb (extensión para Claude Desktop).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

rmSync('bundle', { recursive: true, force: true });
mkdirSync('release', { recursive: true });
cpSync('dist', 'bundle/server', { recursive: true }); // index.js + grid.json + resvg.wasm + fonts/ + sheets/
cpSync('manifest.json', 'bundle/manifest.json');
cpSync('../build/icon.png', 'bundle/icon.png');
execFileSync('npx', ['mcpb', 'validate', 'bundle/manifest.json'], { stdio: 'inherit' });
execFileSync('npx', ['mcpb', 'pack', 'bundle', 'release/force-calculation.mcpb'], { stdio: 'inherit' });
