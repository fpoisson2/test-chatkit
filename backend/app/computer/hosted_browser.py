"""Async computer implementation backed by a hosted browser."""

from __future__ import annotations

import asyncio
import base64
import logging
import struct
import zlib
from collections.abc import Sequence
from dataclasses import dataclass

from agents.computer import AsyncComputer, Button, Environment

logger = logging.getLogger("chatkit.computer.hosted_browser")

try:  # pragma: no cover - playwright n'est pas toujours installé dans les tests
    from playwright.async_api import (  # type: ignore[import-not-found]
        Browser,
        BrowserContext,
        Page,
        async_playwright,
    )
except Exception:  # pragma: no cover - compatibilité sans Playwright
    Browser = BrowserContext = Page = None  # type: ignore[assignment]
    async_playwright = None  # type: ignore[assignment]


class HostedBrowserError(RuntimeError):
    """Raised when the hosted browser cannot be started."""


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    """Build a PNG chunk from its type and payload."""

    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    return length + chunk_type + data + crc


def _normalize_button(button: Button) -> str:
    if button == "wheel":
        return "middle"
    if button in {"back", "forward"}:
        # Les clics souris "back"/"forward" ne sont pas supportés par Playwright.
        return "left"
    return button


def _normalize_key(key: str) -> str:
    normalized = key.strip()
    if not normalized:
        return ""

    mapping = {
        "enter": "Enter",
        "return": "Enter",
        "space": "Space",
        "tab": "Tab",
        "escape": "Escape",
        "esc": "Escape",
        "backspace": "Backspace",
        "delete": "Delete",
        "left": "ArrowLeft",
        "right": "ArrowRight",
        "up": "ArrowUp",
        "down": "ArrowDown",
        "pageup": "PageUp",
        "pagedown": "PageDown",
        "home": "Home",
        "end": "End",
    }

    lookup = normalized.lower()
    if lookup in mapping:
        return mapping[lookup]

    if len(normalized) == 1:
        return normalized

    return normalized


class _BaseBrowserDriver:
    width: int
    height: int
    start_url: str | None

    async def ensure_ready(self) -> None:
        raise NotImplementedError

    async def screenshot(self) -> str:  # pragma: no cover - défini par les sous-classes
        raise NotImplementedError

    async def click(self, x: int, y: int, button: Button) -> None:
        raise NotImplementedError  # pragma: no cover - défini par les sous-classes

    async def double_click(self, x: int, y: int) -> None:
        raise NotImplementedError  # pragma: no cover - défini par les sous-classes

    async def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        raise NotImplementedError  # pragma: no cover - défini par les sous-classes

    async def move(self, x: int, y: int) -> None:
        raise NotImplementedError  # pragma: no cover - défini par les sous-classes

    async def type(self, text: str) -> None:
        raise NotImplementedError  # pragma: no cover - défini par les sous-classes

    async def keypress(self, keys: Sequence[str]) -> None:
        raise NotImplementedError  # pragma: no cover - défini par les sous-classes

    async def drag(self, path: Sequence[tuple[int, int]]) -> None:
        raise NotImplementedError  # pragma: no cover - défini par les sous-classes

    async def wait(self) -> None:
        raise NotImplementedError  # pragma: no cover - défini par les sous-classes

    async def close(self) -> None:
        raise NotImplementedError  # pragma: no cover - défini par les sous-classes


