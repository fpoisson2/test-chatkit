"""Services dédiés aux intégrations LTI 1.3."""

from __future__ import annotations

import base64
import datetime
import hashlib
import json
import secrets
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import (
    LTIDeployment,
    LTIRegistration,
    LTIResourceLink,
    LTIUserSession,
    User,
    Workflow,
)
from ..schemas import TokenResponse
from ..security import create_access_token, hash_password


def _now_utc() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _as_utc(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.UTC)
    return value.astimezone(datetime.UTC)


def _int_to_b64(value: int) -> str:
    size = (value.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(value.to_bytes(size, "big")).rstrip(b"=").decode()


def _derive_kid(modulus: int) -> str:
    payload = modulus.to_bytes((modulus.bit_length() + 7) // 8, "big")
    digest = hashlib.sha256(payload).digest()
    return base64.urlsafe_b64encode(digest[:8]).rstrip(b"=").decode()


def _build_redirect_url(base_url: str, params: Mapping[str, Any]) -> str:
    parsed = urlparse(base_url)
    existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for key, value in params.items():
        if value is None:
            continue
        existing[key] = value
    new_query = urlencode(existing)
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            new_query,
            parsed.fragment,
        )
    )


class LTIService:
    """Encapsule la logique de vérification et de lancement LTI."""

    def __init__(self, session: Session, *, settings: Settings | None = None):
        self.session = session
        self.settings = settings or get_settings()
        self._private_key_pem: str | None = None
        self._private_key_obj: rsa.RSAPrivateKey | None = None
        self._jwks_cache: dict[int, dict[str, Any]] = {}
        self._public_jwk: dict[str, Any] | None = None
        self._derived_kid: str | None = None

    def _ensure_private_key(self) -> tuple[str, rsa.RSAPrivateKey]:
        if self._private_key_obj is not None:
            assert self._private_key_pem is not None
            return self._private_key_pem, self._private_key_obj

        raw_key = self.settings.lti_tool_private_key
        if not raw_key:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Clé privée LTI non configurée",
            )

        normalized = raw_key.replace("\\n", "\n").encode("utf-8")
        try:
            private_key = serialization.load_pem_private_key(normalized, password=None)
        except ValueError as exc:  # pragma: no cover - configuration invalide
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Clé privée LTI invalide",
            ) from exc

        self._private_key_pem = normalized.decode("utf-8")
        self._private_key_obj = private_key
        return self._private_key_pem, self._private_key_obj

    @property
    def key_id(self) -> str:
        if self.settings.lti_tool_key_id:
            return self.settings.lti_tool_key_id
        if self._derived_kid is None:
            _, private_key = self._ensure_private_key()
            numbers = private_key.public_key().public_numbers()
            self._derived_kid = _derive_kid(numbers.n)
        return self._derived_kid

    def get_tool_jwks(self) -> dict[str, Any]:
        if self._public_jwk is None:
            _, private_key = self._ensure_private_key()
            numbers = private_key.public_key().public_numbers()
            self._public_jwk = {
                "kty": "RSA",
                "use": "sig",
                "alg": "RS256",
                "kid": self.key_id,
                "n": _int_to_b64(numbers.n),
                "e": _int_to_b64(numbers.e),
            }
        return {"keys": [self._public_jwk]}

    def initiate_login(self, params: Mapping[str, Any]) -> RedirectResponse:
        issuer = str(params.get("iss") or "").strip()
        client_id = str(params.get("client_id") or "").strip()
        deployment_ref = str(params.get("lti_deployment_id") or "").strip()
        target_link_uri = str(params.get("target_link_uri") or "").strip()

        if not issuer or not client_id or not target_link_uri or not deployment_ref:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Paramètres OIDC manquants",
            )

        registration = self._get_registration(issuer, client_id)
        deployment = self._get_deployment(registration, deployment_ref)

        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(16)
        resource_link_hint = params.get("lti_message_hint")
        resource_link = self._resolve_or_create_resource_link(
            deployment, str(resource_link_hint) if resource_link_hint else None
        )

        session_record = LTIUserSession(
            registration=registration,
            deployment=deployment,
            resource_link=resource_link,
            state=state,
            nonce=nonce,
            login_hint=str(params.get("login_hint") or None),
            target_link_uri=target_link_uri,
            expires_at=_now_utc() + datetime.timedelta(minutes=10),
        )
        self.session.add(session_record)
        self.session.commit()

        redirect_url = _build_redirect_url(
            registration.authorization_endpoint,
            {
                "scope": "openid",
                "response_type": "id_token",
                "response_mode": "form_post",
                "client_id": registration.client_id,
                "redirect_uri": target_link_uri,
                "login_hint": session_record.login_hint,
                "lti_message_hint": (
                    resource_link.resource_link_id if resource_link else None
                ),
                "state": state,
                "nonce": nonce,
            },
        )

        return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)

    def complete_launch(self, *, state: str, id_token: str) -> TokenResponse:
        session_record = self._get_session_from_state(state)
        payload = self._verify_id_token(session_record.registration, id_token)
        self._validate_common_claims(session_record, payload)

        message_type = payload.get(
            "https://purl.imsglobal.org/spec/lti/claim/message_type"
        )
        if message_type != "LtiResourceLinkRequest":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Message LTI inattendu"
            )

        resource_claim = payload.get(
            "https://purl.imsglobal.org/spec/lti/claim/resource_link", {}
        )
        resource_link_id = resource_claim.get("id")
        resource_link = self._resolve_or_create_resource_link(
            session_record.deployment,
            str(resource_link_id) if resource_link_id else None,
            existing=session_record.resource_link,
        )

        workflow = self._resolve_workflow(
            payload,
            resource_link,
            session_record.deployment,
        )
        if workflow is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Aucun workflow associé au lancement LTI",
            )

        resource_link.workflow = workflow

        user = self._provision_user(payload)
        session_record.user = user
        session_record.resource_link = resource_link
        session_record.platform_user_id = str(payload.get("sub") or None)
        context_claim = payload.get(
            "https://purl.imsglobal.org/spec/lti/claim/context", {}
        )
        session_record.platform_context_id = context_claim.get("id")
        session_record.launched_at = _now_utc()

        self.session.commit()

        token = create_access_token(user)
        return TokenResponse(access_token=token, user=user)

    def handle_deep_link(
        self,
        *,
        state: str,
        id_token: str,
        workflow_ids: Sequence[int] | None = None,
        workflow_slugs: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        session_record = self._get_session_from_state(state)
        payload = self._verify_id_token(session_record.registration, id_token)
        self._validate_common_claims(session_record, payload)

        message_type = payload.get(
            "https://purl.imsglobal.org/spec/lti/claim/message_type"
        )
        if message_type != "LtiDeepLinkingRequest":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Message LTI inattendu"
            )

        selected_workflows = self._collect_workflows(workflow_ids, workflow_slugs)
        if not selected_workflows:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Aucun workflow sélectionné",
            )

        return_url = payload.get(
            "https://purl.imsglobal.org/spec/lti-dl/claim/return_url"
        ) or session_record.registration.deep_link_return_url
        if not return_url:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Return URL LTI manquante"
            )

        launch_url = session_record.target_link_uri or self._default_launch_url()
        content_items: list[dict[str, Any]] = []
        for workflow in selected_workflows:
            content_items.append(
                {
                    "type": "ltiResourceLink",
                    "title": workflow.display_name,
                    "url": launch_url,
                    "custom": {
                        "workflow_id": workflow.id,
                        "workflow_slug": workflow.slug,
                    },
                }
            )

        now = _now_utc()
        expires_at = now + datetime.timedelta(minutes=5)
        iss = self.settings.lti_tool_client_id or session_record.registration.client_id
        audience = (
            self.settings.lti_tool_audience
            or payload.get("iss")
            or session_record.registration.issuer
        )

        response_payload = {
            "iss": iss,
            "aud": audience,
            "iat": int(now.timestamp()),
            "exp": int(expires_at.timestamp()),
            "nonce": secrets.token_urlsafe(8),
            "https://purl.imsglobal.org/spec/lti/claim/deployment_id": payload.get(
                "https://purl.imsglobal.org/spec/lti/claim/deployment_id"
            ),
            "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": content_items,
            "https://purl.imsglobal.org/spec/lti-dl/claim/msg": (
                "Workflows sélectionnés"
            ),
            "https://purl.imsglobal.org/spec/lti-dl/claim/version": "1.3.0",
        }

        private_key_pem, _ = self._ensure_private_key()
        deep_link_jwt = jwt.encode(
            response_payload,
            private_key_pem,
            algorithm="RS256",
            headers={"kid": self.key_id},
        )

        self.session.commit()

        return {
            "return_url": return_url,
            "deep_link_jwt": deep_link_jwt,
            "content_items": content_items,
        }

    def _default_launch_url(self) -> str:
        base = (self.settings.backend_public_base_url or "").rstrip("/")
        if not base:
            return "/api/lti/launch"
        return f"{base}/api/lti/launch"

    def _verify_id_token(
        self, registration: LTIRegistration, id_token: str
    ) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="id_token invalide"
            ) from exc

        jwks = self._get_registration_keys(registration)
        key = self._select_jwk(header.get("kid"), jwks)
        if not key:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Clé de signature LTI inconnue",
            )

        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
        audience = (
            self.settings.lti_tool_client_id or self.settings.lti_tool_audience
        )
        options = {"verify_at_hash": False}
        decode_kwargs: dict[str, Any] = {
            "issuer": registration.issuer,
            "algorithms": [key.get("alg") or "RS256"],
            "options": options,
        }
        if audience:
            decode_kwargs["audience"] = audience
        else:
            options["verify_aud"] = False

        try:
            return jwt.decode(id_token, public_key, **decode_kwargs)
        except jwt.PyJWTError as exc:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                detail="Impossible de vérifier l'id_token",
            ) from exc

    def _get_registration_keys(self, registration: LTIRegistration) -> dict[str, Any]:
        cached = self._jwks_cache.get(registration.id)
        if cached is not None:
            return cached

        try:
            response = httpx.get(registration.key_set_url, timeout=5.0)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                detail="Impossible de récupérer la clé LTI",
            ) from exc

        payload = response.json()
        if not isinstance(payload, dict) or "keys" not in payload:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                detail="Réponse JWKS invalide",
            )

        self._jwks_cache[registration.id] = payload
        return payload

    @staticmethod
    def _select_jwk(
        kid: str | None, jwks: Mapping[str, Any]
    ) -> Mapping[str, Any] | None:
        keys = jwks.get("keys", [])
        if kid:
            for candidate in keys:
                if candidate.get("kid") == kid:
                    return candidate
        return keys[0] if keys else None

    @staticmethod
    def _issuer_candidates(issuer: str) -> set[str]:
        candidates = {issuer}
        normalized = issuer.rstrip("/")
        if normalized:
            candidates.add(normalized)
            candidates.add(f"{normalized}/")
        return {candidate for candidate in candidates if candidate}

    def _get_registration(self, issuer: str, client_id: str) -> LTIRegistration:
        issuer_candidates = self._issuer_candidates(issuer)
        registration = self.session.scalar(
            select(LTIRegistration)
            .where(LTIRegistration.client_id == client_id)
            .where(LTIRegistration.issuer.in_(issuer_candidates))
        )
        if registration is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="Enregistrement LTI introuvable"
            )
        return registration

    def _get_deployment(
        self, registration: LTIRegistration, deployment_id: str
    ) -> LTIDeployment:
        deployment = self.session.scalar(
            select(LTIDeployment)
            .where(LTIDeployment.registration_id == registration.id)
            .where(LTIDeployment.deployment_id == deployment_id)
        )
        if deployment is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, detail="Déploiement LTI introuvable"
            )
        return deployment

    def _get_session_from_state(self, state: str) -> LTIUserSession:
        session_record = self.session.scalar(
            select(LTIUserSession).where(LTIUserSession.state == state)
        )
        if session_record is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Session LTI inconnue"
            )
        if _as_utc(session_record.expires_at) <= _now_utc():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Session LTI expirée"
            )
        return session_record

    def _resolve_or_create_resource_link(
        self,
        deployment: LTIDeployment,
        resource_link_id: str | None,
        existing: LTIResourceLink | None = None,
    ) -> LTIResourceLink | None:
        if resource_link_id:
            link = self.session.scalar(
                select(LTIResourceLink)
                .where(LTIResourceLink.deployment_id == deployment.id)
                .where(LTIResourceLink.resource_link_id == resource_link_id)
            )
            if link:
                return link
            link = LTIResourceLink(
                deployment=deployment,
                resource_link_id=resource_link_id,
                workflow_id=deployment.workflow_id,
            )
            self.session.add(link)
            self.session.flush()
            return link

        if existing is not None:
            return existing

        link = LTIResourceLink(
            deployment=deployment,
            resource_link_id=f"resource-{secrets.token_hex(8)}",
            workflow_id=deployment.workflow_id,
        )
        self.session.add(link)
        self.session.flush()
        return link

    def _resolve_workflow(
        self,
        payload: Mapping[str, Any],
        resource_link: LTIResourceLink | None,
        deployment: LTIDeployment,
    ) -> Workflow | None:
        custom_claim = payload.get(
            "https://purl.imsglobal.org/spec/lti/claim/custom", {}
        )
        workflow: Workflow | None = None

        workflow_id = None
        if isinstance(custom_claim, Mapping):
            workflow_id = custom_claim.get("workflow_id")
        if workflow_id is not None:
            try:
                workflow = self.session.get(Workflow, int(workflow_id))
            except (TypeError, ValueError):  # pragma: no cover - valeur invalide
                workflow = None

        if workflow is None and isinstance(custom_claim, Mapping):
            slug = custom_claim.get("workflow_slug")
            if slug:
                workflow = self.session.scalar(
                    select(Workflow).where(Workflow.slug == str(slug))
                )

        if workflow is None and resource_link is not None:
            workflow = resource_link.workflow

        if workflow is None:
            workflow = deployment.workflow

        return workflow

    def _provision_user(self, payload: Mapping[str, Any]) -> User:
        email = payload.get("email")
        normalized_email: str
        if isinstance(email, str) and email.strip():
            normalized_email = email.strip().lower()
        else:
            subject = str(payload.get("sub") or secrets.token_hex(8))
            normalized_email = f"{subject}@lti.local"

        user = self.session.scalar(select(User).where(User.email == normalized_email))
        if user:
            return user

        random_password = secrets.token_urlsafe(32)
        user = User(
            email=normalized_email,
            password_hash=hash_password(random_password),
            is_admin=False,
        )
        self.session.add(user)
        self.session.flush()
        return user

    def _collect_workflows(
        self,
        workflow_ids: Sequence[int] | None,
        workflow_slugs: Sequence[str] | None,
    ) -> list[Workflow]:
        collected: list[Workflow] = []
        seen: set[int] = set()

        if workflow_ids:
            rows = self.session.scalars(
                select(Workflow).where(Workflow.id.in_(list(workflow_ids)))
            ).all()
            by_id = {wf.id: wf for wf in rows}
            for identifier in workflow_ids:
                wf = by_id.get(identifier)
                if wf and wf.id not in seen:
                    collected.append(wf)
                    seen.add(wf.id)

        if workflow_slugs:
            rows = self.session.scalars(
                select(Workflow).where(Workflow.slug.in_(list(workflow_slugs)))
            ).all()
            by_slug = {wf.slug: wf for wf in rows}
            for slug in workflow_slugs:
                wf = by_slug.get(slug)
                if wf and wf.id not in seen:
                    collected.append(wf)
                    seen.add(wf.id)

        return collected

    def _validate_common_claims(
        self, session_record: LTIUserSession, payload: Mapping[str, Any]
    ) -> None:
        if payload.get("nonce") != session_record.nonce:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Nonce LTI invalide"
            )

        deployment_id = payload.get(
            "https://purl.imsglobal.org/spec/lti/claim/deployment_id"
        )
        if deployment_id != session_record.deployment.deployment_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Déploiement LTI invalide"
            )
