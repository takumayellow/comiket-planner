"""コマンドライン: テキストの行きたいリスト → 巡回順。

    python -m comiket_planner.cli wishlist.txt --start 10:30
    echo "西あ36a *1 ごちうさ" | python -m comiket_planner.cli -

入力の各行フォーマット (ゆるく解釈):
    <ブロック><番号>[a|b]  [*優先度]  [ラベル]
    例: 東H07a *1 ホロライブ / 西あ36-39 / 南q06,10 *4
"""

from __future__ import annotations

import argparse
import json
import sys

from .catalog import parse_line
from .layout import load_layout
from .router import plan_route


def _read_lines(src: str):
    if src == "-":
        return sys.stdin.read().splitlines()
    with open(src, encoding="utf-8") as f:
        return f.read().splitlines()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="行きたいサークル → 巡回順")
    ap.add_argument("input", help="行きたいリストのファイル、または - で標準入力")
    ap.add_argument("--start", default="10:30", help="会場に入る時刻 HH:MM")
    ap.add_argument("--start-zone", default=None,
                    help="east123 / east7 / west12 / south12")
    ap.add_argument("--budget", type=int, default=None, help="使える時間(分)")
    ap.add_argument("--json", action="store_true", help="JSON で出力")
    args = ap.parse_args(argv)

    layout = load_layout()
    placements = []
    for line in _read_lines(args.input):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        got, _prio, _label = parse_line(line)
        placements.extend(got)

    plan = plan_route(placements, layout, start_zone=args.start_zone,
                      start_time=args.start, time_budget_min=args.budget)

    if args.json:
        print(json.dumps(plan.as_dict(), ensure_ascii=False, indent=2))
        return 0

    print(f"■ 入場: {args.start}  開始ゾーン: {plan.start_zone}  "
          f"所要 約{plan.total_min:.0f}分  {len(plan.stops)}サークル")
    for i, s in enumerate(plan.stops, 1):
        p = s.placement
        tag = "" if p.confidence == "ok" else " ⚠要確認"
        print(f"{i:2d}. {s.arrival}  {p.district}{p.block}{p.number:02d}{p.ab}"
              f"  優先{p.priority}  {p.label}{tag}  (+{s.walk_from_prev:.0f}分)")
    if plan.dropped:
        print("\n▲ 時間の都合で外した候補:")
        for p in plan.dropped:
            print(f"   {p.district}{p.key} {p.label}")
    if plan.unlocatable:
        print("\n? 場所を特定できなかった入力:")
        for p in plan.unlocatable:
            print(f"   {p.raw}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
