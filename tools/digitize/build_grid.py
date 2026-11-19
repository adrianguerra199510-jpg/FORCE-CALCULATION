"""
Construye la grilla de Ss y S1 a partir de las etiquetas digitalizadas.

Uso:
    python3 -I build_grid.py <dig_dir> <salida.json> [<sheets_meta.json>]

- Unifica la georreferencia de cada hoja (Ss-n y S1-n cubren la misma zona).
- Filtra lecturas OCR fuera de rango y atípicos espaciales (plano local).
- Interpola linealmente (triangulación de Delaunay) a una grilla de 0.01°,
  con vecino más cercano fuera de la envolvente convexa.
- Guarda también la distancia a la etiqueta más cercana (indicador de confianza).
"""
import json
import os
import sys

import numpy as np
from scipy.interpolate import LinearNDInterpolator, NearestNDInterpolator
from scipy.spatial import cKDTree

RANGES = {"Ss": (0.1, 3.0), "S1": (0.03, 1.6)}
TOL = {"Ss": 0.08, "S1": 0.04}
GRID = {"lon0": -83.10, "lon1": -77.10, "lat0": 7.00, "lat1": 9.70, "step": 0.01}
KM_PER_DEG = 111.0


def best_axis(cands):
    good = [c for c in cands if c and not c.get("fixed_scale") and c["n"] >= 2]
    if good:
        return max(good, key=lambda c: (c["n"], -c["maxres"]))
    good = [c for c in cands if c]
    return good[0] if good else None


def load(dig):
    sheets = {}
    for n in range(1, 37):
        rs = {p: json.load(open(os.path.join(dig, f"{p}-{n:02d}.json"))) for p in ("Ss", "S1")}
        fx = best_axis([rs["Ss"]["fx"], rs["S1"]["fx"]])
        fy = best_axis([rs["Ss"]["fy"], rs["S1"]["fy"]])
        sheets[n] = {"fx": fx, "fy": fy, "frame": rs["Ss"]["frame"], "size": rs["Ss"]["size"],
                     "labels": {p: rs[p]["labels"] for p in rs}}
    return sheets


def to_lonlat(sh, px):
    return (sh["fx"]["a"] * px[0] + sh["fx"]["b"], sh["fy"]["a"] * px[1] + sh["fy"]["b"])


def points(sheets, param):
    lo, hi = RANGES[param]
    P = []
    for n, sh in sheets.items():
        for l in sh["labels"][param]:
            if l["conf"] < 30 or not (lo <= l["v"] <= hi):
                continue
            lon, lat = to_lonlat(sh, l["px"])
            P.append((lon, lat, l["v"], n))
    return np.array(P)


CONFUSIONS = {"4": "1", "1": "4", "3": "8", "8": "36", "6": "58", "5": "6"}


def repair(v, pred, lim):
    """Prueba sustituir un dígito por su confusión típica de OCR (1<->4, 3<->8, 5<->6...)."""
    t = f"{v:.2f}".rstrip("0").rstrip(".")
    best = None
    for k, ch in enumerate(t):
        for alt in CONFUSIONS.get(ch, ""):
            try:
                a = float(t[:k] + alt + t[k + 1:])
            except ValueError:
                continue
            if abs(a - pred) < lim * 0.5 and (best is None or abs(a - pred) < abs(best - pred)):
                best = a
    return best


fixed = []


def filter_outliers(P, param, rounds=3):
    P = P.copy()
    keep = np.ones(len(P), bool)
    for _ in range(rounds):
        idx = np.where(keep)[0]
        Q = P[idx]
        xy = np.c_[Q[:, 0], Q[:, 1]]
        tree = cKDTree(xy)
        drop = []
        for i, (x, y, v, _) in enumerate(Q):
            d, j = tree.query([x, y], k=min(11, len(Q)))
            j = [jj for jj, dd in zip(j, d) if jj != i and dd < 0.15]
            if len(j) < 4:
                continue
            A = np.c_[xy[j] - [x, y], np.ones(len(j))]
            coef, *_ = np.linalg.lstsq(A, Q[j, 2], rcond=None)
            pred = coef[2]
            resid = Q[j, 2] - A @ coef
            mad = np.median(np.abs(resid)) * 1.4826
            lim = max(TOL[param], 4 * mad)
            if abs(v - pred) > lim:
                alt = repair(v, pred, lim)
                if alt is not None:
                    P[idx[i], 2] = alt
                    fixed.append((float(x), float(y), float(v), alt))
                else:
                    drop.append(idx[i])
        if not drop:
            break
        keep[drop] = False
    return P[keep], P[~keep]


def grid(P):
    g = GRID
    lons = np.round(np.arange(g["lon0"], g["lon1"] + 1e-9, g["step"]), 4)
    lats = np.round(np.arange(g["lat0"], g["lat1"] + 1e-9, g["step"]), 4)
    X, Y = np.meshgrid(lons, lats)
    xy = np.c_[P[:, 0], P[:, 1]]
    # Puntos duplicados (misma posición en hojas vecinas): promediar
    lin = LinearNDInterpolator(xy, P[:, 2])
    near = NearestNDInterpolator(xy, P[:, 2])
    Z = lin(X, Y)
    nanm = np.isnan(Z)
    Z[nanm] = near(X[nanm], Y[nanm])
    d, _ = cKDTree(xy).query(np.c_[X.ravel(), Y.ravel()])
    D = (d * KM_PER_DEG).reshape(X.shape)
    return lons, lats, Z, D


def main():
    dig, out = sys.argv[1], sys.argv[2]
    sheets = load(dig)
    res = {"source": "REP-2014 MAPAS (JTIA) - digitalización automática de etiquetas de contorno",
           "grid": GRID, "params": {}}
    report = {}
    for param in ("Ss", "S1"):
        P = points(sheets, param)
        fixed.clear()
        K, Dr = filter_outliers(P, param)
        lons, lats, Z, D = grid(K)
        res["params"][param] = {
            "nlon": len(lons), "nlat": len(lats),
            # fila por latitud (de sur a norte), valores en milésimas de g
            "values": [int(round(z * 1000)) for z in Z.ravel()],
            "dist_km": [int(round(min(d, 250))) for d in D.ravel()],
            "points": [[round(p[0], 4), round(p[1], 4), p[2]] for p in K],
        }
        report[param] = {"total": len(P), "kept": len(K), "dropped": len(Dr),
                         "repaired": list(fixed),
                         "dropped_samples": [[round(a, 3), round(b, 3), c, int(s)] for a, b, c, s in Dr[:40]]}
        print(param, report[param]["total"], "puntos;", report[param]["dropped"], "descartados;",
              len(fixed), "corregidos")
    res["sheets"] = {n: {"fx": s["fx"], "fy": s["fy"], "frame": s["frame"], "size": s["size"]}
                     for n, s in sheets.items()}
    with open(out, "w") as f:
        json.dump(res, f, separators=(",", ":"))
    with open(out.replace(".json", "-report.json"), "w") as f:
        json.dump(report, f, indent=1)


if __name__ == "__main__":
    main()
