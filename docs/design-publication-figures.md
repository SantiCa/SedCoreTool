# Design: figures with publication structure (A4 journal layout)

Written on 20 November 2026 at the maintainer's request ("que se pueda elegir que salgan con estructura de publicación, adaptadas a un formato
A4 de una publicación científica"), from a design study of the artwork rules of the main journals of the field. It is the design behind cards
P1-P5 of the roadmap (which replace card F1). Nothing here is built yet. Where a value is the design's recommendation rather than a journal's
rule, it says so.

## 1. What the program does today

- Figures are SVG built in `figures.js`, `log.js`, `columns.js`, `plot.js`, `figview.js`, `locmap.js` and `geo.js`, sized in screen pixels; many
  font sizes are fixed numbers (8-10 px); only some builders take a base size (`LOG_STYLE.fontSize`, `plot.js` `spec.font`, `locmap.js`
  `labelSize`). The family is `IBM Plex Sans, Arial…`; IBM Plex Sans ships only as woff2 and is not embedded in exported files.
- Shrinking a screen figure to a journal width makes its text far too small: a 900 px core log at 170 mm is 0.189 mm per px, so an 8 px label
  prints at 4.3 pt. **Publication mode must draw figures in physical units**, not rescale them.
- PNG export draws the SVG at ×2 on a canvas and saves it without a `pHYs` chunk (no resolution). Images inside figures are reduced and stored
  as JPEG (sections ≤ 900 px wide, about 134 ppi at 170 mm, below every journal's 300 ppi). There is a `rainbow` ramp and no Okabe-Ito palette.
  Nothing produces PDF.

## 2. What the journals require

| Journal / publisher | Widths (mm) | Max height | Font | Lines | Raster resolution | Formats | Colour | Panel labels | Verified |
|---|---|---|---|---|---|---|---|---|---|
| Elsevier (Marine Geology, Palaeo3, QSR, ESR) | 90 / 140 / 190; minimal 30 | not stated | ≥ 7 pt (sub/superscript ≥ 6); Arial/Helvetica, Times, Courier, Symbol; embedded | 0.10-1.5 pt | photo 300; combination 500; line art 1000 (1200 fine) | EPS (vector), PDF, TIFF, JPEG | RGB preferred | not stated | general artwork pages; journal pages refused access |
| Wiley (Sedimentology) | 80-180 (canvas ≥ 80 mm or 1800 px) | not stated | "legible" | — | line art 600; images 300 | PDF for line art; PNG/TIFF images | not stated | not stated | general page; journal page refused access |
| SEPM (Journal of Sedimentary Research) | "JSR standard sizes", not listed | — | — | avoid fine lines | 200-300 | JPG, EPS, PDF, TIFF; final JPEG | RGB, no ICC profile | — | partial |
| AGU (Paleoceanography and Paleoclimatology) | 50-170 (single 50-85, double 105-170) | — | ≈ 8 pt (sub/superscript ≈ 6); Arial, Helvetica, Times, Symbol; embed or outline others | — | 300-600 at final size | vector or raster | an old page asks for CMYK | — | search snippets only |
| GSA (Geology, GSA Bulletin) | 59, 91, 122.8, 148.2, 185 (page) | 225 | 7-12 pt; Helvetica/Arial; one size | 1-2 pt | photo 300-600; line art ≥ 1200 | PDF (preferred), TIFF, EPS | not colour alone; no rainbow | **A, B, C at 13-16 pt** | yes |
| Taylor & Francis (Ichnos) | — | — | — | — | colour 300; greyscale 600; line art 1200; combination 600 | TIFF, EPS, PNG, JPG | — | — | general guidance only |
| Copernicus (Climate of the Past) | ≥ 80 | full page = portrait page | one sans-serif family | — | 300; PNG bitmaps, JPG photos only | PDF/EPS preferred, fonts embedded; PDF ≤ 2 MB | readable with colour-vision deficiency | **(a), (b)**; legend inside, caption outside | yes |
| Nature (Nature Geoscience) | 89 / 120-136 / 183 | 170 (room for the legend) | 5-7 pt; Helvetica/Arial; text not outlined; embedded | — | ≥ 300 (450 recommended) | PDF/EPS | RGB; Wong palette; no red/green | **a, b at 8 pt bold lowercase** | general Nature guide |

Sources: [Elsevier artwork sizing](https://www.elsevier.com/about/policies-and-standards/author/artwork-and-media-instructions/artwork-sizing),
[overview](https://www.elsevier.com/about/policies-and-standards/author/artwork-and-media-instructions/artwork-overview),
[types](https://www.elsevier.com/about/policies-and-standards/author/artwork-and-media-instructions/artwork-types);
[Wiley figure preparation](https://authors.wiley.com/author-resources/Journal-Authors/Prepare/manuscript-preparation-guidelines.html/figure-preparation.html);
[SEPM JSR graphics](https://www.sepm.org/jsrgraphics), [author instructions](https://www.sepm.org/author-instructions);
[AGU graphic requirements](https://www.agu.org/Publish-with-AGU/Publish/Author-Resources/Graphic-Requirements);
[GSA figure guidelines](https://www.geosociety.org/publications/author-information/figure-guidelines);
[Taylor & Francis artwork](https://authorservices.taylorandfrancis.com/publishing-your-research/making-your-submission/submit-electronic-artwork/);
[Climate of the Past submission](https://www.climate-of-the-past.net/submission.html);
[Nature figure guide](https://research-figure-guide.nature.com/figures/preparing-figures-our-specifications/),
[final submission](https://www.nature.com/nature/for-authors/final-submission);
[Stoelzle & Stein 2021](https://hess.copernicus.org/articles/25/4549/2021/); [Westaway 2022](https://gc.copernicus.org/articles/5/83/2022/).

**Common denominator:** single column 80-85 mm, 1.5 column 120-136 mm, double column ≤ 170 mm (AGU is the tightest); height ≤ 225 mm
(≤ 170 mm when the caption must fit under it on a Nature page); one sans-serif family of the Arial/Helvetica class, text 7-9 pt and nothing
below 6 pt (Nature allows 5-7 pt); vector PDF with fonts embedded and text not outlined; raster TIFF or PNG at 600 dpi for photographs with
labels, 1200 dpi only for raster line art; RGB, no rainbow ramp, not colour alone, no red/green pairs; title and caption outside the image,
legend inside. **Not verified:** journal-specific numbers for Sedimentology, JSR, Ichnos and the Elsevier journals (publisher rules used),
Elsevier's maximum height, AGU (pages refused access). No journal states core-log conventions; those below are recommendations.

## 3. Journal presets (recommended)

In a pure module `figsize.js` (`PRESETS`). Widths single / 1.5 / double / page in mm; text minimum / body / axis title / panel label in pt;
lines minimum / axis / data in pt; DPI for photo / combination / line art. \* = not stated by the journal: the interface says so.

| id | widths | max H | text | lines | label | DPI |
|---|---|---|---|---|---|---|
| `generic` (default, "A4 journal") | 84 / 129 / 170 / 170 | 225 | 7 / 8 / 8 / 9 bold | 0.25 / 0.5 / 0.75 | `a` bold | 300 / 600 / 1200 |
| `elsevier` | 90 / 140 / 190 / 190 | 240\* | 7 / 8 / 8 / 9 | 0.25 / 0.5 / 0.75 (≤ 1.5) | `a` | 300 / 500 / 1000 |
| `wiley` | 80 / 129 / 180 / 180 | 225\* | 7 / 8 / 8 / 9 | 0.25 / 0.5 / 0.75 | `a` | 300 / 600 / 600 |
| `agu` | 85 / 129 / 170 / 170 | 225\* | 6 / 8 / 8 / 9 | 0.25 / 0.5 / 0.75 | `a` | 300 / 600 / 600 |
| `gsa` | 91 / 122.8 / 185 / 185 | 225 | 7 / 8 / 9 / A 14 | 1 / 1 / 1 | `A` | 300 / 600 / 1200 |
| `copernicus` | 84 / 129 / 170 / 170 | 225\* | 7 / 8 / 8 / 9 | 0.25 / 0.5 / 0.75 | `(a)` | 300 / 300 / 600 (PNG) |
| `nature` | 89 / 129 / 183 / 183 | 170 | 5 / 6 / 7 / 8 bold | 0.25 / 0.5 / 0.75 | `a` bold 8 pt | 300 / 450 / 1200 |
| `sepm` | 84 / 129 / 170 / 170 | 225\* | 7 / 8 / 8 / 9 | 0.5 / 0.5 / 0.75 | `A` | 300 / 300 / 300 (JPEG/TIFF) |
| `tandf` | 84 / 129 / 170 / 170 | 225\* | 7 / 8 / 8 / 9 | 0.25 / 0.5 / 0.75 | `a` | 300 / 600 / 1200 |

Every preset also offers "full page landscape". Font family for all: `Arial, Helvetica, "Liberation Sans", Arimo, sans-serif`. Panel-label
offset 1 mm; gap between panels ≥ 3 mm; scale bars 0.5 pt with labels at the body size.

## 4. Layout model and style rules

- **Page frame:** `{preset, widthKind | widthMm, heightMm | auto, panels: grid}`. One user unit = 1 pt: `<svg width="170mm" height="…mm"
  viewBox="0 0 481.89 …">`, so `font-size="8"` prints at 8 pt. The frame holds the panel grid (cells may span), an optional shared legend strip
  and panel labels at the top-left outside corner of each plot area. **Title and caption are never in the image**: `<name>_caption.txt` and the
  SVG `<metadata>`.
- **Figure types:** core column, whole interpreted core and multiproxy column at double or full page, columns fitted to the width
  (`fitWidths`), depth increasing downward, `Depth (cm)` / `(mbsf)`, `Age (ka BP)` with the reference epoch of card F2; ichnotaxa distribution
  at single or 1.5 next to the column with a shared depth axis, italic names at the minimum size or warned; core sections and representative
  traces already as panels, labels in the preset's style, each with a scale bar, raster resolution checked per panel; maps at single or 1.5
  with km scale bar, north arrow, `30° N`, rainbow warned; charts at single. A **plate** composes other figure tabs as panels (card P5).
- **Typography:** effective size in pt = `font-size × CTM scale × (widthMm / 25.4 × 72) / viewBoxWidth`; below the preset minimum a warning,
  below 6 pt (5 for Nature) an error ("not ready"); strokes below the preset minimum warned, below 0.1 pt an error. In publication mode the
  builders receive `print: {unit: 'pt', body, small, title, line, axisLine}` and their fixed numbers become relative to `body`; screen mode
  keeps today's numbers. Default categorical palette Okabe-Ito (`#000000 #E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7`),
  sequential `viridis`, `rainbow` warned; class colours are never changed automatically ("Apply the colour-blind palette to this figure").

## 5. User interface

- A switch **Screen | Publication** above the figure stage (per tab, `fig.publish`, off by default, behind the flag `figPublication`).
- First level: journal ("Generic A4 journal (recommended)" and the presets); width (Single 84 · 1.5 129 · Double 170 · Full page, from the
  preset); a true-size preview on a white A4 page with margins and dashed column guides (Fit / 100 %); a **checks list** (text size with the
  labels below the minimum highlighted, lines, embedded images below the needed ppi, height, estimated file size, colours); one button
  **Export for submission** (PDF on the desktop, TIFF at the preset's DPI on the web).
- Expert settings under "More options": width and height in mm, pt per element, line weights, DPI, panel-label format and position, the
  original image resolution, a colour-blind preview (Machado 2009 matrices as an SVG filter on the preview), screen calibration for 100 %.
- Exports: SVG with mm width and live text; PDF (vector, fonts embedded as subsets, text not outlined); TIFF (LZW, resolution tags); PNG with
  `pHYs`; provenance in every file (SVG `<metadata>`, PNG `tEXt`, TIFF `ImageDescription`, PDF `/Title`, and the `*_provenance.json` of F2).

## 6. Architecture

- Pure modules (Node-tested, in `ORDER`): `figsize.js` (presets, `mmToPt`, `widthMm`, `pixelsFor`, `auditText`, `auditLines`, `auditRaster`,
  `recommendedDpi`, `panelLabel`, `pageFrame`, `OKABE_ITO`, `fitWidths`), `pngmeta.js` (`crc32`, `withPhys`: 600 dpi = 23622 px/m,
  `withText`), a TIFF writer (RGBA → baseline RGB, LZW, resolution tags; in a module that does not clash with today's reader `tiff.js`),
  `figlayout.js` (plate grid, nested SVGs, `scopeIds` moved from `figures.js`). Controller `figpublish.js` (interface, preview, DOM
  measurements); `app.js` only wiring. No scientific calculation in JavaScript.
- PDF without a new dependency: `desktop/figure-pdf.js`, an offscreen `BrowserWindow` (JavaScript off, sandbox on, no Node) loading the SVG
  with `@page { size: Wmm Hmm; margin: 0 }` and `webContents.printToPDF({preferCSSPageSize: true, printBackground: true})`; the IPC handler
  checks the origin and caps the SVG size; the page calls an injected `toPdf` (ARCHITECTURE §3.3). The web build says the PDF needs the
  desktop program and offers the print dialog (no silent fallback). Considered: jsPDF + svg2pdf.js (about 0.6 MB; font embedding by hand,
  incomplete clipPath/pattern/mask), kept only if `printToPDF` fails its measurements.
- Fonts: Arial is not on Linux. Smallest alternative: embed the bundled IBM Plex Sans (OFL). Recommended (decision of the maintainer): bundle
  **Liberation Sans** (OFL) or **Arimo** (Apache 2.0), metric-compatible with Arial, regular/italic/bold about 1.2 MB, offline, identical on
  three systems. Outlining text is not needed (Nature asks for live text).
- Saved project: `fig.publish` and `fig.plate` are new optional fields (older versions ignore them); a saved-format change that needs the
  maintainer's approval (AGENTS §3 item 5).
