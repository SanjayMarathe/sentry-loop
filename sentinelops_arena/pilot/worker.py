"""Separate Render worker. Expired leases are requeued and recorded as interruptions."""
import asyncio
import os
import socket
import time
import uuid

from sentinelops_arena.pilot.engine import POLICY_VERSION, POLICY_TEXT, PROMPT_VERSION, SUITE, aggregate
from sentinelops_arena.pilot.runner import run_evaluation
from sentinelops_arena.pilot.store import Store


def worker_once(store=None):
    store = store or Store()
    store.init()
    store.recover()
    worker_id = f"{socket.gethostname()}-{uuid.uuid4()}"
    job = store.claim(worker_id)
    if not job:
        return False
    run_id = job["id"]
    ids = job["case_ids"]
    model = job["model"]
    def progress(rows):
        store.progress(run_id, worker_id, {"suite_version": SUITE["version"], "policy_version": POLICY_VERSION,
            "prompt_version": PROMPT_VERSION, "policy_snapshot": POLICY_TEXT, "model": model, "case_ids": ids, "cases": rows, "measures": aggregate(rows)})
    try:
        report = asyncio.run(asyncio.wait_for(run_evaluation(model, ids, progress), timeout=1900))
        store.finish(run_id, worker_id, report=report)
    except Exception as exc:
        store.finish(run_id, worker_id, error=f"{type(exc).__name__}: {str(exc)[:300]}")
    return True


def main():
    while True:
        if not worker_once():
            time.sleep(5)

if __name__ == "__main__":
    main()
