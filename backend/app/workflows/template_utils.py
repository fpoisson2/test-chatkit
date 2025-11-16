from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

from ..vector_store.ingestion import resolve_transform_value

logger = logging.getLogger("chatkit.server")


def render_agent_instructions(
    raw_instructions: str,
    *,
    state: Mapping[str, Any],
    last_step_context: Mapping[str, Any] | None,
    run_context: Mapping[str, Any] | None,
) -> str | None:
    try:
        rendered = resolve_transform_value(
            raw_instructions,
            state=state,
            default_input_context=last_step_context,
            input_context=run_context,
        )
    except Exception:  # pragma: no cover - robuste face aux contenus utilisateurs
        logger.debug(
            "Impossible de résoudre les instructions de l'agent : %s",
            raw_instructions,
            exc_info=True,
        )
        return raw_instructions

    if rendered is None:
        return None
    if isinstance(rendered, str):
        return rendered
    if isinstance(rendered, dict | list):
        try:
            return json.dumps(rendered, ensure_ascii=False)
        except TypeError:
            return str(rendered)
    return str(rendered)
