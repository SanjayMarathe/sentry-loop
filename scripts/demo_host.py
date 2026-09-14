"""Inspect, back up, or stop only the Sentry Loop demo host created by this app."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from tenki import Client
from huggingface_hub import hf_hub_download

from sentinelops_arena.runs import atomic_json
from sentinelops_arena.settings import data_dir, setting, safe_error


def current_deployment():
    space = setting("SENTRY_HF_SPACE")
    if space:
        # Read the stable portal so a local record cannot point at an older VM.
        path = hf_hub_download(
            space,
            "deployment.json",
            repo_type="space",
            force_download=True,
            token=setting("HF_TOKEN"),
        )
        return json.loads(Path(path).read_text())
    return json.loads((data_dir() / "deployment.json").read_text())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["status", "backup", "stop"])
    args = parser.parse_args()
    record = current_deployment()
    with Client(
        auth_token=setting("TENKI_API_KEY") or setting("TENKI_AUTH_TOKEN"), timeout=30
    ) as client:
        sandbox = client.get(record["session_id"])
        if sandbox.info.metadata.get("purpose") != "sentry-loop-live-demo":
            raise ValueError("This is not an app-owned demo host.")
        if args.action == "status":
            from deploy_tenki import session_expiry

            print(
                json.dumps(
                    {
                        "session_id": sandbox.id,
                        "state": str(sandbox.info.state),
                        "url": record["url"],
                        "expires_at": session_expiry(client, sandbox).isoformat(),
                    },
                    indent=2,
                )
            )
        elif args.action == "backup":
            # source_bundle includes only app source and completed, non-secret artifacts.
            sandbox.exec(
                ".venv/bin/python",
                "-c",
                "from scripts.deploy_tenki import source_bundle; from pathlib import Path; Path('/tmp/sentry-demo-backup.tar.gz').write_bytes(source_bundle())",
                cwd="/home/tenki/sentry-loop",
                timeout=30,
                check=True,
            )
            archive = sandbox.fs.read_bytes("/tmp/sentry-demo-backup.tar.gz")
            filename = (
                data_dir()
                / f"demo-backup-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.tar.gz"
            )
            filename.write_bytes(archive)
            filename.chmod(0o600)
            print(filename)
        else:
            sandbox.close_if_open()
            sandbox.refresh()
            print(
                json.dumps({"session_id": sandbox.id, "state": str(sandbox.info.state)})
            )
            record["status"] = "stopped"
            atomic_json(data_dir() / "deployment.json", record)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(safe_error(error))
        raise SystemExit(1)
