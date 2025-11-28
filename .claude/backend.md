# Backend Documentation

## Architecture

FastAPI application using async SQLAlchemy with PostgreSQL. Entry point: `backend/server.py`

## Directory Structure

```
backend/app/
├── __init__.py           # FastAPI app init, middleware
├── config.py             # Pydantic Settings
├── models.py             # SQLAlchemy ORM models
├── schemas.py            # Pydantic request/response schemas
├── dependencies.py       # FastAPI dependencies (auth, db session)
├── security.py           # Auth helpers
├── routes/               # API endpoints
├── workflows/            # Workflow execution engine
│   └── handlers/         # Step handlers (agent, widget, message, etc.)
├── lti/                  # LTI 1.3 implementation
├── telephony/            # SIP/VoIP stack
├── vector_store/         # Semantic search with pgVector
├── model_providers/      # Multi-LLM support (OpenAI, LiteLLM)
├── chatkit/              # ChatKit SDK integration
├── chatkit_server/       # ChatKit session backend
└── tests/                # 43 test files
```

## API Routes

| Prefix | Module | Description |
|--------|--------|-------------|
| `/api/workflows` | `routes/workflows.py` | Workflow CRUD & execution |
| `/api/chatkit` | `routes/chatkit.py` | Chat session management |
| `/api/lti` | `routes/lti.py` | LMS platform integration |
| `/api/admin` | `routes/admin.py` | Admin settings |
| `/api/vector-stores` | `routes/vector_stores.py` | Semantic search |
| `/api/users` | `routes/users.py` | User management |
| `/api/models` | `routes/model_registry.py` | LLM model registry |
| `/api/mcp` | `routes/mcp.py` | MCP servers |
| `/api/tools` | `routes/tools.py` | Tool definitions |
| `/api/widgets` | `routes/widgets.py` | Widget library |

## Database Models (models.py)

Key models:
- `User` - Authentication (email, password_hash, is_admin, is_lti)
- `Workflow` - Workflow metadata (name, status: draft/published)
- `WorkflowDefinition` - Graph structure (steps, transitions as JSONB)
- `WorkflowStep` - Individual nodes (step_type, configuration)
- `ChatThread` / `ChatThreadItem` - Conversation storage
- `AvailableModel` - LLM model registry
- `VoiceSettings` - Voice configuration
- `LTIRegistration` - LMS platform registration
- `SipAccount` - VoIP accounts
- `McpServer` - MCP servers

## Workflow Execution Engine

Step handlers in `workflows/handlers/`:
- `agent.py` - LLM agent execution
- `widget.py` - Interactive widgets
- `message.py` - Static messages
- `start.py` / `end.py` - Flow control
- `assign.py` - Variable assignment
- `transform.py` - Data transformation
- `vector_store.py` - Semantic search integration
- `computer_use.py` - Vision/interaction APIs

## Authentication

- JWT tokens via PyJWT
- OAuth 2.0 for LTI 1.3
- Dependencies: `get_current_user`, `get_admin_user` in `dependencies.py`
- Password hashing with bcrypt

## Adding a New API Route

1. Create route file in `backend/app/routes/`
2. Define Pydantic schemas in `schemas.py`
3. Register router in `backend/app/__init__.py`
4. Add tests in `backend/app/tests/`

```python
# Example: routes/new_feature.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.dependencies import get_session, get_current_user

router = APIRouter(prefix="/api/new-feature", tags=["new-feature"])

@router.get("/")
async def list_items(
    session: Session = Depends(get_session),
    user = Depends(get_current_user)
):
    # Implementation
    pass
```

## Testing

```bash
cd backend
pytest                           # Run all tests
pytest -k "test_workflow"        # Run specific tests
pytest --cov=app --cov-report=html  # With coverage
```

Test configuration in `backend/app/tests/conftest.py`

## Database Migrations

Using Alembic in `backend/migrations/`:
```bash
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## Key Services

- `WorkflowService` - Workflow CRUD and execution
- `ChatkitService` - Chat session management
- `LTIService` - LTI 1.3 protocol
- `VectorStoreService` - Document ingestion and search
- Model providers in `model_providers/` (OpenAI, LiteLLM)
