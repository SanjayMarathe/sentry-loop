"""Atomic training metrics plus optional live Hugging Face Trackio logging."""

from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import uuid
from pathlib import Path

from sentinelops_arena.runs import atomic_json, now
from sentinelops_arena.settings import data_dir, safe_error, setting

PROJECT = "sentry-loop"
GRPO_PROJECT = "sentry-loop-grpo"


def valid_space_id(value: str) -> bool:
    return bool(
        re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}", value
        )
    )


def training_dir(run_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise KeyError(run_id)
    return data_dir() / "training" / run_id


class TrainingLog:
    def __init__(self, run_id: str, metadata: dict, emit=None, *, track: bool = True):
        self.run_id = run_id
        self.root = training_dir(run_id)
        self.root.mkdir(parents=True, exist_ok=True)
        self.rows: dict[int, dict] = {}
        self.metadata = {
            "id": run_id,
            "recorded": False,
            "status": "running",
            "created_at": now(),
            "updated_at": now(),
            **metadata,
        }
        self.emit = emit or (lambda *_args, **_kwargs: None)
        self.tracker = None
        self.project = GRPO_PROJECT if metadata.get("kind") == "grpo" else PROJECT
        self.publish_mode = "local"
        self.save_metadata()
        if track:
            self.connect_trackio()

    def save_metadata(self):
        self.metadata["updated_at"] = now()
        atomic_json(self.root / "metadata.json", self.metadata)

    def connect_trackio(self):
        os.environ.setdefault("TRACKIO_DIR", str(data_dir() / "trackio"))
        space = setting(
            "SENTRY_TRACKIO_SPACE"
            if self.metadata.get("kind") == "grpo"
            else "SENTRY_SANDBOX_TRACKIO_SPACE"
        )
        token = setting("HF_TOKEN")
        if space and not valid_space_id(space):
            raise ValueError(
                "SENTRY_TRACKIO_SPACE must be a Hugging Face owner/space-name."
            )
        if space and not token:
            self.emit(
                "tracking", "HF_TOKEN is missing; keeping training metrics locally"
            )
            space = None
        if token:
            os.environ["HF_TOKEN"] = token
        try:
            if space:
                from huggingface_hub import HfApi
                from huggingface_hub.errors import RepositoryNotFoundError

                api = HfApi(token=token)
                mode = setting("SENTRY_TRACKIO_MODE", "auto")
                if mode == "auto":
                    try:
                        mode = api.space_info(space).sdk
                    except RepositoryNotFoundError:
                        mode = "gradio" if api.whoami().get("isPro") else "static"
                if mode not in {"static", "gradio"}:
                    raise ValueError(
                        "Trackio supports a Gradio Space or a static run dashboard."
                    )
                self.publish_mode = mode
            import trackio

            self.emit(
                "tracking",
                "Logging locally; the free Hugging Face graph Space will sync after training"
                if self.publish_mode == "static"
                else "Connecting the live Trackio training dashboard"
                if space
                else "Starting local Trackio logging",
            )
            self.tracker = trackio.init(
                project=self.project,
                name=f"{self.metadata['kind']}-{self.run_id[:8]}",
                space_id=space if self.publish_mode == "gradio" else None,
                config={
                    k: v
                    for k, v in self.metadata.items()
                    if k
                    in {"model", "algorithm", "device", "max_steps", "seed", "kind"}
                },
                private=False,
                auto_log_gpu=False,
                auto_log_cpu=False,
            )
            self.metadata["tracking"] = {
                "provider": "trackio",
                "project": self.project,
                "status": "pending_sync"
                if self.publish_mode == "static"
                else "logging",
                "mode": self.publish_mode,
                "space_id": space,
                "url": f"https://huggingface.co/spaces/{space}" if space else None,
            }
        except Exception as error:
            self.metadata["tracking"] = {
                "provider": "trackio",
                "status": "error",
                "error": safe_error(error),
            }
            self.emit(
                "tracking",
                "Trackio connection failed; local training metrics are still being saved",
                error=safe_error(error),
            )
        self.save_metadata()

    def log(self, step: int, metrics: dict):
        if step < 1:
            return
        row = self.rows.setdefault(step, {"step": step})
        row.update(
            {
                key: float(value)
                for key, value in metrics.items()
                if isinstance(value, (int, float))
                and math.isfinite(value)
                and key != "step"
            }
        )
        columns = ["step"] + sorted(
            {key for r in self.rows.values() for key in r if key != "step"}
        )
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=columns)
        writer.writeheader()
        writer.writerows(self.rows[k] for k in sorted(self.rows))
        temp = self.root / f"{uuid.uuid4().hex}.tmp"
        temp.write_text(buffer.getvalue())
        temp.replace(self.root / "metrics.csv")
        self.metadata["steps"] = max(self.rows)
        self.save_metadata()
        if self.tracker:
            try:
                self.tracker.log(
                    {k: v for k, v in row.items() if k != "step"}, step=step
                )
            except Exception as error:
                self.metadata["tracking"].update(
                    status="error", error=safe_error(error)
                )
                self.save_metadata()
                self.emit(
                    "tracking",
                    "A Trackio update failed; the CSV remains available",
                    error=safe_error(error),
                )

    def finish(self, status="completed", **extra):
        self.metadata.update(status=status, finished_at=now(), **extra)
        if self.tracker:
            try:
                self.tracker.finish()
                if status == "completed" and self.publish_mode == "static":
                    import trackio
                    from huggingface_hub import HfApi

                    self.emit(
                        "tracking",
                        "Publishing the completed run to the free Hugging Face graph Space",
                        progress=96,
                    )
                    space = self.metadata["tracking"]["space_id"]
                    trackio.sync(
                        project=self.project,
                        space_id=space,
                        sdk="static",
                        private=False,
                        bucket_id=f"{space}-grpo-bucket" if self.project == GRPO_PROJECT else f"{space}-bucket",
                    )
                    info = HfApi(token=setting("HF_TOKEN")).space_info(space)
                    if info.sdk != "static":
                        raise RuntimeError(
                            "The training graph Space was not published as a static dashboard."
                        )
                    self.metadata["tracking"].update(
                        status="published", commit=info.sha, published_at=now()
                    )
                elif self.publish_mode == "gradio":
                    from huggingface_hub import HfApi

                    info = HfApi(token=setting("HF_TOKEN")).get_space_runtime(
                        self.metadata["tracking"]["space_id"]
                    )
                    self.metadata["tracking"]["status"] = (
                        "connected" if str(info.stage) == "RUNNING" else "pending"
                    )
            except Exception as error:
                self.metadata["tracking"].update(
                    status="error", error=safe_error(error)
                )
                self.emit(
                    "tracking",
                    "The training run is saved locally; Hugging Face publication needs attention",
                    error=safe_error(error),
                )
        self.save_metadata()


