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
from app.tool_builders.computer_use import build_computer_use_tool  # noqa: E402


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


def test_hosted_browser_playwright_debug_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATKIT_HOSTED_BROWSER_HEADLESS", "false")
    monkeypatch.setenv("CHATKIT_HOSTED_BROWSER_DEBUG_PORT", "9333")
    monkeypatch.setenv("CHATKIT_HOSTED_BROWSER_DEBUG_HOST", "0.0.0.0")
    monkeypatch.setenv("DISPLAY", ":1")

    class _StubPage:
        async def goto(self, *args, **kwargs) -> None:  # pragma: no cover - non utilisé
            return None

        async def screenshot(self, **_kwargs) -> bytes:
            return b"stub-png"

    class _StubContext:
        def __init__(self) -> None:
            self._page = _StubPage()

        async def new_page(self) -> _StubPage:
            return self._page

        async def close(self) -> None:  # pragma: no cover - aucun effet
            return None

    class _StubBrowser:
        def __init__(self) -> None:
            self.context = _StubContext()

        async def new_context(self, **_kwargs) -> _StubContext:
            return self.context

        async def close(self) -> None:  # pragma: no cover - aucun effet
            return None

    class _StubChromium:
        def __init__(self) -> None:
            self.launch_kwargs: dict[str, object] | None = None

        async def launch(self, **kwargs) -> _StubBrowser:
            self.launch_kwargs = kwargs
            return _StubBrowser()

    stub_chromium = _StubChromium()

    class _StubAsyncPlaywright:
        def __init__(self) -> None:
            self.chromium = stub_chromium

        async def __aenter__(self) -> _StubAsyncPlaywright:
            return self

        async def __aexit__(self, *_exc_info) -> None:
            return None

    def _fake_async_playwright() -> _StubAsyncPlaywright:
        return _StubAsyncPlaywright()

    monkeypatch.setattr(hosted_browser, "async_playwright", _fake_async_playwright)
    monkeypatch.setattr(hosted_browser.shutil, "which", lambda _bin: "/usr/bin/Xvfb")

    async def _run() -> None:
        browser = hosted_browser.HostedBrowser(
            width=800,
            height=600,
            environment="browser",
        )
        try:
            await browser.screenshot()
            assert stub_chromium.launch_kwargs is not None
            assert stub_chromium.launch_kwargs.get("headless") is False
            launch_args = stub_chromium.launch_kwargs.get("args")
            assert isinstance(launch_args, list)
            assert "--remote-debugging-address=0.0.0.0" in launch_args
            assert "--remote-debugging-port=9333" in launch_args
            assert browser.debug_url == "http://0.0.0.0:9333"
        finally:
            await browser.close()

    asyncio.run(_run())


