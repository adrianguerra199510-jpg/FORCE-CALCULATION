import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const c = new Client({ name: 's', version: '1' });
await c.connect(new StdioClientTransport({ command: 'node', args: ['dist/index.js'], env: { ...process.env, FORCECALC_OUTPUT_DIR: process.argv[2] } }));
const r = await c.callTool({ name: 'forcecalc_generate_report', arguments: {
  typology: 'edificio', site: { lat: 9.36, lon: -79.9, siteClass: 'C' }, wind: { region: 'Atlantico', exposure: 'D' },
  structure: { nStories: 8 }, meta: { nombre: 'Edificio Colón', cliente: 'Cliente de prueba', ingeniero: 'Ing. Prueba', idoneidad: '0000-000-000' },
  formats: ['docx', 'pdf', 'html'] } });
console.log(r.isError ? 'ERROR' : 'OK', r.content[0].text);
await c.close();
