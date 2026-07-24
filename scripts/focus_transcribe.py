#!/usr/bin/env python3
"""指定した時間窓だけを、音声処理を変えた複数バリアントで文字起こしして突き合わせる。

ボイスメモに BGM (実況動画) が被っていて、ブロック記号や番号が 1 パスでは確定しない。
短い窓に絞り、raw / denoise / slow の 3 バリアントを回して、一致度を人間 (と Claude) が
判断できる形で出す。多数決で自動確定はしない — 誤った確定は「行けなかった」に直結するため。

Usage:
    python scripts/focus_transcribe.py <audio> --windows windows.json --out .local/out/focus.json
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from openai import OpenAI

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GROQ_MODEL = os.environ.get("GROQ_WHISPER_MODEL", "whisper-large-v3")

# prompt を効かせすぎるとプロンプト文がそのまま出力に漏れる (実測済) ので、
# バリアントごとに強さを変える。
LIGHT_PROMPT = "コミケのサークル配置メモ。ブロック記号と番号。例: な13、め37、H07、ア86、エ02。"

VARIANTS = {
    # name: (ffmpeg audio filter, prompt)
    "raw":     (None, None),
    "clean":   ("afftdn=nf=-25,highpass=f=120,lowpass=f=6000,dynaudnorm", None),
    "slow":    ("atempo=0.8", LIGHT_PROMPT),
}

# 西地区/東地区で実際に存在するブロック記号だけを列挙した prompt。
# 「西地区の R36」のように存在しない記号に化けたときの矯正用。
WEST_BLOCKS = "".join("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめ")
EAST_BLOCKS = "ア イ ウ エ オ カ キ ク ケ コ サ シ ス セ ソ タ チ ツ テ ト ナ ニ ヌ ネ ノ ハ ヒ フ ヘ ホ マ ミ ム メ モ ヤ ユ ヨ"

EXTRA_VARIANTS = {
    "west_primed": (None, f"西地区のブロック記号は次のいずれか一文字: {WEST_BLOCKS}。その後に番号が続く。"),
    "slow6":       ("atempo=0.65", None),
    "boost":       ("highpass=f=150,lowpass=f=5000,dynaudnorm=f=75:g=25,volume=3", None),
}


def cut(audio: Path, start: float, end: float, dst: Path, afilter: str | None) -> None:
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.2f}",
           "-to", f"{end:.2f}", "-i", str(audio)]
    if afilter:
        cmd += ["-af", afilter]
    cmd += ["-ac", "1", "-ar", "16000", "-b:a", "96k", str(dst)]
    subprocess.run(cmd, check=True)


def transcribe(client: OpenAI, path: Path, prompt: str | None) -> str:
    kwargs = dict(model=GROQ_MODEL, language="ja", temperature=0.0,
                  response_format="text")
    if prompt:
        kwargs["prompt"] = prompt
    with open(path, "rb") as f:
        res = client.audio.transcriptions.create(file=f, **kwargs)
    return (res if isinstance(res, str) else str(res)).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--windows", required=True, help="[{id,start,end,note}] の JSON")
    ap.add_argument("--out", default=".local/out/focus.json")
    ap.add_argument("--env", default="C:/Users/takum/dev/tus-tools/.env")
    ap.add_argument("--extra", action="store_true",
                    help="ブロック記号を絞った prompt など追加バリアントも回す")
    args = ap.parse_args()

    variants = dict(VARIANTS)
    if args.extra:
        variants.update(EXTRA_VARIANTS)

    if Path(args.env).exists():
        from dotenv import load_dotenv
        load_dotenv(args.env)
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        print("GROQ_API_KEY が無い", file=sys.stderr)
        return 1
    client = OpenAI(api_key=key, base_url=GROQ_BASE_URL)

    windows = json.loads(Path(args.windows).read_text(encoding="utf-8"))
    audio = Path(args.audio)
    results = []

    with tempfile.TemporaryDirectory() as tmp:
        for w in windows:
            entry = {"id": w["id"], "start": w["start"], "end": w["end"],
                     "note": w.get("note", ""), "variants": {}}
            print(f"[{w['id']}] {w['start']}-{w['end']}s {w.get('note','')}", flush=True)
            for vname, (afilter, prompt) in variants.items():
                dst = Path(tmp) / f"{w['id']}_{vname}.mp3"
                try:
                    cut(audio, w["start"], w["end"], dst, afilter)
                    text = transcribe(client, dst, prompt)
                except Exception as exc:
                    text = f"<ERROR: {exc}>"
                entry["variants"][vname] = text
                print(f"   {vname:6s}: {text}", flush=True)
            results.append(entry)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n→ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
