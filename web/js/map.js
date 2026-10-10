// 会場の概略図(SVG)を座標モデルから自前で描く。
// 公式の地図画像は使わない(再配布不可)。島=短冊 / 壁=折れ線 / 立ち寄り=番号つきの丸。
//
// スマホで読めることを最優先にしてある:
//  - ホールごとに1段ずつ縦に積む(横に並べると1メートルあたりの画素が足りず記号が潰れる)
//  - ブロック記号は「今回行くブロック」だけ大きく出す。全部出すと文字が重なって読めない
//  - 立ち寄りの丸は押して消し込める。指で狙えるよう、見た目より大きい当たり判定を重ねる

import { isFinished } from './progress.js';

// ビッグサイトは東・西・南で棟が分かれている。南を西に含めず別棟として積む。
const GROUPS = [
  { label: '東 展示棟', zones: ['east123', 'east7'] },
  { label: '西 展示棟', zones: ['west12'] },
  { label: '南 展示棟', zones: ['south12'] },
];

// 図は幅いっぱいに収めて描く(横スクロールさせない)。装飾の寸法は会場座標(m)で
// 直に指定すると小さすぎるので、u(px) 経由で「幅に対する割合」として決める。
// PXPM を小さくするほど記号・文字が会場に対して相対的に大きくなる。
// 幅300m 前後の会場を幅300〜600px に収めても番号が読める大きさになるよう調整。
const PXPM = 1.15;
const u = (px) => px / PXPM;

const PAD = u(22);
const GAP_IN = u(26);   // 同じ棟のホール間
const GAP_GRP = u(42);  // 棟と棟の間
const MR = u(11);       // 立ち寄りマーカーの半径

// ホールの描画幅の上限(会場座標 m)。東123 は 285m の細長い帯で、実寸で描くと
// 横に間延びして図全体を潰す。立ち寄り位置の相対関係は保ったまま、広すぎる棟の
// 描画幅だけここに収める(概略図なので実寸に厳密でなくてよい)。他の棟(西172/南150/
// 東7 97)はこれ以下なので素通し = 東だけが縮む。
const ZONE_W_CAP = 176;

// 図は「白い紙に水色の線」。app.css の :root と対で管理すること
// (--sky-*/--aqua-*/--ink*/--rose と同じ値を使う)。
const C = {
  paper: '#ffffff',    // 図の地。記号の縁取り(halo)にも使うので背景と必ず同色に
  zone: '#f7fcff',
  zoneEdge: '#b7d9ec',
  island: '#c3e2f2',
  islandHit: '#0f4f74',
  wall: '#8fc2dd',
  wallHit: '#0d3f5f',
  code: '#0f4f74',
  label: '#5c7c93',
  row: '#2e9fd8',
  link: '#a9c9dc',
  fin: '#9fbfd2',      // 回り終えた丸。白い番号では淡すぎるので番号は濃紺で載せる
  finText: '#0d3f5f',
  next: '#0f4f74',     // 次の1軒を囲む輪
};

export function stopColor(priority) {
  if (priority <= 2) return '#d6385c';
  if (priority === 3) return '#1a76a8';
  return '#42627a';
}

/** HTML 側で使う色クラス。app.css の .p12/.p3/.p45 と対。 */
export function priorityClass(priority) {
  if (priority <= 2) return 'p12';
  if (priority === 3) return 'p3';
  return 'p45';
}

/** GROUPS に載っていないゾーンが会場データに増えても落ちないよう、末尾に足す。 */
function bandsFor(layout) {
  const known = new Set(GROUPS.flatMap((g) => g.zones));
  const rest = Object.keys(layout.zones).filter((z) => !known.has(z));
  return rest.length ? [...GROUPS, { label: 'その他', zones: rest }] : GROUPS;
}

/**
 * @param {object} [opt]
 * @param {Map} [opt.status] groupKey → 'done'|'sold'|'skip' (回り終えた丸を淡くする)
 * @param {string|null} [opt.nextKey] 次の1軒 (輪で囲み、少し大きく描く)
 */
