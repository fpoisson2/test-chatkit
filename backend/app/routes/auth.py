from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..models import User
from ..rate_limit import get_rate_limit, limiter
from ..schemas import LoginRequest, TokenResponse
from ..security import create_access_token, verify_password

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/api/auth/login", response_model=TokenResponse)
@limiter.limit(get_rate_limit("auth_login"))
async def login(
    login_request: LoginRequest,
    request: Request,
    session: Session = Depends(get_session),
):
    client_ip = request.client.host if request.client else "unknown"
    logger.info(f"Login attempt for email={login_request.email} from IP={client_ip}")

    email = login_request.email.lower()
    user = session.scalar(select(User).where(User.email == email))

    if not user:
        logger.warning(f"Login failed: user not found for email={email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides"
        )

    if not verify_password(login_request.password, user.password_hash):
        logger.warning(f"Login failed: invalid password for email={email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides"
        )

    logger.info(f"Login successful for user_id={user.id} email={email}")
    token = create_access_token(user)
    return TokenResponse(access_token=token, user=user)
