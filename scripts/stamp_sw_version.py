#!/usr/bin/env python3
"""web/sw.js の VERSION を、先読み対象ファイルの中身から算出した値に打ち直す。

VERSION を手で上げる運用だと「JS だけ直して sw.js を触らなかった」ときに
install イベントが発火せず、端末に古いモジュールが残り続ける。実体の
ハッシュから決めておけば、中身が変われば必ず VERSION も変わる。

    python scripts/stamp_sw_version.py          # 打ち直して差分の有無を出す
    python scripts/stamp_sw_version.py --check  # 打ち直さず、ズレていたら exit 1

デプロイ前に実行する。--check は CI 用。
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SW = ROOT / "web" / "sw.js"

_ASSETS_BLOCK = re.compile(r"const ASSETS = \[(.*?)\];", re.S)
_ITEM = re.compile(r"'([^']+)'")
_VERSION = re.compile(r"(const VERSION = ')([^']*)(';)")


def asset_paths() -> list[Path]:
    """sw.js の ASSETS 配列をそのまま実ファイルに解決する ('./' は index.html)。"""
    m = _ASSETS_BLOCK.search(SW.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("sw.js の ASSETS 配列が見つからない")
    out = []
    for rel in _ITEM.findall(m.group(1)):
        name = "index.html" if rel == "./" else rel.removeprefix("./")
        p = SW.parent / name
        if not p.is_file():
            raise SystemExit(f"ASSETS に実体のない項目がある: {rel}")
        out.append(p)
    return out


def digest() -> str:
    h = hashlib.sha256()
    for p in asset_paths():
        # パス名も混ぜる。中身が同じでもファイルが増減したら別バージョンにする
        h.update(p.name.encode("utf-8"))
        h.update(p.read_bytes())
    # sw.js 自身の挙動が変わったときも新バージョンにしたいので、VERSION 行を
    # 除いた sw.js 本体も混ぜる
    h.update(_VERSION.sub(r"\1\3", SW.read_text(encoding="utf-8")).encode("utf-8"))
    return f"cp-{h.hexdigest()[:12]}"


def main() -> None:
    check = "--check" in sys.argv[1:]
    src = SW.read_text(encoding="utf-8")
    m = _VERSION.search(src)
    if not m:
        raise SystemExit("sw.js の VERSION 宣言が見つからない")
    want = digest()
    cur = m.group(2)
    if cur == want:
        print(f"VERSION は最新: {want}")
        return
    if check:
        print(f"VERSION が古い: {cur} → {want} "
              f"(python scripts/stamp_sw_version.py を実行してからデプロイする)")
        raise SystemExit(1)
    SW.write_text(_VERSION.sub(rf"\g<1>{want}\g<3>", src, count=1), encoding="utf-8")
    print(f"VERSION 更新: {cur} → {want}")


if __name__ == "__main__":
    main()
