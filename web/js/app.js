// 画面まわり。計算はすべてこのファイルから呼ぶローカル処理で完結する
// (サーバへは何も送らない = 会場が圏外でも動く)。

import { LAYOUT_DOC } from './layout-data.js';
import { Layout } from './layout.js';
import { parseFreeText } from './freeform.js';
import { placementKey } from './catalog.js';
import { groupByBlock, noGrouping, formatNumbers } from './group.js';
import { planRoute, pyRound, hhmmToMin, minToHhmm } from './router.js';
import { renderMap, priorityClass } from './map.js';
import { isSupported as micOk, createRecorder, localReady } from './voice.js';

// サークル名を調べに行くための外部検索。配置のデータベースは同梱していないので
// (再配布不可)、「場所しか分からない」ときの逃げ道はこれしかない。要通信。
const SEARCH = 'https://duckduckgo.com/?q=';

const $ = (s) => document.querySelector(s);
const LS = 'cp.';
const layout = new Layout(LAYOUT_DOC);

// 初回訪問はこれを入れておく。書式の説明ではなく「こう書き殴っていい」の実例にする
// (整った箇条書きを見せると、それを守らないといけないと思われる)。
const SAMPLE = '西のあ36の壁サークルが絶対欲しい、あと東H07のホロライブも。'
  + '西せ9-15のあたりは時間があれば見たい\n'
  + '南q06,10,16はついでで大丈夫。東ア86-88は余裕があれば';

// 開会/閉会は公式発表の転記 (data/layout/c108.json の hours)。C108 の出展サークルは
// 両日とも 10:30〜16:00 なので、「帰る時刻」に 16:00 より後は入れさせない。
const OPEN = LAYOUT_DOC.hours?.circles_open || '10:30';
const CLOSE = LAYOUT_DOC.hours?.circles_close || '16:00';
const OPEN_MIN = hhmmToMin(OPEN);
const CLOSE_MIN = hhmmToMin(CLOSE);

let state = {
  plan: null,
  groups: new Map(),
  done: new Set(),
  unparsed: [],
  entries: [],
  prio: new Map(),   // 推定に納得いかないときの手動上書き (配置キー → 優先度)
  name: new Map(),   // 手で足したサークル名 (配置キー → 名前)。空文字も上書きとして残す
};

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

function savePrio() {
  ls(() => localStorage.setItem(`${LS}prio`,
    JSON.stringify(Object.fromEntries(state.prio))));
}

function saveName() {
  ls(() => localStorage.setItem(`${LS}name`,
    JSON.stringify(Object.fromEntries(state.name))));
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
  state.prio = ls(() => new Map(Object.entries(JSON.parse(get('prio') || '{}'))
    .map(([k, v]) => [k, Number(v)])), new Map()) || new Map();
  state.name = ls(() => new Map(Object.entries(JSON.parse(get('name') || '{}'))
    .map(([k, v]) => [k, String(v)])), new Map()) || new Map();
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

// ---------- 読み取り ----------
// 優先度は文面から推定する。推定である以上外すことがあるので、
// 「何をどう読んだか」と「どの言葉を根拠にしたか」を必ず画面に出して、
// その場で直せるようにする (黙って推定して黙って使うことはしない)。

// 手動上書きを覚えておくキー。地区まで含め、同じ場所を2件書いたときは連番で分ける
// (地区を落とすと 西あ36 と 東あ36 が同一視され、片方の上書きが両方に効いてしまう)。
function entryKey(e, seen) {
  const base = e.placements.map((p) => `${p.district}${placementKey(p)}`).join(',');
  if (!base) return '';
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}#${n}`;
}

function readEntries() {
  const seen = new Map();
  const entries = parseFreeText($('#text').value).map((e) => {
    const key = entryKey(e, seen);
    const ov = key ? state.prio.get(key) : null;
    // 名前は空文字も「手で消した」という意思なので、has で見て素通しする
    const named = !!key && state.name.has(key);
    const label = named ? state.name.get(key) : e.label;
    const priority = ov || e.priority;
    return {
      ...e,
      key,
      label,
      named,
      priority,
      inferred: e.priority,
      overridden: !!ov,
      placements: e.placements.map((p) => ({ ...p, priority, label })),
    };
  });
  state.entries = entries;
  return entries;
}

/** 配置しか分からないときに名前を調べに行くための検索 URL (要通信)。 */
function findUrl(p, nums) {
  const q = `${LAYOUT_DOC.event || 'コミックマーケット'} ${p.district}${p.block}${nums} サークル`;
  return SEARCH + encodeURIComponent(q);
}

