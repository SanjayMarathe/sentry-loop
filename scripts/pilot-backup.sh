#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 ]]; then echo 'Usage: pilot-backup.sh DATABASE_URL backup.dump' >&2; exit 2; fi
pg_dump --format=custom --no-owner --file="$2" "$1"
pg_restore --list "$2" >/dev/null
