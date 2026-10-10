// web/js/stopinfo.js (立ち寄り1件の表示用の読み替え) の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LAYOUT_DOC } from '../../web/js/layout-data.js';
import { Layout } from '../../web/js/layout.js';
import { parseFreeText } from '../../web/js/freeform.js';
import { groupByBlock } from '../../web/js/group.js';
import { planRoute } from '../../web/js/router.js';
import { describeStop, zoneName, buildingClass, esc } from '../../web/js/stopinfo.js';

const layout = new Layout(LAYOUT_DOC);

function build(text) {
  const placements = parseFreeText(text).flatMap((e) => e.placements);
  const { reps, groups } = groupByBlock(placements);
  const plan = planRoute(reps, layout, { startTime: '10:30', timeBudgetMin: 330 });
  for (const s of plan.stops) s.wall = layout.isWall(s.placement.block);
  return { plan, groups };
}

test('同じ島の複数件は番号をまとめ、名前は全件から重複なく拾う', () => {
  const { plan, groups } = build('東シ30a ねこ屋\n東シ31b いぬ屋\n東シ32a ねこ屋');
  assert.equal(plan.stops.length, 1);
  const d = describeStop(plan.stops[0], groups, layout);
  assert.equal(d.items.length, 3);
  assert.equal(d.block, 'シ');
  assert.equal(d.loc, `${d.hall} シ${d.nums}`);
  assert.deepEqual(d.labels, ['ねこ屋', 'いぬ屋']);
  assert.equal(d.wall, false);
  assert.match(d.hall, /^東/);
});

test('壁と優先度の色クラスを持つ', () => {
  const { plan, groups } = build('東A01a 最優先 ねこ屋');
  const d = describeStop(plan.stops[0], groups, layout);
  assert.equal(d.wall, true);
  assert.equal(d.priority, 1);
  assert.ok(d.col);
  assert.equal(d.zone, plan.stops[0].point.zone);
});

test('ゾーン名は末尾の「ホール」を落とし、知らない id はそのまま', () => {
  const [zid, z] = Object.entries(layout.zones).find(([, v]) => /ホール$/.test(v.label));
  assert.equal(zoneName(layout, zid), z.label.replace(/ホール$/, ''));
  assert.equal(zoneName(layout, 'nowhere'), 'nowhere');
  assert.equal(zoneName(layout, undefined), '');
});

test('棟の色クラスは東・西・それ以外(南)', () => {
  assert.equal(buildingClass('east123'), 'b-east');
  assert.equal(buildingClass('west12'), 'b-west');
  assert.equal(buildingClass('south12'), 'b-south');
  assert.equal(buildingClass(undefined), 'b-south');
});

test('esc は HTML の5文字を落とし、null は空にする', () => {
  assert.equal(esc(`<a href="x" title='y'>&</a>`),
    '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});
