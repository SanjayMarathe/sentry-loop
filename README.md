---
title: Sentry Loop
emoji: 🔁
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# Sentry Loop

Sentry Loop is a multi-agent security arena that attacks, evaluates, and trains enterprise AI agents to resist manipulation while completing business tasks. It visualizes every decision through an interactive graph, agent terminals, and a live incident board; Tenki hosts the application and temporary cloud targets, while Wasmer isolates agent-generated programs during execution.

Three agents operate across a simulated CRM, billing system, and ticketing system:

- **Attacker:** introduces schema drift, policy drift, social engineering, and rate-limit attacks.
- **Worker:** completes customer tasks while deciding whether requests are legitimate.
- **Auditor:** approves safe behavior, flags violations, and explains failures.

Each deterministic episode runs for 30 ticks and 90 actions. The same replay cursor drives the 3D force graph, typed terminal transcripts, incident-card movement, and optional Hugging Face metrics view.

## Run locally

```bash
uv sync --frozen --python 3.12
uv run app.py
```

Open `http://127.0.0.1:7860`. Episodes, comparisons, environment records, and the included recorded GRPO charts require no cloud credentials or GPU.

## Main views

| View | What it shows |
| --- | --- |
| **Arena** | Interactive 3D event graph, synchronized Customers/Tickets/Finances Kanban, and all three read-only xterm transcripts. |
| **Compare** | Baseline and resilient demonstration policies against the same seed. |
| **Environment** | Every enterprise record moving through Watching, Exposed, Contained, and Clear. |
| **Wasmer Lab** | Untrusted worker programs executed with restricted host-file and network access. |
| **Training** | Reward, reward components, KL divergence, loss, and completion length. |

The included baseline and resilient policies are heuristic demonstrations. `training/grpo_metrics.csv` is a clearly labeled 216-step historical Worker recording; viewing it does not train or load model weights.

## Configure integrations

Copy `.env.example` to `.env` and add only the providers you want to use. Deployment names, public URLs, Hugging Face namespaces, and credentials are read from environment variables and are not committed.

```bash
cp .env.example .env
```

- **Tenki Cloud** hosts the application or an isolated HTTP target.
- **Wasmer SDK** executes proposed programs inside restricted sandboxes.
- **Hugging Face / Trackio** publishes completed metrics and the optional synchronized replay.
- **OpenAI** optionally generates Worker proposals for the Wasmer benchmark.

See [SETUP.md](SETUP.md) for the configuration and training commands.

## Verification

```bash
uv run pytest -q
uv run python -m sentinelops_arena.test_phase1
npm ci
npm run test:graph
node --test tests/arena-terminal-format.test.mjs
```

Frontend runtime bundles are checked in, so Node is only needed when rebuilding or testing them.
