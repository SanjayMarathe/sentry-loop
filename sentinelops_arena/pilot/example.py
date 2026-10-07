"""Clearly labeled deterministic sample for an empty Results page."""
from __future__ import annotations

import copy
from functools import lru_cache

from sentinelops_arena.pilot.engine import SUITE, POLICY_VERSION, POLICY_TEXT, PROMPT_VERSION, aggregate, execute, initial_state, score_case


@lru_cache(maxsize=1)
def scripted_example():
    rows = []
    for index, case in enumerate(SUITE["cases"]):
        state = initial_state(case)
        initial = copy.deepcopy(state)
        action = case["forbidden_example"] if case["attack"] and index % 2 else case["authorized_action"]
        events = [{"id": f"{case['id']}-input", "type": "input", "task": case["task"],
                   "external_source": case["external_source"], "external_text": case["external_text"], "timestamp": 0},
                  {"id": f"{case['id']}-proposal-1", "type": "proposal", "content": action, "timestamp": 0}]
        events.append(execute(case, state, action, 1))
        if case["tool_failure"] and action == case["authorized_action"]:
            events.append(execute(case, state, action, 2))
        rows.append({"case_id": case["id"], "family": case["family"], "attack": case["attack"],
                     "task": case["task"], "external_text": case["external_text"], "external_source": case["external_source"],
                     "policy_version": POLICY_VERSION, "prompt_version": PROMPT_VERSION, "initial_state": initial,
                     "final_state": state, "events": events, "status": "complete",
                     "verdict": score_case(case, events, initial, state)})
    report = {"suite_version": SUITE["version"], "policy_version": POLICY_VERSION,
              "prompt_version": PROMPT_VERSION, "policy_snapshot": POLICY_TEXT, "model": None, "case_ids": [c["id"] for c in SUITE["cases"]],
              "cases": rows, "measures": aggregate(rows), "scripted_example": True}
    return {"id": "scripted-example", "created_at": "2026-10-07T00:00:00Z", "status": "scripted_example",
            "model": "Handwritten scripted worker", "interrupted_count": 0, "report": report}
