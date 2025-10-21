"""Tests autour de l'ingestion automatique dans le vector store depuis le workflow."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.append(str(Path(__file__).resolve().parents[3]))
sys.path.append(str(Path(__file__).resolve().parents[2]))
sys.path.append(str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://stub:stub@localhost:5432/stub")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

agents_stub = types.ModuleType("agents")


class _DummyAgent:
    def __init__(self, **kwargs) -> None:
        self.config = kwargs


class _DummyFunctionTool:
    def __init__(self, func) -> None:
        self.func = func
        self.description: str | None = None
        self.name_override: str | None = None


class _DummyModelSettings(dict):
    pass


class _DummyRunConfig:
    def __init__(self, *, trace_metadata: dict[str, str] | None = None) -> None:
        self.trace_metadata = trace_metadata or {}


class _DummyRunContextWrapper:
    def __init__(self, context) -> None:
        self.context = context


class _DummyRunner:
    @staticmethod
    def run_streamed(*args, **kwargs):  # pragma: no cover - remplacé dans le test
        raise NotImplementedError


class _DummyWebSearchTool:
    def __init__(self, **kwargs) -> None:
        for key, value in kwargs.items():
            setattr(self, key, value)


def _function_tool(name_override: str | None = None):
    def decorator(func):
        tool = _DummyFunctionTool(func)
        tool.name_override = name_override
        return tool

    return decorator


agents_stub.Agent = _DummyAgent
agents_stub.FunctionTool = _DummyFunctionTool
agents_stub.ModelSettings = _DummyModelSettings
agents_stub.RunConfig = _DummyRunConfig
agents_stub.RunContextWrapper = _DummyRunContextWrapper
agents_stub.Runner = _DummyRunner
agents_stub.TResponseInputItem = dict
agents_stub.WebSearchTool = _DummyWebSearchTool
agents_stub.function_tool = _function_tool

sys.modules.setdefault("agents", agents_stub)

openai_stub = types.ModuleType("openai")
openai_types = types.ModuleType("openai.types")
openai_shared = types.ModuleType("openai.types.shared")
openai_reasoning = types.ModuleType("openai.types.shared.reasoning")


class _DummyReasoning:
    def __init__(self, **kwargs) -> None:
        for key, value in kwargs.items():
            setattr(self, key, value)


openai_reasoning.Reasoning = _DummyReasoning
openai_shared.reasoning = openai_reasoning
openai_types.shared = openai_shared
openai_stub.types = openai_types

sys.modules.setdefault("openai", openai_stub)
sys.modules.setdefault("openai.types", openai_types)
sys.modules.setdefault("openai.types.shared", openai_shared)
sys.modules.setdefault("openai.types.shared.reasoning", openai_reasoning)

pydantic_stub = types.ModuleType("pydantic")


class _BaseModel:
    def __init__(self, **kwargs) -> None:
        for key, value in kwargs.items():
            setattr(self, key, value)

    def model_dump(self, **kwargs) -> dict[str, object]:
        return self.__dict__.copy()

    def dict(self, **kwargs) -> dict[str, object]:
        return self.__dict__.copy()

    @classmethod
    def model_rebuild(cls, *args, **kwargs):  # type: ignore[no-untyped-def]
        return None


class _TypeAdapter:
    def __init__(self, _type):  # type: ignore[no-untyped-def]
        self._type = _type

    def validate_python(self, value):  # type: ignore[no-untyped-def]
        return value

    def dump_python(self, value):  # type: ignore[no-untyped-def]
        return value


def _field(*_args, **_kwargs):
    return _kwargs.get("default", None)


def _create_model(name: str, **_fields):  # type: ignore[no-untyped-def]
    return type(name, (_BaseModel,), {})


pydantic_stub.BaseModel = _BaseModel
pydantic_stub.Field = _field
pydantic_stub.create_model = _create_model
pydantic_stub.TypeAdapter = _TypeAdapter
pydantic_stub.EmailStr = str
pydantic_stub.constr = lambda *args, **kwargs: str
pydantic_stub.ValidationError = type("ValidationError", (Exception,), {})

sys.modules.setdefault("pydantic", pydantic_stub)

sqlalchemy_stub = types.ModuleType("sqlalchemy")


class _Clause:
    def __init__(self, *args, **kwargs) -> None:
        self.args = args
        self.kwargs = kwargs

    def where(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return self

    def order_by(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return self


def _callable_type(name: str):
    def _factory(*args, **kwargs):  # type: ignore[no-untyped-def]
        return SimpleNamespace(type=name, args=args, kwargs=kwargs)

    return _factory


def _select(*args, **kwargs):  # type: ignore[no-untyped-def]
    return _Clause(*args, **kwargs)


def _delete(*args, **kwargs):  # type: ignore[no-untyped-def]
    return _Clause(*args, **kwargs)


sqlalchemy_stub.select = _select
sqlalchemy_stub.delete = _delete
sqlalchemy_stub.update = lambda *args, **kwargs: _Clause(*args, **kwargs)
sqlalchemy_stub.create_engine = lambda *args, **kwargs: SimpleNamespace()
sqlalchemy_stub.text = lambda value: value
sqlalchemy_stub.inspect = lambda *args, **kwargs: SimpleNamespace()


class _Func:
    def __getattr__(self, name: str):  # type: ignore[no-untyped-def]
        def _caller(*args, **kwargs):  # type: ignore[no-untyped-def]
            return SimpleNamespace(name=name, args=args, kwargs=kwargs)

        return _caller


sqlalchemy_stub.func = _Func()
for _name in [
    "Boolean",
    "DateTime",
    "ForeignKey",
    "Index",
    "Integer",
    "String",
    "Text",
    "UniqueConstraint",
]:
    setattr(sqlalchemy_stub, _name, _callable_type(_name))

sqlalchemy_orm_stub = types.ModuleType("sqlalchemy.orm")


class _DummySession:
    def __init__(self) -> None:
        self._results: list = []

    def __enter__(self) -> "_DummySession":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def execute(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        class _Result:
            @staticmethod
            def scalar_one_or_none():
                return None

            @staticmethod
            def scalars():
                class _Scalars:
                    @staticmethod
                    def all():
                        return []

                return _Scalars()

        return _Result()

    def add(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        return None

    def commit(self) -> None:
        return None

    def flush(self) -> None:
        return None


class _SessionFactory:
    def __call__(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        return _DummySession()


def _sessionmaker(*_args, **_kwargs):  # type: ignore[no-untyped-def]
    return _SessionFactory()


sqlalchemy_orm_stub.Session = _DummySession
sqlalchemy_orm_stub.sessionmaker = _sessionmaker
sqlalchemy_orm_stub.DeclarativeBase = type(
    "DeclarativeBase", (object,), {"metadata": SimpleNamespace()}
)
sqlalchemy_orm_stub.Mapped = object


def _mapped_column(*_args, **_kwargs):  # type: ignore[no-untyped-def]
    return None


def _relationship(*_args, **_kwargs):  # type: ignore[no-untyped-def]
    return None


sqlalchemy_orm_stub.mapped_column = _mapped_column
sqlalchemy_orm_stub.relationship = _relationship
sqlalchemy_orm_stub.selectinload = lambda *_args, **_kwargs: None

sys.modules.setdefault("sqlalchemy", sqlalchemy_stub)
sys.modules.setdefault("sqlalchemy.orm", sqlalchemy_orm_stub)

sqlalchemy_postgresql_stub = types.ModuleType("sqlalchemy.dialects.postgresql")
sqlalchemy_postgresql_stub.JSONB = object()
sys.modules.setdefault("sqlalchemy.dialects.postgresql", sqlalchemy_postgresql_stub)

sqlalchemy_engine_stub = types.ModuleType("sqlalchemy.engine")
sqlalchemy_engine_stub.Engine = type("Engine", (), {})
sys.modules.setdefault("sqlalchemy.engine", sqlalchemy_engine_stub)

sqlalchemy_exc_stub = types.ModuleType("sqlalchemy.exc")
sqlalchemy_exc_stub.OperationalError = type("OperationalError", (Exception,), {})
sys.modules.setdefault("sqlalchemy.exc", sqlalchemy_exc_stub)

pgvector_sqlalchemy_stub = types.ModuleType("pgvector.sqlalchemy")


def _vector(*args, **kwargs):  # type: ignore[no-untyped-def]
    return SimpleNamespace(args=args, kwargs=kwargs)


pgvector_sqlalchemy_stub.Vector = _vector
sys.modules.setdefault("pgvector.sqlalchemy", pgvector_sqlalchemy_stub)

chatkit_agents_stub = types.ModuleType("chatkit.agents")


class _DummyAgentContext(SimpleNamespace):
    pass


async def _stream_agent_response(*_args, **_kwargs):  # type: ignore[no-untyped-def]
    if False:
        yield None
    return


async def _stream_widget(*_args, **_kwargs):  # type: ignore[no-untyped-def]
    if False:
        yield None
    return


chatkit_agents_stub.AgentContext = _DummyAgentContext
chatkit_agents_stub.stream_agent_response = _stream_agent_response
chatkit_agents_stub.stream_widget = _stream_widget

sys.modules.setdefault("chatkit.agents", chatkit_agents_stub)

chatkit_server_stub = types.ModuleType("chatkit.server")


class _DummyChatKitServer:
    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def __class_getitem__(cls, _item):  # type: ignore[no-untyped-def]
        return cls


chatkit_server_stub.ChatKitServer = _DummyChatKitServer
sys.modules.setdefault("chatkit.server", chatkit_server_stub)

chatkit_store_stub = types.ModuleType("chatkit.store")


class _DummyNotFoundError(Exception):
    pass


class _DummyStore:
    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def __class_getitem__(cls, _item):  # type: ignore[no-untyped-def]
        return cls


chatkit_store_stub.NotFoundError = _DummyNotFoundError
chatkit_store_stub.Store = _DummyStore
sys.modules.setdefault("chatkit.store", chatkit_store_stub)

chatkit_types_stub = types.ModuleType("chatkit.types")


class _AssistantMessageContentPartTextDelta:
    def __init__(self, delta: str = "") -> None:
        self.delta = delta


class _EndOfTurnItem:
    pass


class _ErrorCode:
    STREAM_ERROR = "STREAM_ERROR"


class _ErrorEvent:
    def __init__(self, code: str, message: str, allow_retry: bool) -> None:
        self.code = code
        self.message = message
        self.allow_retry = allow_retry


class _ProgressUpdateEvent:
    def __init__(self, text: str) -> None:
        self.text = text


class _NoticeEvent:
    def __init__(self, level: str, message: str, title: str | None = None) -> None:
        self.level = level
        self.message = message
        self.title = title


class _Attachment(SimpleNamespace):
    def model_dump(self, **_kwargs):  # type: ignore[no-untyped-def]
        return self.__dict__.copy()


class _Page(SimpleNamespace):
    pass


class _ThreadItem(SimpleNamespace):
    def model_dump(self, **_kwargs):  # type: ignore[no-untyped-def]
        return self.__dict__.copy()


class _ThreadItemUpdated:
    def __init__(self, update: object) -> None:
        self.update = update


class _ThreadMetadata(SimpleNamespace):
    @classmethod
    def model_validate(cls, payload):  # type: ignore[no-untyped-def]
        if isinstance(payload, dict):
            return cls(**payload)
        return cls(payload=payload)

    def model_dump(self, **_kwargs):  # type: ignore[no-untyped-def]
        return self.__dict__.copy()


class _ThreadStreamEvent:
    pass


class _UserMessageItem:
    pass


chatkit_types_stub.AssistantMessageContentPartTextDelta = _AssistantMessageContentPartTextDelta
chatkit_types_stub.EndOfTurnItem = _EndOfTurnItem
chatkit_types_stub.ErrorCode = _ErrorCode
chatkit_types_stub.ErrorEvent = _ErrorEvent
chatkit_types_stub.ProgressUpdateEvent = _ProgressUpdateEvent
chatkit_types_stub.NoticeEvent = _NoticeEvent
chatkit_types_stub.Attachment = _Attachment
chatkit_types_stub.Page = _Page
chatkit_types_stub.ThreadItem = _ThreadItem
chatkit_types_stub.ThreadItemUpdated = _ThreadItemUpdated
chatkit_types_stub.ThreadMetadata = _ThreadMetadata
chatkit_types_stub.ThreadStreamEvent = _ThreadStreamEvent
chatkit_types_stub.UserMessageItem = _UserMessageItem

sys.modules.setdefault("chatkit.types", chatkit_types_stub)

chatkit_widgets_stub = types.ModuleType("chatkit.widgets")
chatkit_widgets_stub.WidgetRoot = object()
sys.modules.setdefault("chatkit.widgets", chatkit_widgets_stub)

httpx_stub = types.ModuleType("httpx")


class _HttpxTimeout:
    def __init__(self, *_args, **_kwargs) -> None:
        pass


class _HttpxResponse:
    def __init__(self) -> None:
        self.status_code = 200
        self.text = ""

    def json(self) -> dict[str, object]:
        return {}


class _HttpxAsyncClient:
    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "_HttpxAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def get(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        return _HttpxResponse()


httpx_stub.Timeout = _HttpxTimeout
httpx_stub.AsyncClient = _HttpxAsyncClient
sys.modules.setdefault("httpx", httpx_stub)

fastapi_stub = types.ModuleType("fastapi")


class _HTTPException(Exception):
    def __init__(self, *, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class _Status(SimpleNamespace):
    HTTP_502_BAD_GATEWAY = 502
    HTTP_404_NOT_FOUND = 404
    HTTP_201_CREATED = 201
    HTTP_204_NO_CONTENT = 204


class _FastAPI:
    def __init__(self, *args, **kwargs) -> None:
        pass

    def include_router(self, *_args, **_kwargs) -> None:
        return None

    def add_exception_handler(self, *_args, **_kwargs) -> None:
        return None

    def add_middleware(self, *_args, **_kwargs) -> None:
        return None

    def on_event(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        def decorator(func):
            return func

        return decorator


class _APIRouter:
    def __init__(self, *args, **kwargs) -> None:
        pass

    def get(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        def decorator(func):
            return func

        return decorator

    post = put = patch = delete = get


class _Response(SimpleNamespace):
    pass


class _Request(SimpleNamespace):
    pass


fastapi_stub.HTTPException = _HTTPException
fastapi_stub.status = _Status()
fastapi_stub.FastAPI = _FastAPI
fastapi_stub.APIRouter = _APIRouter
fastapi_stub.Depends = lambda func=None: func
fastapi_stub.Response = _Response
fastapi_stub.Query = lambda default=None, **_kwargs: default
fastapi_stub.Request = _Request
sys.modules.setdefault("fastapi", fastapi_stub)

fastapi_middleware_stub = types.ModuleType("fastapi.middleware")
fastapi_cors_stub = types.ModuleType("fastapi.middleware.cors")
fastapi_cors_stub.CORSMiddleware = type("CORSMiddleware", (), {})
fastapi_middleware_stub.cors = fastapi_cors_stub
fastapi_stub.middleware = fastapi_middleware_stub
sys.modules.setdefault("fastapi.middleware", fastapi_middleware_stub)
sys.modules.setdefault("fastapi.middleware.cors", fastapi_cors_stub)

fastapi_security_stub = types.ModuleType("fastapi.security")


class _HTTPAuthorizationCredentials(SimpleNamespace):
    pass


class _HTTPBearer:
    def __init__(self, *args, **kwargs) -> None:
        pass

    def __call__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return _HTTPAuthorizationCredentials()


fastapi_security_stub.HTTPAuthorizationCredentials = _HTTPAuthorizationCredentials
fastapi_security_stub.HTTPBearer = _HTTPBearer
sys.modules.setdefault("fastapi.security", fastapi_security_stub)

jwt_stub = types.ModuleType("jwt")
jwt_stub.encode = lambda payload, key, algorithm=None: "token"
jwt_stub.decode = lambda token, key, algorithms=None: {}
sys.modules.setdefault("jwt", jwt_stub)

backend_pkg = sys.modules.setdefault("backend", types.ModuleType("backend"))
backend_app_pkg = types.ModuleType("backend.app")
backend_app_pkg.__path__ = [str(Path(__file__).resolve().parents[1])]
backend_pkg.app = backend_app_pkg
sys.modules.setdefault("backend.app", backend_app_pkg)

backend_app_models_stub = types.ModuleType("backend.app.models")


class _WorkflowStep(SimpleNamespace):
    pass


class _WorkflowTransition(SimpleNamespace):
    pass


class _ChatThread(SimpleNamespace):
    pass


class _ChatThreadItem(SimpleNamespace):
    pass


class _ChatAttachment(SimpleNamespace):
    pass


backend_app_models_stub.Workflow = type("Workflow", (), {})
backend_app_models_stub.WorkflowDefinition = type("WorkflowDefinition", (), {})
backend_app_models_stub.WorkflowStep = _WorkflowStep
backend_app_models_stub.WorkflowTransition = _WorkflowTransition
backend_app_models_stub.ChatThread = _ChatThread
backend_app_models_stub.ChatThreadItem = _ChatThreadItem
backend_app_models_stub.ChatAttachment = _ChatAttachment
backend_app_models_stub.WidgetTemplate = SimpleNamespace
backend_app_pkg.models = backend_app_models_stub
sys.modules["backend.app.models"] = backend_app_models_stub

backend_app_routes_stub = types.ModuleType("backend.app.routes")

for _route_name in [
    "admin",
    "auth",
    "model_registry",
    "tools",
    "users",
    "vector_stores",
    "voice_settings",
    "widgets",
    "workflows",
    "chatkit",
]:
    module = types.ModuleType(f"backend.app.routes.{_route_name}")
    module.router = SimpleNamespace()
    setattr(backend_app_routes_stub, _route_name, module)
    sys.modules[f"backend.app.routes.{_route_name}"] = module

backend_app_pkg.routes = backend_app_routes_stub
sys.modules["backend.app.routes"] = backend_app_routes_stub

backend_app_startup_stub = types.ModuleType("backend.app.startup")


def _register_startup_events(app):  # type: ignore[no-untyped-def]
    return None


backend_app_startup_stub.register_startup_events = _register_startup_events
backend_app_pkg.startup = backend_app_startup_stub
sys.modules["backend.app.startup"] = backend_app_startup_stub

dotenv_stub = types.ModuleType("dotenv")


def _load_dotenv(*_args, **_kwargs):  # type: ignore[no-untyped-def]
    return None


dotenv_stub.load_dotenv = _load_dotenv
sys.modules.setdefault("dotenv", dotenv_stub)

chatkit_spec = importlib.util.spec_from_file_location(
    "backend.app.chatkit",
    Path(__file__).resolve().parents[1] / "chatkit.py",
    submodule_search_locations=[str(Path(__file__).resolve().parents[1])],
)
assert chatkit_spec and chatkit_spec.loader
chatkit_module = importlib.util.module_from_spec(chatkit_spec)
sys.modules["backend.app.chatkit"] = chatkit_module
chatkit_spec.loader.exec_module(chatkit_module)  # type: ignore[union-attr]

from backend.app.chatkit_core import WorkflowInput, run_workflow
from backend.app.workflows.service import WorkflowService


class _DummyRunnerResult:
    def __init__(self, output: dict[str, object]) -> None:
        self.final_output = output
        self.new_items: list[SimpleNamespace] = []

    def final_output_as(self, target_type: type[str]) -> str:
        if target_type is str:
            return json.dumps(self.final_output, ensure_ascii=False)
        raise TypeError("Unsupported conversion")


class _DummyWorkflowService:
    def __init__(self, definition: SimpleNamespace) -> None:
        self._definition = definition

    def get_current(self) -> SimpleNamespace:
        return self._definition


def _execute_json_vector_store_workflow(
    monkeypatch: pytest.MonkeyPatch,
    *,
    storage_parameters: dict[str, object],
    runner_payload: dict[str, object],
    transform_parameters: dict[str, object] | None = None,
) -> tuple[
    list[tuple[str, str, dict[str, object], dict[str, object]]],
    list[SimpleNamespace],
]:
    calls: list[tuple[str, str, dict[str, object], dict[str, object]]] = []
    sessions: list[SimpleNamespace] = []

    class _TrackingSession:
        def __init__(self) -> None:
            self.committed = False
            self.rolled_back = False

        def __enter__(self) -> "_TrackingSession":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def commit(self) -> None:
            self.committed = True

        def rollback(self) -> None:
            self.rolled_back = True

    def _fake_session() -> _TrackingSession:
        session = _TrackingSession()
        sessions.append(session)
        return session

    class _VectorStoreRecorder:
        def __init__(self, session: _TrackingSession) -> None:
            self.session = session

        def ingest(
            self,
            slug: str,
            doc_id: str,
            payload: dict[str, object],
            *,
            document_metadata: dict[str, object] | None = None,
        ) -> None:
            calls.append((slug, doc_id, payload, document_metadata or {}))

    async def _immediate_to_thread(func, *args, **kwargs):  # type: ignore[no-untyped-def]
        return func(*args, **kwargs)

    async def _fake_stream_agent_response(*args, **kwargs):  # type: ignore[no-untyped-def]
        if False:
            yield None
        return

    monkeypatch.setattr(chatkit_module, "SessionLocal", _fake_session)
    monkeypatch.setattr(chatkit_module, "JsonVectorStoreService", _VectorStoreRecorder)
    monkeypatch.setattr(chatkit_module.asyncio, "to_thread", _immediate_to_thread)
    monkeypatch.setattr(
        chatkit_module.Runner,
        "run_streamed",
        lambda *args, **kwargs: _DummyRunnerResult(dict(runner_payload)),
    )
    monkeypatch.setattr(chatkit_module, "stream_agent_response", _fake_stream_agent_response)
    monkeypatch.setitem(
        chatkit_module._AGENT_BUILDERS,  # type: ignore[attr-defined]
        "vector_scribe",
        lambda overrides: SimpleNamespace(name="Vector Scribe"),
    )

    start_step = SimpleNamespace(
        slug="start",
        kind="start",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=0,
        id=1,
        display_name="Début",
    )
    agent_step = SimpleNamespace(
        slug="vector-agent",
        kind="agent",
        is_enabled=True,
        parameters={},
        agent_key="vector_scribe",
        position=1,
        id=2,
        display_name="Préparation",
    )
    current_position = 2
    transform_step = None
    if transform_parameters is not None:
        transform_step = SimpleNamespace(
            slug="transform-record",
            kind="transform",
            is_enabled=True,
            parameters=dict(transform_parameters),
            agent_key=None,
            position=current_position,
            id=3,
            display_name="Transformation",
        )
        current_position += 1

    storage_step = SimpleNamespace(
        slug="store-json",
        kind="json_vector_store",
        is_enabled=True,
        parameters=dict(storage_parameters),
        agent_key=None,
        position=current_position,
        id=3 if transform_step is None else 4,
        display_name="Sauvegarde",
    )
    end_step = SimpleNamespace(
        slug="end",
        kind="end",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=current_position + 1,
        id=4 if transform_step is None else 5,
        display_name="Fin",
    )

    transitions: list[SimpleNamespace] = [
        SimpleNamespace(id=1, source_step=start_step, target_step=agent_step, condition=None),
    ]
    next_transition_id = 2
    if transform_step is not None:
        transitions.append(
            SimpleNamespace(
                id=next_transition_id,
                source_step=agent_step,
                target_step=transform_step,
                condition=None,
            )
        )
        next_transition_id += 1
        transitions.append(
            SimpleNamespace(
                id=next_transition_id,
                source_step=transform_step,
                target_step=storage_step,
                condition=None,
            )
        )
        next_transition_id += 1
    else:
        transitions.append(
            SimpleNamespace(
                id=next_transition_id,
                source_step=agent_step,
                target_step=storage_step,
                condition=None,
            )
        )
        next_transition_id += 1
    transitions.append(
        SimpleNamespace(
            id=next_transition_id,
            source_step=storage_step,
            target_step=end_step,
            condition=None,
        )
    )

    definition = SimpleNamespace(
        steps=[step for step in [start_step, agent_step, transform_step, storage_step, end_step] if step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    async def _exercise() -> None:
        workflow_input = WorkflowInput(input_as_text="Bonjour")

        await run_workflow(
            workflow_input,
            agent_context=SimpleNamespace(),
            workflow_service=_DummyWorkflowService(definition),
        )

    asyncio.run(_exercise())

    return calls, sessions


def test_normalize_graph_accepts_json_vector_store_node() -> None:
    service = WorkflowService(session_factory=lambda: None)
    payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "agent-triage",
                "kind": "agent",
                "agent_key": "triage",
                "is_enabled": True,
            },
            {
                "slug": "json-store",
                "kind": "json_vector_store",
                "is_enabled": True,
                "parameters": {
                    "vector_store_slug": "dossiers-clients",
                    "doc_id_expression": "input.output_parsed.id",
                    "document_expression": "input.output_parsed",
                },
            },
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "agent-triage"},
            {"source": "agent-triage", "target": "json-store"},
            {"source": "json-store", "target": "end"},
        ],
    }

    nodes, edges = service._normalize_graph(payload)

    assert any(node.kind == "json_vector_store" for node in nodes)
    assert any(edge.target_slug == "json-store" for edge in edges)


def test_normalize_graph_accepts_transform_node() -> None:
    service = WorkflowService(session_factory=lambda: None)
    payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "agent-triage",
                "kind": "agent",
                "agent_key": "triage",
                "is_enabled": True,
            },
            {
                "slug": "reshape",
                "kind": "transform",
                "is_enabled": True,
                "parameters": {"expressions": {"slug": "{{ input.output_structured.slug }}"}},
            },
            {
                "slug": "json-store",
                "kind": "json_vector_store",
                "is_enabled": True,
                "parameters": {
                    "vector_store_slug": "dossiers-clients",
                    "doc_id_expression": "input.output_structured.id",
                    "document_expression": "input.output_structured",
                },
            },
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "agent-triage"},
            {"source": "agent-triage", "target": "reshape"},
            {"source": "reshape", "target": "json-store"},
            {"source": "json-store", "target": "end"},
        ],
    }

    nodes, edges = service._normalize_graph(payload)

    assert any(node.kind == "transform" for node in nodes)
    assert any(edge.target_slug == "reshape" for edge in edges)


def test_run_workflow_ingests_agent_json(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, sessions = _execute_json_vector_store_workflow(
        monkeypatch,
        storage_parameters={
            "vector_store_slug": "demo-store",
            "doc_id_expression": "input.output_parsed.doc_id",
            "document_expression": "input.output_parsed.record",
            "metadata_expression": '{"source": "workflow"}',
        },
        runner_payload={
            "doc_id": "demo-doc",
            "record": {"title": "Nouvelle fiche"},
        },
    )

    assert len(calls) == 1
    slug, doc_id, payload, metadata = calls[0]
    assert slug == "demo-store"
    assert doc_id == "demo-doc"
    assert payload == {"title": "Nouvelle fiche"}
    assert metadata["workflow_step"] == "store-json"
    assert metadata["workflow_step_title"] == "Sauvegarde"
    assert metadata["source"] == "workflow"

    assert sessions and sessions[0].committed is True


def test_json_vector_store_node_uses_structured_output_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls, sessions = _execute_json_vector_store_workflow(
        monkeypatch,
        storage_parameters={"vector_store_slug": "demo-store"},
        runner_payload={
            "doc_id": "auto-doc",
            "payload": {"title": "Nouvelle fiche"},
        },
    )

    assert len(calls) == 1
    slug, doc_id, payload, metadata = calls[0]
    assert slug == "demo-store"
    assert doc_id == "auto-doc"
    assert payload == {
        "doc_id": "auto-doc",
        "payload": {"title": "Nouvelle fiche"},
    }
    assert metadata["workflow_step"] == "store-json"
    assert metadata["workflow_step_title"] == "Sauvegarde"

    assert sessions and sessions[0].committed is True


def test_json_vector_store_node_accepts_structured_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, sessions = _execute_json_vector_store_workflow(
        monkeypatch,
        storage_parameters={
            "vector_store_slug": "demo-store",
            "doc_id_expression": "input.output_structured.doc_id",
            "document_expression": "input.output_structured.record",
        },
        runner_payload={
            "doc_id": "alias-doc",
            "record": {"title": "Nouvelle fiche"},
        },
    )

    assert len(calls) == 1
    slug, doc_id, payload, metadata = calls[0]
    assert slug == "demo-store"
    assert doc_id == "alias-doc"
    assert payload == {"title": "Nouvelle fiche"}
    assert metadata["workflow_step"] == "store-json"
    assert metadata["workflow_step_title"] == "Sauvegarde"

    assert sessions and sessions[0].committed is True


def test_json_vector_store_node_generates_identifier_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_uuid = SimpleNamespace(hex="cafebabedeadbeefcafebabedeadbeef")
    monkeypatch.setattr(chatkit_module.uuid, "uuid4", lambda: fake_uuid)

    calls, sessions = _execute_json_vector_store_workflow(
        monkeypatch,
        storage_parameters={"vector_store_slug": "demo-store"},
        runner_payload={"payload": {"title": "Nouvelle fiche"}},
    )

    assert len(calls) == 1
    slug, doc_id, payload, metadata = calls[0]
    assert slug == "demo-store"
    assert doc_id == "store-json-cafebabedeadbeefcafebabedeadbeef"
    assert payload == {"payload": {"title": "Nouvelle fiche"}}
    assert metadata["workflow_step"] == "store-json"
    assert metadata["workflow_step_title"] == "Sauvegarde"

    assert sessions and sessions[0].committed is True


def test_json_vector_store_transform_step_restructures_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    widget_definition = {
        "type": "Card",
        "size": "full",
        "children": [
            {
                "type": "Image",
                "src": "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
                "alt": "Image d'exemple (Wikimedia Commons)",
                "fit": "cover",
                "frame": False,
                "position": "center",
            }
        ],
    }

    calls, sessions = _execute_json_vector_store_workflow(
        monkeypatch,
        storage_parameters={
            "vector_store_slug": "demo-store",
            "doc_id_expression": "input.output_structured.doc_id",
            "document_expression": "input.output_structured.record",
        },
        transform_parameters={
            "expressions": {
                "doc_id": "{{ input.output_structured.doc_id }}",
                "record": {
                    "slug": "{{ input.output_structured.widget }}",
                    "title": None,
                    "definition": "{{ input.output_structured.widget_definition }}",
                    "description": None,
                },
            }
        },
        runner_payload={
            "doc_id": "widget-doc",
            "widget": "image",
            "widget_definition": widget_definition,
        },
    )

    assert len(calls) == 1
    slug, doc_id, payload, metadata = calls[0]
    assert slug == "demo-store"
    assert doc_id == "widget-doc"
    assert payload == {
        "slug": "image",
        "title": None,
        "definition": widget_definition,
        "description": None,
    }
    assert metadata["workflow_step"] == "store-json"
    assert metadata["workflow_step_title"] == "Sauvegarde"

    assert sessions and sessions[0].committed is True