function readRow(e) {
  if (!e.placements.length) {
    return `<div class="rd bad">
      <span class="rd__loc">？</span>
      <span class="rd__lab">${esc(e.raw)}</span>
      <span class="rd__cue">場所を読み取れませんでした</span></div>`;
  }
  const p = e.placements[0];
  const hall = layout.hallOf(p.block, p.number) || p.district || '';
  const nums = formatNumbers(e.placements.map((x) => x.number));
  const col = priorityClass(e.priority);
  const opts = [1, 2, 3, 4, 5].map((n) => `<option value="${n}"`
    + `${n === e.priority ? ' selected' : ''}>優先${n}</option>`).join('');
  const cue = e.overridden ? `優先度は手で変更（推定は優先${e.inferred}）`
    : e.explicit ? `優先度は「${esc(e.cue)}」と書いてある`
      : e.cue ? `優先度は「${esc(e.cue)}」から推定` : '手がかりが無いので優先度は既定';
  // サークル名は文面から拾えないことのほうが多い。ここで書き足せると、
  // 巡回順・コピーしたテキストにそのまま出て「どこの何なのか」が分かる。
  // 読み上げでは同じ名前の欄が件数ぶん並ぶことになるので、場所を名前に含める
  const where = esc(`${hall} ${p.block}${nums}`);
  return `<div class="rd">
    <span class="rd__loc ${col}">${esc(hall)} ${esc(p.block)}${esc(nums)}</span>
    <input class="rd__name" type="text" data-k="${esc(e.key)}"
      value="${esc(e.label || '')}" placeholder="サークル名・目印（任意）"
      aria-label="${where} のサークル名">
    <span class="rd__cue">${cue}</span>
    <select class="rd__sel" data-k="${esc(e.key)}"
      aria-label="${where} の優先度">${opts}</select>
  </div>`;
}

function renderRead(entries = readEntries()) {
  $('#read').hidden = !entries.length;
  $('#readList').innerHTML = entries.map(readRow).join('');
  for (const sel of document.querySelectorAll('.rd__sel')) {
    sel.addEventListener('change', () => {
      state.prio.set(sel.dataset.k, parseInt(sel.value, 10));
      savePrio();
      if (state.plan) compute(); else renderRead();
    });
  }
  // 打ち込みの途中で描き直すと入力欄からフォーカスが飛ぶので、確定 (change) で拾う
  for (const inp of document.querySelectorAll('.rd__name')) {
    inp.addEventListener('change', () => {
      state.name.set(inp.dataset.k, inp.value.trim());
      saveName();
      if (state.plan) compute();
    });
  }
  return entries;
}

// ---------- 計算 ----------

function compute() {
  const entries = renderRead();
  const placements = entries.flatMap((e) => e.placements);
  const unparsed = entries.filter((e) => !e.placements.length).map((e) => e.raw);

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

  // 押した結果が画面のずっと下に出るので、読み上げ環境には要点だけ知らせる
  // (結果の全文を読み上げると長すぎる。件数と時間が分かれば下へ辿れる)
  $('#planLive').textContent = `巡回順を組みました。${plan.stops.length}件、`
    + `所要 ${pyRound(plan.totalMin)}分、終了めやす ${hhmm(endMin)}。`;
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
  const done = state.done.has(p.groupKey);
  const labels = [...new Set(items.map((x) => x.label).filter(Boolean))];
  // 名前が無いと当日「ここは何だったか」が分からない。書いてあれば太く出し、
  // 無ければ調べに行く導線を出す (押しても消し込みは動かない)。
  const name = labels.length
    ? `<div class="stop__lab">${esc(labels.join(' / '))}</div>`
    : `<div class="stop__lab none">名前は未記入</div>
       <a class="stop__find" href="${esc(findUrl(p, nums))}"
         target="_blank" rel="noopener noreferrer">調べる（要通信）</a>`;
  return `<div class="stop${done ? ' done' : ''}" data-k="${esc(p.groupKey)}">
    <div class="stop__no">${i + 1}</div>
    <div class="stop__sym ${col}${s.wall ? ' wall' : ''}">
      <b>${esc(p.block)}</b><s>${items.length}件</s></div>
    <div class="stop__main">
      <div class="stop__loc">${esc(hall)} ${esc(p.block)}${esc(nums)}
        <u>${s.wall ? '壁' : '島'}</u>
        <span class="pill ${col}">優先${p.priority}</span></div>
      ${name}
    </div>
    <div class="stop__time"><b>${s.arrival}</b>
      <small>${s.walkFromPrev >= 0.5 ? `移動+${Math.round(s.walkFromPrev)}分` : '—'}</small></div>
    <button class="stop__chk" type="button" role="checkbox"
      aria-checked="${done ? 'true' : 'false'}"
      aria-label="${esc(`${hall} ${p.block}${nums}`)} を回り終えた"><span
      aria-hidden="true">✓</span></button>
  </div>`;
}

