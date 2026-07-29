#!/usr/bin/env python3
"""Build production vector and high-DPI exports for approved logo concepts."""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import resvg_py
from scipy import ndimage
import vtracer


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SOURCE_DIR = PROJECT_ROOT / "docs" / "logos" / "concepts"
OUTPUT_DIR = PROJECT_ROOT / "docs" / "logos" / "vector"
WORK_DIR = OUTPUT_DIR / ".work"

DETAILED_SVG_DIR = OUTPUT_DIR / "master-svg"
THREE_COLOR_SVG_DIR = OUTPUT_DIR / "production-3color-svg"
PNG_300_DIR = OUTPUT_DIR / "high-dpi-png" / "300dpi"
PNG_600_DIR = OUTPUT_DIR / "high-dpi-png" / "600dpi"
PREVIEW_DIR = OUTPUT_DIR / "previews"

PALETTE = {
    "black": "#0B0B0D",
    "white": "#FFFFFF",
    "gold": "#D9A333",
}

APPROVED = [
    ("21-dense-heritage-seal", "Dense Heritage Seal"),
    ("28-dual-retriever-faceoff", "Dual Retriever Faceoff"),
    ("33-front-mascot-medallion", "Front Mascot Medallion"),
    ("35-octagon-retrievers-patch", "Octagon Retrievers Patch"),
    ("36-crossed-shield-retriever", "Crossed Shield Retriever"),
    ("38-arched-varsity-lockup", "Arched Varsity Lockup"),
    ("45-rink-board-lockup", "Rink Board Lockup"),
    ("48-dual-capsule-retrievers", "Dual Capsule Retrievers"),
    ("50-championship-roundel", "Championship Roundel"),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def remove_exterior_white(source: Image.Image) -> Image.Image:
    """Remove only the near-white background connected to the canvas edges."""
    rgb = source.convert("RGB")
    flood = rgb.copy()
    sentinel = (1, 2, 3)
    width, height = flood.size
    for corner in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        pixel = rgb.getpixel(corner)
        if min(pixel) >= 220 and max(pixel) - min(pixel) <= 35:
            ImageDraw.floodfill(flood, corner, sentinel, thresh=48)

    alpha = Image.new("L", flood.size, 255)
    flood_pixels = (
        flood.get_flattened_data()
        if hasattr(flood, "get_flattened_data")
        else flood.getdata()
    )
    alpha.putdata([0 if pixel == sentinel else 255 for pixel in flood_pixels])
    alpha_array = np.asarray(alpha, dtype=np.uint8)
    labels, component_count = ndimage.label(
        alpha_array > 0,
        structure=np.ones((3, 3), dtype=np.uint8),
    )
    if component_count:
        component_sizes = np.bincount(labels.ravel())
        minimum_area = max(256, round(width * height * 0.00015))
        remove_component = component_sizes < minimum_area
        remove_component[0] = False
        alpha_array = np.where(remove_component[labels], 0, alpha_array).astype(
            np.uint8
        )
        alpha = Image.fromarray(alpha_array, mode="L")
    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)

    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("Background removal produced an empty image")

    left, top, right, bottom = bbox
    padding = max(12, round(max(right - left, bottom - top) * 0.025))
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(width, right + padding)
    bottom = min(height, bottom + padding)

    cropped = rgba.crop((left, top, right, bottom))
    padded = Image.new(
        "RGBA",
        (cropped.width + padding * 2, cropped.height + padding * 2),
        (0, 0, 0, 0),
    )
    padded.alpha_composite(cropped, (padding, padding))
    return padded


def convert_to_three_color(source: Image.Image) -> Image.Image:
    """Snap all visible artwork to the official black/white/gold palette."""
    rgba = source.convert("RGBA")
    alpha = rgba.getchannel("A")
    palette_image = Image.new("P", (1, 1))
    palette_values: list[int] = []
    for color in PALETTE.values():
        palette_values.extend(
            [
                int(color[1:3], 16),
                int(color[3:5], 16),
                int(color[5:7], 16),
            ]
        )
    black = [
        int(PALETTE["black"][1:3], 16),
        int(PALETTE["black"][3:5], 16),
        int(PALETTE["black"][5:7], 16),
    ]
    while len(palette_values) < 768:
        palette_values.extend(black)
    palette_values = palette_values[:768]
    palette_image.putpalette(palette_values)

    quantized = rgba.convert("RGB").quantize(
        palette=palette_image,
        dither=Image.Dither.NONE,
    )
    result = quantized.convert("RGBA")
    result.putalpha(alpha)
    return result


