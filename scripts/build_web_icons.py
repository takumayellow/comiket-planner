#!/usr/bin/env python3
"""PWA 用アイコンを生成する (web/icons/)。

デザインは公式カタログ準拠の路線: 黒地 + 斜めの赤帯 + 太ゴシックの「巡」。
外部素材を使わないので配布上の問題が無い。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "icons"

INK = (11, 11, 13, 255)
RED = (230, 0, 18, 255)
PAPER = (244, 241, 234, 255)

FONT_CANDIDATES = [
    "C:/Windows/Fonts/meiryob.ttc",
    "C:/Windows/Fonts/YuGothB.ttc",
    "C:/Windows/Fonts/msgothic.ttc",
]


def _font(px: int) -> ImageFont.FreeTypeFont:
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return ImageFont.truetype(p, px)
    raise SystemExit("日本語の太ゴシックフォントが見つかりません")


def draw_icon(size: int, safe: float = 1.0) -> Image.Image:
    img = Image.new("RGBA", (size, size), INK)
    d = ImageDraw.Draw(img)
    s = size

    # 斜めのハザードストライプ (カタログ表紙の帯のイメージ)
    band = s * 0.13 * safe
    top = s * 0.055 / safe
    d.polygon([(0, top + band), (0, top), (s, top - band * 0.55),
               (s, top + band * 0.45)], fill=RED)

    # 主役: ブロック記号のかわりに「巡」
    px = int(s * 0.52 * safe)
    f = _font(px)
    box = d.textbbox((0, 0), "巡", font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((s - w) / 2 - box[0], (s - h) / 2 - box[1] + s * 0.05), "巡",
           font=f, fill=PAPER)

    # 足元の赤いルール線
    y = s * 0.855 / safe if safe == 1.0 else s * 0.80
    d.rectangle([s * 0.22, y, s * 0.78, y + max(2, s * 0.028)], fill=RED)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        p = OUT / f"icon-{size}.png"
        draw_icon(size).save(p)
        print(p.relative_to(ROOT), p.stat().st_size, "bytes")
    # maskable は端が丸く切られるので中身を小さめに置く
    p = OUT / "icon-maskable-512.png"
    draw_icon(512, safe=0.74).save(p)
    print(p.relative_to(ROOT), p.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
