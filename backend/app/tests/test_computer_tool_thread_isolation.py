from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import sys
import os

BACKEND_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BACKEND_DIR.parent

for path_candidate in (BACKEND_DIR, ROOT_DIR):
    if str(path_candidate) not in sys.path:
        sys.path.insert(0, str(path_candidate))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

from agents.tool import ComputerTool
from chatkit.agents import get_current_computer_tool as sdk_get_current_computer_tool

from app.chatkit.agent_registry import computer_tool_context, set_current_computer_tool


class _DummyComputer:
    def __init__(self, debug_url: str) -> None:
        self._debug_url = debug_url

    @property
    def debug_url(self) -> str:
        return self._debug_url


def _extract_debug_url(tool: Any) -> str | None:
    computer = getattr(tool, "computer", None)
    debug_url = getattr(computer, "debug_url", None)
    if callable(debug_url):
        return debug_url()
    return debug_url


def _run_thread(debug_url: str) -> tuple[str | None, str | None, str | None]:
    before_tool = sdk_get_current_computer_tool()

    with computer_tool_context(ComputerTool(computer=_DummyComputer(debug_url))):
        active_tool = sdk_get_current_computer_tool()
        active_url = _extract_debug_url(active_tool)

    after_tool = sdk_get_current_computer_tool()

    return (
        _extract_debug_url(before_tool),
        active_url,
        _extract_debug_url(after_tool),
    )


def test_computer_tool_does_not_leak_between_thread_runs() -> None:
    """Ensure debug_url state is isolated when threads are reused."""

    set_current_computer_tool(None)

    with ThreadPoolExecutor(max_workers=1) as executor:
        first_before, first_active, first_after = executor.submit(
            _run_thread, "http://debug/thread-one"
        ).result()
        second_before, second_active, second_after = executor.submit(
            _run_thread, "http://debug/thread-two"
        ).result()

    assert first_before is None
    assert first_active == "http://debug/thread-one"
    assert first_after is None

    assert second_before is None
    assert second_active == "http://debug/thread-two"
    assert second_after is None
