// web/js の移植が Python 版 (src/comiket_planner) と同じ経路を返すか確かめる。
// 使い方: node scripts/check_web_parity.mjs > /tmp/js.json
// 対になる scripts/check_web_parity.py の出力と diff すること。

import { LAYOUT_DOC } from '../web/js/layout-data.js';
import { Layout } from '../web/js/layout.js';
import { parseLine } from '../web/js/catalog.js';
import { planRoute } from '../web/js/router.js';

const CASES = [
  '東H07 *2 ホロライブ',
  '東E18-22 *2 ぺこら',
  '西あ36 *2 ごちうさ',
  '西せ9-15 *3 おにまい',
  '南q06,10,16 *4',
  '東ア86-88 *4 艦これ',
  '西め37 *4',
  '西す23 *3 五等分の花嫁',
];

const layout = new Layout(LAYOUT_DOC);
const placements = CASES.flatMap((l) => parseLine(l).placements);

const out = {
  n_parsed: placements.length,
  parsed: placements.map((p) => `${p.district}${p.block}${p.number}${p.ab}|${p.priority}|${p.label}`),
  runs: {},
};

for (const [name, opt] of Object.entries({
  west_free: { startZone: 'west12', startTime: '11:20', timeBudgetMin: null },
  west_280: { startZone: 'west12', startTime: '11:20', timeBudgetMin: 280 },
  auto_200: { startZone: null, startTime: '10:30', timeBudgetMin: 200 },
})) {
  const plan = planRoute(placements, layout, opt);
  out.runs[name] = {
    start_zone: plan.startZone,
    total: plan.totalMin.toFixed(3),  // 文字列で出す(丸め方式の差で誤検知しない)
    stops: plan.stops.map((s) => `${s.arrival} ${s.placement.district}${s.placement.block}${s.placement.number}`),
    dropped: plan.dropped.map((p) => `${p.district}${p.block}${p.number}`),
  };
}

process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
