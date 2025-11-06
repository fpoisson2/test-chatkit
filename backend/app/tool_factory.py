"""Fabrique centralisant la construction des outils Agents."""

from __future__ import annotations

from importlib import import_module
from types import ModuleType
from typing import Any, Callable

_MODULE_PATHS: dict[str, str] = {
    "web_search": "backend.app.tool_builders.web_search",
    "image_generation": "backend.app.tool_builders.image_generation",
    "computer_use": "backend.app.tool_builders.computer_use",
    "file_search": "backend.app.tool_builders.file_search",
    "weather": "backend.app.tool_builders.weather",
    "mcp": "backend.app.tool_builders.mcp",
    "workflow": "backend.app.tool_builders.workflow",
    "widget_validation": "backend.app.tool_builders.widget_validation",
}

_MODULE_CACHE: dict[str, ModuleType] = {}
_BUILDER_CACHE: dict[str, Callable[[Any], Any]] = {}

_BUILDER_REGISTRY: dict[str, tuple[str, str]] = {
    "build_web_search_tool": ("web_search", "build_web_search_tool"),
    "build_image_generation_tool": ("image_generation", "build_image_generation_tool"),
    "build_computer_use_tool": ("computer_use", "build_computer_use_tool"),
    "build_file_search_tool": ("file_search", "build_file_search_tool"),
    "build_weather_tool": ("weather", "build_weather_tool"),
    "build_mcp_tool": ("mcp", "build_mcp_tool"),
    "build_workflow_validation_tool": (
        "workflow",
        "build_workflow_validation_tool",
    ),
    "build_workflow_tool": ("workflow", "build_workflow_tool"),
    "build_widget_validation_tool": (
        "widget_validation",
        "build_widget_validation_tool",
    ),
}

_DEFERRED_EXPORTS: dict[str, tuple[str, str]] = {
    "sanitize_web_search_user_location": (
        "web_search",
        "sanitize_web_search_user_location",
    ),
    "ImageGeneration": ("image_generation", "ImageGeneration"),
    "ImageGenerationTool": ("image_generation", "ImageGenerationTool"),
    "WidgetValidationResult": ("widget_validation", "WidgetValidationResult"),
    "WorkflowValidationResult": ("workflow", "WorkflowValidationResult"),
    "validate_workflow_graph": ("workflow", "validate_workflow_graph"),
    "validate_widget_definition": (
        "widget_validation",
        "validate_widget_definition",
    ),
    "ResolvedMcpServerContext": ("mcp", "ResolvedMcpServerContext"),
    "resolve_mcp_tool_configuration": (
        "mcp",
        "resolve_mcp_tool_configuration",
    ),
    "get_mcp_runtime_context": ("mcp", "get_mcp_runtime_context"),
    "attach_mcp_runtime_context": ("mcp", "attach_mcp_runtime_context"),
}


def _load_module(key: str) -> ModuleType:
    try:
        return _MODULE_CACHE[key]
    except KeyError:
        module = import_module(_MODULE_PATHS[key])
        _MODULE_CACHE[key] = module
        return module


def _get_builder(name: str) -> Callable[[Any], Any]:
    builder = _BUILDER_CACHE.get(name)
    if builder is None:
        module_key, attr = _BUILDER_REGISTRY[name]
        module = _load_module(module_key)
        builder = getattr(module, attr)
        _BUILDER_CACHE[name] = builder
    return builder


def build_web_search_tool(payload: Any) -> Any:
    return _get_builder("build_web_search_tool")(payload)


def build_image_generation_tool(payload: Any) -> Any:
    return _get_builder("build_image_generation_tool")(payload)


def build_computer_use_tool(payload: Any) -> Any:
    return _get_builder("build_computer_use_tool")(payload)


def build_file_search_tool(payload: Any) -> Any:
    return _get_builder("build_file_search_tool")(payload)


def build_weather_tool(payload: Any) -> Any:
    return _get_builder("build_weather_tool")(payload)


def build_mcp_tool(payload: Any) -> Any:
    return _get_builder("build_mcp_tool")(payload)


def build_workflow_validation_tool(payload: Any) -> Any:
    return _get_builder("build_workflow_validation_tool")(payload)


def build_workflow_tool(payload: Any) -> Any:
    return _get_builder("build_workflow_tool")(payload)


def build_widget_validation_tool(payload: Any) -> Any:
    return _get_builder("build_widget_validation_tool")(payload)


def __getattr__(name: str) -> Any:  # pragma: no cover - délègue aux modules
    if name in _DEFERRED_EXPORTS:
        module_key, attr = _DEFERRED_EXPORTS[name]
        value = getattr(_load_module(module_key), attr)
        globals()[name] = value
        return value
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "ImageGeneration",
    "ImageGenerationTool",
    "ResolvedMcpServerContext",
    "WidgetValidationResult",
    "WorkflowValidationResult",
    "attach_mcp_runtime_context",
    "build_computer_use_tool",
    "build_file_search_tool",
    "build_image_generation_tool",
    "build_mcp_tool",
    "build_weather_tool",
    "build_workflow_tool",
    "build_workflow_validation_tool",
    "build_web_search_tool",
    "build_widget_validation_tool",
    "get_mcp_runtime_context",
    "resolve_mcp_tool_configuration",
    "sanitize_web_search_user_location",
    "validate_workflow_graph",
    "validate_widget_definition",
]
