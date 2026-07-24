# web — 一般公開用の静的PWA

サーバを持たない。経路計算・地図描画・保存のすべてがブラウザの中で完結する。

- **入力は端末から出ない** — localStorage にだけ残る。送信先が無い
- **圏外で動く** — Service Worker がアプリシェルを丸ごと先読みする（会場は電波が悪い）
- **APIキーを持たない** — 音声入力(ASR)は載せていない。サーバ版 `web.py` とは別物

## 構成

```
index.html            画面
app.css               デザイン（黒×赤・太ゴシック・高密度＝公式カタログ準拠）
sw.js                 オフライン用の先読みキャッシュ（VERSION を変えると更新される）
manifest.webmanifest  ホーム画面に追加したときの見え方
js/catalog.js         入力テキスト → 配置（catalog.py の移植）
js/layout.js          会場座標モデルと歩行時間（layout.py の移植）
js/router.js          巡回順の最適化（router.py の移植）
js/group.js           同じ島をまとめる／連番の畳み込み
js/map.js             概略図の SVG 生成
js/app.js             画面まわり
js/layout-data.js     自動生成（scripts/build_web_data.py）
```

`package.json` は Node から ESM として読むためだけのもので、配信物には含めない
（`.vercelignore`）。

## 再生成と検証

```bash
python scripts/build_web_data.py     # data/layout/c108.json → js/layout-data.js

# JS 移植が Python 実装と同じ経路を返すことの確認（差分ゼロが正常）
python scripts/check_web_parity.py > /tmp/py.json
node   scripts/check_web_parity.mjs > /tmp/js.json
diff /tmp/py.json /tmp/js.json
```

ローカル確認は `python -m http.server 8777` を `web/` で。Service Worker は
`http://127.0.0.1` なら安全なオリジンとして扱われるので、オフライン動作もそのまま試せる。

## 公開してよいものの線引き

`docs/data-sources.md` を必ず読むこと。ここに置いてよいのは**自前で組んだ座標モデル**だけ。
公式の折込地図画像・カタログ紙面・サークル名のデータベースは置かない。
