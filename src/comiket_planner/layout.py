"""会場レイアウトの読み込みと、ブロック記号+番号 → 座標 の解決。

座標系: ゾーン(east123 / east7 / west12 / south12)ごとにローカルな平面座標 (メートル)。
ゾーンをまたぐ移動は layout.transfer_minutes を使う (歩行距離では測らない)。
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_HERE = Path(__file__).resolve()
# インストール後は package data、リポジトリ実行時は data/layout を見る
_CANDIDATES = [
    _HERE.parent / "data" / "c108.json",
    _HERE.parents[2] / "data" / "layout" / "c108.json",
]
DATA = next((p for p in _CANDIDATES if p.exists()), _CANDIDATES[-1])

FACE_OFFSET = 2.2  # 島の中心線から、そのスペースの前に立つ位置まで (m)


@dataclass(frozen=True)
class Point:
    zone: str
    x: float
    y: float


class Layout:
    def __init__(self, doc: dict):
        self.doc = doc
        self.params = doc["params"]
        self.zones = doc["zones"]
        self.transfer = doc["transfer_minutes"]
        self.genre_day1 = doc.get("genre_day1", {})
        self.genre_day2 = doc.get("genre_day2", {})
        # code -> (zone_id, block dict)
        self._index: dict[str, tuple[str, dict]] = {}
        for zid, z in self.zones.items():
            for b in z["blocks"]:
                self._index[b["code"]] = (zid, b)

    # -- ブロック解決 --------------------------------------------------------
    def zone_of(self, code: str) -> str | None:
        hit = self._index.get(code)
        return hit[0] if hit else None

    def hall_of(self, code: str, number: int | None = None) -> str | None:
        hit = self._index.get(code)
        if not hit:
            return None
        b = hit[1]
        if b["kind"] == "wall" and number is not None:
            for hall, lo, hi in b.get("hall_ranges", []):
                if lo <= number <= hi:
                    return hall
        return b.get("hall")

    def locate(self, code: str, number: int) -> Point | None:
        """ブロック記号+番号 → ゾーン内座標。未知の記号は None。"""
        hit = self._index.get(code)
        if not hit:
            return None
        zid, b = hit
        if b["kind"] == "island":
            return self._locate_island(zid, b, number)
        return self._locate_wall(zid, b, number)

    def _locate_island(self, zid, b, number: int) -> Point:
        size = b["size"]
        half = size // 2
        n = max(1, min(number, size))
        y0, y1 = b["y0"], b["y1"]
        if n <= half:  # 右面: 下→上
            t = (n - 0.5) / half
            y = y0 + t * (y1 - y0)
            x = b["x"] + FACE_OFFSET
        else:          # 左面: 上→下
            t = (n - half - 0.5) / half
            y = y1 - t * (y1 - y0)
            x = b["x"] - FACE_OFFSET
        return Point(zid, round(x, 2), round(y, 2))

    def _locate_wall(self, zid, b, number: int) -> Point:
        lo, hi = b["from"], b["to"]
        n = max(lo, min(number, hi))
        frac = (n - lo) / max(1, hi - lo)
        pts = b["path"]
        # 折れ線をたどって frac の位置を返す
        seglen = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        total = sum(seglen) or 1.0
        target = frac * total
        acc = 0.0
        for i, L in enumerate(seglen):
            if acc + L >= target or i == len(seglen) - 1:
                r = (target - acc) / (L or 1.0)
                x = pts[i][0] + r * (pts[i + 1][0] - pts[i][0])
                y = pts[i][1] + r * (pts[i + 1][1] - pts[i][1])
                return Point(zid, round(x, 2), round(y, 2))
            acc += L
        return Point(zid, pts[-1][0], pts[-1][1])

    # -- 距離/時間 ----------------------------------------------------------
    def walk_minutes(self, a: Point, b: Point) -> float:
        """2点間の歩行時間 (分)。同ゾーンは通路距離近似、別ゾーンは transfer 表。"""
        if a.zone == b.zone:
            d = self._aisle_distance(a, b)
            return d / self.params["walk_speed_m_per_min"]
        # transfer 表のキー順に依存しない (どちら向きでも引ける)
        t = self.transfer.get(f"{a.zone}|{b.zone}")
        if t is None:
            t = self.transfer.get(f"{b.zone}|{a.zone}")
        return float(t if t is not None else 20)

    def _aisle_distance(self, a: Point, b: Point) -> float:
        """同ゾーン内の近似通路距離。島に沿って歩くので L1 (マンハッタン) 基調。

        列(縦)方向は自由に動けるが、島をまたぐ横移動は最寄りの交差通路まで
        縦に出てから、という往復コストを少しだけ上乗せする。
        """
        z = self.zones[a.zone]
        dx = abs(a.x - b.x)
        dy = abs(a.y - b.y)
        base = dx + dy
        if dx > 4.0:  # 別の島どうし: 交差通路へ抜ける縦移動が要る
            aisles = z.get("cross_aisles", [])
            if aisles:
                nearest = min(aisles, key=lambda ya: abs(ya - a.y) + abs(ya - b.y))
                detour = (abs(a.y - nearest) + abs(b.y - nearest)) - dy
                base += max(0.0, detour) * 0.5
        return base

    def entrance_point(self, zone: str) -> Point:
        """そのゾーンの入口(会場入場後に立つ想定位置)。下辺中央あたり。"""
        z = self.zones[zone]
        return Point(zone, z["width"] / 2.0, 4.0)


@lru_cache(maxsize=1)
def load_layout(path: str | None = None) -> Layout:
    p = Path(path) if path else DATA
    return Layout(json.loads(p.read_text(encoding="utf-8")))
