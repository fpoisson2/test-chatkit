import sys
from pathlib import Path


def _load_vector_store_constants():
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    from app.vector_store import (
        WORKFLOW_LIBRARY_BASE_BLUEPRINT,
        WORKFLOW_VECTOR_STORE_BASE_DOCUMENT_ID,
        WORKFLOW_VECTOR_STORE_METADATA,
    )

    return (
        WORKFLOW_VECTOR_STORE_METADATA,
        WORKFLOW_LIBRARY_BASE_BLUEPRINT,
        WORKFLOW_VECTOR_STORE_BASE_DOCUMENT_ID,
    )


(
    WORKFLOW_VECTOR_STORE_METADATA,
    WORKFLOW_LIBRARY_BASE_BLUEPRINT,
    WORKFLOW_VECTOR_STORE_BASE_DOCUMENT_ID,
) = _load_vector_store_constants()


def test_workflow_metadata_exposes_base_document() -> None:
    base_document = WORKFLOW_VECTOR_STORE_METADATA.get("base_document")
    assert isinstance(base_document, dict)
    assert base_document.get("doc_id") == WORKFLOW_VECTOR_STORE_BASE_DOCUMENT_ID
    assert base_document.get("document") == WORKFLOW_LIBRARY_BASE_BLUEPRINT

    metadata = base_document.get("metadata")
    assert isinstance(metadata, dict)
    assert metadata.get("category") == "workflow_blueprint"
    assert metadata.get("template") == "starter"


def test_base_blueprint_contains_expected_nodes() -> None:
    graph = WORKFLOW_LIBRARY_BASE_BLUEPRINT.get("graph")
    assert isinstance(graph, dict)

    nodes = graph.get("nodes")
    assert isinstance(nodes, list)
    slugs = [node.get("slug") for node in nodes]
    assert slugs == ["start", "agent", "end"]

    edges = graph.get("edges")
    assert isinstance(edges, list)
    edge_pairs = {(edge.get("source"), edge.get("target")) for edge in edges}
    assert ("start", "agent") in edge_pairs
    assert ("agent", "end") in edge_pairs
