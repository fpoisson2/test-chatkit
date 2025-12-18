"""Routes FastAPI dédiées à l'intégration LTI 1.3."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user
from ..lti.service import LTIService
from ..models import User
from ..rate_limit import limiter, get_rate_limit

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
async def get_jwks(session: Session = Depends(get_session)) -> dict[str, Any]:
    """Public endpoint for JWKS - must be accessible without authentication.

    This endpoint exposes the tool's public key for JWT signature verification by LMS platforms.
    The session dependency is required to instantiate LTIService, but the JWKS generation
    itself does not use the database.
    """
    service = LTIService(session=session)
    return service.get_tool_jwks()


@router.post("/api/lti/login")
@limiter.limit(get_rate_limit("lti_login"))
async def lti_login(
    request: Request, service: LTIService = Depends(_get_service)
):
    params = await _extract_request_data(request)
    return service.initiate_login(params)


@router.post("/api/lti/launch")
@limiter.limit(get_rate_limit("lti_launch"))
async def lti_launch(
    request: Request, service: LTIService = Depends(_get_service)
):
    import jwt
    import logging
    from urllib.parse import urlencode
    from fastapi.responses import RedirectResponse

    logger = logging.getLogger(__name__)

    payload = await _extract_request_data(request)
    state = payload.get("state")
    id_token = payload.get("id_token")

    if not isinstance(state, str) or not isinstance(id_token, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Les champs state et id_token sont requis",
        )

    # Decode id_token without verification to check message type
    # Full verification will be done by the service methods
    message_type = None
    try:
        unverified_payload = jwt.decode(
            id_token,
            options={
                "verify_signature": False,
                "verify_aud": False,
                "verify_iat": False,
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iss": False,
                "verify_at_hash": False
            }
        )
        message_type = unverified_payload.get(
            "https://purl.imsglobal.org/spec/lti/claim/message_type"
        )
        logger.info(
            "LTI launch received with message_type: %r",
            message_type
        )
    except Exception as e:
        # If we can't decode, fall back to normal launch
        logger.warning(
            "Could not decode id_token to check message type: %s. "
            "Falling back to normal resource launch.",
            str(e)
        )

    # Route to Deep Linking if that's the message type
    if message_type == "LtiDeepLinkingRequest":
        logger.info("Routing to deep linking selection page")
        # Serve the deep linking page directly instead of redirecting
        # Moodle expects a direct HTML response, not a redirect
        return await lti_deep_link_page(state=state, id_token=id_token)

    # Otherwise, proceed with normal resource link launch
    logger.info("Processing as normal resource link launch")
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
async def list_lti_registrations(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """Liste toutes les registrations LTI disponibles.

    Requires authentication to prevent information disclosure.
    """
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


@router.get("/api/lti/deep-link/workflows")
async def list_deep_link_workflows(
    state: str,
    session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    """Liste les workflows disponibles pour LTI Deep Linking.

    Validates the LTI session via the state parameter instead of requiring
    user authentication. This endpoint is used during deep linking before
    the user is fully authenticated.
    """
    from ..models import Workflow, LTIRegistration, LTIOIDCSession, workflow_lti_registrations
    from sqlalchemy import select
    import logging

    logger = logging.getLogger(__name__)

    # Validate the state by looking up the OIDC session
    oidc_session = session.scalar(
        select(LTIOIDCSession).where(LTIOIDCSession.state == state)
    )

    if not oidc_session:
        logger.warning("Deep link workflows: Invalid or expired state")
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Session LTI invalide ou expirée",
        )

    # Get the issuer from the registration
    issuer = oidc_session.registration.issuer if oidc_session.registration else None

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
        # Fallback to lti_enabled flag
        query = query.where(Workflow.lti_enabled == True)

    workflows = session.scalars(query).all()

    logger.info("Deep link workflows: Found %d workflows for issuer %s", len(workflows), issuer)

    return [
        {
            "id": w.id,
            "slug": w.slug,
            "display_name": w.display_name,
            "description": w.description,
        }
        for w in workflows
    ]


@router.get("/api/lti/workflows")
async def list_lti_workflows(
    issuer: str | None = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """Liste tous les workflows disponibles pour LTI Deep Linking.

    Requires authentication to prevent information disclosure.

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


