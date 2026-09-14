"""Server-side settings. Credentials are never included in API responses."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent


def setting(name: str, default: str = "") -> str:
    # Read on demand so connecting an account does not require restarting a demo.
    return os.environ.get(name) or dotenv_values(ROOT / ".env").get(name) or default


def data_dir() -> Path:
    path = Path(setting("SENTRY_DATA_DIR", str(ROOT / ".sentry")))
    path.mkdir(parents=True, exist_ok=True)
    return path


def safe_error(error: BaseException) -> str:
    text = f"{type(error).__name__}: {error}"
    for name in (
        "OPENAI_API_KEY",
        "TENKI_API_KEY",
        "TENKI_AUTH_TOKEN",
        "HF_TOKEN",
        "SENTRY_CONTROL_TOKEN",
    ):
        secret = setting(name)
        if secret:
            text = text.replace(secret, "[redacted]")
    return text[:1200]
