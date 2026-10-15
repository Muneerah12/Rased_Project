"""Regression tests for the isolated CPS local-launch boundary.

These tests use a minimal ASGI callable.  They never import ``main:app``, so
they cannot trigger the camera/model application lifespan.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.requests import Request
import uvicorn


SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import run_cps_integration_local as local_launch  # noqa: E402


async def _capture_request_client(scope, receive, send) -> None:
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send(
        {
            "type": "http.response.body",
            "body": json.dumps([Request(scope).client.host, Request(scope).client.port]).encode(),
        }
    )


async def _invoke(app) -> list[object]:
    messages: list[dict[str, object]] = []

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/cps/node-state",
        "raw_path": b"/api/cps/node-state",
        "query_string": b"",
        "headers": [(b"x-forwarded-for", b"203.0.113.9")],
        "client": ("127.0.0.1", 55000),
        "server": ("127.0.0.1", 8011),
    }
    await app(scope, receive, send)
    body = next(message["body"] for message in messages if message["type"] == "http.response.body")
    return json.loads(body)


class CpsLocalLaunchTests(unittest.TestCase):
    def test_local_launcher_uses_fixed_loopback_proxy_and_reload_settings(self) -> None:
        with patch.dict(os.environ, {"RASID_DATA_DIR": str(local_launch.LOCAL_DATA_DIR)}, clear=False):
            config = local_launch.build_config()
        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.port, 8011)
        self.assertFalse(config.proxy_headers)
        self.assertFalse(config.reload)

    def test_local_launcher_rejects_an_inherited_external_data_directory(self) -> None:
        with patch.dict(os.environ, {"RASID_DATA_DIR": str(Path("C:/not-integration-data"))}, clear=False):
            with self.assertRaises(RuntimeError):
                local_launch.build_config()

    def test_disabled_proxy_headers_preserve_request_direct_peer(self) -> None:
        config = uvicorn.Config(_capture_request_client, proxy_headers=False, lifespan="off")
        config.load()
        self.assertEqual(asyncio.run(_invoke(config.loaded_app)), ["127.0.0.1", 55000])

    def test_enabled_proxy_headers_would_rewrite_the_same_request(self) -> None:
        config = uvicorn.Config(_capture_request_client, proxy_headers=True, forwarded_allow_ips="127.0.0.1,::1", lifespan="off")
        config.load()
        self.assertEqual(asyncio.run(_invoke(config.loaded_app)), ["203.0.113.9", 0])


if __name__ == "__main__":
    unittest.main()
