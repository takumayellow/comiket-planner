#!/usr/bin/env bash
# C108 の公式一次データを各自の手元に取得する。
# これらは個人利用のダウンロード物であり、このリポジトリには同梱しない
# （data/official/ は .gitignore 済み）。詳細は docs/data-sources.md。
set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/data/official"
mkdir -p "$DEST"

BASE="https://www.comiket.co.jp/info-a/C108"

echo "折込地図PDF と ホール別ジャンル配置を $DEST に取得します"
echo "URL が変わっている場合は公式サイト https://www.comiket.co.jp/ で最新を確認してください"

# 折込地図（例。実際のファイル名は開催回ごとに変わる）
for f in C108Map_e123_B4.pdf C108Map_e7_B4.pdf C108Map_w12_B4.pdf C108Map_s12_B4.pdf; do
  echo "  - $f"
  curl -fsSL "$BASE/map/$f" -o "$DEST/$f" || echo "    (取得失敗: 公式でURLを確認)"
done

# ホール別ジャンル配置（ISO-2022-JP で配信されることがある）
curl -fsSL "$BASE/C108Genre.html" -o "$DEST/C108genre_raw.html" \
  || echo "  (ジャンル表の取得失敗: 公式でURLを確認)"

echo "完了。scripts/build_layout.py はここから読んだ『事実』のみを c108.json に変換します。"