@router.get("/api/lti/current-workflow")
async def get_current_lti_workflow(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any] | None:
    """Get the workflow associated with the current user's LTI session.

    DEPRECATED: This endpoint is no longer used. The workflow is now passed
    directly in the LTI launch URL and stored in localStorage on the frontend.
    This endpoint remains for backward compatibility only.

    Requires authentication - returns workflow info only for LTI users.
    """
    from ..models import LTIUserSession
    from sqlalchemy import select, desc

    if not current_user.is_lti:
        return None

    # Find the most recent LTI session for this user
    lti_session = session.scalar(
        select(LTIUserSession)
        .where(LTIUserSession.user_id == current_user.id)
        .order_by(desc(LTIUserSession.launched_at))
        .limit(1)
    )

    if not lti_session or not lti_session.resource_link:
        return None

    workflow = lti_session.resource_link.workflow
    if not workflow or workflow.active_version_id is None:
        return None

    return {
        "id": workflow.id,
        "slug": workflow.slug,
        "display_name": workflow.display_name,
        "description": workflow.description,
        "lti_enabled": workflow.lti_enabled,
        "lti_show_sidebar": workflow.lti_show_sidebar,
        "lti_show_header": workflow.lti_show_header,
        "lti_enable_history": workflow.lti_enable_history,
    }


@router.get("/api/lti/deep-link", response_class=HTMLResponse)
async def lti_deep_link_page(state: str | None = None, id_token: str | None = None):
    """Serve the deep linking workflow selection page."""
    import html
    import logging

    logger = logging.getLogger(__name__)
    logger.info("GET /api/lti/deep-link called - state present: %s, id_token present: %s",
                bool(state), bool(id_token))

    state_escaped = html.escape(state or "")
    id_token_escaped = html.escape(id_token or "")

    html_content = f"""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sélection de workflow LTI</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            margin: 0;
            padding: 2rem;
            background: #f5f5f5;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }}
        h1 {{
            margin-top: 0;
            color: #333;
        }}
        .workflow-list {{
            margin: 2rem 0;
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }}
        .workflow-item {{
            display: flex;
            gap: 1rem;
            padding: 1rem;
            border: 2px solid #e0e0e0;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
        }}
        .workflow-item:hover {{
            border-color: #007bff;
            background: #f8f9fa;
        }}
        .workflow-item input[type="checkbox"] {{
            flex-shrink: 0;
            width: 20px;
            height: 20px;
            cursor: pointer;
        }}
        .workflow-info {{
            flex: 1;
        }}
        .workflow-info h3 {{
            margin: 0 0 0.5rem 0;
            color: #333;
            font-size: 1.1rem;
        }}
        .workflow-info p {{
            margin: 0;
            color: #666;
            font-size: 0.9rem;
        }}
        .error-message {{
            padding: 1rem;
            background: #fee;
            border: 1px solid #fcc;
            border-radius: 4px;
            color: #c00;
            margin: 1rem 0;
        }}
        .loading {{
            text-align: center;
            padding: 2rem;
            color: #666;
        }}
        .actions {{
            margin-top: 2rem;
            display: flex;
            justify-content: flex-end;
        }}
        .actions button {{
            padding: 0.75rem 2rem;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 1rem;
            cursor: pointer;
            transition: background 0.2s;
        }}
        .actions button:hover:not(:disabled) {{
            background: #0056b3;
        }}
        .actions button:disabled {{
            background: #ccc;
            cursor: not-allowed;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Sélection de workflow LTI</h1>
        <div id="content">
            <div class="loading">Chargement des workflows disponibles...</div>
        </div>
    </div>

    <script>
        const state = "{state_escaped}";
        const idToken = "{id_token_escaped}";
        let selectedWorkflowIds = [];

        async function loadWorkflows() {{
            try {{
                if (!state) {{
                    throw new Error('Paramètre state manquant');
                }}
                const response = await fetch('/api/lti/deep-link/workflows?state=' + encodeURIComponent(state));
                if (!response.ok) {{
                    const data = await response.json().catch(() => ({{}}));
                    throw new Error(data.detail || 'Impossible de charger les workflows');
                }}
                const workflows = await response.json();
                renderWorkflows(workflows);
            }} catch (err) {{
                document.getElementById('content').innerHTML =
                    '<div class="error-message">Erreur: ' + err.message + '</div>';
            }}
        }}

        function renderWorkflows(workflows) {{
            if (workflows.length === 0) {{
                document.getElementById('content').innerHTML = `
                    <p>Aucun workflow n'est activé pour LTI.</p>
                    <p>Veuillez activer l'option LTI sur au moins un workflow dans les paramètres.</p>
                `;
                return;
            }}

            let html = '<form id="workflowForm"><div class="workflow-list">';
            workflows.forEach(w => {{
                html += `
                    <label class="workflow-item">
                        <input type="checkbox" name="workflow" value="${{w.id}}"
                               onchange="toggleWorkflow(${{w.id}})">
                        <div class="workflow-info">
                            <h3>${{w.display_name}}</h3>
                            ${{w.description ? '<p>' + w.description + '</p>' : ''}}
                        </div>
                    </label>
                `;
            }});
            html += '</div>';
            html += '<div class="actions">';
            html += '<button type="submit" id="submitBtn" disabled>Ajouter au cours</button>';
            html += '</div></form>';

            document.getElementById('content').innerHTML = html;
            document.getElementById('workflowForm').addEventListener('submit', handleSubmit);
        }}

        function toggleWorkflow(workflowId) {{
            const index = selectedWorkflowIds.indexOf(workflowId);
            if (index > -1) {{
                selectedWorkflowIds.splice(index, 1);
            }} else {{
                selectedWorkflowIds.push(workflowId);
            }}
            document.getElementById('submitBtn').disabled = selectedWorkflowIds.length === 0;
        }}

        async function handleSubmit(e) {{
            e.preventDefault();

            if (selectedWorkflowIds.length === 0) {{
                alert('Veuillez sélectionner au moins un workflow');
                return;
            }}

            if (!state || !idToken) {{
                alert('Paramètres LTI manquants');
                return;
            }}

            const submitBtn = document.getElementById('submitBtn');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Envoi en cours...';

            try {{
                const response = await fetch('/api/lti/deep-link', {{
                    method: 'POST',
                    headers: {{
                        'Content-Type': 'application/json',
                    }},
                    body: JSON.stringify({{
                        state: state,
                        id_token: idToken,
                        workflow_ids: selectedWorkflowIds,
                    }}),
                }});

                if (!response.ok) {{
                    const data = await response.json();
                    throw new Error(data.detail || 'Erreur lors de la soumission');
                }}

                const result = await response.json();

                // Créer un formulaire invisible pour POST le JWT vers Moodle
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = result.return_url;

                const jwtInput = document.createElement('input');
                jwtInput.type = 'hidden';
                jwtInput.name = 'JWT';
                jwtInput.value = result.deep_link_jwt || result.jwt;

                form.appendChild(jwtInput);
                document.body.appendChild(form);
                form.submit();
            }} catch (err) {{
                document.getElementById('content').innerHTML =
                    '<div class="error-message">' + err.message + '</div>';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Ajouter au cours';
            }}
        }}

        // Load workflows on page load
        loadWorkflows();
    </script>
</body>
</html>
    """

    return html_content


