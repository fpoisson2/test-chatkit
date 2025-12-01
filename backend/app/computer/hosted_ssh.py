"""Async computer implementation backed by an SSH connection."""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import struct
import zlib
from collections.abc import Sequence
from dataclasses import dataclass

from agents.computer import AsyncComputer, Button, Environment

logger = logging.getLogger("chatkit.computer.hosted_ssh")

try:  # pragma: no cover - asyncssh n'est pas toujours installé
    import asyncssh
    from asyncssh import SSHClientConnection, SSHClientProcess
except ImportError:  # pragma: no cover - compatibilité sans asyncssh
    asyncssh = None  # type: ignore[assignment]
    SSHClientConnection = None  # type: ignore[assignment,misc]
    SSHClientProcess = None  # type: ignore[assignment,misc]


class HostedSSHError(RuntimeError):
    """Raised when the hosted SSH connection cannot be established."""


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    """Build a PNG chunk from its type and payload."""
    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    return length + chunk_type + data + crc


@dataclass
class SSHConfig:
    """Configuration for SSH connection."""
    host: str
    port: int = 22
    username: str = "root"
    password: str | None = None
    private_key: str | None = None


class _SSHDriver:
    """Driver for SSH-based computer control."""

    def __init__(
        self,
        *,
        width: int,
        height: int,
        config: SSHConfig,
    ) -> None:
        if asyncssh is None:  # pragma: no cover - dépendance optionnelle
            raise HostedSSHError("asyncssh n'est pas disponible. Installez-le avec: pip install asyncssh")
        self.width = width
        self.height = height
        self.config = config
        self._lock = asyncio.Lock()
        self._connection: SSHClientConnection | None = None
        self._ready = False
        self._last_output: str = ""
        self._command_history: list[str] = []
        self._placeholder_cache: str | None = None

    async def ensure_ready(self) -> None:
        if self._ready:
            return
        async with self._lock:
            if self._ready:
                return
            await self._connect()

    async def _connect(self) -> None:
        """Establish SSH connection."""
        try:
            connect_kwargs: dict = {
                "host": self.config.host,
                "port": self.config.port,
                "username": self.config.username,
                "known_hosts": None,  # Disable host key checking for simplicity
            }

            if self.config.private_key:
                # Use private key authentication
                connect_kwargs["client_keys"] = [asyncssh.import_private_key(self.config.private_key)]
            elif self.config.password:
                # Use password authentication
                connect_kwargs["password"] = self.config.password
            else:
                raise HostedSSHError(
                    "Aucune méthode d'authentification fournie. "
                    "Veuillez fournir un mot de passe ou une clé privée."
                )

            self._connection = await asyncssh.connect(**connect_kwargs)
            self._ready = True
            logger.info(
                f"Connexion SSH établie avec {self.config.host}:{self.config.port} "
                f"en tant que {self.config.username}"
            )
        except asyncssh.Error as exc:
            raise HostedSSHError(f"Échec de la connexion SSH: {exc}") from exc
        except Exception as exc:
            raise HostedSSHError(f"Erreur inattendue lors de la connexion SSH: {exc}") from exc

    def _require_connection(self) -> SSHClientConnection:
        if not self._connection:
            raise HostedSSHError("La connexion SSH n'est pas établie")
        return self._connection

    async def screenshot(self) -> str:
        """Generate a screenshot representation of the terminal state."""
        await self.ensure_ready()
        # For SSH, we generate a placeholder image with terminal info
        if self._placeholder_cache is None:
            self._placeholder_cache = self._build_placeholder_screenshot()
        return self._placeholder_cache

    def _build_placeholder_screenshot(self) -> str:
        """Build a placeholder PNG showing terminal state."""
        width = max(1, min(self.width, 1024))
        height = max(1, min(self.height, 1024))

        # Create a dark terminal-like background
        accent_row = b"\x00" + b"\x1e\x1e\x1e" * width  # Dark header
        base_row = b"\x00" + b"\x0a\x0a\x0a" * width    # Very dark background
        raw_rows = [
            accent_row if y < min(6, height) else base_row
            for y in range(height)
        ]
        raw_image = b"".join(raw_rows)
        compressed = zlib.compress(raw_image, level=6)

        header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

        metadata_parts: list[str] = []
        metadata_parts.append(f"SSH: {self.config.username}@{self.config.host}:{self.config.port}")
        if self._last_output:
            # Show last few lines of output
            last_lines = self._last_output.strip().split("\n")[-5:]
            metadata_parts.append(f"Output: {' | '.join(last_lines)[:200]}")
        if self._command_history:
            metadata_parts.append(f"Last cmd: {self._command_history[-1][:100]}")

        chunks = [
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", header),
        ]

        if metadata_parts:
            try:
                metadata = " | ".join(metadata_parts)
                encoded = metadata.encode("utf-8", errors="replace")[:1024]
                chunks.append(
                    _png_chunk(b"tEXt", b"ChatKit SSH Terminal\x00" + encoded)
                )
            except Exception:  # pragma: no cover
                logger.debug("Impossible d'encoder les métadonnées du placeholder")

        chunks.extend(
            (
                _png_chunk(b"IDAT", compressed),
                _png_chunk(b"IEND", b""),
            )
        )

        return base64.b64encode(b"".join(chunks)).decode("ascii")

    def _invalidate_cache(self) -> None:
        """Invalidate the screenshot cache after any action."""
        self._placeholder_cache = None

    async def run_command(self, command: str) -> str:
        """Execute a command via SSH and return the output."""
        await self.ensure_ready()
        conn = self._require_connection()
        try:
            result = await conn.run(command, check=False, timeout=30)
            output = result.stdout or ""
            if result.stderr:
                output += f"\n[stderr]: {result.stderr}"
            self._last_output = output
            self._command_history.append(command)
            self._invalidate_cache()
            logger.debug(f"Commande SSH exécutée: {command[:50]}...")
            return output
        except asyncssh.Error as exc:
            logger.warning(f"Erreur lors de l'exécution de la commande SSH: {exc}")
            return f"[Erreur]: {exc}"

    async def click(self, x: int, y: int, button: Button) -> None:
        """For SSH, clicks are not directly supported. Log the action."""
        self._invalidate_cache()
        logger.debug(f"SSH: Clic ignoré en ({x}, {y}) - non applicable en mode terminal")

    async def double_click(self, x: int, y: int) -> None:
        """For SSH, double-clicks are not directly supported."""
        self._invalidate_cache()
        logger.debug(f"SSH: Double-clic ignoré en ({x}, {y}) - non applicable en mode terminal")

    async def scroll(self, x: int, y: int, scroll_x: int, scroll_y: int) -> None:
        """For SSH, scrolling is not directly supported."""
        self._invalidate_cache()
        logger.debug("SSH: Défilement ignoré - non applicable en mode terminal")

    async def move(self, x: int, y: int) -> None:
        """For SSH, mouse movement is not supported."""
        pass

    async def type(self, text: str) -> None:
        """Type text by executing it as a command or echoing it."""
        if not text:
            return
        await self.ensure_ready()
        # For SSH, typing is interpreted as running a command
        # Strip newlines and execute as command
        command = text.strip()
        if command:
            await self.run_command(command)

    async def keypress(self, keys: Sequence[str]) -> None:
        """Handle key presses - for SSH this translates to special commands."""
        if not keys:
            return
        await self.ensure_ready()
        self._invalidate_cache()
        for key in keys:
            normalized = key.strip().lower()
            if normalized in {"enter", "return"}:
                # Enter key - no-op in SSH context as commands are already executed
                pass
            elif normalized in {"ctrl+c", "control+c"}:
                logger.debug("SSH: Ctrl+C détecté - annulation de la commande en cours")
            else:
                logger.debug(f"SSH: Touche {key} ignorée")

    async def drag(self, path: Sequence[tuple[int, int]]) -> None:
        """For SSH, dragging is not supported."""
        self._invalidate_cache()
        logger.debug("SSH: Glisser ignoré - non applicable en mode terminal")

    async def wait(self) -> None:
        """Wait for a moment."""
        await asyncio.sleep(1.0)

    async def navigate(self, url: str) -> None:
        """For SSH, navigation could mean changing directory or downloading a URL."""
        if not url or not url.strip():
            return
        await self.ensure_ready()
        url = url.strip()
        if url.startswith(("http://", "https://")):
            # Try to download the URL using curl or wget
            await self.run_command(f"curl -sL '{url}' | head -100")
        else:
            # Treat as a directory path
            await self.run_command(f"cd '{url}' && pwd")

    async def close(self) -> None:
        """Close the SSH connection."""
        if self._connection is not None:
            self._connection.close()
            await self._connection.wait_closed()
            self._connection = None
        self._ready = False
        self._placeholder_cache = None
        logger.info("Connexion SSH fermée")


