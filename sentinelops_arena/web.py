"""Sentry Loop's local web application and simulation API."""

from __future__ import annotations

import csv
import logging
import math
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from threading import RLock
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from sentinelops_arena.demo import run_episode
from sentinelops_arena.environment import SentinelOpsArena
from sentinelops_arena.metrics import compute_episode_metrics
from sentinelops_arena.scorecard import compute_scorecard
from sentinelops_arena.connections import status as connection_status, check_accounts
from sentinelops_arena.live import evaluate
from sentinelops_arena.learning import train_policy, load_checkpoint
from sentinelops_arena.runs import Busy, RunManager, RunStore
from sentinelops_arena.settings import setting
from sentinelops_arena.telemetry import (
    list_training,
    read_run,
    training_dir,
    publish_training,
)

PACKAGE = Path(__file__).resolve().parent
UI = PACKAGE / "ui"
MAX_SEED = 2**31 - 1
# reset() seeds the legacy simulator's process-wide random generator. Serialize
# complete runs, including snapshots, so simultaneous requests cannot mix seeds.
SIMULATION_LOCK = RLock()
LOGGER = logging.getLogger(__name__)
PRESETS = [
    {"seed": seed, "label": label}
    for seed, label in [
        (42, "Balanced attack mix"),
        (7, "Heavy schema drift"),
        (123, "Social engineering barrage"),
        (256, "Rate limit stress"),
        (999, "Policy drift cascade"),
        (1337, "Early aggression"),
        (2024, "Late-game attacks"),
        (555, "Mixed multi-system"),
    ]
]


class SeedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seed: Annotated[int, Field(strict=True, ge=0, le=MAX_SEED)] = 42


class EpisodeRequest(SeedRequest):
    policy: Literal["baseline", "resilient"] = "baseline"


class LiveRequest(SeedRequest):
    target: Literal["local", "tenki"] = "local"
    agent: Literal["scripted", "openai", "trained"] = "scripted"
    policy: Literal["guarded", "unguarded"] = "guarded"
    comparison: bool = False
    checkpoint_id: str | None = None


class TrainingRequest(SeedRequest):
    steps: Annotated[int, Field(strict=True, ge=10, le=200)] = 80


class ReplayPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step: Annotated[int, Field(strict=True, ge=1, le=1000)]
    reward: Annotated[float, Field(ge=-100000, le=100000)]
    loss: Annotated[float, Field(ge=-100000, le=100000)]
    kl: Annotated[float, Field(ge=0, le=100)]
    mean_length: Annotated[float, Field(ge=0, le=1000)]


class ReplayAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent: Annotated[str, Field(max_length=24)]
    action: Annotated[str, Field(max_length=80)]
    status: Annotated[str, Field(max_length=40)]
    reward: Annotated[float, Field(ge=-100000, le=100000)]


