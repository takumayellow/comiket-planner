"""行きたいサークルの入力テキストを、構造化された配置(Placement)に変換する。

対応する書き方 (ゆるく受ける):
    西あ36a / 西地区あ36 / 西2 あ 36a
    東H07 / 東地区 H 7 / H-07
    南q06 / 南 q 6
    あ36-39            (範囲。36,37,38,39 に展開)
    あ36,38,39         (列挙)
音声メモを文字起こししたテキストも、このパーサに通す前提で正規化しておく。
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

DISTRICTS = {
    "東": "東", "西": "西", "南": "南",
    "east": "東", "west": "西", "south": "南",
}

# ブロック記号として妥当な1文字 (ひらがな / カタカナ / ラテン大小)
_HIRA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめ"
_KANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨ"
_LAT_UP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_LAT_LO = "abcdefghijklmnopqrstuvwxyz"
VALID_BLOCKS = set(_HIRA + _KANA + _LAT_UP + _LAT_LO)


@dataclass
class Placement:
    block: str                       # ブロック記号 (1文字)
    number: int                      # スペース番号
    ab: str = ""                     # 'a' / 'b' / ''
    district: str = ""               # 東/西/南 (入力にあれば)
    priority: int = 3                # 1(最優先)〜5(ついで)。既定3
    label: str = ""                  # サークル名 / 作品名 (任意)
    raw: str = ""                    # 元テキスト
    note: str = ""
    confidence: str = "ok"           # ok / 要確認
    tags: list[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return f"{self.block}{self.number:02d}{self.ab}"


def _normalize(s: str) -> str:
    # 全角英数→半角、全角スペース→半角。ブロック記号のかな/カナは保持。
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("地区", "")
    s = re.sub(r"[（）\(\)]", " ", s)
    s = re.sub(r"\*\s*[1-5]\b", " ", s)   # 優先度マーカー *1〜*5 を除去
    return s


_DIST_RE = re.compile(r"(東|西|南|east|west|south)", re.I)
_NUM_RANGE = re.compile(r"(\d{1,3})\s*[-〜~ー]\s*(\d{1,3})")
_SINGLE = re.compile(
    rf"([{re.escape(_HIRA + _KANA + _LAT_UP + _LAT_LO)}])\s*"
    r"(\d{1,3})\s*([ab])?", re.I)


def parse_placement(text: str) -> list[Placement]:
    """1行から 0..N 個の Placement を取り出す。範囲・列挙を展開する。"""
    raw = text.strip()
    if not raw:
        return []
    s = _normalize(raw)

    district = ""
    m = _DIST_RE.search(s)
    if m:
        district = DISTRICTS.get(m.group(1).lower(), m.group(1))

    out: list[Placement] = []

    # 「あ36-39」形式: ブロック直後に範囲
    for bm in re.finditer(
        rf"([{re.escape(_HIRA + _KANA + _LAT_UP + _LAT_LO)}])\s*"
        r"(\d{1,3})\s*[-〜~ー]\s*(\d{1,3})", s):
        blk, lo, hi = bm.group(1), int(bm.group(2)), int(bm.group(3))
        if blk not in VALID_BLOCKS or not (0 < lo <= hi <= 99):
            continue
        for n in range(lo, hi + 1):
            out.append(Placement(block=blk, number=n, district=district, raw=raw))
    if out:
        return out

    # 「あ36,38,39」/ 単発「あ36a」。カンマ列挙のときだけブロック記号を引き継ぐ。
    seen = set()
    last_block = ""
    token_re = re.compile(
        rf"([{re.escape(_HIRA + _KANA + _LAT_UP + _LAT_LO)}])?\s*"
        r"(\d{1,3})\s*([ab])?", re.I)
    for tm in token_re.finditer(s):
        blk = tm.group(1)
        num, ab = int(tm.group(2)), (tm.group(3) or "").lower()
        if blk is None:
            # ブロック無しの裸番号: 直前が区切り(, 、・)のときだけ列挙とみなす
            before = s[max(0, tm.start() - 2):tm.start()]
            if last_block and re.search(r"[,、，・]\s*$", before):
                blk = last_block
            else:
                continue
        if blk not in VALID_BLOCKS or not (0 < num <= 99):
            continue
        last_block = blk
        k = (blk, num, ab)
        if k in seen:
            continue
        seen.add(k)
        out.append(Placement(block=blk, number=num, ab=ab,
                             district=district, raw=raw))
    return out


_PRIO_MARK = re.compile(r"\*\s*([1-5])\b")
_STRIP_TOKENS = re.compile(
    r"[東西南](?:地区)?"
    rf"|[{re.escape(_HIRA + _KANA + _LAT_UP + _LAT_LO)}]\s*\d{{1,3}}\s*[ab]?"
    r"|\d{1,3}\s*[-〜~ー]\s*\d{1,3}"
    r"|[,、，・]?\s*\d{1,3}\s*[ab]?"
    r"|地区", re.I)


def parse_line(line: str) -> tuple[list[Placement], int, str]:
    """1行を (配置リスト, 優先度, ラベル) に分解する。CLI と Web で共通利用。

    優先度は `*1`〜`*5`(無ければ3)。ラベルは記号/番号/区名を取り除いた残り。
    """
    placements = parse_placement(line)
    pm = _PRIO_MARK.search(line)
    priority = int(pm.group(1)) if pm else 3
    label = _PRIO_MARK.sub(" ", line)
    label = _STRIP_TOKENS.sub(" ", label)
    label = re.sub(r"\s+", " ", label).strip(" 　,、，・")
    for p in placements:
        p.priority = priority
        if label:
            p.label = label
    return placements, priority, label


def parse_placements(text: str) -> list[Placement]:
    """複数行/カンマ区切りのまとまったテキストをまとめて解析。"""
    placements: list[Placement] = []
    for line in re.split(r"[\n;]", text):
        placements.extend(parse_placement(line))
    return placements
