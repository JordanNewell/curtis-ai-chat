#!/usr/bin/env python3
"""Build the README banner + OG image from real product screenshots.

The old hero was a v1.0.4-era hand-drawn mock. This composites the actual
product (dark-theme arena capture + framed phone shot) onto the brand's
black/green terminal identity, reading the version from manifest.json so the
banner can never go stale again.

Usage: python scripts/build_hero.py
Inputs: assets/screenshots/arena-final-dark.png, phone-arena-framed-dark.png,
        manifest.json
Output: assets/hero.png (1280x400 README banner), assets/og.png (1200x630)
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    sys.exit("Pillow required: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "assets" / "screenshots"

BG_TOP = (8, 8, 11)
BG_BOTTOM = (14, 14, 20)
GREEN = (0, 230, 118)
GREEN_DIM = (0, 230, 118, 26)
WHITE = (232, 238, 244)
GRAY = (140, 148, 158)
PANEL_BORDER = (32, 34, 44)

FONT_DIR = Path("C:/Windows/Fonts")
BOLD = str(FONT_DIR / "segoeuib.ttf")
MONO = str(FONT_DIR / "consola.ttf")


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def vertical_gradient(size):
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM))
        for x in range(w):
            px[x, y] = c
    return img


def grid_overlay(size, step=48):
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    w, h = size
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=GREEN_DIM, width=1)
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=GREEN_DIM, width=1)
    return overlay


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def paste_panel(base, img, box, radius=12, rotate=0.0):
    """Fit img into box (w,h), round corners, add border + soft shadow, paste."""
    w, h = box
    fitted = img.copy()
    ratio = max(w / fitted.width, h / fitted.height)
    fitted = fitted.resize((round(fitted.width * ratio), round(fitted.height * ratio)), Image.LANCZOS)
    left = (fitted.width - w) // 2
    top = (fitted.height - h) // 2
    fitted = fitted.crop((left, top, left + w, top + h))
    if rotate:
        fitted = fitted.rotate(rotate, expand=True, resample=Image.BICUBIC)
        w, h = fitted.size
    panel = rounded(fitted, radius)
    # Border
    border = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle((0, 0, w + 1, h + 1), radius=radius, fill=(*PANEL_BORDER, 255))
    border.paste(panel, (1, 1), panel)
    # Shadow
    shadow = Image.new("RGBA", (w + 60, h + 60), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((30, 34, 30 + w, 34 + h), radius=radius, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    return border, shadow


def chat_crop(shot):
    """Crop the chat sidebar region (right ~62% of the full-window shot)."""
    w, h = shot.size
    return shot.crop((round(w * 0.40), 0, w, h))


def left_block(draw, version, width, big=False):
    """Wordmark + tagline + bullets. Origin (64, 64). Returns bottom y."""
    x = 64
    y = 56 if big else 48
    mono_s = font(MONO, 15 if big else 13)
    mono_b = font(MONO, 16 if big else 14)
    title = font(BOLD, 66 if big else 58)
    sub = font(BOLD, 30 if big else 26)

    draw.ellipse((x + 1, y + 6, x + 11, y + 16), fill=GREEN)
    draw.text((x + 20, y), f"OPEN-SOURCE · MIT · v{version}", font=mono_s, fill=GRAY)
    y += 44
    draw.text((x - 3, y), "CURTIS", font=title, fill=WHITE)
    tw = draw.textlength("CURTIS", font=title)
    draw.text((x + tw + 14, y + 8), "AI CHAT", font=sub, fill=GREEN)
    y += (100 if big else 88)
    draw.text((x, y), "Polyglot AI chat for Obsidian.", font=mono_b, fill=GRAY)
    y += 26
    draw.text((x, y), "Thirty-plus providers, one sidebar.", font=mono_b, fill=GRAY)
    y += 44
    for line in ("30+ PROVIDERS", "LOCAL-FIRST", "AGENT · ARENA · MEMORY"):
        draw.text((x + 2, y), "▸", font=mono_b, fill=GREEN)
        draw.text((x + 26, y), line, font=mono_b, fill=WHITE)
        y += 28
    return y


def build(size, version, with_phone):
    base = vertical_gradient(size).convert("RGBA")
    base.alpha_composite(grid_overlay(size))
    draw = ImageDraw.Draw(base)
    W, H = size

    left_block(draw, version, W, big=(W > 1000))

    # Product panel: the arena chat region of the real dark capture.
    shot = Image.open(SHOTS / "arena-final-dark.png").convert("RGB")
    panel_w = 560 if W > 1000 else 520
    panel_h = round(H * 0.72)
    panel, shadow = paste_panel(base, chat_crop(shot), (panel_w, panel_h))
    px = W - panel_w - 56
    py = (H - panel_h) // 2
    base.alpha_composite(shadow, (px - 30, py - 30))
    base.alpha_composite(panel, (px, py))

    # Phone frame overlapping the panel's bottom-right corner.
    if with_phone:
        phone = Image.open(SHOTS / "phone-arena-framed-dark.png").convert("RGBA")
        ph = round(H * 0.86)
        pw = round(phone.width * ph / phone.height)
        phone = phone.resize((pw, ph), Image.LANCZOS)
        phone_shadow = Image.new("RGBA", (pw + 48, ph + 48), (0, 0, 0, 0))
        ImageDraw.Draw(phone_shadow).rounded_rectangle(
            (24, 28, 24 + pw, 28 + ph), radius=40, fill=(0, 0, 0, 150)
        )
        phone_shadow = phone_shadow.filter(ImageFilter.GaussianBlur(12))
        fx = W - pw - 28
        fy = H - ph + 26
        base.alpha_composite(phone_shadow, (fx - 24, fy - 24))
        base.alpha_composite(phone, (fx, fy))

    # Corner accent
    draw = ImageDraw.Draw(base)
    draw.line([(64, H - 26), (104, H - 26)], fill=GREEN, width=3)
    draw.text((112, H - 33), f"v{version} · MIT · OSS", font=font(MONO, 12), fill=GRAY)

    return base.convert("RGB")


def main():
    version = json.loads((ROOT / "manifest.json").read_text())["version"]
    hero = build((1280, 400), version, with_phone=False)
    hero.save(ROOT / "assets" / "hero.png")
    print("assets/hero.png:", hero.size)
    og = build((1200, 630), version, with_phone=True)
    og.save(ROOT / "assets" / "og.png")
    print("assets/og.png:", og.size)


if __name__ == "__main__":
    main()
