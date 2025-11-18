"""Gestion du contexte de requête et utilitaires de normalisation pour ChatKit."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from chatkit.types import ThreadItem, UserMessageItem

from ..workflows.utils import (
    _clone_conversation_history_snapshot,
    _normalize_user_text,
)

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


def _set_wait_state_metadata(thread: Any, state: Mapping[str, Any] | None) -> None:
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
            thread.metadata = updated
            return
        except Exception:  # pragma: no cover - dépend du type de l'objet
            pass

    if isinstance(metadata, dict):  # pragma: no cover - repli pour les mocks
        metadata.clear()
        metadata.update(updated)
    else:
        thread.metadata = updated


@dataclass(frozen=True)
class ChatKitRequestContext:
    """Contexte minimal passé au serveur ChatKit pour loguer l'utilisateur."""

    user_id: str | None
    email: str | None
    authorization: str | None = None
    public_base_url: str | None = None
    voice_model: str | None = None
    voice_instructions: str | None = None
    voice_voice: str | None = None
    voice_prompt_variables: Mapping[str, str] | None = None
    voice_model_provider_id: str | None = None
    voice_model_provider_slug: str | None = None
    lti_session_id: int | None = None
    lti_registration_id: int | None = None
    lti_deployment_id: int | None = None
    lti_resource_link_id: int | None = None
    lti_resource_link_ref: str | None = None
    lti_platform_user_id: str | None = None
    lti_platform_context_id: str | None = None
    ags_line_items_endpoint: str | None = None
    ags_line_item_endpoint: str | None = None
    ags_scopes: tuple[str, ...] | None = None
    ags_default_score_maximum: float | None = None
    ags_default_label: str | None = None

    def trace_metadata(self) -> dict[str, str]:
        """Retourne des métadonnées de trace compatibles avec l'Agents SDK."""

        metadata: dict[str, str] = {}
        if self.user_id:
            metadata["user_id"] = self.user_id
        if self.email:
            metadata["user_email"] = self.email
        if self.lti_session_id is not None:
            metadata["lti_session_id"] = str(self.lti_session_id)
        if self.lti_registration_id is not None:
            metadata["lti_registration_id"] = str(self.lti_registration_id)
        return metadata


@dataclass(frozen=True)
class AutoStartConfiguration:
    """Configuration extraite du bloc début pour le démarrage automatique."""

    enabled: bool
    user_message: str
    assistant_message: str

    @classmethod
    def disabled(cls) -> AutoStartConfiguration:
        return cls(False, "", "")


def _collect_user_text(message: UserMessageItem | None) -> str:
    """Concatène le texte d'un message utilisateur après normalisation."""

    if not message:
        return ""

    parts: list[str] = []
    for content_item in getattr(message, "content", []) or []:
        text = getattr(content_item, "text", None)
        normalized = _normalize_user_text(text) if text else ""
        if normalized:
            parts.append(normalized)

    if parts:
        return "\n".join(parts)

    attachment_descriptions: list[str] = []
    attachments = getattr(message, "attachments", None) or []
    for index, attachment in enumerate(attachments, start=1):
        if not attachment:
            continue

        display_name = _normalize_user_text(getattr(attachment, "name", None))
        if display_name:
            label = display_name
        else:
            label = getattr(attachment, "id", None) or "attachment"

        metadata_parts: list[str] = []
        attachment_type = getattr(attachment, "type", None)
        if attachment_type:
            metadata_parts.append(str(attachment_type))
        mime_type = getattr(attachment, "mime_type", None)
        if mime_type:
            metadata_parts.append(str(mime_type))

        if metadata_parts:
            label = f"{label} ({', '.join(metadata_parts)})"

        attachment_descriptions.append(f"Attachment {index}: {label}")

    if attachment_descriptions:
        return "\n".join(attachment_descriptions)

    return ""


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
