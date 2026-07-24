// 同じ島(ブロック記号+地区)の複数スペースを1つの立ち寄りにまとめる。
// 実運用では「その島に着いたら番号帯を歩いて拾う」ので、スペース単位で経路を
// 組むと同じ島を何度も往復する計算になってしまう。

import { placement } from './catalog.js';

/**
 * @param {Array} placements
 * @returns {{reps:Array, groups:Map<string,Array>}}
 *   reps: 経路計算に渡す代表 Placement (span:N タグつき)
 *   groups: 代表の groupKey -> その島で拾う元エントリ一覧
 */
export function groupByBlock(placements) {
  // キーは記号だけ。地区を混ぜると「あ36」と「西あ38」が別の島として2回立ち寄りに
  // なる (Layout は地区を見ずに記号で位置を引くので、実際は同じ島)。
  const groups = new Map();
  for (const p of placements) {
    const k = p.block;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }

  const reps = [];
  for (const [k, items] of groups) {
    const sorted = items.slice().sort(
      (a, b) => a.priority - b.priority || a.number - b.number);
    const head = sorted[0];
    const labels = [...new Set(sorted.map((p) => p.label).filter(Boolean))];
    // 同じスペースを2回書いても島の広さ(=滞在時間)は増えない
    const spread = new Set(sorted.map((p) => `${p.number}|${p.ab}`)).size;
    reps.push(placement({
      ...head,
      groupKey: k,
      label: labels[0] || '',
      tags: [...head.tags, `span:${spread}`,
        ...(labels.length > 1 ? ['broad'] : [])],
    }));
  }
  return { reps, groups };
}

/** そのままスペース単位で回す場合も groupKey を持たせて表示側を揃える。 */
export function noGrouping(placements) {
  // キーに行番号を混ぜない。上に1行足しただけで全部ずれ、消し込みのチェックが
  // 別のサークルに移ってしまう。同一スペースの重複だけ連番で区別する。
  const groups = new Map();
  const seen = new Map();
  const reps = placements.map((p) => {
    const base = `${p.block}|${p.number}|${p.ab}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const k = n ? `${base}#${n}` : base;
    groups.set(k, [p]);
    return placement({ ...p, groupKey: k });
  });
  return { reps, groups };
}

/** 連番を「36-39,48」のように畳む。 */
export function formatNumbers(nums) {
  const ns = [...new Set(nums)].sort((a, b) => a - b);
  const out = [];
  let i = 0;
  while (i < ns.length) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    if (j - i >= 2) out.push(`${ns[i]}-${ns[j]}`);
    else for (let k = i; k <= j; k++) out.push(String(ns[k]));
    i = j + 1;
  }
  return out.join(',');
}
