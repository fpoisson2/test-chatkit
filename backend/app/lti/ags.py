from __future__ import annotations

import datetime
import json
import logging
import secrets
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy.orm import Session

from ..chatkit_server.ags import AGSClientProtocol
from ..chatkit_server.context import ChatKitRequestContext
from ..config import Settings, get_settings
from ..models import LTIRegistration

logger = logging.getLogger("chatkit.server")

_LINEITEM_SCOPE = "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem"
_SCORE_SCOPE = "https://purl.imsglobal.org/spec/lti-ags/scope/score"
_LINEITEM_READONLY_SCOPE = (
    "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly"
)

AsyncClientFactory = Callable[[], AbstractAsyncContextManager[httpx.AsyncClient]]


@asynccontextmanager
async def _default_http_client_factory() -> (
    AbstractAsyncContextManager[httpx.AsyncClient]
):
    async with httpx.AsyncClient(timeout=10.0) as client:
        yield client


class LTIAGSClient(AGSClientProtocol):
    """Client AGS utilisant l'intégration LTI configurée."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        settings: Settings | None = None,
        http_client_factory: AsyncClientFactory | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings or get_settings()
        self._http_client_factory = http_client_factory or _default_http_client_factory

    async def ensure_line_item(
        self,
        *,
        context: ChatKitRequestContext | None,
        variable_id: str,
        max_score: float | None,
        comment: str | None,
    ) -> str | None:
        if context is None:
            return None

        variable_key = (variable_id or "").strip()
        if not variable_key:
            return None

        registration = self._resolve_registration(context)
        if registration is None:
            return context.ags_line_item_endpoint

        scopes = self._collect_scopes(context)
        if _LINEITEM_SCOPE not in scopes and _LINEITEM_READONLY_SCOPE not in scopes:
            logger.debug(
                "LTI AGS: scope lineitem absent, aucune création pour %s",
                variable_key,
            )
            return context.ags_line_item_endpoint

        line_items_endpoint = (context.ags_line_items_endpoint or "").strip()
        if not line_items_endpoint:
            return context.ags_line_item_endpoint

        token = await self._obtain_access_token(registration, scopes)
        if token is None:
            return context.ags_line_item_endpoint

        existing = await self._lookup_line_item(
            line_items_endpoint,
            token,
            variable_key,
            resource_link_ref=context.lti_resource_link_ref,
        )
        if existing is not None:
            line_item_id = existing.get("id") or context.ags_line_item_endpoint
            if line_item_id and max_score is not None:
                await self._update_line_item_if_needed(
                    line_item_id,
                    token,
                    variable_key,
                    max_score,
                    comment,
                    resource_link_ref=context.lti_resource_link_ref,
                )
            return line_item_id

        created = await self._create_line_item(
            line_items_endpoint,
            token,
            variable_key,
            max_score,
            comment,
            context=context,
        )
        return created or context.ags_line_item_endpoint

    async def publish_score(
        self,
        *,
        context: ChatKitRequestContext | None,
        line_item_id: str,
        variable_id: str,
        score: float,
        max_score: float | None,
        comment: str | None,
    ) -> None:
        if context is None:
            return

        registration = self._resolve_registration(context)
        if registration is None:
            return

        scopes = self._collect_scopes(context)
        if _SCORE_SCOPE not in scopes:
            logger.debug(
                "LTI AGS: scope score absent, publication ignorée pour %s",
                variable_id,
            )
            return

        token = await self._obtain_access_token(registration, scopes)
        if token is None:
            return

        target = (line_item_id or "").strip()
        if not target:
            return
        if not target.startswith("http"):
            logger.warning("LTI AGS: identifiant de line item inattendu: %s", target)
            return

        user_id = (context.lti_platform_user_id or "").strip()
        if not user_id:
            logger.debug("LTI AGS: aucun user_id plateforme, impossible de publier")
            return

        score_maximum = self._coerce_score(
            max_score,
            fallback=context.ags_default_score_maximum,
            secondary=score,
        )

        payload: dict[str, Any] = {
            "userId": user_id,
            "scoreGiven": float(score),
            "timestamp": datetime.datetime.now(datetime.UTC)
            .replace(tzinfo=datetime.UTC)
            .isoformat()
            .replace("+00:00", "Z"),
            "activityProgress": "Completed",
            "gradingProgress": "FullyGraded",
        }
        if score_maximum is not None:
            payload["scoreMaximum"] = score_maximum
        if comment:
            payload["comment"] = comment

        scores_endpoint = self._build_scores_endpoint(target)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/vnd.ims.lis.v1.score+json",
            "Accept": "application/vnd.ims.lis.v1.score+json",
        }

        try:
            body = json.dumps(payload)
            async with self._http_client_factory() as client:
                response = await client.post(
                    scores_endpoint,
                    content=body,
                    headers=headers,
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning(
                "Impossible de publier la note AGS %s vers %s",
                variable_id,
                scores_endpoint,
                exc_info=exc,
            )

    def _resolve_registration(
        self, context: ChatKitRequestContext
    ) -> LTIRegistration | None:
        registration_id = context.lti_registration_id
        if registration_id is None:
            return None

        session = self._session_factory()
        try:
            registration = session.get(LTIRegistration, registration_id)
            if registration is None:
                logger.warning(
                    "LTI AGS: registration introuvable (id=%s)", registration_id
                )
            return registration
        finally:
            session.close()

    def _collect_scopes(self, context: ChatKitRequestContext) -> set[str]:
        scopes = set()
        if context.ags_scopes:
            for entry in context.ags_scopes:
                if not entry:
                    continue
                for token in entry.replace(",", " ").split():
                    scope = token.strip()
                    if scope:
                        scopes.add(scope)
        return scopes

    async def _obtain_access_token(
        self,
        registration: LTIRegistration,
        scopes: Sequence[str],
    ) -> str | None:
        if not scopes:
            return None

        private_key = self._settings.lti_tool_private_key
        if not private_key:
            logger.debug("LTI AGS: clé privée non configurée")
            return None

        token_endpoint = (registration.token_endpoint or "").strip()
        if not token_endpoint:
            logger.debug("LTI AGS: token endpoint manquant")
            return None

        client_id = (
            self._settings.lti_tool_client_id or registration.client_id or ""
        ).strip()
        if not client_id:
            logger.debug("LTI AGS: client_id manquant")
            return None

        now = datetime.datetime.now(datetime.UTC)
        claim = {
            "iss": client_id,
            "sub": client_id,
            "aud": token_endpoint,
            "iat": int(now.timestamp()),
            "exp": int((now + datetime.timedelta(minutes=5)).timestamp()),
            "jti": secrets.token_urlsafe(8),
        }
        headers: dict[str, str] = {}
        if self._settings.lti_tool_key_id:
            headers["kid"] = self._settings.lti_tool_key_id

        assertion = jwt.encode(
            claim,
            private_key,
            algorithm="RS256",
            headers=headers or None,
        )

        scope_value = " ".join(sorted(set(scopes)))
        data = {
            "grant_type": "client_credentials",
            "client_assertion_type": (
                "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
            ),
            "client_assertion": assertion,
            "scope": scope_value,
        }
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }

        try:
            async with self._http_client_factory() as client:
                response = await client.post(token_endpoint, data=data, headers=headers)
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError as exc:
            logger.warning("LTI AGS: échec de récupération du token", exc_info=exc)
            return None

        access_token = payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            logger.warning("LTI AGS: réponse token invalide (%s)", payload)
            return None
        return access_token

    async def _lookup_line_item(
        self,
        line_items_endpoint: str,
        token: str,
        variable_id: str,
        *,
        resource_link_ref: str | None,
    ) -> Mapping[str, Any] | None:
        params = {"resource_id": variable_id}
        if resource_link_ref:
            params["resource_link_id"] = resource_link_ref
        query_url = self._merge_query_params(line_items_endpoint, params)
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.ims.lis.v2.lineitemcontainer+json",
        }
        try:
            async with self._http_client_factory() as client:
                response = await client.get(query_url, headers=headers)
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError as exc:
            logger.warning(
                "LTI AGS: impossible de consulter les line items %s",
                query_url,
                exc_info=exc,
            )
            return None

        if isinstance(payload, list) and payload:
            first = payload[0]
            if isinstance(first, Mapping):
                return first
        return None

    async def _update_line_item_if_needed(
        self,
        line_item_id: str,
        token: str,
        variable_id: str,
        max_score: float,
        comment: str | None,
        *,
        resource_link_ref: str | None,
    ) -> None:
        payload: dict[str, Any] = {
            "label": comment or variable_id,
            "resourceId": variable_id,
            "tag": variable_id,
        }
        score_max = self._coerce_score(max_score, fallback=None)
        if score_max is not None:
            payload["scoreMaximum"] = score_max
        if resource_link_ref:
            payload["resourceLinkId"] = resource_link_ref

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/vnd.ims.lis.v2.lineitem+json",
            "Accept": "application/vnd.ims.lis.v2.lineitem+json",
        }

        try:
            async with self._http_client_factory() as client:
                response = await client.put(line_item_id, json=payload, headers=headers)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.debug(
                "LTI AGS: mise à jour du line item ignorée (%s)",
                line_item_id,
                exc_info=exc,
            )

    async def _create_line_item(
        self,
        line_items_endpoint: str,
        token: str,
        variable_id: str,
        max_score: float | None,
        comment: str | None,
        *,
        context: ChatKitRequestContext,
    ) -> str | None:
        payload: dict[str, Any] = {
            "label": comment or context.ags_default_label or variable_id,
            "resourceId": variable_id,
            "tag": variable_id,
        }
        score_max = self._coerce_score(
            max_score,
            fallback=context.ags_default_score_maximum,
        )
        if score_max is not None:
            payload["scoreMaximum"] = score_max
        if context.lti_resource_link_ref:
            payload["resourceLinkId"] = context.lti_resource_link_ref

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/vnd.ims.lis.v2.lineitem+json",
            "Accept": "application/vnd.ims.lis.v2.lineitem+json",
        }

        try:
            async with self._http_client_factory() as client:
                response = await client.post(
                    line_items_endpoint,
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                created = response.json()
        except httpx.HTTPError as exc:
            logger.warning(
                "LTI AGS: impossible de créer le line item %s",
                variable_id,
                exc_info=exc,
            )
            return None

        if isinstance(created, Mapping):
            line_item_id = created.get("id")
            if isinstance(line_item_id, str) and line_item_id:
                return line_item_id
        return None

    @staticmethod
    def _merge_query_params(url: str, params: Mapping[str, str]) -> str:
        if not params:
            return url
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}{urlencode(params)}"

    @staticmethod
    def _build_scores_endpoint(line_item_url: str) -> str:
        """Insert the ``/scores`` segment before any query string."""

        stripped = (line_item_url or "").strip()
        if not stripped:
            return ""

        base, separator, query = stripped.partition("?")
        base = base.rstrip("/") + "/scores"

        if separator:
            return f"{base}?{query}"
        return base

    @staticmethod
    def _coerce_score(
        value: float | None,
        *,
        fallback: float | None,
        secondary: float | None = None,
    ) -> float | None:
        for candidate in (value, fallback, secondary):
            if candidate is None:
                continue
            try:
                return float(candidate)
            except (TypeError, ValueError):
                continue
        return None


__all__ = ["LTIAGSClient"]
