// 画面下に一瞬出す知らせ。消し込みは指が滑って押し間違えやすいので、
// 記録を変えたときは必ず「取り消す」を添える。
// 読み上げ用の live region は出し入れせず常に置いておき、文言だけ差し替える
// (hidden から出した瞬間に書いた文は読まれないことがある)。

const SHOW_MS = 2600;
const UNDO_MS = 5000;   // 取り消しがあるときは押す余裕を残す

export function createToast(root) {
  const msg = root.querySelector('#toastMsg');
  const undo = root.querySelector('#toastUndo');
  let timer = null;
  let onUndo = null;
  let held = false;   // ボタンにフォーカスがある間は消さない

  function hide() {
    clearTimeout(timer);
    root.classList.remove('on');
    undo.hidden = true;
    msg.textContent = '';
    onUndo = null;
  }

  function arm() {
    clearTimeout(timer);
    if (!held) timer = setTimeout(hide, onUndo ? UNDO_MS : SHOW_MS);
  }

  undo.addEventListener('click', () => {
    const fn = onUndo;
    held = false;
    hide();
    fn?.();
  });
  undo.addEventListener('focus', () => { held = true; clearTimeout(timer); });
  undo.addEventListener('blur', () => { held = false; if (root.classList.contains('on')) arm(); });

  /** @param {string} text @param {(()=>void)|null} [undoFn] */
  function show(text, undoFn = null) {
    msg.textContent = text;
    onUndo = undoFn;
    undo.hidden = !undoFn;
    root.classList.add('on');
    arm();
  }

  hide();
  return { show, hide };
}
