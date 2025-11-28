# CLAUDE.md - EDxo Project Guide

## Project Overview

EDxo is a full-stack monorepo for an AI-powered educational assistant platform with LMS integration. It enables educators to create, customize, and deploy AI conversational assistants into learning management systems.

## Tech Stack

- **Backend**: Python 3.10+, FastAPI, SQLAlchemy 2.0, PostgreSQL 16 + pgVector, Celery + Redis
- **Frontend**: React 18, TypeScript, Vite, TanStack Query, React Flow, Radix UI
- **Voice**: OpenAI Realtime API, PJSIP (SIP/VoIP), WebRTC

## Repository Structure

```
├── backend/           # FastAPI application
├── frontend/          # React SPA
├── chatkit-python/    # ChatKit Python SDK (separate library)
├── docker-compose.yml # Development environment
└── dev.sh             # Development startup script
```

## Quick Commands

```bash
# Development
./dev.sh                      # Start all services
npm run frontend:dev          # Frontend dev server (Vite)
npm run backend:dev           # Backend dev server (uvicorn)

# Testing
npm run backend:test          # Run pytest with coverage
npm run backend:lint          # Ruff linting
npm run backend:mypy          # Type checking

# Build
npm run frontend:build        # Production frontend build
docker-compose up -d          # Start with Docker
```

## Key Architectural Patterns

1. **Service Layer**: Business logic in service modules, routes delegate to services
2. **Handler Pattern**: Extensible workflow step handlers in `backend/app/workflows/handlers/`
3. **Custom Hooks**: Frontend logic extraction (`frontend/src/hooks/`)
4. **React Query**: Server state management with TanStack Query

## Environment Variables

Copy `.env.example` to `.env` and configure:
- `DATABASE_URL` - PostgreSQL connection
- `OPENAI_API_KEY` - OpenAI API access
- `AUTH_SECRET_KEY` - JWT signing key
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` - Initial admin credentials

## Documentation Index

- [Backend Documentation](.claude/backend.md) - API routes, models, services
- [Frontend Documentation](.claude/frontend.md) - Components, hooks, state management

## Code Quality Standards

- **Python**: Black formatting (88 chars), isort imports, Ruff linting, type hints required
- **TypeScript**: Strict mode, no implicit `any`, functional components with hooks
- **Testing**: 80% minimum coverage, pytest-asyncio for backend, Vitest for frontend
