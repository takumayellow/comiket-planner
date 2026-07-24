// 会場レイアウトと「ブロック記号+番号 → 座標」の解決。
// src/comiket_planner/layout.py の移植。座標系はゾーンごとのローカル平面(メートル)。

export const FACE_OFFSET = 2.2; // 島の中心線から、そのスペースの前に立つ位置まで (m)

export class Layout {
  constructor(doc) {
    this.doc = doc;
    this.params = doc.params;
    this.zones = doc.zones;
    this.transfer = doc.transfer_minutes;
    /** @type {Map<string,[string,object]>} code -> [zoneId, block] */
    this.index = new Map();
    for (const [zid, z] of Object.entries(this.zones)) {
      for (const b of z.blocks) this.index.set(b.code, [zid, b]);
    }
  }

  zoneOf(code) {
    return this.index.get(code)?.[0] ?? null;
  }

  isWall(code) {
    return this.index.get(code)?.[1].kind === 'wall';
  }

  hallOf(code, number = null) {
    const hit = this.index.get(code);
    if (!hit) return null;
    const b = hit[1];
    if (b.kind === 'wall' && number != null) {
      for (const [hall, lo, hi] of (b.hall_ranges || [])) {
        if (lo <= number && number <= hi) return hall;
      }
    }
    return b.hall ?? null;
  }

  /** ブロック記号+番号 → ゾーン内座標。未知の記号は null。 */
  locate(code, number) {
    const hit = this.index.get(code);
    if (!hit) return null;
    const [zid, b] = hit;
    return b.kind === 'island'
      ? this.#locateIsland(zid, b, number)
      : this.#locateWall(zid, b, number);
  }

  #locateIsland(zid, b, number) {
    const size = b.size;
    const half = Math.floor(size / 2);
    const n = Math.max(1, Math.min(number, size));
    const { y0, y1 } = b;
    let x; let y;
    if (n <= half) { // 右面: 下→上
      const t = (n - 0.5) / half;
      y = y0 + t * (y1 - y0);
      x = b.x + FACE_OFFSET;
    } else { // 左面: 上→下
      const t = (n - half - 0.5) / half;
      y = y1 - t * (y1 - y0);
      x = b.x - FACE_OFFSET;
    }
    return { zone: zid, x: round2(x), y: round2(y) };
  }

  #locateWall(zid, b, number) {
    const lo = b.from;
    const hi = b.to;
    const n = Math.max(lo, Math.min(number, hi));
    const frac = (n - lo) / Math.max(1, hi - lo);
    const pts = b.path;
    const seglen = [];
    for (let i = 0; i < pts.length - 1; i++) seglen.push(Math.hypot(
      pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
    const total = seglen.reduce((a, c) => a + c, 0) || 1.0;
    const target = frac * total;
    let acc = 0;
    for (let i = 0; i < seglen.length; i++) {
      const L = seglen[i];
      if (acc + L >= target || i === seglen.length - 1) {
        const r = (target - acc) / (L || 1.0);
        return {
          zone: zid,
          x: round2(pts[i][0] + r * (pts[i + 1][0] - pts[i][0])),
          y: round2(pts[i][1] + r * (pts[i + 1][1] - pts[i][1])),
        };
      }
      acc += L;
    }
    const last = pts[pts.length - 1];
    return { zone: zid, x: last[0], y: last[1] };
  }

  /** 2点間の歩行時間(分)。同ゾーンは通路距離近似、別ゾーンは transfer 表。 */
  walkMinutes(a, b) {
    if (a.zone === b.zone) {
      return this.#aisleDistance(a, b) / this.params.walk_speed_m_per_min;
    }
    // transfer 表のキー順に依存しない (どちら向きでも引ける)
    let t = this.transfer[`${a.zone}|${b.zone}`];
    if (t == null) t = this.transfer[`${b.zone}|${a.zone}`];
    return Number(t ?? 20);
  }

  /** 同ゾーン内の近似通路距離。島に沿って歩くので L1 基調 + 交差通路への迂回。 */
  #aisleDistance(a, b) {
    const z = this.zones[a.zone];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    let base = dx + dy;
    if (dx > 4.0) { // 別の島どうし: 交差通路へ抜ける縦移動が要る
      const aisles = z.cross_aisles || [];
      if (aisles.length) {
        let nearest = aisles[0];
        let bestv = Infinity;
        for (const ya of aisles) {
          const v = Math.abs(ya - a.y) + Math.abs(ya - b.y);
          if (v < bestv) { bestv = v; nearest = ya; }
        }
        const detour = (Math.abs(a.y - nearest) + Math.abs(b.y - nearest)) - dy;
        base += Math.max(0, detour) * 0.5;
      }
    }
    return base;
  }

  /** そのゾーンの入口(入場後に立つ想定位置)。下辺中央あたり。 */
  entrancePoint(zone) {
    const z = this.zones[zone];
    return { zone, x: z.width / 2.0, y: 4.0 };
  }
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
