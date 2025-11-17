"""Point d'entrée FastAPI en conservant la compatibilité historique."""

import logging
import os

from app import app as fastapi_app

# Configurer le niveau de log depuis la variable d'environnement
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format="%(levelname)s:%(name)s:%(message)s",
)
# Réduire le niveau de verbosité des librairies HTTP tierces pour éviter les logs de bas niveau
logging.getLogger("httpcore").setLevel(logging.INFO)
logging.getLogger("httpx").setLevel(logging.INFO)


# Filtre pour supprimer les erreurs de cancel scope du SDK OpenAI
# Ces erreurs sont internes au SDK et n'affectent pas le fonctionnement
class OpenAICancelScopeFilter(logging.Filter):
    """Filtre les erreurs de cancel scope du SDK OpenAI lors du nettoyage."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Supprimer les messages d'erreur "Attempted to exit cancel scope in a different task"
        if record.levelno == logging.ERROR:
            message = record.getMessage()
            if "cancel scope" in message.lower() and "different task" in message.lower():
                return False
        return True


# Appliquer le filtre au logger openai.agents
openai_agents_logger = logging.getLogger("openai.agents")
openai_agents_logger.addFilter(OpenAICancelScopeFilter())

app = fastapi_app
