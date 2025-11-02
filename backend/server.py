"""Point d'entrée FastAPI en conservant la compatibilité historique."""

import logging
import os

from app import app as fastapi_app

# Ne PAS reconfigurer le logging si CHATKIT_CALL_TRACKER_ONLY est activé
# (la configuration a déjà été faite dans app/__init__.py)
if os.getenv("CHATKIT_CALL_TRACKER_ONLY", "false").lower() not in ("true", "1", "yes"):
    # Configurer le niveau de log depuis la variable d'environnement
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(levelname)s:%(name)s:%(message)s",
    )

app = fastapi_app
