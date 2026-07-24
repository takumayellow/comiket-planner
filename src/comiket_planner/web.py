"""セルフホスト可能な Web UI + API。

    uvicorn comiket_planner.web:app --reload

エンドポイント:
    GET  /                 フロントエンド(1枚もの)
    POST /api/plan         {text, start, start_zone, budget} -> 経路JSON + SVG
    POST /api/transcribe   音声 -> テキスト(任意。GROQ_API_KEY があるときだけ有効)

サークルDB は持たない。ユーザーが自分の行きたいリスト(ブロック記号+番号)を入れる前提。
公開デプロイの前に docs/data-sources.md の線引きを必ず確認すること。
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from .catalog import parse_line
from .layout import load_layout
from .router import plan_route
from .schematic import render

app = FastAPI(title="Comiket Route Planner", version="0.1.0")
STATIC = Path(__file__).resolve().parent / "static"


class PlanReq(BaseModel):
    text: str
    start: str = "10:30"
    start_zone: str | None = None
    budget: int | None = None


def _build_placements(text: str):
    placements = []
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        got, _prio, _label = parse_line(line)
        placements.extend(got)
    return placements


@app.get("/", response_class=HTMLResponse)
def index():
    f = STATIC / "index.html"
    return f.read_text(encoding="utf-8") if f.exists() else "<h1>index.html missing</h1>"


@app.post("/api/plan")
def api_plan(req: PlanReq):
    layout = load_layout()
    placements = _build_placements(req.text)
    plan = plan_route(placements, layout, start_zone=req.start_zone or None,
                      start_time=req.start, time_budget_min=req.budget)
    return JSONResponse({"plan": plan.as_dict(), "svg": render(layout, plan)})


@app.post("/api/transcribe")
async def api_transcribe(file: UploadFile = File(...)):
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        return JSONResponse(
            {"error": "サーバに GROQ_API_KEY が設定されていません。テキスト入力を使ってください。"},
            status_code=503)
    from openai import OpenAI
    client = OpenAI(api_key=key, base_url="https://api.groq.com/openai/v1")
    data = await file.read()
    import io
    buf = io.BytesIO(data)
    buf.name = file.filename or "audio.mp3"
    res = client.audio.transcriptions.create(
        file=buf, model=os.environ.get("GROQ_WHISPER_MODEL", "whisper-large-v3"),
        language="ja", temperature=0.0, response_format="text")
    return JSONResponse({"text": str(res)})
