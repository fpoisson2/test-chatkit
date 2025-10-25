"""SIP registration helpers built around :mod:`aiosip`.

The module introduces a small abstraction that keeps a SIP ``REGISTER``
dialogue alive in the background.  The :class:`SIPRegistrationManager`
follows a push model where the application provides
:class:`SIPRegistrationConfig` instances via :meth:`apply_config`.  When a
configuration is supplied the manager will:

* open a SIP dialog using :mod:`aiosip`,
* send an initial ``REGISTER`` request,
* refresh the registration periodically before it expires, and
* send ``UNREGISTER`` (``REGISTER`` with ``Expires: 0``) when the manager is
  stopped or when the configuration is cleared.

If no configuration is provided the manager simply idles.  Any
``aiosip``-specific exceptions raised during registration (for instance
``aiosip.exceptions.RegisterFailed``) are allowed to propagate to the caller
of :meth:`start` via the task's exception.  Consumers may inspect
:attr:`SIPRegistrationManager.last_error` to retrieve the most recent failure.

``aiosip`` still relies on a few interfaces that were removed from the Python
standard library in 3.12.  The module therefore applies a small compatibility
shim before importing ``aiosip`` so that the dependency can be used without
requiring patches in the caller's environment.

:raises RuntimeError: if a SIP configuration is applied while ``aiosip`` could
    not be imported.
"""

from __future__ import annotations

import asyncio
import collections
import contextlib
import logging
import types
from dataclasses import dataclass
from typing import Any

if not hasattr(asyncio, "coroutine"):  # pragma: no cover - compatibility shim
    asyncio.coroutine = types.coroutine  # type: ignore[attr-defined]

if not hasattr(collections, "MutableMapping"):  # pragma: no cover - compatibility shim
    import collections.abc as _collections_abc

    collections.MutableMapping = _collections_abc.MutableMapping  # type: ignore[attr-defined]

try:  # pragma: no cover - imported for its side effects only
    import aiosip
except Exception as exc:  # pragma: no cover - exercised when dependency missing
    aiosip = None  # type: ignore[assignment]
    _AIOSIP_IMPORT_ERROR = exc
else:
    _AIOSIP_IMPORT_ERROR = None

__all__ = ["SIPRegistrationConfig", "SIPRegistrationManager"]

LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class SIPRegistrationConfig:
    """Configuration required to register a SIP AOR with ``REGISTER``.

    Parameters
    ----------
    uri:
        Address-of-record (AOR) to register, for example ``"sip:alice@example"``.
        The registrar's host and port are extracted from this value.
    username:
        Username used in the ``Authorization`` header when the registrar
        challenges the request.  Typically the same as the user part of the AOR.
    password:
        Plain-text password associated with ``username``.  The value is passed
        to :mod:`aiosip` which handles the digest authentication handshake.
    contact_host:
        Hostname or IP address advertised in the ``Contact`` header.  This
        points the registrar to the machine that should receive SIP requests
        for the registered AOR.
    contact_port:
        Port number exposed by the local SIP stack.  The manager does not open
        this port itself; it merely informs the registrar about it.
    expires:
        Desired registration lifetime in seconds.  The manager refreshes the
        binding before the deadline using this value.
    """

    uri: str
    username: str
    password: str
    contact_host: str
    contact_port: int
    expires: int = 3600

    def contact_uri(self) -> str:
        """Return a ``Contact`` header suitable for :mod:`aiosip` dialogs."""

        return f"<sip:{self.username}@{self.contact_host}:{self.contact_port}>"


