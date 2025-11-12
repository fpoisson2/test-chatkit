"""Routes FastAPI dédiées à l'intégration LTI 1.3."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..lti.service import LTIService
from ..schemas import TokenResponse

router = APIRouter()


def _get_service(session: Session = Depends(get_session)) -> LTIService:
    return LTIService(session=session)


async def _extract_request_data(request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Corps JSON invalide"
            )
        return payload

    form = await request.form()
    data: dict[str, Any] = {}
    for key in form.keys():
        values = form.getlist(key)
        if len(values) == 1:
            data[key] = values[0]
        else:
            data[key] = values
    return data


@router.get("/.well-known/jwks.json")
async def get_jwks() -> dict[str, Any]:
    """Public endpoint for JWKS - must be accessible without authentication.

    This endpoint exposes the tool's public key for JWT signature verification by LMS platforms.
    It must be publicly accessible without authentication to allow platforms like Moodle
    to verify Deep Linking response JWTs.
    """
    from ..config import get_settings
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import base64
    import hashlib

    def _int_to_b64(value: int) -> str:
        """Convert an integer to base64url encoding."""
        value_hex = format(value, 'x')
        if len(value_hex) % 2:
            value_hex = '0' + value_hex
        value_bytes = bytes.fromhex(value_hex)
        return base64.urlsafe_b64encode(value_bytes).rstrip(b'=').decode('ascii')

    def _derive_kid(n: int) -> str:
        """Derive a key ID from the RSA modulus."""
        n_bytes = n.to_bytes((n.bit_length() + 7) // 8, byteorder='big')
        return hashlib.sha256(n_bytes).hexdigest()[:16]

    settings = get_settings()
    raw_key = settings.lti_tool_private_key

    if not raw_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Clé privée LTI non configurée"
        )

    # Load the private key
    normalized = raw_key.replace("\\n", "\n").encode("utf-8")
    try:
        private_key = serialization.load_pem_private_key(normalized, password=None)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Clé privée LTI invalide"
        ) from exc

    # Generate JWK from public key
    if not isinstance(private_key, rsa.RSAPrivateKey):
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Type de clé non supporté (RSA requis)"
        )

    numbers = private_key.public_key().public_numbers()

    # Use configured key_id or derive one from the public key
    key_id = settings.lti_tool_key_id or _derive_kid(numbers.n)

    public_jwk = {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": key_id,
        "n": _int_to_b64(numbers.n),
        "e": _int_to_b64(numbers.e),
    }

    return {"keys": [public_jwk]}


@router.post("/api/lti/login")
async def lti_login(
    request: Request, service: LTIService = Depends(_get_service)
):
    params = await _extract_request_data(request)
    return service.initiate_login(params)


@router.post("/api/lti/launch", response_model=TokenResponse)
async def lti_launch(
    request: Request, service: LTIService = Depends(_get_service)
) -> TokenResponse:
    payload = await _extract_request_data(request)
    state = payload.get("state")
    id_token = payload.get("id_token")

    if not isinstance(state, str) or not isinstance(id_token, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Les champs state et id_token sont requis",
        )

    return service.complete_launch(state=state, id_token=id_token)


def _as_int_sequence(value: Any) -> list[int]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        values = value
    else:
        values = [value]
    result: list[int] = []
    for item in values:
        try:
            result.append(int(item))
        except (TypeError, ValueError):
            continue
    return result


def _as_str_sequence(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        values = value
    else:
        values = [value]
    return [str(item) for item in values if isinstance(item, str) and item]


@router.get("/api/lti/registrations")
async def list_lti_registrations(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    """Liste toutes les registrations LTI disponibles."""
    from ..models import LTIRegistration
    from sqlalchemy import select

    registrations = session.scalars(select(LTIRegistration)).all()

    return [
        {
            "id": reg.id,
            "issuer": reg.issuer,
            "client_id": reg.client_id,
        }
        for reg in registrations
    ]


@router.get("/api/lti/workflows")
async def list_lti_workflows(
    issuer: str | None = None,
    session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    """Liste tous les workflows disponibles pour LTI Deep Linking.

    Args:
        issuer: Optionnel. Si fourni, ne retourne que les workflows autorisés pour cet issuer.
    """
    from ..models import Workflow, LTIRegistration, workflow_lti_registrations
    from sqlalchemy import select

    query = (
        select(Workflow)
        .where(Workflow.active_version_id.is_not(None))
    )

    if issuer:
        # Filter workflows authorized for this specific issuer
        query = query.join(
            workflow_lti_registrations,
            Workflow.id == workflow_lti_registrations.c.workflow_id
        ).join(
            LTIRegistration,
            workflow_lti_registrations.c.lti_registration_id == LTIRegistration.id
        ).where(LTIRegistration.issuer == issuer)
    else:
        # No issuer specified, fall back to lti_enabled flag
        query = query.where(Workflow.lti_enabled == True)

    workflows = session.scalars(query).all()

    return [
        {
            "id": w.id,
            "slug": w.slug,
            "display_name": w.display_name,
            "description": w.description,
        }
        for w in workflows
    ]


@router.post("/api/lti/deep-link")
async def lti_deep_link(
    request: Request, service: LTIService = Depends(_get_service)
) -> dict[str, Any]:
    from fastapi.responses import RedirectResponse
    from urllib.parse import urlencode

    payload = await _extract_request_data(request)
    state = payload.get("state")
    id_token = payload.get("id_token")
    if not isinstance(state, str) or not isinstance(id_token, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Les champs state et id_token sont requis",
        )

    workflow_ids = _as_int_sequence(payload.get("workflow_ids"))
    workflow_slugs = _as_str_sequence(payload.get("workflow_slugs"))

    # Si aucun workflow n'est sélectionné, rediriger vers la page de sélection
    if not workflow_ids and not workflow_slugs:
        params = urlencode({"state": state, "id_token": id_token})
        return RedirectResponse(
            url=f"/lti/deep-link?{params}",
            status_code=status.HTTP_302_FOUND
        )

    # Sinon, traiter la sélection
    return service.handle_deep_link(
        state=state,
        id_token=id_token,
        workflow_ids=workflow_ids,
        workflow_slugs=workflow_slugs,
    )
