"""Async computer implementation backed by a VNC connection via websockify.

This module provides VNC-based computer control by proxying WebSocket connections
to a VNC server. It uses websockify (the official noVNC WebSocket-to-TCP proxy)
to handle the protocol translation.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import shutil
import struct
import subprocess
import zlib
from collections.abc import Sequence
from dataclasses import dataclass

from agents.computer import AsyncComputer, Button, Environment

logger = logging.getLogger("chatkit.computer.hosted_vnc")

# Check if websockify is available (either as a module or CLI)
_WEBSOCKIFY_AVAILABLE = False
_WEBSOCKIFY_CLI_PATH: str | None = None

try:
    # Try importing websockify as a module first
    import websockify  # noqa: F401
    _WEBSOCKIFY_AVAILABLE = True
except ImportError:
    # Check if websockify CLI is available
    _WEBSOCKIFY_CLI_PATH = shutil.which("websockify")
    if _WEBSOCKIFY_CLI_PATH:
        _WEBSOCKIFY_AVAILABLE = True


class HostedVNCError(RuntimeError):
    """Raised when the hosted VNC connection cannot be established."""


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    """Build a PNG chunk from its type and payload."""
    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    return length + chunk_type + data + crc


@dataclass
class VNCConfig:
    """Configuration for VNC connection."""
    host: str
    port: int = 5900
    password: str | None = None
    # websockify server port (for the WebSocket proxy)
    novnc_port: int = 6080


# Track allocated ports to avoid conflicts
_allocated_ports: set[int] = set()
_port_lock = asyncio.Lock()


async def _allocate_port(preferred: int = 6080) -> int:
    """Allocate an available port for websockify, avoiding conflicts."""
    async with _port_lock:
        port = preferred
        while port in _allocated_ports:
            port += 1
            if port > 65535:
                raise HostedVNCError("No available ports for websockify")
        _allocated_ports.add(port)
        return port


async def _release_port(port: int) -> None:
    """Release a previously allocated port."""
    async with _port_lock:
        _allocated_ports.discard(port)


class _VNCDriver:
    """Driver for VNC-based computer control via websockify.

    This driver manages a websockify subprocess that proxies WebSocket
    connections to a VNC server. The frontend (noVNC JS client) connects
    to the websockify WebSocket endpoint.
    """

    def __init__(
        self,
        *,
        width: int,
        height: int,
        config: VNCConfig,
    ) -> None:
        if not _WEBSOCKIFY_AVAILABLE:
            raise HostedVNCError(
                "websockify n'est pas disponible. Installez-le avec: pip install websockify"
            )
        self.width = width
        self.height = height
        self.config = config
        self._lock = asyncio.Lock()
        self._process: subprocess.Popen | None = None
        self._ready = False
        self._last_action: str = ""
        self._placeholder_cache: str | None = None
        self._websockify_port: int | None = None

    async def ensure_ready(self) -> None:
        if self._ready:
            return
        async with self._lock:
            if self._ready:
                return
            await self._start_websockify()

    async def _start_websockify(self) -> None:
        """Start websockify subprocess to proxy WebSocket to VNC."""
        try:
            # Allocate a port for websockify
            self._websockify_port = await _allocate_port(self.config.novnc_port)

            # Build websockify command
            # websockify [options] [source_host:]source_port target_host:target_port
            target = f"{self.config.host}:{self.config.port}"
            listen = f"0.0.0.0:{self._websockify_port}"

            cmd = [
                "websockify",
                "--verbose",
                listen,
                target,
            ]

            logger.info(f"Starting websockify: {' '.join(cmd)}")

            # Start websockify as a subprocess
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                # Don't inherit signals - we'll manage lifecycle explicitly
                preexec_fn=os.setpgrp if hasattr(os, 'setpgrp') else None,
            )

            # Wait a moment for websockify to start
            await asyncio.sleep(0.5)

            # Check if process started successfully
            if self._process.poll() is not None:
                stderr = self._process.stderr.read().decode() if self._process.stderr else ""
                raise HostedVNCError(f"websockify failed to start: {stderr}")

            self._ready = True

            logger.info(
                f"Serveur websockify demarre sur le port {self._websockify_port}, "
                f"connecte a VNC {self.config.host}:{self.config.port}"
            )
        except HostedVNCError:
            raise
        except Exception as exc:
            if self._websockify_port:
                await _release_port(self._websockify_port)
            raise HostedVNCError(f"Echec du demarrage de websockify: {exc}") from exc

    def debug_url(self) -> str | None:
        """Return a URL for debugging (points to local websockify)."""
        if self._websockify_port:
            return f"http://127.0.0.1:{self._websockify_port}"
        return None

    @property
    def websockify_port(self) -> int | None:
        """Return the port websockify is listening on."""
        return self._websockify_port

    def vnc_websocket_path(self) -> str:
        """Return the WebSocket path for VNC connection."""
        return f"/websockify?host={self.config.host}&port={self.config.port}"

    async def screenshot(self) -> str:
        """Generate a screenshot representation."""
        await self.ensure_ready()
        # For VNC, we generate a placeholder image with connection info
        # Real screenshots are captured via the noVNC websocket connection
        if self._placeholder_cache is None:
            self._placeholder_cache = self._build_placeholder_screenshot()
        return self._placeholder_cache

    def _build_placeholder_screenshot(self) -> str:
        """Build a placeholder PNG showing VNC state."""
        width = max(1, min(self.width, 1024))
        height = max(1, min(self.height, 1024))

        # Create a desktop-like background (dark blue/gray gradient look)
        accent_row = b"\x00" + b"\x2d\x3a\x4a" * width  # Dark header
        base_row = b"\x00" + b"\x1a\x2b\x3c" * width    # Dark blue background
        raw_rows = [
            accent_row if y < min(6, height) else base_row
            for y in range(height)
        ]
        raw_image = b"".join(raw_rows)
        compressed = zlib.compress(raw_image, level=6)

        header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

        metadata_parts: list[str] = []
        metadata_parts.append(f"VNC: {self.config.host}:{self.config.port}")
        if self._websockify_port:
            metadata_parts.append(f"websockify: port {self._websockify_port}")
        if self._last_action:
            metadata_parts.append(f"Action: {self._last_action[:100]}")

        chunks = [
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", header),
        ]

        if metadata_parts:
            try:
                metadata = " | ".join(metadata_parts)
                encoded = metadata.encode("utf-8", errors="replace")[:1024]
                chunks.append(
                    _png_chunk(b"tEXt", b"ChatKit VNC Desktop\x00" + encoded)
                )
            except Exception:  # pragma: no cover
                logger.debug("Impossible d'encoder les metadonnees du placeholder")

        chunks.extend(
            (
                _png_chunk(b"IDAT", compressed),
                _png_chunk(b"IEND", b""),
            )
        )

        return base64.b64encode(b"".join(chunks)).decode("ascii")

    def _invalidate_cache(self, action: str = "") -> None:
        """Invalidate the screenshot cache after any action."""
        self._placeholder_cache = None
        if action:
            self._last_action = action

    async def click(self, x: int, y: int, button: Button) -> None:
        """Record click action - actual clicks go through noVNC WebSocket."""
        self._invalidate_cache(f"Click {button} at ({x}, {y})")
        logger.debug(f"VNC: Click {button} at ({x}, {y})")

    async def double_click(self, x: int, y: int) -> None:
        """Record double-click action."""
        self._invalidate_cache(f"Double-click at ({x}, {y})")
        logger.debug(f"VNC: Double-click at ({x}, {y})")

    async def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        """Record scroll action."""
        self._invalidate_cache(f"Scroll at ({x}, {y}) by ({scroll_x}, {scroll_y})")
        logger.debug(f"VNC: Scroll at ({x}, {y})")

    async def move(self, x: int, y: int) -> None:
        """Record mouse move action."""
        # Don't invalidate cache for moves, too frequent
        logger.debug(f"VNC: Move to ({x}, {y})")

    async def type(self, text: str) -> None:
        """Record type action."""
        if not text:
            return
        self._invalidate_cache(f"Type: {text[:50]}...")
        logger.debug(f"VNC: Type {len(text)} characters")

    async def keypress(self, keys: Sequence[str]) -> None:
        """Record keypress action."""
        if not keys:
            return
        self._invalidate_cache(f"Keys: {', '.join(keys)}")
        logger.debug(f"VNC: Press keys {keys}")

    async def drag(self, path: Sequence[tuple[int, int]]) -> None:
        """Record drag action."""
        if not path:
            return
        self._invalidate_cache(f"Drag from {path[0]} to {path[-1]}")
        logger.debug(f"VNC: Drag with {len(path)} points")

    async def wait(self) -> None:
        """Wait for a moment."""
        await asyncio.sleep(1.0)

    async def navigate(self, url: str) -> None:
        """For VNC, navigation is not directly applicable."""
        if not url or not url.strip():
            return
        self._invalidate_cache(f"Navigate to {url}")
        logger.debug(f"VNC: Navigate request to {url} (not applicable for VNC)")

    async def close(self) -> None:
        """Close the websockify subprocess and release resources."""
        if self._process is not None:
            try:
                # Try graceful termination first
                self._process.terminate()
                try:
                    # Wait up to 2 seconds for graceful shutdown
                    self._process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    # Force kill if it doesn't stop
                    self._process.kill()
                    self._process.wait(timeout=1)
            except Exception as exc:
                logger.warning(f"Error stopping websockify: {exc}")
            finally:
                self._process = None

        # Release the allocated port
        if self._websockify_port is not None:
            await _release_port(self._websockify_port)
            self._websockify_port = None

        self._ready = False
        self._placeholder_cache = None
        logger.info("Serveur websockify arrete")


class HostedVNC(AsyncComputer):
    """AsyncComputer implementation that connects via VNC using websockify."""

    def __init__(
        self,
        *,
        width: int,
        height: int,
        config: VNCConfig,
    ) -> None:
        self._width = max(1, min(width, 4096))
        self._height = max(1, min(height, 4096))
        self._config = config
        self._driver: _VNCDriver | None = None
        self._lock = asyncio.Lock()

    @property
    def environment(self) -> Environment:
        # VNC typically connects to a full desktop environment
        return "ubuntu"

    @property
    def dimensions(self) -> tuple[int, int]:
        return (self._width, self._height)

    @property
    def debug_url(self) -> str | None:
        driver = self._driver
        if driver is None:
            return None
        return driver.debug_url()

    @property
    def vnc_info(self) -> str:
        """Return VNC connection info."""
        return f"{self._config.host}:{self._config.port}"

    @property
    def novnc_port(self) -> int:
        """Return the websockify server port.

        Returns the actual port the websockify subprocess is listening on,
        or the configured port if the driver hasn't started yet.
        """
        if self._driver and self._driver.websockify_port:
            return self._driver.websockify_port
        return self._config.novnc_port

    async def _get_driver(self) -> _VNCDriver:
        if self._driver is not None:
            return self._driver
        async with self._lock:
            if self._driver is not None:
                return self._driver
            try:
                driver = _VNCDriver(
                    width=self._width,
                    height=self._height,
                    config=self._config,
                )
                await driver.ensure_ready()
                logger.info(f"Driver VNC initialise pour {self.vnc_info}")
                self._driver = driver
            except HostedVNCError as exc:
                logger.warning(f"Impossible de creer le driver VNC: {exc}")
                raise
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

    async def navigate(self, url: str) -> None:
        """For VNC, navigation is not directly supported."""
        driver = await self._get_driver()
        await driver.navigate(url)

    async def close(self) -> None:
        if self._driver is None:
            return
        try:
            await self._driver.close()
        finally:
            self._driver = None

    @property
    def config(self) -> VNCConfig:
        """Return the VNC configuration."""
        return self._config


__all__ = ["HostedVNC", "HostedVNCError", "VNCConfig"]
