"""Bounded local rendering and comparison. Originals are never modified."""
import difflib
import json
import os
import pathlib
import sys
import warnings

import cv2
import numpy as np
import pypdfium2 as pdfium
from PIL import Image
from pypdf import PdfReader

Image.MAX_IMAGE_PIXELS = 40_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)
MAX_PAGES = int(os.environ.get("PDF_MAX_PAGES", "50"))
MAX_PIXELS = 16_000_000


def load(source):
    if pathlib.Path(source).read_bytes()[:5] == b"%PDF-":
        reader = PdfReader(source)
        if reader.is_encrypted:
            raise ValueError("Encrypted PDF: upload an unlocked export.")
        if len(reader.pages) > MAX_PAGES:
            raise ValueError("PDF exceeds the configured page limit.")
        return reader, pdfium.PdfDocument(source)
    image = Image.open(source)
    if image.width * image.height > 40_000_000:
        raise ValueError("Image exceeds the expanded pixel limit.")
    image.load()
    return None, image.convert("RGB")


def count(pair):
    return len(pair[0].pages) if pair[0] else 1


def render(pair, index, scale=1.5):
    reader, document = pair
    if reader:
        page = document[index]
        page.set_rotation(0)
        width, height = page.get_size()
        if width <= 0 or height <= 0 or width * height * scale * scale > MAX_PIXELS:
            raise ValueError("Page exceeds the rendering pixel budget.")
        bitmap = page.render(scale=scale, draw_annots=False)
        image = bitmap.to_pil().convert("RGB")
        bitmap.close()
        page.close()
        return image
    image = document.copy()
    image.thumbnail((2400, 2400))
    return image


def inspect(source, out):
    pair = load(source)
    reader, document = pair
    pages = []
    for index in range(count(pair)):
        if reader:
            p = reader.pages[index]
            text = (p.extract_text() or "")[:100_000]
            annotations = [a.get_object() for a in p.get("/Annots", [])]
            meta = {"width": float(p.cropbox.width), "height": float(p.cropbox.height), "crop": list(map(float, p.cropbox)), "rotation": p.rotation, "user_unit": float(p.get("/UserUnit", 1)), "text": text, "text_characters": len(text), "annotations": len(annotations), "widgets": sum(a.get("/Subtype") == "/Widget" for a in annotations)}
        else:
            meta = {"width": document.width, "height": document.height, "rotation": 0, "user_unit": 0, "text": "", "text_characters": 0, "annotations": 0, "widgets": 0}
        image = render(pair, index)
        image.thumbnail((600, 600))
        name = f"page-{index+1}.png"
        image.save(out / name)
        pages.append({**meta, "thumbnail": name})
    if reader:
        document.close()
    return {"pages": pages}