class ReplaySync(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["sentry-loop-arena-sync"]
    version: Literal[1]
    seed: Annotated[int, Field(strict=True, ge=0, le=MAX_SEED)]
    policy: Literal["baseline", "resilient"]
    cursor: Annotated[int, Field(strict=True, ge=-1, le=999)]
    totalActions: Annotated[int, Field(strict=True, ge=1, le=1000)]
    tick: Annotated[int, Field(strict=True, ge=0, le=1000)]
    current: ReplayAction | None = None
    points: Annotated[list[ReplayPoint], Field(max_length=1000)]


STORE = RunStore()
RUNNER = RunManager(STORE)
REPLAY_SYNC: dict[str, tuple[float, dict]] = {}
REPLAY_SYNC_LOCK = RLock()
REPLAY_CHANNEL = re.compile(r"^[a-f0-9-]{32,64}$")


def replay_configuration() -> dict:
    """Return only public, operator-configured replay locations."""
    space = setting("SENTRY_TRAINING_REPLAY_SPACE")
    return {
        "url": setting(
            "SENTRY_TRAINING_REPLAY_URL",
            f"https://huggingface.co/spaces/{space}" if space else "",
        ),
        "app_origin": setting("SENTRY_TRAINING_REPLAY_ORIGIN"),
    }


@asynccontextmanager
async def lifespan(_app):
    RUNNER.recover()
    yield
    for run_id in list(RUNNER.active):
        RUNNER.cancel(run_id)


def require_control(request: Request):
    # A public demo can expose receipts without exposing paid job controls.
    public = bool(setting("SPACE_ID") or setting("SENTRY_PUBLIC") == "1")
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
        # Reverse proxies may report http internally while serving https.
        from urllib.parse import urlsplit

        if urlsplit(origin).netloc != request.headers.get("host"):
            raise HTTPException(403, "Start runs from the Sentry Loop app.")
    if public:
        token = setting("SENTRY_CONTROL_TOKEN")
        supplied = request.headers.get("x-sentry-token", "")
        if not token or not secrets.compare_digest(token, supplied):
            raise HTTPException(
                401, "Unlock run controls in Connections using the demo control token."
            )


def find_run(run_id: str) -> dict:
    try:
        return STORE.get(run_id)
    except KeyError as error:
        raise HTTPException(404, "Run not found.") from error


def find_training(run_id: str) -> dict:
    try:
        return read_run(run_id)
    except KeyError as error:
        raise HTTPException(404, "Training run not found.") from error


def simulate(seed: int, policy: str) -> dict:
    log, scores = run_episode(
        seed=seed,
        trained=policy == "resilient",
        include_details=True,
    )
    return {
        "seed": seed,
        "policy": policy,
        "policy_type": "heuristic",
        "ticks": 30,
        "log": log,
        "scores": scores,
        "scorecard": compute_scorecard(log),
        "legacy": compute_episode_metrics(log),
        "notes": [
            "Final scores include downstream rewards not assigned to a replay action.",
            "Scorecard outcomes use the episode log and ground truth.",
        ],
    }


def metrics_path() -> Path:
    return Path(
        os.environ.get(
            "SENTRY_METRICS_PATH",
            str(PACKAGE.parent / "training" / "grpo_metrics.csv"),
        )
    )


def read_training() -> dict:
    columns = (
        "step",
        "reward",
        "reward_std",
        "loss",
        "kl",
        "mean_length",
        "min_length",
        "max_length",
        "clipped_ratio",
        "format_exact",
        "format_approx",
        "check_action",
        "check_env",
    )
    try:
        with metrics_path().open(newline="", encoding="utf-8-sig") as source:
            reader = csv.DictReader(source)
            if not set(columns).issubset(reader.fieldnames or []):
                raise ValueError("Missing metric columns")
            rows = [
                {column: float(row[column]) for column in columns} for row in reader
            ]
        if not rows or any(not math.isfinite(v) for row in rows for v in row.values()):
            raise ValueError("Empty or non-finite metrics")
        if any(row["step"] < 1 or not row["step"].is_integer() for row in rows):
            raise ValueError("Invalid training steps")
        rows.sort(key=lambda row: row["step"])
        if len({row["step"] for row in rows}) != len(rows):
            raise ValueError("Duplicate training steps")
        for row in rows:
            row["step"] = int(row["step"])
    except (OSError, ValueError, TypeError, KeyError, csv.Error) as error:
        LOGGER.warning("Training metrics unavailable: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Training metrics are unavailable. Restore training/grpo_metrics.csv or set SENTRY_METRICS_PATH to a valid metrics file.",
        ) from error
    return {
        "rows": rows,
        "metadata": {
            "model": os.environ.get("SENTRY_TRAINING_MODEL", "Qwen2.5-1.5B-Instruct"),
            "agent": "Worker",
            "algorithm": "GRPO",
            "lora_rank": 64,
            "generations": 8,
            "recorded": True,
            "weights": {
                "format_exact": 0.3,
                "format_approx": 0.2,
                "check_action": 0.5,
                "check_env": 1.0,
            },
        },
    }


app = FastAPI(
    title="Sentry Loop",
    version="0.3.0",
    docs_url="/api/docs",
    lifespan=lifespan,
    redoc_url=None,
    openapi_url="/api/openapi.json",
)
app.mount("/assets", StaticFiles(directory=UI), name="assets")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "name": "Sentry Loop",
        "mode": "arena",
        "engine": "OpenEnv",
        "agents": ["attacker", "worker", "oversight"],
        "active_jobs": len(RUNNER.active),
    }


@app.get("/api/config")
def configuration():
    return {
        "presets": PRESETS,
        "max_seed": MAX_SEED,
        "ticks": 30,
        "policies": ["baseline", "resilient"],
        "connections": connection_status(),
        "training_replay": replay_configuration(),
        "source_url": setting("SENTRY_SOURCE_URL"),
    }


