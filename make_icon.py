#!/usr/bin/env python3
"""Generate scan_vectorizer.ico (build-time only; needs Pillow).

A simple "scan -> vector" mark: a white sheet on a blue rounded tile, with an
orange traced polyline and dark node handles. Drawn big and downscaled so the
edges stay smooth at small sizes."""
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# rounded blue tile
m = int(S * 0.05)
d.rounded_rectangle([m, m, S - m, S - m], radius=int(S * 0.20), fill=(37, 99, 235, 255))

# white "sheet"
dx0, dy0, dx1, dy1 = S * 0.25, S * 0.18, S * 0.75, S * 0.82
d.rounded_rectangle([dx0, dy0, dx1, dy1], radius=int(S * 0.035), fill=(255, 255, 255, 255))

# traced vector path
pts = [(S * 0.335, S * 0.64), (S * 0.45, S * 0.40), (S * 0.55, S * 0.56), (S * 0.665, S * 0.355)]
d.line(pts, fill=(245, 158, 11, 255), width=int(S * 0.028), joint="curve")

# node handles
r = S * 0.030
for (x, y) in pts:
    d.rectangle([x - r, y - r, x + r, y + r], fill=(17, 24, 39, 255),
                outline=(245, 158, 11, 255), width=int(S * 0.012))

img = img.resize((256, 256), Image.LANCZOS)
img.save("scan_vectorizer.ico",
         sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote scan_vectorizer.ico")
