"""Deploy this exact checkout to a bounded Tenki preview VM.

Copies an explicit allowlist, writes credentials to an owner-only file in the
owned VM, verifies health, then publishes a free HF Space that embeds the app.
No credentials are placed in the HF static Space or in the archive.
"""

from __future__ import annotations

import argparse
import html
import io
import json
import secrets
import sqlite3
import tarfile
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import set_key
from huggingface_hub import HfApi
from tenki import Client

from sentinelops_arena.runs import atomic_json
from sentinelops_arena.settings import ROOT, data_dir, safe_error, setting


def source_bundle() -> bytes:
    buffer = io.BytesIO()
    paths = [
        ROOT / name
        for name in (
            "app.py",
            "train.py",
            "pyproject.toml",
            "uv.lock",
            ".python-version",
            "README.md",
            "package.json",
            "package-lock.json",
            "training/grpo_metrics.csv",
        )
    ]
    paths += [
        p
        for p in (ROOT / "sentinelops_arena").rglob("*")
        if p.is_file()
        and p.suffix in {".py", ".js", ".css", ".html", ".woff2", ".svg", ".txt"}
        and "__pycache__" not in p.parts
    ]
    paths += list((ROOT / "scripts").glob("*.py"))
    paths += list((ROOT / "scripts").glob("*.mjs"))
    # Preserve completed experiments and training artifacts across deployments.
    # .env, account checks, caches, and control tokens are excluded.
    paths += list((data_dir() / "runs").glob("*.json"))
    paths += [
        p
        for p in (data_dir() / "training").glob("*/*")
        if p.suffix in {".json", ".csv", ".jsonl"}
    ]
    # Local Trackio data is needed to preserve earlier graph runs on the next sync.
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for path in paths:
            if path.is_relative_to(data_dir()):
                name = str(Path(".sentry") / path.relative_to(data_dir()))
                if "/runs/" in name:
                    run = json.loads(path.read_text())
                    if run["status"] in {"queued", "running", "cancelling"}:
                        continue
            else:
                name = str(path.relative_to(ROOT))
            archive.add(path, arcname=name, recursive=False)
        for database in (data_dir() / "trackio").glob("*.db"):
            # Include committed WAL data through SQLite's consistent backup API.
            with tempfile.TemporaryDirectory() as folder:
                backup = Path(folder) / database.name
                with (
                    sqlite3.connect(database) as source,
                    sqlite3.connect(backup) as destination,
                ):
                    source.backup(destination)
                archive.add(
                    backup, arcname=f".sentry/trackio/{database.name}", recursive=False
                )
    return buffer.getvalue()


def session_expiry(client, sandbox) -> datetime:
    # The high-level SDK currently omits timeout_at from SandboxInfo.
    from tenki_sandbox._pb import pb

    session = client._rpc.get_session(
        pb.GetSessionRequest(session_id=sandbox.id)
    ).session
    return session.timeout_at.ToDatetime(tzinfo=timezone.utc)


def extend_to_deadline(client, sandbox, deadline: datetime) -> datetime:
    """Honor caps on each extension and confirm the actual bounded expiry."""
    expiry = session_expiry(client, sandbox)
    for _ in range(12):
        additional = int((deadline - expiry).total_seconds())
        if additional <= 0:
            return expiry
        sandbox.extend(additional)
        updated = session_expiry(client, sandbox)
        if updated <= expiry:
            raise RuntimeError(
                "Tenki did not extend the lease to the requested demo deadline."
            )
        expiry = updated
    raise RuntimeError("Tenki lease extension limit reached before the demo deadline.")


