// 立ち寄り1件を画面に出すときの共通の読み替え。巡回・当日・コピー用テキストで
// 「どこの何か」の書き方がずれないよう、ここだけで組み立てる。

import { formatNumbers } from './group.js';
import { priorityClass } from './map.js';

/**
 * @param {object} s plan.stops の1件
 * @param {Map} groups 島ごとにまとめた配置 (groupKey → 配置の配列)
 * @param {import('./layout.js').Layout} layout
 */
export function describeStop(s, groups, layout) {
  const p = s.placement;
  const items = groups.get(p.groupKey) || [p];
  const nums = formatNumbers(items.map((x) => x.number));
  const hall = layout.hallOf(p.block, p.number) || p.district || '';
  return {
    key: p.groupKey,
    placement: p,
    items,
    block: p.block,
    nums,
    hall,
    loc: `${hall} ${p.block}${nums}`,
    // 名前は代表1件ではなく、まとめた全件から拾う (島でまとめると名前が消えてしまう)
    labels: [...new Set(items.map((x) => x.label).filter(Boolean))],
    priority: p.priority,
    col: priorityClass(p.priority),
    wall: !!s.wall,
    zone: s.point?.zone ?? null,
  };
}

/** ゾーンの短い呼び名 (「東1・2・3ホール」→「東1・2・3」)。 */
export function zoneName(layout, zid) {
  const label = layout.zones[zid]?.label || zid || '';
  return label.replace(/ホール$/, '');
}

/** 棟 (東/西/南) ごとの色クラス。ホールの区切りや札に使う。 */
export function buildingClass(zid) {
  if (String(zid).startsWith('east')) return 'b-east';
  if (String(zid).startsWith('west')) return 'b-west';
  return 'b-south';
}

// 属性は必ず " で囲っているが、' も落としておく (囲み方を変えたときの事故防止)
export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
