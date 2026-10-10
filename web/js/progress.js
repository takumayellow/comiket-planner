// 当日の進み具合。巡回順(plan.stops)に「買えた / 売り切れ / あとで回る」を重ねて、
// 次に行く1軒と、予定に対する遅れを出す。画面にも保存にも触れない純粋な計算だけを置く
// (Node から単体で検証できるようにするため)。

/** 立ち寄りごとの結果。'done' と 'sold' は回り終えた扱い、'skip' は後回し。 */
export const STATUS = Object.freeze({ DONE: 'done', SOLD: 'sold', SKIP: 'skip' });
const KNOWN = new Set(Object.values(STATUS));

export function isFinished(st) {
  return st === STATUS.DONE || st === STATUS.SOLD;
}

/**
 * 保存されていた値を読み直す。旧版は消し込みを `done` の配列で持っていたので、
 * それも「買えた」として引き継ぐ。知らない値は捨てる (手で壊された localStorage 対策)。
 */
export function restoreStatus(rawStatus, rawDone) {
  const out = new Map();
  if (Array.isArray(rawDone)) {
    for (const k of rawDone) if (typeof k === 'string') out.set(k, STATUS.DONE);
  }
  // 保存は [キー, 状態] の配列 (記録した順を残すため)。オブジェクトでも読める
  const pairs = Array.isArray(rawStatus) ? rawStatus
    : rawStatus && typeof rawStatus === 'object' ? Object.entries(rawStatus) : [];
  for (const pair of pairs) {
    if (!Array.isArray(pair)) continue;
    const [k, v] = pair;
    if (typeof k !== 'string' || !KNOWN.has(v)) continue;
    out.delete(k);   // 旧 done から入れた分より、記録した順を優先する
    out.set(k, v);
  }
  return out;
}

/**
 * 状態を1件だけ変えた新しい Map を返す。st が null なら未着手に戻す。
 * いったん消してから入れ直すので、Map の並びは「最後に記録した順」になる
 * (あとで回るを押した順に後ろへ並べるのに使う)。
 */
export function withStatus(status, key, st) {
  const next = new Map(status);
  next.delete(key);
  if (st) next.set(key, st);
  return next;
}

/**
 * 巡回の消し込み。回り終えたものは未着手へ、それ以外 (未着手・あとで) は「買えた」へ。
 */
export function toggledStatus(status, key) {
  return withStatus(status, key, isFinished(status.get(key)) ? null : STATUS.DONE);
}

/**
 * これから回る順。未着手を巡回順のまま先に並べ、「あとで回る」にしたものは
 * 押した順に最後へ回す。残りが後回しだけのときにもう一度押すと、その1軒が
 * 列の最後へ移る。
 * @returns {Array<{stop:object,index:number,status:string|undefined}>}
 */
export function pendingQueue(stops, status, keyOf) {
  const fresh = [];
  const later = new Map();
  stops.forEach((stop, index) => {
    const k = keyOf(stop);
    const st = status.get(k);
    if (isFinished(st)) return;
    if (st === STATUS.SKIP) later.set(k, { stop, index, status: st });
    else fresh.push({ stop, index, status: st });
  });
  const skipped = [...status.keys()].filter((k) => later.has(k)).map((k) => later.get(k));
  return fresh.concat(skipped);
}

export function countBy(stops, status, keyOf) {
  let done = 0;
  let sold = 0;
  for (const s of stops) {
    const st = status.get(keyOf(s));
    if (st === STATUS.DONE) done += 1;
    else if (st === STATUS.SOLD) sold += 1;
  }
  return { done, sold, finished: done + sold, total: stops.length };
}

/**
 * 予定に対する遅れ (分)。正なら遅れ、負なら早い。
 * 比べる相手は「次の1軒の予定到着」。あとで回る分は予定時刻が先頭の頃のまま
 * なので比べても意味が無く、残りが後回しだけのときは null を返す。
 */
export function delayMin(nowMin, next) {
  if (!next || next.status === STATUS.SKIP) return null;
  return Math.round(nowMin - next.stop.arrivalMin);
}

/** 遅れの見出し。±2分は誤差として「予定どおり」に丸める。 */
export function paceOf(delay) {
  if (delay == null) return null;
  if (delay > 2) return { late: true, label: `予定より${delay}分遅れ` };
  if (delay < -2) return { late: false, label: `予定より${-delay}分早い` };
  return { late: false, label: '予定どおり' };
}

/**
 * いま「当日」として時計を見てよいか。会場の開催日で、かつ回りはじめの少し前から
 * 閉会の少し後までだけ遅れを出す。家で下見しているときに「300分遅れ」と出さないため。
 * @param {Date} now
 * @param {string[]} dates 'YYYY-MM-DD' の配列 (会場データの dates)
 */
export function eventDayIndex(now, dates) {
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    + `-${String(now.getDate()).padStart(2, '0')}`;
  return (dates || []).indexOf(ymd);
}

export function isLiveWindow(nowMin, startMin, closeMin) {
  return nowMin >= startMin - 60 && nowMin <= closeMin + 30;
}
