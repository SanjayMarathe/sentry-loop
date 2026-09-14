"""Exercise cleanup failures and bounded hosting without starting paid sessions."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import threading

import pytest

from scripts import deploy_tenki
from sentinelops_arena.providers import LocalTarget, TenkiTarget
from sentinelops_arena.runs import Job, RunStore


def test_extensions_respect_provider_caps_and_original_deadline(monkeypatch):
    start = datetime(2026, 9, 13, 20, tzinfo=timezone.utc)
    expiry = start + timedelta(hours=2)
    deadline = start + timedelta(hours=6)
    requests = []

    def extend(seconds):
        nonlocal expiry
        requests.append(seconds)
        expiry += timedelta(seconds=min(seconds, 7200))

    monkeypatch.setattr(deploy_tenki, "session_expiry", lambda *_: expiry)
    result = deploy_tenki.extend_to_deadline(
        None, SimpleNamespace(extend=extend), deadline
    )
    assert result == deadline
    assert requests == [14400, 7200]


def test_unapplied_extension_is_not_reported_as_success(monkeypatch):
    expiry = datetime(2026, 9, 13, 20, tzinfo=timezone.utc)
    monkeypatch.setattr(deploy_tenki, "session_expiry", lambda *_: expiry)
    with pytest.raises(RuntimeError, match="did not extend"):
        deploy_tenki.extend_to_deadline(
            None, SimpleNamespace(extend=lambda _: None), expiry + timedelta(hours=2)
        )


def test_tenki_readiness_failure_closes_created_vm_and_client(monkeypatch, tmp_path):
    import tenki

    flags = {"closed": False, "client_closed": False}

    class Sandbox:
        id = "test-vm"
        state = "RUNNING"

        def wait_ready(self, **_):
            raise RuntimeError("readiness failure")

        def close_if_open(self):
            flags["closed"] = True
            self.state = "TERMINATED"

    class Client:
        def __init__(self, **_):
            pass

        def create(self, **kwargs):
            assert kwargs["allow_inbound"] is False
            assert kwargs["allow_outbound"] is False
            assert kwargs["max_duration"] == 600
            return Sandbox()

        def close(self):
            flags["client_closed"] = True

    monkeypatch.setattr(tenki, "Client", Client)
    monkeypatch.setenv("TENKI_API_KEY", "test-key")
    store = RunStore(tmp_path)
    run = store.create("evaluation", {})
    with pytest.raises(RuntimeError, match="readiness failure"):
        with TenkiTarget(42, Job(store, run["id"], threading.Event())):
            pytest.fail("An unready target must not execute")
    assert all(flags.values())
    cleanup = [e for e in store.get(run["id"])["events"] if e["stage"] == "cleanup"]
    assert cleanup[-1]["released"] is True


def test_local_readiness_failure_stops_the_http_thread(monkeypatch, tmp_path):
    store = RunStore(tmp_path)
    run = store.create("evaluation", {})
    target = LocalTarget(42, Job(store, run["id"], threading.Event()))

    def fail(*_):
        raise RuntimeError("readiness failure")

    monkeypatch.setattr(target, "call", fail)
    with pytest.raises(RuntimeError, match="readiness failure"):
        target.__enter__()
    assert not target.thread.is_alive()
    assert target.client.is_closed
