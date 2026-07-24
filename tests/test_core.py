import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from comiket_planner import load_layout, parse_placement, parse_placements, plan_route


def test_parse_single():
    got = parse_placement("西あ36a *1 ごちうさ")
    assert len(got) == 1
    p = got[0]
    assert p.block == "あ" and p.number == 36 and p.ab == "a"
    assert p.district == "西"


def test_parse_range():
    got = parse_placement("東ア86-88")
    assert [p.number for p in got] == [86, 87, 88]
    assert all(p.block == "ア" for p in got)


def test_parse_list():
    got = parse_placement("南q06,10,16")
    assert sorted(p.number for p in got) == [6, 10, 16]


def test_locate_island_and_wall():
    L = load_layout()
    # 島ブロック
    pt = L.locate("な", 13)
    assert pt is not None and pt.zone == "west12"
    # 壁ブロック
    w = L.locate("ア", 86)
    assert w is not None and w.zone == "east123"
    assert L.hall_of("ア", 86) == "東3"


def test_hall_from_wall_range():
    L = load_layout()
    assert L.hall_of("a", 10) == "南2"
    assert L.hall_of("a", 50) == "南1"


def test_route_orders_by_priority():
    L = load_layout()
    ps = parse_placements("東H07 *1\n東H28 *5")
    for p in ps:
        p.priority = 1 if p.number == 7 else 5
    plan = plan_route(ps, L, start_zone="east7", start_time="10:30")
    assert len(plan.stops) == 2


def test_budget_drops_lowest():
    L = load_layout()
    ps = parse_placements("東H07 *1\n西あ36 *5\n南q06 *5")
    plan = plan_route(ps, L, start_time="10:30", time_budget_min=15)
    assert len(plan.stops) >= 1
    assert len(plan.stops) + len(plan.dropped) == 3


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
