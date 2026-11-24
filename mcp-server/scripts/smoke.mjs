// Prueba del servidor compilado: lo lanza por stdio, llama cada herramienta y sale con error si algo falla.
import { strict as assert } from 'node:assert';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entry = process.argv[2] ?? 'dist/index.js';
const client = new Client({ name: 'smoke', version: '1.0.0' });
const outDir = mkdtempSync(join(tmpdir(), 'fc-smoke-'));
await client.connect(new StdioClientTransport({
  command: 'node', args: [entry],
  env: { ...getDefaultEnvironment(), FORCECALC_OUTPUT_DIR: outDir, FORCECALC_BROWSER: process.env.FORCECALC_BROWSER ?? '' },
}));

const { tools } = await client.listTools();
assert.deepEqual(tools.map((t) => t.name).sort(), [
  'forcecalc_compute', 'forcecalc_describe_inputs', 'forcecalc_generate_report', 'forcecalc_list_systems',
  'forcecalc_lookup_ss_s1', 'forcecalc_seismic_parameters', 'forcecalc_wind_pressure',
]);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`);
  return r;
};
const txt = (r) => r.content[0].text;

// Ss/S1 en Ciudad de Panamá
const m = await call('forcecalc_lookup_ss_s1', { lat: 8.98, lon: -79.52 });
assert.ok(m.structuredContent.Ss > 0 && m.structuredContent.S1 > 0);

// Parámetros sísmicos: mismo caso que test/calc.test.mjs
const sp = await call('forcecalc_seismic_parameters', { Ss: 1.0, S1: 0.4, siteClass: 'D', response_format: 'json' });
assert.ok(Math.abs(sp.structuredContent.params.SDS - 0.7333) < 1e-3);
assert.equal(sp.structuredContent.params.sdc, 'D');

// Viento: V de la Tabla 4.1
const wp = await call('forcecalc_wind_pressure', { region: 'Atlantico', exposure: 'C', heights: [10], response_format: 'json' });
assert.ok(Math.abs(wp.structuredContent.ctx.Vkmh - 150.8) < 1e-6);

// Todas las tipologías con valores por defecto, en markdown y json
for (const typology of ['edificio', 'nave', 'torre', 'tanque', 'valla', 'generico']) {
  const md = await call('forcecalc_compute', { typology });
  assert.match(txt(md), /## Sismo/);
  assert.match(txt(md), /## Viento/);
  const js = await call('forcecalc_compute', { typology, response_format: 'json' });
  assert.equal(js.structuredContent.result.typology, typology);
  await call('forcecalc_describe_inputs', { typology });
}

// Edificio con sitio por coordenadas y datos propios
const ed = await call('forcecalc_compute', {
  typology: 'edificio', site: { lat: 9.36, lon: -79.9, siteClass: 'C' },
  wind: { region: 'Atlantico', exposure: 'D' }, structure: { nStories: 10, systemX: 'C5', systemY: 'D3' },
  response_format: 'json',
});
assert.equal(ed.structuredContent.result.levels.length, 10);
assert.equal(ed.structuredContent.input.site.source, 'mapa');

// Genérico con un volumen parcial
await call('forcecalc_compute', { typology: 'generico', structure: { volumes: [{ shape: 'cyl', bx: 5, h: 10, z0: 0, nCols: 0, roof: 'plano' }] } });

await call('forcecalc_list_systems', { kind: 'edificio' });

// Errores legibles
const bad = await client.callTool({ name: 'forcecalc_compute', arguments: { typology: 'nave', structure: { pisos: 3 } } });
assert.equal(bad.isError, true);
assert.match(bad.content[0].text, /Claves válidas/);
const out = await client.callTool({ name: 'forcecalc_lookup_ss_s1', arguments: { lat: 8.98, lon: 79.52 } });
assert.equal(out.isError, true);

// Reporte Word para cada tipología (sin navegador) y Word + PDF de un edificio con mapas
const paths = (r) => [...txt(r).matchAll(/`([^`]+\.(?:docx|pdf|html))`/g)].map((m) => m[1]);
for (const typology of ['edificio', 'nave', 'torre', 'tanque', 'valla', 'generico']) {
  const r = await call('forcecalc_generate_report', { typology, formats: ['docx'], include_3d_views: typology !== 'edificio', meta: { nombre: `Prueba ${typology}` } });
  const [docx] = paths(r);
  assert.ok(docx && existsSync(docx), `${typology}: no se creó el docx`);
  assert.equal(readFileSync(docx).subarray(0, 2).toString(), 'PK', `${typology}: docx inválido`);
}
const full = await call('forcecalc_generate_report', {
  typology: 'edificio', site: { lat: 9.36, lon: -79.9 }, meta: { nombre: 'Prueba PDF', ingeniero: 'Ing. Prueba' }, formats: ['docx', 'pdf'],
});
assert.match(txt(full), /mapa Ss-\d+/);
const pdf = paths(full).find((p) => p.endsWith('.pdf'));
if (pdf) {
  assert.equal(readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
  // con navegador también deben venir las vistas 3D (4 casos + envolvente en un edificio)
  assert.match(txt(full), /vista 3D Viento X, vista 3D Viento Y, vista 3D Sismo X, vista 3D Sismo Y, vista 3D de la envolvente/);
  assert.doesNotMatch(txt(full), /No se pudo generar todo/);
} else console.error('Aviso: no hay navegador para el PDF en este equipo:', txt(full).split('\n').find((l) => l.startsWith('- PDF')));
// No sobrescribe: el segundo reporte con el mismo nombre se guarda como "(2)"
const again = await call('forcecalc_generate_report', { typology: 'nave', formats: ['docx'], meta: { nombre: 'Prueba nave' } });
assert.match(paths(again)[0], /\(2\)\.docx$/);

const res = await client.readResource({ uri: 'forcecalc://rep2021' });
assert.match(res.contents[0].text, /REP-2021/);

await client.close();
rmSync(outDir, { recursive: true, force: true });
console.error('Smoke test OK');
