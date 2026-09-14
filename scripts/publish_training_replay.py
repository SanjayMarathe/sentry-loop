"""Publish recorded GRPO replay and synchronized Arena Worker telemetry."""

from __future__ import annotations

import csv
import hashlib
import json
import math

from huggingface_hub import CommitOperationAdd, HfApi

from sentinelops_arena.settings import ROOT, setting


def replay_space() -> str:
    configured = setting("SENTRY_TRAINING_REPLAY_SPACE")
    if configured:
        return configured
    trackio = setting("SENTRY_TRACKIO_SPACE")
    if "/" not in trackio:
        raise ValueError(
            "Set SENTRY_TRAINING_REPLAY_SPACE or SENTRY_TRACKIO_SPACE first."
        )
    return f"{trackio.split('/', 1)[0]}/sentry-loop-training-replay"


def publish() -> dict:
    token = setting("HF_TOKEN")
    if not token:
        raise ValueError("Set HF_TOKEN in .env before publishing.")
    source = ROOT / "training" / "grpo_metrics.csv"
    with source.open(newline="", encoding="utf-8-sig") as handle:
        rows = [
            {key: float(value) for key, value in row.items()}
            for row in csv.DictReader(handle)
        ]
    if len(rows) != 216 or [row["step"] for row in rows] != list(range(1, 217)):
        raise ValueError("Expected the original 216-step recording.")
    if not all(math.isfinite(value) for row in rows for value in row.values()):
        raise ValueError("Recorded metrics contain a non-finite value.")

    space = replay_space()
    api = HfApi(token=token)
    api.create_repo(
        repo_id=space,
        repo_type="space",
        space_sdk="static",
        private=False,
        exist_ok=True,
    )
    root = ROOT / "training" / "replay_space"
    source_url = setting("SENTRY_SOURCE_URL").rstrip("/")
    app_url = setting("SENTRY_PUBLIC_APP_URL")
    index = (root / "index.html").read_text().replace(
        "{{SENTRY_APP_URL}}", app_url or "#"
    ).replace(
        "{{SENTRY_METRICS_SOURCE_URL}}",
        f"{source_url}/blob/main/training/grpo_metrics.csv" if source_url else "#",
    )
    operations = [
        CommitOperationAdd(path_in_repo=name, path_or_fileobj=root / name)
        for name in ("README.md", "styles.css", "app.js")
    ]
    operations.append(
        CommitOperationAdd(path_in_repo="index.html", path_or_fileobj=index.encode())
    )
    operations.append(
        CommitOperationAdd(
            path_in_repo="metrics.json",
            path_or_fileobj=json.dumps(rows, separators=(",", ":")).encode(),
        )
    )
    commit = api.create_commit(
        repo_id=space,
        repo_type="space",
        operations=operations,
        commit_message="Synchronize Worker telemetry with the live Arena replay",
    )
    return {
        "url": f"https://huggingface.co/spaces/{space}",
        "space": space,
        "steps": len(rows),
        "recorded": True,
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "commit": commit.oid,
    }


if __name__ == "__main__":
    print(json.dumps(publish(), indent=2))
