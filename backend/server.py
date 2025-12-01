"""Point d'entrée FastAPI en conservant la compatibilité historique."""

from __future__ import annotations

import os

# Configure logging before importing the FastAPI app so that any modules
# bundled with the app (e.g., `chatkit`) can rely on the structured handlers.
from app.logging_config import configure_logging

# Détermine si on utilise JSON ou console en fonction de l'environnement
# Par défaut: JSON en production, console en développement
environment = os.getenv("ENVIRONMENT", "development").lower()
use_json = environment == "production" or os.getenv("LOG_FORMAT", "").lower() == "json"

# Configure le logging avec structlog
configure_logging(
    log_level=os.getenv("LOG_LEVEL"),
    litellm_log_level=os.getenv("LITELLM_LOG_LEVEL"),
    use_json_logs=use_json,
)

from app import app as fastapi_app

app = fastapi_app
