// 自由文 (音声メモの書き起こし / 走り書き / 長文の貼り付け) を1件ずつに切り分け、
// 優先度を文面から推定する。src/comiket_planner/freeform.py の移植。
//
// catalog.js は「1行1件・優先度は *3」という整った書式を前提にしている。実際の入力は
// そうならない — 喋ったものを書き起こすと改行は入らないし、優先度を数字で言う人はいない
// ("絶対欲しい" "余裕があれば" と言う)。その落差をここで吸収する。

import { parsePlacement } from './catalog.js';

const BLK = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめ'
  + 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨ'
  + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// 「西地区 あ36a」「東H07」「せ9-15」「q06,10,16」を1つの塊として位置だけ拾う。
// 妥当性(番号の範囲など)は catalog.parsePlacement に判定させるので、ここは緩くてよい。
const SPAN = new RegExp(
  `(?:[東西南]\\s*(?:地区)?\\s*(?:の)?\\s*)?[${BLK}]\\s*\\d{1,3}`
  + '(?:\\s*[-〜~ー]\\s*\\d{1,3})?(?:\\s*[ab])?'
  + '(?:\\s*[,、，・]\\s*\\d{1,3}(?:\\s*[-〜~ー]\\s*\\d{1,3})?\\s*[ab]?)*', 'gi');

// 件と件の切れ目になりうるもの。話し言葉の接続詞まで見るのは、書き起こしに句読点が
// ほとんど入らないため (「〜欲しいあと西の〜」で切れないと1件に潰れる)。
const BREAK = /[\n\r。．！!？?；;]|[、,，・/｜|]|あとは|あと|それから|そのあと|そのご|つぎに|次に|さらに|加えて|あわせて|それと/g;

const LEAD = /^(?:[\s　\n\r。．！!？?；;、,，・/｜|]+|(?:あとは|あと|それから|そのあと|そのご|つぎに|次に|さらに|加えて|あわせて|それと))+/;
const TRAIL = /[\s　\n\r。．；;、,，・/｜|]+$/;

const PRIO_MARK = /\*\s*([1-5])(?![0-9])/;
const PRIO_WORD = /優先(?:度)?\s*[:：]?\s*([1-5])(?![0-9])/;

// 文面 → 優先度。[語, 優先度, 強さ]。強さが大きいものを優先し、同点なら後に出た方
// (日本語は文末の言い方で決まる)。「絶対欲しい」は 絶対(4) > 欲しい(2) で優先1、
// 「余裕があれば欲しい」は 余裕があれば(5) > 欲しい(2) で優先4、と解ける。
const CUES = [
  ['何が何でも', 1, 5], ['死んでも', 1, 5], ['最優先', 1, 5], ['落とせない', 1, 5],
  ['命がけ', 1, 5], ['一番欲しい', 1, 5], ['本命', 1, 4], ['必須', 1, 4],
  ['絶対', 1, 4], ['ぜったい', 1, 4], ['マスト', 1, 4], ['必ず', 1, 4],
  ['確実に', 1, 4], ['真っ先', 1, 4], ['開幕', 1, 3],

  ['優先', 2, 3], ['早めに', 2, 3], ['早めが', 2, 3], ['なるべく', 2, 3],
  ['できるだけ', 2, 3], ['出来るだけ', 2, 3], ['押さえたい', 2, 3], ['確保', 2, 3],
  ['大事', 2, 3], ['欲しい', 2, 2], ['ほしい', 2, 2], ['買いたい', 2, 2],
  ['推し', 2, 2],

  ['余裕があれば', 4, 5], ['余裕あれば', 4, 5], ['余裕があったら', 4, 5],
  ['時間があれば', 4, 5], ['時間があったら', 4, 5], ['できれば', 4, 4],
  ['出来れば', 4, 4], ['できたら', 4, 4], ['可能なら', 4, 4], ['行けたら', 4, 4],
  ['寄れたら', 4, 4], ['回れたら', 4, 4], ['あわよくば', 4, 4],

  ['買えなくてもいい', 5, 5], ['なくてもいい', 5, 5], ['無くてもいい', 5, 5],
  ['気が向いたら', 5, 5], ['冷やかし', 5, 5], ['ついで', 5, 5], ['暇なら', 5, 5],
  ['暇だったら', 5, 5], ['最悪いい', 5, 4], ['余ったら', 5, 4], ['見れたら', 5, 4],
  ['見られたら', 5, 4], ['おまけ', 5, 4], ['後回し', 5, 4],
];

