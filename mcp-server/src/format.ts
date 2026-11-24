// Formato Markdown de los resultados del motor de cálculo de Force Calculation.
// Los objetos de resultado vienen de src/calc (JavaScript sin tipos), por eso se leen como Obj.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Obj = { [k: string]: any };

export function num(x: unknown, digits = 2): string {
  if (typeof x !== "number" || !Number.isFinite(x)) return x == null || x === "" ? "—" : String(x);
  return x.toFixed(digits);
}

export interface Col {
  key: string | ((row: Obj) => unknown);
  label: string;
  digits?: number;
}

/** Tabla Markdown; omite columnas sin datos en ninguna fila. */
export function table(rows: Obj[], cols: Col[], maxRows = 80): string {
  const get = (row: Obj, c: Col) => (typeof c.key === "function" ? c.key(row) : row[c.key]);
  const used = cols.filter((c) => rows.some((r) => get(r, c) !== undefined && get(r, c) !== null));
  if (!rows.length || !used.length) return "";
  const shown = rows.slice(0, maxRows);
  const fmt = (v: unknown, c: Col) =>
    Array.isArray(v) ? v.map((x) => num(x, c.digits ?? 2)).join(" / ") : num(v, c.digits ?? 2);
  const lines = [
    `| ${used.map((c) => c.label).join(" | ")} |`,
    `| ${used.map(() => "---").join(" | ")} |`,
    ...shown.map((r) => `| ${used.map((c) => fmt(get(r, c), c)).join(" | ")} |`),
  ];
  if (rows.length > maxRows) lines.push(`\n_(${rows.length - maxRows} filas más en response_format='json')_`);
  return lines.join("\n");
}

const levelCols: Col[] = [
  { key: "name", label: "Nivel / segmento" },
  { key: "h", label: "h (m)" },
  { key: "w", label: "W (kN)", digits: 1 },
  { key: "Cvx", label: "Cvx", digits: 3 },
  { key: "F", label: "Fx (kN)", digits: 2 },
  { key: "Vstory", label: "V piso (kN)", digits: 2 },
];

function seismicSection(r: Obj): string {
  const s = r.seismic;
  const p = s.params;
  const out: string[] = ["## Sismo (fuerza lateral equivalente)"];
  out.push(
    table(
      [p],
      [
        { key: "Ss", label: "Ss (g)", digits: 3 },
        { key: "S1", label: "S1 (g)", digits: 3 },
        { key: "siteClass", label: "Clase de sitio" },
        { key: "Fa", label: "Fa", digits: 3 },
        { key: "Fv", label: "Fv", digits: 3 },
        { key: "SDS", label: "SDS (g)", digits: 3 },
        { key: "SD1", label: "SD1 (g)", digits: 3 },
        { key: "occupancy", label: "Ocupación" },
        { key: "I", label: "I", digits: 2 },
        { key: "sdc", label: "Categoría sísmica" },
      ],
    ),
  );
  const dirs = Object.entries(s.directions ?? {}) as [string, Obj][];
  out.push(
    "",
    table(
      dirs.map(([d, e]) => ({ d, ...e })),
      [
        { key: "d", label: "Dirección" },
        { key: (e) => (e.system ? `${e.system.id} (R=${e.system.R})` : undefined), label: "Sistema" },
        { key: "T", label: "T (s)", digits: 3 },
        { key: "Cs", label: "Cs", digits: 4 },
        { key: "governs", label: "Gobierna" },
        { key: "W", label: "W (kN)", digits: 1 },
        { key: "V", label: "V basal (kN)", digits: 1 },
        { key: "Mbase", label: "M volteo (kN·m)", digits: 1 },
      ],
    ),
  );
  if (s.perFrame !== undefined) out.push("", `Cortante sísmico por marco: **${num(s.perFrame, 2)} kN**`);
  for (const [d, e] of dirs) {
    if (Array.isArray(e.levels) && e.levels.length) {
      out.push("", `### Distribución vertical — Sismo ${d} (k = ${num(e.k, 3)})`, table(e.levels, levelCols));
    }
  }
  return out.join("\n");
}

function windRowsTable(rows: Obj[]): string {
  return table(rows, [
    { key: (x) => x.name ?? x.vol, label: "Nivel / franja" },
    { key: (x) => x.zc ?? x.h ?? x.z, label: "z (m)" },
    { key: "Kz", label: "Kz", digits: 3 },
    { key: "Kzt", label: "Kzt", digits: 3 },
    { key: "qz", label: "qz (kPa)", digits: 3 },
    { key: "Cf", label: "Cf", digits: 2 },
    { key: "pww", label: "p barlov. (kPa)", digits: 3 },
    { key: "plw", label: "p sotav. (kPa)", digits: 3 },
    { key: "F", label: "F (kN)", digits: 2 },
    { key: "Vstory", label: "V piso (kN)", digits: 2 },
  ]);
}

