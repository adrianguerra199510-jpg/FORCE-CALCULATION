// Generación del reporte Word / PDF con los mismos módulos que la app de escritorio:
//   src/renderer/report-model.js  → modelo de bloques de la memoria de cálculo
//   src/report/docx.js            → documento Word
//   src/report/html.js            → HTML imprimible (PDF con Edge / Chrome sin interfaz)
// Las figuras 2D (espectro, perfiles de fuerza y recortes de los mapas REP) se generan como SVG y se
// rasterizan con resvg (WASM). Las vistas 3D se capturan con el visor de la app (three.js) dentro de
// Edge/Chrome sin interfaz, que también imprime el PDF (ver browser.ts y viewer-page.ts).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { BrowserSession, envVar, findBrowser } from "./browser.js";
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

async function collect2dImages(project: Obj, r: Obj, grid: () => Obj): Promise<Obj> {
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

// ---------- navegador: vistas 3D y PDF ----------

export { findBrowser };

const escHtml = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

const fontData = (file: string) => {
  const p = asset("fonts", file);
  return existsSync(p) ? `data:font/woff2;base64,${readFileSync(p).toString("base64")}` : "";
};

function fontFaceCss(): string {
  const f = (fam: string, pkg: string, w: number) => `@font-face{font-family:'${fam}';font-weight:${w};src:url('${fontData(`${pkg}-latin-${w}-normal.woff2`)}') format('woff2');}`;
  return [400, 500, 600, 700].map((w) => f("Barlow", "barlow", w)).join("") + [400, 600].map((w) => f("Barlow Semi Condensed", "barlow-semi-condensed", w)).join("");
}

/** HTML de la app con las fuentes incrustadas (buildHtml apunta a node_modules de la app). */
function printableHtml(model: Obj): string {
  const html = buildHtml(model).replace(/url\('file:[^']*?\/([\w-]+-latin-\d+-normal\.woff2)'\)/g, (_m, file: string) => `url('${fontData(file)}')`);
  return html.replace("</style>", "*{-webkit-print-color-adjust:exact;print-color-adjust:exact}\n</style>");
}

/** Mismo pie de página que la exportación PDF de la app (src/main/main.js). */
const footerTemplate = (title: string) =>
  `<div style="font-size:8px;width:100%;padding:0 0.7in;color:#555;display:flex;justify-content:space-between;font-family:sans-serif"><span>${escHtml(title)} — REP-2021</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;

/** Vistas 3D con el visor de la app (viewer-bundle.js) en la sesión del navegador. */
async function render3dViews(session: BrowserSession, project: Obj, work: string): Promise<{ views: Img[]; viewEnv: Img | null }> {
  const page = join(work, "visor.html");
  writeFileSync(
    page,
    `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaceCss()}html,body{margin:0;background:#fff}#viewer{width:1400px;height:840px}</style></head>` +
      `<body><div id="viewer"></div><script src="${pathToFileURL(asset("viewer-bundle.js")).href}"></script></body></html>`,
    "utf8",
  );
  await session.goto(pathToFileURL(page).href);
  return session.evaluate(`window.renderViews(${JSON.stringify(project)})`, 180_000);
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
  opts: { formats: ("docx" | "pdf" | "html")[]; outputDir: string; fileName?: string; views3d: boolean; grid: () => Obj },
): Promise<ReportOutput> {
  const out: ReportOutput = { files: [], figures: [], errors: [] };
  const images = await collect2dImages(project, result, opts.grid);
  const wantPdf = opts.formats.includes("pdf");

  // Navegador: solo si hace falta (vistas 3D o PDF). Si no hay, se generan igual el Word/HTML sin vistas 3D.
  let session: BrowserSession | null = null;
  const work = mkdtempSync(join(tmpdir(), "fc-report-"));
  try {
    if (opts.views3d || wantPdf) {
      try {
        session = await BrowserSession.launch();
        out.browser = session.path;
      } catch (e) {
        out.errors.push(`${(e as Error).message} Sin navegador no se incluyen las vistas 3D${wantPdf ? " ni se genera el PDF" : ""}.`);
      }
    }
    if (session && opts.views3d) {
      try {
        const v = await render3dViews(session, project, work);
        images.views = v.views;
        images.viewEnv = v.viewEnv;
      } catch (e) {
        out.errors.push(`Vistas 3D: ${(e as Error).message}`);
      }
    }

    const model = buildReportModel(project, result, images) as Obj;
    mkdirSync(opts.outputDir, { recursive: true });
    const base = (opts.fileName || model.fileName).replace(/[\\/:*?"<>|]+/g, "").trim() || "Memoria-cargas";
    out.figures = [
      ...images.views.map((v: Img) => `vista 3D ${String(v.caption).replace(/^Figura: (.*?) – .*$/, "$1")}`),
      ...(images.viewEnv ? ["vista 3D de la envolvente"] : []),
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
    if (opts.formats.includes("html") || (wantPdf && session)) {
      const html = printableHtml(model);
      if (opts.formats.includes("html")) {
        const p = freePath(opts.outputDir, base, "html");
        writeFileSync(p, html, "utf8");
        out.files.push({ format: "html", path: p });
      }
      if (wantPdf && session) {
        try {
          const tmpHtml = join(work, "reporte.html");
          writeFileSync(tmpHtml, html, "utf8");
          await session.goto(pathToFileURL(tmpHtml).href);
          await session.evaluate("document.fonts.ready.then(() => true)");
          const pdf = await session.printToPdf(footerTemplate(model.title));
          const p = freePath(opts.outputDir, base, "pdf");
          writeFileSync(p, pdf);
          out.files.push({ format: "pdf", path: p });
        } catch (e) {
          out.errors.push(`PDF: ${(e as Error).message}`);
        }
      }
    }
  } finally {
    await session?.close();
    rmSync(work, { recursive: true, force: true });
  }
  return out;
}
