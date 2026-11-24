# Vektorizér výkresov

Webová apka, ktorá zo skenu výkresu (PDF, PNG, JPG) spraví vektorové **PDF, SVG a DXF**,
rozpozná text (slovenčina a angličtina) a nájde opakujúce sa značky.
Všetko sa počíta v prehliadači, súbor nikam neodchádza.

## Použitie

Otvor `index.html` cez webový server (alebo nahraj priečinok `web/` na ľubovoľný statický hosting) a vlož sken.
Priamo zo súboru (`file://`) rozpoznávanie textu nefunguje, prehliadač tam nepustí pomocné procesy.

### Automatické nastavenie

Po načítaní apka sken rozoberie a nastaví:

- **rozlíšenie**: pri skenovanom PDF zistí skutočné dpi skenu a číta priamo vložený obrázok,
- **spôsob**: technický výkres → osové čiary, text/tabuľka → obrys, náčrt → osové čiary bez narovnávania,
- **čistenie**: veľkosť škvŕn podľa hrúbky čiary a šumu, vyrovnanie nerovnomerného pozadia (fotky),
- **mierku DXF**: z rozpoznaného textu v rohovej pečiatke (napr. „Mierka 1:50“).

Čo nastavila, ukazujú štítky v časti *Automatické nastavenie*. Všetko sa dá zmeniť ručne.

### Vektorizácia

- **Osové čiary**: každá čiara je jedna polyčiara v osi (hladina `OSI`); plné plochy (šípky, hrubé písmo) ostávajú ako vyplnený obrys (hladina `PLOCHY`), vrátane hrotov šípok.
- **Obrys**: verná kópia tvaru, každá čiara je uzavretý obrys (hladina `OBRYS`).
- **Narovnanie**: zistí natočenie skenu a otočí ho späť; takmer vodorovné a zvislé čiary sú presne vodorovné a zvislé, pokračujú rovno cez kríženia a konce sa stretnú v priesečníku.

### Text (OCR)

Tesseract so slovenčinou a angličtinou, voliteľne aj zvislý text.

- **Ponechať tvar písma**: čiary písma ostanú; PDF dostane neviditeľnú vyhľadávateľnú vrstvu textu, DXF vypnutú hladinu `TEXT-OCR`.
- **Nahradiť písmom**: písmo z čiar sa odstráni a nahradí skutočným textom (DXF `TEXT`, upraviteľný v CAD-e). Chybne prečítané slovo bude chybné aj vo výkrese, preto to nie je predvolené.
- Stiahnuť sa dá aj čistý text (TXT).

### Značky

Označ jednu značku (napr. ventil v legende) a apka nájde všetky rovnaké, aj otočené o 90°.
Názov sa predvyplní z textu vedľa značky. V DXF z nich budú bloky na hladine `ZNACKY`
(počty sa dajú vytiahnuť v CAD-e), výkaz s počtami a súradnicami sa stiahne ako CSV.

### Mierka

Pri 1:1 je DXF v milimetroch papiera, pri napr. 1:50 v skutočných milimetroch. DXF je vo formáte R12 (AC1009).

## Obmedzenia

- Veľké výkresy sa spracujú pri nižšom rozlíšení, aby sa zmestili do pamäte prehliadača (približne 100 Mpx). Apka je určená na počítač.
- Rozpoznávanie textu trvá pri výkrese A1 asi 40–60 s. Rozpoznáva vodorovný text, zvislý len so zapnutou voľbou.
- Značky sa hľadajú v rovnakej veľkosti a otočené po 90°, nie zrkadlené ani zmenšené.

## Vývoj

```
node src/build.js
```

Poskladá `src/page.html` + `src/core.js` + `src/exports.js` do jedného `index.html`.

- `src/core.js`: čistenie bitmapy, stenčovanie (Zhang-Suen), skladanie polyčiar, sledovanie obrysov, narovnanie, rozbor skenu, hľadanie značiek
- `src/exports.js`: zápis SVG, DXF (text, bloky), PDF (textová vrstva), CSV a ZIP
- `src/page.html`: rozhranie, OCR
- `vendor/`: pdf.js 3.11.174, Tesseract.js 5.1.1 (jadro 5.1.1) a jazykové dáta `slk`, `eng` (tessdata best_int); licencie Apache-2.0 sú pri súboroch

## Nasadenie

Cloudflare Workers (statické assets z priečinka `web/`, vetva `web-app`).
