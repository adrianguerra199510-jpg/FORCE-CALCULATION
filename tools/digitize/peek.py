"""Recorta la(s) hoja(s) alrededor de un punto lon/lat para verificar visualmente.
Uso: python3 -I peek.py <dig_dir> <grid.json> <param> <lon> <lat> <out.png> [radio_px]"""
import json, sys, cv2
dig, gridf, param, lon, lat, out = sys.argv[1:7]
r = int(sys.argv[7]) if len(sys.argv) > 7 else 350
lon, lat = float(lon), float(lat)
g = json.load(open(gridf))
tiles = []
for n, sh in g["sheets"].items():
    x = (lon - sh["fx"]["b"]) / sh["fx"]["a"]
    y = (lat - sh["fy"]["b"]) / sh["fy"]["a"]
    x0, y0, x1, y1 = sh["frame"]
    if x0 <= x <= x1 and y0 <= y <= y1:
        im = cv2.imread(f"{dig}/{param}-{int(n):02d}.png")
        if im.shape[1] > im.shape[0]:
            im = cv2.rotate(im, cv2.ROTATE_90_CLOCKWISE)
        x, y = int(x), int(y)
        cv2.circle(im, (x, y), 14, (0, 0, 255), 4)
        cv2.line(im, (x - 30, y), (x + 30, y), (0, 0, 255), 2)
        cv2.line(im, (x, y - 30), (x, y + 30), (0, 0, 255), 2)
        c = im[max(0, y - r):y + r, max(0, x - r):x + r]
        cv2.putText(c, f"{param}-{n}", (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 0, 0), 3)
        tiles.append(c)
if tiles:
    h = min(t.shape[0] for t in tiles)
    cv2.imwrite(out, cv2.hconcat([t[:h] for t in tiles]))
print(len(tiles), "hojas")
