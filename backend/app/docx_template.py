"""Utilitaires pour générer des documents Word à partir de modèles."""
from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from docxtpl import DocxTemplate

DEFAULT_SUFFIX = "_filled"


def render_docx_template(
    template_path: Path,
    data: Mapping[str, Any] | str,
    output_path: Path | None = None,
) -> Path:
    """Remplace les balises d'un modèle DOCX avec les valeurs d'une structure JSON.

    Le modèle doit contenir des balises Jinja (ex: ``{{ user.name }}``) et sera
    rendu à l'aide de ``docxtpl``. Le contenu du JSON peut être passé sous forme
    de dictionnaire Python ou de chaîne JSON sérialisée.

    Args:
        template_path: Chemin du modèle DOCX contenant les balises.
        data: Données utilisées pour remplacer les balises. Peut être un
            dictionnaire ou une chaîne JSON.
        output_path: Chemin du fichier généré. Par défaut, crée un fichier dans
            le même répertoire avec le suffixe ``_filled``.

    Returns:
        Le chemin du document DOCX généré.

    Raises:
        FileNotFoundError: Si le modèle n'existe pas.
        TypeError: Si ``data`` n'est ni un mapping ni une chaîne JSON valide.
        json.JSONDecodeError: Si la chaîne JSON fournie est invalide.
    """

    if not template_path.exists():
        raise FileNotFoundError(f"Modèle DOCX introuvable: {template_path}")

    if isinstance(data, str):
        data = json.loads(data)

    if not isinstance(data, Mapping):
        raise TypeError("data doit être un mapping ou une chaîne JSON")

    if output_path is None:
        output_path = template_path.with_name(
            f"{template_path.stem}{DEFAULT_SUFFIX}{template_path.suffix}"
        )

    template = DocxTemplate(str(template_path))
    template.render(dict(data))
    template.save(str(output_path))

    return output_path
