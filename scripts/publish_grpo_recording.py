"""Publish the original 216-step Qwen CSV as a clearly labeled Trackio recording.

No model is trained by this command. New GRPO runs use the same project and
graph Space; archived proposal-filter experiments use a different project.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os

from sentinelops_arena.settings import ROOT, data_dir, setting
from sentinelops_arena.telemetry import GRPO_PROJECT, valid_space_id


def publish() -> dict:
    space = setting("SENTRY_TRACKIO_SPACE")
    token = setting("HF_TOKEN")
    if not valid_space_id(space) or not token:
        raise ValueError("Set HF_TOKEN and SENTRY_TRACKIO_SPACE in .env.")
    path = ROOT / "training" / "grpo_metrics.csv"
    with path.open(newline="", encoding="utf-8-sig") as source:
        rows = [{k: float(v) for k, v in row.items()} for row in csv.DictReader(source)]
    if len(rows) != 216 or [row["step"] for row in rows] != list(range(1, 217)):
        raise ValueError("Expected the original 216-step GRPO recording.")
    if not all(math.isfinite(value) for row in rows for value in row.values()):
        raise ValueError("The original recording must contain finite metrics.")

    os.environ["HF_TOKEN"] = token
    os.environ["TRACKIO_DIR"] = str(data_dir() / "trackio")
    import trackio
    from huggingface_hub import HfApi
    from huggingface_hub.errors import RepositoryNotFoundError
    from trackio.sqlite_storage import SQLiteStorage

    api = HfApi(token=token)
    try:
        if api.space_info(space).sdk != "static":
            raise ValueError("This command publishes to the selected free static Space.")
    except RepositoryNotFoundError:
        pass

    name = "recorded-worker-qwen-grpo-216"
    config = {
        "recorded": True,
        "kind": "grpo",
        "agent": "Worker",
        "model": "Qwen2.5-1.5B-Instruct",
        "algorithm": "GRPO",
        "steps": 216,
        "lora_rank": 64,
        "generations": 8,
        "source": "training/grpo_metrics.csv",
        "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "description": "Historical training metrics shipped with the original repository. Imported for visualization; this publication did not train a model.",
    }
    existing = SQLiteStorage.get_logs(GRPO_PROJECT, run=name)
    if existing:
        saved = SQLiteStorage.get_run_config(GRPO_PROJECT, name)
        if len(existing) != len(rows) or saved.get("source_sha256") != config["source_sha256"]:
            raise ValueError("An incomplete or different recording exists; inspect it before republishing.")
    else:
        run = trackio.init(
            project=GRPO_PROJECT, name=name, config=config, private=False,
            auto_log_gpu=False, auto_log_cpu=False,
        )
        for row in rows:
            run.log({k: v for k, v in row.items() if k != "step"}, step=int(row["step"]))
        run.finish()
    if len(SQLiteStorage.get_logs(GRPO_PROJECT, run=name)) != 216:
        raise RuntimeError("Trackio did not save all 216 recorded steps.")
    trackio.sync(
        project=GRPO_PROJECT, space_id=space, sdk="static", private=False,
        bucket_id=f"{space}-grpo-bucket",
    )
    readme = f"""---
title: Sentry Loop · GRPO training
emoji: 📈
colorFrom: blue
colorTo: gray
sdk: static
app_file: index.html
pinned: false
---

# Sentry Loop — original Arena GRPO graphs

The **recorded-worker-qwen-grpo-216** run contains the original repository's
216 measured Worker-agent training steps for Qwen2.5-1.5B-Instruct using GRPO
and LoRA rank 64. It is a **historical recording**, not a new training job.
Trackio timestamps indicate when the recording was imported.

Reward, reward components, loss, KL divergence, and completion lengths are
copied from the CSV without smoothing or invented measurements.
Source: `{setting('SENTRY_SOURCE_URL') or 'this repository'}/training/grpo_metrics.csv`.
CSV SHA-256: `{config['source_sha256']}`.

[Open the three-agent Arena](https://huggingface.co/spaces/{setting('SENTRY_HF_SPACE')})

New runs from `train.py` log under project `{GRPO_PROJECT}` and can synchronize
here after completion. This free static dashboard does not start training.
The Arena's baseline and resilient demonstration policies remain the original
heuristic agents; they do not load this recording as model weights.
"""
    api.upload_file(
        path_or_fileobj=readme.encode(), path_in_repo="README.md", repo_id=space,
        repo_type="space", commit_message="Label the original Qwen GRPO recording and its source",
    )
    return {
        "url": f"https://huggingface.co/spaces/{space}", "project": GRPO_PROJECT,
        "run": name, "steps": len(rows), "recorded": True,
        "source_sha256": config["source_sha256"], "commit": api.space_info(space).sha,
    }


if __name__ == "__main__":
    print(json.dumps(publish(), indent=2))
