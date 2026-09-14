"""A small trainable proposal filter, usable on CPU and inside Wasmer.

This is a logistic classifier trained on the owned service's policy outcomes.
It is deliberately labeled separately from Qwen language-model GRPO training.
The hard policy gate remains independent of the learned filter.
"""

from __future__ import annotations

import asyncio
import json
import math

import numpy as np

from sentinelops_arena.providers import LocalTarget, WasmerExecutor
from sentinelops_arena.runs import Cancelled, Job, atomic_json
from sentinelops_arena.target import cases, validate_action
from sentinelops_arena.telemetry import TrainingLog, read_run, training_dir

FEATURE_NAMES = [
    "bias",
    "authorized_tool",
    "customer_ownership",
    "authorized_record",
    "authorized_amount",
    "policy_amount",
    "paid_invoice",
    "refund_window",
    "approval",
]


def features(state: dict, action: dict, context: dict) -> list[float]:
    validate_action(action)
    tool, args = action["tool"], action["arguments"]
    owner = record = amount = policy_amount = paid = window = approval = True
    if tool.startswith("crm."):
        owner = args["customer_id"] == context["customer_id"]
        record = owner
    elif tool == "billing.refund":
        invoice = next(
            (r for r in state["invoices"] if r["invoice_id"] == args["invoice_id"]), {}
        )
        owner = invoice.get("customer_id") == context["customer_id"]
        record = args["invoice_id"] == context.get("invoice_id")
        amount = args["amount"] <= context.get("max_amount", 0)
        policy_amount = args["amount"] <= state["refund_policy"]["max_amount"]
        paid = invoice.get("status") == "paid"
        window = (
            context.get("tick", 0) - invoice.get("issued_tick", -1000)
            <= state["refund_policy"]["window_ticks"]
        )
        approval = not state["refund_policy"]["requires_approval"] or context.get(
            "approved", False
        )
    elif tool == "ticketing.close":
        ticket = next(
            (r for r in state["tickets"] if r["ticket_id"] == args["ticket_id"]), {}
        )
        owner = ticket.get("customer_id") == context["customer_id"]
        record = args["ticket_id"] == context.get("ticket_id")
    return [1.0] + [
        float(v)
        for v in (
            tool == context["tool"],
            owner,
            record,
            amount,
            policy_amount,
            paid,
            window,
            approval,
        )
    ]


TRAINED_PROGRAM = """import json, math
data = json.load(open('/workspace/input.json'))
score = sum(w * x for w, x in zip(data['weights'], data['features']))
probability = 1 / (1 + math.exp(-max(-50, min(50, score))))
action = data['suggested_action'] if probability >= .5 else {'tool': 'refuse', 'arguments': {'reason': 'The trained proposal filter rejected this action.'}}
print(json.dumps(action))
"""

EVALUATE_PROGRAM = """import json, math
data = json.load(open('/workspace/input.json'))
probabilities = [1 / (1 + math.exp(-max(-50, min(50, sum(w*x for w,x in zip(data['weights'], row)))))) for row in data['features']]
print(json.dumps({'probabilities': probabilities}))
"""


def load_checkpoint(run_id: str) -> dict:
    metadata = read_run(run_id)["metadata"]
    if metadata.get("kind") != "cpu-policy" or metadata.get("status") != "completed":
        raise ValueError("Choose a completed CPU policy training run.")
    path = training_dir(run_id) / "checkpoint.json"
    checkpoint = json.loads(path.read_text())
    if checkpoint.get("feature_names") != FEATURE_NAMES or len(
        checkpoint.get("weights", [])
    ) != len(FEATURE_NAMES):
        raise ValueError("The policy checkpoint is incompatible.")
    if any(
        not isinstance(w, (int, float)) or not math.isfinite(w)
        for w in checkpoint["weights"]
    ):
        raise ValueError("The policy checkpoint contains invalid weights.")
    return checkpoint


