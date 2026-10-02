"""Read private samples locally; output metadata and previews only to ignored artifacts."""
import collections
import json
import pathlib
import sys
import time

import pypdfium2 as pdfium
from pypdf import PdfReader

source, output = map(pathlib.Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
results = []
for index, filename in enumerate(sorted(source.glob("*.pdf"))):
    start = time.monotonic()
    reader = PdfReader(filename)
    doc = pdfium.PdfDocument(filename)
    pages = []
    for n, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        annotations = collections.Counter(str(a.get_object().get("/Subtype")) for a in page.get("/Annots", []))
        fonts = [str(f.get_object().get("/BaseFont")) for f in page.get("/Resources", {}).get("/Font", {}).get_object().values()] if page.get("/Resources", {}).get("/Font") else []
        pages.append({"page": n + 1, "media": list(map(float, page.mediabox)), "crop": list(map(float, page.cropbox)), "rotation": page.rotation, "user_unit": page.get("/UserUnit", 1), "text_characters": len(text), "thai_characters": sum('\u0e00' <= c <= '\u0e7f' for c in text), "annotations": dict(annotations), "fonts": fonts})
    for annots in [True, False]:
        page = doc[0]
        bitmap = page.render(scale=1.2, draw_annots=annots)
        bitmap.to_pil().save(output / f"sample-{index}-{'original' if annots else 'clean'}.png")
        bitmap.close()
        page.close()
    doc.close()
    results.append({"file": filename.name, "bytes": filename.stat().st_size, "encrypted": reader.is_encrypted, "pages": pages, "seconds": round(time.monotonic()-start, 2)})
(output / "inspection.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps(results, indent=2))