export function renderMap(layout, plan, { status = new Map(), nextKey = null } = {}) {
  const groups = bandsFor(layout);
  const stops = plan?.stops || [];
  const hit = new Set(stops.map((s) => s.placement.block));

  // 立ち寄りのある棟・ホールだけ描く。円がひとつも無いところを延々と描いて
  // 図を間延びさせない(はみ出す原因になる)。
  const usedZones = new Set(stops.map((s) => s.point.zone));

  const place = new Map(); // zoneId -> {x, y, z, sx, lo, hi, w}
  const bands = [];
  let maxW = 0;
  let y = PAD;
  let drawn = 0;

  for (const g of groups) {
    const zs = g.zones.filter((z) => layout.zones[z] && usedZones.has(z));
    if (!zs.length) continue;
    y += drawn > 0 ? GAP_GRP - GAP_IN : u(12); // 棟の見出しを置く余白
    const top = y;
    zs.forEach((zid, i) => {
      const z = layout.zones[zid];
      const ext = extent(z);
      const sx = Math.min(1, ZONE_W_CAP / ext.w); // 広すぎる棟だけ横に縮める
      if (i > 0) y += GAP_IN;
      place.set(zid, { x: PAD, y, z, sx, ...ext });
      maxW = Math.max(maxW, ext.w * sx);
      y += ext.hi - ext.lo;
    });
    bands.push({ label: g.label, top, bottom: y });
    y += GAP_IN;
    drawn += 1;
  }

  const totalW = PAD + maxW + PAD;
  const totalH = y - GAP_IN + PAD;
  const X = (zid, vx) => { const g = place.get(zid); return g.x + vx * g.sx; };
  const Y = (zid, vy) => {
    const g = place.get(zid);
    return g.y + (g.hi - vy);
  };

  // 立ち寄りの真の位置を出し、丸が重なるところは離す。番号の丸が被って
  // 読めない不具合の対処。多数が同じ島に集まっても解けるよう全ペアを緩和する。
  const nodes = stops.map((s) => ({
    s, x: X(s.point.zone, s.point.x), y: Y(s.point.zone, s.point.y),
    top: place.get(s.point.zone).y,
  }));
  relax(nodes);

  // 図の範囲は、離したあとのマーカー(と番号ラベル)まで含めて取り直す。
  // 会場枠の外へ押し出された丸が切れないようにする。
  let x0 = 0;
  let y0 = 0;
  let x1 = totalW;
  let y1 = totalH;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x - MR - u(5));
    x1 = Math.max(x1, n.x + MR + u(5));
    y0 = Math.min(y0, n.y - MR - u(18));
    y1 = Math.max(y1, n.y + MR + u(18));
  }
  const vw = x1 - x0;
  const vh = y1 - y0;

  const out = [];
  // viewBox が会場全体(離したマーカー込み)を包む。svg は幅100%で高さは縦横比なり。
  // これで横スクロールは発生せず、枠(ホールの外周)も必ず端まで表示される。
  out.push('<svg xmlns="http://www.w3.org/2000/svg" '
    + `viewBox="${r(x0)} ${r(y0)} ${r(vw)} ${r(vh)}" `
    + 'width="100%" preserveAspectRatio="xMidYMin meet" '
    + 'role="group" aria-label="会場の概略図と巡回順">');
  out.push(`<rect x="${r(x0)}" y="${r(y0)}" width="${r(vw)}" height="${r(vh)}" fill="${C.paper}"/>`);

  for (const b of bands) {
    out.push(`<rect x="${r(PAD - u(14))}" y="${r(b.top - u(18))}" width="${r(u(3.4))}" `
      + `height="${r(b.bottom - b.top + u(18))}" fill="${C.row}"/>`);
    out.push(`<text x="${r(PAD - u(7))}" y="${r(b.top - u(9))}" fill="${C.row}" `
      + `font-size="${r(u(13))}" font-weight="700" letter-spacing="${r(u(1.4))}">`
      + `${esc(b.label)}</text>`);
  }

  for (const [zid, g] of place) {
    const zw = g.w * g.sx;
    out.push(`<rect x="${r(g.x - u(6))}" y="${r(g.y - u(6))}" width="${r(zw + u(12))}" `
      + `height="${r(g.hi - g.lo + u(12))}" fill="${C.zone}" stroke="${C.zoneEdge}" `
      + `stroke-width="${r(u(1))}"/>`);
    out.push(`<text x="${r(g.x + zw - u(1))}" y="${r(g.y - u(9))}" `
      + `fill="${C.label}" font-size="${r(u(11))}" text-anchor="end">${esc(g.z.label)}</text>`);

    for (const b of g.z.blocks) {
      const on = hit.has(b.code);
      if (b.kind === 'island') {
        const x = X(zid, b.x);
        const hw = on ? u(3.2) : u(2.2);
        out.push(`<rect x="${r(x - hw)}" y="${r(Y(zid, b.y1))}" `
          + `width="${r(hw * 2)}" height="${r(b.y1 - b.y0)}" `
          + `fill="${on ? C.islandHit : C.island}"/>`);
      } else {
        const pts = b.path.map(([px, py]) => `${r(X(zid, px))},${r(Y(zid, py))}`).join(' ');
        out.push(`<polyline points="${pts}" fill="none" `
          + `stroke="${on ? C.wallHit : C.wall}" stroke-width="${r(on ? u(3.4) : u(2.2))}"/>`);
      }
    }
  }

  // 巡回の道すじ (同ホール内は実線、ホールをまたぐところは点線)
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    const same = a.s.point.zone === b.s.point.zone;
    out.push(`<line x1="${r(a.x)}" y1="${r(a.y)}" x2="${r(b.x)}" y2="${r(b.y)}" `
      + `stroke="${C.link}" stroke-width="${r(same ? u(1.6) : u(2))}"`
      + `${same ? '' : ` stroke-dasharray="${r(u(6))} ${r(u(4))}"`}/>`);
  }

  // 立ち寄り: 番号の丸 + ブロック記号 (記号を主役にする)。丸ごとに押せる g で包む。
  // 当たり判定は隣の丸と重なるので、どれを押したかは画面側で中心が一番近い丸に決める
  // (後から描いた丸の当たり判定が、先の丸の見えている部分を奪わないように)
  nodes.forEach((n, i) => {
    const p = n.s.placement;
    const k = p.groupKey;
    const fin = isFinished(status.get(k));
    const next = k === nextKey;
    const rr = next ? MR * 1.25 : MR;
    const up = n.y > n.top + u(4);
    const ty = up ? n.y - rr - u(4) : n.y + rr + u(13);
    const hall = layout.hallOf(p.block, p.number) || p.district || '';
    out.push(`<g class="mk${fin ? ' fin' : ''}${next ? ' next' : ''}" data-k="${esc(k)}" `
      + `data-x="${r(n.x)}" data-y="${r(n.y)}" role="checkbox" tabindex="0" aria-checked="${fin}" `
      + `aria-label="${i + 1}軒目 ${esc(hall)} ${esc(p.block)}${p.number}">`);
    out.push(`<circle class="mk__hit" cx="${r(n.x)}" cy="${r(n.y)}" r="${r(MR * 1.9)}" fill="transparent"/>`);
    out.push(`<circle class="mk__focus" cx="${r(n.x)}" cy="${r(n.y)}" r="${r(rr + u(7))}" `
      + `fill="none" stroke-width="${r(u(3))}"/>`);
    out.push(`<text x="${r(n.x)}" y="${r(ty)}" fill="${C.code}" font-size="${r(u(15))}" `
      + `font-weight="700" text-anchor="middle" stroke="${C.paper}" stroke-width="${r(u(3))}" `
      + `paint-order="stroke" aria-hidden="true">${esc(p.block)}</text>`);
    if (next) {
      out.push(`<circle cx="${r(n.x)}" cy="${r(n.y)}" r="${r(rr + u(3.5))}" fill="none" `
        + `stroke="${C.next}" stroke-width="${r(u(2.4))}"/>`);
    }
    out.push(`<circle cx="${r(n.x)}" cy="${r(n.y)}" r="${r(rr)}" `
      + `fill="${fin ? C.fin : stopColor(p.priority)}"`
      + `${n.s.wall ? ` stroke="${C.wallHit}" stroke-width="${r(u(2))}"` : ''}/>`);
    out.push(`<text x="${r(n.x)}" y="${r(n.y + u(4))}" fill="${fin ? C.finText : '#ffffff'}" `
      + `font-size="${r(u(12))}" font-weight="700" text-anchor="middle" aria-hidden="true">${i + 1}</text>`);
    out.push('</g>');
  });

  out.push('</svg>');
  return out.join('');
}

