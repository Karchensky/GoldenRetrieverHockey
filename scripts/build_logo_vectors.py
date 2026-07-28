"""Build normalized vector and print exports for selected logo concepts.

Run from the repository root with:

    uv run --with vtracer --with resvg-py --with svglib --with numpy \
      --with fonttools \
      python scripts/build_logo_vectors.py

Raster concepts are normalized to the approved three-color palette before
Bezier tracing. Logo two is rebuilt from authored vector geometry and outlined
font glyphs. Every resulting SVG contains paths rather than embedded raster
images or live fonts.
"""

from __future__ import annotations

import re
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import resvg_py
import vtracer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageFilter
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg


REPO_ROOT = Path(__file__).resolve().parents[1]
LOGO_ROOT = REPO_ROOT / "docs" / "logos"
OUTPUT_ROOT = LOGO_ROOT / "vector"
WORK_ROOT = REPO_ROOT / "tmp" / "logo-vector"
WORDMARK_FONT = Path("C:/Windows/Fonts/ROCKEB.TTF")

PALETTE = {
    "black": "#171719",
    "gold": "#e4a51c",
    "ivory": "#faf4ea",
}

SOURCES = {
    "logo-one": {
        "path": LOGO_ROOT / "logo_one.png",
        "title": "Golden Retrievers crest logo",
        "description": (
            "Golden retriever portrait, crossed hockey sticks, shield, and "
            "Golden Retrievers banner."
        ),
    },
    "logo-two": {
        "authored_vector": True,
        "title": "Golden Retrievers GR monogram",
        "description": (
            "Authored interlocking GR monogram with a golden retriever in "
            "negative space, a lower G terminal built as a left-facing "
            "hockey-stick blade, puck, and Golden Retrievers wordmark."
        ),
    },
    "concept-07-gr-refined": {
        "path": LOGO_ROOT / "concept-07-gr-negative-space-refined.png",
        "title": "Golden Retrievers refined negative-space GR monogram",
        "description": (
            "Completed gold G, black hockey-stick R, seated retriever "
            "negative space, and Golden Retrievers wordmark."
        ),
    },
}

SVG_NAMESPACE = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NAMESPACE)


def _hex_to_rgb(value: str) -> np.ndarray:
    value = value.lstrip("#")
    return np.array(
        [int(value[index : index + 2], 16) for index in (0, 2, 4)],
        dtype=np.float32,
    )


def normalize_source(source: Path, destination: Path) -> None:
    """Flatten soft raster shading into the production three-color palette."""

    image = Image.open(source).convert("RGB")
    image = image.filter(ImageFilter.MedianFilter(size=3))
    pixels = np.asarray(image, dtype=np.float32)

    palette_rgb = np.stack(
        [
            _hex_to_rgb(PALETTE["black"]),
            _hex_to_rgb(PALETTE["gold"]),
            _hex_to_rgb(PALETTE["ivory"]),
        ]
    )

    # Compare in a lightly perceptual space: luminance is weighted more than
    # blue-channel variation so warm ivory does not collapse into gold.
    channel_weights = np.array([0.30, 0.59, 0.11], dtype=np.float32)
    delta = pixels[:, :, None, :] - palette_rgb[None, None, :, :]
    distances = np.sum((delta**2) * channel_weights, axis=3)
    assignments = np.argmin(distances, axis=2)

    normalized = palette_rgb[assignments].astype(np.uint8)
    Image.fromarray(normalized, mode="RGB").save(destination)


def trace_svg(source: Path, destination: Path) -> None:
    """Trace normalized color regions into editable Bezier paths."""

    vtracer.convert_image_to_svg_py(
        str(source),
        str(destination),
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=8,
        color_precision=8,
        layer_difference=16,
        corner_threshold=60,
        length_threshold=4.0,
        max_iterations=10,
        splice_threshold=45,
        path_precision=3,
    )