@router.post("/api/lti/deep-link")
async def lti_deep_link(
    request: Request, service: LTIService = Depends(_get_service)
):
    import logging
    from fastapi.responses import RedirectResponse
    from urllib.parse import urlencode

    logger = logging.getLogger(__name__)
    logger.info("Deep link endpoint called")

    payload = await _extract_request_data(request)
    state = payload.get("state")
    id_token = payload.get("id_token")

    logger.info("Deep link parameters: state=%s, id_token present=%s",
                bool(state), bool(id_token))
    if not isinstance(state, str) or not isinstance(id_token, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Les champs state et id_token sont requis",
        )

    workflow_ids = _as_int_sequence(payload.get("workflow_ids"))
    workflow_slugs = _as_str_sequence(payload.get("workflow_slugs"))

    # Si aucun workflow n'est sélectionné, servir la page de sélection directement
    if not workflow_ids and not workflow_slugs:
        # Serve the selection page directly instead of redirecting
        # Moodle expects a direct HTML response, not a redirect
        logger.info("No workflows selected, serving selection page directly")
        html_content = await lti_deep_link_page(state=state, id_token=id_token)
        return HTMLResponse(content=html_content)

    # Sinon, traiter la sélection
    return service.handle_deep_link(
        state=state,
        id_token=id_token,
        workflow_ids=workflow_ids,
        workflow_slugs=workflow_slugs,
    )
