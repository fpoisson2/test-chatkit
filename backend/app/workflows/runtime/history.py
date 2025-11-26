from __future__ import annotations

import logging

from agents import TResponseInputItem
from chatkit.agents import ThreadItemConverter
from chatkit.types import UserMessageItem

from ..utils import _normalize_user_text

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
    attachments_list = []
    if message is not None:
        attachments_list = getattr(message, "attachments", None) or []
        attachments_present = bool(attachments_list)
        for part in getattr(message, "content", []) or []:
            text_value = getattr(part, "text", None)
            normalized = _normalize_user_text(text_value) if text_value else ""
            if normalized:
                typed_parts.append(normalized)

        # Debug logging for attachments
        logger.info(
            "📎 _build_user_message_history_items: message_id=%s, attachments_count=%d, "
            "converter_type=%s, attachments=%s",
            getattr(message, "id", None),
            len(attachments_list),
            type(converter).__name__ if converter else None,
            [{"id": a.id, "name": getattr(a, "name", None), "type": getattr(a, "type", None)} for a in attachments_list],
        )

    typed_text = "\n".join(typed_parts)

    items: list[TResponseInputItem] = []

    if converter is not None and message is not None:
        try:
            converted = await converter.to_agent_input(message)
            # Debug: log the converted items structure
            logger.info(
                "📎 Converted message with attachments: items_count=%d, first_item_keys=%s",
                len(converted) if converted else 0,
                list(converted[0].keys()) if converted and isinstance(converted, list) and len(converted) > 0 and hasattr(converted[0], "keys") else "N/A",
            )
            if converted and len(converted) > 0:
                first_item = converted[0]
                if hasattr(first_item, "get") or isinstance(first_item, dict):
                    content = first_item.get("content") if hasattr(first_item, "get") else getattr(first_item, "content", None)
                    if content:
                        content_types = [getattr(c, "get", lambda k: getattr(c, k, None))("type") for c in content] if isinstance(content, list) else []
                        logger.info("📎 First message content types: %s", content_types)
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