def polish_svg(
    raw_svg: Path,
    destination: Path,
    *,
    title: str,
    description: str,
    monochrome: str | None = None,
    remove_canvas: bool = False,
) -> None:
    """Add production metadata and optionally collapse artwork to one ink."""

    tree = ET.parse(raw_svg)
    root = tree.getroot()
    width = root.get("width", "1254")
    height = root.get("height", "1254")
    numeric_width = re.sub(r"[^0-9.]", "", width) or "1254"
    numeric_height = re.sub(r"[^0-9.]", "", height) or "1254"

    root.set("viewBox", f"0 0 {numeric_width} {numeric_height}")
    root.set("width", numeric_width)
    root.set("height", numeric_height)
    root.set("role", "img")
    root.set("aria-labelledby", "title description")
    root.set("shape-rendering", "geometricPrecision")

    if remove_canvas:
        for element in list(root):
            fill = (element.get("fill") or "").lower()
            path_data = (element.get("d") or "").lstrip()
            if (
                element.tag == f"{{{SVG_NAMESPACE}}}path"
                and fill not in {PALETTE["black"], PALETTE["gold"]}
                and path_data.startswith("M0 0 ")
            ):
                root.remove(element)
                break

    # The source has exactly three inks. VTracer can emit a handful of nearly
    # identical light edge colors while fitting splines; collapse all of them
    # back to the single approved ivory swatch.
    for element in root.iter():
        fill = (element.get("fill") or "").lower()
        if fill and fill not in {PALETTE["black"], PALETTE["gold"]}:
            element.set("fill", PALETTE["ivory"])

    title_element = ET.Element(f"{{{SVG_NAMESPACE}}}title", {"id": "title"})
    title_element.text = title
    description_element = ET.Element(
        f"{{{SVG_NAMESPACE}}}desc", {"id": "description"}
    )
    description_element.text = description
    metadata_element = ET.Element(f"{{{SVG_NAMESPACE}}}metadata")
    metadata_element.text = (
        "Golden Retrievers production artwork; palette: "
        f"gold {PALETTE['gold']}, black {PALETTE['black']}, "
        f"ivory {PALETTE['ivory']}."
    )
    root.insert(0, metadata_element)
    root.insert(0, description_element)
    root.insert(0, title_element)

    if monochrome:
        artwork_colors = {
            PALETTE["black"].lower(),
            PALETTE["gold"].lower(),
        }
        for element in root.iter():
            fill = (element.get("fill") or "").lower()
            if fill in artwork_colors:
                element.set("fill", monochrome)

    ET.indent(tree, space="  ")
    tree.write(destination, encoding="utf-8", xml_declaration=True)


def _append_path(
    parent: ET.Element,
    path_data: str,
    *,
    element_id: str,
    fill: str = "none",
    stroke: str | None = None,
    stroke_width: float | None = None,
    linecap: str | None = None,
    linejoin: str | None = None,
) -> ET.Element:
    attributes = {
        "id": element_id,
        "d": path_data,
        "fill": fill,
    }
    if stroke:
        attributes["stroke"] = stroke
    if stroke_width is not None:
        attributes["stroke-width"] = str(stroke_width)
    if linecap:
        attributes["stroke-linecap"] = linecap
    if linejoin:
        attributes["stroke-linejoin"] = linejoin
    return ET.SubElement(parent, f"{{{SVG_NAMESPACE}}}path", attributes)


def _append_wordmark(
    parent: ET.Element,
    *,
    fill: str,
    text: str = "GOLDEN RETRIEVERS",
    target_width: float = 920,
    baseline: float = 1080,
) -> None:
    """Outline the production wordmark directly from Rockwell Extra Bold."""

    if not WORDMARK_FONT.exists():
        raise FileNotFoundError(
            f"Required wordmark font was not found: {WORDMARK_FONT}"
        )

    font = TTFont(str(WORDMARK_FONT))
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    horizontal_metrics = font["hmtx"].metrics
    tracking_units = 150

    glyph_names = [cmap[ord(character)] for character in text]
    total_units = sum(horizontal_metrics[name][0] for name in glyph_names)
    total_units += tracking_units * (len(glyph_names) - 1)
    scale = target_width / total_units
    cursor_x = (1200 - target_width) / 2

    wordmark = ET.SubElement(
        parent,
        f"{{{SVG_NAMESPACE}}}g",
        {"id": "golden-retrievers-wordmark", "fill": fill},
    )
    for index, (character, glyph_name) in enumerate(zip(text, glyph_names)):
        glyph = glyph_set[glyph_name]
        pen = SVGPathPen(glyph_set)
        glyph.draw(pen)
        path_data = pen.getCommands()
        if path_data:
            ET.SubElement(
                wordmark,
                f"{{{SVG_NAMESPACE}}}path",
                {
                    "id": f"wordmark-{index}-{ord(character)}",
                    "d": path_data,
                    "transform": (
                        f"translate({cursor_x:.3f} {baseline:.3f}) "
                        f"scale({scale:.7f} {-scale:.7f})"
                    ),
                },
            )
        cursor_x += (
            horizontal_metrics[glyph_name][0] + tracking_units
        ) * scale

    font.close()


