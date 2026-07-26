// 会場(東京ビッグサイト)は電波が非常に悪い。一度開いたら通信なしで完全に動くよう、
// アプリシェルを丸ごと先読みキャッシュする。計算はもともと端末内で完結する。

// VERSION は手で書かない。scripts/stamp_sw_version.py が ASSETS 実体のハッシュから
// 打ち直す (手動運用だと JS だけ直したときに install が発火せず古い版が residue する)。
const VERSION = 'cp-280e6cf2dca3';
// './index.html' は入れない。Vercel の cleanUrls が /index.html → / に 308 する結果
// リダイレクト済みレスポンスになり、Cache.put が TypeError を投げて install ごと失敗する
// (= オフラインが一切効かなくなる)。シェルは './' だけを持つ。
const ASSETS = [
  './',
  './app.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/layout.js',
  './js/layout-data.js',
  './js/catalog.js',
  './js/freeform.js',
  './js/voice.js',
  './js/group.js',
  './js/router.js',
  './js/map.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// 先読みしたものと同じ URL だけを実行時キャッシュの対象にする
// (任意の ?クエリ付き URL を無制限に溜め込まないため)
const ALLOW = new Set(ASSETS.map((a) => new URL(a, self.location).href));

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // 画面遷移はキャッシュ済みシェルを最優先で返す(圏外でも必ず開く)
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./').then((hit) => hit || fetch(req)),
    );
    return;
  }

  if (!ALLOW.has(new URL(req.url).href)) return;   // それ以外は素通し

  // stale-while-revalidate: 手元のキャッシュを即返しつつ裏で更新する。
  // VERSION の上げ忘れで古い JS を永久に配り続ける事故を防ぐ。
  e.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => {
        if (!res.ok) return res;
        const copy = res.clone();
        return caches.open(VERSION).then((c) => c.put(req, copy)).then(() => res);
      });
      if (!hit) return fresh;
      // キャッシュを即返し、更新は裏で。圏外なら fetch は失敗するので握り潰す
      e.waitUntil(fresh.catch(() => {}));
      return hit;
    }),
  );
});
