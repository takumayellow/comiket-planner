#!/usr/bin/env python3
"""C108 の会場レイアウト JSON を生成する。

ソース (いずれも準備会の公式発表。事実データのみを転記し、地図画像そのものは持たない):
  - ホール別ジャンル配置 (https://www.comiket.co.jp/info-a/C108/C108Genre.html)
      東1 = ア01〜39 + イ〜ス / 東2 = ア40〜56 + セ〜ハ / 東3 = ア57〜95 + ヒ〜ヨ
      東7 = A〜W / 西1 = つ〜め / 西2 = あ〜ち
      南1 = a33〜54 + k〜t / 南2 = a01〜32 + b〜j
  - C108 折込地図 (島の並び順・上下段構成・壁番号の回り方をここから読み取った)

座標は「歩行時間を見積もるための近似モデル」であって実測図面ではない。
1スペース 0.9m / 島ピッチ 7.5m という実寸ベースの近似で、島内・島間の相対距離が
合っていれば巡回順の最適化には十分、という割り切り。

    python scripts/build_layout.py            # -> data/layout/c108.json
"""

from __future__ import annotations

import json
from pathlib import Path

SPACE_W = 0.9        # 1スペースの幅 (m)
ISLAND_PITCH = 7.5   # 島と島の中心間距離 (m)
CENTER_AISLE = 4.0   # 島を上下に割る中央通路の幅 (m)
FACE_OFFSET = 2.2    # 島の中心線から、そのスペースの前に立つ位置までの距離 (m)

# --- ブロック記号の並び (五十音/アルファベット順) ---------------------------
EAST_ISLANDS = "イウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨ"
E1, E2, E3 = EAST_ISLANDS[:12], EAST_ISLANDS[12:25], EAST_ISLANDS[25:]

WEST2_ISLANDS = "いうえおかきくけこさしすせそたち"   # 16
WEST1_ISLANDS = "つてとなにぬねのはひふへほまみむ"   # 16

SOUTH2_ISLANDS = "bcdefghij"     # 9
SOUTH1_ISLANDS = "klmnopqrst"    # 10

EAST7_UPPER = "BCDEFGHIJKLM"     # 12 (地図上 右→左 が B→M)
EAST7_LOWER = "NOPQRSTUVW"       # 10


