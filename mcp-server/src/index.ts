#!/usr/bin/env node
/**
 * Servidor MCP de Force Calculation (REP-2021 Panamá / ASCE 7-05).
 * Expone el mismo motor de cálculo que la aplicación de escritorio (src/calc) como herramientas MCP.
 * Transporte stdio: lo lanza el cliente MCP (Claude Desktop, Claude Code, etc.) como subproceso.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { compute, defaultProject, TYPOLOGIES } from "../../src/calc/typologies.js";
import * as S from "../../src/calc/seismic.js";
import * as W from "../../src/calc/wind.js";
import { REP, basicWindSpeed, REFERENCES } from "../../src/calc/rep.js";
import { BUILDING_SYSTEMS, NONBUILDING_SYSTEMS } from "../../src/calc/systems.js";
import { lookup as mapLookup, COVERAGE_WARN_KM, COVERAGE_MAX_KM } from "../../src/calc/maplookup.js";
import { SECTIONS, OCCUPANCY } from "../../src/renderer/forms.js";
import { summarize, table, num, type Obj } from "./format.js";

const VERSION = "1.0.0";
const CHARACTER_LIMIT = 100_000;

// ---------- utilidades ----------

const TYPOLOGY_IDS = ["edificio", "nave", "torre", "tanque", "valla", "generico"] as const;
type Typology = (typeof TYPOLOGY_IDS)[number];

const isPlain = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Mezcla profunda: los objetos se combinan, los arreglos y escalares se reemplazan. */
function deepMerge(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

let gridCache: Obj | null = null;
function loadGrid(): Obj {
  if (gridCache) return gridCache;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "grid.json"), join(here, "..", "..", "src", "data", "rep-maps", "grid.json")];
  for (const p of candidates) {
    try {
      gridCache = JSON.parse(readFileSync(p, "utf8")) as Obj;
      return gridCache;
    } catch {
      /* siguiente candidato */
    }
  }
  throw new Error("No se encontró la grilla de mapas REP (grid.json). Reinstale el servidor MCP.");
}

function spectralLookup(lat: number, lon: number) {
  const r = mapLookup(loadGrid(), lon, lat) as Obj | null;
  if (!r) {
    throw new Error(
      `El punto (lat ${lat}, lon ${lon}) está fuera de la grilla de los mapas REP (lat 7.0–9.7, lon −83.1 a −77.1). ` +
        "Verifique que la longitud sea negativa (oeste) o ingrese Ss y S1 manualmente.",
    );
  }
  return r;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (data: Obj) => {
  const t = JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text: t.length > CHARACTER_LIMIT ? JSON.stringify(data) : t }], structuredContent: data };
};

// ---------- esquemas de entrada ----------

const ResponseFormat = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("'markdown' = resumen legible con tablas; 'json' = resultado completo del motor (todas las tablas, combinaciones, envolvente)");

const Occupancy = z.enum(["I", "II", "III", "IV"]).describe("Categoría de ocupación (Tabla 1-1): I bajo riesgo, II normal, III gran ocupación, IV esencial");
const SiteClass = z.enum(["A", "B", "C", "D", "E"]).describe("Clase de sitio (ASCE 7-05 Cap. 20). F requiere estudio específico y no se admite");
const Region = z.enum(["Pacifico", "Atlantico"]).describe("Región de la Tabla 4.1 del REP-2021");
const ReturnPeriod = z.union([z.literal(10), z.literal(20), z.literal(50), z.literal(100)]).describe("Período de retorno en años (50 = diseño)");
const Exposure = z.enum(["B", "C", "D"]).describe("Exposición §6.5.6: B urbana/boscosa, C terreno abierto, D costa/agua");

const TopoInput = z.strictObject({
  enabled: z.boolean().optional().describe("Activa el factor topográfico Kzt"),
  type: z.enum(["ridge2D", "escarp2D", "hill3D"]).optional().describe("Forma del relieve (Fig. 6-4)"),
  H: z.number().min(0).optional().describe("Altura del relieve H (m)"),
  Lh: z.number().min(0).optional().describe("Distancia Lh (m)"),
  x: z.number().optional().describe("Distancia horizontal a la cresta (m); >0 a sotavento, <0 a barlovento"),
});

