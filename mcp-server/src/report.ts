// Generación del reporte Word / PDF con los mismos módulos que la app de escritorio:
//   src/renderer/report-model.js  → modelo de bloques de la memoria de cálculo
//   src/report/docx.js            → documento Word
//   src/report/html.js            → HTML imprimible (PDF con Edge / Chrome sin interfaz)
// Las figuras (espectro, perfiles de fuerza y recortes de los mapas REP) se generan como SVG y se
// rasterizan con resvg (WASM). Las vistas 3D requieren WebGL y solo están en la app.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

import { buildReportModel } from "../../src/renderer/report-model.js";
import { spectrumSVG, profileSVG } from "../../src/renderer/charts.js";
import { sheetsAt } from "../../src/calc/maplookup.js";
// Módulos CommonJS de la app (el bundler los envuelve)
import docxModule from "../../src/report/docx.js";
import htmlModule from "../../src/report/html.js";
import type { Obj } from "./format.js";

const { buildDocx } = docxModule as { buildDocx: (model: Obj) => Promise<Buffer> };
const { buildHtml } = htmlModule as { buildHtml: (model: Obj) => string };

/** Carpeta de recursos: junto al index.js empaquetado (dist/ o server/ del .mcpb). */
const ASSETS = dirname(fileURLToPath(import.meta.url));
const asset = (...p: string[]) => join(ASSETS, ...p);

/** Variable de entorno definida (ignora plantillas sin resolver como "${user_config.x}"). */
const envVar = (k: string): string | undefined => {
  const v = process.env[k]?.trim();
  return v && !v.includes("${") ? v : undefined;
};

// ---------- rasterizado SVG → PNG ----------

let resvgReady: Promise<void> | null = null;
let fontBuffers: Uint8Array[] = [];

function ensureResvg(): Promise<void> {
  resvgReady ??= (async () => {
    await initWasm(readFileSync(asset("resvg.wasm")));
    fontBuffers = ["barlow-400.ttf", "barlow-600.ttf", "barlow-sc-400.ttf", "barlow-sc-600.ttf"].map(
      (f) => new Uint8Array(readFileSync(asset("fonts", f))),
    );
  })();
  return resvgReady;
}

interface Img {
  data: string;
  ratio: number;
  [k: string]: unknown;
}

async function svgToPng(svg: string, scale = 2): Promise<Img> {
  await ensureResvg();
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const ratio = vb ? +vb[2] / +vb[1] : 0.6;
  const r = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Barlow", sansSerifFamily: "Barlow" },
  });
  const png = r.render().asPng();
  r.free();
  return { data: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, ratio };
}

// ---------- figuras ----------

function seismicMain(r: Obj): Obj {
  return r.seismic.directions.X || r.seismic.component;
}

function spectrumMarkers(r: Obj) {
  if (r.typology === "edificio") {
    const a = r.seismic.directions.X;
    const b = r.seismic.directions.Y;
    return Math.abs(a.T - b.T) < 1e-6 ? [{ T: a.T, label: "X, Y" }] : [{ T: a.T, label: "X" }, { T: b.T, label: "Y" }];
  }
  return [{ T: seismicMain(r).T, label: "T" }];
}

/** Igual que profileRows de la app: fuerzas por nivel de viento y sismo. */
function profileRows(r: Obj, dir = "X"): Obj[] | null {
  if (r.typology === "edificio") {
    return r.seismic.directions[dir].levels.map((l: Obj, i: number) => ({ name: l.name, quake: l.F, wind: r.wind.directions[dir].rows[i].F }));
  }
  if (r.typology === "torre") {
    return r.wind.segs.map((s: Obj) => {
      const lv = r.seismic.directions.X.levels.find((l: Obj) => l.name === s.name);
      return { name: s.name, wind: s.F, quake: lv ? lv.F : 0 };
    });
  }
  if (r.typology === "tanque") {
    const lv = r.seismic.directions.X.levels;
    const rows: Obj[] = [];
    if (r.wind.parts.length > 1) rows.push({ name: "Soporte", wind: r.wind.parts[1].F, quake: lv[0].F });
    rows.push({ name: "Tanque", wind: r.wind.parts[0].F, quake: lv[lv.length - 1].F });
    return rows;
  }
  return null;
}

/** Ancho y alto de un JPEG (marcador SOF). */
function jpegSize(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("JPEG sin dimensiones");
}

