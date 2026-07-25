// 音声入力。ブラウザ内蔵の Web Speech API だけを使う (API キーもサーバも持たない)。
//
// 会場で使うことを考えると外部サービスへの録音アップロードは現実的でない
// (圏外・遅い・鍵の管理)。内蔵の認識ならボタン1つで済む。
//
// 認識には2つの経路がある:
//   端末内 (processLocally) … Chrome 138+ の on-device 認識。音声が外へ出ない。
//                             言語モデルの初回ダウンロードが要る。
//   クラウド                … 従来どおり。音声がブラウザ提供元のサーバへ送られる。
// 端末内が使えるならそちらを優先する。ここが成功すると「圏外では使えない」制約と
// 「音声が外へ出る」注意書きの両方が消える。どちらで動いているかは必ず画面に出す。
//
// 認識は黙っていると勝手に止まる (no-speech / 一定時間の無音)。「止める」を押すまでは
// こちらで再起動して録りっぱなしに見せる。

const Impl = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
const LANG = 'ja-JP';

export function isSupported() {
  return !!Impl;
}

/** モデルの用意はせず、今この場で端末内認識が使えるかだけを見る。
 *  ページを開いた時点の注意書きを正しくするために使う (押す前でも分かる)。 */
export async function localReady() {
  if (!Impl || typeof Impl.available !== 'function') return false;
  try {
    return await Impl.available({ langs: [LANG], processLocally: true }) === 'available';
  } catch {
    return false;
  }
}

/** 端末内認識が使えるか調べ、必要ならモデルの用意まで済ませる。
 *  未対応ブラウザでは静かに false を返す (クラウド経路へ落ちるだけ)。
 *  install() はユーザー操作の延長でしか通らないことがあるので、マイクを押した
 *  タイミングから呼ぶこと。 */
export async function prepareLocal() {
  if (!Impl || typeof Impl.available !== 'function') return false;
  const q = { langs: [LANG], processLocally: true };
  try {
    let st = await Impl.available(q);
    if (st === 'available') return true;
    if (st === 'unavailable') return false;
    if (typeof Impl.install !== 'function') return false;
    await Impl.install(q);                 // 戻り値の型が実装で揺れるので状態で見る
    st = await Impl.available(q);
    return st === 'available';
  } catch {
    return false;                          // 判定できないならクラウドで動かす
  }
}

/**
 * @param {{onFinal:(t:string)=>void, onInterim:(t:string)=>void,
 *          onState:(s:'on'|'off')=>void, onError:(msg:string)=>void,
 *          onMode?:(m:'local'|'cloud')=>void}} cb
 */
