from __future__ import annotations

import os
import sys
from pathlib import Path

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