def valid_replay_channel(channel: str):
    if not REPLAY_CHANNEL.fullmatch(channel):
        raise HTTPException(404, "Replay channel not found.")


@app.post("/api/replay-sync/{channel}")
def publish_replay_sync(channel: str, payload: ReplaySync, request: Request):
    valid_replay_channel(channel)
    origin = request.headers.get("origin")
    if origin:
        from urllib.parse import urlsplit

        if urlsplit(origin).netloc != request.headers.get("host"):
            raise HTTPException(403, "Publish replay state from the Arena.")
    now = time.monotonic()
    with REPLAY_SYNC_LOCK:
        for key, (updated, _value) in list(REPLAY_SYNC.items()):
            if now - updated > 900:
                del REPLAY_SYNC[key]
        REPLAY_SYNC[channel] = (now, jsonable_encoder(payload))
    return {"ok": True}


@app.get("/api/replay-sync/{channel}")
def read_replay_sync(channel: str):
    valid_replay_channel(channel)
    replay_origin = replay_configuration()["app_origin"]
    if not replay_origin:
        raise HTTPException(404, "Training replay synchronization is not configured.")
    with REPLAY_SYNC_LOCK:
        item = REPLAY_SYNC.get(channel)
    if not item or time.monotonic() - item[0] > 900:
        raise HTTPException(404, "Replay channel not found.")
    return JSONResponse(
        item[1],
        headers={
            "Access-Control-Allow-Origin": replay_origin,
            "Cache-Control": "no-store",
            "Vary": "Origin",
        },
    )


@app.get("/api/connections")
def connections():
    return connection_status()


@app.post("/api/connections/check", dependencies=[Depends(require_control)])
def verify_connections():
    return check_accounts()


@app.get("/api/runs")
def runs(kind: str | None = None):
    return {"runs": STORE.list(kind)}


@app.post("/api/runs", status_code=202, dependencies=[Depends(require_control)])
def start_run(request: LiveRequest):
    if request.target == "tenki" and not (
        setting("TENKI_API_KEY") or setting("TENKI_AUTH_TOKEN")
    ):
        raise HTTPException(
            409,
            "Add TENKI_API_KEY to .env or your Space secrets before choosing Tenki Cloud.",
        )
    if request.agent == "openai" and not setting("OPENAI_API_KEY"):
        raise HTTPException(
            409, "Add OPENAI_API_KEY before choosing the model-driven worker."
        )
    if request.agent == "trained":
        try:
            load_checkpoint(request.checkpoint_id or "")
        except (ValueError, KeyError, OSError) as error:
            raise HTTPException(
                409, "Train a CPU policy first, then select its completed checkpoint."
            ) from error
    config = request.model_dump()
    try:
        return RUNNER.submit(
            "comparison" if request.comparison else "evaluation",
            config,
            lambda job: evaluate(job, config),
        )
    except Busy as error:
        raise HTTPException(429, str(error)) from error


@app.get("/api/runs/{run_id}")
def run_detail(run_id: str):
    return find_run(run_id)


@app.post("/api/runs/{run_id}/cancel", dependencies=[Depends(require_control)])
def cancel_run(run_id: str):
    find_run(run_id)
    return RUNNER.cancel(run_id)


@app.get("/api/runs/{run_id}/report")
def export_report(run_id: str):
    run = find_run(run_id)
    return JSONResponse(
        run,
        headers={
            "Content-Disposition": f'attachment; filename="sentry-loop-{run_id[:8]}.json"'
        },
    )


@app.get("/api/runs/{run_id}/environment")
def run_environment(
    run_id: str,
    policy: Literal["guarded", "unguarded"] = "guarded",
    phase: Literal["initial", "final"] = "final",
):
    run = find_run(run_id)
    result = run.get("result") or {}
    selected = result.get("policies", {}).get(policy)
    if not selected:
        raise HTTPException(
            409, "This policy's environment is not available until its run completes."
        )
    return {**selected[phase], "run_id": run_id, "policy": policy, "phase": phase}


@app.get("/api/training/runs")
def training_runs():
    return {"runs": list_training()}


@app.post(
    "/api/training/sync", status_code=202, dependencies=[Depends(require_control)]
)
def sync_training():
    try:
        return RUNNER.submit("publish", {}, publish_training)
    except Busy as error:
        raise HTTPException(429, str(error)) from error


