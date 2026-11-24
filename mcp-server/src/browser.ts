// Sesión de Edge / Chrome / Chromium sin interfaz controlada por el protocolo DevTools (CDP) sobre
// --remote-debugging-pipe, sin dependencias externas. Se usa para:
//   - capturar las vistas 3D con el visor WebGL de la app (SwiftShader: no requiere tarjeta gráfica)
//   - imprimir el reporte a PDF con Page.printToPDF (mismos parámetros que la app de Electron)
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

/** Variable de entorno definida (ignora plantillas sin resolver como "${user_config.x}"). */
export const envVar = (k: string): string | undefined => {
  const v = process.env[k]?.trim();
  return v && !v.includes("${") ? v : undefined;
};

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

export const NO_BROWSER =
  "No se encontró Microsoft Edge, Google Chrome ni Chromium. Instale uno de ellos o indique su ruta en la configuración " +
  "de la extensión (variable FORCECALC_BROWSER).";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; method: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

export class BrowserSession {
  private proc: ChildProcess;
  private input: Writable;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners: ((msg: { method: string; params: unknown; sessionId?: string }) => void)[] = [];
  private exited: Promise<void>;
  private stderr = "";
  private dead: Error | null = null;
  sessionId = "";

  private constructor(readonly path: string, private readonly profile: string) {
    const args = [
      "--headless",
      "--remote-debugging-pipe",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--hide-scrollbars",
      "--mute-audio",
      // WebGL por software, igual en cualquier equipo (con o sin GPU)
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--force-device-scale-factor=1",
      "--window-size=1500,1000",
    ];
    if (platform() === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
    args.push("about:blank");
    this.proc = spawn(path, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], windowsHide: true });
    this.input = this.proc.stdio[3] as Writable;
    const output = this.proc.stdio[4] as Readable;
    (this.proc.stderr as Readable).on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-2000);
    });
    let buf = "";
    output.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\0")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 1);
        this.dispatch(JSON.parse(raw));
      }
    });
    // Un navegador que no arranca o se cierra no debe tumbar el servidor: todo error termina la sesión.
    const fail = (e: Error) => {
      this.dead ??= new Error(`${e.message}${this.stderr ? ` — ${this.stderr.trim().slice(-400)}` : ""}`);
      for (const p of this.pending.values()) p.reject(this.dead);
      this.pending.clear();
    };
    for (const stream of [this.input, output, this.proc.stderr as Readable]) stream.on("error", (e: Error) => fail(e));
    this.exited = new Promise((ok) => this.proc.once("exit", () => ok()));
    this.proc.once("exit", (code) => fail(new Error(`El navegador se cerró (código ${code})`)));
    this.proc.once("error", (e) => fail(e));
  }

  private dispatch(msg: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown; sessionId?: string }) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const l of this.listeners) l({ method: msg.method, params: msg.params, sessionId: msg.sessionId });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(method: string, params: object = {}, opts: { session?: boolean; timeoutMs?: number } = {}): Promise<any> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    const msg: Obj = { id, method, params };
    if (opts.session !== false && this.sessionId) msg.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`El navegador no respondió a ${method} en ${(opts.timeoutMs ?? 60_000) / 1000} s.`));
      }, opts.timeoutMs ?? 60_000);
      this.pending.set(id, {
        method,
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.input.write(JSON.stringify(msg) + "\0");
    });
  }

  private waitEvent(method: string, timeoutMs = 60_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== fn);
        reject(new Error(`Tiempo agotado esperando ${method}.`));
      }, timeoutMs);
      const fn = (m: { method: string; params: unknown; sessionId?: string }) => {
        if (m.method === method && m.sessionId === this.sessionId) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((l) => l !== fn);
          resolve(m.params);
        }
      };
      this.listeners.push(fn);
    });
  }

  static async launch(): Promise<BrowserSession> {
    const path = findBrowser();
    if (!path) throw new Error(NO_BROWSER);
    const s = new BrowserSession(path, mkdtempSync(join(tmpdir(), "fc-browser-")));
    try {
      const { targetId } = await s.send("Target.createTarget", { url: "about:blank" }, { session: false, timeoutMs: 30_000 });
      const { sessionId } = await s.send("Target.attachToTarget", { targetId, flatten: true }, { session: false });
      s.sessionId = sessionId;
      await s.send("Page.enable");
      await s.send("Runtime.enable");
    } catch (e) {
      await s.close();
      throw new Error(`No se pudo iniciar el navegador (${path}): ${(e as Error).message}`);
    }
    return s;
  }

  async goto(url: string): Promise<void> {
    const loaded = this.waitEvent("Page.loadEventFired");
    const r = await this.send("Page.navigate", { url });
    if (r.errorText) throw new Error(`No se pudo abrir ${url}: ${r.errorText}`);
    await loaded;
  }

  /** Evalúa una expresión (puede devolver una promesa) y retorna su valor serializado. */
  async evaluate<T>(expression: string, timeoutMs = 120_000): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, { timeoutMs });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || "Error en la página");
    }
    return r.result.value as T;
  }

  async printToPdf(footerTemplate: string): Promise<Buffer> {
    const r = await this.send(
      "Page.printToPDF",
      {
        paperWidth: 8.5,
        paperHeight: 11,
        printBackground: true,
        marginTop: 0.6,
        marginBottom: 0.6,
        marginLeft: 0.7,
        marginRight: 0.7,
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate,
      },
      { timeoutMs: 120_000 },
    );
    return Buffer.from(r.data, "base64");
  }

  async close(): Promise<void> {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) {
      rmSync(this.profile, { recursive: true, force: true });
      return;
    }
    try {
      await this.send("Browser.close", {}, { session: false, timeoutMs: 5_000 });
    } catch {
      /* se fuerza abajo */
    }
    const killed = setTimeout(() => this.proc.kill(), 5_000);
    await Promise.race([this.exited, new Promise((ok) => setTimeout(ok, 8_000))]);
    clearTimeout(killed);
    try {
      rmSync(this.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    } catch {
      /* perfil temporal: se limpia con el sistema */
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = { [k: string]: any };
