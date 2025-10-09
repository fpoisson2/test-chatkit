from __future__ import annotations

import datetime
import logging
import re
from decimal import Decimal, InvalidOperation

import httpx
from fastapi import HTTPException, status

from .schemas import WeatherResponse

logger = logging.getLogger("chatkit.server")


_WEATHER_CODE_DESCRIPTIONS: dict[int, str] = {
    0: "Ciel dégagé",
    1: "Principalement dégagé",
    2: "Partiellement nuageux",
    3: "Couvert",
    45: "Brouillard",
    48: "Brouillard givrant",
    51: "Bruine légère",
    53: "Bruine modérée",
    55: "Bruine dense",
    56: "Bruine verglaçante légère",
    57: "Bruine verglaçante dense",
    61: "Pluie faible",
    63: "Pluie modérée",
    65: "Pluie forte",
    66: "Pluie verglaçante légère",
    67: "Pluie verglaçante forte",
    71: "Chute de neige faible",
    73: "Chute de neige modérée",
    75: "Chute de neige forte",
    77: "Grains de neige",
    80: "Averses faibles",
    81: "Averses modérées",
    82: "Averses fortes",
    85: "Averses de neige faibles",
    86: "Averses de neige fortes",
    95: "Orage",
    96: "Orage avec grêle légère",
    99: "Orage avec grêle forte",
}

_DIGIT_WORDS = {
    "0": "zéro",
    "1": "un",
    "2": "deux",
    "3": "trois",
    "4": "quatre",
    "5": "cinq",
    "6": "six",
    "7": "sept",
    "8": "huit",
    "9": "neuf",
}

_MONTH_NAMES = {
    1: "janvier",
    2: "février",
    3: "mars",
    4: "avril",
    5: "mai",
    6: "juin",
    7: "juillet",
    8: "août",
    9: "septembre",
    10: "octobre",
    11: "novembre",
    12: "décembre",
}


def _spell_out_number(value: float | int) -> str:
    try:
        decimal_value = Decimal(str(value))
    except InvalidOperation:
        decimal_value = Decimal(value)

    if decimal_value == 0:
        return "zéro"

    normalized = decimal_value.normalize()
    text = format(normalized, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if not text:
        text = "0"

    tokens: list[str] = []
    for char in text:
        if char == "-":
            tokens.append("moins")
        elif char == ".":
            tokens.append("virgule")
        elif char.isdigit():
            tokens.append(_DIGIT_WORDS[char])
        else:
            tokens.append(char)

    return " ".join(token for token in tokens if token)


def _sanitize_text(value: str | None) -> str | None:
    if value is None:
        return None

    if not any(char.isdigit() for char in value):
        return value

    replaced = re.sub(
        r"\\d",
        lambda match: f" {_DIGIT_WORDS[match.group(0)]} ",
        value,
    )
    return " ".join(part for part in replaced.split() if part)


def _describe_timezone(timezone: str | None) -> str | None:
    if timezone is None:
        return None

    sanitized = _sanitize_text(timezone) or timezone
    sanitized = sanitized.replace("+", " plus ")
    sanitized = sanitized.replace("-", " moins ")
    sanitized = sanitized.replace("/", " slash ")
    sanitized = sanitized.replace(":", " deux points ")
    sanitized = sanitized.replace("_", " soulignement ")
    return " ".join(part for part in sanitized.split() if part)


def _format_observation_time(observation_time: str, timezone: str | None) -> str:
    try:
        parsed = datetime.datetime.fromisoformat(observation_time)
    except ValueError:
        fallback = _sanitize_text(observation_time) or observation_time
        if timezone:
            return f"{fallback} selon le fuseau {timezone}"
        return fallback

    month_name = _MONTH_NAMES.get(parsed.month, "mois inconnu")
    day_words = _spell_out_number(parsed.day)
    year_words = _spell_out_number(parsed.year)
    hour_words = _spell_out_number(parsed.hour)
    minute_words = _spell_out_number(parsed.minute)

    sentence = (
        f"observation effectuée le {day_words} {month_name} {year_words}"
        f" à {hour_words} heures"
    )

    if parsed.minute:
        sentence += f" et {minute_words} minutes"
    else:
        sentence += " pile"

    if timezone:
        sentence += f" selon le fuseau {timezone}"

    return sentence


def _describe_weather_code(code: int) -> str:
    return _WEATHER_CODE_DESCRIPTIONS.get(code, "Conditions météo inconnues")


async def fetch_weather(city: str, country: str | None = None) -> WeatherResponse:
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        geocode_params: dict[str, str] = {
            "name": city,
            "count": "1",
            "language": "fr",
            "format": "json",
        }
        if country:
            geocode_params["country"] = country

        geocode_response = await client.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params=geocode_params,
        )
        if geocode_response.status_code >= 400:
            logger.error(
                "Weather geocoding failed (%s): %s",
                geocode_response.status_code,
                geocode_response.text,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Le service de géocodage météo est indisponible.",
            )

        geocode_payload = geocode_response.json()
        results = geocode_payload.get("results") or []
        if not results:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Aucune localité correspondante n'a été trouvée pour cette recherche.",
            )

        location = results[0]
        latitude = location.get("latitude")
        longitude = location.get("longitude")
        if latitude is None or longitude is None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Les coordonnées de la localité sont introuvables dans la réponse météo.",
            )

        weather_params = {
            "latitude": latitude,
            "longitude": longitude,
            "current_weather": "true",
            "timezone": "auto",
            "temperature_unit": "celsius",
            "windspeed_unit": "kmh",
        }

        weather_response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params=weather_params,
        )
        if weather_response.status_code >= 400:
            logger.error(
                "Weather forecast failed (%s): %s",
                weather_response.status_code,
                weather_response.text,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Le service météo est indisponible pour le moment.",
            )

        weather_payload = weather_response.json()
        current = weather_payload.get("current_weather") or {}
        if not current:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="La réponse météo ne contient pas de conditions actuelles.",
            )

        temperature = current.get("temperature")
        windspeed = current.get("windspeed")
        observation_time = current.get("time")
        if temperature is None or windspeed is None or observation_time is None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Les données météo actuelles sont incomplètes dans la réponse du fournisseur.",
            )

        code = int(current.get("weathercode", -1))
        description = _describe_weather_code(code)

        timezone_text = _describe_timezone(weather_payload.get("timezone"))
        return WeatherResponse(
            city=_sanitize_text(str(location.get("name") or city)) or str(location.get("name") or city),
            country=_sanitize_text(location.get("country_code") or location.get("country")),
            latitude=_spell_out_number(float(latitude)),
            longitude=_spell_out_number(float(longitude)),
            temperature_celsius=_spell_out_number(float(temperature)),
            wind_speed_kmh=_spell_out_number(float(windspeed)),
            weather_code=_spell_out_number(code),
            weather_description=description,
            observation_time=_format_observation_time(str(observation_time), timezone_text),
            timezone=timezone_text,
        )
