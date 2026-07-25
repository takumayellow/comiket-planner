// 同じ島(ブロック記号+地区)の複数スペースを1つの立ち寄りにまとめる。
// 実運用では「その島に着いたら番号帯を歩いて拾う」ので、経路も時間も必ず島単位で
// 積む。これは表示のまとめ/展開とは無関係で、常にこの単位で計算する
// (まとめ表示にするかどうかで所要時間が変わってはいけない)。

import { placement } from './catalog.js';

/**
 * @param {Array} placements
 * @returns {{reps:Array, groups:Map<string,Array>}}
 *   reps: 経路計算に渡す代表 Placement (mp:優先度リスト タグつき)
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
    // 島の滞在時間は「その島で拾う各スペースを1つずつ見て買う」時間の合計。
    // 同じスペースを2度書いても1回分。各スペースの優先度(=行列の代理)を並べて
    // router に渡し、router 側で1件ずつの所要を足す (mp = member priorities)。
    const bySpace = new Map();
    for (const p of sorted) {
      const sk = `${p.number}|${p.ab}`;
      const cur = bySpace.get(sk);
      if (cur == null || p.priority < cur) bySpace.set(sk, p.priority);
    }
    const mprio = [...bySpace.values()].sort((a, b) => a - b);
    reps.push(placement({
      ...head,
      groupKey: k,
      label: labels[0] || '',
      tags: [...head.tags, `mp:${mprio.join('.')}`],
    }));
  }
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