def clean_detail_neutrals(source: Image.Image) -> Image.Image:
    """Snap neutral edge antialiasing to clean black/white production colors."""
    rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8).copy()
    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3]
    channel_max = rgb.max(axis=2)
    channel_min = rgb.min(axis=2)
    spread = channel_max - channel_min
    visible = alpha > 0
    near_black = visible & (channel_max < 48) & (spread < 16)
    near_white = visible & (channel_min > 242) & (spread < 16)
    rgb[near_black] = np.array([11, 11, 13], dtype=np.uint8)
    rgb[near_white] = np.array([255, 255, 255], dtype=np.uint8)
    return Image.fromarray(rgba, mode="RGBA")


def trace_png(source: Path, destination: Path, *, detailed: bool) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    vtracer.convert_image_to_svg_py(
        str(source),
        str(destination),
        colormode="color",
        hierarchical="stacked",
        mode="polygon" if detailed else "spline",
        filter_speckle=4,
        color_precision=6 if detailed else 8,
        layer_difference=8 if detailed else 1,
        corner_threshold=60,
        length_threshold=4.0,
        max_iterations=10,
        splice_threshold=45,
        path_precision=3,
    )


def add_svg_metadata(path: Path, title: str, description: str) -> None:
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    tree = ET.parse(path)
    root = tree.getroot()
    namespace = "{http://www.w3.org/2000/svg}"
    title_node = ET.Element(f"{namespace}title")
    title_node.text = title
    description_node = ET.Element(f"{namespace}desc")
    description_node.text = description
    root.insert(0, description_node)
    root.insert(0, title_node)
    tree.write(path, encoding="utf-8", xml_declaration=True)


def normalize_svg_palette(path: Path) -> None:
    """Snap traced path fills and strokes to the official three-color palette."""
    palette_rgb = {
        name: (
            int(color[1:3], 16),
            int(color[3:5], 16),
            int(color[5:7], 16),
        )
        for name, color in PALETTE.items()
    }
    tree = ET.parse(path)
    root = tree.getroot()
    for node in root.iter():
        for attribute in ("fill", "stroke"):
            value = node.attrib.get(attribute, "")
            if not value.startswith("#") or len(value) != 7:
                continue
            rgb = (
                int(value[1:3], 16),
                int(value[3:5], 16),
                int(value[5:7], 16),
            )
            nearest_name = min(
                palette_rgb,
                key=lambda name: sum(
                    (rgb[index] - palette_rgb[name][index]) ** 2
                    for index in range(3)
                ),
            )
            node.set(attribute, PALETTE[nearest_name])
    tree.write(path, encoding="utf-8", xml_declaration=True)


def svg_stats(path: Path) -> dict[str, object]:
    tree = ET.parse(path)
    root = tree.getroot()
    paths = [node for node in root.iter() if node.tag.endswith("path")]
    images = [node for node in root.iter() if node.tag.endswith("image")]
    fills = sorted(
        {
            node.attrib["fill"].upper()
            for node in paths
            if "fill" in node.attrib and node.attrib["fill"].startswith("#")
        }
    )
    return {
        "bytes": path.stat().st_size,
        "path_count": len(paths),
        "embedded_raster_count": len(images),
        "fills": fills,
        "sha256": sha256(path),
    }


def render_svg(
    svg_path: Path,
    destination: Path,
    *,
    source_size: tuple[int, int],
    long_edge: int,
    dpi: int,
) -> tuple[int, int]:
    source_width, source_height = source_size
    if source_width >= source_height:
        width = long_edge
        height = max(1, round(long_edge * source_height / source_width))
    else:
        height = long_edge
        width = max(1, round(long_edge * source_width / source_height))

    png_bytes = resvg_py.svg_to_bytes(
        svg_path=str(svg_path),
        width=width,
        height=height,
    )
    with Image.open(io.BytesIO(png_bytes)) as rendered:
        rendered = rendered.convert("RGBA")
        destination.parent.mkdir(parents=True, exist_ok=True)
        rendered.save(destination, format="PNG", dpi=(dpi, dpi), optimize=True)
    return width, height


