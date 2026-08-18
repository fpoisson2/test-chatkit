from __future__ import annotations

import os
import re
import uuid
import zipfile
from io import BytesIO
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from fastapi import HTTPException, UploadFile


IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def storage_root() -> Path:
    root = Path(os.getenv("LAB_UPLOAD_ROOT", Path(__file__).resolve().parents[2] / ".lab_uploads"))
    root.mkdir(parents=True, exist_ok=True)
    return root


async def read_lab_package(upload: UploadFile, slug: str) -> tuple[str, str]:
    name = upload.filename or ""
    limit = 25_000_000 if name.lower().endswith(".zip") else 2_000_000
    content = await upload.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(413, "Le fichier dépasse la taille permise")
    if name.lower().endswith(".md"):
        try:
            return content.decode("utf-8"), f"upload://{name}"
        except UnicodeDecodeError:
            raise HTTPException(422, "Le fichier doit être encodé en UTF-8") from None
    if not name.lower().endswith(".zip"):
        raise HTTPException(422, "Téléversez un fichier .md ou une archive .zip")
    try:
        archive = zipfile.ZipFile(BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(422, "Archive ZIP invalide") from None
    safe_files = [item for item in archive.infolist() if not item.is_dir() and not PurePosixPath(item.filename).is_absolute() and ".." not in PurePosixPath(item.filename).parts]
    markdown = [item for item in safe_files if PurePosixPath(item.filename).suffix.lower() == ".md"]
    if len(markdown) != 1:
        raise HTTPException(422, "L’archive doit contenir exactement un fichier Markdown")
    package_id = uuid.uuid4().hex
    package_dir = storage_root() / "course" / slug / package_id
    package_dir.mkdir(parents=True)
    base = PurePosixPath(markdown[0].filename).parent
    for item in safe_files:
        suffix = PurePosixPath(item.filename).suffix.lower()
        if suffix not in IMAGE_SUFFIXES:
            continue
        data = archive.read(item)
        if len(data) > 10_000_000:
            raise HTTPException(413, f"Image trop volumineuse: {item.filename}")
        relative = PurePosixPath(item.filename)
        target = package_dir.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    try:
        source = archive.read(markdown[0]).decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(422, "Le Markdown doit être encodé en UTF-8") from None

    def replace_image(match: re.Match[str]) -> str:
        alt, target = match.group(1), match.group(2).strip()
        if re.match(r"^(https?://|data:)", target):
            return match.group(0)
        resolved = base.joinpath(PurePosixPath(target))
        if ".." in resolved.parts:
            raise HTTPException(422, f"Chemin d’image invalide: {target}")
        asset = package_dir.joinpath(*resolved.parts)
        if not asset.is_file():
            raise HTTPException(422, f"Image absente de l’archive: {target}")
        encoded = "/".join(quote(part) for part in resolved.parts)
        return f"![{alt}](/api/labs/assets/{slug}/{package_id}/{encoded})"

    source = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", replace_image, source)
    return source, f"upload://{name}"


async def save_student_image(upload: UploadFile, attempt_id: str, field_id: str) -> dict[str, str | int]:
    content_type = (upload.content_type or "").lower()
    suffix = IMAGE_TYPES.get(content_type)
    if suffix is None:
        raise HTTPException(422, "Formats acceptés: JPEG, PNG, WebP ou GIF")
    data = await upload.read(10_000_001)
    if len(data) > 10_000_000:
        raise HTTPException(413, "L’image dépasse la limite de 10 Mo")
    image_id = uuid.uuid4().hex
    directory = storage_root() / "student" / attempt_id
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{image_id}{suffix}"
    path.write_bytes(data)
    return {"id": image_id, "field_id": field_id, "name": Path(upload.filename or "image").name,
            "content_type": content_type, "size": len(data), "storage_key": f"student/{attempt_id}/{path.name}"}


def stored_image_path(storage_key: str) -> Path:
    root = storage_root().resolve()
    candidate = (root / storage_key).resolve()
    if root not in candidate.parents or not candidate.is_file():
        raise HTTPException(404, "Image introuvable")
    return candidate


def safe_asset_path(slug: str, package_id: str, asset_path: str) -> Path:
    root = (storage_root() / "course" / slug / package_id).resolve()
    candidate = (root / asset_path).resolve()
    if root not in candidate.parents or not candidate.is_file() or candidate.suffix.lower() not in IMAGE_SUFFIXES:
        raise HTTPException(404, "Image introuvable")
    return candidate


def resolve_local_asset_url(url: str) -> Path | None:
    match = re.fullmatch(r"/api/labs/assets/([a-z][a-z0-9-]+)/([a-zA-Z0-9_-]+)/(.+)", url)
    if not match:
        return None
    try:
        return safe_asset_path(match.group(1), match.group(2), match.group(3))
    except HTTPException:
        return None