def publish_portal(
    url: str, expires: str, session_id: str = "", deadline: str = ""
) -> str | None:
    space = setting("SENTRY_HF_SPACE")
    if not space or not setting("HF_TOKEN"):
        return None
    api = HfApi(token=setting("HF_TOKEN"))
    api.create_repo(
        space, repo_type="space", space_sdk="static", private=False, exist_ok=True
    )
    repo = api.space_info(space)
    if repo.sdk != "static":
        raise ValueError(
            "The app portal must be a static Space. Use a different SENTRY_HF_SPACE name."
        )
    graph = f"https://huggingface.co/spaces/{setting('SENTRY_TRACKIO_SPACE')}"
    index = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sentry Loop</title><style>html,body{{margin:0;height:100%;font:12px system-ui;background:#fff}}body{{display:flex;flex-direction:column}}header{{padding:9px 16px;display:flex;gap:20px;align-items:center;border-bottom:1px solid #e4e6ea;color:#667085}}header strong{{color:#17191d}}header a{{color:#3159f5;text-decoration:none}}header span{{margin-left:auto;font-size:11px}}iframe{{width:100%;flex:1;border:0}}@media(max-width:650px){{header span{{display:none}}}}</style></head><body><header><strong>Sentry Loop</strong><a id="live-link" href="{html.escape(url)}" target="_blank" rel="noreferrer">Open live app ↗</a><a href="{html.escape(graph)}" target="_blank" rel="noreferrer">Training graphs ↗</a><span>Hosted on Tenki · Three-agent OpenEnv Arena</span></header><iframe src="{html.escape(url)}" title="Sentry Loop live workspace" allow="clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe><script>setInterval(async()=>{{try{{const d=await fetch('./deployment.json?t='+Date.now(),{{cache:'no-store'}}).then(r=>r.json());const f=document.querySelector('iframe');if(d.url && d.url!==f.getAttribute('src')){{f.src=d.url;document.querySelector('#live-link').href=d.url;}}}}catch{{}}}},30000);</script></body></html>'''
    readme = f"""---
title: Sentry Loop
emoji: 🔁
colorFrom: blue
colorTo: gray
sdk: static
app_file: index.html
pinned: false
---

# Sentry Loop

The original three-agent enterprise security Arena with a redesigned UI.
Attacker, Worker, and Auditor interact across CRM, billing, and ticketing
for 30 ticks and 90 actions. Tenki hosts the application.

[Open the live app]({url}) · [Training graphs]({graph})

This free static Space embeds the live Tenki backend. The demo VM has a verified,
bounded lease ending at **{expires}** and stops automatically. Relaunching the
deployment updates this stable Space URL to the new VM.
Training graph snapshots remain available after the demo stops.
Public visitors can run original episodes, compare both demo policies, and inspect
the enterprise environment without a control token. The baseline and resilient
policies are the original heuristic demonstrations. The training Space displays
the original 216-step Qwen Worker GRPO recording; publishing it did not train
a new model. The original trainer supports all three roles sequentially.

Source repository: {setting('SENTRY_SOURCE_URL') or 'configure SENTRY_SOURCE_URL'}
"""
    from huggingface_hub import CommitOperationAdd

    api.create_commit(
        space,
        repo_type="space",
        commit_message="Publish Sentry Loop live demo portal",
        operations=[
            CommitOperationAdd(
                path_in_repo="index.html", path_or_fileobj=index.encode()
            ),
            CommitOperationAdd(
                path_in_repo="README.md", path_or_fileobj=readme.encode()
            ),
            CommitOperationAdd(
                path_in_repo="deployment.json",
                path_or_fileobj=json.dumps(
                    {
                        "url": url,
                        "session_id": session_id,
                        "expires_at": expires,
                        "demo_deadline": deadline or expires,
                    }
                ).encode(),
            ),
        ],
    )
    return f"https://huggingface.co/spaces/{space}"


def deploy(hours: int = 6, *, deadline: str | None = None) -> dict:
    token = setting("TENKI_API_KEY") or setting("TENKI_AUTH_TOKEN")
    if not token:
        raise ValueError("TENKI_API_KEY is required.")
    control = setting("SENTRY_CONTROL_TOKEN")
    if not control:
        control = secrets.token_urlsafe(36)
        path = ROOT / ".env"
        path.touch(mode=0o600, exist_ok=True)
        path.chmod(0o600)
        set_key(path, "SENTRY_CONTROL_TOKEN", control)
    token_file = data_dir() / "demo-control-token.txt"
    token_file.write_text(control + "\n")
    token_file.chmod(0o600)
    sandbox = None
    published = False
    complete = False
    client = Client(auth_token=token, timeout=60)
    deadline = (
        deadline or (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    )
    remaining = int(
        (datetime.fromisoformat(deadline) - datetime.now(timezone.utc)).total_seconds()
    )
    if remaining < 180:
        client.close()
        raise ValueError("At least three minutes must remain before the demo deadline.")
    previous_path = data_dir() / "deployment.json"
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else None
    try:
        sandbox = client.create(
            name="sentry-loop-demo",
            wait=False,
            cpu_cores=2,
            memory_mb=4096,
            disk_size_gb=10,
            allow_inbound=True,
            allow_outbound=True,
            max_duration=min(hours * 3600, remaining),
            idle_timeout_minutes=hours * 60,
            tags=["sentry-loop", "demo-host"],
            metadata={"purpose": "sentry-loop-live-demo"},
        )
        record = {
            "provider": "tenki",
            "session_id": sandbox.id,
            "status": "provisioning",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "max_duration_hours": hours,
        }
        atomic_json(data_dir() / "deployment-attempt.json", record)
        print("Created demo host", sandbox.id, flush=True)
        sandbox.wait_ready(timeout=120)
        expires = extend_to_deadline(
            client, sandbox, datetime.fromisoformat(deadline)
        ).isoformat()
        root = "/home/tenki/sentry-loop"
        sandbox.fs.mkdir(root)
        sandbox.fs.write_bytes("/home/tenki/sentry-loop-source.tar.gz", source_bundle())
        sandbox.exec(
            "python3",
            "-c",
            "import tarfile; tarfile.open('/home/tenki/sentry-loop-source.tar.gz').extractall('/home/tenki/sentry-loop', filter='data')",
            timeout=30,
            check=True,
        )
        names = (
            "TENKI_API_KEY",
            "TENKI_AUTH_TOKEN",
            "HF_TOKEN",
            "OPENAI_API_KEY",
            "SENTRY_OPENAI_MODEL",
            "SENTRY_TRACKIO_SPACE",
            "SENTRY_HF_SPACE",
            "SENTRY_TRAINING_REPLAY_SPACE",
            "SENTRY_TRAINING_REPLAY_ORIGIN",
            "SENTRY_TRAINING_REPLAY_URL",
            "SENTRY_PUBLIC_APP_URL",
            "SENTRY_SOURCE_URL",
        )
        env = {name: setting(name) for name in names if setting(name)}
        env.update(
            SENTRY_CONTROL_TOKEN=control,
            SENTRY_PUBLIC="1",
            SENTRY_TRACKIO_MODE="static",
            SENTRY_DATA_DIR=f"{root}/.sentry",
            SENTRY_HOST="0.0.0.0",
            PORT="7860",
            SENTRY_DEMO_DEADLINE=deadline,
        )
        # JSON string syntax is accepted for these simple dotenv string values.
        sandbox.fs.write_text(
            f"{root}/.env",
            "\n".join(f"{k}={json.dumps(v)}" for k, v in env.items()) + "\n",
        )
        sandbox.exec("chmod", "600", f"{root}/.env", timeout=10, check=True)
        print("Installing the locked application dependencies", flush=True)
        result = sandbox.exec(
            "uv", "sync", "--frozen", "--no-dev", cwd=root, timeout=240
        )
        if not result.ok:
            raise RuntimeError(
                "Dependency installation failed: " + result.stderr_text[-1600:]
            )
        # Detach stdio so the app survives the deployment client's disconnect.
        start = sandbox.exec(
            "python3",
            "-c",
            "import subprocess,pathlib; p=subprocess.Popen(['.venv/bin/python','app.py'],stdin=subprocess.DEVNULL,stdout=open('server.log','ab'),stderr=subprocess.STDOUT,start_new_session=True); pathlib.Path('server.pid').write_text(str(p.pid)); print(p.pid)",
            cwd=root,
            timeout=15,
            check=True,
        )
        print("Started app PID", start.stdout_text.strip(), flush=True)
        sandbox.exec(
            "python3",
            "-c",
            "import urllib.request,time\nfor _ in range(90):\n try:\n  print(urllib.request.urlopen('http://127.0.0.1:7860/api/health',timeout=2).read().decode()); break\n except Exception: time.sleep(1)\nelse: raise RuntimeError('Application did not become healthy')",
            timeout=100,
            check=True,
        )
        preview = sandbox.expose_port(7860, ttl=hours * 3600)
        url = preview.url
        with httpx.Client(timeout=30, follow_redirects=True) as http:
            for _ in range(20):
                try:
                    response = http.get(url.rstrip("/") + "/api/health")
                    if (
                        response.status_code == 200
                        and response.json().get("status") == "ok"
                    ):
                        break
                except (httpx.HTTPError, ValueError):
                    pass
                time.sleep(1)
            else:
                raise RuntimeError("The public preview did not pass its health check.")
        record.update(
            status="running",
            url=url,
            expires_at=expires,
            demo_deadline=deadline,
            app_pid=int(start.stdout_text.strip()),
            cpu_cores=2,
            memory_mb=4096,
        )
        print("Live app", url, flush=True)
        sandbox.fs.write_text(f"{root}/.sentry/deployment.json", json.dumps(record))
        portal = publish_portal(url, expires, sandbox.id, deadline)
        published = True
        record["hf_portal"] = portal
        sandbox.fs.write_text(f"{root}/.sentry/deployment.json", json.dumps(record))
        atomic_json(data_dir() / "deployment.json", record)
        sandbox.detach()
        complete = True
        print("Hugging Face portal", portal, flush=True)
        return record
    finally:
        try:
            if sandbox and not complete:
                if published and previous and previous.get("url"):
                    try:
                        publish_portal(
                            previous["url"],
                            previous["expires_at"],
                            previous["session_id"],
                            previous.get("demo_deadline", previous["expires_at"]),
                        )
                    except Exception as error:
                        print(
                            "Could not restore the previous portal:",
                            safe_error(error),
                            flush=True,
                        )
                sandbox.close_if_open()
        finally:
            client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=int, choices=range(1, 13), default=6)
    parser.add_argument(
        "--deadline", help="Absolute ISO-8601 deadline; replacements never extend it"
    )
    args = parser.parse_args()
    try:
        print(json.dumps(deploy(args.hours, deadline=args.deadline), indent=2))
    except Exception as error:
        print(safe_error(error))
        raise SystemExit(1)
