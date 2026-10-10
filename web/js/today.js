// 「当日」タブ。会場では計画より実行の時間がずっと長いので、次に行く1軒だけを
// 大きく出し、結果を3択 (買えた / 売り切れ / あとで回る) で記録させる。
// todayView は値を組むだけの純粋関数 (Node で検証できる)、renderToday が DOM に書く。

import { pyRound, minToHhmm, walk } from './router.js';
import {
  STATUS, pendingQueue, countBy, delayMin, paceOf, eventDayIndex, isLiveWindow,
} from './progress.js';
import { describeStop, esc } from './stopinfo.js';

const keyOf = (s) => s.placement.groupKey;

/** 'コミックマーケット108' → 'C108'。番号が読めなければ名前をそのまま返す。 */
export function shortEvent(name) {
  const m = /(\d+)\s*$/.exec(name || '');
  return m ? `C${m[1]}` : (name || 'コミケ');
}

/**
 * いまの時刻を返す関数を作る。`?now=2026-08-15T11:20` を付けて開くと、その時刻から
 * 実際の経過時間ぶん進む時計になる (当日の画面を下見・確認するため)。
 * 形の合わない値は無視して本物の時計を使う。
 * @param {string} search location.search
 * @param {()=>number} [realNow] 現在時刻 (ミリ秒)。テスト用
 */
export function clockFrom(search, realNow = Date.now) {
  const raw = new URLSearchParams(search || '').get('now') || '';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  const base = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  // 13月や25時は Date が繰り上げてしまうので、組み直した値が書いたとおりかで弾く
  const ok = base && base.getMonth() === +m[2] - 1 && base.getDate() === +m[3]
    && base.getHours() === +m[4] && base.getMinutes() === +m[5];
  if (!ok) return () => new Date(realNow());
  const t0 = realNow();
  return () => new Date(base.getTime() + (realNow() - t0));
}

function nameOf(d) {
  return d.labels.length ? d.labels.join(' / ') : '';
}

/**
 * @param {object} o
 * @param {object|null} o.plan planRoute の結果
 * @param {Map} o.groups groupKey → 配置の配列
 * @param {Map} o.status groupKey → 'done'|'sold'|'skip'
 * @param {object} o.layout Layout
 * @param {Date} o.now
 * @param {number} o.brk 取り分けた昼食・休憩(分)
 * @param {number} o.closeMin 閉会 (分)
 * @param {string} o.event 会場データの event
 * @param {string[]} o.dates 会場データの dates
 */
export function todayView(o) {
  const nowMin = o.now.getHours() * 60 + o.now.getMinutes();
  const day = eventDayIndex(o.now, o.dates);
  const short = shortEvent(o.event);
  const base = {
    clock: minToHhmm(nowMin),
    dayLabel: day >= 0 ? `${short} ${day + 1}日目` : short,
  };
  const plan = o.plan;
  if (!plan || !plan.stops.length) return { ...base, empty: true };

  const stops = plan.stops;
  const queue = pendingQueue(stops, o.status, keyOf);
  const counts = countBy(stops, o.status, keyOf);
  const live = day >= 0 && isLiveWindow(nowMin, plan.startMin, o.closeMin);
  const plannedEnd = plan.startMin + pyRound(plan.totalMin) + o.brk;
  const head = queue[0];

  let pace = null;
  let endLabel;
  if (!head) {
    endLabel = 'おつかれさまでした';
  } else if (!live) {
    // 家で下見しているときに「300分遅れ」と出さない。当日以外は予定だけ見せる
    pace = { tone: 'plan', label: '予定' };
    endLabel = `${minToHhmm(plan.startMin)} に回りはじめて、${minToHhmm(plannedEnd)} に回り終わる予定`;
  } else if (nowMin < plan.startMin) {
    pace = { tone: 'plan', label: '開始前' };
    endLabel = `${minToHhmm(plan.startMin)} から回りはじめます（${minToHhmm(plannedEnd)} に回り終わる予定）`;
  } else {
    const delay = delayMin(nowMin, head);
    const p = paceOf(delay);
    pace = p ? { tone: p.late ? 'late' : 'ok', label: p.label } : null;
    const end = plannedEnd + Math.max(0, delay ?? 0);
    endLabel = `このペースなら ${minToHhmm(end)} に回り終わる見込み`
      + (o.brk && delay > 0 ? '（昼食・休憩を取った分も遅れに数えています）' : '');
  }

  const describe = (q) => describeStop(q.stop, o.groups, o.layout);
  let next = null;
  if (head) {
    const d = describe(head);
    const skipped = head.status === STATUS.SKIP;
    const w = head.stop.walkFromPrev;
    next = {
      key: d.key,
      no: head.index + 1,
      sym: d.block,
      hall: d.hall,
      loc: d.loc,
      name: nameOf(d),
      priority: d.priority,
      col: d.col,
      wall: d.wall,
      skipped,
      // 後回しにした1軒は、巡回順で前にあった所から歩くとは限らないので距離を出さない
      walk: skipped ? '—' : w < 0.5 ? 'すぐ' : `約${Math.round(w)}分`,
      time: head.stop.arrival,
    };
  }

  const upcoming = queue.slice(1, 4).map((q, i) => {
    const d = describe(q);
    const prev = queue[i].stop;
    // 巡回順の walkFromPrev は、途中を先に済ませると実際に歩く区間とずれるので、
    // 待ち行列で1つ前の1軒から測り直す
    const move = Math.round(walk(o.layout, prev.point, q.stop.point));
    return {
      key: d.key,
      sym: d.block,
      col: d.col,
      loc: d.loc,
      name: nameOf(d),
      time: q.stop.arrival,
      moveLabel: q.status === STATUS.SKIP ? 'あとで回る'
        : prev.point.zone !== q.stop.point.zone ? `移動${move}分` : `徒歩${move}分`,
    };
  });

  return {
    ...base,
    empty: false,
    live,
    pace,
    endLabel,
    next,
    allDone: !head,
    counts,
    progressLabel: `${counts.finished} / ${counts.total} 軒`,
    progressPct: counts.total ? Math.round((counts.finished / counts.total) * 100) : 0,
    upcoming,
  };
}