def build_zone(name, label, rows, walls, transfer_key):
    """rows: [{"id":..,"order":[左→右のcode],"size":..}] / walls: 壁ブロック定義"""
    blocks = []
    n_row = len(rows)
    row_len = max(len(r["order"]) for r in rows)
    width = (row_len + 1) * ISLAND_PITCH
    # 島の長さ = 片面スペース数 * 幅 + 中央通路
    def island_len(size):
        return (size // 2) * SPACE_W + CENTER_AISLE
    depth_used = sum(island_len(r["size"]) for r in rows) + 14.0 * n_row
    depth = max(depth_used, 40.0)

    cross_aisles = []
    y_cursor = 10.0
    for r in rows:
        L = island_len(r["size"])
        y0, y1 = y_cursor, y_cursor + L
        r["y0"], r["y1"] = y0, y1
        # 島の下端 / 中央通路 / 上端 の3か所が「列をまたげる」場所
        cross_aisles += [y0 - 2.0, (y0 + y1) / 2.0, y1 + 2.0]
        # 端は左右にずらして中央寄せ
        pad = (width - len(r["order"]) * ISLAND_PITCH) / 2.0
        for i, code in enumerate(r["order"]):
            blocks.append({
                "code": code, "hall": r["hall_of"][code], "kind": "island",
                "size": r["size"], "row": r["id"],
                "x": round(pad + (i + 0.5) * ISLAND_PITCH, 2),
                "y0": round(y0, 2), "y1": round(y1, 2),
            })
        y_cursor = y1 + 14.0

    for w in walls:
        w = dict(w)
        w["kind"] = "wall"
        w["path"] = [[round(x, 2), round(y, 2)] for x, y in w["path"]]
        blocks.append(w)

    return {
        "id": name, "label": label,
        "width": round(width, 2), "depth": round(depth, 2),
        "cross_aisles": [round(y, 2) for y in sorted(set(cross_aisles))],
        "blocks": blocks,
        "transfer_key": transfer_key,
    }


def main() -> int:
    zones = {}

    # --- 東1-3 (ひとつながりのフロア。島は1列) ------------------------------
    hall_of = {c: ("東1" if c in E1 else "東2" if c in E2 else "東3") for c in EAST_ISLANDS}
    rows = [{"id": "main", "hall_of": hall_of, "size": 52,
             "order": list(reversed(EAST_ISLANDS))}]  # 地図左端がヨ、右端がイ
    w = (len(EAST_ISLANDS) + 1) * ISLAND_PITCH
    d = 52 // 2 * SPACE_W + CENTER_AISLE + 28.0
    # ア: 東1の右辺を上り → 天井側(北)を左へ → 東3の左辺を下り → 南側を右へ
    a_path = [(w - 3, 6), (w - 3, d - 6), (3, d - 6), (3, 6), (18, 6)]
    zones["east123"] = build_zone(
        "east123", "東1・2・3ホール", rows,
        [{"code": "ア", "hall": "東1-3", "from": 1, "to": 95, "path": a_path,
          "hall_ranges": [["東1", 1, 39], ["東2", 40, 56], ["東3", 57, 95]]}],
        "east123")

    # --- 東7 (上下2列 + 壁A) -------------------------------------------------
    h7 = {c: "東7" for c in EAST7_UPPER + EAST7_LOWER}
    rows7 = [{"id": "upper", "hall_of": h7, "size": 48, "order": list(reversed(EAST7_UPPER))},
             {"id": "lower", "hall_of": h7, "size": 48, "order": list(reversed(EAST7_LOWER))}]
    w7 = (12 + 1) * ISLAND_PITCH
    d7 = 2 * (24 * SPACE_W + CENTER_AISLE) + 28.0
    a7 = [(w7 - 3, d7 - 6), (3, d7 - 6), (3, 6), (w7 - 20, 6)]
    zones["east7"] = build_zone(
        "east7", "東7ホール", rows7,
        [{"code": "A", "hall": "東7", "from": 1, "to": 50, "path": a7,
          "hall_ranges": [["東7", 1, 50]]}],
        "east7")

    # --- 西1+西2 (ひとつながり。西1が左/西2が右。各ホール上下2列) -----------
    hw = {c: "西1" for c in WEST1_ISLANDS}
    hw.update({c: "西2" for c in WEST2_ISLANDS})
    # 地図から読んだ実際の並び (左→右)
    upper_order = list("ふひはのねぬになとてつ") + list("ちたそせすしさこけくき")
    lower_order = list("むみまほへ") + list("かおえうい")
    rowsw = [{"id": "upper", "hall_of": hw, "size": 52, "order": upper_order},
             {"id": "lower", "hall_of": hw, "size": 52, "order": lower_order}]
    ww = (22 + 1) * ISLAND_PITCH
    dw = 2 * (26 * SPACE_W + CENTER_AISLE) + 28.0
    # め: 西1(左半分)の外周。あ: 西2(右半分)の外周。番号は下辺→縦辺→上辺の順。
    me_path = [(ww * 0.45, 6), (3, 6), (3, dw - 6), (ww * 0.40, dw - 6)]
    a_path_w = [(ww * 0.55, 6), (ww - 3, 6), (ww - 3, dw - 6), (ww * 0.60, dw - 6)]
    zones["west12"] = build_zone(
        "west12", "西1・2ホール", rowsw,
        [{"code": "め", "hall": "西1", "from": 1, "to": 60, "path": me_path,
          "hall_ranges": [["西1", 1, 60]]},
         {"code": "あ", "hall": "西2", "from": 1, "to": 60, "path": a_path_w,
          "hall_ranges": [["西2", 1, 60]]}],
        "west12")

    # --- 南1+南2 (ひとつながり。南1が左/南2が右。島は1列) -------------------
    hs = {c: "南1" for c in SOUTH1_ISLANDS}
    hs.update({c: "南2" for c in SOUTH2_ISLANDS})
    order_s = list(reversed(SOUTH1_ISLANDS)) + list(reversed(SOUTH2_ISLANDS))
    rowss = [{"id": "main", "hall_of": hs, "size": 46, "order": order_s}]
    ws = (19 + 1) * ISLAND_PITCH
    ds = 23 * SPACE_W + CENTER_AISLE + 28.0
    # a: 南2の右辺を上る(1-20) → 上辺を左へ(21-44) → 南1の左辺を下る(45-50) → 下辺(51-54)
    a_path_s = [(ws - 3, 6), (ws - 3, ds - 6), (3, ds - 6), (3, 6), (16, 6)]
    zones["south12"] = build_zone(
        "south12", "南1・2ホール", rowss,
        [{"code": "a", "hall": "南1-2", "from": 1, "to": 54, "path": a_path_s,
          "hall_ranges": [["南2", 1, 32], ["南1", 33, 54]]}],
        "south12")

    doc = {
        "event": "コミックマーケット108",
        "dates": ["2026-08-15", "2026-08-16"],
        "venue": "東京ビッグサイト",
        "precision": "approximate",
        "note": "座標は歩行時間見積もり用の近似モデル。ブロック記号とホール対応は公式発表の転記。",
        "params": {"space_w": SPACE_W, "island_pitch": ISLAND_PITCH,
                   "center_aisle": CENTER_AISLE, "face_offset": FACE_OFFSET,
                   "walk_speed_m_per_min": 45.0},
        # ゾーン間 (=別フロア/別棟) の移動所要 (分)。当日の混雑・一方通行規制込みの実感値。
        "transfer_minutes": {
            "east123|east7": 10, "east123|west12": 15, "east123|south12": 18,
            "east7|west12": 20, "east7|south12": 22, "west12|south12": 6,
        },
        "zones": zones,
        "genre_day1": {
            "東1": ["ブルーアーカイブ"],
            "東2": ["ブルーアーカイブ", "ゲーム(電源不要)", "ゲーム(その他)", "刀剣乱舞",
                    "ゲーム(恋愛・ソーシャル女性向)", "ゲーム(RPG)",
                    "スクウェア・エニックス(RPG)", "ウマ娘"],
            "東3": ["ウマ娘", "TYPE-MOON", "艦これ"],
            "東7": ["オリジナル雑貨", "VTuber"],
            "西1": ["ゲーム(ネット・ソーシャル)", "アズールレーン"],
            "西2": ["ゲーム(ネット・ソーシャル)", "FC(少年)", "FC(少女・青年)",
                    "TV・映画・芸能・特撮", "FC(ジャンプその他)"],
            "南1": ["創作(JUNE/BL)", "FC（小説）", "ガンダム", "ガルパン",
                    "アニメ（少女）", "アニメ（その他）"],
            "南2": ["アニメ（その他）"],
        },
        "genre_day2": {
            "東1": ["男性向"],
            "東2": ["男性向", "鉄道・旅行・メカミリ", "ギャルゲー"],
            "東3": ["ギャルゲー", "ラブライブ！", "アイドルマスター"],
            "東7": ["同人ソフト", "男性向"],
            "西1": ["創作（少年）", "創作（少女）", "学漫", "歴史・創作（文芸・小説）"],
            "西2": ["創作（少年）", "評論・情報", "東方Project", "デジタル（その他）"],
            "南1": ["評論・情報", "コスプレ"],
            "南2": ["コスプレ"],
        },
    }

    root = Path(__file__).resolve().parents[1]
    payload = json.dumps(doc, ensure_ascii=False, indent=2)
    for out in [root / "data" / "layout" / "c108.json",
                root / "src" / "comiket_planner" / "data" / "c108.json"]:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload, encoding="utf-8")
    n = sum(len(z["blocks"]) for z in zones.values())
    print(f"data/layout/c108.json + package copy ({n} blocks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
