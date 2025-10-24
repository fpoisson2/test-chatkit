from __future__ import annotations

import asyncio
import base64
import os
import sys
from pathlib import Path

import pytest
from agents.tool import ComputerTool

# ``app`` vit à la racine du dossier ``backend`` ; on ajoute ce dossier au
# ``sys.path`` pour que les imports absolus fonctionnent lorsque ``pytest`` est
# lancé depuis ``backend`` (cas par défaut dans ce projet).
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

from app.computer import hosted_browser  # noqa: E402
from app.tool_factory import build_computer_use_tool  # noqa: E402


def test_build_computer_use_tool_returns_computer_tool() -> None:
    payload = {
        "type": "computer_use",
        "computer_use": {
            "display_width": 1280,
            "display_height": 720,
            "environment": "browser",
            "start_url": "https://example.com",
        },
    }

    tool = build_computer_use_tool(payload)

    assert isinstance(tool, ComputerTool)
    assert tool.computer.dimensions == (1280, 720)
    assert tool.computer.environment == "browser"


def test_build_computer_use_tool_handles_missing_config() -> None:
    assert build_computer_use_tool({}) is None


def test_hosted_browser_fallback_produces_png(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hosted_browser, "async_playwright", None)

    async def _run() -> None:
        browser = hosted_browser.HostedBrowser(
            width=320,
            height=240,
            environment="browser",
            start_url="https://example.org",
        )
        try:
            first_image = await browser.screenshot()
            raw = base64.b64decode(first_image, validate=True)
            assert raw.startswith(b"\x89PNG\r\n\x1a\n")
            assert int.from_bytes(raw[16:20], "big") == 320
            assert int.from_bytes(raw[20:24], "big") == 240

            await browser.click(10, 20, "left")
            second_image = await browser.screenshot()
            assert second_image != first_image
        finally:
            await browser.close()

    asyncio.run(_run())
