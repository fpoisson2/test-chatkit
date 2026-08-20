import os
from pathlib import Path

from sqlalchemy import select

from .parser import LabMarkdownError, parse_lab_markdown
from .export import build_lab_attempt_docx
from .service import LabService
from .source import available_markdown_sources, resolve_markdown_path, validate_slug


def load_lab_source() -> tuple[str, Path]:
    bundled = Path(__file__).parent / "content" / "laboratoire-1.md"
    configured = os.getenv("LAB_COURSE_MARKDOWN_PATH", "").strip()
    source_path = Path(configured) if configured else bundled
    if not source_path.is_file():
        source_path = bundled
    return source_path.read_text(encoding="utf-8"), source_path


def sync_bundled_labs(session):
    """Seed the bundled "laboratoire-1" activity on first boot only.

    This used to run unconditionally on every startup, which re-synced the
    activity from the bundled file every time — silently overwriting
    whatever an admin had since published through the visual editor,
    including on every dev-server reload.
    """
    from ..models import LabActivity

    if session.scalar(select(LabActivity).where(LabActivity.slug == "laboratoire-1")) is not None:
        return
    source, source_path = load_lab_source()
    LabService(session).sync(
        slug="laboratoire-1",
        source=source,
        description=f"243-1J5-LI — source: {source_path}",
        source_path=str(source_path),
    )
    session.commit()

__all__ = ["LabMarkdownError", "LabService", "available_markdown_sources", "build_lab_attempt_docx", "load_lab_source", "parse_lab_markdown", "resolve_markdown_path", "sync_bundled_labs", "validate_slug"]
