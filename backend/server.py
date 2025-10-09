"""Point d'entrée FastAPI en conservant la compatibilité historique."""

import logging

logging.basicConfig(level=logging.INFO)

from app import app as fastapi_app

app = fastapi_app
