// 音声入力。ブラウザ内蔵の Web Speech API だけを使う (API キーもサーバも持たない)。
//
// 会場で使うことを考えると外部サービスへの録音アップロードは現実的でない
// (圏外・遅い・鍵の管理)。内蔵の認識ならボタン1つで済む。ただし実装によっては
// 音声がブラウザ提供元のサーバへ送られる — 画面上でそれを明示すること。
//
// 認識は黙っていると勝手に止まる (no-speech / 一定時間の無音)。「止める」を押すまでは
// こちらで再起動して録りっぱなしに見せる。

const Impl = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

export function isSupported() {
  return !!Impl;
}

/**
 * @param {{onFinal:(t:string)=>void, onInterim:(t:string)=>void,
 *          onState:(s:'on'|'off')=>void, onError:(msg:string)=>void}} cb
 */
export function createRecorder(cb) {
  let rec = null;
  let want = false;

  const ERRORS = {
    'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定で許可してください。',
    'service-not-allowed': 'このブラウザでは音声認識が使えませんでした。',
    'audio-capture': 'マイクが見つかりませんでした。',
    network: '音声認識がネットワークに繋がりませんでした。圏外だとこの機能だけ使えません。',
  };

  function build() {
    const r = new Impl();
    r.lang = 'ja-JP';
    r.continuous = true;
    r.interimResults = true;

    r.addEventListener('result', (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) cb.onFinal(t.trim());
        else interim += t;
      }
      cb.onInterim(interim.trim());
    });

    r.addEventListener('error', (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;  // 無音は失敗ではない
      want = false;
      cb.onError(ERRORS[e.error] || `音声認識でエラーが起きました (${e.error})`);
      cb.onState('off');
    });

    // 無音で勝手に終わるので、止めたつもりがないなら黙って掛け直す
    r.addEventListener('end', () => {
      cb.onInterim('');
      if (!want) { cb.onState('off'); return; }
      try {
        r.start();
      } catch {
        want = false;
        cb.onState('off');
      }
    });
    return r;
  }

  return {
    start() {
      if (want) return;
      want = true;
      rec = rec || build();
      try {
        rec.start();
        cb.onState('on');
      } catch {
        want = false;
        cb.onError('音声入力を開始できませんでした。');
        cb.onState('off');
      }
    },
    stop() {
      want = false;
      cb.onInterim('');
      try { rec?.stop(); } catch { /* 停止済み */ }
      cb.onState('off');
    },
    get active() { return want; },
  };
}
