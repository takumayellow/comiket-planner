#!/usr/bin/env python3
"""コミケのサークル読み上げボイスメモを、タイムスタンプ付きで文字起こしする。

汎用の講義向け文字起こしだと「西地区な21a」のような配置表記が崩れるため、
- ドメイン語彙を Whisper の prompt に与える
- 短いチャンク (既定 45s) に切って temperature=0 で回す
- verbose_json でセグメント単位のタイムスタンプを残す
- 同じ音声に対し複数パス (prompt 有り / 無し) を回して突き合わせられるようにする
という構成にしている。

Usage:
    python scripts/transcribe_memo.py <audio> --out .local/raw/memo --passes primed,plain
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path

from openai import OpenAI

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GROQ_MODEL = os.environ.get("GROQ_WHISPER_MODEL", "whisper-large-v3")

# Whisper の prompt は 224 token 程度で切られるので、効きそうな語彙だけを詰める。
COMIKET_PROMPT = (
    "コミックマーケットのサークル配置の読み上げメモ。"
    "東地区・西地区・南地区、ブロック記号はひらがな一文字またはアルファベット一文字、"
    "そのあとに二桁の数字と a か b が続く。"
    "例: 西地区な21a、西地区め36b、東地区H07a、東地区A13b、南地区ア05a。"
    "ジャンル: プロジェクトセカイ、ホロライブ、ブルーアーカイブ、艦隊これくしょん、"
    "崩壊スターレイル、五等分の花嫁、カードキャプターさくら、"
    "小林さんちのメイドラゴン、トリニティ、東方、アイドルマスター、成人向け。"
)

PASS_PROMPTS = {
    "primed": COMIKET_PROMPT,
    "plain": None,
}


@dataclass
class Segment:
    start: float
    end: float
    text: str


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def split_audio(path: Path, out_dir: Path, chunk_sec: int, overlap_sec: int) -> list[tuple[float, Path]]:
    """(チャンク開始秒, ファイル) のリストを返す。overlap は境界での取りこぼし対策。"""
    duration = probe_duration(path)
    chunks: list[tuple[float, Path]] = []
    start = 0.0
    idx = 0
    while start < duration:
        dst = out_dir / f"chunk_{idx:03d}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-ss", f"{start:.2f}", "-t", f"{chunk_sec + overlap_sec}",
             "-i", str(path), "-ac", "1", "-ar", "16000", "-b:a", "64k", str(dst)],
            check=True,
        )
        if dst.exists() and dst.stat().st_size > 2000:
            chunks.append((start, dst))
        start += chunk_sec
        idx += 1
    return chunks


def transcribe_chunk(client: OpenAI, path: Path, prompt: str | None) -> list[Segment]:
    kwargs = dict(model=GROQ_MODEL, language="ja", temperature=0.0,
                  response_format="verbose_json")
    if prompt:
        kwargs["prompt"] = prompt
    with open(path, "rb") as f:
        res = client.audio.transcriptions.create(file=f, **kwargs)
    data = res if isinstance(res, dict) else res.model_dump()
    segs = data.get("segments") or []
    if not segs:
        text = (data.get("text") or "").strip()
        return [Segment(0.0, 0.0, text)] if text else []
    return [Segment(float(s["start"]), float(s["end"]), s["text"].strip())
            for s in segs if s.get("text", "").strip()]


def run_pass(client: OpenAI, chunks: list[tuple[float, Path]], prompt: str | None,
             label: str) -> list[Segment]:
    all_segs: list[Segment] = []
    for i, (offset, chunk_path) in enumerate(chunks, 1):
        print(f"  [{label}] チャンク {i}/{len(chunks)} (t={offset:.0f}s)", flush=True)
        try:
            segs = transcribe_chunk(client, chunk_path, prompt)
        except Exception as exc:  # チャンク単位で落としても全体は続行する
            print(f"    ! 失敗: {exc}", file=sys.stderr)
            continue
        for s in segs:
            all_segs.append(Segment(offset + s.start, offset + s.end, s.text))
    return all_segs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--out", default=".local/raw/memo", help="出力プレフィックス")
    ap.add_argument("--chunk-sec", type=int, default=45)
    ap.add_argument("--overlap-sec", type=int, default=3)
    ap.add_argument("--passes", default="primed,plain")
    ap.add_argument("--env", default="C:/Users/takum/dev/tus-tools/.env")
    args = ap.parse_args()

    env_path = Path(args.env)
    if env_path.exists():
        from dotenv import load_dotenv
        load_dotenv(env_path)

    key = os.environ.get("GROQ_API_KEY")
    if not key:
        print("GROQ_API_KEY が無い", file=sys.stderr)
        return 1
    client = OpenAI(api_key=key, base_url=GROQ_BASE_URL)

    audio = Path(args.audio)
    out_prefix = Path(args.out)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    print(f"音声: {audio.name} ({probe_duration(audio):.0f}s)")
    with tempfile.TemporaryDirectory() as tmp:
        chunks = split_audio(audio, Path(tmp), args.chunk_sec, args.overlap_sec)
        print(f"{len(chunks)} チャンクに分割 (各 {args.chunk_sec}s + {args.overlap_sec}s overlap)")

        for label in [p.strip() for p in args.passes.split(",") if p.strip()]:
            if label not in PASS_PROMPTS:
                print(f"未知のパス: {label}", file=sys.stderr)
                continue
            segs = run_pass(client, chunks, PASS_PROMPTS[label], label)
            json_path = out_prefix.with_name(f"{out_prefix.name}.{label}.json")
            txt_path = out_prefix.with_name(f"{out_prefix.name}.{label}.txt")
            json_path.write_text(
                json.dumps([asdict(s) for s in segs], ensure_ascii=False, indent=2),
                encoding="utf-8")
            txt_path.write_text(
                "\n".join(f"[{int(s.start)//60:02d}:{int(s.start)%60:02d}] {s.text}" for s in segs),
                encoding="utf-8")
            print(f"→ {txt_path} ({len(segs)} セグメント)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
