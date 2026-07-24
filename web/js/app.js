// 画面まわり。計算はすべてこのファイルから呼ぶローカル処理で完結する
// (サーバへは何も送らない = 会場が圏外でも動く)。

import { LAYOUT_DOC } from './layout-data.js';
import { Layout } from './layout.js';
import { parseText } from './catalog.js';
import { groupByBlock, noGrouping, formatNumbers } from './group.js';
import { planRoute, pyRound, hhmmToMin, minToHhmm } from './router.js';
import { renderMap, priorityClass } from './map.js';

const $ = (s) => document.querySelector(s);
const LS = 'cp.';
const layout = new Layout(LAYOUT_DOC);

// 初回訪問はこれを入れておく (書き方が一目で分かるように)
const SAMPLE = [
  '西あ36 *2 壁は完売が早いので優先2',
  '西せ9-15 *3 範囲で書くと島ごと拾う',
  '南q06,10,16 *4 番号の列挙もできる',
  '東H07 *2',
  '東ア86-88 *4 島の奥は後回し',
].join('\n');

// 開会/閉会は公式発表の転記 (data/layout/c108.json の hours)。C108 の出展サークルは
// 両日とも 10:30〜16:00 なので、「帰る時刻」に 16:00 より後は入れさせない。
const OPEN = LAYOUT_DOC.hours?.circles_open || '10:30';
const CLOSE = LAYOUT_DOC.hours?.circles_close || '16:00';
const OPEN_MIN = hhmmToMin(OPEN);
const CLOSE_MIN = hhmmToMin(CLOSE);

let state = { plan: null, groups: new Map(), done: new Set(), unparsed: [] };

// ---------- 保存 ----------
// localStorage は「使えない」ことがある (プライベートモード / Cookie ブロック /
// 容量超過)。保存に失敗しても計算と表示は続けられなければならない。

