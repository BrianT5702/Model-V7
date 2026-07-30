"""Prototype: extract wall centerlines from United Panel PDF green vectors."""
import math
import os
import re
import sys

import fitz
import pytesseract
from PIL import Image
import io

for p in [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
]:
    if os.path.exists(p):
        pytesseract.pytesseract.tesseract_cmd = p
        break

pdf_path = r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 C (R1) - RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf"
page = fitz.open(pdf_path)[0]


def is_green(c):
    return c and len(c) >= 3 and c[1] >= 0.7 and c[0] <= 0.35 and c[2] <= 0.45


segs = []
for dr in page.get_drawings():
    if not is_green(dr.get("color")):
        continue
    for it in dr.get("items", []):
        if it[0] != "l":
            continue
        p1, p2 = it[1], it[2]
        L = math.hypot(p2.x - p1.x, p2.y - p1.y)
        if L < 5:
            continue
        segs.append({"x1": p1.x, "y1": p1.y, "x2": p2.x, "y2": p2.y, "len": L})

# Floor plan: left cluster, upper portion
left = [
    s
    for s in segs
    if (s["x1"] + s["x2"]) / 2 < 320 and (s["y1"] + s["y2"]) / 2 < 430
]
print("candidate segs", len(left))


def unit_dir(s):
    dx, dy = s["x2"] - s["x1"], s["y2"] - s["y1"]
    L = math.hypot(dx, dy) or 1
    ux, uy = dx / L, dy / L
    if ux < -1e-9 or (abs(ux) < 1e-9 and uy < 0):
        ux, uy = -ux, -uy
    return ux, uy, L


def mid(s):
    return ((s["x1"] + s["x2"]) / 2, (s["y1"] + s["y2"]) / 2)


def proj_range(s, ux, uy):
    p1 = s["x1"] * ux + s["y1"] * uy
    p2 = s["x2"] * ux + s["y2"] * uy
    return min(p1, p2), max(p1, p2)


used = set()
walls = []
THICK_PDF_MIN, THICK_PDF_MAX = 0.8, 6.0
for i, a in enumerate(left):
    if i in used:
        continue
    aux, auy, aL = unit_dir(a)
    amx, amy = mid(a)
    best = None
    for j, b in enumerate(left):
        if j <= i or j in used:
            continue
        bux, buy, bL = unit_dir(b)
        cross = abs(aux * buy - auy * bux)
        dot = abs(aux * bux + auy * buy)
        if cross > 0.08 or dot < 0.98:
            continue
        bmx, bmy = mid(b)
        perp = abs((bmx - amx) * (-auy) + (bmy - amy) * aux)
        if perp < THICK_PDF_MIN or perp > THICK_PDF_MAX:
            continue
        ar = proj_range(a, aux, auy)
        br = proj_range(b, aux, auy)
        overlap = max(0, min(ar[1], br[1]) - max(ar[0], br[0]))
        if overlap < min(aL, bL) * 0.4:
            continue
        score = overlap - abs(aL - bL) * 0.1
        if best is None or score > best[0]:
            best = (score, j, b, perp, ar, br)
    if not best:
        continue
    _, j, b, perp, ar, br = best
    used.add(i)
    used.add(j)
    lo, hi = max(ar[0], br[0]), min(ar[1], br[1])
    bmx, bmy = mid(b)
    cx = (amx + bmx) / 2
    cy = (amy + bmy) / 2
    c_along = cx * aux + cy * auy

    def point_at(t):
        return (cx + (t - c_along) * aux, cy + (t - c_along) * auy)

    x1, y1 = point_at(lo)
    x2, y2 = point_at(hi)
    walls.append(
        {
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "len": hi - lo,
            "thick_pdf": perp,
        }
    )

print("paired walls", len(walls))
for w in sorted(walls, key=lambda w: -w["len"]):
    print(
        round(w["len"], 1),
        "thick",
        round(w["thick_pdf"], 2),
        (round(w["x1"], 1), round(w["y1"], 1), round(w["x2"], 1), round(w["y2"], 1)),
    )

xs = [w["x1"] for w in walls] + [w["x2"] for w in walls]
ys = [w["y1"] for w in walls] + [w["y2"] for w in walls]
bw = max(xs) - min(xs)
bh = max(ys) - min(ys)
print("bbox w/h", round(bw, 1), round(bh, 1))

# OCR dims
pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5))
img = Image.open(io.BytesIO(pix.tobytes("png")))
data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
PANEL_SIZES = {1130, 1150, 1200, 600, 680, 684, 659, 933}
wall_dims = []
panel_dims = []
for i, t in enumerate(data["text"]):
    t = (t or "").strip()
    if not t:
        continue
    conf = int(float(data["conf"][i])) if str(data["conf"][i]).lstrip("-").isdigit() else -1
    if conf < 40:
        continue
    m = re.fullmatch(r"(\d{3,5})", t)
    if not m:
        continue
    val = int(m.group(1))
    entry = {
        "value": val,
        "x": data["left"][i] / 2.5,
        "y": data["top"][i] / 2.5,
        "text": t,
    }
    if val in PANEL_SIZES or 1000 <= val <= 1200:
        panel_dims.append(entry)
    elif val >= 1300:
        wall_dims.append(entry)

print("wall-like dims", sorted({d["value"] for d in wall_dims}))
print("panel-like dims", sorted({d["value"] for d in panel_dims}))

# scale from overall width OCR 13293 if present
overall = max((d["value"] for d in wall_dims), default=None)
# prefer 13293-ish
cands = [d["value"] for d in wall_dims if 10000 <= d["value"] <= 20000]
overall = cands[0] if cands else overall
if overall and bw > 0:
    scale = overall / bw
    print("scale", scale, "from overall", overall)
    print("model height", round(bh * scale))
    print(
        "wall lengths mm",
        sorted([round(w["len"] * scale) for w in walls], reverse=True),
    )
    print(
        "thickness mm",
        sorted({round(w["thick_pdf"] * scale) for w in walls}),
    )
