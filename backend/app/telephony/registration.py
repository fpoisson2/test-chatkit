"""SIP registration helpers built on top of :mod:`pjsua` (PJSIP)."""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import logging
import threading
import time
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

from multidict import CIMultiDict

try:  # pragma: no cover - optional dependency
    import pjsua as _PJSUA
except ImportError as exc:  # pragma: no cover - exercised when dependency missing
    _PJSUA = None  # type: ignore[assignment]
    _PJSUA_IMPORT_ERROR = exc
else:
    _PJSUA_IMPORT_ERROR = None

__all__ = [
    "SIPRegistrationConfig",
    "SIPRegistrationManager",
    "CallAdapter",
    "RequestAdapter",
    "send_sip_reply",
]

LOGGER = logging.getLogger(__name__)

_DEFAULT_SIP_PORT = 5060

def _require_pjsua() -> Any:
    if _PJSUA is None:  # pragma: no cover - guarded by tests
        raise RuntimeError("pjsua n'est pas disponible") from _PJSUA_IMPORT_ERROR
    return _PJSUA


_lib_lock = threading.RLock()
_lib_instance: Any | None = None
_lib_users = 0
_event_stop = threading.Event()
_event_thread: threading.Thread | None = None


def _log_adapter(level: int, message: str, length: int) -> None:  # pragma: no cover
    text = message[:length].rstrip()
    if text:
        LOGGER.debug("[pjsip:%s] %s", level, text)


def _ensure_lib() -> Any:
    global _lib_instance, _lib_users, _event_thread

    pj = _require_pjsua()
    with _lib_lock:
        if _lib_instance is None:
            lib = pj.Lib()
            lib.init(log_cfg=pj.LogConfig(level=3, callback=_log_adapter))
            lib.start()
            _event_stop.clear()

            def _run() -> None:
                while not _event_stop.is_set():
                    try:
                        lib.handle_events(0.1)
                    except Exception:  # pragma: no cover - defensive
                        LOGGER.exception("Erreur dans la boucle d'événements PJSIP")
                        time.sleep(0.1)

            thread = threading.Thread(target=_run, name="pjsip-events", daemon=True)
            thread.start()
            _event_thread = thread
            _lib_instance = lib
        _lib_users += 1
        return _lib_instance


def _release_lib() -> None:
    global _lib_instance, _lib_users, _event_thread

    with _lib_lock:
        if _lib_instance is None:
            return
        _lib_users -= 1
        if _lib_users > 0:
            return
        lib = _lib_instance
        _event_stop.set()
        thread = _event_thread
        _event_thread = None
        _lib_instance = None

    if thread is not None:
        thread.join(timeout=2.0)

    with contextlib.suppress(Exception):
        lib.destroy()  # type: ignore[union-attr]


@dataclass(slots=True)
class SIPRegistrationConfig:
    """Configuration nécessaire pour enregistrer un AOR SIP avec PJSIP."""

    uri: str
    username: str
    password: str
    contact_host: str
    contact_port: int
    transport: str | None = None
    bind_host: str | None = None
    expires: int = 3600

    def contact_uri(self) -> str:
        transport_suffix = ""
        if self.transport:
            transport_suffix = f";transport={self.transport}"
        return (
            f"<sip:{self.username}@{self.contact_host}:{self.contact_port}{transport_suffix}>"
        )


class CallAdapter:
    """Expose ``reply``/``send_reply`` pour un objet ``pjsua.Call``."""

    def __init__(self, call: Any) -> None:
        self._call = call

    def _convert_headers(self, headers: dict[str, str] | None) -> list[Any] | None:
        pj = _require_pjsua()
        if not headers:
            return None
        return [pj.SipHeader(name=name, value=value) for name, value in headers.items()]

    def reply(
        self,
        status_code: int,
        *,
        reason: str,
        headers: dict[str, str] | None = None,
        payload: str | bytes | None = None,
    ) -> None:
        body: str | None = None
        if isinstance(payload, bytes):
            body = payload.decode("utf-8", errors="replace")
        elif isinstance(payload, str):
            body = payload
        hdr_list = self._convert_headers(headers)
        self._call.answer(status_code, reason=reason, hdr_list=hdr_list, body=body)

    def send_reply(
        self,
        status_code: int,
        reason: str,
        *,
        headers: dict[str, str] | None = None,
        payload: str | bytes | None = None,
    ) -> None:
        self.reply(status_code, reason=reason, headers=headers, payload=payload)