class _PlaywrightDriver(_BaseBrowserDriver):
    def __init__(self, *, width: int, height: int, start_url: str | None) -> None:
        if async_playwright is None:  # pragma: no cover - dépendance optionnelle
            raise HostedBrowserError("Playwright n'est pas disponible")
        self.width = width
        self.height = height
        self.start_url = start_url
        self._lock = asyncio.Lock()
        self._playwright_manager = async_playwright()
        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._ready = False

    async def ensure_ready(self) -> None:
        if self._ready:
            return
        async with self._lock:
            if self._ready:
                return
            try:
                self._playwright = await self._playwright_manager.__aenter__()
                browser_args = [
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                ]
                self._browser = await self._playwright.chromium.launch(
                    headless=True,
                    args=browser_args,
                )
                self._context = await self._browser.new_context(
                    viewport={"width": self.width, "height": self.height},
                    accept_downloads=False,
                )
                self._page = await self._context.new_page()
                if self.start_url:
                    try:
                        await self._page.goto(
                            self.start_url,
                            wait_until="domcontentloaded",
                            timeout=30_000,
                        )
                    except Exception as exc:  # pragma: no cover - robuste en production
                        logger.warning(
                            "Échec du chargement de l'URL initiale %s : %s",
                            self.start_url,
                            exc,
                        )
                self._ready = True
            except Exception as exc:  # pragma: no cover - dépend des environnements
                await self.close()
                raise HostedBrowserError(
                    "Impossible de démarrer le navigateur Playwright"
                ) from exc

    def _require_page(self) -> Page:
        if not self._page:
            raise HostedBrowserError("Le navigateur hébergé n'est pas prêt")
        return self._page

    async def screenshot(self) -> str:
        await self.ensure_ready()
        page = self._require_page()
        image_bytes = await page.screenshot(full_page=True, type="png")
        return base64.b64encode(image_bytes).decode("ascii")

    async def click(self, x: int, y: int, button: Button) -> None:
        await self.ensure_ready()
        page = self._require_page()
        await page.mouse.click(x, y, button=_normalize_button(button))

    async def double_click(self, x: int, y: int) -> None:
        await self.ensure_ready()
        page = self._require_page()
        await page.mouse.dblclick(x, y, button="left")

    async def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        await self.ensure_ready()
        page = self._require_page()
        await page.mouse.move(x, y)
        await page.mouse.wheel(scroll_x, scroll_y)

    async def move(self, x: int, y: int) -> None:
        await self.ensure_ready()
        page = self._require_page()
        await page.mouse.move(x, y)

    async def type(self, text: str) -> None:
        if not text:
            return
        await self.ensure_ready()
        page = self._require_page()
        await page.keyboard.type(text)

    async def keypress(self, keys: Sequence[str]) -> None:
        if not keys:
            return
        await self.ensure_ready()
        page = self._require_page()
        for key in keys:
            normalized = _normalize_key(key)
            if not normalized:
                continue
            try:
                await page.keyboard.press(normalized)
            except Exception as exc:  # pragma: no cover - dépend des clés
                logger.debug("Touche %s ignorée : %s", key, exc)

    async def drag(self, path: Sequence[tuple[int, int]]) -> None:
        if not path:
            return
        await self.ensure_ready()
        page = self._require_page()
        start_x, start_y = path[0]
        await page.mouse.move(start_x, start_y)
        await page.mouse.down(button="left")
        for x, y in path[1:]:
            await page.mouse.move(x, y)
        await page.mouse.up(button="left")

    async def wait(self) -> None:
        await self.ensure_ready()
        page = self._require_page()
        await page.wait_for_timeout(1_500)

    async def close(self) -> None:
        try:
            if self._context is not None:
                await self._context.close()
        finally:
            self._context = None
        try:
            if self._browser is not None:
                await self._browser.close()
        finally:
            self._browser = None
        try:
            if self._playwright is not None:
                await self._playwright_manager.__aexit__(None, None, None)
        finally:
            self._playwright = None
            self._ready = False


@dataclass
class _FallbackDriver(_BaseBrowserDriver):
    width: int
    height: int
    start_url: str | None

    def __post_init__(self) -> None:
        self._ready = False
        self._typed = ""
        self._last_action = "Initialisation du navigateur simulé"
        self._placeholder_cache: str | None = None

    async def ensure_ready(self) -> None:
        if self._ready:
            return
        self._ready = True
        if self.start_url:
            self._last_action = f"Chargement simulé de {self.start_url}"
            self._placeholder_cache = None

    async def screenshot(self) -> str:
        await self.ensure_ready()
        if self._placeholder_cache is None:
            self._placeholder_cache = self._build_placeholder_screenshot()
        return self._placeholder_cache

    def _build_placeholder_screenshot(self) -> str:
        width = max(1, min(self.width, 1024))
        height = max(1, min(self.height, 1024))

        accent_row = b"\x00" + b"\x33\x66\x99" * width
        base_row = b"\x00" + b"\xf5\xf5\xf5" * width
        raw_rows = [
            accent_row if y < min(6, height) else base_row
            for y in range(height)
        ]
        raw_image = b"".join(raw_rows)
        compressed = zlib.compress(raw_image, level=6)

        header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

        metadata_parts: list[str] = []
        if self.start_url:
            metadata_parts.append(f"URL: {self.start_url}")
        if self._last_action:
            metadata_parts.append(f"Action: {self._last_action}")
        if self._typed:
            metadata_parts.append(f"Saisie: {self._typed[-40:]}")

        chunks = [
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", header),
        ]

        if metadata_parts:
            try:
                metadata = " | ".join(metadata_parts)
                encoded = metadata.encode("utf-8", errors="replace")[:1024]
                chunks.append(
                    _png_chunk(b"tEXt", b"ChatKit placeholder\x00" + encoded)
                )
            except Exception:  # pragma: no cover - encodage dépend des entrées
                logger.debug("Impossible d'encoder les métadonnées du placeholder")

        chunks.extend(
            (
                _png_chunk(b"IDAT", compressed),
                _png_chunk(b"IEND", b""),
            )
        )

        return base64.b64encode(b"".join(chunks)).decode("ascii")

    def _remember_action(self, description: str) -> None:
        self._last_action = description
        self._placeholder_cache = None

    async def click(self, x: int, y: int, button: Button) -> None:
        self._remember_action(f"Clic {button} en ({x}, {y})")

    async def double_click(self, x: int, y: int) -> None:
        self._remember_action(f"Double clic en ({x}, {y})")

    async def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        self._remember_action(
            f"Défilement depuis ({x}, {y}) de ({scroll_x}, {scroll_y})"
        )

    async def move(self, x: int, y: int) -> None:
        self._remember_action(f"Déplacement curseur vers ({x}, {y})")

    async def type(self, text: str) -> None:
        if not text:
            return
        self._typed = (self._typed + text)[-256:]
        self._remember_action(f"Saisie de {len(text)} caractères")

    async def keypress(self, keys: Sequence[str]) -> None:
        if keys:
            joined = ", ".join(keys)
            self._remember_action(f"Touches pressées: {joined}")

    async def drag(self, path: Sequence[tuple[int, int]]) -> None:
        if path:
            self._remember_action(f"Glisser de {path[0]} vers {path[-1]}")

    async def wait(self) -> None:
        self._remember_action("Attente simulée")
        await asyncio.sleep(0.5)

    async def close(self) -> None:
        self._ready = False
        self._placeholder_cache = None


