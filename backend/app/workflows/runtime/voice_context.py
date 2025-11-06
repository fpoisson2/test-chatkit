from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from chatkit.agents import AgentContext

from ...chatkit_server.actions import _json_safe_copy
from ...config import get_settings
from ...models import WorkflowStep


@dataclass(frozen=True)
class _VoicePreferenceOverrides:
    model: str | None
    instructions: str | None
    voice: str | None
    prompt_variables: dict[str, str]
    provider_id: str | None
    provider_slug: str | None

    def is_empty(self) -> bool:
        return not (
            (self.model and self.model.strip())
            or (self.instructions and self.instructions.strip())
            or (self.voice and self.voice.strip())
            or (self.provider_id and self.provider_id.strip())
            or (self.provider_slug and self.provider_slug.strip())
            or self.prompt_variables
        )


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float) and not isinstance(value, bool):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return False


def _extract_voice_overrides(
    agent_context: AgentContext[Any],
) -> _VoicePreferenceOverrides | None:
    request_context = getattr(agent_context, "request_context", None)
    if request_context is None:
        return None

    model = getattr(request_context, "voice_model", None)
    instructions = getattr(request_context, "voice_instructions", None)
    voice = getattr(request_context, "voice_voice", None)
    prompt_variables_raw = getattr(
        request_context, "voice_prompt_variables", None
    )
    if isinstance(prompt_variables_raw, Mapping):
        prompt_variables = {
            str(key).strip(): "" if value is None else str(value)
            for key, value in prompt_variables_raw.items()
            if isinstance(key, str) and key.strip()
        }
    else:
        prompt_variables = {}

    provider_id_raw = getattr(request_context, "voice_model_provider_id", None)
    provider_slug_raw = getattr(request_context, "voice_model_provider_slug", None)

    sanitized_model = model if isinstance(model, str) and model.strip() else None
    sanitized_instructions = (
        instructions if isinstance(instructions, str) and instructions.strip() else None
    )
    sanitized_voice = voice if isinstance(voice, str) and voice.strip() else None
    sanitized_provider_id = (
        provider_id_raw.strip()
        if isinstance(provider_id_raw, str) and provider_id_raw.strip()
        else None
    )
    sanitized_provider_slug = (
        provider_slug_raw.strip().lower()
        if isinstance(provider_slug_raw, str) and provider_slug_raw.strip()
        else None
    )
    overrides = _VoicePreferenceOverrides(
        sanitized_model,
        sanitized_instructions,
        sanitized_voice,
        prompt_variables,
        sanitized_provider_id,
        sanitized_provider_slug,
    )

    return None if overrides.is_empty() else overrides


_VOICE_DEFAULT_START_MODE = "auto"
_VOICE_DEFAULT_STOP_MODE = "manual"
_VOICE_TOOL_DEFAULTS: dict[str, bool] = {
    "response": True,
    "transcription": True,
    "function_call": False,
}
_VOICE_DEFAULT_TURN_DETECTION: dict[str, Any] = {
    "type": "semantic_vad",
    "create_response": True,
    "interrupt_response": True,
}
_VOICE_DEFAULT_INPUT_AUDIO_FORMAT: dict[str, Any] = {
    "type": "audio/pcm",
    "rate": 24_000,
}
_VOICE_DEFAULT_OUTPUT_AUDIO_FORMAT: dict[str, Any] = {
    "type": "audio/pcm",
    "rate": 24_000,
}
_VOICE_DEFAULT_INPUT_AUDIO_TRANSCRIPTION: dict[str, Any] = {
    "model": "gpt-4o-mini-transcribe",
    "language": "fr-CA",
}
_VOICE_DEFAULT_INPUT_AUDIO_NOISE_REDUCTION: dict[str, Any] = {
    "type": "near_field",
}
_VOICE_DEFAULT_MODALITIES = ["audio"]
_VOICE_DEFAULT_SPEED = 1.0