class RequestAdapter:
    """Adapter minimal représentant la requête ``INVITE`` entrante."""

    def __init__(self, call: Any) -> None:
        pj = _require_pjsua()
        info = call.info()
        self.method = "INVITE"
        self.headers = CIMultiDict()
        last_msg = getattr(info, "last_msg", None)
        if last_msg is not None:
            for header in getattr(last_msg, "hdr_list", []) or []:
                if isinstance(header, pj.SipHeader):
                    self.headers[header.name] = header.value
        if getattr(info, "remote_contact", None):
            self.headers.setdefault("From", info.remote_contact)
        if getattr(info, "local_contact", None):
            self.headers.setdefault("To", info.local_contact)
        self.payload = getattr(info, "remote_offer", "")


InviteRouteHandler = Callable[[Any, Any], Any]


class _AccountCallback:
    def __init__(self, manager: SIPRegistrationManager, account: Any) -> None:
        pj = _require_pjsua()
        base = getattr(pj, "AccountCallback", object)
        if base is object:
            self.__class__ = type("_AccountCallback", (), {"__init__": object.__init__})
        base.__init__(self, account)  # type: ignore[misc]
        self._manager = manager
        self.account = account

    def on_reg_state(self) -> None:  # pragma: no cover
        info = self.account.info()
        self._manager._on_reg_state(info)

    def on_incoming_call(self, call: Any) -> None:  # pragma: no cover
        self._manager._on_incoming_call(call)