// ラベルに残っても名前の役に立たないもの。優先度の指定と、配置の前に書かれがちな
// ホール名 (「東5 ア86-88」の「東5」) を落とす。
const LABEL_DROP = /\*\s*[1-5](?![0-9])|優先(?:度)?\s*[:：]?\s*[1-5](?![0-9])|地区|[東西南]\s*\d{1,3}(?:\s*[・,、]\s*\d{1,3})*(?:\s*ホール)?/g;
const LABEL_EDGE = ' 　\t,、，.。・:：;；/|｜!！?？「」『』"\'';
// 配置を抜いた跡に残る助詞。「あ36の○○」→「○○」。落とすのは配置に「くっついて
// いる」1文字だけ。間に空白があるものは助詞ではなく本文の頭 (「東H07 のんのん
// びより」の「の」) なので触らない。
const JOSHI_HEAD = /^[のはがをにへともでや]/;
const JOSHI_TAIL = /[のはがをにへともでや]$/;

// 優先度の言い回しはサークル名ではない。「ついででいいや」をサークル名として巡回順に
// 出しても当日の役に立たないので、末尾が手がかり語と助詞だけでできている範囲を切り
// 落とす。途中では切らない — 名前そのものに手がかり語が入ることがある
// (「推しの子」の「推し」を抜くと別物になる)。
const MODAL = [
  '欲しい', 'ほしい', '買いたい', '買う', '行きたい', '行く', '見たい', '見る',
  '回りたい', '回る', '寄りたい', '寄る', '取りたい', '取る', 'したい', 'する',
  'いいや', 'いい', '大丈夫', 'あるはず', 'ある', 'いる', 'はず', 'らしい',
  'みたい', 'かも', '思う', '予定', 'チェック',
];
// 手がかり語同士をつなぐ言い方。これ自体は手がかりではないので hit にしない
// (「絶対欲しいけどできれば」の「けど」を跨げないと、前半が名前として残る)。
const JOIN = ['けれども', 'けれど', 'けど', 'ので', 'のに', 'から',
  'って', 'ても', 'でも', 'そして', 'あと'];
const CUT_WORDS = [...new Set([...CUES.map(([w]) => w), ...MODAL])]
  .sort((a, b) => b.length - a.length);
// 手がかり語の間に挟まってよい文字 (助詞・活用の尻尾・区切り)。
const FILLER = new Set(' 　\t,、，・/|｜!！?？。．のはがをにへともでやかなねよっただしまん');
// 切り落とした後に残っても名前として意味を成さない語。
const NOISE_LABEL = new Set(['あたり', 'へん', 'とか', 'など', 'こと', 'もの', 'やつ',
  'ところ', 'ほう', 'サークル']);

/** 全角英数などをそろえる。以降の位置(index)はこの文字列基準で扱う。 */
export function normalize(text) {
  return text.normalize('NFKC');
}

