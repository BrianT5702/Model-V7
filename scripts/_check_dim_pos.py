import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.pdf_wall_import import extract_walls_from_pdf_bytes

r = extract_walls_from_pdf_bytes(
    open(
        r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf",
        "rb",
    ).read()
)
for d in r["dimensions"]["wall"]:
    if d["value_mm"] in (2900, 4485, 4400, 4271, 19900, 17041):
        print(d)