async def train_async(job: Job, config: dict) -> dict:
    rng = np.random.default_rng(config["seed"])
    logger = TrainingLog(
        job.id,
        {
            "kind": "cpu-policy",
            "agent": "Proposal filter",
            "model": "Sentry safety policy",
            "algorithm": "Logistic regression",
            "device": "CPU + Wasmer validation",
            "max_steps": config["steps"],
            "seed": config["seed"],
            "feature_names": FEATURE_NAMES,
            "learning_rate": 1.0,
            "description": "A small classifier of tool proposals; this does not fine-tune a language model.",
        },
        job.emit,
    )
    try:
        examples = []
        job.emit(
            "dataset",
            "Collecting policy outcomes from the owned HTTP service",
            progress=2,
        )
        with LocalTarget(config["seed"], job) as target:
            for group in range(24):
                job.check()
                seed = config["seed"] + 100 + group
                state = target.call("/reset", {"seed": seed})
                for case in cases(seed):
                    vector = features(state, case["suggested_action"], case["context"])
                    outcome = target.call(
                        "/action",
                        {
                            "action": case["suggested_action"],
                            "context": case["context"],
                            "guarded": False,
                        },
                    )
                    label = float(not outcome["violation_reasons"])
                    examples.append(
                        {
                            "seed": seed,
                            "case_id": case["id"],
                            "features": vector,
                            "label": label,
                            "violations": outcome["violation_reasons"],
                            "split": "train" if group < 20 else "validation",
                        }
                    )
                job.emit(
                    "dataset",
                    f"Collected {len(examples)} measured policy outcomes",
                    progress=4 + round(group / 24 * 12),
                )
        (logger.root / "examples.jsonl").write_text(
            "\n".join(json.dumps(e) for e in examples) + "\n"
        )
        train = [e for e in examples if e["split"] == "train"]
        valid = [e for e in examples if e["split"] == "validation"]
        x = np.array([e["features"] for e in train])
        y = np.array([e["label"] for e in train])
        vx = np.array([e["features"] for e in valid])
        vy = np.array([e["label"] for e in valid])
        weights = np.zeros(len(FEATURE_NAMES))
        weights[0] = 1.0
        reference = 1 / (1 + np.exp(-(vx @ weights)))
        logger.metadata.update(
            train_examples=len(train),
            validation_examples=len(valid),
            validation_scope="Four held-out seeds from the same eight-case synthetic scenario family",
        )
        logger.save_metadata()
        job.emit(
            "training",
            "Optimizing policy weights; validation runs inside Wasmer",
            progress=18,
        )
        async with WasmerExecutor(job) as runtime:
            for step in range(1, config["steps"] + 1):
                job.check()
                # Each logged step contains one real gradient update, never a
                # precomputed chart or an artificial progress delay.
                sample = rng.choice(len(train), size=64, replace=False)
                bx, by = x[sample], y[sample]
                p = 1 / (1 + np.exp(-np.clip(bx @ weights, -50, 50)))
                gradient = bx.T @ (p - by) / len(by)
                weights -= gradient
                train_p = np.clip(
                    1 / (1 + np.exp(-np.clip(x @ weights, -50, 50))), 1e-9, 1 - 1e-9
                )
                validation = await runtime.execute(
                    EVALUATE_PROGRAM,
                    {"weights": weights.tolist(), "features": vx.tolist()},
                )
                if validation.get("error"):
                    raise RuntimeError(validation["error"])
                vp = np.clip(
                    np.array(validation["output"]["probabilities"]), 1e-9, 1 - 1e-9
                )
                predicted = vp >= 0.5
                correct = predicted == vy
                rewards = np.where(correct, 1.0, -1.0)
                row = {
                    "loss": float(
                        -np.mean(y * np.log(train_p) + (1 - y) * np.log(1 - train_p))
                    ),
                    "validation_loss": float(
                        -np.mean(vy * np.log(vp) + (1 - vy) * np.log(1 - vp))
                    ),
                    "reward": float(np.mean(rewards)),
                    "reward_std": float(np.std(rewards)),
                    "accuracy": float(np.mean((train_p >= 0.5) == y)),
                    "validation_accuracy": float(np.mean(correct)),
                    "benign_acceptance": float(np.mean(predicted[vy == 1])),
                    "malicious_rejection": float(np.mean(~predicted[vy == 0])),
                    "false_refusals": int(np.sum(~predicted[vy == 1])),
                    "kl": float(
                        np.mean(
                            vp * np.log(vp / reference)
                            + (1 - vp) * np.log((1 - vp) / (1 - reference))
                        )
                    ),
                    "sandbox_ms": validation["duration_ms"],
                }
                logger.log(step, row)
                job.emit(
                    "training",
                    f"Training step {step} of {config['steps']} · validation accuracy {row['validation_accuracy']:.0%}",
                    step=step,
                    metrics=row,
                    progress=20 + round(72 * step / config["steps"]),
                )
        checkpoint = {
            "kind": "cpu-policy",
            "algorithm": "logistic regression",
            "feature_names": FEATURE_NAMES,
            "weights": weights.tolist(),
            "run_id": job.id,
            "seed": config["seed"],
        }
        atomic_json(logger.root / "checkpoint.json", checkpoint)
        logger.finish(checkpoint_available=True)
        return {
            "training_id": job.id,
            "checkpoint_id": job.id,
            "metadata": logger.metadata,
            "final_metrics": row,
            "weights_changed": bool(
                np.linalg.norm(weights - np.array([1.0] + [0.0] * 8)) > 0
            ),
            "artifact": f"/api/training/runs/{job.id}/checkpoint",
        }
    except BaseException as error:
        logger.finish("cancelled" if isinstance(error, Cancelled) else "failed")
        raise


def train_policy(job: Job, config: dict) -> dict:
    return asyncio.run(train_async(job, config))
