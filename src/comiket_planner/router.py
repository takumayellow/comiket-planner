"""巡回順の最適化。

定式化: 時間依存の報酬つき巡回 (prize-collecting / orienteering TSP)。
- 各サークルは「報酬」を持ち、遅い時刻に着くほど売り切れで報酬が目減りする。
- 優先度が高い・壁サークル(人気で早期完売しやすい)ほど、早く回りたい = 減衰が急。
- 時間予算があり全部は回れない場合、報酬密度の低いものから外す。

厳密解ではなく、重み付き貪欲構築 + 2-opt 改善のヒューリスティック。
サークル数は多くて数十なのでこれで十分実用的。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .catalog import Placement
from .layout import Layout, Point

# 優先度(1..5) → 基本の緊急度(売り切れ前に着きたい強さ) 0..1
PRIORITY_URGENCY = {1: 0.95, 2: 0.80, 3: 0.55, 4: 0.35, 5: 0.20}

DEFAULT_DWELL = 3.0        # 1サークルで並ぶ+買う時間 (分)。壁は別途上乗せ。
WALL_DWELL_BONUS = 7.0     # 壁サークルは行列が長い
SELLOUT_HALFLIFE_MIN = 90  # 緊急度1.0のサークルが半分の価値になるまで(分)


def _hhmm_to_min(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def _min_to_hhmm(x: float) -> str:
    x = int(round(x))
    return f"{x // 60 % 24:02d}:{x % 60:02d}"


@dataclass
class RouteStop:
    placement: Placement
    point: Point
    arrival_min: int
    depart_min: int
    walk_from_prev: float
    urgency: float

    @property
    def arrival(self) -> str:
        return _min_to_hhmm(self.arrival_min)


@dataclass
class RoutePlan:
    stops: list[RouteStop]
    dropped: list[Placement] = field(default_factory=list)
    unlocatable: list[Placement] = field(default_factory=list)
    start_zone: str = ""
    start_min: int = 0
    total_min: float = 0.0

    def as_dict(self) -> dict:
        return {
            "start_zone": self.start_zone,
            "start": _min_to_hhmm(self.start_min),
            "total_minutes": round(self.total_min, 1),
            "n_visited": len(self.stops),
            "n_dropped": len(self.dropped),
            "stops": [{
                "order": i + 1,
                "block": s.placement.block,
                "number": s.placement.number,
                "ab": s.placement.ab,
                "district": s.placement.district,
                "hall": s.placement.note or "",
                "label": s.placement.label,
                "priority": s.placement.priority,
                "arrival": s.arrival,
                "walk_min": round(s.walk_from_prev, 1),
                "confidence": s.placement.confidence,
            } for i, s in enumerate(self.stops)],
            "dropped": [f"{p.district}{p.key} {p.label}".strip() for p in self.dropped],
            "unlocatable": [f"{p.district}{p.key} {p.label}".strip()
                            for p in self.unlocatable],
        }


def _urgency(p: Placement, layout: Layout) -> float:
    u = PRIORITY_URGENCY.get(p.priority, 0.55)
    hit = layout._index.get(p.block)
    if hit and hit[1]["kind"] == "wall":
        u = min(1.0, u + 0.20)   # 壁は完売が早い
    if "人気" in p.tags or "壁" in p.tags:
        u = min(1.0, u + 0.10)
    return u


def _dwell(p: Placement, layout: Layout) -> float:
    hit = layout._index.get(p.block)
    wall = bool(hit and hit[1]["kind"] == "wall")
    return DEFAULT_DWELL + (WALL_DWELL_BONUS if wall else 0.0)


def _sellout_value(urgency: float, arrival_min: float, start_min: float) -> float:
    """到着時刻での期待価値 0..1。緊急度が高いほど時間減衰が急。"""
    elapsed = max(0.0, arrival_min - start_min)
    # 緊急度1.0 で halflife、緊急度低いほど半減期を延ばす
    halflife = SELLOUT_HALFLIFE_MIN / max(0.15, urgency)
    return 0.5 ** (elapsed / halflife)


def _resolve(placements, layout: Layout):
    nodes, unloc = [], []
    for p in placements:
        pt = layout.locate(p.block, p.number)
        if pt is None:
            unloc.append(p)
        else:
            nodes.append((p, pt, _urgency(p, layout), _dwell(p, layout)))
    return nodes, unloc


def _pick_start_zone(nodes, layout, override):
    if override:
        return override
    # 緊急度の総和が最大のゾーンから始める(人気が集中する棟に朝イチで入る想定)
    score: dict[str, float] = {}
    for p, pt, u, d in nodes:
        score[pt.zone] = score.get(pt.zone, 0.0) + u * p.priority ** 0
    return max(score, key=score.get) if score else "east123"


def _objective(order, layout, start_pt, start_min):
    """順序の評価値。小さいほど良い。移動時間 + 緊急度重み付き到着遅れペナルティ。"""
    t = start_min
    prev = start_pt
    cost = 0.0
    for (p, pt, u, d) in order:
        w = layout.walk_minutes(prev, pt)
        t += w
        # 期待価値の取りこぼし(1 - value)を緊急度で重み付け
        val = _sellout_value(u, t, start_min)
        cost += w + (1.0 - val) * u * 30.0
        t += d
        prev = pt
    return cost, t


def _greedy(nodes, layout, start_pt, start_min):
    remaining = list(nodes)
    order = []
    t = start_min
    prev = start_pt
    while remaining:
        best, best_score = None, None
        for cand in remaining:
            p, pt, u, d = cand
            w = layout.walk_minutes(prev, pt)
            arr = t + w
            val = _sellout_value(u, arr, start_min)
            # 近い + 緊急 を優先: 小さいほど良い
            score = w - u * 60.0 * val
            if best_score is None or score < best_score:
                best, best_score = cand, score
        order.append(best)
        remaining.remove(best)
        p, pt, u, d = best
        t += layout.walk_minutes(prev, pt) + d
        prev = pt
    return order


def _two_opt(order, layout, start_pt, start_min, rounds=40):
    best = order
    best_cost, _ = _objective(best, layout, start_pt, start_min)
    n = len(order)
    improved = True
    it = 0
    while improved and it < rounds:
        improved = False
        it += 1
        for i in range(n - 1):
            for j in range(i + 1, n):
                cand = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                c, _ = _objective(cand, layout, start_pt, start_min)
                if c + 1e-9 < best_cost:
                    best, best_cost = cand, c
                    improved = True
    return best


def plan_route(placements: list[Placement], layout: Layout, *,
               start_zone: str | None = None,
               start_time: str = "10:30",
               time_budget_min: int | None = None) -> RoutePlan:
    start_min = _hhmm_to_min(start_time)
    nodes, unloc = _resolve(placements, layout)
    if not nodes:
        return RoutePlan(stops=[], unlocatable=unloc, start_zone=start_zone or "",
                         start_min=start_min)

    zone = _pick_start_zone(nodes, layout, start_zone)
    start_pt = layout.entrance_point(zone)

    order = _greedy(nodes, layout, start_pt, start_min)
    order = _two_opt(order, layout, start_pt, start_min)

    # 予算超過なら報酬密度の低いものから外す (prize-collecting)
    dropped = []
    if time_budget_min is not None:
        while len(order) > 1:
            _, end = _objective(order, layout, start_pt, start_min)
            if end - start_min <= time_budget_min:
                break
            # 報酬密度 = 緊急度*優先度 / 立ち寄りコスト が最小のものを落とす
            worst_i, worst_v = 0, None
            for i, (p, pt, u, d) in enumerate(order):
                dens = (u * (6 - p.priority)) / (d + 1.0)
                if worst_v is None or dens < worst_v:
                    worst_i, worst_v = i, dens
            dropped.append(order[worst_i][0])
            order = order[:worst_i] + order[worst_i + 1:]
            order = _two_opt(order, layout, start_pt, start_min, rounds=15)

    # 時刻を確定
    stops = []
    t = start_min
    prev = start_pt
    for (p, pt, u, d) in order:
        w = layout.walk_minutes(prev, pt)
        arr = t + w
        stops.append(RouteStop(p, pt, int(round(arr)), int(round(arr + d)), w, u))
        t = arr + d
        prev = pt

    return RoutePlan(stops=stops, dropped=dropped, unlocatable=unloc,
                     start_zone=zone, start_min=start_min,
                     total_min=t - start_min)
