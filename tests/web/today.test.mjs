// web/js/today.js (当日タブの表示値) の単体テスト。実際の会場データで巡回順を組んで確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LAYOUT_DOC } from '../../web/js/layout-data.js';
import { Layout } from '../../web/js/layout.js';
import { parseFreeText } from '../../web/js/freeform.js';
import { groupByBlock } from '../../web/js/group.js';
import { planRoute, walk } from '../../web/js/router.js';
import { withStatus } from '../../web/js/progress.js';
import { todayView, shortEvent, clockFrom } from '../../web/js/today.js';

const layout = new Layout(LAYOUT_DOC);
const DATES = ['2026-08-15', '2026-08-16'];
const CLOSE = 16 * 60;

function build(text) {
  const placements = parseFreeText(text).flatMap((e) => e.placements);
  const { reps, groups } = groupByBlock(placements);
  const plan = planRoute(reps, layout, { startTime: '10:30', timeBudgetMin: 330 });
  for (const s of plan.stops) s.wall = layout.isWall(s.placement.block);
  return { plan, groups };
}

const { plan, groups } = build('東A01a 最優先 ねこ屋\n東ア10b\n西あ20a\n南a05b\n東シ30a');
const keys = plan.stops.map((s) => s.placement.groupKey);
const view = (status, now, brk = 0) => todayView({
  plan, groups, status, layout, now, brk, closeMin: CLOSE, event: 'コミックマーケット108', dates: DATES,
});

test('前提: 5軒すべてに巡回順が付く', () => {
  assert.equal(plan.stops.length, 5);
});

test('イベント名から短い呼び名を作る', () => {
  assert.equal(shortEvent('コミックマーケット108'), 'C108');
  assert.equal(shortEvent(''), 'コミケ');
  assert.equal(shortEvent('夏の即売会'), '夏の即売会');
});

test('プランが無ければ空の表示', () => {
  const v = todayView({
    plan: null, groups: new Map(), status: new Map(), layout,
    now: new Date(2026, 7, 15, 11, 0), brk: 0, closeMin: CLOSE, event: 'コミックマーケット108', dates: DATES,
  });
  assert.equal(v.empty, true);
  assert.equal(v.dayLabel, 'C108 1日目');
  assert.equal(v.clock, '11:00');
});

test('開催日でなければ遅れを出さず予定だけ見せる', () => {
  const v = view(new Map(), new Date(2026, 9, 10, 21, 5));
  assert.equal(v.live, false);
  assert.equal(v.dayLabel, 'C108');
  assert.deepEqual(v.pace, { tone: 'plan', label: '予定' });
  assert.match(v.endLabel, /^10:30 に回りはじめて、\d\d:\d\d に回り終わる予定$/);
});

test('開始前は「開始前」', () => {
  const v = view(new Map(), new Date(2026, 7, 16, 10, 0));
  assert.equal(v.live, true);
  assert.equal(v.dayLabel, 'C108 2日目');
  assert.equal(v.pace.label, '開始前');
});

test('当日は次の1軒の予定到着と比べて遅れを出し、終了見込みも後ろへずらす', () => {
  const st = withStatus(new Map(), keys[0], 'done');
  const head = plan.stops[1];
  const now = new Date(2026, 7, 15, 0, Math.round(head.arrivalMin) + 12);
  const v = view(st, now);
  assert.deepEqual(v.pace, { tone: 'late', label: '予定より12分遅れ' });
  assert.equal(v.next.key, keys[1]);
  assert.equal(v.next.no, 2);
  const ontime = view(st, new Date(2026, 7, 15, 0, Math.round(head.arrivalMin)));
  assert.equal(ontime.pace.label, '予定どおり');
  const [h1, m1] = ontime.endLabel.match(/(\d\d):(\d\d)/).slice(1).map(Number);
  const [h2, m2] = v.endLabel.match(/(\d\d):(\d\d)/).slice(1).map(Number);
  assert.equal((h2 * 60 + m2) - (h1 * 60 + m1), 12);
});

test('休憩を取り分けていて遅れているときは、休憩も遅れに数えると添える', () => {
  const now = new Date(2026, 7, 15, 0, Math.round(plan.stops[0].arrivalMin) + 30);
  assert.match(view(new Map(), now, 45).endLabel, /昼食・休憩/);
  assert.doesNotMatch(view(new Map(), now, 0).endLabel, /昼食・休憩/);
});

