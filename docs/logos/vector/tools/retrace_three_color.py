"""
Re-trace the three-colour production masters, without the fringing.

WHY THIS EXISTS
---------------
`build_vector_assets.py` makes a three-colour SVG like this:

    concept PNG (1254 px)  ->  quantize() to 3 colours  ->  vtracer  ->  SVG

The quantise step is the problem. Every anti-aliased pixel on every edge snaps
to the nearest of three colours, at the original 1254 px pitch, which turns a
smooth curve into a staircase with treads roughly one pixel deep. vtracer then
faithfully traces the staircase. Printed at ten inches that is visible as a
fringed, chewed edge — which is exactly what the captain saw on 2026-07-29.

Nothing about the quantiser was wrong. `dither=NONE` is already correct: dither
would have been worse. The mistake is quantising at the SOURCE resolution.

WHAT THIS DOES DIFFERENTLY
--------------------------
    concept PNG (1254 px)  ->  Lanczos upscale x4 (5016 px)
                           ->  quantize() to 3 colours
                           ->  vtracer, spline mode
                           ->  SVG

Upscaling first is the whole fix. The anti-aliased ramp is resampled smoothly
before it is snapped, so the staircase treads are a quarter the size relative to
the artwork and the traced spline lands far closer to the curve the artist drew.
It costs nothing but time — the trace is of a bigger bitmap, so it is slower.

**The original art is only 1254 px, and that is the ceiling on real detail.**
No amount of tracing invents information. What tracing buys is resolution
INDEPENDENCE: a 1254 px raster is 125 dpi at ten inches, far under the 300 floor
this shop prints to, and the vector renders at any size. That is the reason the
trace exists at all, and the reason the answer is not simply "use the PNG".

Run:  python docs/logos/vector/tools/retrace_three_color.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import vtracer
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
CONCEPTS = ROOT / "docs" / "logos" / "concepts"
OUT = ROOT / "docs" / "logos" / "vector" / "production-3color-svg"

# The club's three inks. Nothing else may appear in a production file.
PALETTE = {"black": "#0B0B0D", "white": "#FFFFFF", "gold": "#D9A333"}

# Four is measurably enough: at 1254 px the tread is ~0.08% of the artwork's
# width, which is finer than the trace's own corner tolerance. Eight doubled the
# runtime and changed no edge by a pixel.
UPSCALE = 4

# Which concept file backs which production name. Taken from MARKS in matrix.ts;
# `arched-varsity` is deliberately absent — the captain retired it.
MARKS = {
    "21-dense-heritage-seal": "21-dense-heritage-seal",
    "28-dual-retriever-faceoff": "28-dual-retriever-faceoff",
    "33-front-mascot-medallion": "33-front-mascot-medallion",
    "35-octagon-retrievers-patch": "35-octagon-retrievers-patch",
    "36-crossed-shield-retriever": "36-crossed-shield-retriever",
    "45-rink-board-lockup": "45-rink-board-lockup",
    "48-dual-capsule-retrievers": "48-dual-capsule-retrievers",
    "50-championship-roundel": "50-championship-roundel",
}


def palette_image() -> Image.Image:
    """A 3-entry palette, padded with black so Pillow accepts it."""
    values: list[int] = []
    for hex_colour in PALETTE.values():
        values.extend(int(hex_colour[i : i + 2], 16) for i in (1, 3, 5))
    black = [int(PALETTE["black"][i : i + 2], 16) for i in (1, 3, 5)]
    while len(values) < 768:
        values.extend(black)
    image = Image.new("P", (1, 1))
    image.putpalette(values[:768])
    return image


def three_colour(source: Image.Image) -> Image.Image:
    """Upscale, then snap to the three inks. Alpha is carried through untouched."""
    rgba = source.convert("RGBA")
    big = rgba.resize(
        (rgba.width * UPSCALE, rgba.height * UPSCALE),
        Image.Resampling.LANCZOS,
    )
    alpha = big.getchannel("A")
    quantised = big.convert("RGB").quantize(
        palette=palette_image(), dither=Image.Dither.NONE
    )
    result = quantised.convert("RGBA")
    result.putalpha(alpha)
    return result


def retrace(name: str, concept: str) -> None:
    src = CONCEPTS / f"{concept}.png"
    if not src.exists():
        print(f"  SKIP {name}: no concept art at {src}")
        return

    original = Image.open(src)
    prepared = three_colour(original)

    tmp = OUT / f".{name}-prepared.png"
    prepared.save(tmp)

    dest = OUT / f"{name}-3color.svg"
    vtracer.convert_image_to_svg_py(
        str(tmp),
        str(dest),
        colormode="color",
        hierarchical="stacked",
        # Splines, not polygons. The old run used the default, which is why the
        # traced edges were faceted as well as stepped.
        mode="spline",
        # Three inks means three layers; precision above that only splits a
        # colour into near-identical siblings.
        color_precision=8,
        # Kill stray specks left by the snap. At 5016 px a 16-pixel island is
        # smaller than a printed dot and is never intentional artwork.
        filter_speckle=16,
        layer_difference=16,
        corner_threshold=60,
        length_threshold=4.0,
        splice_threshold=45,
        path_precision=3,
    )
    tmp.unlink(missing_ok=True)

    size = dest.stat().st_size
    print(f"  {name:<32} {original.width}x{original.height} -> {prepared.width}px traced, {size // 1024} KB")


def main() -> int:
    if not CONCEPTS.exists():
        print(f"No concept art at {CONCEPTS}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Re-tracing {len(MARKS)} marks at {UPSCALE}x before the three-colour snap:")
    for name, concept in MARKS.items():
        retrace(name, concept)
    print("\nDone. `npm run store:logos` re-renders the press files from these.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
