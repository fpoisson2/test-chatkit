from __future__ import annotations

import logging

from fastapi import FastAPI
from sqlalchemy import select

from .config import get_settings
from .database import SessionLocal, engine, wait_for_database
from .models import Base, User
from .security import hash_password

logger = logging.getLogger("chatkit.server")
settings = get_settings()


def register_startup_events(app: FastAPI) -> None:
    @app.on_event("startup")
    def _on_startup() -> None:
        wait_for_database()
        Base.metadata.create_all(bind=engine)
        if settings.admin_email and settings.admin_password:
            normalized_email = settings.admin_email.lower()
            with SessionLocal() as session:
                existing = session.scalar(select(User).where(User.email == normalized_email))
                if not existing:
                    logger.info("Creating initial admin user %s", normalized_email)
                    user = User(
                        email=normalized_email,
                        password_hash=hash_password(settings.admin_password),
                        is_admin=True,
                    )
                    session.add(user)
                    session.commit()