// 立ち寄りマーカーの重なりを解く簡易レイアウト。全ペアを繰り返し押し離し、
// 完全一致は黄金角で決定的にほどく (乱数を使わず、同じ入力で同じ図になる)。
// 同じ島に多数の立ち寄りが集まっても、丸が必ず離れるまで緩和する。
function relax(nodes) {
  const minD = MR * 2 + u(2.5);
  const GA = 2.399963229; // 黄金角(rad)
  for (let iter = 0; iter < 240; iter++) {
    let worst = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-3) { dx = Math.cos(i * GA); dy = Math.sin(i * GA); d = 1; }
        const push = (minD - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        nodes[i].x -= ux * push;
        nodes[i].y -= uy * push;
        nodes[j].x += ux * push;
        nodes[j].y += uy * push;
        if (minD - d > worst) worst = minD - d;
      }
    }
    if (worst < 0.02) break;
  }
}

/** ホール枠の実寸。壁の折れ線はゾーンの公称 width/depth をはみ出すことがある。 */
function extent(z) {
  let lo = 0;
  let hi = z.depth;
  let w = z.width;
  for (const b of z.blocks) {
    if (b.kind === 'island') {
      lo = Math.min(lo, b.y0);
      hi = Math.max(hi, b.y1);
      w = Math.max(w, b.x);
    } else {
      for (const [px, py] of b.path) {
        lo = Math.min(lo, py);
        hi = Math.max(hi, py);
        w = Math.max(w, px);
      }
    }
  }
  return { lo, hi, w };
}

function r(v) {
  return Math.round(v * 10) / 10;
}

// stopinfo.js の esc と同じ。stopinfo.js が本ファイルを読むので、循環させないよう持ち回す
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
