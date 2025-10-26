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
import errno
import inspect
import ipaddress
import logging
import secrets
import socket
import types
import urllib.parse
from collections.abc import Awaitable, Callable, Mapping, MutableMapping
from dataclasses import dataclass, replace
from typing import Any

from multidict import CIMultiDict

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

    # ``aiosip`` 0.1.0 parses ``WWW-Authenticate`` challenge parameters by
    # splitting on the literal string `", "`.  Some SIP servers (including the
    # version of Asterisk used in our tests) omit the space after commas, which
    # makes the upstream parser crash with ``ValueError``.  Monkey patch the
    # classmethod to accept both formats until the library grows a proper fix.
    from aiosip import auth as _aiosip_auth

    def _robust_from_authenticate_header(
        cls: type[_aiosip_auth.Auth],
        authenticate: str,
        method: str,
        uri: str,
        username: str,
        password: str,
    ) -> _aiosip_auth.Auth:
        auth = cls()

        if not authenticate.startswith("Digest"):
            msg = "Authentication method not supported"
            raise ValueError(msg)

        auth.method = "Digest"
        params = authenticate[7:]
        for param in params.split(","):
            key, sep, value = param.strip().partition("=")
            if not sep:
                continue
            value = value.strip()
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            auth[key] = value

        auth["username"] = username
        auth["uri"] = uri

        ha1 = _aiosip_auth.md5digest(username, auth["realm"], password)
        ha2 = _aiosip_auth.md5digest(method, uri)

        qop_value = auth.get("qop")
        qop_token: str | None = None
        if qop_value:
            candidates = [candidate.strip() for candidate in qop_value.split(",")]
            candidates = [candidate for candidate in candidates if candidate]
            if candidates:
                for candidate in candidates:
                    if candidate.lower() == "auth":
                        qop_token = candidate
                        break
                if qop_token is None:
                    qop_token = candidates[0]

        if qop_token:
            cnonce = secrets.token_hex(16)
            nc_value = "00000001"
            auth["qop"] = qop_token
            auth["cnonce"] = cnonce
            auth["nc"] = nc_value
            auth["response"] = _aiosip_auth.md5digest(
                ha1, auth["nonce"], nc_value, cnonce, qop_token, ha2
            )
        else:
            auth["response"] = _aiosip_auth.md5digest(ha1, auth["nonce"], ha2)
        return auth

    _aiosip_auth.Auth.from_authenticate_header = classmethod(  # type: ignore[assignment]
        _robust_from_authenticate_header
    )

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AppSettings
from .invite_handler import send_sip_reply

__all__ = ["SIPRegistrationConfig", "SIPRegistrationManager"]

LOGGER = logging.getLogger(__name__)

_DEFAULT_SIP_PORT = 5060

_OPTIONS_ALLOW_HEADER = (
    "INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, SUBSCRIBE, NOTIFY, INFO, PUBLISH"
)


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
    transport: str | None = None
    bind_host: str | None = None
    expires: int = 3600

    def contact_uri(self) -> str:
        """Return a ``Contact`` header suitable for :mod:`aiosip` dialogs."""

        transport_suffix = ""
        if self.transport:
            transport_suffix = f";transport={self.transport}"
        return (
            f"<sip:{self.username}@{self.contact_host}:{self.contact_port}"
            f"{transport_suffix}>"
        )


