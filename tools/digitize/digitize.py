"""
Digitaliza los mapas de aceleraciones espectrales del REP (Ss, S1) a puntos
georreferenciados (lon, lat, valor).

Uso:
    python3 -I digitize.py <mapas.pdf> <salida_dir> [--param Ss|S1] [--sheets 1-36]

Proceso por hoja:
 1. Renderiza la página a 300 dpi y la endereza (las hojas vienen giradas).
 2. Georreferencia: lee con OCR las etiquetas de la graticula (78°40'0"W, 8°20'0"N)
    alrededor del marco y ajusta x->lon, y->lat por mínimos cuadrados.
 3. Detecta las etiquetas amarillas de los contornos, las endereza y las lee con OCR.
 4. Guarda JSON con los puntos de la hoja.

Estructura del PDF "REP-2014 MAPAS.pdf" (114 páginas):
   1-38  PGA   (1 índice, 2 vista A/B, 3..38 hojas 1..36)
   39-76 S1
   77-114 Ss
"""
import json
import os
import re
import subprocess
import sys
import tempfile

import cv2
import numpy as np

PAGE_OFFSET = {"PGA": 2, "S1": 40, "Ss": 78}  # página = offset + hoja
DPI = 300


def render(pdf, page, out_png):
    base = out_png[:-4]
    subprocess.run(["pdftoppm", "-r", str(DPI), "-f", str(page), "-l", str(page),
                    "-singlefile", "-png", pdf, base], check=True)
    im = cv2.imread(out_png)
    # Las hojas se renderizan apaisadas con el título girado; se endereza.
    if im.shape[1] > im.shape[0]:
        im = cv2.rotate(im, cv2.ROTATE_90_CLOCKWISE)
    return im


def tesseract_tsv(img, psm=11, whitelist=None, lang="eng"):
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "i.png")
        cv2.imwrite(p, img)
        cmd = ["tesseract", p, "stdout", "-l", lang, "--psm", str(psm)]
        if whitelist:
            cmd += ["-c", f"tessedit_char_whitelist={whitelist}"]
        cmd += ["tsv"]
        env = dict(os.environ, OMP_THREAD_LIMIT="1")
        r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    rows = []
    lines = r.stdout.splitlines()
    if not lines:
        return rows
    hdr = lines[0].split("\t")
    for ln in lines[1:]:
        f = ln.split("\t")
        if len(f) != len(hdr):
            continue
        d = dict(zip(hdr, f))
        if d["text"].strip() == "":
            continue
        for k in ("left", "top", "width", "height", "block_num", "par_num", "line_num", "word_num"):
            d[k] = int(d[k])
        d["conf"] = float(d["conf"])
        rows.append(d)
    return rows


# --------------------------------------------------------------------------
# Georreferenciación
# --------------------------------------------------------------------------
DEG_RE = re.compile(r"(\d{1,2})\D{1,2}(\d{1,2})\D{1,3}0?\D{0,3}([NWnw])")


def parse_deg(text):
    t = text.replace("O", "0").replace("o", "0")
    m = DEG_RE.search(t)
    if not m:
        return None
    d, mi, h = int(m.group(1)), int(m.group(2)), m.group(3).upper()
    if mi % 10 != 0 or mi >= 60:
        return None
    v = d + mi / 60.0
    if h == "W":
        if not (76 <= d <= 84):
            return None
        return ("lon", -v)
    if not (6 <= d <= 10):
        return None
    return ("lat", v)


