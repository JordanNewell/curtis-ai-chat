#!/usr/bin/env python3
"""Press assets for the Curtis AI Chat GitHub site.

Knocks the supplied logo masters out to flat NEWELL colors, then builds the
README banner and the Open Graph card. No gradients, grids, glows, or shadows.

Sources:
  assets/brand/wordmark-source.jpg
  assets/brand/mark-source.jpg
  assets/screenshots/desktop-chat.png
  manifest.json

Outputs:
  assets/logo-wordmark.png  assets/logo-mark.png
  assets/hero.png           assets/og.png
  docs/assets/wordmark.png  docs/assets/mark.png
  docs/assets/screenshots/hero-chat.png
  docs/favicon-32.png docs/favicon-512.png docs/apple-touch-icon.png docs/favicon.ico

Usage: python scripts/build_hero.py
"""

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "brand"
SHOTS = ROOT / "assets" / "screenshots"
DOCS = ROOT / "docs"
FONTS = Path(__file__).resolve().parent / "fonts"

BG = (10, 10, 10)
SURFACE = (15, 15, 15)
GREEN = (0, 255, 65)
WHITE = (255, 255, 255)
MUTED = (160, 160, 160)
BORDER = (31, 31, 31)

DISPLAY = str(FONTS / "space-grotesk-700.ttf")
DISPLAY_MED = str(FONTS / "space-grotesk-500.ttf")
MONO = str(FONTS / "jetbrains-mono-500.ttf")


def font(path, size):
    return ImageFont.truetype(path, size)


def knockout(path):
    """Black-key a JPEG logo to #00FF41 / #FFFFFF with an alpha edge."""
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    dominance = g - np.maximum(r, b)
    green_a = np.clip(dominance / 80.0, 0, 1) * np.clip((g - 36) / 70.0, 0, 1)
    mn = np.minimum(np.minimum(r, g), b)
    spread = np.maximum(np.maximum(r, g), b) - mn
    white_a = np.clip((mn - 28) / 150.0, 0, 1) * np.clip(1 - spread / 36.0, 0, 1)
    white_a *= 1 - np.clip(green_a * 1.6, 0, 1)
    green_a = np.where(green_a < 0.07, 0, green_a)
    white_a = np.where(white_a < 0.07, 0, white_a)
    use_white = white_a >= green_a
    alpha = np.maximum(green_a, white_a)
    out = np.zeros((*rgb.shape[:2], 4), dtype=np.uint8)
    out[:, :, 0] = np.where(use_white, 255, GREEN[0])
    out[:, :, 1] = np.where(use_white, 255, GREEN[1])
    out[:, :, 2] = np.where(use_white, 255, GREEN[2])
    out[:, :, 3] = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    image = Image.fromarray(out)
    return crop_alpha(image, pad=0)


def crop_alpha(image, pad):
    alpha = np.asarray(image)[:, :, 3]
    ys, xs = np.where(alpha > 16)
    if len(xs) == 0:
        raise SystemExit("logo knockout produced an empty image")
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(image.width, x1 + pad)
    y1 = min(image.height, y1 + pad)
    return image.crop((x0, y0, x1, y1))


def plate(mark, size):
    """App-icon plate. Corners stay transparent so it sits on #0A0A0A."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    radius = round(size * 0.18)
    stroke = max(2, round(size / 128))
    draw.rounded_rectangle(
        (stroke // 2, stroke // 2, size - 1 - stroke // 2, size - 1 - stroke // 2),
        radius=radius,
        fill=BG + (255,),
        outline=BORDER + (255,),
        width=stroke,
    )
    target = round(size * 0.66)
    scale = target / max(mark.size)
    resized = mark.resize(
        (max(1, round(mark.width * scale)), max(1, round(mark.height * scale))),
        Image.Resampling.LANCZOS,
    )
    x = (size - resized.width) // 2
    y = (size - resized.height) // 2 - round(size * 0.02)
    canvas.alpha_composite(resized, (x, y))
    return canvas


def fill_canvas(mark, size):
    """Opaque #0A0A0A tile for favicons. iOS masks apple-touch itself."""
    canvas = Image.new("RGBA", (size, size), BG + (255,))
    target = round(size * 0.62)
    scale = target / max(mark.size)
    resized = mark.resize(
        (max(1, round(mark.width * scale)), max(1, round(mark.height * scale))),
        Image.Resampling.LANCZOS,
    )
    x = (size - resized.width) // 2
    y = (size - resized.height) // 2 - round(size * 0.02)
    canvas.alpha_composite(resized, (x, y))
    return canvas


def chat_crop(shot):
    """The plugin column sits on the left of the 1920-wide desktop capture."""
    w, h = shot.size
    # 784/1920 is the chat column's right edge on the current desktop capture.
    return shot.crop((0, 0, round(w * 0.408), h))


