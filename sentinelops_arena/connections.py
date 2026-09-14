"""Account health checks and credential-free integration status."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json

from sentinelops_arena.runs import atomic_json, now
from sentinelops_arena.settings import data_dir, safe_error, setting


def fingerprint(provider: str) -> str:
    names = {
        "openai": ["OPENAI_API_KEY"],
        "tenki": ["TENKI_API_KEY", "TENKI_AUTH_TOKEN"],
        "huggingface": ["HF_TOKEN"],
    }
    return hashlib.sha256(
        "|".join(setting(n) for n in names[provider]).encode()
    ).hexdigest()


def status() -> dict:
    try:
        checks = json.loads((data_dir() / "connections.json").read_text())
    except (ValueError, OSError):
        checks = {}
    providers = {}
    for key, configured in {
        "openai": bool(setting("OPENAI_API_KEY")),
        "tenki": bool(setting("TENKI_API_KEY") or setting("TENKI_AUTH_TOKEN")),
        "huggingface": bool(setting("HF_TOKEN")),
    }.items():
        previous = checks.get(key, {})
        checked = previous.get("fingerprint") == fingerprint(key)
        providers[key] = {
            "configured": configured,
            "status": previous.get("status")
            if checked
            else "configured"
            if configured
            else "needs_setup",
            **(
                {
                    k: v
                    for k, v in previous.items()
                    if k not in {"fingerprint", "status"}
                }
                if checked
                else {}
            ),
        }
    providers["wasmer"] = {
        "configured": True,
        "status": "installed",
        "sdk_version": importlib.metadata.version("wasmer-sdk"),
        "network": "disabled",
    }
    providers["openai"]["model"] = setting("SENTRY_OPENAI_MODEL", "gpt-4.1-mini")
    trackio_space = setting("SENTRY_TRACKIO_SPACE")
    replay_space = setting("SENTRY_TRAINING_REPLAY_SPACE")
    if not replay_space and "/" in trackio_space:
        replay_space = f"{trackio_space.split('/', 1)[0]}/sentry-loop-training-replay"
    providers["huggingface"].update(
        app_space=setting("SENTRY_HF_SPACE"),
        trackio_space=trackio_space,
        trackio_url=f"https://huggingface.co/spaces/{trackio_space}"
        if trackio_space
        else None,
        replay_space=replay_space,
        replay_url=f"https://huggingface.co/spaces/{replay_space}"
        if replay_space
        else None,
    )
    return {
        "providers": providers,
        "public": bool(setting("SPACE_ID") or setting("SENTRY_PUBLIC") == "1"),
        "control_token_configured": bool(setting("SENTRY_CONTROL_TOKEN")),
        "training": {
            "cpu_available": True,
            "grpo_requires": "A configured Python training environment and enough GPU memory",
        },
    }


def check_accounts() -> dict:
    checks = {}
    for provider in ("tenki", "huggingface", "openai"):
        if not status()["providers"][provider]["configured"]:
            continue
        result = {"checked_at": now(), "fingerprint": fingerprint(provider)}
        try:
            if provider == "tenki":
                from tenki import Client

                with Client(
                    auth_token=setting("TENKI_API_KEY") or setting("TENKI_AUTH_TOKEN"),
                    timeout=20,
                ) as client:
                    client.list(tags=["sentry-loop"])
            elif provider == "huggingface":
                from huggingface_hub import HfApi

                user = HfApi(token=setting("HF_TOKEN")).whoami()
                result["username"] = user["name"]
            else:
                from openai import OpenAI

                with OpenAI(
                    api_key=setting("OPENAI_API_KEY"), timeout=15, max_retries=0
                ) as client:
                    client.models.retrieve(
                        setting("SENTRY_OPENAI_MODEL", "gpt-4.1-mini")
                    )
            result["status"] = "authenticated"
        except Exception as error:
            result.update(status="error", error=safe_error(error))
        checks[provider] = result
    atomic_json(data_dir() / "connections.json", checks)
    return status()
