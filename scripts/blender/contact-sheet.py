# Tile rendered PNGs into one labelled sheet.
#
#   blender --background --python scripts/blender/contact-sheet.py -- \
#       <out.png> <cols> <cell_w> <cell_h> <label>=<path> [<label>=<path> ...]
#
# A comparison that lives in twelve separate files is not a comparison. This
# stitches them into a single image with the labels burned in, so current and
# rebound sit next to each other under the same camera and the same treatment
# and the difference is a glance rather than a file-manager exercise.
#
# The font is a hand-rolled 5x7 bitmap because Blender's text objects need a
# render engine and a scene, and this needs neither — it is pixel copying.

import os
import sys

import bpy

FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
    "F": ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
    "H": ["10001", "10001", "11111", "10001", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "11100", "10100", "10010", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "01110", "00001", "00001", "10001", "01110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "X": ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
    "Y": ["10001", "01010", "00100", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    " ": ["00000"] * 7,
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
    "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
    "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
    ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
    "X_": ["00000"] * 7,
}


def log(m):
    print(f"[sheet] {m}", flush=True)


class Canvas:
    def __init__(self, w, h, bg=(0.055, 0.058, 0.070)):
        self.w, self.h = w, h
        self.px = [0.0] * (w * h * 4)
        for i in range(w * h):
            self.px[i * 4] = bg[0]
            self.px[i * 4 + 1] = bg[1]
            self.px[i * 4 + 2] = bg[2]
            self.px[i * 4 + 3] = 1.0

    def put(self, x, y, r, g, b):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 4
            self.px[i] = r
            self.px[i + 1] = g
            self.px[i + 2] = b

    def text(self, s, x, y, scale=2, col=(0.86, 0.86, 0.90)):
        cx = x
        for ch in s.upper():
            glyph = FONT.get(ch, FONT[" "])
            for row, bits in enumerate(glyph):
                for cbit, on in enumerate(bits):
                    if on == "1":
                        for dy in range(scale):
                            for dx in range(scale):
                                self.put(cx + cbit * scale + dx,
                                         y + row * scale + dy, *col)
            cx += 6 * scale
        return cx

    def rect(self, x, y, w, h, col):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.put(xx, yy, *col)

    def blit(self, img, x, y, tw, th):
        """Nearest-neighbour, top-left at (x, y). Blender images are bottom-up."""
        sw, sh = img.size
        src = list(img.pixels)
        ch = len(src) // (sw * sh)
        for yy in range(th):
            sy = sh - 1 - int(yy * sh / th)
            for xx in range(tw):
                sx = int(xx * sw / tw)
                i = (sy * sw + sx) * ch
                self.put(x + xx, y + yy, src[i], src[i + 1], src[i + 2])

    def save(self, path):
        img = bpy.data.images.new(os.path.basename(path), self.w, self.h,
                                  alpha=False)
        flipped = [0.0] * (self.w * self.h * 4)
        for y in range(self.h):
            s = (self.h - 1 - y) * self.w * 4
            flipped[y * self.w * 4:(y + 1) * self.w * 4] = \
                self.px[s:s + self.w * 4]
        img.pixels = flipped
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        log(f"wrote {path} ({self.w}x{self.h})")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out, cols, cw, chh = argv[0], int(argv[1]), int(argv[2]), int(argv[3])
    items = []
    title = ""
    for a in argv[4:]:
        if a.startswith("title="):
            title = a[6:]
            continue
        label, path = a.split("=", 1)
        items.append((label, path))

    pad, lab, top = 10, 22, (44 if title else 10)
    rows = (len(items) + cols - 1) // cols
    W = pad + cols * (cw + pad)
    H = top + rows * (chh + lab + pad)
    cv = Canvas(W, H)
    if title:
        cv.text(title, pad + 2, 14, 3, (0.98, 0.80, 0.42))

    for k, (label, path) in enumerate(items):
        r, c = divmod(k, cols)
        x = pad + c * (cw + pad)
        y = top + r * (chh + lab + pad)
        cv.text(label, x + 2, y + 3, 2, (0.80, 0.83, 0.90))
        if os.path.exists(path):
            img = bpy.data.images.load(path)
            cv.blit(img, x, y + lab, cw, chh)
            bpy.data.images.remove(img)
        else:
            cv.rect(x, y + lab, cw, chh, (0.14, 0.05, 0.05))
            cv.text("MISSING", x + 8, y + lab + 8, 2, (1.0, 0.4, 0.4))
    cv.save(out)


if __name__ == "__main__":
    main()
