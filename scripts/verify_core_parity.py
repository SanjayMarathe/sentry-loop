"""Compare the redesigned app's engine with the original checked-out revision."""

import json
import subprocess
import types

from sentinelops_arena.demo import run_episode
from sentinelops_arena.metrics import compute_episode_metrics
from sentinelops_arena.settings import ROOT


def verify():
    source = subprocess.check_output(
        ["git", "show", "558d273:sentinelops_arena/demo.py"], cwd=ROOT, text=True
    )
    upstream = types.ModuleType("sentinelops_arena._upstream_demo")
    upstream.__package__ = "sentinelops_arena"
    exec(compile(source, "upstream/demo.py", "exec"), upstream.__dict__)
    results = []
    for seed in (42, 7, 123):
        for trained in (False, True):
            original, original_scores = upstream.run_episode(trained=trained, seed=seed)
            current, scores = run_episode(trained=trained, seed=seed, include_details=True)
            # UUID-generated record IDs do not affect decisions or reward totals.
            decisions = lambda log: [
                (r["tick"], r["agent"], r["action_type"], r["reward"], r["explanation"])
                for r in log
            ]
            assert len(current) == len(original) == 90
            assert decisions(current) == decisions(original)
            assert scores == original_scores
            assert compute_episode_metrics(current) == compute_episode_metrics(original)
            results.append({"seed": seed, "policy": "resilient" if trained else "baseline", "actions": len(current), "scores": scores, "matches_upstream": True})
    return results


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
