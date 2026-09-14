"""Bounded background jobs and durable, inspectable run records."""

from __future__ import annotations

import json
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from sentinelops_arena.settings import data_dir, safe_error

ACTIVE = {"queued", "running", "cancelling"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    temp.write_text(json.dumps(value, allow_nan=False), encoding="utf-8")
    temp.replace(path)


class Cancelled(Exception):
    pass


class Busy(Exception):
    pass


class RunStore:
    def __init__(self, root: Path | None = None):
        self.root = root or data_dir() / "runs"
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def path(self, run_id: str) -> Path:
        if len(run_id) != 32 or any(c not in "0123456789abcdef" for c in run_id):
            raise KeyError(run_id)
        return self.root / f"{run_id}.json"

    def create(self, kind: str, config: dict) -> dict:
        run = {
            "id": uuid.uuid4().hex,
            "kind": kind,
            "config": config,
            "owner_pid": os.getpid(),
            "status": "queued",
            "created_at": now(),
            "updated_at": now(),
            "progress": 0,
            "stage": "Queued",
            "events": [],
            "result": None,
            "error": None,
        }
        with self.lock:
            atomic_json(self.path(run["id"]), run)
        return run

    def get(self, run_id: str) -> dict:
        try:
            with self.lock:
                return json.loads(self.path(run_id).read_text())
        except (FileNotFoundError, ValueError) as error:
            raise KeyError(run_id) from error

    def update(self, run_id: str, **changes) -> dict:
        with self.lock:
            run = self.get(run_id)
            run.update(changes, updated_at=now())
            atomic_json(self.path(run_id), run)
            return run

    def event(self, run_id: str, stage: str, message: str, **details) -> None:
        with self.lock:
            run = self.get(run_id)
            run["events"].append(
                {
                    "index": len(run["events"]),
                    "at": now(),
                    "stage": stage,
                    "message": message,
                    **details,
                }
            )
            run.update(stage=message, updated_at=now())
            if "progress" in details:
                run["progress"] = details["progress"]
            atomic_json(self.path(run_id), run)

    def list(self, kind: str | None = None) -> list[dict]:
        result = []
        with self.lock:
            for path in self.root.glob("*.json"):
                try:
                    run = json.loads(path.read_text())
                    if kind is None or run["kind"] == kind:
                        result.append(
                            {
                                k: v
                                for k, v in run.items()
                                if k not in {"events", "result"}
                            }
                        )
                except (OSError, ValueError, KeyError):
                    continue
        return sorted(result, key=lambda r: r["created_at"], reverse=True)[:100]


class Job:
    def __init__(self, store: RunStore, run_id: str, cancel: threading.Event):
        self.store, self.id, self.cancel = store, run_id, cancel

    def check(self) -> None:
        if self.cancel.is_set():
            raise Cancelled("Run cancelled; resources have been released.")

    def emit(self, stage: str, message: str, **details) -> None:
        self.store.event(self.id, stage, message, **details)


class RunManager:
    def __init__(self, store: RunStore):
        self.store = store
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="sentry-run")
        self.lock = threading.RLock()
        self.active: dict[str, threading.Event] = {}

    def submit(self, kind: str, config: dict, work: Callable[[Job], dict]) -> dict:
        with self.lock:
            if len(self.active) >= 2:
                raise Busy(
                    "Two runs are already active. Wait for one to finish or cancel it."
                )
            if kind == "training" and any(
                r["kind"] == kind and r["status"] in ACTIVE for r in self.store.list()
            ):
                raise Busy("A training run is already active.")
            run = self.store.create(kind, config)
            cancel = threading.Event()
            self.active[run["id"]] = cancel
            self.pool.submit(self._execute, run["id"], cancel, work)
            return run

    def _execute(self, run_id: str, cancel: threading.Event, work: Callable) -> None:
        job = Job(self.store, run_id, cancel)
        try:
            job.check()
            self.store.update(run_id, status="running", started_at=now())
            result = work(job)
            job.check()
            self.store.update(
                run_id,
                status="completed",
                result=result,
                progress=100,
                stage="Complete",
                finished_at=now(),
            )
        except Cancelled as error:
            self.store.update(
                run_id, status="cancelled", error=str(error), finished_at=now()
            )
        except Exception as error:
            job.emit("error", safe_error(error))
            self.store.update(
                run_id, status="failed", error=safe_error(error), finished_at=now()
            )
        finally:
            with self.lock:
                self.active.pop(run_id, None)

    def cancel(self, run_id: str) -> dict:
        with self.lock:
            if run_id in self.active:
                self.active[run_id].set()
                return self.store.update(
                    run_id,
                    status="cancelling",
                    stage="Cancelling and releasing resources",
                )
        return self.store.get(run_id)

    def recover(self) -> None:
        # An interrupted process cannot resume native SDK handles. Remote VMs also
        # carry a hard lifetime; preserve their IDs in events for manual recovery.
        for run in self.store.list():
            if run["status"] in ACTIVE and run["id"] not in self.active:
                try:
                    owner = run.get("owner_pid")
                    if owner and owner != os.getpid():
                        os.kill(owner, 0)
                        continue
                except ProcessLookupError:
                    pass
                self.store.update(
                    run["id"],
                    status="interrupted",
                    finished_at=now(),
                    error="Server restarted during this run. Check its cleanup receipt; Tenki sessions expire after 10 minutes.",
                )
