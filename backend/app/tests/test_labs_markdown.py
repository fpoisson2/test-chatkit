from __future__ import annotations

import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.labs.parser import LabMarkdownError, parse_lab_markdown
from app.labs.service import LabService
from app.labs.source import available_markdown_sources, resolve_markdown_path
from app.lti.service import LTIService
from app.models import Base, User


SOURCE = """# Laboratoire test

Consigne lisible.

{{ number id="tension" label="Tension" unit="V" required=true }}
{{ textarea id="observation" label="Observation" rows=3 required=true }}
{{ table id="mesures" label="Mesures" columns="valeur:Valeur" rows="r1:Ligne 1" required=true }}
"""


def test_parser_preserves_markdown_and_compiles_fields() -> None:
    definition = parse_lab_markdown(SOURCE, slug="test")
    assert definition["title"] == "Laboratoire test"
    assert [field["id"] for field in definition["fields"]] == [
        "tension", "observation", "mesures"
    ]
    assert definition["blocks"][0]["type"] == "markdown"
    assert definition["fields"][2]["rows"] == [{"id": "r1", "label": "Ligne 1"}]


def test_parser_rejects_duplicate_ids() -> None:
    with pytest.raises(LabMarkdownError, match="dupliqué"):
        parse_lab_markdown(
            '# Test\n{{ text id="answer" label="A" }}\n{{ text id="answer" label="B" }}',
            slug="test",
        )


def test_parser_compiles_typed_table_columns() -> None:
    definition = parse_lab_markdown(
        '# Test\n{{ table id="measurements" label="Mesures" columns="value:Valeur:number:V|quality:Qualité:select:bonne;moyenne" rows="r1:Ligne" required=true }}',
        slug="test",
    )
    columns = definition["fields"][0]["columns"]
    assert columns[0] == {"id": "value", "label": "Valeur", "input_type": "number", "unit": "V"}
    assert columns[1]["options"] == ["bonne", "moyenne"]


def test_attempt_autosave_conflict_and_submit_lock() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(
            email="student@example.com", password_hash="x", is_admin=False,
            is_lti=False, created_at=datetime.datetime.now(datetime.UTC),
            updated_at=datetime.datetime.now(datetime.UTC),
        )
        session.add(user)
        session.flush()
        service = LabService(session)
        activity = service.sync(slug="test", source=SOURCE)
        attempt = service.get_or_create_attempt(activity, user)
        service.save(attempt, {"tension": "4,98"}, revision=0)
        assert attempt.payload["responses"]["tension"] == pytest.approx(4.98)
        with pytest.raises(HTTPException) as conflict:
            service.save(attempt, {"tension": "5"}, revision=0)
        assert conflict.value.status_code == 409
        service.submit(
            attempt,
            {"observation": "Stable", "mesures": {"r1.valeur": "4,98"}},
            revision=1,
        )
        assert attempt.status == "submitted"
        with pytest.raises(HTTPException) as locked:
            service.save(attempt, {}, revision=2)
        assert locked.value.status_code == 409


def test_lti_resolves_lab_claim_without_workflow() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        activity = LabService(session).sync(slug="test", source=SOURCE)
        lti_service = object.__new__(LTIService)
        lti_service.session = session
        resolved = lti_service._resolve_lab_activity(
            {
                "https://purl.imsglobal.org/spec/lti/claim/custom": {
                    "resource_type": "lab",
                    "lab_activity_id": str(activity.id),
                }
            },
            None,
        )
        assert resolved is activity


def test_in_progress_attempt_migrates_to_latest_version_by_stable_id() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        now = datetime.datetime.now(datetime.UTC)
        user = User(email="migration@example.com", password_hash="x", is_admin=False,
                    is_lti=False, created_at=now, updated_at=now)
        session.add(user); session.flush()
        service = LabService(session)
        activity = service.sync(slug="test", source=SOURCE)
        attempt = service.get_or_create_attempt(activity, user)
        service.save(attempt, {"tension": "5", "observation": "avant"}, revision=0)
        changed = SOURCE.replace(
            '{{ textarea id="observation" label="Observation" rows=3 required=true }}',
            '{{ textarea id="nouvelle_observation" label="Nouvelle observation" rows=3 required=true }}',
        )
        service.sync(slug="test", source=changed)
        resumed = service.get_or_create_attempt(activity, user)
        assert resumed.id == attempt.id
        assert resumed.payload["responses"] == {"tension": 5.0}
        migration = resumed.payload["version_migrations"][-1]
        assert migration["archived_responses"] == {"observation": "avant"}


def test_markdown_source_discovery_is_confined_to_course_root(tmp_path, monkeypatch) -> None:
    course = tmp_path / "course"
    course.mkdir()
    lab_dir = course / "labo"
    lab_dir.mkdir()
    source = lab_dir / "laboratoire.md"
    source.write_text("# Laboratoire", encoding="utf-8")
    outside = tmp_path / "secret.md"
    outside.write_text("# Hors cours", encoding="utf-8")
    monkeypatch.setenv("LAB_COURSE_ROOT", str(course))
    assert resolve_markdown_path("labo/laboratoire.md") == source
    assert available_markdown_sources() == [{"path": "labo/laboratoire.md", "name": "laboratoire"}]
    with pytest.raises(HTTPException, match="dépôt du cours"):
        resolve_markdown_path(str(outside))
