# Force Calculation · Servidor MCP

Servidor [MCP](https://modelcontextprotocol.io) que expone el motor de cálculo de Force Calculation
(`../src/calc`) a Claude u otro cliente MCP: cargas de viento y sismo según el **REP-2021 de Panamá**
(ASCE/SEI 7-05). Se calcula todo localmente y no necesita conexión a internet.

## Instalación en Claude Desktop

1. Descargue [`release/force-calculation.mcpb`](release/force-calculation.mcpb).
2. Haga doble clic en el archivo, o arrástrelo a Claude Desktop → **Configuración → Extensiones**.
3. Pulse **Instalar**. Claude Desktop trae su propio Node.js, así que no hace falta instalar nada más.

## Instalación en Claude Code u otro cliente

Desempaquete el `.mcpb` (es un ZIP; la carpeta `server/` debe quedar completa), o compile desde el código (ver abajo), y registre el servidor:

```bash
claude mcp add force-calculation -- node /ruta/a/server/index.js
```

Para un archivo de configuración JSON (`mcpServers`):

```json
{ "mcpServers": { "force-calculation": { "command": "node", "args": ["/ruta/a/server/index.js"] } } }
```

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `forcecalc_compute` | Cálculo completo de viento y sismo de una tipología: edificio, nave, torre, tanque, valla o genérico. Con `lat`/`lon` lee Ss y S1 de los mapas REP. |
| `forcecalc_generate_report` | Memoria de cálculo en **Word (.docx)** y **PDF** (o HTML), con el mismo contenido y formato que exporta la app. Acepta los mismos datos que `forcecalc_compute` más `meta` (cliente, ingeniero, idoneidad, fecha, notas). |
| `forcecalc_describe_inputs` | Campos de entrada de cada tipología, con unidades, valores por defecto y opciones. |
| `forcecalc_lookup_ss_s1` | Ss y S1 de los mapas de aceleraciones espectrales del REP (§5.12). |
| `forcecalc_seismic_parameters` | Fa, Fv, SDS, SD1, T0, Ts, TL, I, categoría de diseño sísmico y Sa(T). |
| `forcecalc_wind_pressure` | V de la Tabla 4.1 y perfil qz = 0.613·Kz·Kzt·Kd·V²·I. |
| `forcecalc_list_systems` | Sistemas de las Tablas 12.2-1 y 15.4-2, con R, Ω0, Cd y restricciones NP. |

Cada herramienta acepta `response_format`: `markdown`, un resumen con tablas, o `json`, el resultado
completo del motor con combinaciones LRFD/ASD, envolvente por cara y geometría.

## Reporte Word / PDF

- Se genera con los mismos módulos de la app (`src/renderer/report-model.js`, `src/report/docx.js` y `src/report/html.js`),
  así que el contenido coincide con el reporte que exporta la app: parámetros sísmicos, fuerzas por nivel, viento, envolvente por cara,
  combinaciones, observaciones y bloque de firma.
- Figuras incluidas: **vistas 3D del modelo** (una por caso de carga: viento y sismo en cada dirección, más la envolvente de presiones
  por cara), espectro de diseño, perfiles de fuerzas por nivel y, si el sitio se da por coordenadas, recortes de los mapas Ss y S1.
- Las vistas 3D se capturan con el mismo visor de la app (`src/renderer/viewer3d.js`, three.js) dentro de Microsoft Edge (incluido en
  Windows), Google Chrome o Chromium sin interfaz, con WebGL por software (no requiere tarjeta gráfica). El mismo navegador imprime
  el **PDF** con el pie de página de la app. Se controla por el protocolo DevTools (`--remote-debugging-pipe`), sin dependencias extra.
- Si no hay navegador, el Word se genera igual sin vistas 3D y se avisa. La ruta del navegador se puede indicar en la configuración
  de la extensión. `include_3d_views: false` omite las vistas.
- Los archivos se guardan en `Documentos/Force Calculation` (configurable en la extensión o con `output_dir`) y nunca se sobrescriben:
  un nombre repetido se guarda como `nombre (2).docx`.

Variables de entorno, para clientes distintos de Claude Desktop: `FORCECALC_OUTPUT_DIR` (carpeta de reportes) y `FORCECALC_BROWSER`
(ruta de Edge/Chrome).

Ejemplo de pedido a Claude: _"Calcula viento y sismo para un edificio de 8 pisos de pórticos
especiales de concreto en Colón (9.36, −79.90), suelo clase C, exposición D, y genera la memoria en Word y PDF
a nombre del Ing. Pérez."_

## Desarrollo

```bash
npm install
npm run build     # chequeo de tipos + dist/ (index.js, viewer-bundle.js, fuentes, resvg.wasm, mapas)
npm run smoke     # prueba el servidor compilado con un cliente MCP real
npm run pack      # genera release/force-calculation.mcpb
```

El servidor importa directamente `../src/calc`, `../src/report` y `../src/renderer/{forms,report-model,charts}.js`;
`dist/viewer-bundle.js` empaqueta `../src/renderer/viewer3d.js` con three.js para el navegador.
Después de cambiar el motor de cálculo o el reporte de la app, ejecute `npm run pack` para regenerar el paquete.
