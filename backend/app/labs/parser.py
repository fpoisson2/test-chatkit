from __future__ import annotations

import hashlib
import re
import shlex
from typing import Any


class LabMarkdownError(ValueError):
    pass


_DIRECTIVE = re.compile(r"\{\{\s*([a-z_]+)\s+(.*?)\}\}", re.DOTALL)
_ID = re.compile(r"^[a-z][a-z0-9_]{1,127}$")
_SCALAR_TYPES = {"text", "number", "textarea", "checkbox", "radio", "select", "image", "teacher_validation"}


def _attributes(raw: str) -> dict[str, Any]:
    values: dict[str, Any] = {}
    try:
        tokens = shlex.split(raw, posix=True)
    except ValueError as exc:
        raise LabMarkdownError(f"Attribut de champ invalide: {exc}") from exc
    for token in tokens:
        if "=" not in token:
            raise LabMarkdownError(f"Attribut attendu sous la forme nom=valeur: {token}")
        key, value = token.split("=", 1)
        if value.lower() in {"true", "false"}:
            values[key] = value.lower() == "true"
        elif key in {"rows", "min", "max", "step", "points"}:
            try:
                values[key] = float(value) if "." in value else int(value)
            except ValueError:
                values[key] = value
        else:
            values[key] = value
    return values


def _pairs(value: str, attribute: str) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for entry in value.split("|"):
        key, separator, label = entry.partition(":")
        if not separator or not _ID.fullmatch(key):
            raise LabMarkdownError(f"Entrée invalide dans {attribute}: {entry}")
        result.append({"id": key, "label": label})
    if not result:
        raise LabMarkdownError(f"{attribute} ne peut pas être vide")
    return result


def _columns(value: str) -> list[dict[str, Any]]:
    """Parse ``id:label[:kind[:unit-or-options]]`` table columns."""
    result: list[dict[str, Any]] = []
    for entry in value.split("|"):
        parts = entry.split(":", 3)
        if len(parts) < 2 or not _ID.fullmatch(parts[0]):
            raise LabMarkdownError(f"Entrée invalide dans columns: {entry}")
        column: dict[str, Any] = {
            "id": parts[0], "label": parts[1],
            "input_type": parts[2] if len(parts) >= 3 else "text",
        }
        if column["input_type"] not in {"text", "number", "select", "color", "readonly"}:
            raise LabMarkdownError(f"Type de colonne invalide: {column['input_type']}")
        if len(parts) == 4 and parts[3]:
            if column["input_type"] == "select":
                column["options"] = [item.strip() for item in parts[3].split(";") if item.strip()]
            else:
                column["unit"] = parts[3]
        result.append(column)
    return result


def parse_lab_markdown(source: str, *, slug: str) -> dict[str, Any]:
    """Compile readable Markdown directives into deterministic form blocks."""

    schema_version = 3
    blocks: list[dict[str, Any]] = []
    fields: list[dict[str, Any]] = []
    ids: set[str] = set()
    headings: dict[int, str] = {}
    cursor = 0
    for match in _DIRECTIVE.finditer(source):
        markdown = source[cursor : match.start()].strip()
        if markdown:
            blocks.append({"type": "markdown", "content": markdown})
            for heading in re.finditer(r"^(#{2,6})\s+(.+?)\s*$", markdown, re.MULTILINE):
                level = len(heading.group(1))
                headings[level] = heading.group(2).strip()
                headings = {key: value for key, value in headings.items() if key <= level}
        kind = match.group(1)
        attrs = _attributes(match.group(2))
        field_id = attrs.get("id")
        if kind not in _SCALAR_TYPES | {"table", "matrix"}:
            raise LabMarkdownError(f"Type de champ inconnu: {kind}")
        if not isinstance(field_id, str) or not _ID.fullmatch(field_id):
            raise LabMarkdownError(f"Identifiant de champ invalide: {field_id!r}")
        if field_id in ids:
            raise LabMarkdownError(f"Identifiant de champ dupliqué: {field_id}")
        ids.add(field_id)
        field: dict[str, Any] = {"type": kind, **attrs}
        if headings:
            field["section"] = " › ".join(headings[level] for level in sorted(headings))
        if not isinstance(field.get("label"), str):
            raise LabMarkdownError(f"Le champ {field_id} doit avoir un label")
        if kind in {"radio", "select"}:
            options = attrs.get("options")
            if not isinstance(options, str):
                raise LabMarkdownError(f"Le champ {field_id} doit avoir des options")
            field["options"] = _pairs(options, "options")
        if kind in {"table", "matrix"}:
            columns = attrs.get("columns")
            rows = attrs.get("rows")
            if not isinstance(columns, str) or not isinstance(rows, str):
                raise LabMarkdownError(f"Le champ {field_id} doit définir rows et columns")
            field["columns"] = _columns(columns)
            field["rows"] = _pairs(rows, "rows")
            visible_columns = attrs.get("visible_columns")
            if isinstance(visible_columns, str):
                visible = {item.strip() for item in visible_columns.split(",") if item.strip()}
                unknown = visible - {column["id"] for column in field["columns"]}
                if unknown:
                    raise LabMarkdownError(f"Colonnes visibles inconnues: {', '.join(sorted(unknown))}")
                field["visible_columns"] = sorted(visible)
        fields.append(field)
        blocks.append({"type": "field", "field": field})
        cursor = match.end()
    trailing = source[cursor:].strip()
    if trailing:
        blocks.append({"type": "markdown", "content": trailing})
    title_match = re.search(r"^#\s+(.+)$", source, re.MULTILINE)
    return {
        "schema_version": schema_version,
        "slug": slug,
        "title": title_match.group(1).strip() if title_match else slug,
        "content_hash": hashlib.sha256(
            f"lab-schema:{schema_version}\n{source}".encode("utf-8")
        ).hexdigest(),
        "blocks": blocks,
        "fields": fields,
    }
