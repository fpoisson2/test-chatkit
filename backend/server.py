"""Point d'entrée FastAPI en conservant la compatibilité historique."""

import logging
import os

# Configurer le niveau de log depuis la variable d'environnement
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format="%(levelname)s:%(name)s:%(message)s"
)

from app import app as fastapi_app

app = fastapi_app
