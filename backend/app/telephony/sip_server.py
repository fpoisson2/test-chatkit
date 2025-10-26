"""Résolution de workflow pour les appels SIP entrants."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..database import SessionLocal
from ..voice_settings import get_or_create_voice_settings
from ..workflows.service import (
    TelephonyRouteConfig,
    TelephonyRouteOverrides,
    TelephonyStartConfiguration,
    WorkflowDefinition,
    WorkflowService,
    resolve_start_telephony_config,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TelephonyRouteResolution:
    """Résultat brut de la sélection d'une route téléphonie."""

    workflow_definition: WorkflowDefinition
    normalized_number: str
    original_number: str
    route: TelephonyRouteConfig | None


@dataclass(frozen=True)
class TelephonyCallContext(TelephonyRouteResolution):
    """Contexte complet nécessaire pour exécuter un workflow téléphonie."""

    voice_model: str | None
    voice_instructions: str | None
    voice_voice: str | None
    voice_prompt_variables: dict[str, str]


class TelephonyRouteSelectionError(RuntimeError):
    """Signale qu'aucune route téléphonie ne correspond au numéro entrant."""


def _normalize_incoming_number(number: str) -> str:
    sanitized = "".join(
        ch for ch in str(number) if str(ch).isdigit() or ch in {"+", "#", "*"}
    )
    return sanitized


