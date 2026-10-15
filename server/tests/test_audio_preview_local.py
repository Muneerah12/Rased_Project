"""Offline contract tests for the loopback-only audio preview launcher.

These tests intentionally do not load ``main:app``: importing that application
creates its allowed isolated runtime journal.  No camera, model, microphone,
or external OpenRouter request is exercised here.
"""

from __future__ import annotations

import ast
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import run_audio_preview_local as preview  # noqa: E402


class AudioPreviewLocalTests(unittest.TestCase):
    def test_fixed_local_loopback_configuration_uses_lifespan_off(self) -> None:
        with patch.dict(os.environ, {"RASID_DATA_DIR": str(preview.LOCAL_RUNTIME_DIR), "RASID_WEB_DIST": str(preview.LOCAL_WEB_DIST)}, clear=False):
            config = preview.build_config()
        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.port, 8011)
        self.assertFalse(config.proxy_headers)
        self.assertFalse(config.reload)
        self.assertEqual(config.lifespan, "off")

    def test_rejects_runtime_or_dist_paths_outside_the_integration_worktree(self) -> None:
        with patch.dict(os.environ, {"RASID_DATA_DIR": "C:/outside/runtime"}, clear=False):
            with self.assertRaises(RuntimeError):
                preview.build_config()
        with patch.dict(os.environ, {"RASID_WEB_DIST": "C:/outside/dist"}, clear=False):
            with self.assertRaises(RuntimeError):
                preview.build_config()

    def test_existing_application_declares_audio_route_and_static_fallback(self) -> None:
        tree = ast.parse((SERVER_DIR / "main.py").read_text(encoding="utf-8"))
        routes = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for decorator in node.decorator_list:
                    if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute) and decorator.args:
                        if isinstance(decorator.args[0], ast.Constant):
                            routes.append((decorator.func.attr, decorator.args[0].value))
        self.assertIn(("post", "/api/gunshot"), routes)
        self.assertIn(("get", "/{path:path}"), routes)


if __name__ == "__main__":
    unittest.main()
