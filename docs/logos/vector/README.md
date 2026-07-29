# Golden Retrievers — Production Logo Assets

This folder contains vector and high-resolution production exports for the approved logo concepts currently retained in `docs/logos/concepts`.

## Folder structure

- `master-svg/` — detailed, full-color, path-based SVG masters preserving the tonal detail of each approved concept.
- `production-3color-svg/` — simplified SVG masters restricted to the official black, white, and gold palette.
- `high-dpi-png/300dpi/` — transparent PNG exports with an approximately 3600-pixel longest edge and 300-DPI metadata.
- `high-dpi-png/600dpi/` — transparent PNG exports with an approximately 6000-pixel longest edge and 600-DPI metadata.
- `previews/` — detailed/three-color preview renders and a side-by-side comparison sheet.
- `legacy-logo-one/` — the pre-existing `logo-one` export set, preserved unchanged.
- `tools/` — the reproducible build script used to clean, trace, render, and validate the approved concepts.
- `manifest.json` — dimensions, path counts, colors, checksums, and validation results for every generated file.

## Approved logos

1. `21-dense-heritage-seal`
2. `28-dual-retriever-faceoff`
3. `33-front-mascot-medallion`
4. `35-octagon-retrievers-patch`
5. `36-crossed-shield-retriever`
6. `38-arched-varsity-lockup`
7. `45-rink-board-lockup`
8. `48-dual-capsule-retrievers`
9. `50-championship-roundel`

## Production palette

- Black: `#0B0B0D`
- White: `#FFFFFF`
- Athletic gold: `#D9A333`

## Which version to use

- Use `master-svg` for large-format printing, signage, digital display, and situations where the detailed fur shading is desirable.
- Use `production-3color-svg` for embroidery, vinyl cutting, patches, screen printing, and any vendor requesting a limited-color vector.
- Use the 300-DPI PNGs for standard print-on-demand workflows.
- Use the 600-DPI PNGs for oversize raster production or vendors that do not accept SVG.

All new SVGs are composed of vector paths. They do not contain embedded raster images. The PNGs are rendered from the SVG masters on transparent backgrounds.

## Rebuilding

The build script requires Python, Pillow, VTracer, and `resvg-py`:

```powershell
python docs/logos/vector/tools/build_vector_assets.py
```

Review `previews/vector-comparison-contact-sheet.png` before sending a logo to production.
