// Arma la carpeta del paquete y genera release/force-calculation.mcpb (extensión para Claude Desktop).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

rmSync('bundle', { recursive: true, force: true });
mkdirSync('bundle/server', { recursive: true });
mkdirSync('release', { recursive: true });
cpSync('manifest.json', 'bundle/manifest.json');
cpSync('../build/icon.png', 'bundle/icon.png');
cpSync('dist/index.js', 'bundle/server/index.js');
cpSync('dist/grid.json', 'bundle/server/grid.json');
execFileSync('npx', ['mcpb', 'validate', 'bundle/manifest.json'], { stdio: 'inherit' });
execFileSync('npx', ['mcpb', 'pack', 'bundle', 'release/force-calculation.mcpb'], { stdio: 'inherit' });
