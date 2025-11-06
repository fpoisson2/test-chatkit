import logging
import sys
import types
from concurrent.futures import Future
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND_DIR / "app"
TELEPHONY_DIR = APP_DIR / "telephony"


def ensure_backend_package_stub() -> None:
    """Ensure lightweight package stubs exist to bypass FastAPI imports."""

    if "backend" not in sys.modules:
        backend_module = types.ModuleType("backend")
        backend_module.__path__ = [str(BACKEND_DIR)]
        sys.modules["backend"] = backend_module

    if "backend.app" not in sys.modules:
        app_module = types.ModuleType("backend.app")
        app_module.__path__ = [str(APP_DIR)]
        sys.modules["backend.app"] = app_module

    if "backend.app.telephony" not in sys.modules:
        telephony_module = types.ModuleType("backend.app.telephony")
        telephony_module.__path__ = [str(TELEPHONY_DIR)]
        sys.modules["backend.app.telephony"] = telephony_module


def load_async_helpers_module():
    ensure_backend_package_stub()
    module_name = "backend.app.telephony.async_helpers"
    sys.modules.pop(module_name, None)
    spec = spec_from_file_location(module_name, TELEPHONY_DIR / "async_helpers.py")
    if spec is None or spec.loader is None:  # pragma: no cover - guardrail
        raise ImportError(f"Unable to load {module_name}")
    module = module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_schedule_coroutine_logs_coroutine_exception(caplog):
    module = load_async_helpers_module()
    exc_msg = "boom"
    async def dummy() -> None:
        raise RuntimeError(exc_msg)

    loop = object()
    future = Future()
    future.set_exception(RuntimeError(exc_msg))

    with patch(
        "backend.app.telephony.async_helpers.asyncio.run_coroutine_threadsafe",
        return_value=future,
    ) as mock_run:
        test_logger = logging.getLogger("test.schedule_coroutine.exception")
        with caplog.at_level(logging.ERROR, logger=test_logger.name):
            coro = dummy()
            module.schedule_coroutine_from_thread(
                coro,
                loop,
                callback_name="test",
                logger=test_logger,
            )
        mock_run.assert_called_once_with(coro, loop)
        coro.close()
    assert any("Exception in test" in message for message in caplog.messages)


def test_schedule_coroutine_logs_scheduling_failure(caplog):
    module = load_async_helpers_module()

    async def dummy() -> None:
        pass

    loop = object()

    with patch(
        "backend.app.telephony.async_helpers.asyncio.run_coroutine_threadsafe",
        side_effect=RuntimeError("fail"),
    ):
        test_logger = logging.getLogger("test.schedule_coroutine.failure")
        with caplog.at_level(logging.ERROR, logger=test_logger.name):
            coro = dummy()
            module.schedule_coroutine_from_thread(
                coro,
                loop,
                callback_name="failure",
                logger=test_logger,
            )
        coro.close()

    assert any("Failed to schedule failure" in message for message in caplog.messages)

