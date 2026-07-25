// 会場の概略図(SVG)を座標モデルから自前で描く。
// 公式の地図画像は使わない(再配布不可)。島=短冊 / 壁=折れ線 / 立ち寄り=番号つきの丸。
//
// スマホで読めることを最優先にしてある:
//  - ホールごとに1段ずつ縦に積む(横に並べると1メートルあたりの画素が足りず記号が潰れる)
//  - ブロック記号は「今回行くブロック」だけ大きく出す。全部出すと文字が重なって読めない

// ビッグサイトは東・西・南で棟が分かれている。南を西に含めず別棟として積む。
const GROUPS = [
  { label: '東 展示棟', zones: ['east123', 'east7'] },
  { label: '西 展示棟', zones: ['west12'] },
  { label: '南 展示棟', zones: ['south12'] },
];

// 会場1mあたりの表示px。大きめに取り、画面に収まらない分は横スクロールで見せる
// (幅に合わせて縮めると記号が潰れて読めない)。装飾の寸法は u(px) で指定して、
// この倍率を変えても記号の見た目の大きさが変わらないようにする。
const PXPM = 2.7;
const u = (px) => px / PXPM;

const PAD = u(22);
const GAP_IN = u(26);   // 同じ棟のホール間
const GAP_GRP = u(42);  // 棟と棟の間
const MR = u(11);       // 立ち寄りマーカーの半径

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

export function renderMap(layout, plan) {
  const groups = bandsFor(layout);
  const stops = plan?.stops || [];
  const hit = new Set(stops.map((s) => s.placement.block));

  const place = new Map(); // zoneId -> {x, y, z, lo, hi, w}
  const bands = [];
  let maxW = 0;
  let y = PAD;

  groups.forEach((g, gi) => {
    const zs = g.zones.filter((z) => layout.zones[z]);
    if (!zs.length) return;
    y += gi > 0 ? GAP_GRP - GAP_IN : u(12); // 棟の見出しを置く余白
    const top = y;
    zs.forEach((zid, i) => {
      const z = layout.zones[zid];
      const ext = extent(z);
      if (i > 0) y += GAP_IN;
      place.set(zid, { x: PAD, y, z, ...ext });
      maxW = Math.max(maxW, ext.w);
      y += ext.hi - ext.lo;
    });
    bands.push({ label: g.label, top, bottom: y });
    y += GAP_IN;
  });

  const totalW = PAD + maxW + PAD;
  const totalH = y - GAP_IN + PAD;
  const X = (zid, vx) => place.get(zid).x + vx;
  const Y = (zid, vy) => {
    const g = place.get(zid);
    return g.y + (g.hi - vy);
  };

  const out = [];
  // viewBox は会場座標(m)、width/height は実px。縮小せず実寸で描き、
  // はみ出す分は .mapwrap の横スクロールに任せる。
  out.push('<svg xmlns="http://www.w3.org/2000/svg" '
    + `width="${r(totalW * PXPM)}" height="${r(totalH * PXPM)}" `
    + `viewBox="0 0 ${r(totalW)} ${r(totalH)}" `
    + 'role="img" aria-label="会場の概略図と巡回順">');
  out.push(`<rect width="${r(totalW)}" height="${r(totalH)}" fill="${C.paper}"/>`);

  for (const b of bands) {
    out.push(`<rect x="${r(PAD - u(14))}" y="${r(b.top - u(18))}" width="${r(u(3.4))}" `
      + `height="${r(b.bottom - b.top + u(18))}" fill="${C.row}"/>`);
    out.push(`<text x="${r(PAD - u(7))}" y="${r(b.top - u(9))}" fill="${C.row}" `
      + `font-size="${r(u(13))}" font-weight="700" letter-spacing="${r(u(1.4))}">`
      + `${esc(b.label)}</text>`);
  }

  for (const [zid, g] of place) {
    out.push(`<rect x="${r(g.x - u(6))}" y="${r(g.y - u(6))}" width="${r(g.w + u(12))}" `
      + `height="${r(g.hi - g.lo + u(12))}" fill="${C.zone}" stroke="${C.zoneEdge}" `
      + `stroke-width="${r(u(1))}"/>`);
    out.push(`<text x="${r(g.x + g.w - u(1))}" y="${r(g.y - u(9))}" `
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

  // 立ち寄りの真の位置を出し、丸が重なるところは押し合って離す。
  // 番号の丸どうしが被って読めない不具合への対処。道すじも離した後の中心で引く。
  const nodes = stops.map((s) => ({
    s, x: X(s.point.zone, s.point.x), y: Y(s.point.zone, s.point.y),
    top: place.get(s.point.zone).y,
  }));
  const minD = MR * 2 + u(3);
  for (let i = 1; i < nodes.length; i++) {
    for (let iter = 0; iter < 30; iter++) {
      let moved = false;
      for (let j = 0; j < i; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 0.01) { dx = u(2); dy = -u(10); d = Math.hypot(dx, dy); } // 完全重なりをほどく
        const push = (minD - d) * 0.5;
        nodes[i].x += (dx / d) * push;
        nodes[i].y += (dy / d) * push;
        moved = true;
      }
      if (!moved) break;
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

  // 立ち寄り: 番号の丸 + ブロック記号 (記号を主役にする)
  nodes.forEach((n, i) => {
    const up = n.y > n.top + u(4);
    const ty = up ? n.y - MR - u(4) : n.y + MR + u(13);
    out.push(`<text x="${r(n.x)}" y="${r(ty)}" fill="${C.code}" font-size="${r(u(15))}" `
      + `font-weight="700" text-anchor="middle" stroke="${C.paper}" stroke-width="${r(u(3))}" `
      + `paint-order="stroke">${esc(n.s.placement.block)}</text>`);
    out.push(`<circle cx="${r(n.x)}" cy="${r(n.y)}" r="${r(MR)}" `
      + `fill="${stopColor(n.s.placement.priority)}"`
      + `${n.s.wall ? ` stroke="${C.wallHit}" stroke-width="${r(u(2))}"` : ''}/>`);
    out.push(`<text x="${r(n.x)}" y="${r(n.y + u(4))}" fill="#ffffff" font-size="${r(u(12))}" `
      + `font-weight="700" text-anchor="middle">${i + 1}</text>`);
  });

  out.push('</svg>');
  return out.join('');
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

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
