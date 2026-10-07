"""Access-controlled pilot API. No demo routes or files are mounted here."""
from __future__ import annotations

import hashlib
import os
import secrets
from pathlib import Path
from uuid import UUID

from authlib.integrations.starlette_client import OAuth
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.sessions import SessionMiddleware

from sentinelops_arena.pilot.engine import SUITE
from sentinelops_arena.pilot.store import Store

UI = Path(__file__).with_name("ui")
app = FastAPI(title="Sentry Loop private pilot", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SessionMiddleware, secret_key=os.environ.get("PILOT_SESSION_SECRET", secrets.token_urlsafe(48)),
                   https_only=os.environ.get("PILOT_INSECURE_LOCAL") != "1", same_site="lax")
store = None

@app.middleware("http")
async def private_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response

def db():
    global store
    if store is None:
        store = Store()
        store.init()
    return store

def hash_token(value):
    return hashlib.sha256(value.encode()).hexdigest()

def session(request: Request):
    token = request.cookies.get("pilot_session", "")
    if not token:
        raise HTTPException(401, "Sign in to access the pilot.")
    row = db().session(hash_token(token))
    if not row:
        raise HTTPException(401, "Session expired. Sign in again.")
    return row

def require_csrf(request: Request, row):
    header = request.headers.get("x-pilot-csrf", "")
    if not header or not secrets.compare_digest(hash_token(header), row["csrf_hash"]):
        raise HTTPException(403, "CSRF token required.")
    origin = request.headers.get("origin")
    if origin:
        from urllib.parse import urlsplit
        parsed = urlsplit(origin)
        if parsed.netloc != request.headers.get("host") or (os.environ.get("PILOT_INSECURE_LOCAL") != "1" and parsed.scheme != "https"):
            raise HTTPException(403, "Invalid origin.")

def oauth_client():
    if any(not os.environ.get(key) for key in ("PILOT_OIDC_ISSUER", "PILOT_OIDC_CLIENT_ID", "PILOT_OIDC_CLIENT_SECRET")):
        raise HTTPException(503, "Pilot sign-in is not configured.")
    oauth = OAuth()
    oauth.register(name="pilot", server_metadata_url=os.environ["PILOT_OIDC_ISSUER"].rstrip("/") + "/.well-known/openid-configuration",
                   client_id=os.environ["PILOT_OIDC_CLIENT_ID"], client_secret=os.environ["PILOT_OIDC_CLIENT_SECRET"],
                   client_kwargs={"scope": "openid email profile"})
    return oauth.pilot

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/ready")
def ready():
    required = ("DATABASE_URL", "PILOT_PUBLIC_URL", "PILOT_OIDC_ISSUER", "PILOT_OIDC_CLIENT_ID",
                "PILOT_OIDC_CLIENT_SECRET", "PILOT_ALLOWED_EMAILS", "PILOT_SESSION_SECRET", "OPENAI_API_KEY")
    if any(not os.environ.get(key) for key in required):
        raise HTTPException(503, "Pilot configuration is incomplete.")
    try:
        db().list()
    except Exception:
        raise HTTPException(503, "Pilot database is unavailable.")
    return {"status": "ready"}

@app.get("/auth/login")
async def login(request: Request):
    callback = os.environ.get("PILOT_PUBLIC_URL", "").rstrip("/") + "/auth/callback" if os.environ.get("PILOT_PUBLIC_URL") else str(request.url_for("auth_callback"))
    return await oauth_client().authorize_redirect(request, callback)

@app.get("/auth/callback")
async def auth_callback(request: Request):
    client = oauth_client()
    token = await client.authorize_access_token(request)
    user = token.get("userinfo") or await client.parse_id_token(request, token)
    email = (user.get("email") or "").lower()
    allowed = {s.strip().lower() for s in os.environ.get("PILOT_ALLOWED_EMAILS", "").split(",") if s.strip()}
    if not user.get("email_verified") or email not in allowed:
        raise HTTPException(403, "Email is not on the pilot allowlist.")
    session_token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    db().create_session(hash_token(session_token), email, hash_token(csrf))
    response = RedirectResponse("/results", status_code=303)
    response.set_cookie("pilot_session", session_token, httponly=True, secure=os.environ.get("PILOT_INSECURE_LOCAL") != "1",
                        samesite="lax", max_age=28800, path="/")
    response.set_cookie("pilot_csrf", csrf, httponly=False, secure=os.environ.get("PILOT_INSECURE_LOCAL") != "1",
                        samesite="strict", max_age=28800, path="/")
    return response

@app.post("/auth/logout")
def logout(request: Request):
    row = session(request)
    require_csrf(request, row)
    db().delete_session(hash_token(request.cookies["pilot_session"]))
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie("pilot_session")
    response.delete_cookie("pilot_csrf")
    return response

@app.get("/api/me")
def me(request: Request):
    return {"email": session(request)["email"]}

class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_ids: list[str] | None = Field(default=None, min_length=1, max_length=30)

@app.post("/api/evaluations", status_code=202)
def create_evaluation(payload: EvaluationRequest, request: Request):
    row = session(request)
    require_csrf(request, row)
    model = os.environ.get("SENTRY_OPENAI_MODEL", "gpt-4.1-mini")
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(503, "Model key is not configured.")
    all_ids = [c["id"] for c in SUITE["cases"]]
    ids = payload.case_ids or all_ids
    if len(set(ids)) != len(ids) or any(i not in all_ids for i in ids):
        raise HTTPException(422, "Unknown or duplicate case ID.")
    try:
        run_id = db().enqueue(row["email"], model, ids)
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc
    return {"id": run_id, "status": "queued"}

@app.get("/api/scripted-example")
def get_scripted_example(request: Request):
    session(request)
    from sentinelops_arena.pilot.example import scripted_example
    return scripted_example()

@app.get("/api/evaluations")
def list_evaluations(request: Request):
    session(request)
    return {"evaluations": db().list()}

@app.get("/api/evaluations/{evaluation_id}")
def get_evaluation(evaluation_id: UUID, request: Request):
    session(request)
    row = db().get(str(evaluation_id))
    if not row:
        raise HTTPException(404, "Evaluation not found.")
    return row

@app.get("/assets/{asset:path}", include_in_schema=False)
def assets(asset: str, request: Request):
    session(request)
    path = (UI / asset).resolve()
    if not path.is_relative_to(UI.resolve()) or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path)

@app.get("/{path:path}", include_in_schema=False)
def page(path: str, request: Request):
    if path not in ("", "results"):
        raise HTTPException(404)
    try:
        session(request)
    except HTTPException:
        return RedirectResponse("/auth/login", status_code=303)
    return FileResponse(UI / "index.html")
