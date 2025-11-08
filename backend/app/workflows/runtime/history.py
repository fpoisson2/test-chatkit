from __future__ import annotations

import logging

from agents import TResponseInputItem
from chatkit.agents import ThreadItemConverter
from chatkit.types import UserMessageItem

from ...chatkit_server.context import _normalize_user_text

logger = logging.getLogger("chatkit.server")


async def _build_user_message_history_items(
    *,
    converter: ThreadItemConverter | None,
    message: UserMessageItem | None,
    fallback_text: str,
) -> list[TResponseInputItem]:
    """Construit les éléments d'historique pour le message utilisateur courant."""

    normalized_fallback = _normalize_user_text(fallback_text)

    typed_parts: list[str] = []
    attachments_present = False
    if message is not None:
        attachments = getattr(message, "attachments", None) or []
        attachments_present = bool(attachments)
        for part in getattr(message, "content", []) or []:
            text_value = getattr(part, "text", None)
            normalized = _normalize_user_text(text_value) if text_value else ""
            if normalized:
                typed_parts.append(normalized)

    typed_text = "\n".join(typed_parts)

    items: list[TResponseInputItem] = []

    if converter is not None and message is not None:
        try:
            converted = await converter.to_agent_input(message)
        except Exception as exc:  # pragma: no cover - dépend du SDK installé
            logger.warning(
                "Impossible de convertir le message utilisateur courant en "
                "entrée agent",
                exc_info=exc,
            )
        else:
            if converted:
                if isinstance(converted, list):
                    items.extend(converted)
                else:  # pragma: no cover - API accepte aussi un seul item
                    items.append(converted)

    if normalized_fallback:
        if items:
            if attachments_present and not typed_text:
                items.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": normalized_fallback,
                            }
                        ],
                    }
                )
        else:
            items.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": normalized_fallback,
                        }
                    ],
                }
            )

    return items
