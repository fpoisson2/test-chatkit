from __future__ import annotations

import asyncio
import base64
import binascii
from dataclasses import dataclass
from pathlib import Path
import re
import uuid
from typing import Tuple

__all__ = [
    "GeneratedImageAsset",
    "persist_generated_image",
    "resolve_generated_image_file",
    "ROUTE_PREFIX",
    "sanitize_generated_image_identifier",
]

_STORAGE_DIR = Path(__file__).resolve().parent / "generated_images"
_ALLOWED_FORMATS: dict[str, Tuple[str, str]] = {
    "png": ("png", "image/png"),
    "jpg": ("jpg", "image/jpeg"),
    "jpeg": ("jpg", "image/jpeg"),
    "webp": ("webp", "image/webp"),
    "gif": ("gif", "image/gif"),
}
_DEFAULT_FORMAT = ("png", "image/png")
ROUTE_PREFIX = "/api/chatkit/generated-images"


@dataclass(frozen=True)
class GeneratedImageAsset:
    """Informations sur une image générée persistée sur disque."""

    identifier: str
    filename: str
    mime_type: str

    @property
    def url(self) -> str:
        return f"{ROUTE_PREFIX}/{self.filename}"


def sanitize_generated_image_identifier(value: str) -> str:
    """Normalise un identifiant pour l'utiliser comme nom de fichier."""

    slug = re.sub(r"[^0-9a-zA-Z_-]+", "-", value)
    slug = re.sub(r"-+", "-", slug).strip("-")
    if not slug:
        slug = uuid.uuid4().hex
    return slug


async def _write_file(path: Path, data: bytes) -> None:
    def _sync_write() -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with tmp_path.open("wb") as fh:
            fh.write(data)
        tmp_path.replace(path)

    await asyncio.to_thread(_sync_write)


async def persist_generated_image(
    base_identifier: str,
    image_format: str,
    base64_data: str,
) -> GeneratedImageAsset | None:
    """Décode et persiste une image générée, en retournant son URL publique."""

    normalized_id = sanitize_generated_image_identifier(base_identifier)
    if not base64_data:
        return None

    format_key = (image_format or "png").lower()
    extension, mime_type = _ALLOWED_FORMATS.get(format_key, _DEFAULT_FORMAT)

    try:
        data = base64.b64decode(base64_data)
    except (binascii.Error, ValueError):
        return None

    filename = f"{normalized_id}.{extension}"
    target_path = _STORAGE_DIR / filename
    await _write_file(target_path, data)
    return GeneratedImageAsset(normalized_id, filename, mime_type)


def resolve_generated_image_file(filename: str) -> tuple[Path, str] | None:
    """Retourne le chemin et le type MIME d'une image persistée."""

    sanitized = sanitize_generated_image_identifier(filename.rsplit(".", 1)[0])
    parts = filename.rsplit(".", 1)
    if len(parts) != 2:
        return None
    extension = parts[1].lower()
    if sanitized + f".{extension}" != filename:
        return None
    _, mime_type = _ALLOWED_FORMATS.get(extension, _DEFAULT_FORMAT)
    candidate = _STORAGE_DIR / filename
    if not candidate.is_file():
        return None
    return candidate, mime_type
