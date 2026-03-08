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
- `evaluated_step.py` - AI-evaluated student exercises (see below)
- `wait.py` - Wait for user input (supports masked/password mode)

### Evaluated Step Handler (`evaluated_step.py`)

Self-contained block that replaces the common pattern of ~10 nodes (instruction → wait → evaluate → feedback/retry → escalate) with a single node.

**State machine phases:**
1. `instruction` — Send instruction message to student, transition to `wait_input`
2. `wait_input` — Pause workflow, wait for user response (same mechanism as `WaitNodeHandler`)
3. `evaluate` — Call AI to assess the response (pass/fail with JSON output)
4. On pass → send success message, advance to next node
5. On fail → send AI-generated feedback, increment attempts, loop back to `wait_input`
6. On max attempts → send escalation message, enter `escalated` phase
7. `escalated` — Wait for teacher bypass code (input is masked in this phase)

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `instruction` | string | Message shown to the student as the exercise prompt |
| `evaluation_prompt` | string | Criteria for AI evaluation (pass/fail) |
| `feedback_prompt` | string | Instructions for generating constructive feedback |
| `teacher_code` | string | Optional bypass code (teacher can skip evaluation) |
| `max_attempts` | int | Max attempts before escalation (default: 3) |
| `success_message` | string | Message on successful evaluation |
| `escalation_message` | string | Message when max attempts reached |
| `masked` | bool | Mask input during escalation phase (for teacher code) |
| `model` | string | AI model name for evaluation/feedback |
| `model_provider_id` | string | Provider ID (resolved via DB admin settings) |
| `model_provider_slug` | string | Provider slug |

**AI calls use the agents SDK** (`Agent` + `Runner.run` with `RunConfig`), resolving the model provider via `get_agent_provider_binding()` — same chain as the agent block. This supports native OpenAI providers (with `api_base`) and LiteLLM auto-routing.

**Wait state:** Uses `_set_wait_state_metadata()` / `_get_wait_state_metadata()` for pause/resume, same as `WaitNodeHandler`. The `input_masked` flag in the wait state metadata tells the frontend to mask the input field.

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