def build_authored_logo_two_svg(
    destination: Path,
    *,
    title: str,
    description: str,
    include_canvas: bool,
    monochrome: str | None = None,
) -> None:
    """Build logo two from deliberate vector geometry, never from a bitmap."""

    black = monochrome or PALETTE["black"]
    gold = monochrome or PALETTE["gold"]
    ivory = PALETTE["ivory"]

    root = ET.Element(
        f"{{{SVG_NAMESPACE}}}svg",
        {
            "version": "1.1",
            "width": "1200",
            "height": "1200",
            "viewBox": "0 0 1200 1200",
            "role": "img",
            "aria-labelledby": "title description",
            "shape-rendering": "geometricPrecision",
        },
    )
    title_element = ET.SubElement(
        root, f"{{{SVG_NAMESPACE}}}title", {"id": "title"}
    )
    title_element.text = title
    description_element = ET.SubElement(
        root, f"{{{SVG_NAMESPACE}}}desc", {"id": "description"}
    )
    description_element.text = description
    metadata_element = ET.SubElement(root, f"{{{SVG_NAMESPACE}}}metadata")
    metadata_element.text = (
        "Golden Retrievers authored production vector; palette: "
        f"gold {PALETTE['gold']}, black {PALETTE['black']}, "
        f"ivory {PALETTE['ivory']}."
    )

    if include_canvas:
        _append_path(
            root,
            "M0 0 H1200 V1200 H0 Z",
            element_id="warm-ivory-canvas",
            fill=ivory,
        )

    mark = ET.SubElement(root, f"{{{SVG_NAMESPACE}}}g", {"id": "gr-mark"})

    # The G is drawn as a two-ink athletic channel: a broad black keyline with
    # a gold interior. Its open upper-right terminal leaves room for the R.
    outer_g = (
        "M795 355 V305 "
        "C795 255 755 220 705 220 "
        "H425 C325 220 265 285 265 385 "
        "V640 C265 740 325 805 425 805 H640"
    )
    _append_path(
        mark,
        outer_g,
        element_id="g-outer-keyline",
        stroke=black,
        stroke_width=138,
        linecap="butt",
        linejoin="round",
    )
    _append_path(
        mark,
        outer_g,
        element_id="g-outer-gold",
        stroke=gold,
        stroke_width=92,
        linecap="butt",
        linejoin="round",
    )

    # A clean R sits inside and slightly across the G, giving the monogram the
    # compact overlap of the original idea without any traced edge noise.
    _append_path(
        mark,
        "M675 340 V805",
        element_id="r-stem",
        stroke=black,
        stroke_width=112,
        linecap="butt",
        linejoin="round",
    )
    _append_path(
        mark,
        (
            "M675 385 H815 "
            "C900 385 945 425 945 500 "
            "C945 575 900 615 815 615 H700"
        ),
        element_id="r-bowl",
        stroke=black,
        stroke_width=110,
        linecap="round",
        linejoin="round",
    )
    _append_path(
        mark,
        "M805 600 L965 815",
        element_id="r-leg",
        stroke=black,
        stroke_width=116,
        linecap="butt",
        linejoin="round",
    )

    # This is designed as part of the letter—not added afterward. The missing
    # G crossbar becomes a shaft, heel, and left-facing hockey blade.
    g_terminal = (
        "M555 724 H680 V780 "
        "C680 812 664 832 632 844 L510 892"
    )
    _append_path(
        mark,
        g_terminal,
        element_id="g-hockey-terminal-keyline",
        stroke=black,
        stroke_width=112,
        linecap="round",
        linejoin="round",
    )
    _append_path(
        mark,
        g_terminal,
        element_id="g-hockey-terminal-gold",
        stroke=gold,
        stroke_width=68,
        linecap="round",
        linejoin="round",
    )

    # Retriever profile cut from the shared counter of the two letters.
    _append_path(
        mark,
        (
            "M421 671 "
            "C438 633 444 590 449 532 "
            "C456 448 494 385 557 352 "
            "C616 321 686 326 731 358 "
            "C755 375 768 399 776 428 "
            "C782 449 797 459 822 464 "
            "L878 475 C899 479 909 491 906 509 "
            "C901 540 884 561 857 571 "
            "C829 581 798 570 769 576 "
            "C750 580 735 588 721 598 "
            "L738 604 L718 615 L732 623 "
            "C711 633 697 644 691 652 "
            "L684 666 C680 688 663 701 638 701 "
            "H493 C458 701 435 689 421 671 Z"
        ),
        element_id="retriever-negative-space",
        fill=ivory,
    )

    # A long, low ear and restrained face details keep the dog mature and
    # recognizable when the mark is reduced for embroidery.
    _append_path(
        mark,
        (
            "M551 405 "
            "C543 447 551 483 578 505 "
            "C600 523 611 548 627 552 "
            "C642 556 653 537 655 513 "
            "C658 484 648 455 630 433"
        ),
        element_id="retriever-ear",
        stroke=black,
        stroke_width=15,
        linecap="round",
        linejoin="round",
    )
    _append_path(
        mark,
        (
            "M707 414 C718 404 730 406 737 415 "
            "L741 429 L708 422 Z"
        ),
        element_id="retriever-eye",
        fill=black,
    )
    _append_path(
        mark,
        (
            "M873 477 C887 478 898 485 903 496 "
            "C899 505 892 511 882 513 "
            "C875 504 872 491 873 477 Z"
        ),
        element_id="retriever-nose",
        fill=black,
    )

    # A compact puck balances the blade without introducing another floating
    # object or competing with the GR silhouette.
    _append_path(
        mark,
        (
            "M785 820 "
            "C785 798 815 785 850 785 "
            "C885 785 915 798 915 820 "
            "V859 C915 881 885 894 850 894 "
            "C815 894 785 881 785 859 Z"
        ),
        element_id="puck",
        fill=black,
    )
    _append_path(
        mark,
        "M789 838 C817 857 883 857 911 838",
        element_id="puck-gold-stripe",
        stroke=gold,
        stroke_width=10,
        linecap="round",
    )

    _append_wordmark(root, fill=black)

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(destination, encoding="utf-8", xml_declaration=True)


