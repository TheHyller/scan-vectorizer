#!/usr/bin/env python3
"""Make a synthetic 'scanned' test sheet (raster PDF) with Slovak text and one
vertical label, to exercise OCR (incl. diacritics) and the 90-degree pass."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1700, 1150
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
bold = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 48)
reg = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 36)

d.text((90, 70), "Vykres c. 0005 — Podorys", fill="black", font=bold)
d.text((90, 175), "Mierka 1:50    Žltý kábel, šírka 12 mm", fill="black", font=reg)
d.text((90, 250), "Poznámka: tečúca voda, výška stropu 2,7 m", fill="black", font=reg)

d.rectangle([90, 360, 1420, 1060], outline="black", width=4)

# vertical label: rotate 90 deg CCW so it reads bottom-to-top, which the
# app's clockwise 90-degree OCR pass turns back into horizontal text.
vt = Image.new("RGBA", (520, 80), (255, 255, 255, 0))
ImageDraw.Draw(vt).text((0, 0), "REZ A-A ZVISLÝ POPIS", fill="black", font=bold)
vt = vt.rotate(90, expand=True)
img.paste(vt, (110, 470), vt)

img.save("test_scan.pdf", "PDF", resolution=200.0)
print("wrote test_scan.pdf")
