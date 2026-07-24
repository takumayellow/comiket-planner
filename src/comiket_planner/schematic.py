"""会場の概略図(SVG)を、事実データの座標モデルから自前で描く。

公式の地図画像は使わない（再配布不可）。ゾーンを横に並べ、島を短冊、壁を線で表現し、
経路の立ち寄りブロックに順番の番号を打つだけの、あくまで「位置関係がわかる」概略図。
"""

from __future__ import annotations

from .layout import Layout
from .router import RoutePlan

ZONE_ORDER = ["east123", "east7", "west12", "south12"]
GAP = 40.0
PAD = 30.0

COL_BG = "#0f1115"
COL_ZONE = "#1b1f2a"
COL_ZONE_EDGE = "#2c3346"
COL_ISLAND = "#3a4256"
COL_WALL = "#4b5670"
COL_CODE = "#5b677f"
COL_HALL = "#7a86a0"
COL_LABEL = "#9aa7bd"


def _stop_color(priority: int) -> str:
    if priority <= 2:
        return "#e5484d"
    if priority == 3:
        return "#f2c94c"
    return "#5aa9e6"


def render(layout: Layout, plan: RoutePlan | None = None) -> str:
    zones = [z for z in ZONE_ORDER if z in layout.zones]
    offsets, ox, height = {}, PAD, 0.0
    for zid in zones:
        z = layout.zones[zid]
        offsets[zid] = ox
        ox += z["width"] + GAP
        height = max(height, z["depth"])
    total_w = ox - GAP + PAD
    total_h = height + PAD * 2 + 30

    stop_by_zone: dict[str, list] = {}
    if plan:
        for i, s in enumerate(plan.stops, 1):
            stop_by_zone.setdefault(s.point.zone, []).append((i, s))

    def Y(y):  # 画面は上が0。会場のyは下→上なので反転
        return PAD + (height - y)

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '
           f'{total_w:.0f} {total_h:.0f}" font-family="sans-serif">',
           f'<rect width="{total_w:.0f}" height="{total_h:.0f}" fill="{COL_BG}"/>']

    for zid in zones:
        z = layout.zones[zid]
        dx = offsets[zid]
        out.append(f'<rect x="{dx-8:.1f}" y="{PAD-8:.1f}" '
                   f'width="{z["width"]+16:.1f}" height="{height+16:.1f}" '
                   f'rx="8" fill="{COL_ZONE}" stroke="{COL_ZONE_EDGE}"/>')
        out.append(f'<text x="{dx+z["width"]/2:.1f}" y="{PAD-14:.1f}" '
                   f'fill="{COL_LABEL}" font-size="13" text-anchor="middle">'
                   f'{z["label"]}</text>')

        for b in z["blocks"]:
            if b["kind"] == "island":
                x = dx + b["x"]
                out.append(f'<rect x="{x-3:.1f}" y="{Y(b["y1"]):.1f}" width="6" '
                           f'height="{b["y1"]-b["y0"]:.1f}" rx="2" '
                           f'fill="{COL_ISLAND}" fill-opacity="0.55"/>')
                out.append(f'<text x="{x:.1f}" y="{Y(b["y0"])-2:.1f}" '
                           f'fill="{COL_CODE}" font-size="9" '
                           f'text-anchor="middle">{b["code"]}</text>')
            else:
                pts = " ".join(f"{dx+px:.1f},{Y(py):.1f}" for px, py in b["path"])
                out.append(f'<polyline points="{pts}" fill="none" '
                           f'stroke="{COL_WALL}" stroke-width="3" '
                           f'stroke-opacity="0.6"/>')
                hx, hy = b["path"][0]
                out.append(f'<text x="{dx+hx:.1f}" y="{Y(hy):.1f}" '
                           f'fill="{COL_HALL}" font-size="11" '
                           f'font-weight="bold">{b["code"]}</text>')

        for i, s in stop_by_zone.get(zid, []):
            x, y = dx + s.point.x, Y(s.point.y)
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" '
                       f'fill="{_stop_color(s.placement.priority)}"/>')
            out.append(f'<text x="{x:.1f}" y="{y+3.5:.1f}" fill="{COL_BG}" '
                       f'font-size="9" font-weight="bold" text-anchor="middle">'
                       f'{i}</text>')

    return "\n".join(out) + "\n</svg>"