@app.post(
    "/api/training/runs", status_code=202, dependencies=[Depends(require_control)]
)
def start_training(request: TrainingRequest):
    config = request.model_dump()
    try:
        return RUNNER.submit("training", config, lambda job: train_policy(job, config))
    except Busy as error:
        raise HTTPException(429, str(error)) from error


@app.get("/api/training/runs/{run_id}")
def training_detail(run_id: str):
    return find_training(run_id)


@app.get("/api/training/runs/{run_id}/metrics.csv")
def training_metrics(run_id: str):
    data = find_training(run_id)
    if not data["rows"]:
        raise HTTPException(409, "The first training step has not been logged yet.")
    return FileResponse(
        training_dir(run_id) / "metrics.csv",
        media_type="text/csv",
        filename=f"sentry-loop-training-{run_id[:8]}.csv",
    )


@app.get("/api/training/runs/{run_id}/checkpoint")
def training_checkpoint(run_id: str):
    data = find_training(run_id)
    path = training_dir(run_id) / "checkpoint.json"
    if data["metadata"].get("status") != "completed" or not path.exists():
        raise HTTPException(409, "This run has no completed CPU policy checkpoint.")
    return FileResponse(
        path, media_type="application/json", filename=f"sentry-policy-{run_id[:8]}.json"
    )


@app.post("/api/episodes")
def episode(request: EpisodeRequest):
    try:
        with SIMULATION_LOCK:
            return jsonable_encoder(simulate(request.seed, request.policy))
    except Exception as error:
        LOGGER.exception("Episode failed")
        raise HTTPException(
            500, "The episode could not finish. Try another seed or retry this run."
        ) from error


@app.post("/api/comparisons")
def comparison(request: SeedRequest):
    try:
        with SIMULATION_LOCK:
            return jsonable_encoder(
                {
                    "seed": request.seed,
                    "baseline": simulate(request.seed, "baseline"),
                    "resilient": simulate(request.seed, "resilient"),
                }
            )
    except Exception as error:
        LOGGER.exception("Comparison failed")
        raise HTTPException(
            500, "The comparison could not finish. Try another seed or retry this run."
        ) from error


@app.get("/api/environment")
def environment(seed: Annotated[int, Query(ge=0, le=MAX_SEED)] = 42):
    with SIMULATION_LOCK:
        env = SentinelOpsArena()
        env.reset(seed=seed)
        snapshot = {
            "seed": seed,
            "scope": "initial",
            "ticks": env.MAX_TICKS,
            "customers": list(env.crm.customers.values()),
            "invoices": list(env.billing.invoices.values()),
            "tickets": list(env.ticketing.tickets.values()),
            "tasks": [task.model_dump(mode="json") for task in env.tasks],
            "refund_policy": env.billing.refund_policy.model_dump(mode="json"),
            "sla_rules": env.ticketing.sla_rules.model_dump(mode="json"),
        }
        return jsonable_encoder(snapshot)


@app.get("/api/environment/owned")
def owned_environment(seed: Annotated[int, Query(ge=0, le=MAX_SEED)] = 42):
    from sentinelops_arena.target import Target

    return Target(seed).state


@app.get("/api/training")
def training():
    return read_training()


@app.get("/api/training.csv")
def export_training():
    read_training()
    return FileResponse(
        metrics_path(), media_type="text/csv", filename="sentry-loop-training.csv"
    )


UI_ROUTES = {
    "",
    "results",
    "results/scorecard",
    "arena",
    "arena/replay",
    "arena/analytics",
    "arena/rewards",
    "compare",
    "compare/replays",
    "compare/analytics",
    "environment",
    "environment/customers",
    "environment/invoices",
    "environment/tickets",
    "environment/tasks",
    "training",
    "training/reward",
    "training/components",
    "training/kl",
    "training/length",
    "training/loss",
    "guide",
    "connections",
}


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    if path.startswith(("api/", "assets/")):
        raise HTTPException(404, "Not found")
    return FileResponse(
        UI / "index.html", status_code=200 if path.rstrip("/") in UI_ROUTES else 404
    )


def main():
    import uvicorn

    uvicorn.run(
        app, host=setting("SENTRY_HOST", "127.0.0.1"), port=int(setting("PORT", "7860"))
    )


if __name__ == "__main__":
    main()
