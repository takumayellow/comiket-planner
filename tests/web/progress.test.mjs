// web/js/progress.js の単体テスト。`node --test tests/web/` で走る (依存なし)。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS, restoreStatus, withStatus, toggledStatus, pendingQueue, countBy,
  delayMin, paceOf, eventDayIndex, isLiveWindow,
} from '../../web/js/progress.js';

const stop = (k, arrivalMin) => ({ placement: { groupKey: k }, arrivalMin });
const keyOf = (s) => s.placement.groupKey;
const STOPS = [stop('a', 630), stop('b', 640), stop('c', 650), stop('d', 660)];

test('旧版の done 配列は「買えた」として引き継ぐ', () => {
  const st = restoreStatus(null, ['a', 'b']);
  assert.deepEqual([...st], [['a', 'done'], ['b', 'done']]);
});

test('新しい status が旧 done より優先され、知らない値は捨てる', () => {
  const st = restoreStatus({ a: 'sold', c: 'skip', d: 'bogus' }, ['a']);
  assert.equal(st.get('a'), 'sold');
  assert.equal(st.get('c'), 'skip');
  assert.equal(st.has('d'), false);
});

test('保存した並び (後回しを押した順) をそのまま戻す', () => {
  const st = restoreStatus([['c', 'skip'], ['a', 'skip'], ['b', 'done']], ['a']);
  assert.deepEqual([...st], [['c', 'skip'], ['a', 'skip'], ['b', 'done']]);
});

test('壊れた保存値でも落ちない', () => {
  assert.equal(restoreStatus('x', 'y').size, 0);
  assert.equal(restoreStatus([1, 2], [3, null]).size, 0);
});

test('withStatus は元の Map を書き換えない', () => {
  const a = new Map([['a', 'done']]);
  const b = withStatus(a, 'b', 'sold');
  assert.equal(a.has('b'), false);
  assert.equal(b.get('b'), 'sold');
  assert.equal(withStatus(b, 'a', null).has('a'), false);
});

test('消し込みは 回り終えた→未着手、未着手/あとで→買えた', () => {
  const st = new Map([['a', 'done'], ['b', 'sold'], ['c', 'skip']]);
  assert.equal(toggledStatus(st, 'a').has('a'), false);
  assert.equal(toggledStatus(st, 'b').has('b'), false);
  assert.equal(toggledStatus(st, 'c').get('c'), 'done');
  assert.equal(toggledStatus(st, 'd').get('d'), 'done');
});

test('あとで回るは列の最後へ回り、回り終えたものは除く', () => {
  const st = new Map([['a', 'done'], ['b', 'skip'], ['c', 'sold']]);
  const q = pendingQueue(STOPS, st, keyOf);
  assert.deepEqual(q.map((x) => keyOf(x.stop)), ['d', 'b']);
  assert.deepEqual(q.map((x) => x.index), [3, 1]);
});

test('後回しは押した順に並び、もう一度押すと最後へ移る', () => {
  let st = withStatus(new Map(), 'c', 'skip');
  st = withStatus(st, 'a', 'skip');
  st = withStatus(withStatus(st, 'b', 'done'), 'd', 'done');
  assert.deepEqual(pendingQueue(STOPS, st, keyOf).map((x) => keyOf(x.stop)), ['c', 'a']);
  st = withStatus(st, 'c', 'skip');
  assert.deepEqual(pendingQueue(STOPS, st, keyOf).map((x) => keyOf(x.stop)), ['a', 'c']);
});

test('件数は 買えた / 売り切れ を分けて数える', () => {
  const st = new Map([['a', 'done'], ['b', 'sold'], ['c', 'skip']]);
  assert.deepEqual(countBy(STOPS, st, keyOf), { done: 1, sold: 1, finished: 2, total: 4 });
});

test('遅れは次の1軒の予定到着と比べる', () => {
  const q = pendingQueue(STOPS, new Map(), keyOf);
  assert.equal(delayMin(645, q[0]), 15);
  assert.equal(delayMin(620, q[0]), -10);
});

test('残りが後回しだけなら遅れは出さない', () => {
  const st = new Map([['a', 'skip']]);
  const q = pendingQueue([STOPS[0]], st, keyOf);
  assert.equal(delayMin(700, q[0]), null);
  assert.equal(delayMin(700, undefined), null);
  assert.equal(paceOf(null), null);
});

test('±2分は予定どおりに丸める', () => {
  assert.deepEqual(paceOf(2), { late: false, label: '予定どおり' });
  assert.deepEqual(paceOf(-2), { late: false, label: '予定どおり' });
  assert.deepEqual(paceOf(3), { late: true, label: '予定より3分遅れ' });
  assert.deepEqual(paceOf(-5), { late: false, label: '予定より5分早い' });
});

test('開催日の判定は端末の現地日付で行う', () => {
  const dates = ['2026-08-15', '2026-08-16'];
  assert.equal(eventDayIndex(new Date(2026, 7, 15, 9, 0), dates), 0);
  assert.equal(eventDayIndex(new Date(2026, 7, 16, 23, 59), dates), 1);
  assert.equal(eventDayIndex(new Date(2026, 9, 10, 12, 0), dates), -1);
  assert.equal(eventDayIndex(new Date(2026, 7, 15), undefined), -1);
});

test('遅れを出すのは回りはじめの1時間前から閉会30分後まで', () => {
  assert.equal(isLiveWindow(570, 630, 960), true);
  assert.equal(isLiveWindow(569, 630, 960), false);
  assert.equal(isLiveWindow(990, 630, 960), true);
  assert.equal(isLiveWindow(991, 630, 960), false);
});

test('STATUS は書き換えられない', () => {
  assert.throws(() => { 'use strict'; STATUS.DONE = 'x'; });
});
