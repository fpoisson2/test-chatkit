import logging
import os

logger = logging.getLogger("chatkit")

log_level = os.getenv("LOG_LEVEL")
if log_level:
    normalized_level = log_level.upper()
    logger.setLevel(normalized_level)

    # Install a default handler only when no root handler exists so that our
    # logs still show up if nobody else configured logging.
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        handler = logging.StreamHandler()
        handler.setLevel(normalized_level)
        formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
        handler.setFormatter(formatter)
        root_logger.addHandler(handler)
