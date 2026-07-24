import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from comiket_planner import load_layout, parse_placement, parse_placements, plan_route
from comiket_planner.catalog import parse_line
from comiket_planner.freeform import parse_free_text


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


# ---- 自由文 (freeform) ----
# 「1行1件」「*3 で優先度」という書式を守らせないための層。書式が崩れた入力ほど
# 移植差・退行が出やすいので、代表的な崩れ方を固定しておく。


def test_freeform_splits_run_on_speech():
    entries = parse_free_text(
        "西のあ36の○○が絶対欲しい、あと東H07も。南q06,10,16は余裕があれば")
    assert [e.priority for e in entries] == [1, 3, 4]
    assert [len(e.placements) for e in entries] == [1, 1, 3]
    assert entries[0].placements[0].district == "西"
    assert entries[2].cue == "余裕があれば"


def test_freeform_priority_prefers_stronger_cue():
    # 「絶対」(強さ4) > 「欲しい」(2) / 「余裕があれば」(5) > 「欲しい」(2)
    assert parse_free_text("東H07 絶対欲しい")[0].priority == 1
    assert parse_free_text("東H07 余裕があれば欲しい")[0].priority == 4
    assert parse_free_text("東H07 ホロライブ")[0].priority == 3


def test_freeform_explicit_marker_wins():
    e = parse_free_text("東H07 絶対欲しい *4")[0]
    assert e.priority == 4 and e.explicit is True


def test_freeform_district_not_taken_from_prose():
    # 「東方Project」の東を配置の地区にしてはいけない
    e = parse_free_text("東方Projectのサークルが西R12bにいるので必ず行く")[0]
    assert e.placements[0].district == "西"
    assert e.priority == 1


def test_freeform_line_break_is_a_hard_boundary():
    entries = parse_free_text("西す23 *4 五等分の花嫁\n何も配置がわからないメモ")
    assert len(entries) == 2
    assert entries[1].placements == []


def test_freeform_label_drops_place_and_particle():
    e = parse_free_text("西のあ36のごちうさ")[0]
    assert e.label == "ごちうさ"
    # 助詞は1文字だけ落とす (作品名の先頭を削らない)
    assert parse_free_text("東H07 のんのんびより")[0].label == "のんのんびより"


def test_freeform_equal_weight_cues_take_the_later_one():
    # 同じ重みの手がかりが並んだら後ろを採る (日本語は文末に本音が来る)
    assert parse_free_text("東H08は絶対欲しいけどできれば")[0].priority == 4
    assert parse_free_text("東H08はできれば絶対")[0].priority == 1


def test_placement_mixes_range_and_enumeration():
    # 「あ36-39,45」「あ36,38-40」。範囲と列挙が混ざっても取りこぼさない
    assert [p.number for p in parse_placement("西あ36-39,45")] == [36, 37, 38, 39, 45]
    assert [p.number for p in parse_placement("あ36,38-40")] == [36, 38, 39, 40]


def test_freeform_keeps_unreadable_placement_as_its_own_entry():
    # 番号が範囲外 (西す230) の書き間違いを隣の件に吸収させない
    entries = parse_free_text("西す230、東H07")
    assert len(entries) == 2
    assert entries[0].placements == []
    assert [p.block for p in entries[1].placements] == ["H"]


def test_freeform_reads_fullwidth_digits_and_marker():
    e = parse_free_text("西お３６の○○が絶対欲しい ＊２")[0]
    assert e.placements[0].number == 36
    assert e.priority == 2 and e.explicit is True


def test_label_drops_priority_wording_and_hall_prefix():
    # 「ついででいいや」はサークル名ではない。名前として意味のある部分だけ残す
    assert parse_free_text("東5 ア86-88はついででいいや")[0].label == ""
    assert parse_free_text("西のあ36の○○が絶対欲しい")[0].label == "○○"
    assert parse_free_text("東H08あたりは時間があれば見たい")[0].label == ""
    assert parse_free_text("西め37は優先2")[0].label == ""
    # 手がかり語が接続表現でつながっていても、まとめて落とす
    assert parse_free_text("東H08は絶対欲しいけどできれば")[0].label == ""
    assert (parse_free_text("東方Projectのサークルが西R12bにいるらしいので必ず行く")[0].label
            == "東方Projectのサークル")


def test_label_keeps_names_that_contain_cue_words():
    # 手がかり語が名前の一部に入っているだけなら削らない (途中では切らない)
    assert parse_free_text("西き12の推しの子")[0].label == "推しの子"
    assert parse_free_text("西あ36の絶対少女")[0].label == "絶対少女"
    assert parse_free_text("のんのんびよりの新刊が東H07にあるはず")[0].label == "のんのんびよりの新刊"
