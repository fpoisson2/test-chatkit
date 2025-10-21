"""Gestion du contexte de requête et utilitaires de normalisation pour ChatKit."""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from chatkit.types import ThreadItem, UserMessageItem


_WAIT_STATE_METADATA_KEY = "workflow_wait_for_user_input"
"""Clé de métadonnées utilisée pour stocker l'état d'attente du workflow."""


def _get_wait_state_metadata(thread: Any) -> dict[str, Any] | None:
    """Retourne l'état d'attente stocké dans les métadonnées du fil."""

    metadata = getattr(thread, "metadata", None)
    if not isinstance(metadata, dict):
        return None
    state = metadata.get(_WAIT_STATE_METADATA_KEY)
    if isinstance(state, dict):
        return dict(state)
    return None


def _set_wait_state_metadata(
    thread: Any, state: Mapping[str, Any] | None
) -> None:
    """Met à jour l'état d'attente dans les métadonnées du fil."""

    metadata = getattr(thread, "metadata", None)
    if isinstance(metadata, dict):
        updated = dict(metadata)
    else:
        updated = {}

    if state is None:
        updated.pop(_WAIT_STATE_METADATA_KEY, None)
    else:
        updated[_WAIT_STATE_METADATA_KEY] = dict(state)

    if hasattr(thread, "metadata"):
        try:
            setattr(thread, "metadata", updated)
            return
        except Exception:  # pragma: no cover - dépend du type de l'objet
            pass

    if isinstance(metadata, dict):  # pragma: no cover - repli pour les mocks
        metadata.clear()
        metadata.update(updated)
    else:
        setattr(thread, "metadata", updated)


def _clone_conversation_history_snapshot(payload: Any) -> list[dict[str, Any]]:
    """Nettoie et duplique un historique de conversation sérialisable."""

    if isinstance(payload, (str, bytes, bytearray)):
        return []
    if not isinstance(payload, Sequence):
        return []

    cloned: list[dict[str, Any]] = []
    for entry in payload:
        if isinstance(entry, Mapping):
            cloned.append(copy.deepcopy(dict(entry)))
    return cloned


_ZERO_WIDTH_CHARACTERS = frozenset({"\u200b", "\u200c", "\u200d", "\ufeff"})
"""Caractères invisibles à supprimer dans les entrées utilisateur."""


def _normalize_user_text(value: str | None) -> str:
    """Supprime les caractères invisibles et normalise les messages utilisateurs."""

    if not value:
        return ""

    sanitized = "".join(ch for ch in value if ch not in _ZERO_WIDTH_CHARACTERS)
    return sanitized.strip()


@dataclass(frozen=True)
class ChatKitRequestContext:
    """Contexte minimal passé au serveur ChatKit pour loguer l'utilisateur."""

    user_id: str | None
    email: str | None
    authorization: str | None = None
    public_base_url: str | None = None

    def trace_metadata(self) -> dict[str, str]:
        """Retourne des métadonnées de trace compatibles avec l'Agents SDK."""

        metadata: dict[str, str] = {}
        if self.user_id:
            metadata["user_id"] = self.user_id
        if self.email:
            metadata["user_email"] = self.email
        return metadata


@dataclass(frozen=True)
class AutoStartConfiguration:
    """Configuration extraite du bloc début pour le démarrage automatique."""

    enabled: bool
    user_message: str
    assistant_message: str

    @classmethod
    def disabled(cls) -> "AutoStartConfiguration":
        return cls(False, "", "")


def _collect_user_text(message: UserMessageItem | None) -> str:
    """Concatène le texte d'un message utilisateur après normalisation."""

    if not message or not getattr(message, "content", None):
        return ""

    parts: list[str] = []
    for content_item in message.content:
        text = getattr(content_item, "text", None)
        normalized = _normalize_user_text(text) if text else ""
        if normalized:
            parts.append(normalized)

    return "\n".join(parts)


def _resolve_user_input_text(
    input_user_message: UserMessageItem | None,
    history: Sequence[ThreadItem],
) -> str:
    """Détermine le texte du message utilisateur à traiter."""
    candidate = _collect_user_text(input_user_message)
    if candidate:
        return candidate

    for item in reversed(history):
        if isinstance(item, UserMessageItem):
            candidate = _collect_user_text(item)
            if candidate:
                return candidate

    return ""


__all__ = [
    "_WAIT_STATE_METADATA_KEY",
    "_get_wait_state_metadata",
    "_set_wait_state_metadata",
    "_clone_conversation_history_snapshot",
    "_normalize_user_text",
    "_collect_user_text",
    "_resolve_user_input_text",
    "ChatKitRequestContext",
    "AutoStartConfiguration",
]
