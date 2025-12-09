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
    import logging
    logger = logging.getLogger("chatkit.server")

    # Pour les threads ChatKit en mémoire (SDK), utiliser thread.metadata
    metadata = getattr(thread, "metadata", None)
    if not isinstance(metadata, dict):
        payload = getattr(thread, "payload", None)
        if isinstance(payload, dict):
            metadata = payload.get("metadata")
            use_payload = True

    # Pour les threads chargés depuis la DB (ChatThread SQLAlchemy), utiliser payload
    if not isinstance(metadata, dict):
        payload = getattr(thread, "payload", None)
        if isinstance(payload, dict):
            metadata = payload.get("metadata")

    if not isinstance(metadata, dict):
        logger.info(
            "[WAIT_STATE_DEBUG] _get_wait_state_metadata: no metadata dict, returning None"
        )
        return None

    state = metadata.get(_WAIT_STATE_METADATA_KEY)
    logger.info(
        "[WAIT_STATE_DEBUG] _get_wait_state_metadata: thread_type=%s, "
        "has_wait_key=%s, state_input_id=%s",
        type(thread).__name__,
        state is not None,
        state.get("input_item_id") if isinstance(state, dict) else None,
    )
    if isinstance(state, dict):
        return dict(state)
    return None


def _set_wait_state_metadata(thread: Any, state: Mapping[str, Any] | None) -> None:
    """Met à jour l'état d'attente dans les métadonnées du fil."""
    import logging
    logger = logging.getLogger("chatkit.server")

    metadata = getattr(thread, "metadata", None)
    use_payload = False
    if not isinstance(metadata, dict):
        payload = getattr(thread, "payload", None)
        if isinstance(payload, dict):
            metadata = payload.get("metadata")
            use_payload = True
    logger.info(
        "[WAIT_STATE_DEBUG] _set_wait_state_metadata called: state=%s, "
        "thread_type=%s, metadata_type=%s, has_wait_key=%s",
        "clearing" if state is None else "setting",
        type(thread).__name__,
        type(metadata).__name__ if metadata else "None",
        _WAIT_STATE_METADATA_KEY in metadata if isinstance(metadata, dict) else False,
    )

    # IMPORTANT: Modify the dict IN PLACE first if possible.
    # This is critical because thread.metadata may return a reference to an
    # internal dict, and reassigning thread.metadata = new_dict may not persist
    # if the property returns a copy each time it's accessed.
    if isinstance(metadata, dict):
        if state is None:
            metadata.pop(_WAIT_STATE_METADATA_KEY, None)
            logger.info(
                "[WAIT_STATE_DEBUG] Removed wait key from metadata dict in place"
            )
        else:
            metadata[_WAIT_STATE_METADATA_KEY] = dict(state)
            logger.info(
                "[WAIT_STATE_DEBUG] Set wait key in metadata dict in place"
            )
        return

    # Fallback: build updated dict and try to assign
    updated: dict[str, Any] = {}
    if state is not None:
        updated[_WAIT_STATE_METADATA_KEY] = dict(state)

    # Write to the same location we read from
    if use_payload:
        # Thread uses payload.metadata (SQLAlchemy ChatThread)
        payload = getattr(thread, "payload", None)
        if isinstance(payload, dict):
            if "metadata" not in payload:
                payload["metadata"] = {}
            if isinstance(payload["metadata"], dict):
                if state is None:
                    payload["metadata"].pop(_WAIT_STATE_METADATA_KEY, None)
                else:
                    payload["metadata"][_WAIT_STATE_METADATA_KEY] = dict(state)
            else:
                payload["metadata"] = updated
            # Mark as modified for SQLAlchemy
            try:
                from sqlalchemy.orm.attributes import flag_modified

                flag_modified(thread, "payload")
            except Exception:
                pass
            logger.info("[WAIT_STATE_DEBUG] Updated thread.payload['metadata']")
            return

    if hasattr(thread, "metadata"):
        try:
            thread.metadata = updated
            logger.info("[WAIT_STATE_DEBUG] Assigned to thread.metadata")
            return
        except Exception as exc:  # pragma: no cover - dépend du type de l'objet
            logger.warning(
                "[WAIT_STATE_DEBUG] Failed to assign to thread.metadata: %s", exc
            )

    if isinstance(metadata, dict):  # pragma: no cover - repli pour les mocks
        metadata.clear()
        metadata.update(updated)
        logger.info("[WAIT_STATE_DEBUG] Modified metadata dict in place")
    else:
        thread.metadata = updated
        logger.info("[WAIT_STATE_DEBUG] Set thread.metadata directly")


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
