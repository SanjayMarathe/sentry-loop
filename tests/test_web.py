"""Behavior checks for the UI's API boundary and real simulator integration."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from sentinelops_arena.web import app


@pytest.fixture
def client():
    with TestClient(app) as session:
        yield session


def test_episode_contains_real_rejection_and_complete_replay(client):
    response = client.post("/api/episodes", json={"seed": 42, "policy": "baseline"})
    assert response.status_code == 200
    episode = response.json()
    assert episode["policy_type"] == "heuristic"
    assert episode["scores"]["worker"] == 24.2
    assert len(episode["log"]) == 90
    for tick in range(30):
        actions = episode["log"][tick * 3 : tick * 3 + 3]
        assert [row["agent"] for row in actions] == ["attacker", "worker", "oversight"]
        assert {row["tick"] for row in actions} == {tick}
    rejection = episode["log"][25]
    assert rejection["parameters"]["invoice_id"] == "INV-0001"
    assert "already been refunded" in rejection["result"]["details"]["error"]
    assert len(rejection["task"]["message"]) > 60
    assert rejection["ground_truth"]["violations_present"] is False


@pytest.mark.parametrize("body", [
    {"seed": -1}, {"seed": 2**31}, {"seed": 42.5}, {"seed": True},
    {"seed": "42"}, {"seed": None}, {"seed": 42, "policy": "model"},
    {"seed": 42, "command": "unrecognized input"},
])
def test_episode_rejects_invalid_configuration(client, body):
    assert client.post("/api/episodes", json=body).status_code == 422


def test_comparison_matches_independent_policy_runs(client):
    result = client.post("/api/comparisons", json={"seed": 42}).json()
    for policy in ("baseline", "resilient"):
        independent = client.post("/api/episodes", json={"seed": 42, "policy": policy}).json()
        assert result[policy]["seed"] == 42
        assert result[policy]["policy"] == policy
        assert result[policy]["scores"] == independent["scores"]
        assert result[policy]["metrics"] == independent["metrics"]
    assert result["baseline"]["scores"] != result["resilient"]["scores"]


def test_environment_is_a_complete_initial_snapshot(client):
    first = client.get("/api/environment?seed=42").json()
    assert [len(first[key]) for key in ("customers", "invoices", "tickets", "tasks")] == [15, 15, 10, 30]
    assert first["scope"] == "initial"
    assert any(len(task["message"]) > 60 for task in first["tasks"])
    client.post("/api/episodes", json={"seed": 42, "policy": "baseline"})
    assert client.get("/api/environment?seed=42").json() == first
    assert client.get("/api/environment?seed=7").json()["customers"] != first["customers"]
    assert client.get("/api/environment?seed=-1").status_code == 422


def test_replay_sync_relays_only_valid_bounded_telemetry(client, monkeypatch):
    monkeypatch.setenv(
        "SENTRY_TRAINING_REPLAY_ORIGIN",
        "https://example-sentry-loop-training-replay.static.hf.space",
    )
    channel = "12345678-1234-1234-1234-123456789abc"
    path = f"/api/replay-sync/{channel}"
    payload = {
        "type": "sentry-loop-arena-sync",
        "version": 1,
        "seed": 42,
        "policy": "baseline",
        "cursor": 4,
        "totalActions": 90,
        "tick": 1,
        "current": {
            "agent": "worker",
            "action": "lookup_customer",
            "status": "Passed",
            "reward": 1,
        },
        "points": [
            {"step": 1, "reward": 1, "loss": 1, "kl": 100, "mean_length": 0}
        ],
    }
    response = client.post(path, json=payload, headers={"Origin": "http://testserver"})
    assert response.status_code == 200
    replay = client.get(path)
    assert replay.status_code == 200
    assert replay.json() == payload
    assert replay.headers["access-control-allow-origin"].endswith(
        ".static.hf.space"
    )
    assert replay.headers["cache-control"] == "no-store"
    assert client.post(
        path,
        json={**payload, "cursor": 10000},
        headers={"Origin": "http://testserver"},
    ).status_code == 422
    assert client.post(
        path,
        json=payload,
        headers={"Origin": "https://example.com"},
    ).status_code == 403
    assert client.get("/api/replay-sync/not-a-channel").status_code == 404


def test_concurrent_runs_do_not_mix_random_seeds():
    def run(seed):
        with TestClient(app) as session:
            response = session.post("/api/episodes", json={"seed": seed, "policy": "resilient"})
            assert response.status_code == 200
            episode = response.json()
            # System-created record IDs use UUIDs; compare decisions and outcomes.
            return episode["scores"], episode["metrics"], [
                (row["tick"], row["agent"], row["action_type"], row["reward"])
                for row in episode["log"]
            ]

    seeds = [42, 7, 123]
    expected = {seed: run(seed) for seed in seeds}
    with ThreadPoolExecutor(max_workers=4) as pool:
        actual = list(pool.map(run, seeds * 2))
    assert actual == [expected[seed] for seed in seeds * 2]


def test_training_data_and_download_agree(client):
    response = client.get("/api/training")
    assert response.status_code == 200
    training = response.json()
    assert training["metadata"]["recorded"] is True
    assert len(training["rows"]) == 216
    assert training["rows"][-1]["step"] == 216
    assert training["rows"][-1]["reward"] == 11
    download = client.get("/api/training.csv")
    assert download.status_code == 200
    assert "sentry-loop-training.csv" in download.headers["content-disposition"]
    assert len(download.text.splitlines()) == len(training["rows"]) + 1


@pytest.mark.parametrize("contents", [None, "step,reward\n1,11\n", ""])
def test_missing_or_invalid_training_data_is_explained(client, monkeypatch, tmp_path, contents):
    source = tmp_path / "metrics.csv"
    if contents is not None:
        source.write_text(contents)
    monkeypatch.setenv("SENTRY_METRICS_PATH", str(source))
    for path in ("/api/training", "/api/training.csv"):
        response = client.get(path)
        assert response.status_code == 503
        assert "SENTRY_METRICS_PATH" in response.json()["detail"]


def test_bookmarked_views_load_and_unknown_routes_are_404(client):
    for path in ("/", "/arena/analytics", "/compare/replays", "/environment/tasks", "/training/kl", "/guide"):
        response = client.get(path)
        assert response.status_code == 200
        assert "Sentry Loop" in response.text
        assert "/assets/app.js" in response.text
    assert client.get("/missing-view").status_code == 404
    assert client.get("/api/missing").status_code == 404
    assert client.get("/assets/missing.js").status_code == 404
