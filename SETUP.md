# Sentry Loop setup

## Local demo

```bash
uv sync --frozen --python 3.12
uv run app.py
```

Open `http://127.0.0.1:7860`, choose a seed and policy, and run an episode. The local Arena and recorded metrics work without provider accounts.

## Optional configuration

Copy `.env.example` to the ignored `.env` file. Never place credentials in browser code or commit `.env`.

| Variable | Purpose |
| --- | --- |
| `TENKI_API_KEY` | Tenki application and target hosting. |
| `HF_TOKEN` | Write access to your Hugging Face Spaces. |
| `OPENAI_API_KEY` | Optional model-generated Worker proposals. |
| `SENTRY_HF_SPACE` | Static app portal, such as `namespace/sentry-loop`. |
| `SENTRY_TRACKIO_SPACE` | GRPO graph Space, such as `namespace/sentry-loop-training`. |
| `SENTRY_TRAINING_REPLAY_SPACE` | Static synchronized replay Space. |
| `SENTRY_TRAINING_REPLAY_ORIGIN` | Exact origin serving that static replay. |
| `SENTRY_PUBLIC_APP_URL` | Public app link used when publishing the replay. |
| `SENTRY_SOURCE_URL` | Public source repository link shown by the app. |
| `SENTRY_CONTROL_TOKEN` | Owner token for paid or administrative operations. |
| `SENTRY_DATA_DIR` | Run, metric, and checkpoint directory; defaults to `.sentry/`. |

## GRPO training

Validate the training path without downloading weights:

```bash
uv sync --frozen --extra train
uv run --extra train python train.py --check_setup \
  --agent all --num_episodes 2 --max_steps 2 --device cpu
```

On a suitable CUDA machine:

```bash
uv run --extra train python train.py --agent all \
  --model_name Qwen/Qwen2.5-1.5B-Instruct \
  --device cuda --max_steps 80 --num_episodes 50
```

`--agent all` trains Worker, Attacker, and Auditor sequentially. Metrics are stored under `.sentry/training/`; model outputs are stored under `sentinelops-grpo-<role>/`. The Arena's built-in demonstration policies do not automatically load those weights.

Publish the included recording or synchronized replay to your configured Spaces:

```bash
uv run python scripts/publish_grpo_recording.py
uv run python scripts/publish_training_replay.py
```

## Tenki deployment

```bash
uv run python scripts/deploy_tenki.py --hours 6
uv run python scripts/demo_host.py status
```

Deployment copies the application, installs locked dependencies, writes secrets to an owner-only server file, verifies health, and records the bounded VM lease. Use `scripts/demo_host.py backup` before replacing a host and `scripts/demo_host.py stop` when the demo is finished.