class SIPRegistrationManager:
    """Maintain a SIP ``REGISTER`` dialog in the background.

    Parameters
    ----------
    loop:
        Event loop used to schedule the background task.  Defaults to the
        current loop returned by :func:`asyncio.get_event_loop`.
    retry_interval:
        Initial backoff delay (in seconds) applied when the registration fails.
        The delay grows exponentially up to ``max_retry_interval``.
    max_retry_interval:
        Upper bound (in seconds) for the exponential backoff when the registrar
        cannot be reached or rejects the request.
    refresh_margin:
        Fraction of :attr:`SIPRegistrationConfig.expires` used to determine how
        long the manager waits before refreshing the binding.  A value of ``0.8``
        means the refresh will happen after 80%% of the expiration window.
    register_timeout:
        Maximum amount of seconds to wait for ``REGISTER``/``UNREGISTER``
        responses before giving up on the attempt.

    Notes
    -----
    ``start()`` must be called from a running event loop; the manager spawns an
    :class:`asyncio.Task` that executes :meth:`_run_loop`.  All I/O happens in
    that task.  Consumers should await :meth:`stop` to guarantee that a final
    ``UNREGISTER`` message was emitted.
    """

    def __init__(
        self,
        *,
        loop: asyncio.AbstractEventLoop | None = None,
        retry_interval: float = 5.0,
        max_retry_interval: float = 60.0,
        refresh_margin: float = 0.8,
        register_timeout: float = 10.0,
    ) -> None:
        self._loop = loop or asyncio.get_event_loop()
        self._retry_interval = float(retry_interval)
        self._max_retry_interval = float(max_retry_interval)
        self._refresh_margin = float(refresh_margin)
        self._register_timeout = float(register_timeout)

        self._config: SIPRegistrationConfig | None = None
        self._active_config: SIPRegistrationConfig | None = None
        self._reload_event = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._stop_requested = False

        self._app: Any | None = None
        self._dialog: Any | None = None
        self._last_error: BaseException | None = None

    @property
    def last_error(self) -> BaseException | None:
        """Return the most recent registration exception, if any."""

        return self._last_error

    def apply_config(self, new_config: SIPRegistrationConfig | None) -> None:
        """Apply a new SIP configuration.

        Parameters
        ----------
        new_config:
            ``None`` disables the registration loop and triggers an ``UNREGISTER``
            if a dialog was active.  Passing a configuration stores it for the
            next iteration of the background task.  The manager does not clone
            the dataclass; callers should treat the passed instance as
            immutable.

        Raises
        ------
        RuntimeError
            Raised immediately if ``aiosip`` could not be imported.  This mirrors
            the behaviour that the subsequent registration attempt would expose
            inside the background task.
        """

        if new_config is not None and aiosip is None:
            raise RuntimeError("aiosip is not available") from _AIOSIP_IMPORT_ERROR

        self._config = new_config
        self._reload_event.set()

    def start(self) -> None:
        """Start the background registration task if it is not already running."""

        if self._task and not self._task.done():
            return

        self._stop_requested = False
        self._reload_event.set()
        self._task = self._loop.create_task(self._run_loop(), name="sip-registration")

    async def stop(self) -> None:
        """Stop the background task and perform a final ``UNREGISTER``.

        The coroutine waits until the background task has completed and
        therefore guarantees that the SIP dialog (if any) has been closed.
        """

        if not self._task:
            return

        self._stop_requested = True
        self._reload_event.set()

        task = self._task
        try:
            await task
        finally:
            self._task = None

    async def _run_loop(self) -> None:
        backoff = self._retry_interval
        try:
            while not self._stop_requested:
                await self._reload_event.wait()
                self._reload_event.clear()

                if self._stop_requested:
                    break

                config = self._config
                if config is None:
                    await self._unregister()
                    continue

                try:
                    await self._register_once(config)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # pragma: no cover - network failures
                    self._last_error = exc
                    LOGGER.exception("SIP registration attempt failed", exc_info=exc)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, self._max_retry_interval)
                    continue

                backoff = self._retry_interval
                refresh_after = max(1.0, config.expires * self._refresh_margin)

                try:
                    await asyncio.wait_for(
                        self._reload_event.wait(), timeout=refresh_after
                    )
                except asyncio.TimeoutError:
                    self._reload_event.set()

        finally:
            await self._unregister()

    async def _register_once(self, config: SIPRegistrationConfig) -> None:
        """Send a single ``REGISTER`` request for ``config``.

        Raises
        ------
        RuntimeError
            If ``aiosip`` is not available in the environment.
        aiosip.exceptions.RegisterFailed
            When the registrar rejects the authentication or responds with an
            error status code.
        asyncio.TimeoutError
            If the registrar does not respond within ``register_timeout`` seconds.
        """

        if aiosip is None:  # pragma: no cover - enforced via apply_config
            raise RuntimeError("aiosip is not available") from _AIOSIP_IMPORT_ERROR

        if self._active_config != config:
            await self._unregister()

        if self._app is None:
            self._app = aiosip.Application(loop=self._loop)

        registrar_contact = aiosip.Contact.from_header(config.uri)
        remote_host = registrar_contact["uri"]["host"]
        remote_port = registrar_contact["uri"].get("port") or 5060
        remote_addr = (remote_host, remote_port)
        local_addr = (config.contact_host, config.contact_port)

        if self._dialog is None:
            self._dialog = await self._app.start_dialog(
                from_uri=config.uri,
                to_uri=config.uri,
                contact_uri=config.contact_uri(),
                local_addr=local_addr,
                remote_addr=remote_addr,
                password=config.password,
            )

        register_future = self._dialog.register(expires=config.expires)
        await asyncio.wait_for(register_future, timeout=self._register_timeout)

        self._active_config = config

    async def _unregister(self) -> None:
        """Send ``UNREGISTER`` (if needed) and dispose of the SIP dialog."""

        dialog = self._dialog
        app = self._app

        self._dialog = None
        self._app = None
        self._active_config = None

        if dialog is not None:
            with contextlib.suppress(Exception):  # pragma: no cover - network dependent
                unregister_future = dialog.register(expires=0)
                await asyncio.wait_for(
                    unregister_future, timeout=self._register_timeout
                )

            with contextlib.suppress(Exception):
                dialog.close()

        if app is not None:
            with contextlib.suppress(Exception):  # pragma: no cover - network dependent
                await asyncio.wait_for(app.finish(), timeout=self._register_timeout)
