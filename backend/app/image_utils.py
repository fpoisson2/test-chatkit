from __future__ import annotations

import base64
import imghdr
import logging
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin

logger = logging.getLogger("chatkit.image_utils")

AGENT_IMAGE_STORAGE_DIR = Path(__file__).resolve().parent / "generated_images"
AGENT_IMAGE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
AGENT_IMAGE_URL_PREFIX = "/api/chatkit/images"


def _resolve_image_extension(output_format: str | None, data: bytes | None) -> str:
    """Détermine l'extension à utiliser pour un fichier image généré."""

    if isinstance(output_format, str) and output_format.strip():
        normalized = output_format.strip().lower()
        if normalized in {"png", "jpeg", "jpg", "gif", "webp"}:
            return "jpg" if normalized == "jpeg" else normalized

    if data:
        detected = imghdr.what(None, data)
        if detected:
            return "jpg" if detected == "jpeg" else detected

    return "png"


def save_agent_image_file(
    doc_id: str,
    b64_data: str,
    *,
    output_format: str | None = None,
) -> tuple[str | None, str | None]:
    """Enregistre une image générée et retourne le chemin absolu et l'URL locale."""

    if not isinstance(b64_data, str) or not b64_data.strip():
        return None, None

    try:
        binary = base64.b64decode(b64_data, validate=True)
    except Exception:  # pragma: no cover - dépend des entrées runtime
        logger.exception("Impossible de décoder l'image générée (doc_id=%s)", doc_id)
        return None, None

    extension = _resolve_image_extension(output_format, binary)
    file_name = f"{doc_id}.{extension}"
    try:
        AGENT_IMAGE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        file_path = AGENT_IMAGE_STORAGE_DIR / file_name
        file_path.write_bytes(binary)
    except Exception:  # pragma: no cover - dépend du système de fichiers
        logger.exception("Impossible d'écrire le fichier image %s", file_name)
        return None, None

    url = f"{AGENT_IMAGE_URL_PREFIX}/{file_name}"
    return str(file_path), url


def build_agent_image_absolute_url(
    relative_url: str,
    *,
    base_url: str,
    token: str | None = None,
) -> str:
    """Construit une URL absolue optionnellement signée pour une image générée."""

    if not isinstance(relative_url, str) or not relative_url.strip():
        return ""

    normalized_base = base_url.rstrip("/") + "/"
    absolute = urljoin(normalized_base, relative_url.lstrip("/"))
    if token:
        separator = "&" if "?" in absolute else "?"
        absolute = f"{absolute}{separator}token={quote(token)}"
    return absolute


def _filter_valid_urls(urls: Sequence[str]) -> list[str]:
    return [url.strip() for url in urls if isinstance(url, str) and url.strip()]


def format_generated_image_links(urls: Sequence[str]) -> str:
    """Formate la liste des URL d'images générées pour affichage utilisateur."""

    valid_urls = _filter_valid_urls(urls)
    if not valid_urls:
        return ""

    bullet_list = "\n".join(f"- {url}" for url in valid_urls)
    return f"Images générées :\n{bullet_list}"


def append_generated_image_links(text: str | None, urls: Sequence[str]) -> str:
    """Ajoute les URL d'images générées à un texte existant."""

    formatted_links = format_generated_image_links(urls)
    base_text = (text or "").rstrip()
    if not formatted_links:
        return base_text
    if base_text:
        return f"{base_text}\n\n{formatted_links}"
    return formatted_links


def merge_generated_image_urls_into_payload(payload: Any, urls: Sequence[str]) -> Any:
    """Fusionne la liste d'URL d'images générées dans un payload structuré."""

    valid_urls = _filter_valid_urls(urls)
    if not valid_urls:
        return payload

    if payload is None:
        return format_generated_image_links(valid_urls)

    if isinstance(payload, str):
        return append_generated_image_links(payload, valid_urls)

    if hasattr(payload, "model_dump"):
        try:
            dumped = payload.model_dump()
        except TypeError:
            dumped = payload.model_dump(by_alias=True)
        return merge_generated_image_urls_into_payload(dumped, valid_urls)

    if isinstance(payload, Mapping):
        merged: dict[str, Any] = dict(payload)
        merged.setdefault("generated_image_urls", valid_urls)
        return merged

    if isinstance(payload, Sequence) and not isinstance(payload, (bytes, bytearray, str)):
        return {
            "output": list(payload),
            "generated_image_urls": valid_urls,
        }

    return payload
