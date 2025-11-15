"""Helpers pour la publication de notes via l'AGS."""

from __future__ import annotations

import logging
from typing import Protocol

from ..workflows.executor import WorkflowEndState
from .context import ChatKitRequestContext

logger = logging.getLogger("chatkit.server")


class AGSClientProtocol(Protocol):
    async def ensure_line_item(
        self,
        *,
        context: ChatKitRequestContext | None,
        variable_id: str,
        max_score: float | None,
        comment: str | None,
    ) -> str | None:
        """Garantit l'existence du line item et retourne son identifiant."""

    async def publish_score(
        self,
        *,
        context: ChatKitRequestContext | None,
        line_item_id: str,
        variable_id: str,
        score: float,
        max_score: float | None,
    ) -> None:
        """Publie la note associée au line item fourni."""


class NullAGSClient:
    """Client AGS inactif utilisé lorsque l'intégration est désactivée."""

    async def ensure_line_item(
        self,
        *,
        context: ChatKitRequestContext | None,
        variable_id: str,
        max_score: float | None,
        comment: str | None,
    ) -> str | None:  # pragma: no cover - comportement trivial
        return None

    async def publish_score(
        self,
        *,
        context: ChatKitRequestContext | None,
        line_item_id: str,
        variable_id: str,
        score: float,
        max_score: float | None,
    ) -> None:  # pragma: no cover - comportement trivial
        return None


async def process_workflow_end_state_ags(
    *,
    client: AGSClientProtocol | None,
    end_state: WorkflowEndState | None,
    context: ChatKitRequestContext | None,
) -> None:
    """Déclenche la publication de note AGS à partir d'un état de fin."""

    if client is None or end_state is None:
        return

    variable_id = end_state.ags_variable_id
    score_value = end_state.ags_score_value
    if not variable_id or score_value is None:
        return

    max_score = end_state.ags_score_maximum

    try:
        line_item_id = await client.ensure_line_item(
            context=context,
            variable_id=variable_id,
            max_score=max_score,
            comment=None,
        )
    except Exception as exc:  # pragma: no cover - robustesse réseau
        logger.warning(
            "Impossible de garantir le line item AGS %s", variable_id, exc_info=exc
        )
        return

    target_line_item = line_item_id or variable_id

    try:
        await client.publish_score(
            context=context,
            line_item_id=target_line_item,
            variable_id=variable_id,
            score=score_value,
            max_score=max_score,
        )
    except Exception as exc:  # pragma: no cover - robustesse réseau
        logger.warning(
            "Impossible de publier la note AGS %s", variable_id, exc_info=exc
        )


__all__ = [
    "AGSClientProtocol",
    "NullAGSClient",
    "process_workflow_end_state_ags",
]