export function createRecorder(cb) {
  let rec = null;
  let want = false;       // ユーザーが「録音中」にしているか
  let running = false;    // 認識エンジンが実際に動いているか (want とは別物)
  let retries = 0;        // 何も聞き取れないまま掛け直した回数
  let netFails = 0;       // network エラーで落ちた回数
  let local = false;      // 端末内認識で動いているか
  let probed = false;     // 端末内が使えるか調べたか (調べるのは1回でいい)
  let timer = null;
  let pending = '';       // まだ確定(isFinal)していない聞き取り中の文字

  const RETRY_LIMIT = 12;               // 無音で終わり続けるときの打ち切り
  const NET_RETRY = 2;                  // 一時的な切断は黙って掛け直す回数
  const retryDelay = () => (retries < 3 ? 250 : 1000);

  const ERRORS = {
    'not-allowed': 'マイクの使用が許可されていません。'
      + 'アドレスバーのマイクのアイコンから許可してください。',
    'service-not-allowed': 'このブラウザでは音声認識が使えませんでした。'
      + 'テキストで入力してください。',
    'audio-capture': 'マイクが見つかりませんでした。'
      + '端末にマイクがあるか、他のアプリが使っていないか確認してください。',
    'language-not-supported': 'このブラウザは日本語の音声認識に対応していません。',
  };

  // network だけは文面を分ける。原因が端末ではなく通信側にあることと、
  // 打ち込みに切り替えれば作業を続けられることを書く。
  const NET_MSG = '音声認識サーバに接続できませんでした。'
    + 'この機能だけは通信が要ります（圏内で試すか、テキストで入力してください）。';

  function build() {
    const r = new Impl();
    r.lang = LANG;
    r.continuous = true;
    r.interimResults = true;
    // 対応していないブラウザでは代入が無視されるだけ (例外にはならない)
    try { r.processLocally = local; } catch { /* 未対応 */ }

    r.addEventListener('start', () => { running = true; });

    r.addEventListener('result', (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) cb.onFinal(t.trim());
        else interim += t;
      }
      retries = 0;                       // 聞き取れているので掛け直しの数え直し
      netFails = 0;
      // 端末内認識やスマホでは、聞き取った語を isFinal=true に昇格させないまま
      // 認識を打ち切ることがある(no-speech / 発話区切り)。その取りこぼしを防ぐため、
      // 未確定の interim を覚えておき、end 時に確定として拾う。
      pending = interim.trim();
      cb.onInterim(pending);
    });

    r.addEventListener('error', (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;  // 無音は失敗ではない
      // 通信の一時的な失敗は珍しくない。数回は黙って掛け直してから諦める
      if (e.error === 'network' && want && netFails < NET_RETRY) {
        netFails += 1;
        rec = null;                      // 壊れた認識器は捨てて作り直す
        return;                          // 続きは end で
      }
      want = false;
      cb.onError(e.error === 'network' ? NET_MSG
        : ERRORS[e.error] || `音声認識でエラーが起きました (${e.error})`);
      cb.onState('off');
    });

    // 無音で勝手に終わるので、止めたつもりがないなら黙って掛け直す。
    // start() を即座に呼ぶと「まだ止まりきっていない」ことがあり InvalidStateError に
    // なるので、必ず間を空けて begin() 経由で入り直す。
    r.addEventListener('end', () => {
      running = false;
      // isFinal を待たずに切れても、聞き取り中だった語は捨てずに確定させる。
      // (これが無いと「喋ったのに何も入らない」= 音声入力が反映されない、になる)
      if (pending) { cb.onFinal(pending); pending = ''; }
      cb.onInterim('');
      if (!want) { cb.onState('off'); return; }
      if (retries >= RETRY_LIMIT) {
        want = false;
        cb.onError('音声を聞き取れませんでした。もう一度押してください。');
        cb.onState('off');
        return;
      }
      retries += 1;
      timer = setTimeout(begin, netFails ? 1200 : retryDelay());
    });
    return r;
  }

  // 実際に認識を開始する。二重 start は InvalidStateError になるので running で防ぐ。
  function begin() {
    timer = null;
    if (!want || running) return;
    rec = rec || build();
    try {
      rec.start();
      cb.onState('on');
    } catch {
      want = false;
      cb.onError('音声入力を開始できませんでした。');
      cb.onState('off');
    }
  }

  return {
    async start() {
      if (want) return;
      want = true;
      retries = 0;
      netFails = 0;
      // 端末内認識の可否は初回だけ調べる。判定を待つ間に押し直されることがあるので、
      // 待った後に want が下りていないかを見てから始める。
      if (!probed) {
        probed = true;
        local = await prepareLocal();
        cb.onMode?.(local ? 'local' : 'cloud');
        if (!want) return;
      }
      // 直前の stop() の end がまだ来ていない場合は、その end 側で入り直す
      if (running) { cb.onState('on'); return; }
      begin();
    },
    stop() {
      want = false;
      clearTimeout(timer);
      timer = null;
      cb.onInterim('');
      try { rec?.stop(); } catch { /* 停止済み */ }
      cb.onState('off');
    },
    get active() { return want; },
    get isLocal() { return local; },
  };
}