class HostedBrowser(AsyncComputer):
    """AsyncComputer implementation that launches a hosted browser instance."""

    def __init__(
        self,
        *,
        width: int,
        height: int,
        environment: str,
        start_url: str | None = None,
    ) -> None:
        self._width = max(1, min(width, 4096))
        self._height = max(1, min(height, 4096))
        normalized_env = environment.strip().lower()
        self._environment: Environment = (
            normalized_env
            if normalized_env in {"browser", "mac", "windows", "ubuntu"}
            else "browser"
        )
        self._start_url = start_url.strip() if isinstance(start_url, str) else None
        self._driver: _BaseBrowserDriver | None = None
        self._lock = asyncio.Lock()

    @property
    def environment(self) -> Environment:
        return self._environment

    @property
    def dimensions(self) -> tuple[int, int]:
        return (self._width, self._height)

    async def _get_driver(self) -> _BaseBrowserDriver:
        if self._driver is not None:
            return self._driver
        async with self._lock:
            if self._driver is not None:
                return self._driver
            driver: _BaseBrowserDriver | None = None
            if async_playwright is not None:
                try:
                    driver = _PlaywrightDriver(
                        width=self._width,
                        height=self._height,
                        start_url=self._start_url,
                    )
                    await driver.ensure_ready()
                    logger.debug("Navigateur Playwright initialisé")
                except HostedBrowserError as exc:
                    logger.warning(
                        (
                            "Impossible de démarrer Playwright, utilisation d'un "
                            "navigateur simulé : %s"
                        ),
                        exc,
                    )
                    driver = None
                except Exception as exc:  # pragma: no cover - robustesse
                    logger.exception(
                        (
                            "Erreur inattendue lors de l'initialisation du "
                            "navigateur Playwright"
                        ),
                        exc_info=exc,
                    )
                    driver = None
            if driver is None:
                driver = _FallbackDriver(
                    width=self._width,
                    height=self._height,
                    start_url=self._start_url,
                )
                await driver.ensure_ready()
            self._driver = driver
        return self._driver

    async def screenshot(self) -> str:
        driver = await self._get_driver()
        return await driver.screenshot()

    async def click(self, x: int, y: int, button: Button) -> None:
        driver = await self._get_driver()
        await driver.click(x, y, button)

    async def double_click(self, x: int, y: int) -> None:
        driver = await self._get_driver()
        await driver.double_click(x, y)

    async def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        driver = await self._get_driver()
        await driver.scroll(x, y, scroll_x, scroll_y)

    async def move(self, x: int, y: int) -> None:
        driver = await self._get_driver()
        await driver.move(x, y)

    async def type(self, text: str) -> None:
        driver = await self._get_driver()
        await driver.type(text)

    async def keypress(self, keys: Sequence[str]) -> None:
        driver = await self._get_driver()
        await driver.keypress(keys)

    async def drag(self, path: Sequence[tuple[int, int]]) -> None:
        driver = await self._get_driver()
        await driver.drag(path)

    async def wait(self) -> None:
        driver = await self._get_driver()
        await driver.wait()

    async def close(self) -> None:
        if self._driver is None:
            return
        try:
            await self._driver.close()
        finally:
            self._driver = None


__all__ = ["HostedBrowser", "HostedBrowserError"]
