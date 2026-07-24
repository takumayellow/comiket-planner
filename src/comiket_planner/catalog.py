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
    # 優先度マーカー *1〜*5 を除去。境界は \b でなく「次が数字でないこと」。
    # \b だと *2ホロライブ のような続け書き(かな漢字は単語文字)を取りこぼし、
    # JS 版(\d を使えない)と挙動が割れる。
    s = re.sub(r"\*\s*[1-5](?![0-9])", " ", s)
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

    found: list[tuple[tuple[int, int], Placement]] = []   # (出現位置, 配置)
    seen: set[tuple[str, int, str]] = set()
    taken: list[tuple[int, int]] = []                     # 範囲が食った区間

    # 「あ36-39」形式: ブロック直後に範囲。「あ36,38-40」のように列挙の途中に
    # 出てくる範囲 (記号なし) は、直前の区切りとブロック記号を引き継いで拾う。
    for bm in re.finditer(
        rf"([{re.escape(_HIRA + _KANA + _LAT_UP + _LAT_LO)}])?\s*"
        r"(\d{1,3})\s*[-〜~ー]\s*(\d{1,3})", s):
        blk, lo, hi = bm.group(1), int(bm.group(2)), int(bm.group(3))
        if blk is None:
            before = s[max(0, bm.start() - 2):bm.start()]
            if not re.search(r"[,、，・]\s*$", before):
                continue
            blk = _carry_block(s, bm.start())
        if blk not in VALID_BLOCKS or not (0 < lo <= hi <= 99):
            continue
        taken.append((bm.start(), bm.end()))
        for n in range(lo, hi + 1):
            seen.add((blk, n, ""))
            found.append(((bm.start(), n),
                          Placement(block=blk, number=n, district=district, raw=raw)))

    # 「あ36,38,39」/ 単発「あ36a」。カンマ列挙のときだけブロック記号を引き継ぐ。
    # 範囲を見つけても打ち切らない。打ち切ると「あ36-39,48」の 48 が黙って消える。
    last_block = ""
    token_re = re.compile(
        rf"([{re.escape(_HIRA + _KANA + _LAT_UP + _LAT_LO)}])?\s*"
        r"(\d{1,3})\s*([ab])?", re.I)
    for tm in token_re.finditer(s):
        if any(lo <= tm.start() < hi for lo, hi in taken):
            continue                                       # 範囲として展開済み
        blk = tm.group(1)
        num, ab = int(tm.group(2)), (tm.group(3) or "").lower()
        if blk is None:
            # ブロック無しの裸番号: 直前が区切り(, 、・)のときだけ列挙とみなす。
            # 範囲の直後 (あ36-39,48) も列挙の続きなので、範囲のブロックを引き継ぐ。
            before = s[max(0, tm.start() - 2):tm.start()]
            carry = last_block or _carry_block(s, tm.start())
            if carry and re.search(r"[,、，・]\s*$", before):
                blk = carry
            else:
                continue
        if blk not in VALID_BLOCKS or not (0 < num <= 99):
            continue
        last_block = blk
        k = (blk, num, ab)
        if k in seen:
            continue
        seen.add(k)
        found.append(((tm.start(), num),
                      Placement(block=blk, number=num, ab=ab,
                                district=district, raw=raw)))

    found.sort(key=lambda x: x[0])
    return [p for _, p in found]


_BLOCK_USE = re.compile(
    rf"([{re.escape(_HIRA + _KANA + _LAT_UP + _LAT_LO)}])\s*\d")


def _carry_block(s: str, pos: int) -> str:
    """pos より前で最後に「記号+番号」として使われたブロック記号。"""
    last = ""
    for m in _BLOCK_USE.finditer(s, 0, pos):
        last = m.group(1)
    return last


_PRIO_MARK = re.compile(r"\*\s*([1-5])(?![0-9])")

# ラベル側から「場所の書き方」だけを削る。
# 行頭か区切り(空白・読点)の直後にある塊しか削らないのが肝。無条件に削ると
# 「東方Project」「西住みほ」「アイマス765プロ」のように、作品名の途中の
# 記号+数字まで巻き込んで消してしまう (東→方Project など実害あり)。
_BLK_CLS = re.escape(_HIRA + _KANA + _LAT_UP + _LAT_LO)
_STRIP_TOKENS = re.compile(
    r"(^|[\s,、，・])"
    rf"(?:[東西南]?\s*(?:地区)?\s*[{_BLK_CLS}]\s*\d{{1,3}}"
    r"(?:\s*[-〜~ー]\s*\d{1,3}|\s*[ab])?"
    r"|\d{1,3}\s*[-〜~ー]\s*\d{1,3})"
    r"|[,、，・]\s*\d{1,3}\s*[ab]?"       # 列挙の続き (,10 ,16)
    r"|[東西南]?地区", re.I)


def parse_line(line: str) -> tuple[list[Placement], int, str]:
    """1行を (配置リスト, 優先度, ラベル) に分解する。CLI と Web で共通利用。

    優先度は `*1`〜`*5`(無ければ3)。ラベルは記号/番号/区名を取り除いた残り。
    """
    placements = parse_placement(line)
    # 配置側は _normalize 済みの文字列を見ているので、ラベル側も NFKC を通す。
    # そうしないと全角(＊２ / あ３６)が優先度にもラベル除去にも引っかからない。
    norm = unicodedata.normalize("NFKC", line)
    pm = _PRIO_MARK.search(norm)
    priority = int(pm.group(1)) if pm else 3
    label = _PRIO_MARK.sub(" ", norm)
    label = _STRIP_TOKENS.sub(r"\1 ", label)
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
