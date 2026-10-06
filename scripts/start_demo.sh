#!/usr/bin/env bash
# Run the recording copy from its ordinary local checkout, outside iCloud.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v uv >/dev/null 2>&1; then
  printf 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/\n' >&2
  exit 1
fi

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  printf 'This demo runs without credentials. Move the checkout .env file before starting it.\n' >&2
  exit 1
fi

unset OPENAI_API_KEY TENKI_API_KEY TENKI_AUTH_TOKEN HF_TOKEN HUGGING_FACE_HUB_TOKEN
unset SENTRY_CONTROL_TOKEN SPACE_ID SENTRY_HF_SPACE SENTRY_TRACKIO_SPACE SENTRY_TRAINING_REPLAY_SPACE
export UV_PROJECT_ENVIRONMENT="$PROJECT_ROOT/.venv"
export SENTRY_PUBLIC=1
export SENTRY_HOST="${SENTRY_HOST:-127.0.0.1}"
export PORT="${PORT:-7860}"
export SENTRY_DATA_DIR="$PROJECT_ROOT/.sentry"

uv sync --locked --python 3.12 --no-dev
printf 'Open http://127.0.0.1:%s/ to record the demo. Press Ctrl-C to stop it.\n' "$PORT"
exec "$PROJECT_ROOT/.venv/bin/python" "$PROJECT_ROOT/app.py"
