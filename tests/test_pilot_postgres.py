"""Runs with CI's disposable Postgres service; local runs skip without DATABASE_URL."""
import os
import uuid
import pytest

from sentinelops_arena.pilot.store import Store


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="Disposable Postgres required")
def test_queue_restart_and_persistent_report():
    store = Store()
    store.init()
    owner = f"test-{uuid.uuid4()}@example.com"
    # Clear only rows created by this test in its dedicated CI database.
    with store.connect() as db:
        db.execute("DELETE FROM pilot_evaluations WHERE owner_email LIKE 'test-%@example.com'")
    run_id = store.enqueue(owner, "fake-model", ["pilot-01"])
    claimed = store.claim("worker-before-restart")
    assert str(claimed["id"]) == run_id
    report = {"model":"fake-model", "cases":[], "measures":{}}
    store.progress(run_id, "worker-before-restart", report)
    assert store.get(run_id)["report"] == report
    with store.connect() as db:
        db.execute("UPDATE pilot_evaluations SET lease_until=now()-interval '1 second' WHERE id=%s", (run_id,))
    restarted_store = Store()
    restarted_store.recover()
    job = restarted_store.claim("worker-after-restart")
    assert str(job["id"]) == run_id
    assert job["interrupted_count"] == 1
    restarted_store.finish(run_id, "worker-after-restart", report=report)
    assert Store().get(run_id)["status"] == "completed"
    assert Store().get(run_id)["report"] == report
    with store.connect() as db:
        db.execute("DELETE FROM pilot_evaluations WHERE id=%s", (run_id,))
