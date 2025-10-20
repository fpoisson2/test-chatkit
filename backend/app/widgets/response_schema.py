"""Utilitaires pour générer des schémas JSON de widgets."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def build_widget_variables_schema(
    widget_variables: Mapping[str, object]
) -> dict[str, Any] | None:
    """Construit un schéma JSON pour les variables dynamiques d'un widget.

    Le schéma retourné décrit un objet où chaque propriété correspond à une variable
    dynamique (par exemple ``"image.src"``) attendue par le widget. Les valeurs peuvent
    être fournies sous forme de chaîne ou de liste de chaînes, conformément aux
    contraintes affichées dans l'aperçu des widgets côté frontend.
    """

    properties: dict[str, Any] = {}
    required: list[str] = []

    for raw_key in widget_variables.keys():
        if not isinstance(raw_key, str):
            continue
        normalized_key = raw_key.strip()
        if not normalized_key:
            continue

        properties[normalized_key] = {
            "type": ["string", "array"],
            "items": {"type": "string"},
            "description": (
                f"Valeur pour {normalized_key}. "
                "Utilisez une chaîne ou une liste de chaînes."
            ),
        }
        required.append(normalized_key)

    if not properties:
        return None

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        schema["required"] = required

    return schema