/** Recorte de la hoja del mapa REP con la ubicación del sitio (como mapView.sheetCrop de la app). */
async function sheetCrop(grid: Obj, param: "Ss" | "S1", lon: number, lat: number, size = 560): Promise<Img | null> {
  const list = sheetsAt(grid, lon, lat) as Obj[];
  if (!list.length) return null;
  const s = list[0];
  const file = asset("sheets", `${param}-${String(s.sheet).padStart(2, "0")}.jpg`);
  if (!existsSync(file)) return null;
  const jpg = readFileSync(file);
  const { w, h } = jpegSize(jpg);
  const c = size / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="#fff"/>
    <image x="${c - s.x}" y="${c - s.y}" width="${w}" height="${h}" xlink:href="data:image/jpeg;base64,${jpg.toString("base64")}"/>
    <g fill="none" stroke="#C8102E" stroke-width="3"><circle cx="${c}" cy="${c}" r="10"/><path d="M${c - 20},${c} H${c + 20} M${c},${c - 20} V${c + 20}"/></g>
    <rect width="150" height="30" fill="#fff" fill-opacity="0.9"/>
    <text x="8" y="21" font-family="Barlow" font-weight="600" font-size="18" fill="#1C2A33">Mapa ${param}-${s.sheet}</text>
  </svg>`;
  const im = await svgToPng(svg, 1);
  return { ...im, ratio: 1, sheet: s.sheet };
}

async function collectImages(project: Obj, r: Obj, grid: () => Obj): Promise<Obj> {
  const images: Obj = { views: [] };
  images.spectrum = await svgToPng(spectrumSVG(r.seismic.params, spectrumMarkers(r), { w: 900, h: 440 }));
  images.profiles = [];
  for (const dir of r.typology === "edificio" ? ["X", "Y"] : ["X"]) {
    const pr = profileRows(r, dir);
    if (!pr) continue;
    const im = await svgToPng(profileSVG(pr, { w: 900, windLabel: `Viento ${dir} (servicio)`, quakeLabel: `Sismo ${dir} (resistencia)` }));
    images.profiles.push({ ...im, caption: `Figura: fuerzas por nivel en dirección ${dir}: viento (servicio) y sismo (resistencia).` });
  }
  if (project.site.source === "mapa") {
    const g = grid();
    images.mapSs = await sheetCrop(g, "Ss", project.site.lon, project.site.lat);
    images.mapS1 = await sheetCrop(g, "S1", project.site.lon, project.site.lat);
  }
  return images;
}

// ---------- PDF con un navegador Chromium instalado ----------

function browserCandidates(): string[] {
  const env = process.env;
  const list: string[] = [];
  const custom = envVar("FORCECALC_BROWSER");
  if (custom) list.push(custom);
  if (platform() === "win32") {
    const roots = [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean) as string[];
    for (const r of roots) {
      list.push(join(r, "Microsoft", "Edge", "Application", "msedge.exe"));
      list.push(join(r, "Google", "Chrome", "Application", "chrome.exe"));
      list.push(join(r, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"));
    }
  } else if (platform() === "darwin") {
    for (const app of ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"]) {
      list.push(`/Applications/${app}.app/Contents/MacOS/${app}`);
      list.push(join(homedir(), "Applications", `${app}.app`, "Contents", "MacOS", app));
    }
  } else {
    for (const b of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]) {
      for (const d of ["/usr/bin", "/usr/local/bin", "/snap/bin"]) list.push(join(d, b));
    }
    list.push("/opt/google/chrome/chrome", "/opt/pw-browsers/chromium/chrome-linux64/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome");
  }
  return list;
}

export function findBrowser(): string | null {
  return browserCandidates().find((p) => p && existsSync(p)) ?? null;
}

const cssString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

/** HTML de la app con las fuentes incrustadas y pie de página con numeración (márgenes de @page). */
function printableHtml(model: Obj): string {
  let html = buildHtml(model);
  // buildHtml apunta a las fuentes en node_modules de la app; aquí se incrustan como data URL.
  html = html.replace(/url\('file:[^']*?\/([\w-]+-latin-\d+-normal\.woff2)'\)/g, (_m, file: string) => {
    const p = asset("fonts", file);
    return existsSync(p) ? `url('data:font/woff2;base64,${readFileSync(p).toString("base64")}')` : "url('')";
  });
  const footer = `font-family:sans-serif;font-size:8px;color:#555`;
  const css =
    `@page{size:Letter;margin:0.6in 0.7in;` +
    `@bottom-left{content:${cssString(`${model.title} — REP-2021`)};${footer}}` +
    `@bottom-right{content:"Página " counter(page) " de " counter(pages);${footer}}}` +
    `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
  return html.replace("</style>", `${css}\n</style>`);
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((ok, fail) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, _out, stderr) => {
      if (err) fail(new Error(`${err.message}${stderr ? `\n${String(stderr).slice(-800)}` : ""}`));
      else ok();
    });
  });
}

async function htmlToPdf(html: string, target: string): Promise<string> {
  const browser = findBrowser();
  if (!browser) {
    throw new Error(
      "No se encontró Microsoft Edge, Google Chrome ni Chromium para generar el PDF. Instale uno de ellos, " +
        "indique su ruta en la configuración de la extensión (variable FORCECALC_BROWSER), o genere el reporte en formato 'docx'.",
    );
  }
  const work = mkdtempSync(join(tmpdir(), "fc-report-"));
  try {
    const htmlFile = join(work, "reporte.html");
    writeFileSync(htmlFile, html, "utf8");
    const args = [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--user-data-dir=${join(work, "perfil")}`,
      "--no-pdf-header-footer",
      `--print-to-pdf=${target}`,
    ];
    if (platform() === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
    args.push(pathToFileURL(htmlFile).href);
    rmSync(target, { force: true });
    await run(browser, args, 120_000);
    if (!existsSync(target)) throw new Error(`El navegador (${browser}) no generó el PDF.`);
    return browser;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------- API ----------

export function defaultOutputDir(): string {
  const custom = envVar("FORCECALC_OUTPUT_DIR");
  if (custom) return custom;
  const docs = join(homedir(), "Documents");
  return join(existsSync(docs) ? docs : homedir(), "Force Calculation");
}

/** Ruta libre: no sobrescribe reportes existentes ("nombre (2).docx"). */
function freePath(dir: string, base: string, ext: string): string {
  let p = join(dir, `${base}.${ext}`);
  for (let i = 2; existsSync(p); i++) p = join(dir, `${base} (${i}).${ext}`);
  return p;
}

export function openFile(p: string): void {
  const [cmd, args] =
    platform() === "win32" ? ["cmd", ["/c", "start", '""', `"${p}"`]] : platform() === "darwin" ? ["open", [p]] : ["xdg-open", [p]];
  const child = spawn(cmd, args as string[], { detached: true, stdio: "ignore", windowsVerbatimArguments: platform() === "win32", shell: false });
  child.on("error", () => undefined);
  child.unref();
}

export interface ReportOutput {
  files: { format: "docx" | "pdf" | "html"; path: string }[];
  figures: string[];
  browser?: string;
  errors: string[];
}

export async function generateReport(
  project: Obj,
  result: Obj,
  opts: { formats: ("docx" | "pdf" | "html")[]; outputDir: string; fileName?: string; grid: () => Obj },
): Promise<ReportOutput> {
  const images = await collectImages(project, result, opts.grid);
  const model = buildReportModel(project, result, images) as Obj;
  mkdirSync(opts.outputDir, { recursive: true });
  const base = (opts.fileName || model.fileName).replace(/[\\/:*?"<>|]+/g, "").trim() || "Memoria-cargas";
  const out: ReportOutput = { files: [], figures: [], errors: [] };
  out.figures = [
    "espectro de diseño",
    ...images.profiles.map((_: unknown, i: number) => `perfil de fuerzas ${i ? "Y" : "X"}`),
    ...(images.mapSs ? [`mapa Ss-${images.mapSs.sheet}`] : []),
    ...(images.mapS1 ? [`mapa S1-${images.mapS1.sheet}`] : []),
  ];

  if (opts.formats.includes("docx")) {
    const p = freePath(opts.outputDir, base, "docx");
    writeFileSync(p, await buildDocx(model));
    out.files.push({ format: "docx", path: p });
  }
  if (opts.formats.includes("pdf") || opts.formats.includes("html")) {
    const html = printableHtml(model);
    if (opts.formats.includes("html")) {
      const p = freePath(opts.outputDir, base, "html");
      writeFileSync(p, html, "utf8");
      out.files.push({ format: "html", path: p });
    }
    if (opts.formats.includes("pdf")) {
      const p = freePath(opts.outputDir, base, "pdf");
      try {
        out.browser = await htmlToPdf(html, p);
        out.files.push({ format: "pdf", path: p });
      } catch (e) {
        out.errors.push(`PDF: ${(e as Error).message}`);
      }
    }
  }
  return out;
}