function spansOf(text) {
  const out = [];
  SPAN.lastIndex = 0;
  for (const m of text.matchAll(SPAN)) {
    if (parsePlacement(m[0]).length) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// 件の切れ目を決めるための塊。読めた配置に加えて「地区付きなのに読めなかった塊」も
// 入れる。番号が範囲外の書き間違い (西す230) を隣の件に吸収させると、その件が黙って
// 消えたうえ隣に誤ったラベルが付く。独立した件として立てれば読み取り結果に出る。
function cutSpansOf(text) {
  const out = [];
  SPAN.lastIndex = 0;
  for (const m of text.matchAll(SPAN)) {
    if (parsePlacement(m[0]).length || '東西南'.includes(m[0][0])) {
      out.push([m.index, m.index + m[0].length]);
    }
  }
  return out;
}

function trimEdges(s) {
  let prev = null;
  let t = s;
  while (prev !== t) {
    prev = t;
    t = t.replace(LEAD, '').replace(TRAIL, '');
  }
  return t;
}

/**
 * 自由文を1件ずつの断片に切る。改行があってもなくても同じ結果に落とす。
 * 切れ目は「次の配置表記の直前にある最後の区切り」。区切りが無ければ配置の直前。
 */
export function splitEntries(text) {
  const spans = cutSpansOf(text);

  const cuts = new Set([0, text.length]);
  for (let i = 1; i < spans.length; i++) {
    const lo = spans[i - 1][1];
    const hi = spans[i][0];
    const gap = text.slice(lo, hi);
    let last = null;
    BREAK.lastIndex = 0;
    for (const bm of gap.matchAll(BREAK)) last = bm;
    cuts.add(last ? lo + last.index : hi);
  }
  // 改行はユーザーが自分で入れた区切り。配置の有無に関わらずここで必ず切る
  // (切らないと、配置の書いていない行が前の件のメモとして吸収されて消える)。
  for (const m of text.matchAll(/[\n\r]/g)) {
    if (!spans.some(([lo, hi]) => lo < m.index && m.index < hi)) cuts.add(m.index);
  }

  const ordered = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const s = trimEdges(text.slice(ordered[i], ordered[i + 1]));
    if (s) out.push(s);
  }
  return out;
}

/** @returns {{priority:number, cue:string, explicit:boolean}} */
export function inferPriority(text) {
  const m = PRIO_MARK.exec(text) || PRIO_WORD.exec(text);
  if (m) return { priority: parseInt(m[1], 10), cue: m[0].trim(), explicit: true };

  let best = null;   // [強さ, 位置, 優先度, 語]
  for (const [word, prio, weight] of CUES) {
    const pos = text.lastIndexOf(word);
    if (pos < 0) continue;
    if (!best || weight > best[0] || (weight === best[0] && pos > best[1])) {
      best = [weight, pos, prio, word];
    }
  }
  if (!best) return { priority: 3, cue: '', explicit: false };
  return { priority: best[2], cue: best[3], explicit: false };
}

function stripSet(s, chars) {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

/** s が手がかり語と助詞だけでできているか (手がかり語を1つは含むこと)。 */
function isCueOnly(s) {
  let hit = false;
  let i = 0;
  while (i < s.length) {
    const word = CUT_WORDS.find((w) => s.startsWith(w, i));
    if (word) {
      i += word.length;
      hit = true;
      continue;
    }
    const join = JOIN.find((w) => s.startsWith(w, i));
    if (join) {
      i += join.length;
    } else if (FILLER.has(s[i])) {
      i += 1;
    } else {
      return false;
    }
  }
  return hit;
}

/** 末尾の「手がかり語だけの部分」を落とす。全部そうなら空にする。 */
function stripCueTail(label) {
  for (let i = 0; i < label.length; i++) {
    if (isCueOnly(label.slice(i))) return label.slice(0, i);
  }
  return label;
}

function labelOf(entry, span) {
  let label;
  if (!span) {
    label = entry;
  } else {
    const head = entry.slice(0, span[0]).replace(JOSHI_TAIL, '');
    const tail = entry.slice(span[1]).replace(JOSHI_HEAD, '');
    label = `${head} ${tail}`;
  }
  label = label.replace(LABEL_DROP, ' ').replace(/\s+/g, ' ');
  label = stripSet(label, LABEL_EDGE);
  label = stripSet(stripCueTail(label), LABEL_EDGE);
  label = stripSet(label.replace(JOSHI_TAIL, ''), LABEL_EDGE);
  return NOISE_LABEL.has(label) ? '' : label;
}

/** 切り出し済みの断片1つを解釈する。 */
export function parseEntry(entry) {
  const spans = spansOf(entry);
  const span = spans.length ? spans[0] : null;
  // 配置の解釈は「配置表記の塊」だけに渡す。断片まるごとを渡すと、地区が本文から
  // 混入する (「東方Project の…西R12b」で district が東になる) し、メモの中の
  // 数字を拾ってしまう。
  const placements = span ? parsePlacement(entry.slice(span[0], span[1])) : [];
  const { priority, cue, explicit } = inferPriority(entry);
  const label = labelOf(entry, span);
  for (const p of placements) {
    p.priority = priority;
    if (label) p.label = label;
  }
  return { raw: entry, placements, priority, cue, label, explicit };
}

/** 自由文まるごと → エントリのリスト。これが Web 版の入口。 */
export function parseFreeText(text) {
  return splitEntries(normalize(text)).map(parseEntry);
}
