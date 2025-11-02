"""
Configuration de logging pour ne voir QUE les logs d'appels (call_tracker).

À ajouter au début de votre fichier principal (ex: app/main.py ou app/__init__.py)
"""

import logging
import sys

def configure_call_tracker_only_logging():
    """Configure le logging pour ne montrer que les logs du call_tracker."""

    # 1. Créer un formatter simple (sans timestamp ni nom de logger)
    formatter = logging.Formatter('%(message)s')

    # 2. Créer un handler console
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.INFO)

    # 3. Configurer le root logger en ERROR (cache tout)
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.ERROR)
    root_logger.handlers = []  # Retirer tous les handlers existants

    # 4. Désactiver explicitement les loggers bruyants
    for logger_name in [
        'chatkit.telephony.pjsua',
        'chatkit.telephony.voice_bridge',
        'chatkit.server',
        'chatkit.realtime',
        'httpcore',
        'httpx',
        'mcp',
        'openai',
        'uvicorn',
        'uvicorn.access',
        'uvicorn.error',
    ]:
        logging.getLogger(logger_name).setLevel(logging.CRITICAL)
        logging.getLogger(logger_name).propagate = False

    # 5. Activer UNIQUEMENT le call_tracker
    call_tracker = logging.getLogger('chatkit.telephony.call_tracker')
    call_tracker.setLevel(logging.INFO)
    call_tracker.handlers = [console_handler]
    call_tracker.propagate = False

    print("✅ Logging configuré: UNIQUEMENT chatkit.telephony.call_tracker visible")


if __name__ == "__main__":
    # Test de la configuration
    configure_call_tracker_only_logging()

    # Test des logs
    logging.getLogger('chatkit.telephony.pjsua').info("❌ Ce message ne doit PAS apparaître")
    logging.getLogger('chatkit.server').info("❌ Ce message ne doit PAS apparaître")
    logging.getLogger('chatkit.telephony.call_tracker').info("✅ Ce message DOIT apparaître")
