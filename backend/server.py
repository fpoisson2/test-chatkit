import datetime
import hashlib
import logging
import os
import secrets
import uuid
from collections.abc import Iterator
import time

import httpx
import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr
from sqlalchemy import Boolean, DateTime, Integer, String, create_engine, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.exc import OperationalError


class SessionRequest(BaseModel):
    user: str | None = None


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    is_admin: bool = False


class UserUpdate(BaseModel):
    password: str | None = None
    is_admin: bool | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    is_admin: bool
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


TokenResponse.model_rebuild()


load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chatkit.server")

app = FastAPI()

_openai_api_key = os.environ.get("OPENAI_API_KEY")
if not _openai_api_key:
    raise RuntimeError("OPENAI_API_KEY environment variable is required")

_workflow_id = os.environ.get("CHATKIT_WORKFLOW_ID")
if not _workflow_id:
    raise RuntimeError("CHATKIT_WORKFLOW_ID environment variable is required")

_chatkit_api_base = os.environ.get("CHATKIT_API_BASE", "https://api.openai.com")

_database_url = os.environ.get("DATABASE_URL")
if not _database_url:
    raise RuntimeError("DATABASE_URL environment variable is required for PostgreSQL access")

_auth_secret_key = os.environ.get("AUTH_SECRET_KEY")
if not _auth_secret_key:
    raise RuntimeError("AUTH_SECRET_KEY environment variable is required for authentication tokens")

_access_token_expire_minutes = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "120"))
_admin_email = os.environ.get("ADMIN_EMAIL")
_admin_password = os.environ.get("ADMIN_PASSWORD")


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


_engine = create_engine(_database_url, future=True)
_SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
_http_bearer = HTTPBearer(auto_error=False)


def _hash_password(password: str, salt: str | None = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    salt_bytes = salt.encode("utf-8")
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, 390000)
    return f"{salt}${hashed.hex()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, hashed = stored_hash.split("$", 1)
    except ValueError:
        return False
    expected = _hash_password(password, salt)
    return secrets.compare_digest(expected, stored_hash)


def _create_access_token(user: User) -> str:
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=_access_token_expire_minutes)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "is_admin": user.is_admin,
        "exp": expire,
    }
    return jwt.encode(payload, _auth_secret_key, algorithm="HS256")


def _decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, _auth_secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide") from exc


def get_session() -> Iterator[Session]:
    with _SessionLocal() as session:
        yield session


def _wait_for_database() -> None:
    retries = int(os.environ.get("DATABASE_CONNECT_RETRIES", "10"))
    delay = float(os.environ.get("DATABASE_CONNECT_DELAY", "1.0"))
    for attempt in range(1, retries + 1):
        try:
            with _engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return
        except OperationalError as exc:
            logger.warning(
                "Database connection failed (attempt %s/%s): %s",
                attempt,
                retries,
                exc,
            )
            time.sleep(delay)
    raise RuntimeError("Database connection failed after retries")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_http_bearer),
    session: Session = Depends(get_session),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentification requise")

    payload = _decode_access_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide")

    try:
        user_pk = int(user_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide") from exc

    user = session.get(User, user_pk)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable")
    return user


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_http_bearer),
    session: Session = Depends(get_session),
) -> User | None:
    if credentials is None:
        return None
    try:
        return await get_current_user(credentials, session)
    except HTTPException:
        return None


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès administrateur requis")
    return current_user


def _user_to_response(user: User) -> UserResponse:
    return UserResponse.model_validate(user)


async def _create_chatkit_session(user_id: str) -> dict:
    async with httpx.AsyncClient(base_url=_chatkit_api_base, timeout=30) as client:
        response = await client.post(
            "/v1/chatkit/sessions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {_openai_api_key}",
                "OpenAI-Beta": "chatkit_beta=v1",
            },
            json={
                "workflow": {"id": _workflow_id},
                "user": user_id,
            },
        )
    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = {"error": response.text}
        logger.error(
            "ChatKit session creation failed (%s): %s",
            response.status_code,
            detail,
        )
        raise HTTPException(
            status_code=response.status_code,
            detail={
                "error": f"ChatKit session creation failed: {response.status_code}",
                "details": detail,
            },
        )
    return response.json()


@app.on_event("startup")
def _on_startup() -> None:
    _wait_for_database()
    Base.metadata.create_all(bind=_engine)
    if _admin_email and _admin_password:
        normalized_email = _admin_email.lower()
        with _SessionLocal() as session:
            existing = session.scalar(select(User).where(User.email == normalized_email))
            if not existing:
                logger.info("Creating initial admin user %s", normalized_email)
                user = User(
                    email=normalized_email,
                    password_hash=_hash_password(_admin_password),
                    is_admin=True,
                )
                session.add(user)
                session.commit()


@app.post("/api/chatkit/session")
async def create_chatkit_session(
    req: SessionRequest,
    current_user: User | None = Depends(get_optional_user),
):
    if current_user:
        user_id = f"user:{current_user.id}"
    else:
        user_id = req.user or str(uuid.uuid4())
    session_payload = await _create_chatkit_session(user_id)
    client_secret = session_payload.get("client_secret")
    if not client_secret:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "ChatKit response missing client_secret",
                "details": session_payload,
            },
        )
    return {
        "client_secret": client_secret,
        "expires_after": session_payload.get("expires_after"),
    }


@app.post("/api/auth/login", response_model=TokenResponse)
async def login(request: LoginRequest, session: Session = Depends(get_session)):
    email = request.email.lower()
    user = session.scalar(select(User).where(User.email == email))
    if not user or not _verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides")

    token = _create_access_token(user)
    return TokenResponse(access_token=token, user=_user_to_response(user))


@app.get("/api/users/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return _user_to_response(current_user)


@app.get("/api/admin/users", response_model=list[UserResponse])
async def list_users(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    users = session.scalars(select(User).order_by(User.created_at.asc())).all()
    return [_user_to_response(user) for user in users]


@app.post("/api/admin/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    email = payload.email.lower()
    existing = session.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Un utilisateur avec cet e-mail existe déjà")

    user = User(
        email=email,
        password_hash=_hash_password(payload.password),
        is_admin=payload.is_admin,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return _user_to_response(user)


@app.patch("/api/admin/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utilisateur introuvable")

    updated = False
    if payload.password:
        user.password_hash = _hash_password(payload.password)
        updated = True
    if payload.is_admin is not None:
        user.is_admin = payload.is_admin
        updated = True

    if updated:
        user.updated_at = datetime.datetime.now(datetime.UTC)
        session.add(user)
        session.commit()
        session.refresh(user)

    return _user_to_response(user)


@app.delete("/api/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utilisateur introuvable")

    session.delete(user)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