// ---------- DOM ----------

function nameHtml(name, cls) {
  return name
    ? `<div class="${cls}">${esc(name)}</div>`
    : `<div class="${cls} none">名前は未記入</div>`;
}

function nextCard(n) {
  return `<article class="td-card" aria-labelledby="tdNextLoc">
    <div class="td-card__band ${n.col}"></div>
    <div class="td-card__top">
      <div class="td-sym ${n.col}${n.wall ? ' wall' : ''}" aria-hidden="true">
        <b>${esc(n.sym)}</b><span>${esc(n.hall)}</span></div>
      <div class="td-card__main">
        <div class="td-kicker">${n.skipped ? 'あとで回る分' : '次はここ'} · ${n.no}軒目</div>
        <div class="td-loc" id="tdNextLoc">${esc(n.loc)}</div>
        ${nameHtml(n.name, 'td-name')}
        <div class="td-tags"><span class="pill ${n.col}">優先${n.priority}</span>${
  n.wall ? '<span class="td-wall">壁</span>' : ''}</div>
      </div>
    </div>
    <dl class="td-facts">
      <div><dt>歩いて</dt><dd>${esc(n.walk)}</dd></div>
      <div><dt>予定の到着</dt><dd>${esc(n.time)}</dd></div>
    </dl>
    <div class="td-acts">
      <button class="td-done" type="button" data-act="done" data-k="${esc(n.key)}"
        aria-describedby="tdNextLoc">買えた・回った</button>
      <div class="td-acts__row">
        <button class="td-sold" type="button" data-act="sold" data-k="${esc(n.key)}">売り切れだった</button>
        <button class="td-skip" type="button" data-act="skip" data-k="${esc(n.key)}">あとで回る</button>
      </div>
    </div>
  </article>`;
}

function doneCard(c) {
  return `<article class="td-card td-card--fin">
    <div class="td-fin">全部回りました</div>
    <p>${c.done}軒 買えた · ${c.sold}軒 売り切れ</p>
    <button class="btn-sub" type="button" data-act="reset">最初からやり直す</button>
  </article>`;
}

function emptyCard() {
  return `<article class="td-card td-card--fin">
    <div class="td-fin">まだ巡回順がありません</div>
    <p>行きたいサークルを書いて巡回順を組むと、ここに次の1軒が出ます。</p>
    <button class="btn-sub" type="button" data-go="list">リストを入れる</button>
  </article>`;
}

function upcomingRow(u) {
  return `<li class="td-up">
    <span class="td-up__sym ${u.col}" aria-hidden="true">${esc(u.sym)}</span>
    <div class="td-up__main"><b>${esc(u.loc)}</b>${nameHtml(u.name, 'td-up__name')}</div>
    <div class="td-up__time"><b>${esc(u.time)}</b><small>${esc(u.moveLabel)}</small></div>
  </li>`;
}

// 時計の更新 (20秒ごと) のたびにカードを書き直すと、押そうとしているボタンから
// フォーカスが飛ぶ。中身が変わったときだけ差し替える。
const drawn = new WeakMap();
function setHtml(el, html) {
  if (drawn.get(el) === html) return;
  drawn.set(el, html);
  el.innerHTML = html;
}

/** 当日タブを描き直す。root は #p-today。 */
export function renderToday(root, v) {
  const q = (s) => root.querySelector(s);
  q('#tdDay').textContent = v.dayLabel;
  q('#tdClock').textContent = v.clock;
  const pace = q('#tdPace');
  pace.hidden = !v.pace;
  if (v.pace) {
    pace.textContent = v.pace.label;
    pace.className = `td-pace ${v.pace.tone}`;
  }
  q('#tdEnd').textContent = v.empty ? '' : v.endLabel;
  setHtml(q('#tdCard'), v.empty ? emptyCard() : v.next ? nextCard(v.next) : doneCard(v.counts));
  q('#tdRest').hidden = v.empty;
  if (v.empty) return;
  q('#tdProg').textContent = v.progressLabel;
  q('#tdBar').style.width = `${v.progressPct}%`;
  setHtml(q('#tdUpcoming'), v.upcoming.map(upcomingRow).join(''));
  q('#tdNone').hidden = v.upcoming.length > 0 || v.allDone;
}
