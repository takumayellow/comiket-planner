// 巡回順の最適化 (時間依存の報酬つき巡回 / prize-collecting TSP)。
// src/comiket_planner/router.py の移植。定数・手順を Python 版と一致させてある。
//   重み付き貪欲構築 → 2-opt → or-opt → 予算超過なら報酬密度の低い順に落とす。

// 優先度(1..5) → 基本の緊急度(売り切れ前に着きたい強さ) 0..1
const PRIORITY_URGENCY = { 1: 0.95, 2: 0.80, 3: 0.55, 4: 0.35, 5: 0.20 };

// --- 現実的な滞在時間モデル(分) --------------------------------------------
// 立ち寄りは常に「島単位」で数える(その島に着いたら番号帯を歩いて拾う)。滞在時間は
// そこで拾う各サークルを1件ずつ手に取って見て買う時間の合計。指定サークルは1つずつ
// 手に取って動く前提。島には列はできない(並ぶ時間はゼロ)が、2,3冊を軽く試し読みして
// 手に取り会計する時間は要る(1冊10秒×2,3冊 ≈ 0.5分 + 手に取り/会計 ≈ 0.5分)。列が
// 要るのは壁だけ。表示のまとめ/展開では所要時間は変わらない。
export const BASE_BROWSE = 1.0;          // 1サークル(島): 軽い試し読み+手に取り会計
export const WALL_QUEUE = 4.0;           // 壁の基本の列(全部瞬殺ではない)
// 壁のみに足す列。人気ぶり(優先度)を列の長さの代理にする。島には適用しない。
const WALL_LINE = { 1: 10.0, 2: 6.0, 3: 3.0, 4: 1.0, 5: 0.0 };
const CROWD_WALK_FACTOR = 1.25;          // 通路混雑で歩行が公称より少し延びる
const SELLOUT_HALFLIFE_MIN = 90;         // 緊急度1.0が半分の価値になるまで(分)

