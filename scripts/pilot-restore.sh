#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 ]]; then echo 'Usage: pilot-restore.sh backup.dump EMPTY_TARGET_DATABASE_URL' >&2; exit 2; fi
pg_restore --list "$1" >/dev/null
pg_restore --no-owner --exit-on-error --dbname="$2" "$1"
