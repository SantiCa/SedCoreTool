"""Build a single self-contained HTML file of the web app (double-click to open, works offline).

Usage:  python tools/build_standalone.py  ->  dist/SedCoreTool_V<n>.html (delivery number from app.js DELIVERY)

ES modules cannot be loaded from file:// URLs, so the modules are concatenated (in dependency
order, with import/export statements removed) into one inline <script type="module">, and the
example image is embedded as a data URI.
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
ORDER = ["core.js", "sectiondepth.js", "sectionanalysis.js", "maskchanges.js", "engineclient.js", "engineanalysis.js", "edit.js", "imageproc.js", "learn.js", "unet.js", "unetmodel.js", "vision.js", "log.js", "storage.js", "zip.js", "tiff.js", "i18n.js", "diagnostics.js", "state.js", "geo.js", "locmap.js", "interp.js", "plot.js", "sheet.js", "exportio.js", "tableview.js", "figview.js", "navpreview.js", "columns.js", "panels.js", "datatab.js", "figures.js", "multiproxy.js", "app.js"]
EXAMPLES = ROOT / "examples"
# Files the app loads with fetchAsset(path); embedded so the single file works offline.
# V0.50: no sample data in the download (no test core, example images, demos nor tutorial): only the public-domain
# coastline for the maps. The example buttons hide themselves when their files are missing.
ASSETS = ["data/land-50m.json"]
MIME = {".jpg": "image/jpeg", ".csv": "text/csv", ".json": "application/json", ".txt": "text/plain"}
TOP_DECL = re.compile(r"^(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)", re.M)


def strip_module(src: str) -> str:
    src = re.sub(r"^import\s[^;]*;\s*$", "", src, flags=re.M)
    # Local unaliased export lists preserve the original bindings in the concatenated scope.
    ident = r"[A-Za-z_$][\w$]*"
    src = re.sub(rf"^export\s+\{{\s*{ident}(?:\s*,\s*{ident})*\s*,?\s*\}};\s*$", "", src, flags=re.M)
    if re.search(r"^export\s*\{", src, flags=re.M):
        raise ValueError("Unsupported export list: use local unaliased names and a semicolon")
    return re.sub(r"^export\s+", "", src, flags=re.M)


def delivery() -> str:
    m = re.search(r"const DELIVERY = '(V\d+(?:\.\d+)*)'", (APP / "js" / "app.js").read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("DELIVERY constant not found in app/js/app.js")
    return m.group(1)


def build(out: Path | None = None) -> Path:
    ver = delivery()
    out = out or ROOT / "dist" / f"SedCoreTool_{ver}.html"
    seen: dict[str, str] = {}
    parts = []
    for name in ORDER:
        code = (APP / "js" / name).read_text(encoding="utf-8")
        for ident in TOP_DECL.findall(code):
            if ident in seen:
                raise SystemExit(f"Name clash: {ident!r} defined in {seen[ident]} and {name}")
            seen[ident] = name
        parts.append(f"// ---- {name} ----\n{strip_module(code)}")
    bundle = "\n".join(parts)

    assets = {a: f"data:{MIME[Path(a).suffix]};base64," + base64.b64encode((EXAMPLES / a).read_bytes()).decode() for a in ASSETS}
    assets_js = "window.ICHANTOOL_ASSETS = " + json.dumps(assets) + ";"

    html = (APP / "index.html").read_text(encoding="utf-8").replace("<title>SedCoreTool</title>", f"<title>SedCoreTool {ver}</title>")
    # V0.40: the hosted page's CSP forbids inline scripts; the single offline file is all inline, so it gets its own
    html = re.sub(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">', lambda m: m.group(0).replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("default-src 'self'", "default-src 'self' data: blob:"), html)
    # V0.27: the bundled fonts go inline too, so the single file looks the same offline
    fdir = APP / "vendor" / "fonts"
    fcss = re.sub(r"url\('([^']+\.woff2)'\)", lambda m: "url(data:font/woff2;base64," + base64.b64encode((fdir / m.group(1)).read_bytes()).decode() + ")", (fdir / "fonts.css").read_text(encoding="utf-8"))
    html = html.replace('<link rel="stylesheet" href="vendor/fonts/fonts.css">', "<style>" + fcss + "</style>")
    tag = '<script type="module" src="js/app.js"></script>'
    if tag not in html:
        raise SystemExit("script tag not found in app/index.html")
    html = html.replace(tag, "<script>" + assets_js + "</script>\n<script type=\"module\">\n" + bundle.replace("</script", "<\\/script") + "\n</script>")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out


if __name__ == "__main__":
    p = build()
    print(f"{p}  ({p.stat().st_size / 1e6:.2f} MB)")