def compare(before, after, config, out):
    left, right = load(before), load(after)
    # Cache low-resolution signatures; full rasters are released after each pair.
    signatures = []
    for pair in [left, right]:
        signatures.append([np.asarray(render(pair, i, .5).resize((64,64)).convert("L"), dtype=np.float32) for i in range(count(pair))])
    mapping = config.get("page_map", [])
    uncertain = False
    if not mapping:
        if count(left) == count(right) == 1:
            mapping = [{"before":1,"after":1}]
        else:
            used = set()
            for j, image in enumerate(signatures[1]):
                scores = sorted((float(np.abs(image-other).mean()), i) for i, other in enumerate(signatures[0]) if i not in used)
                if scores and scores[0][0] < 35 and (len(scores)==1 or scores[1][0]-scores[0][0]>3):
                    used.add(scores[0][1]); mapping.append({"before":scores[0][1]+1,"after":j+1})
                else:
                    uncertain = True
    findings = []
    excluded = 0
    pixels = 0
    transforms = []
    for item in mapping:
        i,j = item["before"]-1,item["after"]-1
        a,b = render(left,i),render(right,j)
        w,h = b.size
        if a.size != b.size:
            uncertain = True
            findings.append({"page":j+1,"geometry":{"x":0,"y":0,"width":1,"height":1,"kind":"rectangle"},"kind":"geometry_changed","evidence":{"description":"Page dimensions differ. No rescaling has been applied; pixel comparison is unavailable for this pair."}})
            continue
        aa,bb = np.asarray(a).copy(),np.asarray(b).copy()
        grey_a,grey_b = cv2.cvtColor(aa,cv2.COLOR_RGB2GRAY).astype(np.float32),cv2.cvtColor(bb,cv2.COLOR_RGB2GRAY).astype(np.float32)
        shift,confidence = cv2.phaseCorrelate(grey_a,grey_b)
        # Translation only, never erase changes of scale or rotation.
        dx,dy = shift
        valid = np.ones((h,w),dtype=np.uint8)
        applied = confidence > .7 and max(abs(dx),abs(dy)) <= 8
        if applied and max(abs(dx),abs(dy)) > .5:
            matrix=np.float32([[1,0,dx],[0,1,dy]])
            aa=cv2.warpAffine(aa,matrix,(w,h),borderValue=(255,255,255))
            valid=cv2.warpAffine(valid,matrix,(w,h),flags=cv2.INTER_NEAREST,borderValue=0)
            uncertain = True  # shifted boundary is uncovered
        elif confidence < .2:
            uncertain = True
        transforms.append({"before":i+1,"after":j+1,"dx":round(dx,3) if applied else 0,"dy":round(dy,3) if applied else 0,"normalized_dx":dx/w if applied else None,"normalized_dy":dy/h if applied else None,"confidence":round(confidence,3)})
        for exclusion in config.get("exclusions",[]):
            if exclusion["page"] == j+1:
                g=exclusion["geometry"]
                valid[int(g["y"]*h):int((g["y"]+g["height"])*h),int(g["x"]*w):int((g["x"]+g["width"])*w)]=0
        excluded += int((valid==0).sum()); pixels += w*h
        mask=(np.max(np.abs(aa.astype(np.int16)-bb.astype(np.int16)),axis=2)>24).astype(np.uint8)*valid
        grouped=cv2.dilate(mask,np.ones((7,7),np.uint8))
        components,labels,stats,_=cv2.connectedComponentsWithStats(grouped,8)
        for k in range(1,components):
            x,y,rw,rh,area=map(int,stats[k]); changed=int(mask[labels==k].sum())
            if changed<8: continue
            if len(findings)>=500:
                uncertain=True; break
            name=f"finding-{len(findings)}"
            bounds=(max(0,x-10),max(0,y-10),min(w,x+rw+10),min(h,y+rh+10))
            Image.fromarray(aa).crop(bounds).save(out/f"{name}-before.png")
            b.crop(bounds).save(out/f"{name}-after.png")
            findings.append({"page":j+1,"geometry":{"x":x/w,"y":y/h,"width":rw/w,"height":rh/h,"kind":"rectangle"},"kind":"pixels_changed","evidence":{"description":"Rendered pixels changed; inspect both crops. Movement or semantic meaning has not been inferred.","before_page":i+1,"changed_pixels":changed,"before_crop":f"{name}-before.png","after_crop":f"{name}-after.png"}})
        if left[0] and right[0]:
            old=(left[0].pages[i].extract_text() or "")[:100_000]
            new=(right[0].pages[j].extract_text() or "")[:100_000]
            if old!=new:
                delta='\n'.join(difflib.unified_diff(old.splitlines(),new.splitlines(),n=1))[:8000]
                findings.append({"page":j+1,"geometry":{"x":0,"y":0,"width":1,"height":1,"kind":"rectangle"},"kind":"text_changed","evidence":{"description":"Native text extraction differs. Reading order, outlined text, and exclusions limit interpretation.\n"+delta}})
            if not old or not new: uncertain=True
    matched_left={m['before'] for m in mapping}; matched_right={m['after'] for m in mapping}
    for side,pair,matched in [('before',left,matched_left),('after',right,matched_right)]:
        for page in range(1,count(pair)+1):
            if page not in matched:
                uncertain=True
                findings.append({"page":page if side=='after' else 1,"geometry":{"x":0,"y":0,"width":1,"height":1,"kind":"rectangle"},"kind":"unmapped_page","evidence":{"description":f"Unmapped {side} page {page}. It may be added, removed, or substantially changed. Confirm page mapping manually."}})
    for pair in [left,right]:
        if pair[0]:
            if any(any(a.get_object().get('/Subtype')=='/Widget' for a in p.get('/Annots',[])) for p in pair[0].pages): uncertain=True
            pair[1].close()
    if excluded: uncertain=True
    return {"findings":findings,"state":"partial" if uncertain else "succeeded","coverage":{"pages":count(right),"compared":len(mapping),"excluded_fraction":excluded/max(1,pixels),"transforms":transforms,"page_map":mapping,"note":"Native annotation objects omitted. Flattened review marks remain unless excluded. Small changes below the pixel threshold may be missed. Text findings are extraction evidence, not semantic or regulatory validation."}}


if __name__ == '__main__':
    if sys.platform != 'win32':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (1536*1024*1024, 1536*1024*1024))
        resource.setrlimit(resource.RLIMIT_CPU, (120, 125))
        resource.setrlimit(resource.RLIMIT_FSIZE, (128*1024*1024, 128*1024*1024))
    request=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
    output=pathlib.Path(request['output']); output.mkdir(parents=True,exist_ok=True)
    try:
        result=inspect(request['source'],output) if request['kind']=='revision' else compare(request['before'],request['after'],request['config'],output)
        (output/'result.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    except Exception as error:
        print(str(error)[:300],file=sys.stderr)
        sys.exit(1)
