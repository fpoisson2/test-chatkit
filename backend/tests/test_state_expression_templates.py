import importlib.util
import sys
import types
from pathlib import Path


def _load_state_expression_helpers():
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    sys.modules.setdefault("openai", types.SimpleNamespace(OpenAI=object))

    sqlalchemy_module = types.ModuleType("sqlalchemy")
    sqlalchemy_module.func = types.SimpleNamespace()
    sqlalchemy_module.select = lambda *_, **__: None
    sqlalchemy_orm = types.SimpleNamespace(Session=object)
    sqlalchemy_module.orm = sqlalchemy_orm
    sys.modules.setdefault("sqlalchemy", sqlalchemy_module)
    sys.modules.setdefault("sqlalchemy.orm", sqlalchemy_orm)

    pydantic_module = types.ModuleType("pydantic")

    class _ValidationError(Exception):  # pragma: no cover - utilisé pour le chargement
        pass

    pydantic_module.ValidationError = _ValidationError
    sys.modules.setdefault("pydantic", pydantic_module)

    package = sys.modules.setdefault("app", types.ModuleType("app"))
    package.__path__ = [str(backend_dir / "app")]
    package.__spec__ = importlib.machinery.ModuleSpec(
        "app", loader=None, is_package=True
    )

    vector_store_package = sys.modules.setdefault(
        "app.vector_store", types.ModuleType("app.vector_store")
    )
    vector_store_package.__path__ = [str(backend_dir / "app/vector_store")]
    vector_store_package.__package__ = "app"
    vector_store_package.__spec__ = importlib.machinery.ModuleSpec(
        "app.vector_store", loader=None, is_package=True
    )

    dummy_service = types.ModuleType("app.vector_store.service")
    
    class _StubJsonVectorStoreService:  # pragma: no cover - utilisé pour le chargement
        pass

    dummy_service.JsonVectorStoreService = _StubJsonVectorStoreService
    dummy_service.__package__ = "app.vector_store"
    dummy_service.__spec__ = importlib.machinery.ModuleSpec(
        "app.vector_store.service", loader=None
    )
    sys.modules["app.vector_store.service"] = dummy_service

    ingestion_path = backend_dir / "app" / "vector_store" / "ingestion.py"
    source = ingestion_path.read_text(encoding="utf-8")
    patched_source = source.replace(
        "from .service import JsonVectorStoreService",
        "class JsonVectorStoreService:\n    ...",
    )

    module = types.ModuleType("app.vector_store.ingestion")
    module.__file__ = str(ingestion_path)
    module.__package__ = "app.vector_store"
    sys.modules["app.vector_store.ingestion"] = module
    exec(compile(patched_source, str(ingestion_path), "exec"), module.__dict__)

    return module.evaluate_state_expression, module._render_template_string


evaluate_state_expression, _render_template_string = _load_state_expression_helpers()


def test_evaluate_state_expression_reads_top_level_state_key() -> None:
    state = {"last_generated_image_urls": ["http://image-one", "http://image-two"]}

    assert (
        evaluate_state_expression(
            "last_generated_image_urls", state=state, default_input_context=None
        )
        == state["last_generated_image_urls"]
    )


def test_render_template_string_replaces_unprefixed_state_identifier() -> None:
    state = {"last_generated_image_urls": ["https://image"]}

    rendered = _render_template_string(
        "Liens images : {{ last_generated_image_urls }}",
        state=state,
        default_input_context=None,
        input_context=None,
    )

    assert rendered == 'Liens images : ["https://image"]'

