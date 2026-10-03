#!/usr/bin/env python3
"""Composite captured app screenshots into a phone-frame mockup.

Takes a 390x844 (or similar) screenshot and draws a realistic device frame
around it: rounded bezel, punch-hole camera, side buttons, soft shadow.
Output: transparent PNG ready for README/website use.

Usage: python scripts/phone_mockup.py <input.png> <output.png> [--scale 1.0]
"""

import argparse
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow required: pip install pillow")


BEZEL = 14          # bezel thickness around the screen
CORNER = 54         # screen corner radius
FRAME_COLOR = (24, 24, 28, 255)
HIGHLIGHT = (70, 70, 78, 255)


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def make_mockup(src_path, out_path, scale=1.0):
    screen = Image.open(src_path).convert("RGBA")
    # Normalize to a 390x844 screen area (crop center if larger, pad if smaller).
    target_w, target_h = 390, 844
    if screen.size != (target_w, target_h):
        ratio = max(target_w / screen.width, target_h / screen.height)
        resized = screen.resize(
            (int(screen.width * ratio), int(screen.height * ratio)), Image.LANCZOS
        )
        left = (resized.width - target_w) // 2
        top = (resized.height - target_h) // 2
        screen = resized.crop((left, top, left + target_w, top + target_h))

    # Fake status bar (time + battery) so the punch-hole camera has a natural
    # home; the app screenshot sits below it.
    STATUS_H = 30
    status = Image.new("RGBA", (target_w, STATUS_H), (248, 248, 248, 255))
    sdraw = ImageDraw.Draw(status)
    try:
        from PIL import ImageFont
        font = ImageFont.load_default(size=15)
    except Exception:
        font = None
    sdraw.text((24, 8), "9:41", fill=(20, 20, 22, 255), font=font)
    # battery
    sdraw.rounded_rectangle((target_w - 40, 9, target_w - 14, 21), radius=4, outline=(20, 20, 22, 255), width=2)
    sdraw.rounded_rectangle((target_w - 38, 11, target_w - 20, 19), radius=2, fill=(20, 20, 22, 255))
    sdraw.rounded_rectangle((target_w - 12, 12, target_w - 10, 18), radius=1, fill=(20, 20, 22, 255))
    # wifi arcs (simple wedge)
    sdraw.pieslice((target_w - 78, 4, target_w - 58, 24), 225, 315, fill=(20, 20, 22, 255))
    sdraw.ellipse((target_w - 71, 13, target_w - 65, 19), fill=(248, 248, 248, 255))
    # signal bars
    for i, h in enumerate((4, 7, 10, 13)):
        sdraw.rounded_rectangle(
            (target_w - 100 + i * 6, 20 - h, target_w - 97 + i * 6, 20), radius=1, fill=(20, 20, 22, 255)
        )

    composed = Image.new("RGBA", (target_w, target_h + STATUS_H), (248, 248, 248, 255))
    composed.paste(status, (0, 0))
    composed.alpha_composite(screen, (0, STATUS_H))
    screen = composed
    target_h += STATUS_H

    # Round the screen corners.
    mask = Image.new("L", (target_w * 4, target_h * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, target_w * 4, target_h * 4), radius=CORNER * 4, fill=255
    )
    mask = mask.resize((target_w, target_h), Image.LANCZOS)
    screen.putalpha(mask)

    pad = BEZEL + 30  # outer margin for shadow
    frame_w = target_w + BEZEL * 2
    frame_h = target_h + BEZEL * 2
    out = Image.new("RGBA", (frame_w + pad * 2, frame_h + pad * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(out)

    # Soft shadow.
    for i in range(18, 0, -2):
        alpha = 3 + i
        rounded(
            draw,
            (pad - i + 4, pad - i + 8, frame_w + pad + i + 4, frame_h + pad + i + 8),
            radius=CORNER + BEZEL + i,
            fill=(0, 0, 0, alpha),
        )

    # Titanium-ish frame with a subtle inner highlight.
    rounded(
        draw,
        (pad, pad, frame_w + pad, frame_h + pad),
        radius=CORNER + BEZEL,
        fill=FRAME_COLOR,
        outline=HIGHLIGHT,
        width=2,
    )

    # Screen.
    out.alpha_composite(screen, (pad + BEZEL, pad + BEZEL))

    # Punch-hole camera, centered in the status bar.
    cx = pad + BEZEL + target_w // 2
    cy = pad + BEZEL + STATUS_H // 2
    draw.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=(10, 10, 12, 255))
    draw.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=(28, 32, 44, 255))

    # Side buttons.
    btn = (58, 58, 64, 255)
    right_x = frame_w + pad
    draw.rounded_rectangle(
        (right_x - 1, pad + 190, right_x + 3, pad + 265), radius=2, fill=btn
    )  # power
    draw.rounded_rectangle(
        (right_x - 1, pad + 130, right_x + 3, pad + 170), radius=2, fill=btn
    )  # volume up
    draw.rounded_rectangle(
        (pad - 3, pad + 130, pad + 1, pad + 170), radius=2, fill=btn
    )  # volume down (left)

    if scale != 1.0:
        out = out.resize(
            (int(out.width * scale), int(out.height * scale)), Image.LANCZOS
        )
    out.save(out_path)
    print(f"{out_path}: {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--scale", type=float, default=1.0)
    a = ap.parse_args()
    make_mockup(a.input, a.output, a.scale)