function ls(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

function save() {
  ls(() => {
    localStorage.setItem(`${LS}text`, $('#text').value);
    localStorage.setItem(`${LS}start`, $('#start').value);
    localStorage.setItem(`${LS}end`, $('#end').value);
    localStorage.setItem(`${LS}brk`, $('#brk').value);
    localStorage.setItem(`${LS}zone`, $('#zone').value);
    localStorage.setItem(`${LS}grp`, $('#grp').checked ? '1' : '0');
  });
}

function saveDone() {
  ls(() => localStorage.setItem(`${LS}done`, JSON.stringify([...state.done])));
}

function restore() {
  const get = (k, d = null) => ls(() => localStorage.getItem(`${LS}${k}`), d);
  $('#text').value = get('text') ?? SAMPLE;
  $('#start').value = get('start') || OPEN;
  $('#brk').value = get('brk') ?? '';
  // 旧版は「使える時間(分)」で保存していた。帰る時刻に読み替えて引き継ぐ。
  // 既定は閉会時刻。会場が閉まる以上「無制限」という状態は存在しない
  const oldBudget = parseInt(get('budget') ?? '', 10);
  $('#end').value = get('end')
    || (Number.isFinite(oldBudget)
      ? minToHhmm(Math.min(hhmmToMin($('#start').value) + oldBudget, CLOSE_MIN))
      : CLOSE);
  $('#zone').value = get('zone') ?? '';
  const g = get('grp');
  $('#grp').checked = g === null ? true : g === '1';
  state.done = ls(() => new Set(JSON.parse(get('done') || '[]')), new Set())
    || new Set();
}

// ---------- 使える時間 ----------
// 「何分使えるか」を人が数えるのは面倒なので、帰る時刻から逆算する。
// 昼食・休憩はここで先に取り分けておく (巡回の途中でどこで食べるかは決めない)。
// 開会前・閉会後は物理的に回れないので、開催時間の外は必ず内側へ丸める。

function budgetInfo() {
  const rawStart = hhmmToMin($('#start').value || OPEN);
  const startMin = Math.min(Math.max(rawStart, OPEN_MIN), CLOSE_MIN);
  const brk = Math.max(0, parseInt($('#brk').value, 10) || 0);
  // 空欄は「無制限」ではなく閉会。会場は必ず閉まる
  const rawEnd = $('#end').value ? hhmmToMin($('#end').value) : CLOSE_MIN;
  const endMin = Math.min(Math.max(rawEnd, startMin), CLOSE_MIN);
  const budget = endMin - startMin - brk;
  return {
    startMin,
    endMin,
    brk,
    budget: budget > 0 ? budget : null,
    bad: budget <= 0,
    cappedStart: rawStart < OPEN_MIN,
    cappedEnd: rawEnd > CLOSE_MIN,
    inverted: rawEnd < startMin,
  };
}

function renderBudgetNote() {
  const b = budgetInfo();
  const el = $('#budgetNote');
  const fix = [];
  if (b.cappedStart) {
    fix.push(`開会は <b>${OPEN}</b> なので、そこから回りはじめる前提で計算します。`);
  }
  if (b.cappedEnd) {
    fix.push(`サークルの頒布は <b>${CLOSE}</b> で終わります。それより後は指定できません。`);
  }
  if (b.inverted) {
    fix.push('<b class="warn">帰る時刻が回りはじめより前です。</b>');
  }
  if (b.bad) {
    el.innerHTML = `${fix.join('')}<b class="warn">回る時間が残りません。</b>`
      + '帰る時刻か休憩の分数を見直してください。';
    return;
  }
  el.innerHTML = fix.join('')
    + `${minToHhmm(b.startMin)} → ${minToHhmm(b.endMin)} のうち`
    + (b.brk ? `昼食・休憩 ${b.brk}分 を取り分けた` : '')
    + ` <b>${b.budget}分</b> で回ります。入りきらない分は「時間内に入らず外した」に出します。`;
}

// ---------- 計算 ----------

function compute() {
  const lines = parseText($('#text').value);
  const placements = lines.flatMap((l) => l.placements);
  const unparsed = lines.filter((l) => !l.placements.length).map((l) => l.raw);

  if (!placements.length) {
    state.plan = null;
    render(unparsed);
    return;
  }

  const { reps, groups } = $('#grp').checked
    ? groupByBlock(placements) : noGrouping(placements);
  const b = budgetInfo();

  const plan = planRoute(reps, layout, {
    startZone: $('#zone').value || null,
    startTime: minToHhmm(b.startMin),   // 開会前を指定されていても開会時刻から回る
    timeBudgetMin: b.budget,
  });
  for (const s of plan.stops) s.wall = layout.isWall(s.placement.block);

  state.plan = plan;
  state.groups = groups;
  render(unparsed);   // 保存より先に描く。保存がこけても結果は必ず出す
  save();
}

// ---------- 描画 ----------

function render(unparsed = state.unparsed) {
  state.unparsed = unparsed;
  const plan = state.plan;
  $('#empty').hidden = !!plan;
  for (const id of ['#out', '#mapsec', '#listsec']) $(id).hidden = !plan;
  $('#extra').innerHTML = '';

  if (!plan) {
    if (unparsed.length) {
      $('#extra').innerHTML = notice('bad', '場所を読み取れなかった行',
        unparsed.map(esc));
    }
    return;
  }

  // 時刻の丸めは Python 実装(pyRound)に合わせる。Math.round だと最終到着時刻と
  // 終了めやすが1分ずれることがある。休憩は巡回に含まれないので終了に足す
  const b = budgetInfo();
  const endMin = plan.startMin + pyRound(plan.totalMin) + b.brk;
  const walkTotal = plan.stops.reduce((a, s) => a + s.walkFromPrev, 0);
  $('#summary').innerHTML = `
    <div class="accent"><b>${plan.stops.length}</b><small>立ち寄り</small></div>
    <div><b>${pyRound(plan.totalMin)}</b><small>所要(分)</small></div>
    <div><b>${hhmm(endMin)}</b><small>終了めやす</small></div>
    <div><b>${pyRound(walkTotal)}</b><small>うち移動(分)</small></div>`;

  // 帰る時刻に対してどれだけ余っているか (立ち止まって迷える時間)
  const slack = b.endMin - endMin;
  const leave = `帰る <b>${minToHhmm(b.endMin)}</b>`
    + `${b.brk ? `（昼食・休憩 ${b.brk}分 を含む）` : ''}`;
  if (slack < 0) {
    // 休憩が長すぎて回る時間が残らなかったとき。時間制限なしの巡回順を出している
    $('#slack').innerHTML = `${leave} を <b class="warn">${-slack}分 超えます。</b>`
      + '休憩の分数を減らすか、帰る時刻を遅くしてください。';
  } else {
    $('#slack').innerHTML = `${leave} に対して余裕 <b>${slack}分</b>。`
      + (slack < 15 ? '<b class="warn">ほぼ余裕がありません。</b>' : '');
  }

  // 地図が描けなくても巡回順は出す (会場データにゾーンが増えたときの保険)
  try {
    $('#mapwrap').innerHTML = renderMap(layout, plan);
  } catch {
    $('#mapwrap').innerHTML = '';
    $('#mapsec').hidden = true;
  }

  $('#stops').innerHTML = plan.stops.map((s, i) => stopRow(s, i)).join('');
  bindStops();
  syncProgress();

  const extra = [];
  if (plan.dropped.length) {
    extra.push(notice('bad', `時間内に入らず外した ${plan.dropped.length}件`,
      plan.dropped.map((p) => `${esc(p.district)}${esc(p.block)}`
        + `${p.number} ${esc(p.label || '')}（優先${p.priority}）`)));
  }
  if (plan.unlocatable.length) {
    extra.push(notice('bad', 'ブロック記号が会場データに無い',
      plan.unlocatable.map((p) => `${esc(p.district)}${esc(p.block)}${p.number}`)));
  }
  if (unparsed.length) {
    extra.push(notice('bad', '場所を読み取れなかった行', unparsed.map(esc)));
  }
  $('#extra').innerHTML = extra.join('');
}

function stopRow(s, i) {
  const p = s.placement;
  const items = state.groups.get(p.groupKey) || [p];
  const nums = formatNumbers(items.map((x) => x.number));
  const hall = layout.hallOf(p.block, p.number) || p.district || '';
  const col = priorityClass(p.priority);   // 色は CSS クラスで当てる (CSP対応)
  const done = state.done.has(p.groupKey) ? ' done' : '';
  const labels = [...new Set(items.map((x) => x.label).filter(Boolean))];
  return `<div class="stop${done}" data-k="${esc(p.groupKey)}">
    <div class="stop__no">${i + 1}</div>
    <div class="stop__sym ${col}${s.wall ? ' wall' : ''}">
      <b>${esc(p.block)}</b><s>${items.length}件</s></div>
    <div class="stop__main">
      <div class="stop__loc">${esc(hall)} ${esc(p.block)}${esc(nums)}
        <u>${s.wall ? '壁' : '島'}</u>
        <span class="pill ${col}">優先${p.priority}</span></div>
      <div class="stop__lab">${esc(labels.join(' / ') || '—')}</div>
    </div>
    <div class="stop__time"><b>${s.arrival}</b>
      <small>${s.walkFromPrev >= 0.5 ? `移動+${Math.round(s.walkFromPrev)}分` : '—'}</small></div>
    <div class="stop__chk">✓</div>
  </div>`;
}

function bindStops() {
  for (const el of document.querySelectorAll('.stop')) {
    el.addEventListener('click', () => {
      const k = el.dataset.k;
      if (state.done.has(k)) state.done.delete(k); else state.done.add(k);
      el.classList.toggle('done');
      saveDone();
      syncProgress();
    });
  }
}

function syncProgress() {
  const total = state.plan?.stops.length || 0;
  const keys = new Set((state.plan?.stops || []).map((s) => s.placement.groupKey));
  let d = 0;
  for (const k of state.done) if (keys.has(k)) d++;
  $('#pbar').style.width = total ? `${(d / total) * 100}%` : '0';
}

function notice(kind, title, items) {
  return `<div class="notice ${kind}">
    <b>${esc(title)}</b><ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;
}

function asText() {
  const plan = state.plan;
  if (!plan) return '';
  // 画面の「所要(分)」と同じ丸めにする (Math.round だと1分ずれることがある)
  const head = `巡回順（${plan.stops.length}件 / 約${pyRound(plan.totalMin)}分）`;
  const body = plan.stops.map((s, i) => {
    const p = s.placement;
    const items = state.groups.get(p.groupKey) || [p];
    const hall = layout.hallOf(p.block, p.number) || p.district || '';
    return `${i + 1}. ${s.arrival} ${hall} ${p.block}`
      + `${formatNumbers(items.map((x) => x.number))}`
      + `${p.label ? ` (${p.label})` : ''}`;
  });
  return [head, ...body].join('\n');
}

function hhmm(v) {
  return `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- 起動 ----------

// 開催時間は公式発表なので、入力欄の可動域もデータから決める (HTML に直書きしない)
for (const id of ['#start', '#end']) {
  $(id).min = OPEN;
  $(id).max = CLOSE;
}
restore();
renderBudgetNote();
$('#meta').innerHTML = `${esc(LAYOUT_DOC.event || '')}<br>${esc(LAYOUT_DOC.venue || '')}`;
$('#hours').textContent = `サークル ${OPEN}〜${CLOSE}`;
if ($('#text').value.trim()) compute();

$('#go').addEventListener('click', compute);
$('#text').addEventListener('change', save);
for (const id of ['#start', '#end', '#brk', '#zone', '#grp']) {
  $(id).addEventListener('change', () => {
    renderBudgetNote();
    save();
    if (state.plan) compute();
  });
}
for (const b of document.querySelectorAll('[data-fill]')) {
  b.addEventListener('click', () => {
    $('#text').value = b.dataset.fill === 'sample' ? SAMPLE : '';
    save();
    compute();
  });
}
$('#resetChk').addEventListener('click', () => {
  state.done = new Set();
  saveDone();
  render();
});
$('#copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(asText());
    $('#copyBtn').textContent = 'コピーしました';
    setTimeout(() => { $('#copyBtn').textContent = 'テキストでコピー'; }, 1600);
  } catch {
    $('#copyBtn').textContent = 'コピーできませんでした';
  }
});
$('#zoomBtn').addEventListener('click', () => {
  const on = $('#mapwrap').classList.toggle('zoom');
  $('#zoomBtn').textContent = on ? '縮小' : '拡大';
});

// ホーム画面に追加 (対応ブラウザのみ)
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  $('#install').classList.add('on');
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  $('#install').classList.remove('on');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
