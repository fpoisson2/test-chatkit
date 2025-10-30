"""Outil de transfert d'appel pour les agents vocaux."""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger("chatkit.telephony.call_transfer")


class TransferCallInput(BaseModel):
    """Paramètres pour le transfert d'appel."""

    phone_number: str = Field(
        description="Numéro de téléphone vers lequel transférer l'appel (format E.164 recommandé, ex: +33123456789)"
    )
    announcement: str | None = Field(
        default=None,
        description="Message optionnel à annoncer avant le transfert",
    )


class TransferCallOutput(BaseModel):
    """Résultat du transfert d'appel."""

    success: bool
    message: str
    transferred_to: str | None = None


async def transfer_call(
    phone_number: str,
    announcement: str | None = None,
    *,
    transfer_callback: Any = None,
) -> dict[str, Any]:
    """Transfère l'appel actuel vers un autre numéro de téléphone.

    Args:
        phone_number: Numéro de téléphone de destination (format E.164 recommandé)
        announcement: Message optionnel à annoncer avant le transfert
        transfer_callback: Callback interne pour effectuer le transfert SIP

    Returns:
        Dictionnaire avec le statut du transfert
    """
    if not phone_number:
        return {
            "success": False,
            "message": "Le numéro de téléphone est requis pour le transfert",
            "transferred_to": None,
        }

    # Normaliser le numéro (enlever espaces, tirets, etc.)
    normalized_number = "".join(
        ch for ch in phone_number if ch.isdigit() or ch in {"+", "#", "*"}
    )

    if not normalized_number:
        return {
            "success": False,
            "message": f"Numéro de téléphone invalide : {phone_number}",
            "transferred_to": None,
        }

    logger.info(
        "Demande de transfert d'appel vers %s (annonce: %s)",
        normalized_number,
        announcement or "aucune",
    )

    # Si un callback de transfert est fourni, l'utiliser
    if transfer_callback is not None:
        try:
            result = await transfer_callback(
                phone_number=normalized_number,
                announcement=announcement,
            )
            return result
        except Exception as exc:
            logger.exception("Erreur lors du transfert d'appel")
            return {
                "success": False,
                "message": f"Erreur lors du transfert : {exc}",
                "transferred_to": None,
            }

    # Par défaut, marquer comme non implémenté si pas de callback
    return {
        "success": False,
        "message": "Le transfert d'appel n'est pas configuré pour cette session",
        "transferred_to": None,
    }