InviteRouteHandler = Callable[[Any, Any], Awaitable[None]]


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
        session_factory: Any | None = None,
        settings: Any | None = None,
        contact_host: str | None = None,
        contact_port: int | None = None,
        contact_transport: str | None = None,
        bind_host: str | None = None,
        invite_handler: InviteRouteHandler | None = None,
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

        self.session_factory = session_factory
        self.settings = settings
        self.contact_host = contact_host
        self.contact_port = contact_port
        self.contact_transport = self._normalize_transport(contact_transport)
        self.bind_host = bind_host
        self._invite_handler: InviteRouteHandler | None = invite_handler

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
        if new_config is None:
            LOGGER.info("Enregistrement SIP désactivé")
        else:
            LOGGER.info(
                "Enregistrement SIP mis à jour : trunk %s (contact %s:%s)",
                new_config.uri,
                new_config.contact_host,
                new_config.contact_port,
            )
        self._reload_event.set()

    @property
    def active_config(self) -> SIPRegistrationConfig | None:
        """Return the SIP configuration currently applied to the dialog."""

        return self._active_config

    def set_invite_handler(self, handler: InviteRouteHandler | None) -> None:
        """Register or remove the coroutine invoked for incoming ``INVITE``."""

        self._invite_handler = handler
        app = self._app
        if app is not None:
            self._configure_invite_route(app)

    def _configure_invite_route(self, app: Any) -> None:
        router = getattr(app, "router", None)
        if router is None:
            return

        self._configure_options_route(router)

        if self._invite_handler is None:
            if hasattr(router, "routes") and isinstance(router.routes, dict):
                router.routes.pop("INVITE", None)
            return

        add_route = getattr(router, "add_route", None)
        if callable(add_route):
            add_route("INVITE", self._invite_handler)
        elif hasattr(router, "routes") and isinstance(router.routes, dict):
            router.routes["INVITE"] = self._invite_handler

    def _configure_options_route(self, router: Any) -> None:
        add_route = getattr(router, "add_route", None)
        handler = self._handle_incoming_options
        if callable(add_route):
            add_route("OPTIONS", handler)
            return

        routes = getattr(router, "routes", None)
        if isinstance(routes, dict):
            routes["OPTIONS"] = handler

    async def _handle_incoming_options(self, dialog: Any, request: Any) -> None:
        call_id: str | None = None
        headers_obj = getattr(request, "headers", None)
        if isinstance(headers_obj, Mapping):
            call_id = (
                headers_obj.get("Call-ID")
                or headers_obj.get("call-id")
                or headers_obj.get("Call-id")
            )

        contact_uri: str | None = None
        config = self._active_config or self._config
        if config is not None:
            with contextlib.suppress(Exception):
                contact_uri = config.contact_uri()

        try:
            await send_sip_reply(
                dialog,
                200,
                reason="OK",
                headers={"Allow": _OPTIONS_ALLOW_HEADER},
                call_id=call_id,
                contact_uri=contact_uri,
                log=False,
            )
        except Exception:  # pragma: no cover - network dependent
            LOGGER.exception("Impossible de répondre à la requête SIP OPTIONS")

    async def start(self) -> None:
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
                    try:
                        await asyncio.wait_for(
                            self._reload_event.wait(), timeout=backoff
                        )
                    except asyncio.TimeoutError:
                        self._reload_event.set()
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
            self._configure_invite_route(self._app)

        remote_host, remote_port = self._parse_registrar_endpoint(config.uri)
        if remote_host is None:
            raise ValueError("URI de trunk SIP invalide : hôte introuvable")
        resolved_host, resolved_port = self._resolve_registrar_socket(
            remote_host, remote_port
        )
        if resolved_host != remote_host or resolved_port != remote_port:
            LOGGER.debug(
                "Résolution du registrar SIP %s:%s vers %s:%s",
                remote_host,
                remote_port,
                resolved_host,
                resolved_port,
            )
        remote_addr = (resolved_host, resolved_port)
        local_host = config.bind_host or config.contact_host
        local_addr = (local_host, config.contact_port)

        request_uri = self._registrar_request_uri(config.uri)

        if self._dialog is None:
            dialog_kwargs = self._dialog_transport_kwargs(config.transport)
            bind_error: BaseException | None = None
            while self._dialog is None:
                try:
                    self._dialog = await self._app.start_dialog(
                        from_uri=config.uri,
                        to_uri=request_uri,
                        contact_uri=config.contact_uri(),
                        local_addr=local_addr,
                        remote_addr=remote_addr,
                        password=config.password,
                        **dialog_kwargs,
                    )
                except OSError as exc:
                    bind_error = exc
                    fallback_config = self._fallback_bind_host(config, exc)
                    if fallback_config is not None:
                        config = fallback_config
                        local_host = config.bind_host or config.contact_host
                        local_addr = (local_host, config.contact_port)
                        dialog_kwargs = self._dialog_transport_kwargs(
                            config.transport
                        )
                        continue

                    fallback_config = self._fallback_contact_port(config, exc)
                    if fallback_config is None:
                        break
                    config = fallback_config
                    local_host = config.bind_host or config.contact_host
                    local_addr = (local_host, config.contact_port)
                    dialog_kwargs = self._dialog_transport_kwargs(config.transport)
                    continue
                break

            if self._dialog is None:
                assert bind_error is not None
                raise ValueError(
                    "Impossible d'ouvrir une socket SIP locale sur "
                    f"{local_host}:{config.contact_port} : {bind_error}. "
                    "Vérifiez que l'hôte de contact correspond à une interface "
                    "réseau locale et que le port n'est pas déjà utilisé."
                ) from bind_error

        if self._dialog is not None:
            self._ensure_dialog_username(self._dialog, config.username)

        register_headers = self._build_register_headers(config)
        register_future = self._call_dialog_register(
            self._dialog, expires=config.expires, headers=register_headers
        )
        await asyncio.wait_for(register_future, timeout=self._register_timeout)

        LOGGER.info(
            "Enregistrement SIP réussi auprès de %s:%s", remote_host, remote_port
        )
        self._last_error = None
        self._active_config = config
        self._config = config

    async def _unregister(self) -> None:
        """Send ``UNREGISTER`` (if needed) and dispose of the SIP dialog."""

        dialog = self._dialog
        app = self._app
        previous_config = self._active_config

        self._dialog = None
        self._app = None
        self._active_config = None

        if dialog is not None:
            with contextlib.suppress(Exception):  # pragma: no cover - network dependent
                headers = (
                    self._build_register_headers(previous_config)
                    if previous_config is not None
                    else None
                )
                unregister_future = self._call_dialog_register(
                    dialog, expires=0, headers=headers
                )
                await asyncio.wait_for(
                    unregister_future, timeout=self._register_timeout
                )

            with contextlib.suppress(Exception):
                dialog.close()

        if app is not None:
            with contextlib.suppress(Exception):  # pragma: no cover - network dependent
                await asyncio.wait_for(app.finish(), timeout=self._register_timeout)

        if previous_config is not None:
            LOGGER.info("Enregistrement SIP arrêté pour %s", previous_config.uri)

    async def apply_config_from_settings(
        self, session: Session, settings: AppSettings | None
    ) -> None:
        """Build and apply a SIP configuration from admin settings."""

        stored_settings = settings
        if stored_settings is None:
            stored_settings = session.scalar(select(AppSettings).limit(1))

        runtime_settings = self.settings

        username = None
        if stored_settings is not None:
            username = self._normalize_optional_string(
                getattr(stored_settings, "sip_trunk_username", None)
            )
        if not username and runtime_settings is not None:
            username = self._normalize_optional_string(
                getattr(runtime_settings, "sip_username", None)
            )

        password = None
        if stored_settings is not None:
            password = self._normalize_optional_string(
                getattr(stored_settings, "sip_trunk_password", None)
            )
        if not password and runtime_settings is not None:
            password = self._normalize_optional_string(
                getattr(runtime_settings, "sip_password", None)
            )

        if not username or not password:
            LOGGER.warning(
                "Impossible d'initialiser l'enregistrement SIP : identifiants "
                "SIP manquants",
            )
            self.apply_config(None)
            return

        trunk_uri = self._resolve_trunk_uri(stored_settings, username)
        if trunk_uri is None:
            LOGGER.info(
                "Enregistrement SIP désactivé : aucun trunk SIP n'est configuré"
            )
            self.apply_config(None)
            return

        normalized_trunk_uri = self._normalize_trunk_uri(trunk_uri, str(username))
        if normalized_trunk_uri is None:
            LOGGER.warning(
                "Impossible d'initialiser l'enregistrement SIP : "
                "URI de trunk SIP invalide",
            )
            self.apply_config(None)
            return

        contact_host, contact_port, contact_transport = self._resolve_contact_endpoint(
            stored_settings, normalized_trunk_uri
        )
        if not contact_host or contact_port is None:
            LOGGER.warning(
                "Impossible d'initialiser l'enregistrement SIP : contact "
                "sip_contact_host/sip_contact_port manquant",
            )
            self.apply_config(None)
            return

        bind_host = self._resolve_bind_host(contact_host)

        config = SIPRegistrationConfig(
            uri=normalized_trunk_uri,
            username=str(username),
            password=str(password),
            contact_host=str(contact_host),
            contact_port=int(contact_port),
            transport=contact_transport,
            bind_host=bind_host,
        )
        LOGGER.info(
            "Configuration SIP prête : trunk %s (contact %s:%s, transport=%s)",
            config.uri,
            config.contact_host,
            config.contact_port,
            config.transport or "par défaut",
        )
        self.apply_config(config)

    def _resolve_trunk_uri(
        self, stored_settings: AppSettings | None, username: str | None
    ) -> str | None:
        """Return the trunk URI from admin settings or runtime overrides."""

        if stored_settings is not None:
            candidate = self._normalize_optional_string(
                getattr(stored_settings, "sip_trunk_uri", None)
            )
            if candidate:
                return candidate

        runtime_settings = self.settings
        if runtime_settings is None:
            return None

        candidate = self._normalize_optional_string(
            getattr(runtime_settings, "sip_trunk_uri", None)
        )
        if candidate:
            return candidate

        registrar = self._normalize_optional_string(
            getattr(runtime_settings, "sip_registrar", None)
        )
        if not registrar:
            return None

        lower = registrar.lower()
        if lower.startswith("sip:") or lower.startswith("sips:"):
            return registrar

        if not username:
            return None

        return f"sip:{username}@{registrar}"

    def _resolve_contact_endpoint(
        self, stored_settings: AppSettings | None, trunk_uri: str
    ) -> tuple[str | None, int | None, str | None]:
        """Determine the contact host/port used for registration."""

        contact_host = self._normalize_optional_string(self.contact_host)
        if contact_host is None and stored_settings is not None:
            contact_host = self._normalize_optional_string(
                getattr(stored_settings, "sip_contact_host", None)
            )
        if contact_host is None and self.settings is not None:
            contact_host = self._normalize_optional_string(
                getattr(self.settings, "sip_contact_host", None)
            )

        raw_port: int | str | None = None
        if self.contact_port is not None:
            raw_port = self.contact_port
        elif stored_settings is not None:
            stored_port = getattr(stored_settings, "sip_contact_port", None)
            if stored_port is not None:
                raw_port = stored_port
        if raw_port is None and self.settings is not None:
            raw_port = getattr(self.settings, "sip_contact_port", None)

        auto_detect_port = False
        if isinstance(raw_port, str):
            stripped_port = raw_port.strip()
            if stripped_port == "":
                raw_port = None
            elif stripped_port == "0":
                auto_detect_port = True
            else:
                raw_port = stripped_port
        elif isinstance(raw_port, int) and raw_port == 0:
            auto_detect_port = True

        contact_port = None if auto_detect_port else self._normalize_port(raw_port)

        transport = self._normalize_transport(self.contact_transport)
        if transport is None and stored_settings is not None:
            transport = self._normalize_transport(
                getattr(stored_settings, "sip_contact_transport", None)
            )
        if transport is None and self.settings is not None:
            transport = self._normalize_transport(
                getattr(self.settings, "sip_contact_transport", None)
            )

        registrar_host, _ = self._parse_registrar_endpoint(trunk_uri)
        if (
            contact_host
            and registrar_host
            and contact_host.casefold() == registrar_host.casefold()
        ):
            LOGGER.warning(
                "Hôte de contact SIP %s identique au registrar %s, "
                "détection automatique d'une adresse locale.",
                contact_host,
                registrar_host,
            )
            contact_host = None

        if contact_host is None:
            inferred_host = self._infer_contact_host(trunk_uri)
            if inferred_host:
                LOGGER.info(
                    "Hôte de contact SIP déduit automatiquement : %s",
                    inferred_host,
                )
                contact_host = inferred_host

        if auto_detect_port:
            if not contact_host:
                LOGGER.warning(
                    "Impossible d'initialiser l'enregistrement SIP : "
                    "détection automatique du port impossible sans hôte de contact",
                )
                return None, None, transport

            detected_port = self._find_available_contact_port(contact_host)
            if detected_port is None:
                LOGGER.warning(
                    "Impossible d'initialiser l'enregistrement SIP : "
                    "détection automatique du port SIP impossible",
                )
                return None, None, transport

            LOGGER.info(
                "Port SIP détecté automatiquement pour %s : %s",
                contact_host,
                detected_port,
            )
            contact_port = detected_port

        if contact_port is None:
            contact_port = _DEFAULT_SIP_PORT

        return contact_host, contact_port, transport

    def _resolve_bind_host(self, contact_host: str | None) -> str | None:
        """Choose the local interface used to bind the SIP socket."""

        candidate = self._normalize_optional_string(self.bind_host)
        if candidate:
            return candidate

        if self.settings is not None:
            configured = self._normalize_optional_string(
                getattr(self.settings, "sip_bind_host", None)
            )
            if configured:
                return configured

        if not contact_host:
            return None

        try:
            ip = ipaddress.ip_address(contact_host)
        except ValueError:
            # Domain names or other non-IP hosts should bind on all interfaces.
            return "0.0.0.0"

        if ip.version == 6:
            if ip.is_unspecified or ip.is_loopback:
                return str(ip)
            if ip.is_private or ip.is_link_local:
                return str(ip)
            return "::"

        if ip.is_unspecified or ip.is_loopback or ip.is_private or ip.is_link_local:
            return str(ip)

        # Public IPv4 addresses are unlikely to be assigned locally when the
        # service runs behind NAT; listen on all interfaces instead.
        return "0.0.0.0"

    def _fallback_contact_port(
        self, config: SIPRegistrationConfig, exc: OSError
    ) -> SIPRegistrationConfig | None:
        """Handle contact port binding errors with an automatic fallback."""

        if exc.errno != errno.EADDRINUSE:
            return None

        candidate_port = self._find_available_contact_port(config.contact_host)
        if candidate_port is None:
            LOGGER.warning(
                "Port SIP %s indisponible sur %s et aucun port alternatif "
                "n'a pu être détecté automatiquement.",
                config.contact_port,
                config.contact_host,
            )
            return None

        LOGGER.warning(
            "Port SIP %s indisponible sur %s, tentative avec le port %s.",
            config.contact_port,
            config.contact_host,
            candidate_port,
        )
        updated = replace(config, contact_port=candidate_port)
        self._config = updated
        return updated

    def _fallback_bind_host(
        self, config: SIPRegistrationConfig, exc: OSError
    ) -> SIPRegistrationConfig | None:
        """Handle binding errors when the configured host is unavailable."""

        if exc.errno not in {errno.EADDRNOTAVAIL, errno.EINVAL}:
            return None

        current_host = config.bind_host or config.contact_host
        if not current_host:
            return None

        if current_host in {"0.0.0.0", "::"}:
            return None

        try:
            parsed_host = ipaddress.ip_address(current_host)
        except ValueError:
            fallback_host = "0.0.0.0"
        else:
            fallback_host = "::" if parsed_host.version == 6 else "0.0.0.0"

        LOGGER.warning(
            "Impossible d'utiliser l'hôte SIP %s pour l'écoute locale, "
            "tentative avec %s.",
            current_host,
            fallback_host,
        )

        updated = replace(config, bind_host=fallback_host)
        self._config = updated
        return updated

    @staticmethod
    def _ensure_dialog_username(dialog: Any, username: str) -> None:
        """Ensure the dialog exposes a username for digest authentication."""

        if not username:
            return

        try:
            to_details = dialog.to_details  # type: ignore[attr-defined]
        except AttributeError:
            return

        if not isinstance(to_details, MutableMapping):
            return

        uri_details = to_details.get("uri")
        if not isinstance(uri_details, MutableMapping):
            return

        current_user = uri_details.get("user")
        if current_user:
            return

        uri_details["user"] = username

    @staticmethod
    def _normalize_trunk_uri(trunk_uri: str, username: str) -> str | None:
        """Return a canonical SIP URI for the registrar."""

        candidate = SIPRegistrationManager._normalize_optional_string(trunk_uri)
        if not candidate:
            return None

        trimmed = candidate.strip()
        if trimmed.startswith("<") and trimmed.endswith(">"):
            trimmed = trimmed[1:-1].strip()

        scheme = "sip"
        remainder = trimmed
        lower = trimmed.lower()
        if lower.startswith("sip:") or lower.startswith("sips:"):
            scheme, remainder = trimmed.split(":", 1)
        remainder = remainder.lstrip("/")

        user_part = ""
        host_part = remainder
        if "@" in remainder:
            user_part, host_part = remainder.split("@", 1)

        user_part = user_part.strip()
        host_part = host_part.strip()
        if not host_part:
            return None

        host_component = host_part.lstrip("/")
        host_component = host_component.split(";", 1)[0]
        host_component = host_component.split("?", 1)[0]
        if not host_component:
            return None

        normalized_user = user_part or username.strip()
        if not normalized_user:
            return None

        normalized_host = host_part
        if normalized_host.startswith("//"):
            normalized_host = normalized_host[2:]

        return f"{scheme}:{normalized_user}@{normalized_host}"

    @staticmethod
    def _registrar_request_uri(trunk_uri: str) -> str:
        candidate = SIPRegistrationManager._normalize_optional_string(trunk_uri)
        if not candidate:
            return "sip:"

        trimmed = candidate.strip()
        if trimmed.startswith("<") and trimmed.endswith(">"):
            trimmed = trimmed[1:-1].strip()

        scheme = "sip"
        remainder = trimmed
        lower = trimmed.lower()
        if lower.startswith("sip:") or lower.startswith("sips:"):
            scheme, remainder = trimmed.split(":", 1)
        remainder = remainder.lstrip("/")

        host_part = remainder
        if "@" in remainder:
            _, host_part = remainder.rsplit("@", 1)

        host_part = host_part.lstrip("/")
        host_part = host_part.split(";", 1)[0]
        host_part = host_part.split("?", 1)[0]

        if not host_part:
            return f"{scheme}:"

        return f"{scheme}:{host_part}"

    @staticmethod
    def _format_register_to_header(uri: str) -> str | None:
        candidate = SIPRegistrationManager._normalize_optional_string(uri)
        if not candidate:
            return None

        trimmed = candidate.strip()
        if "<" in trimmed or ">" in trimmed:
            return trimmed

        return f"<{trimmed}>"

    def _build_register_headers(
        self, config: SIPRegistrationConfig
    ) -> CIMultiDict[str]:
        headers: CIMultiDict[str] = CIMultiDict()
        to_header = self._format_register_to_header(config.uri)
        if to_header:
            headers["To"] = to_header
        return headers

    @staticmethod
    def _normalize_optional_string(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        candidate = value.strip()
        return candidate or None

    def _call_dialog_register(
        self,
        dialog: Any,
        *,
        expires: int,
        headers: CIMultiDict[str] | None,
    ):
        register_callable = dialog.register
        kwargs: dict[str, Any] = {"expires": expires}
        if headers:
            try:
                signature = inspect.signature(register_callable)
            except (TypeError, ValueError):
                signature = None
            if signature is not None and "headers" in signature.parameters:
                kwargs["headers"] = headers
        return register_callable(**kwargs)

    @staticmethod
    def _normalize_port(value: Any) -> int | None:
        if value is None:
            return None
        try:
            port = int(value)
        except (TypeError, ValueError):
            LOGGER.warning("Port SIP invalide ignoré : %r", value)
            return None
        if port <= 0:
            LOGGER.warning("Port SIP invalide ignoré : %r", value)
            return None
        return port

    @staticmethod
    def _normalize_transport(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        candidate = value.strip().lower()
        if not candidate:
            return None
        if candidate not in {"udp", "tcp", "tls"}:
            LOGGER.warning("Transport SIP invalide ignoré : %r", value)
            return None
        return candidate

    @staticmethod
    def _resolve_registrar_socket(host: str, port: int) -> tuple[str, int]:
        try:
            address_infos = socket.getaddrinfo(
                host,
                port,
                type=socket.SOCK_DGRAM,
            )
        except OSError as exc:
            LOGGER.debug(
                "Impossible de résoudre l'adresse réseau du registrar %s:%s : %s",
                host,
                port,
                exc,
            )
            return host, port

        for _family, socktype, _proto, _canon, sockaddr in address_infos:
            if socktype != socket.SOCK_DGRAM:
                continue
            if not sockaddr:
                continue
            candidate_host = sockaddr[0]
            candidate_port = sockaddr[1] if len(sockaddr) > 1 else port
            if candidate_host:
                return candidate_host, candidate_port

        return host, port

    @staticmethod
    def _dialog_transport_kwargs(transport: str | None) -> dict[str, Any]:
        if aiosip is None or not transport:
            return {}
        if transport == "udp":
            try:
                from aiosip.protocol import UDP  # type: ignore[attr-defined]
            except Exception:  # pragma: no cover - depends on aiosip internals
                LOGGER.warning(
                    "Impossible de charger le protocole UDP pour aiosip, "
                    "utilisation du transport par défaut",
                )
                return {}
            return {"protocol": UDP}
        LOGGER.warning(
            "Transport SIP %s non pris en charge par aiosip, "
            "utilisation du transport par défaut",
            transport,
        )
        return {}

    def _infer_contact_host(self, trunk_uri: str) -> str | None:
        """Attempt to determine the outbound IP address for SIP traffic."""

        registrar_host, registrar_port = self._parse_registrar_endpoint(trunk_uri)
        if registrar_host is None:
            return None

        try:
            address_infos = socket.getaddrinfo(
                registrar_host,
                registrar_port,
                type=socket.SOCK_DGRAM,
            )
        except OSError as exc:
            LOGGER.warning(
                "Impossible de résoudre l'hôte du trunk SIP %s : %s",
                registrar_host,
                exc,
            )
            return None

        for family, socktype, proto, _, sockaddr in address_infos:
            try:
                with socket.socket(family, socktype, proto) as sock:
                    sock.connect(sockaddr)
                    local_host = sock.getsockname()[0]
                    if local_host:
                        return local_host
            except OSError:
                continue

        return None

    @staticmethod
    def _parse_registrar_endpoint(uri: str) -> tuple[str | None, int]:
        candidate = SIPRegistrationManager._normalize_optional_string(uri)
        if not candidate:
            return None, _DEFAULT_SIP_PORT

        trimmed = candidate.strip()
        if trimmed.startswith("<") and trimmed.endswith(">"):
            trimmed = trimmed[1:-1].strip()

        scheme = "sip"
        remainder = trimmed
        lower = trimmed.lower()
        if lower.startswith("sip:") or lower.startswith("sips:"):
            scheme, remainder = trimmed.split(":", 1)
        remainder = remainder.lstrip("/")

        if "@" in remainder:
            _, host_part = remainder.rsplit("@", 1)
        else:
            host_part = remainder

        host_part = host_part.lstrip("/")
        host_port = host_part.split(";", 1)[0]
        host_port = host_port.split("?", 1)[0]
        if not host_port:
            return None, _DEFAULT_SIP_PORT

        fake_uri = f"{scheme}://{host_port}"
        parsed = urllib.parse.urlparse(fake_uri)
        host = parsed.hostname
        try:
            port = parsed.port
        except ValueError:
            port = None

        if host is None:
            return None, _DEFAULT_SIP_PORT

        return host, port or _DEFAULT_SIP_PORT

    @staticmethod
    def _find_available_contact_port(host: str | None) -> int | None:
        """Return an available UDP port bound to ``host`` if possible."""

        if not host:
            return None

        try:
            address_infos = socket.getaddrinfo(
                host,
                0,
                type=socket.SOCK_DGRAM,
            )
        except OSError as exc:
            LOGGER.warning(
                "Impossible de déterminer un port SIP libre pour %s : %s",
                host,
                exc,
            )
            return None

        resolver = SIPRegistrationManager._fallback_unspecified_sockaddr

        for family, socktype, proto, _, sockaddr in address_infos:
            try:
                sock = socket.socket(family, socktype, proto)
            except OSError:
                continue

            with contextlib.closing(sock):
                try:
                    sock.bind(sockaddr)
                except OSError as exc:
                    if exc.errno != errno.EADDRNOTAVAIL:
                        continue

                    fallback_sockaddr = resolver(family, sockaddr)
                    if fallback_sockaddr is None:
                        continue

                    host_part = host
                    if isinstance(sockaddr, tuple) and len(sockaddr) >= 1:
                        host_candidate = sockaddr[0]
                        if isinstance(host_candidate, str) and host_candidate:
                            host_part = host_candidate
                    fallback_host = fallback_sockaddr[0] if fallback_sockaddr else ""
                    LOGGER.debug(
                        "Adresse %s non assignée localement pour la détection du port"
                        " SIP, tentative avec %s",
                        host_part,
                        fallback_host,
                    )

                    try:
                        sock.bind(fallback_sockaddr)
                    except OSError:
                        continue

                bound = sock.getsockname()
                if isinstance(bound, tuple) and len(bound) >= 2:
                    port = bound[1]
                else:
                    continue
                if isinstance(port, int) and port > 0:
                    return port

        return None

    @staticmethod
    def _fallback_unspecified_sockaddr(
        family: int, sockaddr: tuple[Any, ...]
    ) -> tuple[Any, ...] | None:
        """Return a wildcard sockaddr matching ``family`` for port probing."""

        if family == socket.AF_INET:
            return ("0.0.0.0", 0)

        af_inet6 = getattr(socket, "AF_INET6", None)
        if af_inet6 is not None and family == af_inet6:
            flowinfo = 0
            scopeid = 0
            if len(sockaddr) >= 3 and isinstance(sockaddr[2], int):
                flowinfo = sockaddr[2]
            if len(sockaddr) >= 4 and isinstance(sockaddr[3], int):
                scopeid = sockaddr[3]
            return ("::", 0, flowinfo, scopeid)

        return None