def validate_transparency(path: Path) -> dict[str, object]:
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        corners = [
            rgba.getpixel((0, 0))[3],
            rgba.getpixel((rgba.width - 1, 0))[3],
            rgba.getpixel((0, rgba.height - 1))[3],
            rgba.getpixel((rgba.width - 1, rgba.height - 1))[3],
        ]
        dpi = image.info.get("dpi", (0, 0))
        return {
            "size": [rgba.width, rgba.height],
            "dpi": [round(float(dpi[0])), round(float(dpi[1]))],
            "transparent_corners": all(alpha == 0 for alpha in corners),
            "sha256": sha256(path),
        }


def fit_image(image: Image.Image, max_size: tuple[int, int]) -> Image.Image:
    copy = image.copy()
    copy.thumbnail(max_size, Image.Resampling.LANCZOS)
    return copy


def create_comparison_sheet(rows: list[dict[str, object]]) -> None:
    cell_width = 500
    cell_height = 430
    label_height = 46
    header_height = 98
    columns = 3
    sheet = Image.new(
        "RGB",
        (cell_width * columns, header_height + cell_height * len(rows)),
        "#ECE8DF",
    )
    draw = ImageDraw.Draw(sheet)
    try:
        title_font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 34)
        heading_font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 22)
        label_font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 19)
    except OSError:
        title_font = heading_font = label_font = ImageFont.load_default()

    title = "APPROVED LOGOS - VECTOR EXPORT COMPARISON"
    box = draw.textbbox((0, 0), title, font=title_font)
    draw.text(
        ((sheet.width - (box[2] - box[0])) / 2, 14),
        title,
        fill="#111111",
        font=title_font,
    )
    headings = ("ORIGINAL", "DETAILED VECTOR", "STRICT 3-COLOR VECTOR")
    for column, heading in enumerate(headings):
        box = draw.textbbox((0, 0), heading, font=heading_font)
        draw.text(
            (
                column * cell_width + (cell_width - (box[2] - box[0])) / 2,
                59,
            ),
            heading,
            fill="#111111",
            font=heading_font,
        )

    for row_index, row in enumerate(rows):
        y0 = header_height + row_index * cell_height
        files = (
            Path(row["source"]),
            Path(row["detailed_preview"]),
            Path(row["three_color_preview"]),
        )
        for column, path in enumerate(files):
            x0 = column * cell_width
            draw.rectangle(
                (x0 + 8, y0 + 8, x0 + cell_width - 8, y0 + cell_height - 8),
                fill="white",
                outline=PALETTE["gold"],
                width=4,
            )
            with Image.open(path) as raw:
                image = fit_image(raw.convert("RGBA"), (cell_width - 38, cell_height - label_height - 28))
                background = Image.new("RGBA", image.size, "white")
                background.alpha_composite(image)
                px = x0 + (cell_width - image.width) // 2
                py = y0 + 18 + (cell_height - label_height - 28 - image.height) // 2
                sheet.paste(background.convert("RGB"), (px, py))

            label = f'{row["number"]}  {row["title"]}'
            box = draw.textbbox((0, 0), label, font=label_font)
            draw.text(
                (
                    x0 + (cell_width - (box[2] - box[0])) / 2,
                    y0 + cell_height - 38,
                ),
                label,
                fill="#111111",
                font=label_font,
            )

    destination = PREVIEW_DIR / "vector-comparison-contact-sheet.png"
    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination, optimize=True)


