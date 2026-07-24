// 会場の概略図(SVG)を座標モデルから自前で描く。
// 公式の地図画像は使わない(再配布不可)。島=短冊 / 壁=折れ線 / 立ち寄り=番号つきの丸。
//
// スマホで読めることを最優先にしてある:
//  - ホールごとに1段ずつ縦に積む(横に並べると1メートルあたりの画素が足りず記号が潰れる)
//  - ブロック記号は「今回行くブロック」だけ大きく出す。全部出すと文字が重なって読めない

const GROUPS = [
  { label: '西 展示棟', zones: ['west12', 'south12'] },
  { label: '東 展示棟', zones: ['east123', 'east7'] },
];
const PAD = 26;
const GAP_IN = 32;   // 同じ棟のホール間
const GAP_GRP = 50;  // 棟と棟の間

// 公式の折り込み地図は白い紙にスミ一色 (彩度のある画素 0.00% を実測) なので、それに寄せる。
// 棟の見出しだけ準備会サイトの藍。app.css の :root と対で管理すること。
const C = {
  paper: '#f4f1ea',
  zone: '#ffffff',
  zoneEdge: '#a2a0a0',
  island: '#c9c8c8',
  islandHit: '#595757',
  wall: '#918b8a',
  wallHit: '#231815',
  code: '#231815',
  label: '#595757',
  row: '#444499',
  link: '#a2a0a0',
};

export function stopColor(priority) {
  if (priority <= 2) return '#b7282e';
  if (priority === 3) return '#444499';
  return '#595757';
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
    y += gi > 0 ? GAP_GRP - GAP_IN : 12; // 棟の見出しを置く余白
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
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(totalW)} ${r(totalH)}" `
    + 'role="img" aria-label="会場の概略図と巡回順">');
  out.push(`<rect width="${r(totalW)}" height="${r(totalH)}" fill="${C.paper}"/>`);

  for (const b of bands) {
    out.push(`<rect x="${PAD - 17}" y="${r(b.top - 22)}" width="3.5" `
      + `height="${r(b.bottom - b.top + 22)}" fill="${C.row}"/>`);
    out.push(`<text x="${PAD - 8}" y="${r(b.top - 12)}" fill="${C.row}" font-size="12.5" `
      + `font-weight="700" letter-spacing="1.6">${esc(b.label)}</text>`);
  }

  for (const [zid, g] of place) {
    out.push(`<rect x="${r(g.x - 6)}" y="${r(g.y - 6)}" width="${r(g.w + 12)}" `
      + `height="${r(g.hi - g.lo + 12)}" fill="${C.zone}" stroke="${C.zoneEdge}"/>`);
    out.push(`<text x="${r(g.x + g.w - 1)}" y="${r(g.y - 9)}" `
      + `fill="${C.label}" font-size="10.5" text-anchor="end">${esc(g.z.label)}</text>`);

    for (const b of g.z.blocks) {
      const on = hit.has(b.code);
      if (b.kind === 'island') {
        const x = X(zid, b.x);
        out.push(`<rect x="${r(x - (on ? 3.4 : 2.4))}" y="${r(Y(zid, b.y1))}" `
          + `width="${on ? 6.8 : 4.8}" height="${r(b.y1 - b.y0)}" `
          + `fill="${on ? C.islandHit : C.island}"/>`);
      } else {
        const pts = b.path.map(([px, py]) => `${r(X(zid, px))},${r(Y(zid, py))}`).join(' ');
        out.push(`<polyline points="${pts}" fill="none" `
          + `stroke="${on ? C.wallHit : C.wall}" stroke-width="${on ? 3.4 : 2.2}"/>`);
      }
    }
  }

  // 巡回の道すじ (同ホール内は実線、ホールをまたぐところは点線)
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1].point;
    const b = stops[i].point;
    const same = a.zone === b.zone;
    out.push(`<line x1="${r(X(a.zone, a.x))}" y1="${r(Y(a.zone, a.y))}" `
      + `x2="${r(X(b.zone, b.x))}" y2="${r(Y(b.zone, b.y))}" stroke="${C.link}" `
      + `stroke-width="${same ? 1.3 : 1.7}"${same ? '' : ' stroke-dasharray="5 4"'}/>`);
  }

  // 立ち寄り: 番号の丸 + ブロック記号 (記号を主役にする)
  stops.forEach((s, i) => {
    const x = X(s.point.zone, s.point.x);
    const yy = Y(s.point.zone, s.point.y);
    const up = yy > place.get(s.point.zone).y + 12;
    const ty = up ? yy - 12.5 : yy + 20;
    out.push(`<text x="${r(x)}" y="${r(ty)}" fill="${C.code}" font-size="13" `
      + `font-weight="700" text-anchor="middle" stroke="${C.paper}" stroke-width="2.6" `
      + `paint-order="stroke">${esc(s.placement.block)}</text>`);
    out.push(`<circle cx="${r(x)}" cy="${r(yy)}" r="8.6" `
      + `fill="${stopColor(s.placement.priority)}"`
      + `${s.wall ? ' stroke="#231815" stroke-width="2"' : ''}/>`);
    out.push(`<text x="${r(x)}" y="${r(yy + 3.5)}" fill="#ffffff" font-size="10" `
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
