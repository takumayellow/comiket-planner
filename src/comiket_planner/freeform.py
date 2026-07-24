"""自由文 (音声メモの書き起こし / 走り書き / 長文の貼り付け) を1件ずつに切り分け、
優先度を文面から推定する。

catalog.parse_line は「1行1件・優先度は *3」という整った書式を前提にしている。
実際の入力はそうならない — 喋った内容を書き起こすと改行は入らないし、
優先度を数字で言う人はいない ("絶対欲しい" "余裕があれば" と言う)。
その落差をここで吸収して、ユーザーに書式を守らせないで済むようにする。

    西のあ36の○○絶対欲しい、あと東H07も。南q06,10,16は余裕があれば
      → [あ36 優先1 "○○絶対欲しい"], [H07 優先3], [q06,10,16 優先4]

web/js/freeform.js と1対1で対応させること (scripts/check_web_parity.* で突き合わせる)。
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from .catalog import Placement, parse_placement

_BLK = re.escape(
    "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめ"
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨ"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")

# 「西地区 あ36a」「東H07」「せ9-15」「q06,10,16」を1つの塊として位置だけ拾う。
# 妥当性 (番号の範囲など) は catalog.parse_placement に判定させるので、ここは緩くてよい。
_SPAN = re.compile(
    rf"(?:[東西南]\s*(?:地区)?\s*(?:の)?\s*)?[{_BLK}]\s*\d{{1,3}}"
    r"(?:\s*[-〜~ー]\s*\d{1,3})?(?:\s*[ab])?"
    r"(?:\s*[,、，・]\s*\d{1,3}(?:\s*[-〜~ー]\s*\d{1,3})?\s*[ab]?)*", re.I)

# 件と件の切れ目になりうるもの。話し言葉の接続詞まで見るのは、書き起こしに
# 句読点がほとんど入らないため (「〜欲しいあと西の〜」で切れないと1件に潰れる)。
_BREAK = re.compile(
    r"[\n\r。．！!？?；;]|[、,，・/｜|]"
    r"|あとは|あと|それから|そのあと|そのご|つぎに|次に|さらに|加えて|あわせて|それと")

_LEAD = re.compile(
    r"^(?:[\s　\n\r。．！!？?；;、,，・/｜|]+"
    r"|(?:あとは|あと|それから|そのあと|そのご|つぎに|次に|さらに|加えて|あわせて|それと))+")
_TRAIL = re.compile(r"[\s　\n\r。．；;、,，・/｜|]+$")

_PRIO_MARK = re.compile(r"\*\s*([1-5])(?![0-9])")
_PRIO_WORD = re.compile(r"優先(?:度)?\s*[:：]?\s*([1-5])(?![0-9])")

# 文面 → 優先度。(語, 優先度, 強さ)。強さが大きいものを優先し、同点なら後に出た方
# (日本語は文末の言い方で決まる)。「絶対欲しい」は 絶対(4) > 欲しい(2) で優先1、
# 「余裕があれば欲しい」は 余裕があれば(5) > 欲しい(2) で優先4、と解ける。
_CUES: tuple[tuple[str, int, int], ...] = (
    ("何が何でも", 1, 5), ("死んでも", 1, 5), ("最優先", 1, 5), ("落とせない", 1, 5),
    ("命がけ", 1, 5), ("一番欲しい", 1, 5), ("本命", 1, 4), ("必須", 1, 4),
    ("絶対", 1, 4), ("ぜったい", 1, 4), ("マスト", 1, 4), ("必ず", 1, 4),
    ("確実に", 1, 4), ("真っ先", 1, 4), ("開幕", 1, 3),

    ("優先", 2, 3), ("早めに", 2, 3), ("早めが", 2, 3), ("なるべく", 2, 3),
    ("できるだけ", 2, 3), ("出来るだけ", 2, 3), ("押さえたい", 2, 3), ("確保", 2, 3),
    ("大事", 2, 3), ("欲しい", 2, 2), ("ほしい", 2, 2), ("買いたい", 2, 2),
    ("推し", 2, 2),

    ("余裕があれば", 4, 5), ("余裕あれば", 4, 5), ("余裕があったら", 4, 5),
    ("時間があれば", 4, 5), ("時間があったら", 4, 5), ("できれば", 4, 4),
    ("出来れば", 4, 4), ("できたら", 4, 4), ("可能なら", 4, 4), ("行けたら", 4, 4),
    ("寄れたら", 4, 4), ("回れたら", 4, 4), ("あわよくば", 4, 4),

    ("買えなくてもいい", 5, 5), ("なくてもいい", 5, 5), ("無くてもいい", 5, 5),
    ("気が向いたら", 5, 5), ("冷やかし", 5, 5), ("ついで", 5, 5), ("暇なら", 5, 5),
    ("暇だったら", 5, 5), ("最悪いい", 5, 4), ("余ったら", 5, 4), ("見れたら", 5, 4),
    ("見られたら", 5, 4), ("おまけ", 5, 4), ("後回し", 5, 4),
)

# ラベルに残っても名前の役に立たないもの。優先度の指定と、配置の前に書かれがちな
# ホール名 (「東5 ア86-88」の「東5」) を落とす。
_LABEL_DROP = re.compile(
    r"\*\s*[1-5](?![0-9])"
    r"|優先(?:度)?\s*[:：]?\s*[1-5](?![0-9])"
    r"|地区"
    r"|[東西南]\s*\d{1,3}(?:\s*[・,、]\s*\d{1,3})*(?:\s*ホール)?")
_LABEL_EDGE = " 　\t,、，.。・:：;；/|｜!！?？「」『』\"'"
# 配置を抜いた跡に残る助詞。「あ36の○○」→「○○」。落とすのは配置に「くっついて
# いる」1文字だけ。間に空白があるものは助詞ではなく本文の頭 (「東H07 のんのん
# びより」の「の」) なので触らない。
_JOSHI_HEAD = re.compile(r"^[のはがをにへともでや]")
_JOSHI_TAIL = re.compile(r"[のはがをにへともでや]$")

# 優先度の言い回しはサークル名ではない。「ついででいいや」をサークル名として
# 巡回順に出しても当日の役に立たないので、末尾が手がかり語と助詞だけでできて
# いる範囲を切り落とす。途中では切らない — 名前そのものに手がかり語が入る
# ことがある (「推しの子」の「推し」を抜くと別物になる)。
_MODAL: tuple[str, ...] = (
    "欲しい", "ほしい", "買いたい", "買う", "行きたい", "行く", "見たい", "見る",
    "回りたい", "回る", "寄りたい", "寄る", "取りたい", "取る", "したい", "する",
    "いいや", "いい", "大丈夫", "あるはず", "ある", "いる", "はず", "らしい",
    "みたい", "かも", "思う", "予定", "チェック",
)
# 手がかり語同士をつなぐ言い方。これ自体は手がかりではないので hit にしない
# (「絶対欲しいけどできれば」の「けど」を跨げないと、前半が名前として残る)。
_JOIN: tuple[str, ...] = ("けれども", "けれど", "けど", "ので", "のに", "から",
                          "って", "ても", "でも", "そして", "あと")
_CUT_WORDS: tuple[str, ...] = tuple(sorted(
    {w for w, _, _ in _CUES} | set(_MODAL), key=len, reverse=True))
# 手がかり語の間に挟まってよい文字 (助詞・活用の尻尾・区切り)。
_FILLER = frozenset(" 　\t,、，・/|｜!！?？。．のはがをにへともでやかなねよっただしまん")
# 切り落とした後に残っても名前として意味を成さない語。
_NOISE_LABEL = frozenset({"あたり", "へん", "とか", "など", "こと", "もの", "やつ",
                          "ところ", "ほう", "サークル"})


@dataclass
class Entry:
    """自由文から切り出した1件。"""

    raw: str                              # 切り出した断片そのもの
    placements: list[Placement] = field(default_factory=list)
    priority: int = 3
    cue: str = ""                         # 優先度の根拠になった語 ("" なら既定値)
    label: str = ""
    explicit: bool = False                # 数字で明示されていたか (*2 / 優先2)


def normalize(text: str) -> str:
    """全角英数などをそろえる。以降の位置(index)はこの文字列基準で扱う。"""
    return unicodedata.normalize("NFKC", text)


def _spans(text: str) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for m in _SPAN.finditer(text):
        if parse_placement(m.group(0)):
            out.append((m.start(), m.end()))
    return out


def _cut_spans(text: str) -> list[tuple[int, int]]:
    """件の切れ目を決めるための塊。読めた配置に加えて「地区付きなのに読めな
    かった塊」も入れる。番号が範囲外の書き間違い (西す230) を隣の件に吸収させると、
    その件が黙って消えたうえ隣に誤ったラベルが付く。独立した件として立てておけば
    「場所を読み取れませんでした」に出る。
    """
    out: list[tuple[int, int]] = []
    for m in _SPAN.finditer(text):
        if parse_placement(m.group(0)) or m.group(0)[0] in "東西南":
            out.append((m.start(), m.end()))
    return out


def split_entries(text: str) -> list[str]:
    """自由文を1件ずつの断片に切る。改行があってもなくても同じ結果に落とす。

    切れ目は「次の配置表記の直前にある最後の区切り」。区切りが無ければ配置の直前。
    こうするとサークル名が前にある書き方 (「○○は西あ36、△△は東H07」) でも
    後にある書き方 (「西あ36の○○、東H07の△△」) でも同じように割れる。
    """
    spans = _cut_spans(text)

    cuts = {0, len(text)}
    for i in range(1, len(spans)):
        gap_lo, gap_hi = spans[i - 1][1], spans[i][0]
        last = None
        for bm in _BREAK.finditer(text, gap_lo, gap_hi):
            last = bm
        cuts.add(last.start() if last else gap_hi)
    # 改行はユーザーが自分で入れた区切り。配置の有無に関わらずここで必ず切る
    # (切らないと、配置の書いていない行が前の件のメモとして吸収されて消える)。
    for m in re.finditer(r"[\n\r]", text):
        if not any(lo < m.start() < hi for lo, hi in spans):
            cuts.add(m.start())

    ordered = sorted(cuts)
    out = []
    for lo, hi in zip(ordered, ordered[1:]):
        s = _clean_edges(text[lo:hi])
        if s:
            out.append(s)
    return out


def _clean_edges(s: str) -> str:
    prev = None
    while prev != s:
        prev = s
        s = _LEAD.sub("", s)
        s = _TRAIL.sub("", s)
    return s


def infer_priority(text: str) -> tuple[int, str, bool]:
    """(優先度, 根拠になった語, 明示されていたか) を返す。"""
    m = _PRIO_MARK.search(text) or _PRIO_WORD.search(text)
    if m:
        return int(m.group(1)), m.group(0).strip(), True

    best: tuple[int, int, int, str] | None = None   # (強さ, 位置, 優先度, 語)
    for word, prio, weight in _CUES:
        pos = text.rfind(word)
        if pos < 0:
            continue
        cand = (weight, pos, prio, word)
        if best is None or cand[:2] > best[:2]:
            best = cand
    if best is None:
        return 3, "", False
    return best[2], best[3], False


def _is_cue_only(s: str) -> bool:
    """s が手がかり語と助詞だけでできているか (手がかり語を1つは含むこと)。"""
    hit = False
    i = 0
    while i < len(s):
        word = next((w for w in _CUT_WORDS if s.startswith(w, i)), None)
        if word:
            i += len(word)
            hit = True
            continue
        join = next((w for w in _JOIN if s.startswith(w, i)), None)
        if join:
            i += len(join)
        elif s[i] in _FILLER:
            i += 1
        else:
            return False
    return hit


def _strip_cue_tail(label: str) -> str:
    """末尾の「手がかり語だけの部分」を落とす。全部そうなら空にする。"""
    for i in range(len(label)):
        if _is_cue_only(label[i:]):
            return label[:i]
    return label


def _label_of(entry: str, span: tuple[int, int] | None) -> str:
    if span is None:
        label = entry
    else:
        head = _JOSHI_TAIL.sub("", entry[:span[0]])
        tail = _JOSHI_HEAD.sub("", entry[span[1]:], count=1)
        label = f"{head} {tail}"
    label = _LABEL_DROP.sub(" ", label)
    label = re.sub(r"\s+", " ", label).strip(_LABEL_EDGE)
    label = _strip_cue_tail(label).strip(_LABEL_EDGE)
    label = _JOSHI_TAIL.sub("", label).strip(_LABEL_EDGE)
    return "" if label in _NOISE_LABEL else label


def parse_entry(entry: str) -> Entry:
    """切り出し済みの断片1つを解釈する。"""
    spans = _spans(entry)
    span = spans[0] if spans else None
    # 配置の解釈は「配置表記の塊」だけに渡す。断片まるごとを渡すと、地区が本文から
    # 混入する (「東方Project の…西R12b」で district が東になる) し、メモの中の
    # 数字を拾ってしまう。
    placements = parse_placement(entry[span[0]:span[1]]) if span else []
    priority, cue, explicit = infer_priority(entry)
    label = _label_of(entry, span)
    for p in placements:
        p.priority = priority
        if label:
            p.label = label
    return Entry(raw=entry, placements=placements, priority=priority,
                 cue=cue, label=label, explicit=explicit)


def parse_free_text(text: str) -> list[Entry]:
    """自由文まるごと → Entry のリスト。これが Web 版の入口。"""
    norm = normalize(text)
    return [parse_entry(e) for e in split_entries(norm)]
