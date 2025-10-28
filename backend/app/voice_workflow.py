from __future__ import annotations

import json
import logging
from typing import Any, Mapping, Sequence

from fastapi import HTTPException, status

try:  # pragma: no cover - dépendance optionnelle selon l'environnement
    from chatkit.server import StreamingResult
    from chatkit.store import NotFoundError
except (ModuleNotFoundError, ImportError):  # pragma: no cover - fallback pour les tests

    class StreamingResult:  # type: ignore[override]
        """Fallback lorsque le SDK ChatKit n'est pas installé."""

        pass

    class NotFoundError(Exception):
        """Erreur levée lorsque le thread demandé est introuvable."""

        pass

from .chatkit import get_chatkit_server
from .chatkit_server.context import _get_wait_state_metadata, _set_wait_state_metadata

logger = logging.getLogger("chatkit.voice.workflow")


async def finalize_voice_wait_state(
    *,
    thread_id: str,
    transcripts: Sequence[Mapping[str, Any]] | None,
    context,
    current_user,
) -> None:
    """Persiste les transcriptions et relance le workflow après une session vocale."""

    server = get_chatkit_server()

    try:
        thread = await server.store.load_thread(thread_id, context)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Thread introuvable"},
        ) from exc
    except Exception as exc:  # pragma: no cover - garde-fou
        logger.exception("Erreur lors du chargement du thread", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Erreur lors de la récupération du thread"},
        ) from exc

    wait_state = _get_wait_state_metadata(thread)
    if not wait_state or wait_state.get("type") != "voice":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Aucune session vocale en attente"},
        )

    updated_wait_state = dict(wait_state)
    updated_wait_state["voice_messages_created"] = True
    if transcripts:
        updated_wait_state["voice_transcripts"] = list(transcripts)

    _set_wait_state_metadata(thread, updated_wait_state)

    try:
        await server.store.save_thread(thread, context)
    except Exception as exc:  # pragma: no cover - persistence défaillante
        logger.exception("Erreur lors de la sauvegarde des transcriptions", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Erreur lors de la sauvegarde des transcriptions"},
        ) from exc

    logger.info(
        "Finalisation de la session vocale (user=%s, thread=%s)",
        getattr(current_user, "id", "<inconnu>"),
        thread_id,
    )

    post_callable = getattr(server, "post", None)
    if callable(post_callable):
        try:
            await post_callable(
                {
                    "type": "user_message",
                    "thread_id": thread_id,
                    "message": {"content": []},
                },
                context,
            )
        except Exception as exc:
            logger.warning(
                "Échec du déclenchement de la continuation du workflow",
                exc_info=exc,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"error": "Erreur lors de la continuation du workflow"},
            ) from exc
        return

    resume_request = {
        "type": "threads.add_user_message",
        "params": {
            "thread_id": thread_id,
            "input": {
                "content": [],
                "attachments": [],
                "quoted_text": None,
                "inference_options": {},
            },
        },
    }

    try:
        result = await server.process(json.dumps(resume_request), context)
        if isinstance(result, StreamingResult):
            async for _ in result:
                pass
    except Exception as exc:  # pragma: no cover - fallback vers process
        logger.warning(
            "Erreur lors de la reprise du workflow vocale",
            exc_info=exc,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Erreur lors de la continuation du workflow"},
        ) from exc


__all__ = ["finalize_voice_wait_state"]
