import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fitz
from core import pdf_wall_import as pwi

pdf = open(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf",
    "rb",
).read()
page = fitz.open(stream=pdf, filetype="pdf")[0]
labels = pwi._ocr_dimension_labels(page)
print("all label values", sorted({d["value_mm"] for d in labels}))
print("height-ish:")
for d in labels:
    if d["value_mm"] in (2500, 2700, 2800, 2900, 3000) or "HT" in str(d.get("text", "")).upper() or "2900" in str(d.get("text", "")):
        print(" ", d)

# Also raw tesseract lines containing 2900 / HT
import pytesseract, os, io
from PIL import Image

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
img = Image.open(io.BytesIO(pix.tobytes("png")))
text = pytesseract.image_to_string(img)
for line in text.splitlines():
    if any(k in line.upper() for k in ("2900", "2500", "HT", "EXT", "19900", "13983", "5922")):
        print("OCR line:", line)
