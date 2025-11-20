"""Routes publiques pour la gestion des langues."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..models import Language

router = APIRouter()


class LanguageInfo(BaseModel):
    """Information sur une langue disponible."""

    code: str
    name: str


class LanguageResponse(BaseModel):
    """Réponse avec la liste des langues disponibles."""

    languages: list[LanguageInfo]


class TranslationsResponse(BaseModel):
    """Réponse avec les traductions d'une langue."""

    code: str
    name: str
    translations: dict[str, Any]


@router.get("/api/languages", response_model=LanguageResponse)
async def get_available_languages(
    session: Session = Depends(get_session),
):
    """
    Récupère la liste de toutes les langues disponibles.

    Retourne les langues de base (en, fr) plus toutes les langues
    stockées en base de données.
    """
    # Langues de base hardcodées
    base_languages = [
        LanguageInfo(code="en", name="English"),
        LanguageInfo(code="fr", name="Français"),
    ]

    # Récupérer les langues additionnelles depuis la base de données
    stmt = select(Language).order_by(Language.code)
    result = session.execute(stmt)
    db_languages = result.scalars().all()

    # Créer un dict pour éviter les doublons
    languages_dict: dict[str, LanguageInfo] = {}

    # Ajouter les langues de base d'abord
    for lang in base_languages:
        languages_dict[lang.code] = lang

    # Ajouter/remplacer avec les langues de la DB
    for lang in db_languages:
        languages_dict[lang.code] = LanguageInfo(
            code=lang.code,
            name=lang.name,
        )

    # Convertir en liste triée
    languages = sorted(languages_dict.values(), key=lambda x: x.code)

    return LanguageResponse(languages=languages)


@router.get("/api/languages/{code}/translations", response_model=TranslationsResponse)
async def get_language_translations(
    code: str,
    session: Session = Depends(get_session),
):
    """
    Récupère les traductions pour une langue spécifique.

    Pour les langues de base (en, fr), retourne un objet vide car
    les traductions sont chargées depuis les fichiers statiques.

    Pour les autres langues, retourne les traductions depuis la base de données.
    """
    # Pour les langues de base, retourner vide (elles sont chargées statiquement)
    if code in ("en", "fr"):
        return TranslationsResponse(
            code=code,
            name="English" if code == "en" else "Français",
            translations={},
        )

    # Chercher dans la base de données
    stmt = select(Language).where(Language.code == code)
    result = session.execute(stmt)
    language = result.scalar_one_or_none()

    if not language:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=404,
            detail=f"Language {code} not found",
        )

    return TranslationsResponse(
        code=language.code,
        name=language.name,
        translations=language.translations,
    )