def _sanitize_prompt_variables(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    sanitized: dict[str, str] = {}
    for key, raw in value.items():
        if not isinstance(key, str):
            continue
        trimmed_key = key.strip()
        if not trimmed_key:
            continue
        if raw is None:
            sanitized[trimmed_key] = ""
        elif isinstance(raw, str):
            sanitized[trimmed_key] = raw
        else:
            sanitized[trimmed_key] = str(raw)
    return sanitized


def _merge_voice_settings(
    *,
    session: Session | None,
    overrides: TelephonyRouteOverrides | None,
    settings: Settings,
) -> tuple[str, str, str, dict[str, str]]:
    db: Session
    owns_session = False
    if session is None:
        db = SessionLocal()
        owns_session = True
    else:
        db = session

    try:
        voice_settings = get_or_create_voice_settings(db)
        model = (
            voice_settings.model or settings.chatkit_realtime_model or "gpt-realtime"
        )
        instructions = (
            voice_settings.instructions
            or settings.chatkit_realtime_instructions
            or "Assistant vocal ChatKit"
        )
        voice = voice_settings.voice or settings.chatkit_realtime_voice or "verse"
        prompt_variables = _sanitize_prompt_variables(
            getattr(voice_settings, "prompt_variables", {}) or {}
        )
    finally:
        if owns_session:
            db.close()

    if overrides is not None:
        if overrides.model:
            model = overrides.model
        if overrides.instructions:
            instructions = overrides.instructions
        if overrides.voice:
            voice = overrides.voice
        if overrides.prompt_variables:
            prompt_variables.update(overrides.prompt_variables)

    return model, instructions, voice, prompt_variables


def _match_route(
    config: TelephonyStartConfiguration,
    normalized_number: str,
) -> TelephonyRouteConfig | None:
    if not config.routes and config.default_route is None:
        return None

    exact_matches: list[TelephonyRouteConfig] = []
    prefix_matches: list[tuple[int, TelephonyRouteConfig]] = []

    for route in sorted(config.routes, key=lambda entry: entry.priority):
        if normalized_number and normalized_number in route.phone_numbers:
            exact_matches.append(route)
            continue

        longest_prefix = 0
        for prefix in route.prefixes:
            if not prefix:
                continue
            if normalized_number.startswith(prefix):
                longest_prefix = max(longest_prefix, len(prefix))
        if longest_prefix:
            prefix_matches.append((longest_prefix, route))

    if len(exact_matches) > 1:
        logger.info(
            "Plusieurs routes téléphonie correspondent exactement au numéro %s : %s",
            normalized_number,
            [
                route.label or route.workflow_slug or str(route.priority)
                for route in exact_matches
            ],
        )

    if exact_matches:
        return exact_matches[0]

    if prefix_matches:
        prefix_matches.sort(key=lambda item: (-item[0], item[1].priority))
        if len(prefix_matches) > 1 and prefix_matches[0][0] == prefix_matches[1][0]:
            logger.info(
                "Plusieurs routes téléphonie partagent le même préfixe pour %s, "
                "sélection de la première configurée.",
                normalized_number,
            )
        return prefix_matches[0][1]

    return config.default_route


def resolve_workflow_for_phone_number(
    workflow_service: WorkflowService,
    *,
    phone_number: str,
    workflow_slug: str | None = None,
    session: Session | None = None,
    settings: Settings | None = None,
) -> TelephonyCallContext:
    """Résout le workflow et les overrides voix pour un appel entrant."""

    effective_settings = settings or get_settings()

    logger.info(
        "Appel entrant reçu pour %s (workflow demandé=%s)",
        phone_number,
        workflow_slug or "<non spécifié>",
    )

    if workflow_slug:
        definition = workflow_service.get_definition_by_slug(
            workflow_slug, session=session
        )
    else:
        definition = workflow_service.get_current(session=session)

    normalized_number = _normalize_incoming_number(phone_number)

    if normalized_number != phone_number:
        logger.info(
            "Numéro entrant normalisé de %s vers %s",
            phone_number,
            normalized_number,
        )
    else:
        logger.info("Numéro entrant %s déjà normalisé", normalized_number)

    telephony_config = resolve_start_telephony_config(definition)
    if telephony_config is None:
        logger.info(
            "Workflow %s sans configuration téléphonie : utilisation de la définition "
            "courante.",
            getattr(definition.workflow, "slug", "<inconnu>"),
        )
        model, instructions, voice, prompt_variables = _merge_voice_settings(
            session=session, overrides=None, settings=effective_settings
        )
        return TelephonyCallContext(
            workflow_definition=definition,
            normalized_number=normalized_number,
            original_number=phone_number,
            route=None,
            voice_model=model,
            voice_instructions=instructions,
            voice_voice=voice,
            voice_prompt_variables=prompt_variables,
        )
    else:
        logger.info(
            "Configuration téléphonie chargée pour %s : %d route(s), "
            "route par défaut=%s",
            getattr(definition.workflow, "slug", "<inconnu>"),
            len(telephony_config.routes),
            "oui" if telephony_config.default_route else "non",
        )

    route = _match_route(telephony_config, normalized_number)

    if route is None:
        logger.warning(
            "Aucune route téléphonie ne correspond au numéro %s pour le workflow %s",
            phone_number,
            getattr(definition.workflow, "slug", "<inconnu>"),
        )
        raise TelephonyRouteSelectionError(
            f"Aucune route téléphonie pour le numéro {phone_number!r}"
        )

    if route is telephony_config.default_route:
        match_reason = "route par défaut"
    elif normalized_number and normalized_number in route.phone_numbers:
        match_reason = "correspondance exacte"
    else:
        matched_prefix = next(
            (
                prefix
                for prefix in route.prefixes
                if normalized_number.startswith(prefix)
            ),
            None,
        )
        match_reason = (
            f"préfixe {matched_prefix}" if matched_prefix else "route configurée"
        )

    logger.info(
        "Route téléphonie sélectionnée (%s) : label=%s, workflow=%s, priorité=%s",
        match_reason,
        route.label or "<sans-label>",
        route.workflow_slug or getattr(definition.workflow, "slug", "<inconnu>"),
        route.priority,
    )

    selected_definition = definition
    if route.workflow_slug and (
        not hasattr(definition, "workflow")
        or getattr(definition.workflow, "slug", None) != route.workflow_slug
    ):
        try:
            selected_definition = workflow_service.get_definition_by_slug(
                route.workflow_slug,
                session=session,
            )
        except Exception as exc:
            logger.error(
                "Impossible de charger le workflow %s référencé dans la route %s",
                route.workflow_slug,
                route.label or route.workflow_slug or "<sans-label>",
                exc_info=exc,
            )
            raise TelephonyRouteSelectionError(
                f"Workflow {route.workflow_slug!r} introuvable pour la route téléphonie"
            ) from exc
        else:
            logger.info(
                "Workflow surchargé chargé depuis la route : %s",
                route.workflow_slug,
            )

    model, instructions, voice, prompt_variables = _merge_voice_settings(
        session=session, overrides=route.overrides, settings=effective_settings
    )

    logger.info(
        "Paramètres voix appliqués : modèle=%s, voix=%s, instructions=%s, variables=%s",
        model,
        voice,
        instructions,
        prompt_variables,
    )

    return TelephonyCallContext(
        workflow_definition=selected_definition,
        normalized_number=normalized_number,
        original_number=phone_number,
        route=route,
        voice_model=model,
        voice_instructions=instructions,
        voice_voice=voice,
        voice_prompt_variables=prompt_variables,
    )


__all__ = [
    "TelephonyCallContext",
    "TelephonyRouteResolution",
    "TelephonyRouteSelectionError",
    "resolve_workflow_for_phone_number",
]