const SiteInput = z.strictObject({
  lat: z.number().min(-90).max(90).optional().describe("Latitud (grados decimales, p. ej. 8.98)"),
  lon: z.number().min(-180).max(180).optional().describe("Longitud (grados decimales, oeste negativo, p. ej. -79.52)"),
  Ss: z.number().min(0).max(4).optional().describe("Aceleración espectral Ss (g), clase de sitio B"),
  S1: z.number().min(0).max(2).optional().describe("Aceleración espectral S1 (g), clase de sitio B"),
  siteClass: SiteClass.optional(),
  occupancy: Occupancy.optional(),
});

const WindInput = z.strictObject({
  region: Region.optional(),
  returnPeriod: ReturnPeriod.optional(),
  Voverride: z.number().positive().optional().describe("Velocidad mayor justificada en km/h (reemplaza la Tabla 4.1)"),
  exposure: Exposure.optional(),
  enclosure: z.enum(["cerrado", "parcial", "abierto"]).optional().describe("Cerramiento: GCpi ±0.18 / ±0.55 / 0"),
  rigidMode: z.enum(["calc", "0.85"]).optional().describe("Factor de ráfaga en estructuras rígidas: calculado (Ec. 6-4) o 0.85"),
  beta: z.number().min(0).max(0.2).optional().describe("Amortiguamiento β para estructuras flexibles (p. ej. 0.02)"),
  topo: TopoInput.optional(),
});

// ---------- catálogo de campos (desde los formularios de la app) ----------

interface Field {
  path: string;
  label: string;
  unit?: string;
  type: string;
  options?: { value: unknown; label: string }[];
}

const VOLUME_FIELDS: [string, string][] = [
  ["name", "Nombre del cuerpo"],
  ["shape", "'rect' (prisma) o 'cyl' (cilindro)"],
  ["bx", "Dimensión en X o diámetro (m)"],
  ["by", "Dimensión en Y (m, prismas)"],
  ["h", "Altura del cuerpo (m)"],
  ["z0", "Cota de la base del cuerpo sobre el terreno (m)"],
  ["x", "Posición del centro en X (m)"],
  ["y", "Posición del centro en Y (m)"],
  ["tipo", "'solido' o 'abierto' (celosía)"],
  ["eps", "Relación de solidez ε (cuerpos abiertos)"],
  ["W", "Peso sísmico del cuerpo (kN)"],
  ["nCols", "Número de columnas de apoyo (0 = sin columnas)"],
  ["dCol", "Ancho/diámetro de columna (m)"],
  ["wCol", "Peso por columna (kN)"],
  ["roof", "Techo: 'plano', 'una', 'dos', 'cuatro' o 'domo' (cilindros)"],
  ["roofAngle", "Pendiente del techo (°)"],
  ["roofDir", "Dirección de la cumbrera: 'X' o 'Y'"],
  ["domeRise", "Flecha del domo (m)"],
];

function describeFields(fields: Field[], defaults: Obj): string {
  return fields
    .map((f) => {
      const key = f.path.split(".").slice(1).join(".");
      const def = key.split(".").reduce<unknown>((o, k) => (isPlain(o) ? o[k] : undefined), defaults);
      const opts = f.options && f.options.length > 12
        ? " — id de sistema; ver forcecalc_list_systems"
        : f.options ? ` — opciones: ${f.options.map((o) => `\`${o.value}\` (${o.label})`).join(", ")}` : "";
      return `- \`${key}\`: ${f.label}${f.unit ? ` [${f.unit}]` : ""}; por defecto \`${JSON.stringify(def)}\`${opts}`;
    })
    .join("\n");
}

// ---------- servidor ----------

