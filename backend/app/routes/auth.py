from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..models import User
from ..schemas import LoginRequest, TokenResponse
from ..security import create_access_token, verify_password

router = APIRouter()


@router.post("/api/auth/login", response_model=TokenResponse)
async def login(request: LoginRequest, session: Session = Depends(get_session)):
    email = request.email.lower()
    user = session.scalar(select(User).where(User.email == email))
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides"
        )

    token = create_access_token(user)
    return TokenResponse(access_token=token, user=user)