def _resolve_voice_agent_configuration(
    step: WorkflowStep,
    *,
    overrides: _VoicePreferenceOverrides | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    params_raw = step.parameters or {}
    params = params_raw if isinstance(params_raw, Mapping) else {}

    settings = get_settings()

    def _sanitize_text(value: Any) -> str:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
        return ""

    def _resolve_value(
        key: str,
        *,
        override_value: str | None,
        fallback: str,
    ) -> str:
        override_candidate = (
            override_value.strip() if isinstance(override_value, str) else None
        )
        if override_candidate:
            return override_candidate
        step_candidate = _sanitize_text(params.get(key))
        if step_candidate:
            return step_candidate
        return fallback

    def _merge_mapping(
        default: Mapping[str, Any], override: Any
    ) -> dict[str, Any]:
        merged = copy.deepcopy(default)
        if isinstance(override, Mapping):
            for key, value in override.items():
                if isinstance(value, Mapping) and isinstance(
                    merged.get(key), Mapping
                ):
                    merged[key] = _merge_mapping(merged[key], value)
                else:
                    merged[key] = value
        return merged

    voice_model = _resolve_value(
        "model",
        override_value=getattr(overrides, "model", None),
        fallback=settings.chatkit_realtime_model,
    )
    instructions = _resolve_value(
        "instructions",
        override_value=getattr(overrides, "instructions", None),
        fallback=settings.chatkit_realtime_instructions,
    )
    voice_id = _resolve_value(
        "voice",
        override_value=getattr(overrides, "voice", None),
        fallback=settings.chatkit_realtime_voice,
    )
    provider_id = _resolve_value(
        "model_provider_id",
        override_value=getattr(overrides, "provider_id", None),
        fallback=settings.chatkit_realtime_model_provider_id,
    )
    provider_slug = _resolve_value(
        "model_provider_slug",
        override_value=getattr(overrides, "provider_slug", None),
        fallback=settings.chatkit_realtime_model_provider_slug,
    )

    realtime_raw = params.get("realtime")
    realtime = realtime_raw if isinstance(realtime_raw, Mapping) else {}

    start_mode = realtime.get("start_mode") or _VOICE_DEFAULT_START_MODE
    if isinstance(start_mode, str):
        start_mode = start_mode.strip() or _VOICE_DEFAULT_START_MODE

    stop_mode = realtime.get("stop_mode") or _VOICE_DEFAULT_STOP_MODE
    if isinstance(stop_mode, str):
        stop_mode = stop_mode.strip() or _VOICE_DEFAULT_STOP_MODE

    tools_raw = realtime.get("tools")
    tools_mapping = tools_raw if isinstance(tools_raw, Mapping) else {}
    tools_permissions: dict[str, bool] = {}

    for key, default in _VOICE_TOOL_DEFAULTS.items():
        candidate = tools_mapping.get(key)
        if candidate is None:
            tools_permissions[key] = default
        else:
            tools_permissions[key] = _coerce_bool(candidate)

    realtime_config = {
        "start_mode": start_mode,
        "stop_mode": stop_mode,
        "tools": tools_permissions,
    }

    turn_detection_raw = realtime.get("turn_detection")
    if turn_detection_raw is False:
        pass
    elif isinstance(turn_detection_raw, Mapping):
        realtime_config["turn_detection"] = _merge_mapping(
            _VOICE_DEFAULT_TURN_DETECTION, turn_detection_raw
        )
    else:
        realtime_config["turn_detection"] = copy.deepcopy(
            _VOICE_DEFAULT_TURN_DETECTION
        )

    input_format_raw = realtime.get("input_audio_format")
    if isinstance(input_format_raw, Mapping):
        realtime_config["input_audio_format"] = _merge_mapping(
            _VOICE_DEFAULT_INPUT_AUDIO_FORMAT, input_format_raw
        )
    else:
        realtime_config["input_audio_format"] = copy.deepcopy(
            _VOICE_DEFAULT_INPUT_AUDIO_FORMAT
        )

    output_format_raw = realtime.get("output_audio_format")
    if isinstance(output_format_raw, Mapping):
        realtime_config["output_audio_format"] = _merge_mapping(
            _VOICE_DEFAULT_OUTPUT_AUDIO_FORMAT, output_format_raw
        )
    else:
        realtime_config["output_audio_format"] = copy.deepcopy(
            _VOICE_DEFAULT_OUTPUT_AUDIO_FORMAT
        )

    noise_reduction_raw = realtime.get("input_audio_noise_reduction")
    if isinstance(noise_reduction_raw, Mapping):
        realtime_config["input_audio_noise_reduction"] = _merge_mapping(
            _VOICE_DEFAULT_INPUT_AUDIO_NOISE_REDUCTION,
            noise_reduction_raw,
        )
    else:
        realtime_config["input_audio_noise_reduction"] = copy.deepcopy(
            _VOICE_DEFAULT_INPUT_AUDIO_NOISE_REDUCTION
        )

    transcription_raw = realtime.get("input_audio_transcription")
    if transcription_raw is False:
        pass
    else:
        transcription_config = _merge_mapping(
            _VOICE_DEFAULT_INPUT_AUDIO_TRANSCRIPTION,
            transcription_raw if isinstance(transcription_raw, Mapping) else {},
        )
        if instructions and not transcription_config.get("prompt"):
            transcription_config["prompt"] = instructions
        realtime_config["input_audio_transcription"] = transcription_config

    modalities_raw = realtime.get("modalities")
    if isinstance(modalities_raw, Sequence) and not isinstance(
        modalities_raw, str | bytes | bytearray
    ):
        sanitized_modalities: list[str] = []
        for entry in modalities_raw:
            if isinstance(entry, str):
                candidate = entry.strip().lower()
                if candidate and candidate not in sanitized_modalities:
                    sanitized_modalities.append(candidate)
        if "audio" not in sanitized_modalities:
            sanitized_modalities.append("audio")
        realtime_config["modalities"] = (
            sanitized_modalities or list(_VOICE_DEFAULT_MODALITIES)
        )
    else:
        realtime_config["modalities"] = list(_VOICE_DEFAULT_MODALITIES)

    speed_raw = realtime.get("speed")
    if isinstance(speed_raw, int | float):
        realtime_config["speed"] = float(speed_raw)
    else:
        realtime_config["speed"] = _VOICE_DEFAULT_SPEED

    tool_definitions = params.get("tools")
    sanitized_candidate = _json_safe_copy(tool_definitions)
    sanitized_tools = (
        sanitized_candidate if isinstance(sanitized_candidate, list) else []
    )

    handoffs_definitions = params.get("handoffs")
    sanitized_handoffs_candidate = _json_safe_copy(handoffs_definitions)
    sanitized_handoffs = (
        sanitized_handoffs_candidate
        if isinstance(sanitized_handoffs_candidate, list)
        else []
    )

    def _summarize_tool(entry: Any) -> dict[str, Any] | None:
        if not isinstance(entry, Mapping):
            return None
        summary: dict[str, Any] = {}
        tool_type = entry.get("type")
        if isinstance(tool_type, str) and tool_type.strip():
            summary["type"] = tool_type.strip()
        name_value = entry.get("name")
        if isinstance(name_value, str) and name_value.strip():
            summary["name"] = name_value.strip()
        title_value = entry.get("title") or entry.get("workflow_title")
        if isinstance(title_value, str) and title_value.strip():
            summary["title"] = title_value.strip()
        identifier_value = entry.get("identifier") or entry.get(
            "workflow_identifier"
        )
        if isinstance(identifier_value, str) and identifier_value.strip():
            summary["identifier"] = identifier_value.strip()
        description_value = entry.get("description")
        if isinstance(description_value, str) and description_value.strip():
            summary["description"] = description_value.strip()
        workflow_ref = entry.get("workflow")
        if isinstance(workflow_ref, Mapping):
            workflow_slug = workflow_ref.get("slug")
            if isinstance(workflow_slug, str) and workflow_slug.strip():
                summary["workflow_slug"] = workflow_slug.strip()
            workflow_id = workflow_ref.get("id") or workflow_ref.get("workflow_id")
            if isinstance(workflow_id, int) and workflow_id > 0:
                summary["workflow_id"] = workflow_id
        return summary or None

    tool_metadata = [
        summary
        for summary in (_summarize_tool(entry) for entry in sanitized_tools)
        if summary
    ]

    voice_context = {
        "model": voice_model,
        "voice": voice_id,
        "instructions": instructions,
        "realtime": realtime_config,
        "tools": sanitized_tools,
    }
    if sanitized_handoffs:
        voice_context["handoffs"] = sanitized_handoffs
    if provider_id:
        voice_context["model_provider_id"] = provider_id
    if provider_slug:
        voice_context["model_provider_slug"] = provider_slug
    if tool_metadata:
        voice_context["tool_metadata"] = tool_metadata
    prompt_variables: dict[str, str] = {}
    if overrides is not None and overrides.prompt_variables:
        prompt_variables = dict(overrides.prompt_variables)
    if prompt_variables:
        voice_context["prompt_variables"] = prompt_variables

    event_context = {
        "model": voice_model,
        "voice": voice_id,
        "instructions": instructions,
        "realtime": realtime_config,
        "tools": sanitized_tools,
        "tool_definitions": sanitized_tools,
    }
    if sanitized_handoffs:
        event_context["handoffs"] = sanitized_handoffs
    if provider_id:
        event_context["model_provider_id"] = provider_id
    if provider_slug:
        event_context["model_provider_slug"] = provider_slug
    if tool_metadata:
        event_context["tool_metadata"] = tool_metadata
    if prompt_variables:
        event_context["prompt_variables"] = prompt_variables

    return voice_context, event_context
