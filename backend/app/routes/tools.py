from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from ..weather import fetch_weather

router = APIRouter()


@router.get("/api/tools/weather")
async def get_weather(
    city: str = Query(..., min_length=1, description="Ville ou localité à rechercher"),
    country: str | None = Query(
        None,
        min_length=2,
        description="Optionnel : pays ou code pays ISO pour affiner la recherche",
    ),
):
    try:
        return await fetch_weather(city, country)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="La requête vers le fournisseur météo a échoué.",
        ) from exc