class SIPRegistrationManager:
    """Maintient un enregistrement SIP via ``pjsua``."""

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
        self._task: asyncio.Task[None] | None = None
        self._reload_event = asyncio.Event()
        self._stop_requested = False
        self._registration_event: asyncio.Event | None = None

        self._lib: Any | None = None
        self._transport: Any | None = None
        self._account: Any | None = None
        self._account_cb: _AccountCallback | None = None

        self._last_error: BaseException | None = None
        self._invite_handler = invite_handler

        self.session_factory = session_factory
        self.settings = settings
        self.contact_host = contact_host
        self.contact_port = contact_port
        self.contact_transport = contact_transport
        self.bind_host = bind_host

    @property
    def last_error(self) -> BaseException | None:
        return self._last_error

    def apply_config(self, new_config: SIPRegistrationConfig | None) -> None:
        if new_config is not None:
            _require_pjsua()
            LOGGER.info(
                "Configuration SIP appliquée : %s (%s:%s)",
                new_config.uri,
                new_config.contact_host,
                new_config.contact_port,
            )
        else:
            LOGGER.info("Configuration SIP désactivée")
        self._config = new_config
        self._reload_event.set()

    def set_invite_handler(self, handler: InviteRouteHandler | None) -> None:
        self._invite_handler = handler

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop_requested = False
        self._reload_event.clear()
        self._task = self._loop.create_task(self._run_loop())

    async def stop(self) -> None:
        self._stop_requested = True
        self._reload_event.set()
        task = self._task
        if task is not None:
            await task
        self._task = None
        await self._unregister()

    async def _run_loop(self) -> None:
        backoff = self._retry_interval
        while not self._stop_requested:
            config = self._config
            if config is None:
                self._active_config = None
                await self._wait_for_reload()
                continue
            try:
                config = await self._register_once(config)
            except Exception as exc:  # pragma: no cover - defensive path
                self._last_error = exc
                LOGGER.exception("Échec de l'enregistrement SIP")
                await self._sleep_with_reload(backoff)
                backoff = min(backoff * 2, self._max_retry_interval)
                continue
            self._last_error = None
            self._active_config = config
            backoff = self._retry_interval
            refresh_after = max(1.0, config.expires * self._refresh_margin)
            await self._sleep_with_reload(refresh_after)

    async def _wait_for_reload(self) -> None:
        while not self._stop_requested and not self._reload_event.is_set():
            await asyncio.sleep(0.1)
        self._reload_event.clear()

    async def _sleep_with_reload(self, timeout: float) -> None:
        try:
            await asyncio.wait_for(self._reload_event.wait(), timeout)
        except asyncio.TimeoutError:
            pass
        finally:
            self._reload_event.clear()

    async def _register_once(
        self, config: SIPRegistrationConfig
    ) -> SIPRegistrationConfig:
        if self._active_config != config:
            await self._unregister()

        lib = self._ensure_lib()
        transport, config = self._ensure_transport(lib, config)
        account = self._ensure_account(lib, transport, config)

        event = asyncio.Event()
        self._registration_event = event

        def _notify() -> None:
            if not event.is_set():
                event.set()

        info = account.info()
        if getattr(info, "reg_status", 0) == 200:
            _notify()
        else:
            self._loop.call_soon_threadsafe(_notify)
        await asyncio.wait_for(event.wait(), timeout=self._register_timeout)
        return config

    def _ensure_lib(self) -> Any:
        if self._lib is None:
            self._lib = _ensure_lib()
        return self._lib

    def _ensure_transport(
        self, lib: Any, config: SIPRegistrationConfig
    ) -> tuple[Any, SIPRegistrationConfig]:
        if self._transport is not None:
            return self._transport, config

        pj = _require_pjsua()
        transport_cfg = pj.TransportConfig()
        transport_cfg.port = config.contact_port
        bound_host = config.bind_host or self.bind_host
        if bound_host:
            transport_cfg.bound_addr = bound_host
        try:
            transport = lib.create_transport(pj.TransportType.UDP, transport_cfg)
        except Exception as exc:
            if config.contact_port != 0:
                LOGGER.warning(
                    "Port SIP %s indisponible, tentative sur port aléatoire",
                    config.contact_port,
                )
                transport_cfg.port = 0
                transport = lib.create_transport(pj.TransportType.UDP, transport_cfg)
                info = transport.info()
                new_port = getattr(info, "local_port", None)
                if isinstance(new_port, int) and new_port != config.contact_port:
                    updated = replace(config, contact_port=new_port)
                    self._config = updated
                    config = updated
            else:
                raise exc
        self._transport = transport
        return transport, config

    def _ensure_account(
        self,
        lib: Any,
        transport: Any,
        config: SIPRegistrationConfig,
    ) -> Any:
        pj = _require_pjsua()
        account_cfg = pj.AccountConfig()
        registrar = self._registrar_uri(config.uri)
        account_cfg.id = config.uri
        account_cfg.reg_uri = registrar
        account_cfg.contact = config.contact_uri()
        info_getter = getattr(transport, "info", None)
        if callable(info_getter):
            transport_info = info_getter()
            transport_id = getattr(transport_info, "id", None)
        else:
            transport_id = getattr(transport, "id", None)
        account_cfg.transport_id = transport_id
        account_cfg.reg_timeout = config.expires
        account_cfg.auth_cred = [
            pj.AuthCred(realm="*", username=config.username, data=config.password)
        ]

        if self._account is None:
            self._account = lib.create_account(account_cfg, cb=None)
            self._account_cb = _AccountCallback(self, self._account)
            if hasattr(self._account, "set_callback"):
                self._account.set_callback(self._account_cb)
        else:
            if hasattr(self._account, "modify"):
                self._account.modify(account_cfg)
        return self._account

    async def _unregister(self) -> None:
        account = self._account
        self._account = None
        self._account_cb = None
        if account is not None:
            with contextlib.suppress(Exception):
                account.set_registration(False)
            with contextlib.suppress(Exception):
                account.delete()

        if self._transport is not None:
            transport = self._transport
            self._transport = None
            with contextlib.suppress(Exception):
                close = getattr(transport, "shutdown", None)
                if close is None:
                    close = getattr(transport, "close", None)
                if callable(close):
                    close()

        if self._lib is not None:
            _release_lib()
            self._lib = None

    def _registrar_uri(self, uri: str) -> str:
        parsed = urllib.parse.urlparse(uri)
        if not parsed.scheme or not parsed.hostname:
            raise ValueError("URI SIP invalide")
        registrar = f"{parsed.scheme}:{parsed.hostname}"
        if parsed.port:
            registrar += f":{parsed.port}"
        return registrar

    def _on_reg_state(self, info: Any) -> None:  # pragma: no cover
        event = self._registration_event
        if event is None:
            return

        def _set() -> None:
            if info is not None and getattr(info, "reg_status", 0) >= 200:
                event.set()

        self._loop.call_soon_threadsafe(_set)

    def _on_incoming_call(self, call: Any) -> None:  # pragma: no cover
        handler = self._invite_handler
        if handler is None:
            with contextlib.suppress(Exception):
                call.answer(486, reason="Busy Here")
            return

        dialog = CallAdapter(call)
        request = RequestAdapter(call)

        async def _run_handler() -> None:
            try:
                result = handler(dialog, request)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:  # pragma: no cover - application level
                LOGGER.exception("Erreur lors du traitement de l'INVITE")
                with contextlib.suppress(Exception):
                    dialog.reply(500, reason="Server Internal Error")

        asyncio.run_coroutine_threadsafe(_run_handler(), self._loop)

    async def apply_config_from_settings(
        self,
        session: Any,
        stored: Any | None,
    ) -> None:
        runtime = self.settings
        trunk_uri = getattr(runtime, "sip_trunk_uri", None)
        username = getattr(runtime, "sip_username", None)
        password = getattr(runtime, "sip_password", None)
        contact_host = self.contact_host or getattr(
            runtime, "sip_contact_host", None
        )
        contact_port = self.contact_port or getattr(
            runtime, "sip_contact_port", None
        )
        transport = self.contact_transport or getattr(
            runtime, "sip_contact_transport", None
        )
        bind_host = self.bind_host or getattr(runtime, "sip_bind_host", None)

        if stored is not None:
            trunk_uri = getattr(stored, "sip_trunk_uri", trunk_uri) or trunk_uri
            username = getattr(stored, "sip_trunk_username", username) or username
            password = getattr(stored, "sip_trunk_password", password) or password
            contact_host = getattr(
                stored, "sip_contact_host", contact_host
            ) or contact_host
            contact_port = getattr(
                stored, "sip_contact_port", contact_port
            ) or contact_port
            transport = getattr(
                stored, "sip_contact_transport", transport
            ) or transport

        if contact_host is None and trunk_uri is not None:
            contact_host = await self._infer_contact_host(trunk_uri)

        if contact_port is None:
            contact_port = _DEFAULT_SIP_PORT

        if not trunk_uri or not username or not password or not contact_host:
            self.apply_config(None)
            return

        config = SIPRegistrationConfig(
            uri=self._normalize_trunk_uri(trunk_uri, username) or trunk_uri,
            username=username,
            password=password,
            contact_host=contact_host,
            contact_port=int(contact_port),
            transport=transport,
            bind_host=bind_host,
        )
        self.apply_config(config)

    async def _infer_contact_host(self, trunk_uri: str) -> str | None:
        del trunk_uri
        host = self.contact_host
        if host is None:
            return "127.0.0.1"
        return host

    @staticmethod
    def _normalize_trunk_uri(trunk_uri: str, username: str) -> str | None:
        parsed = urllib.parse.urlparse(trunk_uri)
        if not parsed.scheme:
            parsed = urllib.parse.urlparse(f"sip:{trunk_uri}")
        if not parsed.scheme:
            return None
        host = parsed.hostname
        if host is None:
            candidate = parsed.path
            if not candidate:
                return None
            if "@" in candidate:
                candidate = candidate.split("@", 1)[-1]
            if not candidate:
                return None
            host = candidate
        scheme = parsed.scheme
        if scheme not in {"sip", "sips"}:
            return None
        port_part = f":{parsed.port}" if parsed.port else ""
        return f"{scheme}:{username}@{host}{port_part}"

    @staticmethod
    def _normalize_host(value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ipaddress.ip_address(value)
        except ValueError:
            return value
        return value


async def send_sip_reply(
    dialog: CallAdapter,
    status_code: int,
    *,
    reason: str,
    headers: dict[str, str] | None = None,
    payload: str | bytes | None = None,
    call_id: str | None = None,
    contact_uri: str | None = None,
) -> None:
    merged_headers = CIMultiDict(headers or {})
    if call_id is not None:
        merged_headers.setdefault("Call-ID", call_id)
    if contact_uri is not None:
        merged_headers.setdefault("Contact", contact_uri)
    dialog.reply(
        status_code,
        reason=reason,
        headers=dict(merged_headers),
        payload=payload,
    )
