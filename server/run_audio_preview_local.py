"""Run the integrated UI and existing gunshot route for local audio preview only.

This launcher is intentionally limited to ``127.0.0.1:8011``.  It turns the
existing FastAPI application's lifespan off, preventing model preloading,
camera autostart, and the camera ticker.  Importing ``main`` still creates
isolated runtime directories and may create an isolated journal header.

The existing /api/gunshot route has no server-side user authorization.  This
local-only preview must never be exposed via a reverse proxy or a network;
loopback is not user authentication.
"""

from __future__ import annotations

import os
from pathlib import Path

import uvicorn


SERVER_DIR = Path(__file__).resolve().parent
WORKTREE_ROOT = SERVER_DIR.parent.resolve()
LOCAL_RUNTIME_DIR = (SERVER_DIR / "data" / "audio-preview-runtime").resolve()
LOCAL_WEB_DIST = (WORKTREE_ROOT / "web" / "dist").resolve()


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root)
        return True
    except ValueError:
        return False


def _require_fixed_path(variable: str, expected: Path) -> None:
    configured = os.environ.get(variable)
    if configured and Path(configured).resolve() != expected:
        raise RuntimeError(f"{variable} must be unset or point to this integration worktree's dedicated path")


def build_config() -> uvicorn.Config:
    """Build, but do not start, the fixed local-only Uvicorn configuration."""
    if not _is_within(LOCAL_RUNTIME_DIR, WORKTREE_ROOT) or not _is_within(LOCAL_WEB_DIST, WORKTREE_ROOT):
        raise RuntimeError("audio preview paths must remain inside this integration worktree")
    if not LOCAL_WEB_DIST.is_dir():
        raise RuntimeError("integrated web/dist is missing; build the frontend before launching the preview")
    _require_fixed_path("RASID_DATA_DIR", LOCAL_RUNTIME_DIR)
    _require_fixed_path("RASID_WEB_DIST", LOCAL_WEB_DIST)
    # Set these before Uvicorn imports main:app, whose config module reads them.
    os.environ["RASID_DATA_DIR"] = str(LOCAL_RUNTIME_DIR)
    os.environ["RASID_WEB_DIST"] = str(LOCAL_WEB_DIST)
    return uvicorn.Config(
        "main:app",
        host="127.0.0.1",
        port=8011,
        proxy_headers=False,
        reload=False,
        lifespan="off",
    )


if __name__ == "__main__":
    uvicorn.Server(build_config()).run()
