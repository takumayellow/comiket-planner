#!/usr/bin/env python3
"""data/layout/c108.json → web/js/layout-data.js (静的PWA用の同梱データ)。

公開する静的サイトはサーバを持たないので、レイアウト(ゾーン/島/壁の座標モデル)を
JS モジュールとして同梱する。ここに入れてよいのは自前で組んだ座標モデルだけで、
公式の折込地図画像・サークル名DBは含めない (docs/data-sources.md の線引き)。
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "layout" / "c108.json"
DST = ROOT / "web" / "js" / "layout-data.js"

# 経路計算と概略図に要るものだけ。ジャンル配置表は Web 版では使わないので載せない
# (配布物を必要最小限に保つ)。
KEYS = ("event", "dates", "venue", "precision", "note",
        "params", "transfer_minutes", "zones")


def main() -> None:
    doc = json.loads(SRC.read_text(encoding="utf-8"))
    keep = {k: doc[k] for k in KEYS if k in doc}
    body = json.dumps(keep, ensure_ascii=False, separators=(",", ":"))
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(
        f"// 自動生成: data/layout/c108.json より ({Path(__file__).name})\n"
        "// 公式の地図画像・サークル名DBは一切含まない (docs/data-sources.md 参照)\n"
        f"export const LAYOUT_DOC = {body};\n", encoding="utf-8")
    print(f"{DST.relative_to(ROOT)}  {DST.stat().st_size} bytes")


if __name__ == "__main__":
    main()
