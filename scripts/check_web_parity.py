#!/usr/bin/env python3
"""check_web_parity.mjs と同じ入力を Python 実装で解いて JSON を出す。

    python scripts/check_web_parity.py > a.json
    node   scripts/check_web_parity.mjs > b.json
    diff a.json b.json     # 差分ゼロなら移植は等価
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from comiket_planner.catalog import parse_line  # noqa: E402
from comiket_planner.layout import load_layout  # noqa: E402
from comiket_planner.router import plan_route  # noqa: E402

CASES = [
    "東H07 *2 ホロライブ",
    "東E18-22 *2 ぺこら",
    "西あ36 *2 ごちうさ",
    "西せ9-15 *3 おにまい",
    "南q06,10,16 *4",
    "東ア86-88 *4 艦これ",
    "西め37 *4",
    "西す23 *3 五等分の花嫁",
]

RUNS = {
    "west_free": {"start_zone": "west12", "start_time": "11:20", "time_budget_min": None},
    "west_280": {"start_zone": "west12", "start_time": "11:20", "time_budget_min": 280},
    "auto_200": {"start_zone": None, "start_time": "10:30", "time_budget_min": 200},
}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    layout = load_layout()
    placements = [p for line in CASES for p in parse_line(line)[0]]

    out = {
        "n_parsed": len(placements),
        "parsed": [f"{p.district}{p.block}{p.number}{p.ab}|{p.priority}|{p.label}"
                   for p in placements],
        "runs": {},
    }
    for name, opt in RUNS.items():
        plan = plan_route(placements, layout, **opt)
        out["runs"][name] = {
            "start_zone": plan.start_zone,
            "total": f"{plan.total_min:.3f}",  # 文字列で出す(丸め方式の差で誤検知しない)
            "stops": [f"{s.arrival} {s.placement.district}{s.placement.block}"
                      f"{s.placement.number}" for s in plan.stops],
            "dropped": [f"{p.district}{p.block}{p.number}" for p in plan.dropped],
        }
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
