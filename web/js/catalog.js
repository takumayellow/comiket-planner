// 行きたいリストのテキスト → 構造化された配置(Placement)。
// src/comiket_planner/catalog.py の移植。書き方の仕様はそちらと揃える。
//   西あ36a / 東H07 / 南q06 / あ36-39(範囲) / あ36,38,39(列挙)
//   行末の *1〜*5 が優先度(既定3)、記号・番号・地区を除いた残りがラベル。

const HIRA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめ';
const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨ';
const LAT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BLK = HIRA + KANA + LAT;
export const VALID_BLOCKS = new Set(BLK.split(''));

const DISTRICTS = {
  '東': '東', '西': '西', '南': '南',
  east: '東', west: '西', south: '南',
};

const PRIO_MARK = /\*\s*([1-5])(?![0-9])/;
const DIST_RE = /(東|西|南|east|west|south)/i;
const RANGE_RE = new RegExp(`([${BLK}])\\s*(\\d{1,3})\\s*[-〜~ー]\\s*(\\d{1,3})`, 'g');
const TOKEN_RE = new RegExp(`([${BLK}])?\\s*(\\d{1,3})\\s*([ab])?`, 'gi');
// ラベル側から「場所の書き方」だけを削る。行頭か区切り(空白・読点)の直後にある
// 塊しか削らない。無条件に削ると「東方Project」「西住みほ」「アイマス765プロ」の
// ように作品名の途中の記号+数字まで巻き込んで消してしまう。
// catalog.py の _STRIP_TOKENS と同一でなければならない。
const STRIP_RE = new RegExp(
  '(^|[\\s,、，・])'
  + `(?:[東西南]?\\s*(?:地区)?\\s*[${BLK}]\\s*\\d{1,3}`
  + '(?:\\s*[-〜~ー]\\s*\\d{1,3}|\\s*[ab])?'
  + '|\\d{1,3}\\s*[-〜~ー]\\s*\\d{1,3})'
  + '|[,、，・]\\s*\\d{1,3}\\s*[ab]?'
  + '|[東西南]?地区', 'gi');

/** @returns {{block:string,number:number,ab:string,district:string,priority:number,
 *             label:string,raw:string,note:string,confidence:string,tags:string[]}} */
export function placement(o) {
  return {
    block: '', number: 0, ab: '', district: '', priority: 3,
    label: '', raw: '', note: '', confidence: 'ok', tags: [], ...o,
  };
}

export function placementKey(p) {
  return `${p.block}${String(p.number).padStart(2, '0')}${p.ab}`;
}

function normalize(s) {
  let t = s.normalize('NFKC').replaceAll('地区', '');
  t = t.replace(/[（）()]/g, ' ');
  t = t.replace(/\*\s*[1-5](?![0-9])/g, ' ');
  return t;
}

/** 1行から 0..N 個の Placement を取り出す。範囲・列挙を展開する。 */
export function parsePlacement(text) {
  const raw = text.trim();
  if (!raw) return [];
  const s = normalize(raw);

  const dm = DIST_RE.exec(s);
  const district = dm ? (DISTRICTS[dm[1].toLowerCase()] ?? dm[1]) : '';

  const out = [];
  // 「あ36-39」形式: ブロック直後に範囲
  RANGE_RE.lastIndex = 0;
  for (const m of s.matchAll(RANGE_RE)) {
    const blk = m[1];
    const lo = parseInt(m[2], 10);
    const hi = parseInt(m[3], 10);
    if (!VALID_BLOCKS.has(blk) || !(lo > 0 && lo <= hi && hi <= 99)) continue;
    for (let n = lo; n <= hi; n++) {
      out.push(placement({ block: blk, number: n, district, raw }));
    }
  }
  if (out.length) return out;

  // 「あ36,38,39」/ 単発「あ36a」。カンマ列挙のときだけブロック記号を引き継ぐ。
  const seen = new Set();
  let lastBlock = '';
  TOKEN_RE.lastIndex = 0;
  for (const m of s.matchAll(TOKEN_RE)) {
    let blk = m[1];
    const num = parseInt(m[2], 10);
    const ab = (m[3] || '').toLowerCase();
    if (blk == null) {
      // ブロック無しの裸番号: 直前が区切り(, 、・)のときだけ列挙とみなす
      const before = s.slice(Math.max(0, m.index - 2), m.index);
      if (lastBlock && /[,、，・]\s*$/.test(before)) blk = lastBlock;
      else continue;
    }
    if (!VALID_BLOCKS.has(blk) || !(num > 0 && num <= 99)) continue;
    lastBlock = blk;
    const k = `${blk}|${num}|${ab}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(placement({ block: blk, number: num, ab, district, raw }));
  }
  return out;
}

function stripEdges(s) {
  return s.replace(/^[\s　,、，・]+/, '').replace(/[\s　,、，・]+$/, '');
}

/** 1行を {placements, priority, label} に分解する。 */
export function parseLine(line) {
  const placements = parsePlacement(line);
  // 配置側は normalize() 済みを見ているので、ラベル側も NFKC を通す。
  // そうしないと全角(＊２ / あ３６)が優先度にもラベル除去にも引っかからない。
  const norm = line.normalize('NFKC');
  const pm = PRIO_MARK.exec(norm);
  const priority = pm ? parseInt(pm[1], 10) : 3;
  let label = norm.replace(new RegExp(PRIO_MARK.source, 'g'), ' ');
  label = label.replace(STRIP_RE, '$1 ');
  label = stripEdges(label.replace(/\s+/g, ' '));
  for (const p of placements) {
    p.priority = priority;
    if (label) p.label = label;
  }
  return { placements, priority, label };
}

/** 複数行テキストをまとめて解析し、行ごとの結果も返す。 */
export function parseText(text) {
  const lines = [];
  for (const rawLine of text.split(/[\n;]/)) {
    if (!rawLine.trim()) continue;
    const r = parseLine(rawLine);
    lines.push({ raw: rawLine.trim(), ...r });
  }
  return lines;
}