test('名前は入力から拾い、無ければ空で返す', () => {
  const v = view(new Map(), new Date(2026, 7, 15, 10, 30));
  const first = plan.stops[0].placement;
  assert.equal(v.next.name, first.label || '');
  assert.equal(v.next.priority, first.priority);
});

test('あとで回るにした1軒は最後へ回り、歩く時間は出さない', () => {
  let st = new Map();
  for (const k of keys.slice(1)) st = withStatus(st, k, 'done');
  st = withStatus(st, keys[0], 'skip');
  const v = view(st, new Date(2026, 7, 15, 12, 0));
  assert.equal(v.next.key, keys[0]);
  assert.equal(v.next.skipped, true);
  assert.equal(v.next.walk, '—');
  assert.equal(v.pace, null);   // 後回し分は予定時刻と比べない
  assert.equal(v.upcoming.length, 0);
});

test('後回しが2件あれば、2件目は「このあと」に「あとで回る」で並ぶ', () => {
  let st = new Map();
  for (const k of keys.slice(2)) st = withStatus(st, k, 'done');
  st = withStatus(st, keys[0], 'skip');
  st = withStatus(st, keys[1], 'skip');
  const v = view(st, new Date(2026, 7, 15, 12, 0));
  assert.equal(v.next.key, keys[0]);   // 押した順
  assert.equal(v.upcoming.length, 1);
  assert.equal(v.upcoming[0].key, keys[1]);
  assert.equal(v.upcoming[0].moveLabel, 'あとで回る');
});

test('このあとは最大3件で、棟をまたぐなら「移動」', () => {
  const v = view(new Map(), new Date(2026, 7, 15, 10, 30));
  assert.equal(v.upcoming.length, 3);
  plan.stops.slice(1, 4).forEach((s, i) => {
    const crossed = s.point.zone !== plan.stops[i].point.zone;
    assert.match(v.upcoming[i].moveLabel, crossed ? /^移動\d+分$/ : /^徒歩\d+分$/);
  });
  assert.equal(v.progressLabel, '0 / 5 軒');
});

test('途中の1軒を先に済ませたら、「このあと」の移動は待ち行列で1つ前から測り直す', () => {
  // 3軒目だけ先に回った: 2軒目の次は4軒目
  const st = withStatus(new Map(), keys[2], 'done');
  const v = view(st, new Date(2026, 7, 15, 10, 30));
  assert.deepEqual(v.upcoming.map((u) => u.key), [keys[1], keys[3], keys[4]]);
  const w = Math.round(walk(layout, plan.stops[1].point, plan.stops[3].point));
  assert.notEqual(w, Math.round(plan.stops[3].walkFromPrev));   // 測り直さないと分かる差がある
  assert.equal(v.upcoming[1].moveLabel, `移動${w}分`);
});

test('?now= で指定した時刻から実際の経過時間ぶん進む時計になる', () => {
  let t = 1_000_000;
  const tick = () => t;
  const c = clockFrom('?now=2026-08-15T11:20', tick);
  assert.equal(c().getHours(), 11);
  assert.equal(c().getMinutes(), 20);
  t += 5 * 60_000;
  assert.equal(c().getMinutes(), 25);
  assert.equal(c().getDate(), 15);
  // 形の合わない値は本物の時計
  assert.equal(clockFrom('?now=2026-08-15', tick)().getTime(), t);
  assert.equal(clockFrom('', tick)().getTime(), t);
  // 13月・25時のように Date が繰り上げてしまう値も本物の時計
  assert.equal(clockFrom('?now=2026-13-45T25:70', tick)().getTime(), t);
  assert.equal(clockFrom('?now=2026-02-30T10:00', tick)().getTime(), t);
});

test('全部回り終えたら件数を分けて出す', () => {
  let st = new Map();
  keys.forEach((k, i) => { st = withStatus(st, k, i === 0 ? 'sold' : 'done'); });
  const v = view(st, new Date(2026, 7, 15, 14, 0));
  assert.equal(v.next, null);
  assert.equal(v.allDone, true);
  assert.deepEqual(v.counts, { done: 4, sold: 1, finished: 5, total: 5 });
  assert.equal(v.progressPct, 100);
});
