from pathlib import Path
from PIL import Image
import numpy as np, vtracer
from collections import deque
ROOT=Path("D:/Scripts/retrievers")
JOBS=[("majestic-stick-carry",ROOT/"docs/logos/concepts/majestic-stick-carry/13-diagonal-tennis-roundel.png"),
      ("oversized-jersey",ROOT/"docs/logos/concepts/oversized-jersey/04-standing-oversized.png")]
for name,src in JOBS:
    im=Image.open(src).convert("RGBA"); a=np.array(im); h,w,_=a.shape
    rgb=a[:,:,:3].astype(int)
    # Flood from every border pixel through anything near-white. Only the
    # BACKGROUND is reached; white inside the drawing is fenced off by the
    # black outlines the artist drew round every shape.
    near_white=(rgb.min(axis=2)>=238)
    seen=np.zeros((h,w),bool); q=deque()
    for x in range(w):
        for y in (0,h-1):
            if near_white[y,x] and not seen[y,x]: seen[y,x]=True; q.append((y,x))
    for y in range(h):
        for x in (0,w-1):
            if near_white[y,x] and not seen[y,x]: seen[y,x]=True; q.append((y,x))
    while q:
        y,x=q.popleft()
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny,nx=y+dy,x+dx
            if 0<=ny<h and 0<=nx<w and near_white[ny,nx] and not seen[ny,nx]:
                seen[ny,nx]=True; q.append((ny,nx))
    a[:,:,3]=np.where(seen,0,255)
    out=ROOT/"dist"/"print"/f".{name}-alpha.png"; out.parent.mkdir(parents=True,exist_ok=True)
    Image.fromarray(a).save(out)
    pct=100*seen.sum()/(h*w)
    dest=ROOT/"docs/logos/vector/master-svg"/f"{name}.svg"
    vtracer.convert_image_to_svg_py(str(out),str(dest),colormode="color",hierarchical="stacked",
        mode="polygon",filter_speckle=4,color_precision=6,layer_difference=8,
        corner_threshold=60,length_threshold=4.0,max_iterations=10,splice_threshold=45,path_precision=3)
    out.unlink(missing_ok=True)
    print(f"  {name:<24} background {pct:.1f}% keyed before tracing -> {dest.stat().st_size//1024} KB")
