from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass

NormalizedModelKey = tuple[str, str, str]


@dataclass(frozen=True)
class ModelCapabilities:
    """Features pris en charge par un modèle spécifique."""

    supports_previous_response_id: bool
    supports_reasoning_summary: bool


def normalize_model_identifier(
    name: str | None,
    provider_id: str | None,
    provider_slug: str | None,
) -> NormalizedModelKey:
    normalized_name = name.strip() if isinstance(name, str) else ""
    normalized_provider_id = provider_id.strip() if isinstance(provider_id, str) else ""
    normalized_provider_slug = (
        provider_slug.strip().lower() if isinstance(provider_slug, str) else ""
    )
    return normalized_name, normalized_provider_id, normalized_provider_slug


def iter_model_capability_keys(
    name: str | None,
    provider_id: str | None,
    provider_slug: str | None,
) -> Iterator[NormalizedModelKey]:
    normalized_name, normalized_provider_id, normalized_provider_slug = (
        normalize_model_identifier(name, provider_id, provider_slug)
    )
    if not normalized_name:
        return

    yield normalized_name, normalized_provider_id, normalized_provider_slug
    if normalized_provider_id:
        yield normalized_name, normalized_provider_id, ""
    if normalized_provider_slug:
        yield normalized_name, "", normalized_provider_slug
    yield normalized_name, "", ""


def lookup_model_capabilities(
    index: Mapping[NormalizedModelKey, ModelCapabilities],
    *,
    name: str | None,
    provider_id: str | None,
    provider_slug: str | None,
) -> ModelCapabilities | None:
    for key in iter_model_capability_keys(name, provider_id, provider_slug):
        capability = index.get(key)
        if capability is not None:
            return capability
    return None
