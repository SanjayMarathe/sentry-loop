"""Keep the original GRPO graph destination separate from other experiments."""

import sys
from types import SimpleNamespace

import pytest

from sentinelops_arena import telemetry


@pytest.mark.parametrize("experimental_space", ["", "owner/experiments"])
def test_cpu_experiment_cannot_publish_over_the_arena_grpo_space(
    monkeypatch, tmp_path, experimental_space
):
    import huggingface_hub

    monkeypatch.setenv("SENTRY_DATA_DIR", str(tmp_path))
    values = {
        "HF_TOKEN": "test-token",
        "SENTRY_TRACKIO_SPACE": "owner/arena-grpo",
        "SENTRY_SANDBOX_TRACKIO_SPACE": experimental_space,
        "SENTRY_TRACKIO_MODE": "static",
    }
    monkeypatch.setattr(telemetry, "setting", lambda key, default="": values.get(key, default))
    initialized, published = [], []

    def init(**kwargs):
        initialized.append(kwargs)
        return SimpleNamespace(log=lambda *a, **kw: None, finish=lambda: None)

    monkeypatch.setitem(sys.modules, "trackio", SimpleNamespace(init=init, sync=lambda **kw: published.append(kw)))
    monkeypatch.setattr(huggingface_hub, "HfApi", lambda **_: SimpleNamespace(space_info=lambda _: SimpleNamespace(sdk="static", sha="commit")))

    for run_id, kind in (("a" * 32, "grpo"), ("b" * 32, "cpu-policy")):
        logger = telemetry.TrainingLog(run_id, {"kind": kind, "model": "test"})
        logger.log(1, {"loss": 0.25, "reward": 1.5})
        logger.finish()
        assert telemetry.read_run(run_id)["rows"][0]["loss"] == 0.25
        assert logger.metadata["tracking"]["status"] != "error"

    assert [item["project"] for item in initialized] == ["sentry-loop-grpo", "sentry-loop"]
    assert published[0]["space_id"] == "owner/arena-grpo"
    assert published[0]["bucket_id"] == "owner/arena-grpo-grpo-bucket"
    assert len(published) == (2 if experimental_space else 1)
    if experimental_space:
        assert published[1]["space_id"] == experimental_space
        assert published[1]["bucket_id"] != published[0]["bucket_id"]
