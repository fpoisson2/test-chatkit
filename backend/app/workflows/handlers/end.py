"""Handler for end nodes."""

from __future__ import annotations

import logging
import math
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..executor import WorkflowEndState
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


def _sanitize_end_value(value: Any) -> str | None:
    """Extract and clean string values for end node parameters."""
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned:
            return cleaned
    return None


def _coerce_score_value(value: Any) -> float | None:
    """Convert various value types to a valid score float."""
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None
        if math.isnan(numeric) or math.isinf(numeric):
            return None
        return numeric
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        normalized = candidate
        if "," in candidate and "." not in candidate:
            normalized = candidate.replace(",", ".")
        try:
            numeric = float(normalized)
        except ValueError:
            return None
        if math.isnan(numeric) or math.isinf(numeric):
            return None
        return numeric
    return None


class EndNodeHandler(BaseNodeHandler):
    """Handler for end nodes.

    End nodes terminate the workflow and return a final state with
    optional status, message, and AGS scoring information.
    """

    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute end node and terminate workflow."""
        from ..executor import WorkflowEndState
        from ..runtime.state_machine import NodeResult
        from ...vector_store.ingestion import evaluate_state_expression

        end_state = self._parse_end_state(node, context)

        resolved_message = (
            end_state.message
            or end_state.status_reason
            or "Workflow terminé"
        )

        end_payload: dict[str, Any] = {"message": resolved_message}
        if end_state.status_reason:
            end_payload["status_reason"] = end_state.status_reason
        if end_state.status_type:
            end_payload["status_type"] = end_state.status_type

        ags_payload: dict[str, Any] | None = None
        if end_state.ags_variable_id:
            ags_payload = {"variable_id": end_state.ags_variable_id}
            if end_state.ags_score_value is not None:
                ags_payload["score"] = end_state.ags_score_value
            if end_state.ags_score_maximum is not None:
                ags_payload["maximum"] = end_state.ags_score_maximum
            if ags_payload:
                end_payload["ags"] = ags_payload

        # Record step if callback provided
        if context.record_step:
            await context.record_step(
                node.slug,
                self._node_title(node),
                end_payload,
            )

        end_state_payload: dict[str, Any] = {
            "slug": end_state.slug,
            "status_type": end_state.status_type,
            "status_reason": end_state.status_reason,
            "message": end_state.message,
        }
        if ags_payload:
            end_state_payload["ags"] = ags_payload

        last_step_context = {
            "output": end_payload,
            "output_structured": end_payload,
            "output_parsed": end_payload,
            "output_text": resolved_message,
            "assistant_message": resolved_message,
            "end_state": end_state_payload,
        }

        # Store end state in runtime_vars to block new user messages
        context.runtime_vars["final_end_state"] = end_state

        return NodeResult(
            finished=True,
            output=end_payload,
            context_updates={
                "last_step_context": last_step_context,
            }
        )

    def _parse_end_state(
        self,
        step: WorkflowStep,
        context: ExecutionContext,
    ) -> WorkflowEndState:
        """Parse end state from node parameters."""
        from ..executor import WorkflowEndState
        from ...vector_store.ingestion import evaluate_state_expression

        raw_params = step.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}

        status_raw = params.get("status")
        status_type = None
        status_reason = None
        if isinstance(status_raw, Mapping):
            status_type = _sanitize_end_value(status_raw.get("type"))
            status_reason = (
                _sanitize_end_value(status_raw.get("reason")) or status_reason
            )

        for key in ("status_reason", "reason"):
            fallback = _sanitize_end_value(params.get(key))
            if fallback:
                status_reason = status_reason or fallback
                break

        message = _sanitize_end_value(params.get("message"))

        # AGS scoring
        ags_variable_id: str | None = None
        ags_score_value: float | None = None
        ags_maximum: float | None = None

        ags_raw = params.get("ags")
        ags_config = ags_raw if isinstance(ags_raw, Mapping) else None
        if ags_config:
            raw_identifier = ags_config.get("score_variable_id")
            if not isinstance(raw_identifier, str):
                raw_identifier = ags_config.get("variable_id")
            ags_variable_id = (
                _sanitize_end_value(raw_identifier)
                if isinstance(raw_identifier, str)
                else None
            )

            def _evaluate(expression_key: str) -> Any:
                expression = ags_config.get(expression_key)
                try:
                    return evaluate_state_expression(
                        expression,
                        state=context.state,
                        default_input_context=context.last_step_context,
                    )
                except Exception as exc:  # pragma: no cover
                    logger.warning(
                        "Impossible de résoudre l'expression AGS %s sur le bloc %s",
                        expression_key,
                        step.slug,
                        exc_info=exc,
                    )
                    return None

            value_candidate = _evaluate("value")
            if value_candidate is None and "score" in ags_config:
                value_candidate = _evaluate("score")
            if value_candidate is None and "score_value" in ags_config:
                value_candidate = _evaluate("score_value")
            ags_score_value = _coerce_score_value(value_candidate)

            maximum_candidate = _evaluate("maximum")
            if maximum_candidate is None and "max_score" in ags_config:
                maximum_candidate = _evaluate("max_score")
            ags_maximum = _coerce_score_value(maximum_candidate)

        return WorkflowEndState(
            slug=step.slug,
            status_type=status_type or "closed",  # Default to "closed" to block new messages
            status_reason=status_reason,
            message=message,
            ags_variable_id=ags_variable_id,
            ags_score_value=ags_score_value,
            ags_score_maximum=ags_maximum,
        )
