# Vektorizér výkresov

Webová apka, ktorá zo skenu výkresu (PDF, PNG, JPG) spraví vektorové **PDF, SVG a DXF**.
Všetko sa počíta v prehliadači, súbor nikam neodchádza.

## Použitie

Otvor `index.html` v prehliadači (alebo ho nahraj na ľubovoľný statický hosting) a vlož sken.

- **Osové čiary**: každá čiara je jedna polyčiara v osi (vrstva `OSI`); plné plochy ako šípky a hrubé písmo ostávajú ako obrys (vrstva `PLOCHY`).
- **Obrys**: verná kópia tvaru, každá čiara je uzavretý obrys (vrstva `OBRYS`).
- **Čistenie**: prah čiernej, odstránenie škvŕn, zaplnenie dierok v čiarach, zjednodušenie.
- **Mierka pre DXF**: pri 1:1 je DXF v milimetroch papiera, pri napr. 1:50 v skutočných milimetroch.
- **Náhľad**: sken, vektor alebo vektor prekrytý cez sken.

DXF je vo formáte R12 (AC1009), jednotky mm.

## Obmedzenia

- Text je zo samostatných čiar, nie editovateľný CAD text. OCR tu nie je.
- Veľké výkresy sa spracujú pri nižšom rozlíšení, aby sa zmestili do pamäte prehliadača (približne 100 Mpx). Apka je určená na počítač.
- Čítačka PDF (pdf.js) a písma sa načítavajú z CDN, pri otvorení stránky treba internet.

## Vývoj

```
node src/build.js
```

Poskladá `src/page.html` + `src/core.js` + `src/exports.js` do jedného `index.html`.

- `src/core.js`: čistenie bitmapy, stenčovanie (Zhang-Suen), skladanie polyčiar, sledovanie obrysov
- `src/exports.js`: zápis SVG, DXF, PDF a ZIP
- `src/page.html`: rozhranie