def find_frame(im):
    """Marco del mapa: rectángulo negro grande en la parte superior de la hoja."""
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    _, bw = cv2.threshold(g, 80, 255, cv2.THRESH_BINARY_INV)
    H, W = g.shape
    # líneas horizontales largas
    hk = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (W // 3, 1)))
    vk = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, H // 4)))
    rows = np.where(hk.sum(axis=1) > 0)[0]
    cols = np.where(vk.sum(axis=0) > 0)[0]
    return rows, cols


def georef(im):
    """Devuelve (fx, fy): x->lon, y->lat lineales, y la lista de marcas usadas."""
    H, W = im.shape[:2]
    marks = []
    # Etiquetas horizontales (longitudes) en toda la hoja superior
    top = im[: int(H * 0.80)]
    for d in tesseract_tsv(top, psm=11):
        p = parse_deg(d["text"])
        if p and p[0] == "lon":
            cx = d["left"] + d["width"] / 2
            marks.append(("lon", p[1], cx, d["top"] + d["height"] / 2))
    # Etiquetas verticales (latitudes): girar la hoja 90° en ambos sentidos
    for rot, back in ((cv2.ROTATE_90_CLOCKWISE, "cw"), (cv2.ROTATE_90_COUNTERCLOCKWISE, "ccw")):
        r = cv2.rotate(top, rot)
        for d in tesseract_tsv(r, psm=11):
            p = parse_deg(d["text"])
            if p and p[0] == "lat":
                cx = d["left"] + d["width"] / 2
                cy = d["top"] + d["height"] / 2
                # coordenadas de vuelta a la imagen original "top"
                th, tw = top.shape[:2]
                if back == "cw":  # rotado 90 cw: (x', y') = (th-1-y, x)
                    y0 = th - 1 - cx
                    x0 = cy
                else:  # ccw: (x', y') = (y, tw-1-x)
                    y0 = cx
                    x0 = tw - 1 - cy
                marks.append(("lat", p[1], x0, y0))
    lons = [(v, x) for k, v, x, y in marks if k == "lon"]
    lats = [(v, y) for k, v, x, y in marks if k == "lat"]
    fx = fit(lons) or fit_offset(lons, LON_SCALE)
    fy = fit(lats) or fit_offset(lats, LAT_SCALE)
    return fx, fy, marks


# Escala común de todas las hojas a 300 dpi (1:400,000), medida en hojas con ajuste completo.
LON_SCALE = 0.0003075
LAT_SCALE = -0.0003057


def fit_offset(pairs, a):
    """Con escala conocida, ajusta sólo el desplazamiento (basta 1 marca)."""
    if not pairs:
        return None
    bs = sorted(v - a * x for v, x in pairs)
    b = bs[len(bs) // 2]
    res = max(abs(a * x + b - v) for v, x in pairs)
    return {"a": a, "b": float(b), "maxres": float(res), "n": len(pairs), "fixed_scale": True}


def fit(pairs):
    """Ajuste lineal robusto valor = a*pix + b, descartando atípicos."""
    if len(pairs) < 2:
        return None
    v = np.array([p[0] for p in pairs])
    x = np.array([p[1] for p in pairs])
    # Agrupar por valor (la misma marca aparece arriba y abajo)
    best = None
    for _ in range(3):
        A = np.vstack([x, np.ones_like(x)]).T
        a, b = np.linalg.lstsq(A, v, rcond=None)[0]
        res = np.abs(A @ [a, b] - v)
        best = (a, b, res.max(), len(v))
        if res.max() < 0.01 or len(v) <= 2:
            break
        keep = res < max(np.median(res) * 3, 0.01)
        if keep.sum() < 2:
            break
        v, x = v[keep], x[keep]
    if len(set(np.round(v, 4))) < 2:
        return None
    return {"a": float(best[0]), "b": float(best[1]), "maxres": float(best[2]), "n": int(best[3])}


# --------------------------------------------------------------------------
# Etiquetas de contorno
# --------------------------------------------------------------------------
VAL_RE = re.compile(r"^\d(\.\d{1,2})?$")


def label_crops(im, frame_box):
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, (20, 100, 150), (40, 255, 255))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    x0, y0, x1, y1 = frame_box
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        a = cv2.contourArea(c)
        if a < 300 or a > 6000:
            continue
        (cx, cy), (w, h), ang = cv2.minAreaRect(c)
        if not (x0 < cx < x1 and y0 < cy < y1):
            continue
        if w < h:
            w, h = h, w
            ang += 90
        if h < 12 or w / h > 4.5:
            continue
        M = cv2.getRotationMatrix2D((cx, cy), ang, 1.0)
        rot = cv2.warpAffine(im, M, (im.shape[1], im.shape[0]), flags=cv2.INTER_CUBIC,
                             borderValue=(255, 255, 255))
        ww, hh = int(w) + 2, int(h) + 2
        crop = rot[int(cy - hh / 2):int(cy + hh / 2), int(cx - ww / 2):int(cx + ww / 2)]
        if crop.size == 0:
            continue
        g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        hc = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        out.append({"cx": float(cx), "cy": float(cy), "gray": g, "sat": hc[:, :, 1]})
    return out


def variants(c):
    """Variantes de preprocesado de una etiqueta (para votar entre lecturas OCR)."""
    g, sat = c["gray"], c["sat"]
    txt = (g < 110) & (sat < 200) | (g < 70)
    b = np.where(txt, 0, 255).astype(np.uint8)
    out = []
    for f in (2.5, 3.5):
        r = cv2.resize(b, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
        _, r = cv2.threshold(r, 128, 255, cv2.THRESH_BINARY)
        out.append(r)
    # escala de grises normalizada (el amarillo queda claro)
    n = cv2.normalize(g, None, 0, 255, cv2.NORM_MINMAX)
    out.append(cv2.resize(n, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC))
    # binario adelgazado (separa trazos que se pegan, p. ej. el "1" con banderita)
    er = cv2.dilate(cv2.resize(b, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC), np.ones((3, 3), np.uint8))
    out.append(er)
    return out


def ocr_batch(imgs, chunk=60):
    """Tesseract limita la altura de imagen (~32k px): procesar en lotes."""
    out = []
    for i in range(0, len(imgs), chunk):
        out += _ocr_batch(imgs[i:i + chunk])
    return out


def _ocr_batch(imgs):
    pad = 30
    width = max(i.shape[1] for i in imgs) + 2 * pad
    rows, ys = [], []
    y = 0
    for i in imgs:
        canvas = np.full((i.shape[0] + 2 * pad, width), 255, np.uint8)
        canvas[pad:pad + i.shape[0], pad:pad + i.shape[1]] = i
        rows.append(canvas)
        ys.append((y, y + canvas.shape[0]))
        y += canvas.shape[0]
    words = tesseract_tsv(np.vstack(rows), psm=6, whitelist="0123456789.")
    texts = [[] for _ in imgs]
    for w in words:
        cy = w["top"] + w["height"] / 2
        for k, (a, b) in enumerate(ys):
            if a <= cy < b:
                texts[k].append(w)
                break
    out = []
    for ws in texts:
        ws = sorted(ws, key=lambda w: w["left"])
        t = normalize("".join(w["text"] for w in ws))
        conf = min([w["conf"] for w in ws], default=0)
        out.append((t, conf) if t and VAL_RE.match(t) else (None, 0))
    return out


def ocr_labels(crops):
    """OCR por lotes con votación: varias variantes x 2 orientaciones por etiqueta."""
    if not crops:
        return []
    per = []
    imgs = []
    for c in crops:
        vs = variants(c)
        per.append(len(vs) * 2)
        for v in vs:
            imgs.append(v)
            imgs.append(cv2.rotate(v, cv2.ROTATE_180))
    reads = ocr_batch(imgs)
    res = []
    k = 0
    for c, n in zip(crops, per):
        rr = reads[k:k + n]
        k += n
        votes = {}
        # por variante, la orientación con mayor confianza
        for j in range(0, n, 2):
            cand = max(rr[j:j + 2], key=lambda r: r[1])
            if cand[0]:
                s_, c_ = votes.get(cand[0], (0, 0))
                votes[cand[0]] = (s_ + 1, c_ + cand[1])
        if not votes:
            continue
        t, (nv, sc) = max(votes.items(), key=lambda kv: kv[1])
        res.append({"cx": c["cx"], "cy": c["cy"], "value": float(t), "conf": sc / nv,
                    "text": t, "votes": nv, "nvar": n // 2})
    return res


def normalize(t):
    t = t.strip().strip(".")
    if re.fullmatch(r"\d{3}", t):  # '156' -> '1.56' (punto perdido)
        t = t[0] + "." + t[1:]
    if re.fullmatch(r"\d{2}", t) and t[0] in "01":  # '12' -> '1.2'
        t = t[0] + "." + t[1]
    return t


def frame_box(im):
    rows, cols = find_frame(im)
    H, W = im.shape[:2]
    # el marco del mapa está en el ~75% superior
    rows = rows[rows < H * 0.78]
    if len(rows) < 2 or len(cols) < 2:
        return (0, 0, W, int(H * 0.75))
    return (int(cols.min()) + 10, int(rows.min()) + 10, int(cols.max()) - 10, int(rows.max()) - 10)


def process_sheet(pdf, param, sheet, workdir):
    page = PAGE_OFFSET[param] + sheet
    png = os.path.join(workdir, f"{param}-{sheet:02d}.png")
    im = render(pdf, page, png)
    box = frame_box(im)
    fx, fy, marks = georef(im)
    crops = label_crops(im, box)
    labels = ocr_labels(crops)
    pts = []
    if fx and fy:
        for l in labels:
            lon = fx["a"] * l["cx"] + fx["b"]
            lat = fy["a"] * l["cy"] + fy["b"]
            pts.append({"lon": round(lon, 5), "lat": round(lat, 5), "v": l["value"],
                        "conf": l["conf"], "px": [round(l["cx"]), round(l["cy"])]})
    return {
        "param": param, "sheet": sheet, "page": page, "frame": box,
        "fx": fx, "fy": fy, "nmarks": len(marks), "ncrops": len(crops),
        "points": pts, "size": [im.shape[1], im.shape[0]],
        "labels": [{"px": [round(l["cx"]), round(l["cy"])], "v": l["value"], "conf": l["conf"],
                    "votes": l["votes"]}
                   for l in labels],
    }


def main():
    pdf, outdir = sys.argv[1], sys.argv[2]
    param = "Ss"
    sheets = list(range(1, 37))
    args = sys.argv[3:]
    if "--param" in args:
        param = args[args.index("--param") + 1]
    if "--sheets" in args:
        s = args[args.index("--sheets") + 1]
        if "-" in s:
            a, b = s.split("-")
            sheets = list(range(int(a), int(b) + 1))
        else:
            sheets = [int(x) for x in s.split(",")]
    os.makedirs(outdir, exist_ok=True)
    for sh in sheets:
        r = process_sheet(pdf, param, sh, outdir)
        with open(os.path.join(outdir, f"{param}-{sh:02d}.json"), "w") as f:
            json.dump(r, f)
        print(f"{param}-{sh:02d}: marks={r['nmarks']} fx={'ok' if r['fx'] else '--'} "
              f"fy={'ok' if r['fy'] else '--'} crops={r['ncrops']} pts={len(r['points'])}", flush=True)


if __name__ == "__main__":
    main()
