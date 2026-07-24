import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from comiket_planner import load_layout, parse_placement, parse_placements, plan_route
from comiket_planner.catalog import parse_line


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


# ラベル抽出は「場所の書き方だけを削る」。作品名の中の記号+数字を巻き込むと
# 東方Project が「方Project」になる (実際に起きた)。web/js/catalog.js と同一挙動。
def test_label_keeps_title_containing_place_words():
    for line, want in [
        ("西あ36 *2 東方Project", "東方Project"),
        ("西あ36 *2 東京リベンジャーズ", "東京リベンジャーズ"),
        ("西あ36 *3 西住みほ", "西住みほ"),
        ("南q06 *3 南ことり", "南ことり"),
        ("西あ36 *2 アイマス765プロ", "アイマス765プロ"),
        ("西あ36 *2 壁は完売が早いので優先2", "壁は完売が早いので優先2"),
    ]:
        assert parse_line(line)[2] == want, line


def test_label_strips_location_forms():
    for line, want in [
        ("西せ9-15 *3 範囲で書くと島ごと拾う", "範囲で書くと島ごと拾う"),
        ("南q06,10,16 *4 番号の列挙もできる", "番号の列挙もできる"),
        ("西地区 あ36 *1 メモ", "メモ"),
        ("西あ36-39 東H07 まとめ書き", "まとめ書き"),
        ("東H07 *2", ""),
    ]:
        assert parse_line(line)[2] == want, line


def test_priority_marker_without_separator_and_fullwidth():
    # *2ホロライブ のような続け書き、および全角入力(＊２ / あ３６)
    assert parse_line("西あ36 *2ホロライブ")[1:] == (2, "ホロライブ")
    assert parse_line("東Ｈ０７　＊２　ホロライブ")[1:] == (2, "ホロライブ")
    assert parse_line("西あ３６ *2 ごちうさ")[1:] == (2, "ごちうさ")
