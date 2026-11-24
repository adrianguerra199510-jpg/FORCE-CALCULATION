// Página del visor 3D que se ejecuta dentro de Edge/Chrome sin interfaz (empaquetada como dist/viewer-bundle.js).
// Usa el mismo visor de la app (src/renderer/viewer3d.js) y reproduce collectImages() de src/renderer/app.js:
// una vista por caso de carga + la envolvente de viento sin entorno.
import { Viewer } from "../../src/renderer/viewer3d.js";
import { compute } from "../../src/calc/typologies.js";
import { Kzt } from "../../src/calc/wind.js";
import type { Obj } from "./format.js";

// Copias de loadCaseList y windDirFor de src/renderer/app.js (no se exportan allí).
function loadCaseList(res: Obj): [string, string, string][] {
  switch (res.typology) {
    case "edificio": return [["wx", "Viento X", "wind"], ["wy", "Viento Y", "wind"], ["env", "Envolvente", "env"], ["sx", "Sismo X", "quake"], ["sy", "Sismo Y", "quake"]];
    case "nave": return [["wt", "Viento transversal", "wind"], ["wl", "Viento longitudinal", "wind"], ["env", "Envolvente", "env"], ["sx", "Sismo X", "quake"], ["sy", "Sismo Y", "quake"]];
    case "generico": return [["wx", "Viento X", "wind"], ["wy", "Viento Y", "wind"], ["env", "Envolvente", "env"], ["s", "Sismo", "quake"]];
    case "valla": return [["wA", "Viento casos A/B", "wind"], ...(res.wind.caseC ? [["wC", "Viento caso C", "wind"] as [string, string, string]] : []), ["s", "Sismo", "quake"]];
    default: return [["w", "Viento", "wind"], ["s", "Sismo", "quake"]];
  }
}

function windDirFor(project: Obj, r: Obj, lc: string): Obj | null {
  const t = project.wind.topo;
  const parallel2D = t.enabled && t.type !== "hill3D";
  const W = (axis: string, sign: number, kzt = true) => ({ kind: "wind", axis, sign, kztApplies: kzt, label: `Viento ${axis === "X" ? "X" : "Y"}` });
  const Q = (axis: string, sign: number) => ({ kind: "quake", axis, sign, label: `Sismo ${axis === "X" ? "X" : "Y"}` });
  switch (r.typology) {
    case "edificio":
      return ({ wx: W("X", 1), wy: W("Z", -1, !parallel2D), sx: Q("X", 1), sy: Q("Z", -1) } as Obj)[lc] || null;
    case "generico":
      return ({ wx: W("X", 1), wy: W("Z", -1, !parallel2D), s: Q("X", 1) } as Obj)[lc] || null;
    case "nave":
      return ({ wt: W("X", 1), wl: W("Z", 1, !parallel2D), sx: Q("X", 1), sy: Q("Z", -1) } as Obj)[lc] || null;
    case "valla":
      return lc === "s" ? Q("Z", -1) : W("Z", -1);
    default:
      return lc === "s" ? Q("X", 1) : W("X", 1);
  }
}

interface ViewImg {
  data: string;
  ratio: number;
  caption?: string;
}

async function renderViews(project: Obj): Promise<{ views: ViewImg[]; viewEnv: ViewImg | null }> {
  // Las etiquetas del visor se dibujan en canvas con Barlow Semi Condensed: esperar la fuente.
  await Promise.all([document.fonts.load('600 20px "Barlow Semi Condensed"'), document.fonts.load('600 20px "Barlow"')]).catch(() => undefined);
  const viewer = new Viewer(document.getElementById("viewer") as HTMLElement) as Obj;
  const r = compute(project) as Obj;
  viewer.setModel(r);
  const t = project.wind.topo;
  const exp = project.wind.exposure;
  viewer.setTerrain(t, { kztBase: Kzt(0, exp, t), kztTop: Kzt(r.H, exp, t) });
  viewer.setEnvironment({ show: true, exposure: exp, topoActive: t.enabled && +t.H > 0 && +t.Lh > 0 ? t : null });
  viewer.resetCamera();
  viewer.controls.update();

  const out: { views: ViewImg[]; viewEnv: ViewImg | null } = { views: [], viewEnv: null };
  for (const [lc, label, kind] of loadCaseList(r)) {
    const wd = lc === "env" ? { kind: "none", axis: "X", sign: 1, label: "" } : windDirFor(project, r, lc);
    if (wd) viewer.setWindDir(wd);
    viewer.setLoadCase(lc, { internal: "pos", roofCase: "A" });
    if (kind === "env") {
      // como en la app: la envolvente se captura sin entorno y con la cámara cerca
      viewer.setEnvironment({ show: false });
      viewer.resetCamera();
      viewer.controls.update();
      out.viewEnv = { data: viewer.snapshot(1400, 840), ratio: 0.6 };
      viewer.setEnvironment({ show: true });
      viewer.resetCamera();
      viewer.controls.update();
    } else {
      out.views.push({
        data: viewer.snapshot(1400, 840),
        ratio: 0.6,
        caption: `Figura: ${label} – ${kind === "wind" ? "cargas de viento (nivel de servicio)" : "fuerzas sísmicas (nivel de resistencia)"}.`,
      });
    }
  }
  return out;
}

(window as unknown as Obj).renderViews = renderViews;
