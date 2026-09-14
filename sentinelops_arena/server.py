"""HTTP server for SentinelOps Arena.

Endpoints:
    POST /reset  -- Reset environment
    POST /step   -- Execute an action (including ListToolsAction, CallToolAction)
    GET  /state  -- Get current state
    GET  /schema -- Get action/observation schemas
    WS   /ws     -- WebSocket for persistent sessions

Usage:
    uvicorn sentinelops_arena.server:app --host 0.0.0.0 --port 8000
"""

from openenv.core.env_server.http_server import create_app

from .environment import SentinelOpsArena
from .models import SentinelAction, SentinelObservation

app = create_app(
    SentinelOpsArena,
    SentinelAction,
    SentinelObservation,
    env_name="sentinelops_arena",
    max_concurrent_envs=5,
)


def main(host: str = "0.0.0.0", port: int = 8000) -> None:
    import uvicorn

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    main(port=args.port)
