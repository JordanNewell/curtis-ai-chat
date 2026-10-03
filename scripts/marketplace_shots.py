#!/usr/bin/env python3
"""Produce directory-ready screenshots at the recommended sizes.

Entry shots: 1200x800 (3:2). Mobile shots: 900x1600 (9:16) — expected to be
captured natively at 2x DPR by the harness; this script only pads/crops if
the source ratio is off.

Usage: python scripts/marketplace_shots.py
Writes to ~/Downloads/curtis-screenshots/ and prints a manifest.
"""

import os
from PIL import Image

SRC = "assets/screenshots"
OUT = os.path.join(os.path.expanduser("~"), "Downloads", "curtis-screenshots")


def to_entry(src_name, out_name):
    """Center-crop to 3:2, resize to 1200x800."""
    im = Image.open(os.path.join(SRC, src_name)).convert("RGB")
    w, h = im.size
    target = 3 / 2
    if w / h > target:  # too wide — crop width
        new_w = int(h * target)
        left = (w - new_w) // 2
        im = im.crop((left, 0, left + new_w, h))
    else:  # too tall — crop height (keep the top area: header content matters)
        new_h = int(w / target)
        top = max(0, (h - new_h) // 3)
        im = im.crop((0, top, w, top + new_h))
    im = im.resize((1200, 800), Image.LANCZOS)
    path = os.path.join(OUT, out_name)
    im.save(path, optimize=True)
    return path, im.size


def to_mobile(src_name, out_name):
    """Fit to 900x1600: native if already exact; else pad/crop minimally."""
    im = Image.open(os.path.join(SRC, src_name)).convert("RGB")
    w, h = im.size
    target = 9 / 16
    if abs(w / h - target) < 0.01:
        im = im.resize((900, 1600), Image.LANCZOS) if (w, h) != (900, 1600) else im
    elif w / h > target:  # too wide — crop width
        new_w = int(h * target)
        left = (w - new_w) // 2
        im = im.crop((left, 0, left + new_w, h)).resize((900, 1600), Image.LANCZOS)
    else:  # too tall — crop from the top (keep header + conversation start)
        new_h = int(w / target)
        im = im.crop((0, 0, w, new_h)).resize((900, 1600), Image.LANCZOS)
    path = os.path.join(OUT, out_name)
    im.save(path, optimize=True)
    return path, im.size


def main():
    os.makedirs(OUT, exist_ok=True)
    results = [
        to_entry("desktop-chat.png", "entry-1-desktop-agent-chat.png"),
        to_entry("desktop-settings-providers.png", "entry-2-provider-settings.png"),
    ]
    for mobile_src in ("phone-chat.png", "phone-chat-bottom.png"):
        src = os.path.join(SRC, mobile_src)
        if os.path.exists(src):
            name = ("mobile-1-agent-chat.png" if mobile_src == "phone-chat.png"
                    else "mobile-2-agent-chat-input.png")
            results.append(to_mobile(mobile_src, name))
    for path, size in results:
        kb = os.path.getsize(path) // 1024
        print(f"{path}  {size[0]}x{size[1]}  {kb} KB")


if __name__ == "__main__":
    main()