function createServer(): McpServer {
  const server = new McpServer({ name: "force-calculation-mcp-server", version: VERSION });
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  // 1. Cálculo completo de un proyecto
  server.registerTool(
    "forcecalc_compute",
    {
      title: "Calcular cargas de viento y sismo",
      description: `Calcula las cargas de viento (ASCE 7-05 Cap. 6, Método 2) y sismo (fuerza lateral equivalente, Cap. 11/12/15) según el REP-2021 de Panamá para una estructura, con el mismo motor que la app Force Calculation.

Tipologías: edificio (varios niveles), nave (industrial a dos aguas), torre (celosía/chimenea/poste), tanque (elevado o apoyado), valla (publicitaria en terreno o azotea), generico (volúmenes configurables).

Todo lo que no se indique toma el valor por defecto de la app. Llame antes a forcecalc_describe_inputs para ver los campos de 'structure' de cada tipología.
Si se dan lat/lon y no Ss/S1, Ss y S1 se leen de los mapas REP automáticamente.

Ejemplos:
  - Edificio de 10 pisos de concreto en Colón: typology='edificio', site={lat:9.36, lon:-79.9}, wind={region:'Atlantico', exposure:'D'}, structure={nStories:10, systemX:'C5', systemY:'C5'}
  - Nave de 25×50 m: typology='nave', structure={span:25, length:50, eaveHeight:7}`,
      inputSchema: z.strictObject({
        typology: z.enum(TYPOLOGY_IDS).describe("Tipología estructural"),
        site: SiteInput.optional().describe("Sitio y parámetros sísmicos"),
        wind: WindInput.optional().describe("Parámetros de viento"),
        structure: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Datos de la tipología (p. ej. {nStories: 8, Bx: 30}). Claves válidas: forcecalc_describe_inputs"),
        project_name: z.string().max(200).optional().describe("Nombre del proyecto (solo informativo)"),
        response_format: ResponseFormat,
      }),
      annotations: { ...ro, title: "Calcular cargas" },
    },
    async ({ typology, site, wind, structure, project_name, response_format }) => {
      const base = defaultProject() as Obj;
      const defaults = base[typology] as Obj;

      // Validar claves de la tipología contra los valores por defecto de la app
      const unknownKeys = Object.keys(structure ?? {}).filter((k) => !(k in defaults));
      if (unknownKeys.length) {
        throw new Error(
          `Claves no reconocidas para '${typology}': ${unknownKeys.join(", ")}. ` +
            `Claves válidas: ${Object.keys(defaults).join(", ")}. Use forcecalc_describe_inputs para ver su significado.`,
        );
      }
      const struct: Obj = { ...(structure ?? {}) };
      if (typology === "generico" && Array.isArray(struct.volumes)) {
        const tpl = (defaults.volumes as Obj[])[0];
        struct.volumes = (struct.volumes as unknown[]).map((v, i) => {
          if (!isPlain(v)) throw new Error(`structure.volumes[${i}] debe ser un objeto con las claves: ${Object.keys(tpl).join(", ")}`);
          return { ...tpl, name: `Cuerpo ${i + 1}`, ...v };
        });
      }

      const notes: string[] = [];
      const siteIn: Obj = { ...(site ?? {}) };
      if (siteIn.lat !== undefined && siteIn.lon !== undefined && (siteIn.Ss === undefined || siteIn.S1 === undefined)) {
        const m = spectralLookup(siteIn.lat, siteIn.lon);
        siteIn.Ss ??= m.Ss;
        siteIn.S1 ??= m.S1;
        siteIn.source = "mapa";
        siteIn.mapDistKm = m.distKm;
        notes.push(
          `Ss = ${m.Ss} g y S1 = ${m.S1} g leídos de los mapas REP en (${siteIn.lat}, ${siteIn.lon}); distancia al contorno digitalizado más cercano ${m.distKm} km` +
            (m.status !== "ok" ? ` — cobertura ${m.status === "baja" ? "baja" : "fuera de rango"}: verificar en el mapa oficial.` : "."),
        );
      } else if (siteIn.Ss === undefined && siteIn.S1 === undefined) {
        notes.push(`No se indicó sitio: se usan Ss = ${base.site.Ss} g y S1 = ${base.site.S1} g por defecto (Ciudad de Panamá). Pase site.lat/lon o Ss/S1.`);
      }

      const project = deepMerge(base, {
        typology,
        site: siteIn,
        wind: wind ?? {},
        [typology]: struct,
        meta: project_name ? { nombre: project_name } : {},
      });

      let r: Obj;
      try {
        r = compute(project) as Obj;
      } catch (e) {
        throw new Error(`El motor de cálculo rechazó los datos: ${(e as Error).message}. Revise los valores con forcecalc_describe_inputs.`);
      }
      const bad = Object.entries((r.seismic?.directions ?? {}) as Obj).filter(([, d]) => !Number.isFinite((d as Obj).V));
      if (bad.length) {
        throw new Error(
          `El cortante sísmico resultó no numérico en ${bad.map(([k]) => k).join(", ")}. Revise que las dimensiones, pesos y períodos sean números positivos.`,
        );
      }

      const title = `${project_name ? project_name + " — " : ""}${(TYPOLOGIES as Obj)[typology]}`;
      if (response_format === "json") {
        return json({ input: project, notes, references: REFERENCES, result: r });
      }
      const md = summarize(r, title);
      if (!notes.length) return text(md);
      const cut = md.indexOf("\n");
      return text([md.slice(0, cut), "", ...notes.map((n) => `> ${n}`), md.slice(cut)].join("\n"));
    },
  );

  // 2. Catálogo de datos de entrada
  server.registerTool(
    "forcecalc_describe_inputs",
    {
      title: "Describir datos de entrada",
      description: `Lista los campos de entrada de una tipología (clave, significado, unidad, valor por defecto y opciones), además de los de sitio y viento. Úselo antes de forcecalc_compute para construir 'structure'.`,
      inputSchema: z.strictObject({
        typology: z.enum(TYPOLOGY_IDS).describe("Tipología a describir"),
        response_format: ResponseFormat,
      }),
      annotations: ro,
    },
    async ({ typology, response_format }) => {
      const base = defaultProject() as Obj;
      if (response_format === "json") {
        return json({ typology, site: base.site, wind: base.wind, structure: base[typology] });
      }
      const sec = SECTIONS as Obj;
      const structFields = (sec.estructura[typology] ?? []) as Field[];
      const lines = [
        `# Datos de entrada — ${(TYPOLOGIES as Obj)[typology]}`,
        "",
        "## site",
        "- `lat`, `lon`: coordenadas; si se dan sin Ss/S1, se leen de los mapas REP",
        describeFields(SECTIONS.sitio as Field[], base.site),
        "",
        "## wind",
        describeFields(SECTIONS.viento as Field[], base.wind),
        "",
        `## structure (${typology})`,
        describeFields(structFields, base[typology]),
      ];
      const listed = new Set(structFields.map((f) => f.path.split(".")[1]));
      const extra = Object.keys(base[typology]).filter((k) => !listed.has(k) && k !== "volumes");
      if (extra.length) {
        lines.push(...extra.map((k) => `- \`${k}\`: por defecto \`${JSON.stringify(base[typology][k])}\``));
      }
      if (typology === "generico") {
        lines.push(
          "",
          "### structure.volumes (lista de cuerpos; las claves omitidas toman el valor del primer cuerpo por defecto)",
          ...VOLUME_FIELDS.map(([k, d]) => `- \`${k}\`: ${d}`),
          "",
          `Por defecto: \`${JSON.stringify(base.generico.volumes)}\``,
        );
      }
      if (typology === "torre") {
        lines.push("", "### structure.appurtenances", "Lista de accesorios `{name, z (m), epa: Cf·A (m²), w (kN)}`.");
      }
      return text(lines.join("\n"));
    },
  );

  // 3. Ss y S1 desde los mapas REP
  server.registerTool(
    "forcecalc_lookup_ss_s1",
    {
      title: "Ss y S1 de los mapas REP",
      description: `Devuelve Ss y S1 (g, clase de sitio B) en un punto de Panamá, interpolados de los mapas oficiales de aceleraciones espectrales del REP (§5.12). Incluye la distancia al contorno digitalizado más cercano: ≤${COVERAGE_WARN_KM} km cobertura buena, ≤${COVERAGE_MAX_KM} km baja, más lejos fuera de rango.

Ejemplo: Ciudad de Panamá -> lat=8.98, lon=-79.52`,
      inputSchema: z.strictObject({
        lat: z.number().min(-90).max(90).describe("Latitud en grados decimales (p. ej. 8.98)"),
        lon: z.number().min(-180).max(180).describe("Longitud en grados decimales, oeste negativo (p. ej. -79.52)"),
      }),
      outputSchema: z.object({
        lat: z.number(),
        lon: z.number(),
        Ss: z.number(),
        S1: z.number(),
        distKm: z.number(),
        status: z.enum(["ok", "baja", "fuera"]),
      }),
      annotations: ro,
    },
    async ({ lat, lon }) => {
      const m = spectralLookup(lat, lon);
      const data = { lat, lon, Ss: m.Ss as number, S1: m.S1 as number, distKm: m.distKm as number, status: m.status as "ok" | "baja" | "fuera" };
      return json(data);
    },
  );

  // 4. Parámetros sísmicos de diseño
  server.registerTool(
    "forcecalc_seismic_parameters",
    {
      title: "Parámetros sísmicos de diseño",
      description: `Calcula Fa, Fv, SMS, SM1, SDS, SD1, T0, Ts, TL (=10 s REP §5.13), factor de importancia y categoría de diseño sísmico a partir de Ss, S1, clase de sitio y ocupación (ASCE 7-05 §11.4–11.6). Opcionalmente evalúa Sa del espectro de diseño en los períodos indicados.`,
      inputSchema: z.strictObject({
        Ss: z.number().min(0).max(4).describe("Ss (g)"),
        S1: z.number().min(0).max(2).describe("S1 (g)"),
        siteClass: SiteClass,
        occupancy: Occupancy.default("II"),
        periods: z.array(z.number().min(0).max(20)).max(100).optional().describe("Períodos T (s) donde evaluar Sa, p. ej. [0.2, 0.5, 1.0]"),
        response_format: ResponseFormat,
      }),
      annotations: ro,
    },
    async ({ Ss, S1, siteClass, occupancy, periods, response_format }) => {
      const p = S.designParameters({ Ss, S1, siteClass, occupancy }) as Obj;
      const sa = (periods ?? []).map((T) => ({ T, Sa: S.spectralAcceleration(T, p) as number }));
      if (response_format === "json") return json({ params: p, spectrum: sa });
      const lines = [
        "# Parámetros sísmicos de diseño (REP-2021 / ASCE 7-05)",
        table([p], [
          { key: "Fa", label: "Fa", digits: 3 },
          { key: "Fv", label: "Fv", digits: 3 },
          { key: "SMS", label: "SMS (g)", digits: 3 },
          { key: "SM1", label: "SM1 (g)", digits: 3 },
          { key: "SDS", label: "SDS (g)", digits: 3 },
          { key: "SD1", label: "SD1 (g)", digits: 3 },
        ]),
        "",
        `T0 = ${num(p.T0, 3)} s · Ts = ${num(p.Ts, 3)} s · TL = ${p.TL} s · I = ${num(p.I, 2)} · **Categoría de diseño sísmico ${p.sdc}** ` +
          `(por SDS: ${p.bySDS}, por SD1: ${p.bySD1})`,
      ];
      if (sa.length) lines.push("", "## Espectro de diseño", table(sa, [{ key: "T", label: "T (s)", digits: 3 }, { key: "Sa", label: "Sa (g)", digits: 4 }]));
      return text(lines.join("\n"));
    },
  );

  // 5. Perfil de presión de velocidad del viento
  server.registerTool(
    "forcecalc_wind_pressure",
    {
      title: "Presión de velocidad del viento qz",
      description: `Calcula la velocidad básica V (Tabla 4.1 del REP-2021) y el perfil de presión de velocidad qz = 0.613·Kz·Kzt·Kd·V²·I (Ec. 6-15) a las alturas indicadas. Útil para cálculos rápidos sin definir toda la estructura.`,
      inputSchema: z.strictObject({
        region: Region,
        returnPeriod: ReturnPeriod.default(50),
        exposure: Exposure,
        occupancy: Occupancy.default("II"),
        Voverride: z.number().positive().optional().describe("Velocidad mayor justificada (km/h)"),
        Kd: z.number().min(0.5).max(1).default(0.85).describe("Factor de direccionalidad Kd (Tabla 6-4); 0.85 edificios"),
        heights: z.array(z.number().min(0).max(500)).min(1).max(200).describe("Alturas z sobre el terreno (m), p. ej. [5, 10, 20, 30]"),
        topo: TopoInput.optional(),
        response_format: ResponseFormat,
      }),
      annotations: ro,
    },
    async ({ region, returnPeriod, exposure, occupancy, Voverride, Kd, heights, topo, response_format }) => {
      const topoFull = topo ? { enabled: false, type: "hill3D", H: 0, Lh: 0, x: 0, ...topo } : undefined;
      const ctx = W.windContext({ region, returnPeriod, Voverride, exposure, occupancy, Kd, topo: topoFull }) as Obj;
      const rows = heights.map((z) => W.qz(z, ctx) as Obj);
      if (response_format === "json") return json({ ctx, profile: rows });
      return text(
        [
          "# Presión de velocidad del viento",
          `V = **${num(ctx.Vkmh, 1)} km/h** (${num(ctx.V, 2)} m/s; Tabla 4.1: ${num(ctx.Vtable, 1)} km/h) · Exposición ${exposure} · I = ${num(ctx.I, 2)} · Kd = ${num(Kd, 2)}`,
          "",
          table(rows, [
            { key: "z", label: "z (m)", digits: 2 },
            { key: "Kz", label: "Kz", digits: 3 },
            { key: "Kzt", label: "Kzt", digits: 3 },
            { key: "q", label: "qz (kPa)", digits: 3 },
          ]),
          "",
          `_Presión mínima de diseño: ${W.MIN_WIND_PRESSURE} kPa (§6.1.4.1). Cargas de servicio (REP-2021 §4.2)._`,
        ].join("\n"),
      );
    },
  );

  // 6. Sistemas sísmicos resistentes
  server.registerTool(
    "forcecalc_list_systems",
    {
      title: "Sistemas sísmicos resistentes",
      description: `Lista los sistemas resistentes a sismo disponibles con su id, R, Ω0 y Cd: edificios (ASCE 7-05 Tabla 12.2-1) y no-edificios (Tabla 15.4-2). Los ids se usan en structure.systemX/systemY/system de forcecalc_compute.`,
      inputSchema: z.strictObject({
        kind: z.enum(["edificio", "no_edificio", "todos"]).default("todos").describe("Qué tabla listar"),
        response_format: ResponseFormat,
      }),
      annotations: ro,
    },
    async ({ kind, response_format }) => {
      const b = kind !== "no_edificio" ? (BUILDING_SYSTEMS as Obj[]) : [];
      const n = kind !== "edificio" ? (NONBUILDING_SYSTEMS as Obj[]) : [];
      if (response_format === "json") return json({ building: b, nonbuilding: n });
      const cols = [
        { key: "id", label: "id" },
        { key: "group", label: "Grupo" },
        { key: "label", label: "Sistema" },
        { key: "R", label: "R" },
        { key: "Omega0", label: "Ω0" },
        { key: "Cd", label: "Cd" },
        { key: (s: Obj) => (s.np ? s.np.join(", ") : undefined), label: "No permitido en SDC" },
      ];
      const out: string[] = [];
      if (b.length) out.push("## Edificios (Tabla 12.2-1)", table(b, cols, 200));
      if (n.length) out.push("", "## No-edificios (Tabla 15.4-2)", table(n, cols, 200));
      return text(out.join("\n"));
    },
  );

  // Recurso: disposiciones REP-2021 y referencias normativas
  server.registerResource(
    "rep2021-provisions",
    "forcecalc://rep2021",
    { title: "Disposiciones REP-2021", description: "Constantes del REP-2021 usadas por el motor y referencias normativas", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ REP, REFERENCES, OCCUPANCY, basicWindSpeed50: { Pacifico: basicWindSpeed("Pacifico", 50), Atlantico: basicWindSpeed("Atlantico", 50) } }, null, 2) }],
    }),
  );

  return server;
}

serveStdio(createServer);
console.error(`force-calculation-mcp-server ${VERSION} en stdio`);
