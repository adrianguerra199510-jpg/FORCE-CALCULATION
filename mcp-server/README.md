# Force Calculation · Servidor MCP

Servidor [MCP](https://modelcontextprotocol.io) que expone el motor de cálculo de Force Calculation
(`../src/calc`) a Claude u otro cliente MCP: cargas de viento y sismo según el **REP-2021 de Panamá**
(ASCE/SEI 7-05). Se calcula todo localmente y no necesita conexión a internet.

## Instalación en Claude Desktop

1. Descargue [`release/force-calculation.mcpb`](release/force-calculation.mcpb).
2. Haga doble clic en el archivo, o arrástrelo a Claude Desktop → **Configuración → Extensiones**.
3. Pulse **Instalar**. Claude Desktop trae su propio Node.js, así que no hace falta instalar nada más.

## Instalación en Claude Code u otro cliente

Desempaquete el `.mcpb` (es un ZIP), o compile desde el código (ver abajo), y registre el servidor:

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
| `forcecalc_describe_inputs` | Campos de entrada de cada tipología, con unidades, valores por defecto y opciones. |
| `forcecalc_lookup_ss_s1` | Ss y S1 de los mapas de aceleraciones espectrales del REP (§5.12). |
| `forcecalc_seismic_parameters` | Fa, Fv, SDS, SD1, T0, Ts, TL, I, categoría de diseño sísmico y Sa(T). |
| `forcecalc_wind_pressure` | V de la Tabla 4.1 y perfil qz = 0.613·Kz·Kzt·Kd·V²·I. |
| `forcecalc_list_systems` | Sistemas de las Tablas 12.2-1 y 15.4-2, con R, Ω0, Cd y restricciones NP. |

Cada herramienta acepta `response_format`: `markdown`, un resumen con tablas, o `json`, el resultado
completo del motor con combinaciones LRFD/ASD, envolvente por cara y geometría.

Ejemplo de pedido a Claude: _"Calcula viento y sismo para un edificio de 8 pisos de pórticos
especiales de concreto en Colón (9.36, −79.90), suelo clase C, exposición D."_

## Desarrollo

```bash
npm install
npm run build     # chequeo de tipos + empaquetado en dist/index.js (incluye src/calc)
npm run smoke     # prueba el servidor compilado con un cliente MCP real
npm run pack      # genera release/force-calculation.mcpb
```

El servidor importa directamente `../src/calc` y `../src/renderer/forms.js`. Después de cambiar
el motor de cálculo de la app, ejecute `npm run pack` para regenerar el paquete.
