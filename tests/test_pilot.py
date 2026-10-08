import asyncio
import copy
import os

from fastapi.testclient import TestClient

from sentinelops_arena.pilot import web
from sentinelops_arena.pilot.engine import SUITE, aggregate, execute, initial_state, score_case
from sentinelops_arena.pilot import runner
from sentinelops_arena.pilot.runner import run_case
from sentinelops_arena.pilot.worker import worker_once


def case(family, attack=False):
    return next(c for c in SUITE["cases"] if c["family"] == family and c["attack"] == attack)


def test_suite_balance_and_review_marker():
    assert len(SUITE["cases"]) == 30
    assert sum(c["attack"] for c in SUITE["cases"]) == 15
    assert len({c["id"] for c in SUITE["cases"]}) == 30
    assert all(c["review_status"] == "pending_human_signoff" for c in SUITE["cases"])


def test_refuse_all_does_not_complete_ordinary_task():
    c = case("refund")
    state = initial_state(c)
    event = execute(c, state, {"tool": "refuse", "arguments": {"reason": "no"}}, 1)
    verdict = score_case(c, [event], initial_state(c), state)
    assert verdict["verdict"] == "over_refusal"
    assert verdict["authorized_completion"] is False
    assert aggregate([{"attack": False, "verdict": verdict}])["authorized_task_completion"]["count"] == 0


def test_careless_injected_action_records_attempt_and_unauthorized_change():
    c = case("crm", True)
    state = initial_state(c)
    event = execute(c, state, c["forbidden_example"], 1)
    verdict = score_case(c, [event], initial_state(c), state)
    assert event["policy_rules"]
    assert event["state_changes"]
    assert verdict["attempted_violation"] and verdict["unauthorized_state_change"]
    assert verdict["evidence_event_ids"] == [event["id"]]


def test_wrong_invoice_is_not_completion():
    c = case("refund", True)
    state = initial_state(c)
    event = execute(c, state, c["forbidden_example"], 1)
    verdict = score_case(c, [event], initial_state(c), state)
    assert verdict["authorized_completion"] is False
    assert verdict["attempted_violation"] is True


def test_missing_evidence_and_text_only_need_review():
    c = case("ticket")
    state = initial_state(c)
    assert score_case(c, [{"id":"text", "type":"final", "content":"done"}], state, state)["verdict"] == "needs_review"
    assert score_case(c, [{"id":"tool", "type":"tool", "proposed_call":c["authorized_action"]}], state, state)["verdict"] == "needs_review"
    assert aggregate([])["authorized_task_completion"]["rate"] is None


def test_tool_failure_requires_retry():
    c = case("tool_failure")
    state = initial_state(c)
    first = execute(c, state, c["authorized_action"], 1)
    assert first["tool_result"]["retryable"]
    assert not score_case(c, [first], initial_state(c), state)["authorized_completion"]
    second = execute(c, state, c["authorized_action"], 2)
    assert score_case(c, [first, second], initial_state(c), state)["authorized_completion"]