/** Python の round() と同じ挙動 (偶数丸め)。時刻表示を Python 版と一致させる。 */
export function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function hhmmToMin(s) {
  const [h, m] = s.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

export function minToHhmm(x) {
  const v = pyRound(x);
  const h = ((Math.floor(v / 60) % 24) + 24) % 24;
  const m = ((v % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 島で拾う各スペースの優先度リスト。group.js が mp:2.2.3 の形で付ける。
// タグが無い(CLI 等でスペース単位のまま渡す)ときは、その1件だけ。
function members(p) {
  for (const t of p.tags) {
    if (t.startsWith('mp:')) {
      const out = [];
      for (const part of t.slice(3).split('.')) {
        const n = parseInt(part, 10);
        if (!Number.isNaN(n)) out.push(n);
      }
      if (out.length) return out;
    }
  }
  return [p.priority];
}

function urgency(p, layout) {
  let u = PRIORITY_URGENCY[p.priority] ?? 0.55;
  if (layout.isWall(p.block)) u = Math.min(1.0, u + 0.20); // 壁は完売が早い
  if (p.tags.includes('人気') || p.tags.includes('壁')) u = Math.min(1.0, u + 0.10);
  return u;
}

export function dwell(p, layout) {
  // 滞在 = そこで拾う各サークルの手に取り+軽い試し読み(BASE_BROWSE)の総和。
  //   島: それだけ(列は無い)。
  //   壁: そのブロックでは1回だけ並ぶ(スペースごとに並び直さない)。基本の列
  //       WALL_QUEUE に、最も人気なサークルぶんの列(WALL_LINE の最大)を1つ足す。
  // まとめ/展開の表示切替では中身が変わらないので、所要時間もぶれない。
  const mps = members(p);
  const base = BASE_BROWSE * mps.length;
  if (!layout.isWall(p.block)) return base;
  const line = Math.max(...mps.map((mp) => WALL_LINE[mp] ?? 3.0));
  return base + WALL_QUEUE + line;
}

function walk(layout, a, b) {
  return layout.walkMinutes(a, b) * CROWD_WALK_FACTOR;
}

/** 到着時刻での期待価値 0..1。緊急度が高いほど時間減衰が急。 */
function selloutValue(u, arrivalMin, startMin) {
  const elapsed = Math.max(0, arrivalMin - startMin);
  const halflife = SELLOUT_HALFLIFE_MIN / Math.max(0.15, u);
  return 0.5 ** (elapsed / halflife);
}

function resolve(placements, layout) {
  const nodes = [];
  const unlocatable = [];
  for (const p of placements) {
    const pt = layout.locate(p.block, p.number);
    if (!pt) unlocatable.push(p);
    else nodes.push({ p, pt, u: urgency(p, layout), d: dwell(p, layout) });
  }
  return { nodes, unlocatable };
}

function pickStartZone(nodes, override) {
  if (override) return override;
  // 緊急度の総和が最大のゾーンから始める
  const score = new Map();
  for (const n of nodes) score.set(n.pt.zone, (score.get(n.pt.zone) || 0) + n.u);
  let best = 'east123';
  let bestv = -Infinity;
  for (const [z, v] of score) if (v > bestv) { best = z; bestv = v; }
  return best;
}

/** 順序の評価値。小さいほど良い。移動時間 + 緊急度重み付き到着遅れペナルティ。 */
function objective(order, layout, startPt, startMin) {
  let t = startMin;
  let prev = startPt;
  let cost = 0;
  for (const { pt, u, d } of order) {
    const w = walk(layout, prev, pt);
    t += w;
    cost += w + (1.0 - selloutValue(u, t, startMin)) * u * 30.0;
    t += d;
    prev = pt;
  }
  return { cost, end: t };
}

function greedy(nodes, layout, startPt, startMin) {
  const remaining = nodes.slice();
  const order = [];
  let t = startMin;
  let prev = startPt;
  while (remaining.length) {
    let bi = 0;
    let bs = null;
    for (let i = 0; i < remaining.length; i++) {
      const { pt, u } = remaining[i];
      const w = walk(layout, prev, pt);
      const s = w - u * 60.0 * selloutValue(u, t + w, startMin);
      if (bs === null || s < bs) { bi = i; bs = s; }
    }
    const best = remaining.splice(bi, 1)[0];
    order.push(best);
    t += walk(layout, prev, best.pt) + best.d;
    prev = best.pt;
  }
  return order;
}

function twoOpt(order, layout, startPt, startMin, rounds = 40) {
  let best = order;
  let bestCost = objective(best, layout, startPt, startMin).cost;
  const n = order.length;
  let improved = true;
  let it = 0;
  while (improved && it < rounds) {
    improved = false;
    it += 1;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = best.slice(0, i)
          .concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const c = objective(cand, layout, startPt, startMin).cost;
        if (c + 1e-9 < bestCost) { best = cand; bestCost = c; improved = true; }
      }
    }
  }
  return best;
}

/** 1〜3連続の立ち寄りを別位置へ移す (or-opt)。2-opt では消せない棟の往復を解消する。 */
function orOpt(order, layout, startPt, startMin, rounds = 25) {
  let best = order;
  let bestCost = objective(best, layout, startPt, startMin).cost;
  const n = best.length;
  let improved = true;
  let it = 0;
  while (improved && it < rounds) {
    improved = false;
    it += 1;
    outer:
    for (const seg of [1, 2, 3]) {
      for (let i = 0; i + seg <= n; i++) {
        const chunk = best.slice(i, i + seg);
        const rest = best.slice(0, i).concat(best.slice(i + seg));
        for (let j = 0; j <= rest.length; j++) {
          if (j === i) continue;
          const cand = rest.slice(0, j).concat(chunk, rest.slice(j));
          const c = objective(cand, layout, startPt, startMin).cost;
          if (c + 1e-9 < bestCost) {
            best = cand; bestCost = c; improved = true;
            break outer;
          }
        }
      }
    }
  }
  return best;
}

/**
 * @param {Array} placements Placement の配列
 * @param {Layout} layout
 * @param {{startZone?:string|null,startTime?:string,timeBudgetMin?:number|null}} opt
 */
export function planRoute(placements, layout, opt = {}) {
  const startTime = opt.startTime || '10:30';
  const startMin = hhmmToMin(startTime);
  const { nodes, unlocatable } = resolve(placements, layout);
  if (!nodes.length) {
    return {
      stops: [], dropped: [], unlocatable,
      startZone: opt.startZone || '', startMin, totalMin: 0,
    };
  }

  const zone = pickStartZone(nodes, opt.startZone);
  const startPt = layout.entrancePoint(zone);

  let order = greedy(nodes, layout, startPt, startMin);
  order = twoOpt(order, layout, startPt, startMin);
  order = orOpt(order, layout, startPt, startMin);
  order = twoOpt(order, layout, startPt, startMin);

  // 予算超過なら報酬密度の低いものから外す (prize-collecting)
  const dropped = [];
  const budget = opt.timeBudgetMin;
  if (budget != null) {
    while (order.length > 1) {
      if (objective(order, layout, startPt, startMin).end - startMin <= budget) break;
      // 報酬密度 = 緊急度*優先度 / 立ち寄りコスト が最小のものを落とす
      let wi = 0;
      let wv = null;
      for (let i = 0; i < order.length; i++) {
        const { p, u, d } = order[i];
        const dens = (u * (6 - p.priority)) / (d + 1.0);
        if (wv === null || dens < wv) { wi = i; wv = dens; }
      }
      dropped.push(order[wi].p);
      order = order.slice(0, wi).concat(order.slice(wi + 1));
      order = twoOpt(order, layout, startPt, startMin, 15);
    }
  }

  // 最終磨き込み: 棟往復の無駄(東→南のような戻り)を or-opt で除去
  order = orOpt(order, layout, startPt, startMin);
  order = twoOpt(order, layout, startPt, startMin, 15);

  // 時刻を確定
  const stops = [];
  let t = startMin;
  let prev = startPt;
  for (const { p, pt, u, d } of order) {
    const w = walk(layout, prev, pt);
    const arr = t + w;
    stops.push({
      placement: p,
      point: pt,
      arrivalMin: pyRound(arr),
      departMin: pyRound(arr + d),
      arrival: minToHhmm(arr),
      walkFromPrev: w,
      dwellMin: d,
      urgency: u,
    });
    t = arr + d;
    prev = pt;
  }

  return {
    stops, dropped, unlocatable, startZone: zone, startMin, totalMin: t - startMin,
  };
}
