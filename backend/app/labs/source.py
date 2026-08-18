from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import HTTPException


_SLUG = re.compile(r"^[a-z][a-z0-9-]{1,127}$")


def course_root() -> Path:
    configured = os.getenv("LAB_COURSE_ROOT", "").strip()
    if not configured:
        raise HTTPException(503, "Le répertoire des laboratoires du cours n'est pas configuré")
    root = Path(configured).resolve()
    if not root.is_dir():
        raise HTTPException(503, "Le répertoire des laboratoires du cours est inaccessible")
    return root


def validate_slug(slug: str) -> str:
    normalized = slug.strip().lower()
    if not _SLUG.fullmatch(normalized):
        raise HTTPException(422, "Le slug doit contenir seulement des lettres minuscules, chiffres et tirets")
    return normalized


def resolve_markdown_path(value: str) -> Path:
    root = course_root()
    requested = Path(value.strip())
    candidate = requested.resolve() if requested.is_absolute() else (root / requested).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise HTTPException(422, "La source doit se trouver dans le dépôt du cours") from None
    if candidate.suffix.lower() != ".md" or not candidate.is_file():
        raise HTTPException(422, "Le fichier Markdown est introuvable")
    return candidate


def available_markdown_sources() -> list[dict[str, str]]:
    configured = os.getenv("LAB_COURSE_ROOT", "").strip()
    if not configured:
        return []
    root = Path(configured).resolve()
    if not root.is_dir():
        return []
    laboratory_root = root / "labo"
    if not laboratory_root.is_dir():
        return []
    return [
        {"path": str(path.relative_to(root)), "name": path.stem}
        for path in sorted(laboratory_root.rglob("*.md"))
        if not any(part.startswith(".") or part == "node_modules" for part in path.relative_to(root).parts)
    ]