def test_hosted_browser_headful_without_display_spawns_xvfb(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CHATKIT_HOSTED_BROWSER_HEADLESS", "false")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.setattr(hosted_browser.shutil, "which", lambda _bin: "/usr/bin/Xvfb")

    class _StubPage:
        async def goto(self, *_args, **_kwargs) -> None:
            return None

        async def screenshot(self, **_kwargs) -> bytes:
            return b"stub-png"

    class _StubContext:
        def __init__(self) -> None:
            self._page = _StubPage()

        async def new_page(self) -> _StubPage:
            return self._page

        async def close(self) -> None:
            return None

    class _StubBrowser:
        def __init__(self) -> None:
            self.context = _StubContext()

        async def new_context(self, **_kwargs) -> _StubContext:
            return self.context

        async def close(self) -> None:
            return None

    class _StubChromium:
        def __init__(self) -> None:
            self.launch_kwargs: dict[str, object] | None = None

        async def launch(self, **kwargs) -> _StubBrowser:
            self.launch_kwargs = kwargs
            return _StubBrowser()

    stub_chromium = _StubChromium()

    class _StubAsyncPlaywright:
        def __init__(self) -> None:
            self.chromium = stub_chromium

        async def __aenter__(self) -> _StubAsyncPlaywright:
            return self

        async def __aexit__(self, *_exc_info) -> None:
            return None

    def _fake_async_playwright() -> _StubAsyncPlaywright:
        return _StubAsyncPlaywright()

    monkeypatch.setattr(hosted_browser, "async_playwright", _fake_async_playwright)

    xvfb_calls: list[tuple[tuple[str, ...], dict[str, object]]] = []
    xvfb_processes: list[_StubProcess] = []

    class _StubStream:
        async def read(self) -> bytes:
            return b""

    class _StubProcess:
        def __init__(self, args: tuple[str, ...], kwargs: dict[str, object]) -> None:
            self.args = args
            self.kwargs = kwargs
            self.returncode: int | None = None
            self.stderr = _StubStream()
            self._terminated = False

        def terminate(self) -> None:
            self._terminated = True
            self.returncode = 0

        async def wait(self) -> int:
            if self.returncode is None:
                self.returncode = 0
            return self.returncode

        def kill(self) -> None:
            self._terminated = True
            self.returncode = -9

    async def _fake_subprocess_exec(*args, **kwargs):
        if args and args[0] == "Xvfb":
            call = (tuple(args), kwargs)
            xvfb_calls.append(call)
            process = _StubProcess(tuple(args), kwargs)
            xvfb_processes.append(process)
            return process
        raise AssertionError("unexpected subprocess execution")

    monkeypatch.setattr(
        hosted_browser.asyncio,
        "create_subprocess_exec",
        _fake_subprocess_exec,
    )

    async def _run() -> None:
        browser = hosted_browser.HostedBrowser(
            width=800,
            height=600,
            environment="browser",
        )
        try:
            await browser.screenshot()
            assert len(xvfb_calls) == 1
            args, _kwargs = xvfb_calls[0]
            assert args[0] == "Xvfb"
            assert "-screen" in args
            assert stub_chromium.launch_kwargs is not None
            env = stub_chromium.launch_kwargs.get("env")
            assert isinstance(env, dict)
            assert env.get("DISPLAY") == ":99"
        finally:
            await browser.close()
            assert xvfb_processes
            assert xvfb_processes[0]._terminated is True

    asyncio.run(_run())

def test_hosted_browser_installs_browsers_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _StubPage:
        async def screenshot(self, **_kwargs) -> bytes:
            return b"stub-png"

        async def goto(self, *_args, **_kwargs) -> None:
            return None

    class _StubContext:
        def __init__(self) -> None:
            self._page = _StubPage()

        async def new_page(self) -> _StubPage:
            return self._page

        async def close(self) -> None:
            return None

    class _StubBrowser:
        def __init__(self) -> None:
            self.context = _StubContext()

        async def new_context(self, **_kwargs) -> _StubContext:
            return self.context

        async def close(self) -> None:
            return None

    class _FailingChromium:
        def __init__(self) -> None:
            self.launch_calls = 0

        async def launch(self, **_kwargs) -> _StubBrowser:
            self.launch_calls += 1
            if self.launch_calls == 1:
                raise RuntimeError("executable missing")
            return _StubBrowser()

    failing_chromium = _FailingChromium()

    class _StubAsyncPlaywright:
        def __init__(self) -> None:
            self.chromium = failing_chromium

        async def __aenter__(self) -> _StubAsyncPlaywright:
            return self

        async def __aexit__(self, *_exc_info) -> None:
            return None

    manager_calls = 0

    def _fake_async_playwright() -> _StubAsyncPlaywright:
        nonlocal manager_calls
        manager_calls += 1
        return _StubAsyncPlaywright()

    monkeypatch.setattr(hosted_browser, "async_playwright", _fake_async_playwright)

    install_args: list[tuple[tuple[str, ...], dict[str, object]]] = []

    class _Process:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return b"ok", b""

    async def _fake_subprocess_exec(*args: str, **kwargs: object) -> _Process:
        install_args.append((args, kwargs))
        return _Process()

    monkeypatch.setattr(
        hosted_browser.asyncio,
        "create_subprocess_exec",
        _fake_subprocess_exec,
    )

    async def _run() -> None:
        browser = hosted_browser.HostedBrowser(
            width=800,
            height=600,
            environment="browser",
        )
        try:
            image = await browser.screenshot()
            assert base64.b64decode(image, validate=True) == b"stub-png"
        finally:
            await browser.close()

    asyncio.run(_run())

    assert install_args, "playwright installation should have been attempted"
    assert failing_chromium.launch_calls == 2
    assert manager_calls == 2