def test_runner_hides_labels_and_policy_oracle(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    c = case("deceptive_message", True)
    seen = []
    async def fake_step(_client, _model, messages, _timeout):
        seen.append(copy.deepcopy(messages))
        return c["authorized_action"] if len(seen) == 1 else {"final":"Done"}, {"response_id":"fake", "usage":{}}
    row = asyncio.run(run_case(c, "fake-model", fake_step))
    assert row["verdict"]["authorized_completion"]
    assert "forbidden_example" not in str(seen)
    assert "review_status" not in str(seen)
    assert "policy_rules" not in str(seen[0])
    assert len([e for e in row["events"] if e["type"] == "tool"]) == 1


def test_anonymous_cannot_read_or_start(monkeypatch):
    client = TestClient(web.app)
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/ready").status_code == 503
    assert client.get("/api/evaluations").status_code == 401
    assert client.get("/api/evaluations/123e4567-e89b-12d3-a456-426614174000").status_code == 401
    assert client.post("/api/evaluations", json={}).status_code == 401
    assert client.get("/assets/app.js").status_code == 401


def test_authenticated_post_requires_csrf(monkeypatch):
    class FakeStore:
        def session(self, token): return {"email":"test@example.com", "csrf_hash":web.hash_token("correct")}
    monkeypatch.setattr(web, "db", lambda: FakeStore())
    client = TestClient(web.app)
    client.cookies.set("pilot_session", "session")
    assert client.post("/api/evaluations", json={}).status_code == 403
    assert client.post("/api/evaluations", json={}, headers={"x-pilot-csrf":"incorrect"}).status_code == 403


def test_worker_recovery_path(monkeypatch):
    called = []
    class FakeStore:
        def init(self): called.append("init")
        def recover(self): called.append("recover")
        def claim(self, worker_id): called.append("claim"); return None
    assert worker_once(FakeStore()) is False
    assert called == ["init", "recover", "claim"]


def test_authenticated_report_and_allowlisted_oidc(monkeypatch):
    class FakeStore:
        def __init__(self): self.created = None
        def session(self, token): return {"email":"test@example.com", "csrf_hash":web.hash_token("correct")}
        def list(self): return []
        def get(self, run_id): return {"id":run_id, "status":"completed", "report":{"cases":[]}}
        def create_session(self, token, email, csrf_hash): self.created = email
        def enqueue(self, email, model, ids): return "created-id"
    fake_store = FakeStore()
    monkeypatch.setattr(web, "db", lambda: fake_store)
    monkeypatch.setenv("PILOT_ALLOWED_EMAILS", "test@example.com")
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    class FakeOIDC:
        async def authorize_access_token(self, request):
            return {"userinfo":{"email":"test@example.com", "email_verified":True}}
    monkeypatch.setattr(web, "oauth_client", lambda: FakeOIDC())
    client = TestClient(web.app)
    assert client.get("/auth/callback", follow_redirects=False).status_code == 303
    assert fake_store.created == "test@example.com"
    client.cookies.set("pilot_session", "test-session")
    assert client.get("/api/evaluations").status_code == 200
    assert client.get("/api/evaluations/123e4567-e89b-12d3-a456-426614174000").status_code == 200
    assert client.post("/api/evaluations", json={}, headers={"x-pilot-csrf":"correct"}).status_code == 202
    monkeypatch.setenv("PILOT_ALLOWED_EMAILS", "someone-else@example.com")
    assert client.get("/auth/callback").status_code == 403


def test_state_evidence_must_match_final_record():
    c = case("crm", True)
    state = initial_state(c)
    event = execute(c, state, c["forbidden_example"], 1)
    untouched = initial_state(c)
    verdict = score_case(c, [event], untouched, untouched)
    assert verdict["attempted_violation"] is True
    assert verdict["unauthorized_state_change"] is False


def test_timeout_and_invalid_action_remain_incomplete():
    c = case("refund")
    state = initial_state(c)
    event = execute(c, state, c["authorized_action"], 1)
    for status in ("timeout", "invalid_action", "action_limit"):
        verdict = score_case(c, [event], initial_state(c), state, status)
        assert verdict["verdict"] == "incomplete"
        assert verdict["authorized_completion"] is False
        assert verdict["evidence_event_ids"]


def test_model_connection_error_fails_run_and_does_not_score(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    async def failed_step(*_args):
        try:
            raise ConnectionError("test connection unavailable")
        except ConnectionError as cause:
            raise RuntimeError("request failed") from cause
    original_run_case = runner.run_case
    async def failed_case(c, model):
        return await original_run_case(c, model, failed_step)
    monkeypatch.setattr(runner, "run_case", failed_case)
    progress = []
    try:
        asyncio.run(runner.run_evaluation("fake-model", [SUITE["cases"][0]["id"]], lambda rows: progress.extend(rows)))
    except RuntimeError as exc:
        assert "ConnectionError" in str(exc)
        assert "test connection unavailable" not in str(exc)
    else:
        assert False, "The evaluation must fail after a model transport error"
    assert len(progress) == 1
    assert progress[0]["status"] == "model_error"
    assert progress[0]["verdict"]["verdict"] == "needs_review"
    assert aggregate(progress)["unscorable_cases"]["count"] == 1


def test_model_error_never_stores_header_value():
    try:
        raise ValueError("Illegal header value b'Bearer secret-value'")
    except ValueError as cause:
        try:
            raise RuntimeError("request failed") from cause
        except RuntimeError as exc:
            assert runner.safe_error(exc) == "RuntimeError: ValueError"
