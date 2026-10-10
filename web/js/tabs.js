// 画面下のタブ (当日 / 巡回 / 地図 / リスト)。WAI-ARIA の tabs パターンに沿って、
// タブ間は矢印キーで移り、Tab キーは選ばれているタブにだけ止まる。

const THEME = { today: '#86ccef', other: '#e8f5fd' };   // 当日だけ見出しが空色

/**
 * @param {object} [opt]
 * @param {(name:string)=>void} [opt.onShow] タブを開いた直後に呼ぶ (描き直し用)
 */
export function createTabs({ onShow } = {}) {
  const tabs = [...document.querySelectorAll('.tabbar [role="tab"]')];
  const theme = document.querySelector('meta[name="theme-color"]');
  const scroll = new Map();   // タブごとのスクロール位置。戻ったとき読んでいた所に戻す
  let current = null;

  function show(name, { focus = false } = {}) {
    if (!tabs.some((t) => t.dataset.tab === name)) return;
    if (current) scroll.set(current, window.scrollY);
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    }
    if (theme) theme.content = name === 'today' ? THEME.today : THEME.other;
    const changed = current !== name;
    current = name;
    onShow?.(name);
    if (changed) window.scrollTo(0, scroll.get(name) || 0);
  }

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t.dataset.tab));
    t.addEventListener('keydown', (ev) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
      let j = null;
      if (step) j = (i + step + tabs.length) % tabs.length;
      else if (ev.key === 'Home') j = 0;
      else if (ev.key === 'End') j = tabs.length - 1;
      if (j == null) return;
      ev.preventDefault();
      show(tabs[j].dataset.tab, { focus: true });
    });
  });

  // 本文中の「リストを入れる」などの導線
  document.addEventListener('click', (ev) => {
    const go = ev.target.closest('[data-go]');
    if (go) show(go.dataset.go, { focus: true });
  });

  return {
    show,
    get current() { return current; },
  };
}
