"""Construction de l'outil météo Agents."""

from __future__ import annotations

from typing import Any

from agents import FunctionTool, function_tool

from ..weather import fetch_weather

__all__ = ["build_weather_tool"]

_WEATHER_FUNCTION_TOOL_ALIASES = {"fetch_weather", "get_weather"}
_WEATHER_FUNCTION_TOOL_DEFAULT_DESCRIPTION = (
    "Récupère les conditions météorologiques actuelles via le service Python interne."
)


def build_weather_tool(payload: Any) -> FunctionTool | None:
    """Construit un FunctionTool pointant vers la fonction Python fetch_weather."""

    if isinstance(payload, FunctionTool):
        return payload

    name_override = "fetch_weather"
    description = _WEATHER_FUNCTION_TOOL_DEFAULT_DESCRIPTION

    if isinstance(payload, dict):
        raw_name = (
            payload.get("name") or payload.get("id") or payload.get("function_name")
        )
        if isinstance(raw_name, str) and raw_name.strip():
            candidate = raw_name.strip()
            if candidate.lower() in _WEATHER_FUNCTION_TOOL_ALIASES:
                name_override = candidate
            else:
                return None
        raw_description = payload.get("description")
        if isinstance(raw_description, str) and raw_description.strip():
            description = raw_description.strip()
    elif isinstance(payload, str) and payload.strip():
        candidate = payload.strip()
        if candidate.lower() in _WEATHER_FUNCTION_TOOL_ALIASES:
            name_override = candidate
        else:
            return None

    tool = function_tool(name_override=name_override)(fetch_weather)
    tool.description = description
    return tool
