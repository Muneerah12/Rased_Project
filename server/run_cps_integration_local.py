"""Run the CPS read-only bridge for isolated local development only.

This launcher binds only to 127.0.0.1 and disables Uvicorn proxy-header
processing so ``Request.client`` is the direct peer seen by the CPS route
guard.  It is not a production launcher and must never sit behind a reverse
proxy or be exposed to a network: loopback access is not user authentication.

It deliberately uses ``server/data`` within this integration worktree.  An
inherited RASID_DATA_DIR pointing elsewhere is rejected rather than risking
use of an operational data directory.
"""

from __future__ import annotations

import os
from pathlib import Path

import uvicorn


SERVER_DIR = Path(__file__).resolve().parent
LOCAL_DATA_DIR = (SERVER_DIR / "data").resolve()


def build_config() -> uvicorn.Config:
    """Return the fixed local-only Uvicorn configuration without starting it."""
    configured_data_dir = os.environ.get("RASID_DATA_DIR")
    if configured_data_dir and Path(configured_data_dir).resolve() != LOCAL_DATA_DIR:
        raise RuntimeError(
            "RASID_DATA_DIR must be unset or point to this integration worktree's server/data directory"
        )
    os.environ["RASID_DATA_DIR"] = str(LOCAL_DATA_DIR)
    return uvicorn.Config(
        "main:app",
        host="127.0.0.1",
        port=8011,
        proxy_headers=False,
        reload=False,
    )


if __name__ == "__main__":
    uvicorn.Server(build_config()).run()