function bindStops() {
  for (const el of document.querySelectorAll('.stop')) {
    const chk = el.querySelector('.stop__chk');
    // 消し込みの実体はここの button。行のどこを押しても効くのは指で操作する
    // ときの都合で、キーボードと読み上げは button だけを辿ればいいようにする。
    const toggle = () => {
      const k = el.dataset.k;
      const on = !state.done.has(k);
      if (on) state.done.add(k); else state.done.delete(k);
      el.classList.toggle('done', on);
      chk.setAttribute('aria-checked', on ? 'true' : 'false');
      saveDone();
      syncProgress();
    };
    chk.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
    el.addEventListener('click', (ev) => {
      // 「調べる」を押しただけで消し込まれると、戻ってきたとき混乱する
      if (ev.target.closest('.stop__find') || ev.target.closest('.stop__chk')) return;
      toggle();
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

// itemsHtml は「呼ぶ側で esc 済みの HTML」。中身に色付けを入れたい箇所があるので
// ここでは素通しする。生のユーザー入力を渡さないこと。
function notice(kind, title, itemsHtml) {
  return `<div class="notice ${kind}">
    <b>${esc(title)}</b><ul>${itemsHtml.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;
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
    // 名前は代表1件ではなく、まとめた全件から拾う (島でまとめると名前が消えてしまう)
    const labels = [...new Set(items.map((x) => x.label).filter(Boolean))];
    return `${i + 1}. ${s.arrival} ${hall} ${p.block}`
      + `${formatNumbers(items.map((x) => x.number))}`
      + `${labels.length ? ` (${labels.join(' / ')})` : ''}`;
  });
  return [head, ...body].join('\n');
}

function hhmm(v) {
  return `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

// 属性は必ず " で囲っているが、' も落としておく (囲み方を変えたときの事故防止)
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- 起動 ----------

// 開催時間は公式発表なので、入力欄の可動域もデータから決める (HTML に直書きしない)
for (const id of ['#start', '#end']) {
  $(id).min = OPEN;
  $(id).max = CLOSE;
}
restore();
renderBudgetNote();
$('#meta').textContent = LAYOUT_DOC.event || 'コミックマーケット';
$('#venue').textContent = LAYOUT_DOC.venue || '東京ビッグサイト';
$('#hours').textContent = `${OPEN} — ${CLOSE}`;
if ($('#text').value.trim()) compute();

$('#go').addEventListener('click', compute);
$('#text').addEventListener('change', save);
// 打ち込み/貼り付けの途中で巡回順まで作り直すと重いので、読み取り結果だけ追う
let typing = null;
$('#text').addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(() => { save(); renderRead(); }, 250);
});
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

// 音声入力 (対応ブラウザのみ)。喋った分は末尾に足していくだけで、
// 切り分けと優先度の判定はテキストと同じ経路に通す。
if (micOk()) {
  $('#mic').hidden = false;
  const live = $('#micLive');
  const note = $('#micNote');
  // 認識中の途中経過とエラー文言が同じ場所を取り合う。エラーは次に押すまで消さない
  // (エラー直後に end イベントが来るので、素直に書くと一瞬で消えて原因が分からない)。
  let msg = '';
  const rec = createRecorder({
    onFinal: (t) => {
      if (!t) return;
      const cur = $('#text').value;
      $('#text').value = cur && !/\n$/.test(cur) ? `${cur}\n${t}` : cur + t;
      save();
      renderRead();
    },
    onInterim: (t) => {
      live.textContent = t || msg;
      live.classList.toggle('bad', !t && !!msg);
    },
    onState: (s) => {
      const on = s === 'on';
      $('#micBtn').classList.toggle('on', on);
      $('#micBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
      $('#micLabel').textContent = on ? '録音中 — 押すと止める' : '声で入れる';
      if (on) { msg = ''; live.textContent = ''; live.classList.remove('bad'); }
    },
    onError: (m) => { msg = m; live.textContent = m; live.classList.add('bad'); },
    // 端末内で認識できたかどうかで、注意書きの中身が変わる。黙って切り替えない
    onMode: (m) => showMode(m === 'local'),
  });
  function showMode(local) {
    note.classList.toggle('local', local);
    note.innerHTML = local
      ? 'この端末の中で認識しています。<b>音声は外へ送られません。</b>'
      : '端末内での認識が使えないため、<b>音声はブラウザ提供元のサーバへ送られます</b>'
        + '（通信も必要です）。文字にした後の処理はすべて端末内です。';
  }
  // 押す前でも分かるように、開いた時点で使えるなら注意書きを先に直しておく。
  // (使えない場合は書き換えない。用意すれば使えるようになることがある)
  localReady().then((ok) => { if (ok) showMode(true); });
  $('#micBtn').addEventListener('click', () => (rec.active ? rec.stop() : rec.start()));
  // タブを離れたら勝手に止める。押しっぱなしで放置すると、その間の音声が
  // ブラウザ提供元へ送られ続けることになる。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && rec.active) rec.stop();
  });
} else {
  // 非対応 (iOS の一部 / Firefox)。キーボードのマイクキーなら同じことができる
  $('#mic').hidden = false;
  $('#micBtn').hidden = true;
  $('#micLive').textContent = 'このブラウザは音声入力に対応していません。'
    + 'キーボードのマイクのキーから声で入力できます。';
  $('#micNote').hidden = true;
}

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