function windSection(r: Obj): string {
  const w = r.wind;
  const ctx = w.ctx ?? w.directions?.X?.ctx;
  const out: string[] = ["## Viento (ASCE 7-05 Cap. 6, Método 2)"];
  if (ctx) {
    out.push(
      `V = **${num(ctx.Vkmh, 1)} km/h** (${num(ctx.V, 2)} m/s; Tabla 4.1: ${num(ctx.Vtable, 1)} km/h, región ${ctx.region}, ` +
        `${ctx.returnPeriod} años) · Exposición ${ctx.exposure} · I = ${num(ctx.I, 2)} · Kd = ${num(ctx.Kd, 2)}` +
        (ctx.topo?.enabled ? ` · Topografía: ${ctx.topo.type}` : ""),
    );
  }
  if (w.gcpi !== undefined) out.push(`GCpi = ±${num(w.gcpi, 2)}`);

  if (w.directions) {
    for (const [d, e] of Object.entries(w.directions) as [string, Obj][]) {
      out.push(
        "",
        `### Viento ${d}`,
        `G = ${num(e.G, 3)}${e.qh !== undefined ? ` · qh = ${num(e.qh, 3)} kPa` : ""}` +
          ` · **V basal = ${num(e.Vbase, 1)} kN** · M volteo = ${num(e.Mbase, 1)} kN·m` +
          (e.Vmin !== undefined ? ` · V mínimo (0.48 kPa) = ${num(e.Vmin, 1)} kN` : ""),
      );
      if (Array.isArray(e.rows)) out.push("", windRowsTable(e.rows));
    }
  }
  for (const key of ["transversal", "longitudinal"]) {
    const e = w[key];
    if (!e) continue;
    out.push(
      "",
      `### Viento ${key} (G = ${num(e.G, 3)})`,
      table(e.cases ?? [], [
        { key: "surface", label: "Superficie" },
        { key: "caseCp", label: "Caso" },
        { key: "Cp", label: "Cp", digits: 2 },
        { key: "q", label: "q (kPa)", digits: 3 },
        { key: "pPos", label: "p con +GCpi (kPa)", digits: 3 },
        { key: "pNeg", label: "p con −GCpi (kPa)", digits: 3 },
        { key: "wPos", label: "w +GCpi (kN/m)", digits: 2 },
        { key: "wNeg", label: "w −GCpi (kN/m)", digits: 2 },
      ]),
    );
  }
  if (Array.isArray(w.segs)) {
    out.push("", "### Fuerzas por segmento", table(w.segs, [
      { key: "name", label: "Segmento" },
      { key: "zc", label: "z (m)" },
      { key: "qz", label: "qz (kPa)", digits: 3 },
      { key: "eps", label: "ε", digits: 2 },
      { key: "Cf", label: "Cf", digits: 2 },
      { key: "Af", label: "Af (m²)", digits: 2 },
      { key: "F", label: "F (kN)", digits: 2 },
    ]));
    if (Array.isArray(w.appForces) && w.appForces.length) {
      out.push("", "Accesorios:", table(w.appForces, [
        { key: "name", label: "Accesorio" },
        { key: "z", label: "z (m)" },
        { key: "EPA", label: "Cf·A (m²)", digits: 2 },
        { key: "F", label: "F (kN)", digits: 2 },
      ]));
    }
  }
  if (Array.isArray(w.parts)) {
    out.push("", "### Fuerzas por parte", table(w.parts, [
      { key: "name", label: "Parte" },
      { key: "z", label: "z (m)" },
      { key: "q", label: "q (kPa)", digits: 3 },
      { key: "Cf", label: "Cf", digits: 2 },
      { key: "Af", label: "Af (m²)", digits: 2 },
      { key: "F", label: "F (kN)", digits: 2 },
    ]));
  }
  if (Array.isArray(w.cases) && !w.directions) {
    out.push("", `### Casos de carga (gobierna: ${w.governing ?? "—"})`, table(w.cases, [
      { key: "name", label: "Caso" },
      { key: "F", label: "F (kN)", digits: 2 },
      { key: "z", label: "z (m)" },
      { key: "ex", label: "Excentricidad (m)", digits: 2 },
      { key: "MT", label: "Torsión (kN·m)", digits: 2 },
    ]));
  }
  if (!w.directions && w.Vbase !== undefined) {
    out.push("", `**V basal = ${num(w.Vbase, 1)} kN** · M volteo = ${num(w.Mbase, 1)} kN·m` +
      (w.MTmax !== undefined ? ` · Torsión máx. = ${num(w.MTmax, 1)} kN·m` : ""));
  }
  return out.join("\n");
}

export function summarize(r: Obj, title: string): string {
  const out: string[] = [`# ${title}`];
  const H = r.H ?? r.h;
  if (H !== undefined) out.push(`Altura H = ${num(H, 2)} m${r.T !== undefined ? ` · T = ${num(r.T, 3)} s` : ""}`);
  out.push("", seismicSection(r), "", windSection(r));
  if (Array.isArray(r.warnings) && r.warnings.length) {
    out.push("", "## Advertencias", ...r.warnings.map((x: string) => `- ${x}`));
  }
  out.push(
    "",
    "_Cargas de viento de servicio (REP-2021 §4.2). Combinaciones LRFD/ASD, envolvente por cara y geometría completa: " +
      "llamar con response_format='json'._",
  );
  return out.join("\n");
}