def build() -> None:
    for directory in (
        WORK_DIR,
        DETAILED_SVG_DIR,
        THREE_COLOR_SVG_DIR,
        PNG_300_DIR,
        PNG_600_DIR,
        PREVIEW_DIR,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, object] = {
        "palette": PALETTE,
        "exports": {
            "detailed_svg": "Color-preserving path-based master",
            "three_color_svg": "Strict black/white/gold production master",
            "300dpi_png": "Transparent PNG, 3600 px on longest edge, 300 DPI metadata",
            "600dpi_png": "Transparent PNG, 6000 px on longest edge, 600 DPI metadata",
        },
        "logos": [],
    }
    comparison_rows: list[dict[str, object]] = []

    for slug, title in APPROVED:
        source_path = SOURCE_DIR / f"{slug}.png"
        if not source_path.exists():
            raise FileNotFoundError(f"Approved source is missing: {source_path}")

        with Image.open(source_path) as source:
            cleaned = remove_exterior_white(source)
        cleaned = clean_detail_neutrals(cleaned)
        three_color = convert_to_three_color(cleaned)

        detailed_input = WORK_DIR / f"{slug}-detailed-input.png"
        three_color_input = WORK_DIR / f"{slug}-3color-input.png"
        cleaned.save(detailed_input)
        three_color.save(three_color_input)

        detailed_svg = DETAILED_SVG_DIR / f"{slug}.svg"
        three_color_svg = THREE_COLOR_SVG_DIR / f"{slug}-3color.svg"
        trace_png(detailed_input, detailed_svg, detailed=True)
        trace_png(three_color_input, three_color_svg, detailed=False)
        normalize_svg_palette(three_color_svg)
        add_svg_metadata(
            detailed_svg,
            f"Golden Retrievers - {title}",
            "Detailed path-based vector master traced from the approved concept.",
        )
        add_svg_metadata(
            three_color_svg,
            f"Golden Retrievers - {title} - Three Color",
            "Production vector master restricted to black, white, and athletic gold.",
        )

        number = slug.split("-", 1)[0]
        png_300 = PNG_300_DIR / f"{slug}-300dpi.png"
        png_600 = PNG_600_DIR / f"{slug}-600dpi.png"
        detailed_preview = PREVIEW_DIR / f"{slug}-detailed-preview.png"
        three_color_preview = PREVIEW_DIR / f"{slug}-3color-preview.png"
        render_svg(
            detailed_svg,
            png_300,
            source_size=cleaned.size,
            long_edge=3600,
            dpi=300,
        )
        render_svg(
            detailed_svg,
            png_600,
            source_size=cleaned.size,
            long_edge=6000,
            dpi=600,
        )
        render_svg(
            detailed_svg,
            detailed_preview,
            source_size=cleaned.size,
            long_edge=1100,
            dpi=144,
        )
        render_svg(
            three_color_svg,
            three_color_preview,
            source_size=cleaned.size,
            long_edge=1100,
            dpi=144,
        )

        detailed_stats = svg_stats(detailed_svg)
        three_color_stats = svg_stats(three_color_svg)
        if detailed_stats["embedded_raster_count"] != 0:
            raise ValueError(f"Embedded raster found in {detailed_svg}")
        if three_color_stats["embedded_raster_count"] != 0:
            raise ValueError(f"Embedded raster found in {three_color_svg}")

        expected_palette = {value.upper() for value in PALETTE.values()}
        unexpected_fills = set(three_color_stats["fills"]) - expected_palette
        if unexpected_fills:
            raise ValueError(
                f"Unexpected colors in {three_color_svg.name}: {sorted(unexpected_fills)}"
            )

        png_300_stats = validate_transparency(png_300)
        png_600_stats = validate_transparency(png_600)
        if not png_300_stats["transparent_corners"]:
            raise ValueError(f"300 DPI export is not transparent: {png_300}")
        if not png_600_stats["transparent_corners"]:
            raise ValueError(f"600 DPI export is not transparent: {png_600}")

        logo_record = {
            "number": number,
            "title": title,
            "slug": slug,
            "source": str(source_path.relative_to(PROJECT_ROOT)).replace("\\", "/"),
            "source_dimensions": list(cleaned.size),
            "detailed_svg": {
                "path": str(detailed_svg.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                **detailed_stats,
            },
            "three_color_svg": {
                "path": str(three_color_svg.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                **three_color_stats,
            },
            "png_300dpi": {
                "path": str(png_300.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                **png_300_stats,
            },
            "png_600dpi": {
                "path": str(png_600.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                **png_600_stats,
            },
        }
        manifest["logos"].append(logo_record)
        comparison_rows.append(
            {
                "number": number,
                "title": title,
                "source": str(source_path),
                "detailed_preview": str(detailed_preview),
                "three_color_preview": str(three_color_preview),
            }
        )

    create_comparison_sheet(comparison_rows)
    manifest_path = OUTPUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    resolved_work = WORK_DIR.resolve()
    resolved_output = OUTPUT_DIR.resolve()
    if resolved_work.parent != resolved_output:
        raise RuntimeError(f"Refusing to remove unexpected work directory: {resolved_work}")
    shutil.rmtree(resolved_work)


if __name__ == "__main__":
    build()