def framed(shot, box, radius=12):
    w, h = box
    scale = max(w / shot.width, h / shot.height)
    resized = shot.resize(
        (round(shot.width * scale), round(shot.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - w) // 2
    top = (resized.height - h) // 2
    resized = resized.crop((left, top, left + w, top + h)).convert("RGBA")
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    resized.putalpha(mask)
    frame = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle(
        (0, 0, w + 1, h + 1), radius=radius, fill=SURFACE + (255,), outline=BORDER + (255,)
    )
    frame.paste(resized, (1, 1), resized)
    return frame


def paste_wordmark(base, wordmark, x, y, height):
    scale = height / wordmark.height
    resized = wordmark.resize(
        (round(wordmark.width * scale), height),
        Image.Resampling.LANCZOS,
    )
    base.alpha_composite(resized, (x, y))
    return resized.size


def build_card(size, version, wordmark, shot):
    w, h = size
    base = Image.new("RGBA", size, BG + (255,))
    draw = ImageDraw.Draw(base)
    big = w >= 1240

    x = 64
    y = 72 if big else 64
    mark_h = 148 if big else 120
    _mw, mh = paste_wordmark(base, wordmark, x, y, mark_h)

    draw = ImageDraw.Draw(base)
    ty = y + mh + 32
    draw.text(
        (x, ty),
        "Polyglot AI chat for Obsidian.",
        font=font(DISPLAY, 36 if big else 30),
        fill=WHITE,
    )
    ty += 52 if big else 44
    draw.text(
        (x, ty),
        "Your vault stays yours.",
        font=font(DISPLAY_MED, 22 if big else 18),
        fill=MUTED,
    )
    ty += 40
    draw.text(
        (x, ty),
        f"v{version}   ·   30+ PROVIDERS   ·   MIT",
        font=font(MONO, 14 if big else 12),
        fill=MUTED,
    )

    panel_w = 520 if big else 460
    panel_h = h - 112
    panel = framed(shot, (panel_w, panel_h))
    base.alpha_composite(panel, (w - panel_w - 48, (h - panel.height) // 2))

    return base.convert("RGB")


def save_png(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)


def main():
    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
    wordmark = knockout(BRAND / "wordmark-source.jpg")
    mark = knockout(BRAND / "mark-source.jpg")

    save_png(wordmark, ROOT / "assets" / "logo-wordmark.png")
    icon = plate(mark, 1024)
    save_png(icon, ROOT / "assets" / "logo-mark.png")
    save_png(wordmark, DOCS / "assets" / "wordmark.png")
    save_png(icon, DOCS / "assets" / "mark.png")

    tile = fill_canvas(mark, 512)
    save_png(tile, DOCS / "favicon-512.png")
    save_png(tile.resize((32, 32), Image.Resampling.LANCZOS), DOCS / "favicon-32.png")
    save_png(tile.resize((180, 180), Image.Resampling.LANCZOS), DOCS / "apple-touch-icon.png")
    tile.resize((32, 32), Image.Resampling.LANCZOS).save(
        DOCS / "favicon.ico",
        sizes=[(32, 32)],
    )

    shot = chat_crop(Image.open(SHOTS / "desktop-chat.png").convert("RGB"))
    save_png(shot, DOCS / "assets" / "screenshots" / "hero-chat.png")

    hero = build_card((1280, 640), version, wordmark, shot)
    og = build_card((1200, 630), version, wordmark, shot)
    hero.save(ROOT / "assets" / "hero.png", "PNG", optimize=True)
    og.save(ROOT / "assets" / "og.png", "PNG", optimize=True)

    # Pages references these; they lived only under assets/ and 404'd on the site.
    pairs = [
        (ROOT / "assets" / "demo-arena-local-vs-cloud.mp4", DOCS / "assets" / "demo-arena-local-vs-cloud.mp4"),
        (ROOT / "assets" / "demo-memory.mp4", DOCS / "assets" / "demo-memory.mp4"),
        (SHOTS / "arena-streaming-dark.png", DOCS / "assets" / "screenshots" / "arena-streaming-dark.png"),
        (SHOTS / "phone-arena-framed-dark.png", DOCS / "assets" / "screenshots" / "phone-arena-framed-dark.png"),
    ]
    for src, dst in pairs:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists() or dst.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dst)

    corner = hero.getpixel((4, 4))
    sample = wordmark.getpixel((wordmark.width // 5, wordmark.height // 2))
    print("hero", hero.size, "corner", corner)
    print("wordmark", wordmark.size, "sample", sample)
    print("mark", icon.size)
    if corner != BG:
        raise SystemExit(f"hero background {corner} is not #0A0A0A")
    if sample[3] > 200 and sample[:3] not in (GREEN, WHITE):
        raise SystemExit(f"wordmark sample {sample} left the brand palette")


if __name__ == "__main__":
    main()
