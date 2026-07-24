// web/js の移植が Python 版 (src/comiket_planner) と同じ経路を返すか確かめる。
// 使い方: node scripts/check_web_parity.mjs > /tmp/js.json
// 対になる scripts/check_web_parity.py の出力と diff すること。

import { LAYOUT_DOC } from '../web/js/layout-data.js';
import { Layout } from '../web/js/layout.js';
import { parseLine } from '../web/js/catalog.js';
import { parseFreeText } from '../web/js/freeform.js';
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

// 自由文の切り分けと優先度推定 (freeform)。書式を守らない入力こそ移植差が出やすい
const FREE = `西のあ36の○○が絶対欲しい、あと東H07も。南q06,10,16は余裕があれば
きくりのあ38,39は本命。西せ9-15あたりは時間があれば見たい あと東ア86-88はついででいいや
東方Projectのサークルが西R12bにいるらしいので必ず行く それから南q06 冷やかし
のんのんびよりの新刊が東H07にあるはず 西め37は優先2 西す23 *4 五等分の花嫁
何も配置がわからないメモ
東H08は絶対欲しいけどできれば 西め12はできれば絶対
西あ36-39,45 と 西き36,38-40 の混在 西す230 は番号が変
西お３６の○○が絶対欲しい ＊２
西き12の推しの子 東5 ア86-88はついで 西あ36の絶対少女`;

const layout = new Layout(LAYOUT_DOC);
const placements = CASES.flatMap((l) => parseLine(l).placements);

const out = {
  n_parsed: placements.length,
  parsed: placements.map((p) => `${p.district}${p.block}${p.number}${p.ab}|${p.priority}|${p.label}`),
  free: parseFreeText(FREE).map((e) => `${e.raw}|${e.priority}|${e.cue}|${e.label}|`
    + e.placements.map((p) => `${p.district}${p.block}${p.number}${p.ab}`).join(',')),
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