def export_rasters(svg_path: Path, stem: str) -> None:
    """Export a 10-inch square master at both requested resolutions."""

    export_specs = ((300, 3000), (600, 6000))
    for dpi, pixels in export_specs:
        destination = OUTPUT_ROOT / f"{stem}-{dpi}dpi.png"
        destination.write_bytes(
            resvg_py.svg_to_bytes(
                svg_path=str(svg_path),
                width=pixels,
                height=pixels,
                shape_rendering="geometric_precision",
                image_rendering="optimize_quality",
            )
        )
        with Image.open(destination) as image:
            image.save(destination, dpi=(dpi, dpi))


def export_pdf(svg_path: Path, stem: str) -> None:
    """Export a 10-inch vector PDF."""

    drawing = svg2rlg(str(svg_path))
    if drawing is None:
        raise RuntimeError(f"Could not load SVG for PDF export: {svg_path}")
    scale = 720 / max(drawing.width, drawing.height)
    drawing.scale(scale, scale)
    drawing.width *= scale
    drawing.height *= scale
    renderPDF.drawToFile(
        drawing,
        str(OUTPUT_ROOT / f"{stem}.pdf"),
        showBoundary=0,
    )


def build_logo(stem: str, config: dict[str, object]) -> None:
    full_color_svg = OUTPUT_ROOT / f"{stem}.svg"
    transparent_svg = OUTPUT_ROOT / f"{stem}-transparent.svg"

    if bool(config.get("authored_vector", False)):
        authored_variants = (
            (
                full_color_svg,
                str(config["title"]),
                str(config["description"]),
                True,
                None,
            ),
            (
                transparent_svg,
                f"{config['title']} — transparent background",
                f"{config['description']} Transparent-background variant.",
                False,
                None,
            ),
            (
                OUTPUT_ROOT / f"{stem}-one-color-black.svg",
                f"{config['title']} — one-color black",
                f"{config['description']} One-color black variant.",
                True,
                PALETTE["black"],
            ),
            (
                OUTPUT_ROOT / f"{stem}-one-color-gold.svg",
                f"{config['title']} — one-color gold",
                f"{config['description']} One-color gold variant.",
                True,
                PALETTE["gold"],
            ),
        )
        for destination, title, description, include_canvas, monochrome in (
            authored_variants
        ):
            build_authored_logo_two_svg(
                destination,
                title=title,
                description=description,
                include_canvas=include_canvas,
                monochrome=monochrome,
            )
    else:
        source = Path(config["path"])
        normalized = WORK_ROOT / f"{stem}-normalized.png"
        raw_svg = WORK_ROOT / f"{stem}-raw.svg"
        normalize_source(source, normalized)
        trace_svg(normalized, raw_svg)
        polish_svg(
            raw_svg,
            full_color_svg,
            title=str(config["title"]),
            description=str(config["description"]),
        )
        polish_svg(
            raw_svg,
            transparent_svg,
            title=f"{config['title']} — transparent background",
            description=(
                f"{config['description']} Transparent-background variant."
            ),
            remove_canvas=True,
        )
        polish_svg(
            raw_svg,
            OUTPUT_ROOT / f"{stem}-one-color-black.svg",
            title=f"{config['title']} — one-color black",
            description=f"{config['description']} One-color black variant.",
            monochrome=PALETTE["black"],
        )
        polish_svg(
            raw_svg,
            OUTPUT_ROOT / f"{stem}-one-color-gold.svg",
            title=f"{config['title']} — one-color gold",
            description=f"{config['description']} One-color gold variant.",
            monochrome=PALETTE["gold"],
        )

    export_pdf(full_color_svg, stem)
    export_rasters(full_color_svg, stem)
    export_rasters(transparent_svg, f"{stem}-transparent")


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    for stem, config in SOURCES.items():
        build_logo(stem, config)


if __name__ == "__main__":
    main()
