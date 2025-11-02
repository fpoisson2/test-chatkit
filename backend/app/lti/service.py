"""LTI 1.3 Service - Handles LTI authentication, Deep Link, and AGS"""

from __future__ import annotations

import datetime
import json
import secrets
import uuid
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    ChatThread,
    LTIDeployment,
    LTINonce,
    LTIPlatform,
    LTISession,
    User,
    Workflow,
)
from ..schemas import LTILaunchData
from ..security import create_access_token


class LTIService:
    """Service for handling LTI 1.3 operations"""

    # LTI 1.3 claim namespaces
    LTI_CLAIM_PREFIX = "https://purl.imsglobal.org/spec/lti/claim/"
    AGS_CLAIM_PREFIX = "https://purl.imsglobal.org/spec/lti-ags/claim/"
    DL_CLAIM_PREFIX = "https://purl.imsglobal.org/spec/lti-dl/claim/"

    # LTI message types
    MESSAGE_TYPE_RESOURCE_LINK = "LtiResourceLinkRequest"
    MESSAGE_TYPE_DEEP_LINK = "LtiDeepLinkingRequest"

    def __init__(self, session: Session, base_url: str):
        self.session = session
        self.base_url = base_url.rstrip("/")

    def get_platform(self, issuer: str, client_id: str) -> LTIPlatform | None:
        """Get LTI platform by issuer and client_id"""
        stmt = select(LTIPlatform).where(
            LTIPlatform.issuer == issuer,
            LTIPlatform.client_id == client_id,
            LTIPlatform.is_active == True,
        )
        return self.session.execute(stmt).scalar_one_or_none()

    def get_deployment(
        self, platform: LTIPlatform, deployment_id: str
    ) -> LTIDeployment | None:
        """Get deployment for a platform"""
        stmt = select(LTIDeployment).where(
            LTIDeployment.platform_id == platform.id,
            LTIDeployment.deployment_id == deployment_id,
        )
        return self.session.execute(stmt).scalar_one_or_none()

    def verify_and_decode_jwt(self, token: str, platform: LTIPlatform) -> dict[str, Any]:
        """Verify and decode LTI JWT token"""
        try:
            # Get the platform's public key
            public_key = self._get_platform_public_key(platform)

            # Decode and verify the JWT
            decoded = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                audience=platform.client_id,
                options={"verify_exp": True},
            )

            # Verify nonce (prevent replay attacks)
            nonce = decoded.get("nonce")
            if not nonce:
                raise HTTPException(status_code=400, detail="Missing nonce in JWT")

            if not self._verify_nonce(nonce):
                raise HTTPException(status_code=400, detail="Invalid or reused nonce")

            return decoded

        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="JWT token has expired")
        except jwt.InvalidTokenError as e:
            raise HTTPException(status_code=401, detail=f"Invalid JWT token: {str(e)}")

    def _get_platform_public_key(self, platform: LTIPlatform) -> str:
        """Get platform's public key, fetching from JWKS URL if needed"""
        if platform.public_key:
            return platform.public_key

        # Fetch from JWKS URL
        try:
            response = httpx.get(platform.key_set_url, timeout=10.0)
            response.raise_for_status()
            jwks = response.json()

            # For simplicity, use the first key
            # In production, you should match by 'kid' from JWT header
            if jwks.get("keys"):
                key_data = jwks["keys"][0]
                # Convert JWK to PEM (simplified - you may need python-jose or similar)
                # For now, we'll store the JWK as JSON string
                platform.public_key = json.dumps(key_data)
                self.session.commit()
                return platform.public_key

            raise HTTPException(
                status_code=500, detail="No keys found in platform JWKS"
            )

        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to fetch platform JWKS: {str(e)}"
            )

    def _verify_nonce(self, nonce: str) -> bool:
        """Verify nonce hasn't been used before"""
        # Check if nonce exists
        stmt = select(LTINonce).where(LTINonce.nonce == nonce)
        existing = self.session.execute(stmt).scalar_one_or_none()

        if existing:
            # Nonce already used
            return False

        # Store nonce
        new_nonce = LTINonce(nonce=nonce)
        self.session.add(new_nonce)
        self.session.commit()

        # Clean up old nonces (older than 1 hour)
        cutoff = datetime.datetime.now(datetime.UTC) - datetime.timedelta(hours=1)
        self.session.query(LTINonce).filter(LTINonce.created_at < cutoff).delete()
        self.session.commit()

        return True

    def parse_launch_data(self, jwt_payload: dict[str, Any]) -> LTILaunchData:
        """Parse LTI launch JWT payload into structured data"""
        lti_claim = lambda key: jwt_payload.get(f"{self.LTI_CLAIM_PREFIX}{key}")
        ags_claim = lambda key: jwt_payload.get(f"{self.AGS_CLAIM_PREFIX}{key}")
        dl_claim = lambda key: jwt_payload.get(f"{self.DL_CLAIM_PREFIX}{key}")

        # Extract message type
        message_type = lti_claim("message_type")
        if not message_type:
            raise HTTPException(status_code=400, detail="Missing message_type")

        # Extract user info
        user_id = jwt_payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=400, detail="Missing user ID (sub)")

        # Build launch data
        launch_data = LTILaunchData(
            message_type=message_type,
            lti_version=lti_claim("version") or "1.3.0",
            deployment_id=lti_claim("deployment_id") or "",
            target_link_uri=lti_claim("target_link_uri") or "",
            user_id=user_id,
            email=jwt_payload.get("email"),
            given_name=jwt_payload.get("given_name"),
            family_name=jwt_payload.get("family_name"),
            name=jwt_payload.get("name"),
            roles=lti_claim("roles") or [],
            context_id=lti_claim("context", {}).get("id"),
            context_label=lti_claim("context", {}).get("label"),
            context_title=lti_claim("context", {}).get("title"),
            context_type=lti_claim("context", {}).get("type", []),
            resource_link_id=lti_claim("resource_link", {}).get("id"),
            resource_link_title=lti_claim("resource_link", {}).get("title"),
            resource_link_description=lti_claim("resource_link", {}).get("description"),
            deep_linking_settings=dl_claim("deep_linking_settings"),
            ags_lineitem=ags_claim("lineitem"),
            ags_lineitems=ags_claim("lineitems"),
            ags_scope=ags_claim("scope") or [],
            custom=lti_claim("custom") or {},
            platform_id=jwt_payload.get("iss", ""),
            platform_name=lti_claim("tool_platform", {}).get("name"),
            platform_version=lti_claim("tool_platform", {}).get("version"),
        )

        return launch_data

    def get_or_create_lti_user(
        self, platform: LTIPlatform, launch_data: LTILaunchData
    ) -> User:
        """Get or create user from LTI launch data"""
        # Look for existing LTI user
        stmt = select(User).where(
            User.lti_user_id == launch_data.user_id,
            User.lti_platform_id == platform.id,
        )
        user = self.session.execute(stmt).scalar_one_or_none()

        if user:
            # Update user info if changed
            if launch_data.given_name:
                user.lti_given_name = launch_data.given_name
            if launch_data.family_name:
                user.lti_family_name = launch_data.family_name
            if launch_data.roles:
                user.lti_roles = {"roles": launch_data.roles}
            self.session.commit()
            return user

        # Create new LTI user
        # Generate a unique email if not provided
        email = launch_data.email
        if not email:
            email = f"lti_{platform.id}_{launch_data.user_id}@lti.local"

        # Ensure email is unique
        email_counter = 1
        original_email = email
        while True:
            stmt = select(User).where(User.email == email)
            existing = self.session.execute(stmt).scalar_one_or_none()
            if not existing:
                break
            email = f"{original_email.split('@')[0]}_{email_counter}@{original_email.split('@')[1]}"
            email_counter += 1

        user = User(
            email=email,
            password_hash="",  # No password for LTI users
            is_admin=False,
            is_lti_user=True,
            lti_user_id=launch_data.user_id,
            lti_platform_id=platform.id,
            lti_given_name=launch_data.given_name,
            lti_family_name=launch_data.family_name,
            lti_roles={"roles": launch_data.roles} if launch_data.roles else None,
        )
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)

        return user

    def get_or_create_lti_session(
        self,
        user: User,
        platform: LTIPlatform,
        deployment: LTIDeployment,
        launch_data: LTILaunchData,
        workflow: Workflow | None = None,
    ) -> LTISession:
        """Get or create an LTI session with thread"""
        # For resource link launches, try to find existing session
        # based on resource_link_id, user, and workflow
        if launch_data.resource_link_id and launch_data.message_type == self.MESSAGE_TYPE_RESOURCE_LINK:
            stmt = select(LTISession).where(
                LTISession.resource_link_id == launch_data.resource_link_id,
                LTISession.user_id == user.id,
                LTISession.workflow_id == (workflow.id if workflow else None),
            ).order_by(LTISession.created_at.desc())

            existing_session = self.session.execute(stmt).scalar_one_or_none()

            if existing_session:
                # Update the session with new launch data
                existing_session.ags_lineitem_url = launch_data.ags_lineitem
                existing_session.ags_scope = launch_data.ags_scope if launch_data.ags_scope else None
                existing_session.launch_data = launch_data.model_dump()
                existing_session.updated_at = datetime.datetime.now(datetime.UTC)
                self.session.commit()
                self.session.refresh(existing_session)
                return existing_session

        # Create new session
        session_id = str(uuid.uuid4())

        # Create or get ChatKit thread
        thread_id = self._create_chatkit_thread(user, workflow, launch_data)

        lti_session = LTISession(
            session_id=session_id,
            user_id=user.id,
            platform_id=platform.id,
            deployment_id=deployment.id,
            message_type=launch_data.message_type,
            resource_link_id=launch_data.resource_link_id,
            context_id=launch_data.context_id,
            context_label=launch_data.context_label,
            context_title=launch_data.context_title,
            deep_link_return_url=launch_data.deep_linking_settings.get("deep_link_return_url")
            if launch_data.deep_linking_settings
            else None,
            deep_link_data=launch_data.deep_linking_settings.get("data")
            if launch_data.deep_linking_settings
            else None,
            ags_lineitem_url=launch_data.ags_lineitem,
            ags_scope=launch_data.ags_scope if launch_data.ags_scope else None,
            workflow_id=workflow.id if workflow else None,
            thread_id=thread_id,
            launch_data=launch_data.model_dump(),
        )

        self.session.add(lti_session)
        self.session.commit()
        self.session.refresh(lti_session)

        return lti_session

    def _create_chatkit_thread(
        self, user: User, workflow: Workflow | None, launch_data: LTILaunchData
    ) -> str:
        """Create a ChatKit thread for the LTI session"""
        thread_id = str(uuid.uuid4())
        now = datetime.datetime.now(datetime.UTC)

        # Build thread metadata
        metadata = {
            "lti": True,
            "resource_link_id": launch_data.resource_link_id,
            "context_id": launch_data.context_id,
            "context_title": launch_data.context_title,
        }

        if workflow:
            metadata["workflow_id"] = workflow.id
            metadata["workflow_slug"] = workflow.slug

        # Create thread payload
        payload = {
            "id": thread_id,
            "metadata": metadata,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }

        # Create ChatThread
        thread = ChatThread(
            id=thread_id,
            owner_id=str(user.id),
            created_at=now,
            updated_at=now,
            payload=payload,
        )

        self.session.add(thread)
        self.session.commit()

        return thread_id

    # Backwards compatibility
    def create_lti_session(
        self,
        user: User,
        platform: LTIPlatform,
        deployment: LTIDeployment,
        launch_data: LTILaunchData,
        workflow: Workflow | None = None,
    ) -> LTISession:
        """Create an LTI session (deprecated, use get_or_create_lti_session)"""
        return self.get_or_create_lti_session(user, platform, deployment, launch_data, workflow)

    def generate_oidc_auth_response(
        self, platform: LTIPlatform, login_hint: str, target_link_uri: str
    ) -> str:
        """Generate OIDC authentication request URL"""
        # Generate state and nonce
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)

        # Build auth parameters
        params = {
            "response_type": "id_token",
            "response_mode": "form_post",
            "scope": "openid",
            "client_id": platform.client_id,
            "redirect_uri": f"{self.base_url}/api/lti/launch",
            "login_hint": login_hint,
            "state": state,
            "nonce": nonce,
            "prompt": "none",
        }

        if target_link_uri:
            params["lti_message_hint"] = target_link_uri

        # Build URL
        auth_url = f"{platform.auth_login_url}?{urlencode(params)}"
        return auth_url

    def create_deep_link_response(
        self, lti_session: LTISession, workflow: Workflow
    ) -> dict[str, Any]:
        """Create a deep link response JWT"""
        if not lti_session.deep_link_return_url:
            raise HTTPException(
                status_code=400, detail="No deep link return URL in session"
            )

        # Get platform
        stmt = select(LTIPlatform).where(LTIPlatform.id == lti_session.platform_id)
        platform = self.session.execute(stmt).scalar_one_or_none()
        if not platform:
            raise HTTPException(status_code=404, detail="Platform not found")

        # Generate our private key if not exists
        if not platform.private_key:
            platform.private_key = self._generate_private_key()
            self.session.commit()

        # Build content item
        content_item = {
            "type": "ltiResourceLink",
            "title": workflow.lti_title or workflow.display_name,
            "url": f"{self.base_url}/api/lti/launch?workflow_id={workflow.id}",
        }

        if workflow.lti_description:
            content_item["text"] = workflow.lti_description

        # Build JWT payload
        now = datetime.datetime.now(datetime.UTC)
        payload = {
            "iss": platform.client_id,
            "aud": platform.issuer,
            "exp": int((now + datetime.timedelta(minutes=5)).timestamp()),
            "iat": int(now.timestamp()),
            "nonce": secrets.token_urlsafe(16),
            f"{self.LTI_CLAIM_PREFIX}message_type": "LtiDeepLinkingResponse",
            f"{self.LTI_CLAIM_PREFIX}version": "1.3.0",
            f"{self.LTI_CLAIM_PREFIX}deployment_id": lti_session.launch_data.get(
                f"{self.LTI_CLAIM_PREFIX}deployment_id"
            ),
            f"{self.DL_CLAIM_PREFIX}content_items": [content_item],
        }

        if lti_session.deep_link_data:
            payload[f"{self.DL_CLAIM_PREFIX}data"] = lti_session.deep_link_data

        # Sign JWT with our private key
        private_key = serialization.load_pem_private_key(
            platform.private_key.encode(), password=None
        )
        token = jwt.encode(payload, private_key, algorithm="RS256")

        return {
            "return_url": lti_session.deep_link_return_url,
            "jwt": token,
        }

    def submit_grade(
        self, lti_session: LTISession, score: float, comment: str | None = None
    ) -> dict[str, Any]:
        """Submit grade to LMS via AGS"""
        if not lti_session.ags_lineitem_url:
            raise HTTPException(status_code=400, detail="No AGS lineitem URL in session")

        # Check if we have the required scope
        if not lti_session.ags_scope or "https://purl.imsglobal.org/spec/lti-ags/scope/score" not in lti_session.ags_scope:
            raise HTTPException(
                status_code=403, detail="Missing AGS score submission scope"
            )

        # Get platform
        stmt = select(LTIPlatform).where(LTIPlatform.id == lti_session.platform_id)
        platform = self.session.execute(stmt).scalar_one_or_none()
        if not platform:
            raise HTTPException(status_code=404, detail="Platform not found")

        # Get access token from platform
        access_token = self._get_platform_access_token(platform, lti_session.ags_scope)

        # Build score payload
        score_payload = {
            "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
            "scoreGiven": score,
            "scoreMaximum": lti_session.score_maximum,
            "activityProgress": "Completed",
            "gradingProgress": "FullyGraded",
            "userId": lti_session.launch_data.get("sub"),
        }

        if comment:
            score_payload["comment"] = comment

        # Submit score
        try:
            response = httpx.post(
                f"{lti_session.ags_lineitem_url}/scores",
                json=score_payload,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/vnd.ims.lis.v1.score+json",
                },
                timeout=10.0,
            )
            response.raise_for_status()

            # Update session
            lti_session.score = score
            lti_session.score_submitted = True
            lti_session.score_submitted_at = datetime.datetime.now(datetime.UTC)
            self.session.commit()

            return {"success": True, "score": score}

        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to submit score: {str(e)}"
            )

    def _get_platform_access_token(
        self, platform: LTIPlatform, scopes: list[str]
    ) -> str:
        """Get OAuth access token from platform"""
        # Build client assertion JWT
        now = datetime.datetime.now(datetime.UTC)
        assertion_payload = {
            "iss": platform.client_id,
            "sub": platform.client_id,
            "aud": platform.auth_token_url,
            "exp": int((now + datetime.timedelta(minutes=5)).timestamp()),
            "iat": int(now.timestamp()),
            "jti": str(uuid.uuid4()),
        }

        # Sign with our private key
        if not platform.private_key:
            platform.private_key = self._generate_private_key()
            self.session.commit()

        private_key = serialization.load_pem_private_key(
            platform.private_key.encode(), password=None
        )
        client_assertion = jwt.encode(
            assertion_payload, private_key, algorithm="RS256"
        )

        # Request access token
        try:
            response = httpx.post(
                platform.auth_token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                    "client_assertion": client_assertion,
                    "scope": " ".join(scopes),
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=10.0,
            )
            response.raise_for_status()

            token_data = response.json()
            return token_data["access_token"]

        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to get access token: {str(e)}"
            )

    def _generate_private_key(self) -> str:
        """Generate RSA private key"""
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        return pem.decode()

    def get_public_jwks(self, platform: LTIPlatform) -> dict[str, Any]:
        """Get our public JWKS for a platform"""
        if not platform.private_key:
            platform.private_key = self._generate_private_key()
            self.session.commit()

        # Load private key
        private_key = serialization.load_pem_private_key(
            platform.private_key.encode(), password=None
        )

        # Get public key
        public_key = private_key.public_key()
        public_numbers = public_key.public_numbers()

        # Convert to JWK format
        import base64

        def int_to_base64(n: int) -> str:
            """Convert integer to base64url"""
            byte_length = (n.bit_length() + 7) // 8
            n_bytes = n.to_bytes(byte_length, byteorder="big")
            return base64.urlsafe_b64encode(n_bytes).rstrip(b"=").decode()

        jwk = {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": str(platform.id),
            "n": int_to_base64(public_numbers.n),
            "e": int_to_base64(public_numbers.e),
        }

        return {"keys": [jwk]}