class HostedSSH(AsyncComputer):
    """AsyncComputer implementation that connects via SSH to a remote host."""

    def __init__(
        self,
        *,
        width: int,
        height: int,
        config: SSHConfig,
    ) -> None:
        self._width = max(1, min(width, 4096))
        self._height = max(1, min(height, 4096))
        self._config = config
        self._driver: _SSHDriver | None = None
        self._lock = asyncio.Lock()

    @property
    def environment(self) -> Environment:
        return "ubuntu"  # SSH is typically used with Linux servers

    @property
    def dimensions(self) -> tuple[int, int]:
        return (self._width, self._height)

    @property
    def debug_url(self) -> str | None:
        return None  # SSH doesn't have a debug URL like browsers

    @property
    def ssh_info(self) -> str:
        """Return SSH connection info."""
        return f"{self._config.username}@{self._config.host}:{self._config.port}"

    async def _get_driver(self) -> _SSHDriver:
        if self._driver is not None:
            return self._driver
        async with self._lock:
            if self._driver is not None:
                return self._driver
            try:
                driver = _SSHDriver(
                    width=self._width,
                    height=self._height,
                    config=self._config,
                )
                await driver.ensure_ready()
                logger.info(f"Driver SSH initialisé pour {self.ssh_info}")
                self._driver = driver
            except HostedSSHError as exc:
                logger.warning(f"Impossible de créer le driver SSH: {exc}")
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
        """Navigate to URL (download) or change directory."""
        driver = await self._get_driver()
        await driver.navigate(url)

    async def run_command(self, command: str) -> str:
        """Execute a command via SSH."""
        driver = await self._get_driver()
        return await driver.run_command(command)

    async def close(self) -> None:
        if self._driver is None:
            return
        try:
            await self._driver.close()
        finally:
            self._driver = None

    async def create_interactive_shell(
        self,
        term_type: str = "xterm-256color",
        term_size: tuple[int, int] | None = None,
    ) -> SSHClientProcess | None:
        """
        Create an interactive shell session with PTY.

        Args:
            term_type: Terminal type (default: xterm-256color)
            term_size: Terminal size (width, height) or None for auto

        Returns:
            SSHClientProcess for interactive I/O, or None on failure
        """
        if asyncssh is None:
            logger.error("asyncssh not available for interactive shell")
            return None

        driver = await self._get_driver()
        conn = driver._require_connection()

        if term_size is None:
            term_size = (self._width // 8, self._height // 16)  # Approximate char size

        try:
            process = await conn.create_process(
                term_type=term_type,
                term_size=term_size,
                encoding=None,  # Binary mode for raw terminal data
            )
            logger.info(f"Interactive shell created for {self.ssh_info}")
            return process
        except asyncssh.Error as exc:
            logger.warning(f"Failed to create interactive shell with PTY: {exc}. Trying fallback without PTY.")
            try:
                # Fallback: try without PTY allocation
                process = await conn.create_process(
                    encoding=None
                )
                logger.info(f"Interactive shell (fallback) created for {self.ssh_info}")
                return process
            except asyncssh.Error as exc2:
                logger.warning(f"Failed to create interactive shell (fallback): {exc2}. Trying exec fallback.")
                try:
                    # Second fallback: try executing /bin/sh directly (exec subsystem)
                    process = await conn.create_process(
                        "/bin/sh",
                        encoding=None
                    )
                    logger.info(f"Interactive shell (exec fallback) created for {self.ssh_info}")
                    return process
                except asyncssh.Error as exc3:
                    logger.error(f"Failed to create interactive shell (all attempts failed): {exc3}")
                    return None

    @property
    def config(self) -> SSHConfig:
        """Return the SSH configuration."""
        return self._config


__all__ = ["HostedSSH", "HostedSSHError", "SSHConfig"]