def read_run(run_id: str) -> dict:
    root = training_dir(run_id)
    try:
        meta = json.loads((root / "metadata.json").read_text())
    except FileNotFoundError as error:
        raise KeyError(run_id) from error
    rows = []
    path = root / "metrics.csv"
    if path.exists():
        with path.open(newline="") as source:
            for row in csv.DictReader(source):
                rows.append(
                    {
                        k: int(v) if k == "step" else float(v) if v else None
                        for k, v in row.items()
                    }
                )
    return {"metadata": meta, "rows": rows}


def list_training() -> list[dict]:
    root = data_dir() / "training"
    result = []
    for path in root.glob("*/metadata.json"):
        try:
            result.append(json.loads(path.read_text()))
        except (ValueError, OSError):
            continue
    return sorted(result, key=lambda r: r.get("created_at", ""), reverse=True)[:100]


def publish_training(job) -> dict:
    """Publish the original Arena's GRPO metrics without retraining."""
    space = setting("SENTRY_TRACKIO_SPACE")
    if not setting("HF_TOKEN") or not valid_space_id(space):
        raise ValueError("Configure HF_TOKEN and SENTRY_TRACKIO_SPACE first.")
    os.environ.setdefault("TRACKIO_DIR", str(data_dir() / "trackio"))
    os.environ["HF_TOKEN"] = setting("HF_TOKEN")
    import trackio
    from huggingface_hub import HfApi
    from trackio.sqlite_storage import SQLiteStorage

    job.check()
    job.emit(
        "tracking", "Publishing actual training metrics to Hugging Face", progress=10
    )
    trackio.sync(
        project=GRPO_PROJECT,
        space_id=space,
        sdk="static",
        private=False,
        bucket_id=f"{space}-grpo-bucket",
    )
    info = HfApi(token=setting("HF_TOKEN")).space_info(space)
    published = []
    for meta in list_training():
        if meta.get("kind") != "grpo":
            continue
        name = f"{meta['kind']}-{meta['id'][:8]}"
        if meta["status"] == "completed" and SQLiteStorage.get_logs(GRPO_PROJECT, run=name):
            meta["tracking"] = {
                "provider": "trackio",
                "project": GRPO_PROJECT,
                "mode": "static",
                "status": "published",
                "space_id": space,
                "url": f"https://huggingface.co/spaces/{space}",
                "commit": info.sha,
                "published_at": now(),
            }
            meta["updated_at"] = now()
            atomic_json(training_dir(meta["id"]) / "metadata.json", meta)
            published.append(meta["id"])
    return {
        "url": f"https://huggingface.co/spaces/{space}",
        "commit": info.sha,
        "published_runs": published,
    }


# Names observed in TRL's GRPO logs. Missing metrics stay missing rather than
# becoming invented zeroes (e.g. KL is absent when beta=0).
GRPO_ALIASES = {
    "reward": ("reward", "reward/mean"),
    "reward_std": ("reward_std", "reward/std"),
    "loss": ("loss",),
    "kl": ("kl",),
    "mean_length": (
        "completions/mean_length",
        "completion_length",
        "completion_length/mean",
    ),
    "min_length": ("completions/min_length", "completion_length/min"),
    "max_length": ("completions/max_length", "completion_length/max"),
    "clipped_ratio": (
        "completions/clipped_ratio",
        "clip_ratio/region_mean",
        "clip_ratio",
    ),
}


def normalize_grpo(logs: dict) -> dict:
    result = {}
    for field, names in GRPO_ALIASES.items():
        for name in names:
            if isinstance(logs.get(name), (int, float)):
                result[field] = logs[name]
                break
    for key, value in logs.items():
        if key.startswith("rewards/"):
            labels = {
                "format_exact": ("format_exact", "format_exactly"),
                "format_approx": ("format_approx", "format_approximately"),
                "check_action": ("check_action",),
                "check_env": ("check_env",),
            }
            for label, aliases in labels.items():
                if any(alias in key for alias in aliases) and (
                    key.endswith("/mean") or len(key.split("/")) == 2
                ):
                    result[label] = value
    return result


def grpo_callback(logger: TrainingLog):
    # Keep Transformers optional for the CPU-only application.
    from transformers import TrainerCallback

    class MetricsCallback(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            values = normalize_grpo(logs or {})
            if values:
                logger.log(int(state.global_step), values)

    return MetricsCallback()
