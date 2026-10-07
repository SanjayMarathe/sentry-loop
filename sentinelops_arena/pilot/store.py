"""Postgres queue and JSONB report store for the private pilot."""
from __future__ import annotations

import json
import os
import uuid
import psycopg
from psycopg.rows import dict_row

SCHEMA = """
CREATE TABLE IF NOT EXISTS pilot_evaluations (
 id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 owner_email text NOT NULL, status text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
 model text NOT NULL, case_ids jsonb NOT NULL, report jsonb, error text, worker_id text,
 lease_until timestamptz, interrupted_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pilot_evaluations_status ON pilot_evaluations (status, created_at);
CREATE TABLE IF NOT EXISTS pilot_sessions (
 id_hash text PRIMARY KEY, email text NOT NULL, csrf_hash text NOT NULL,
 expires_at timestamptz NOT NULL
);
"""


class Store:
    def __init__(self, url=None):
        self.url = url or os.environ["DATABASE_URL"]

    def connect(self):
        return psycopg.connect(self.url, row_factory=dict_row)

    def init(self):
        with self.connect() as db:
            db.execute("SELECT pg_advisory_xact_lock(73911543)")
            db.execute(SCHEMA)

    def enqueue(self, email, model, case_ids):
        run_id = str(uuid.uuid4())
        with self.connect() as db:
            db.execute("SELECT pg_advisory_xact_lock(73911542)")
            active = db.execute("SELECT id FROM pilot_evaluations WHERE status IN ('queued','running') FOR UPDATE").fetchone()
            if active:
                raise ValueError("An evaluation is already active.")
            db.execute("INSERT INTO pilot_evaluations (id,owner_email,status,model,case_ids) VALUES (%s,%s,'queued',%s,%s)",
                       (run_id, email, model, json.dumps(case_ids)))
        return run_id

    def list(self):
        with self.connect() as db:
            return db.execute("SELECT id,created_at,updated_at,status,model,case_ids,interrupted_count FROM pilot_evaluations ORDER BY created_at DESC LIMIT 50").fetchall()

    def get(self, run_id):
        with self.connect() as db:
            return db.execute("SELECT * FROM pilot_evaluations WHERE id=%s", (run_id,)).fetchone()

    def recover(self):
        with self.connect() as db:
            db.execute("UPDATE pilot_evaluations SET status='queued', interrupted_count=interrupted_count+1, worker_id=NULL, lease_until=NULL, updated_at=now() WHERE status='running' AND lease_until < now()")

    def claim(self, worker_id):
        with self.connect() as db:
            row = db.execute("SELECT id FROM pilot_evaluations WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED").fetchone()
            if not row:
                return None
            db.execute("UPDATE pilot_evaluations SET status='running', worker_id=%s, lease_until=now()+interval '90 seconds', updated_at=now() WHERE id=%s", (worker_id,row["id"]))
            return db.execute("SELECT * FROM pilot_evaluations WHERE id=%s", (row["id"],)).fetchone()

    def progress(self, run_id, worker_id, report):
        with self.connect() as db:
            db.execute("UPDATE pilot_evaluations SET report=%s, lease_until=now()+interval '90 seconds', updated_at=now() WHERE id=%s AND worker_id=%s AND status='running'", (json.dumps(report),run_id,worker_id))

    def finish(self, run_id, worker_id, report=None, error=None):
        with self.connect() as db:
            db.execute("UPDATE pilot_evaluations SET status=%s, report=COALESCE(%s,report), error=%s, lease_until=NULL, updated_at=now() WHERE id=%s AND worker_id=%s AND status='running'",
                       ("failed" if error else "completed", json.dumps(report) if report else None, error, run_id, worker_id))

    def create_session(self, id_hash, email, csrf_hash):
        with self.connect() as db:
            db.execute("INSERT INTO pilot_sessions (id_hash,email,csrf_hash,expires_at) VALUES (%s,%s,%s,now()+interval '8 hours')", (id_hash,email,csrf_hash))

    def session(self, id_hash):
        with self.connect() as db:
            return db.execute("SELECT email,csrf_hash FROM pilot_sessions WHERE id_hash=%s AND expires_at>now()", (id_hash,)).fetchone()

    def delete_session(self, id_hash):
        with self.connect() as db:
            db.execute("DELETE FROM pilot_sessions WHERE id_hash=%s", (id_hash,))
