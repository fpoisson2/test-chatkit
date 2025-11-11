# Propositions d'Améliorations Backend

## Vue d'ensemble

Ce document présente des améliorations prioritaires pour le backend FastAPI de test-chatkit, organisées par catégorie et niveau de priorité.

**Architecture actuelle:**
- Framework: FastAPI + SQLAlchemy 2.0
- Base de données: PostgreSQL + pgvector
- Authentification: JWT + PBKDF2-HMAC-SHA256
- Background tasks: Celery + Redis
- 182 fichiers Python, 122 endpoints API, 15 modules de routes

---

## 1. Sécurité 🔒

### 1.1 Rate Limiting (Priorité: HAUTE)

**Problème:** Aucun rate limiting n'est actuellement implémenté sur les endpoints, rendant l'API vulnérable aux attaques par force brute et aux abus.

**Solution proposée:**
```python
# Ajouter slowapi pour le rate limiting
# requirements.txt
slowapi>=0.1.9

# backend/app/__init__.py
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Sur les endpoints sensibles:
@router.post("/api/auth/login")
@limiter.limit("5/minute")  # 5 tentatives par minute
async def login(...):
    ...
```

**Impact:** Protection contre les attaques par force brute, amélioration de la stabilité.

### 1.2 Refresh Tokens (Priorité: HAUTE)

**Problème:** Le système JWT actuel utilise uniquement des access tokens de longue durée (120 minutes par défaut), ce qui est un risque de sécurité si un token est compromis.

**Solution proposée:**
- Implémenter un système de refresh tokens avec une durée de vie courte pour les access tokens (15 min) et longue pour les refresh tokens (7 jours)
- Stocker les refresh tokens en base de données avec possibilité de révocation

**Fichiers à modifier:**
- `backend/app/security.py:52-63` - Ajouter `create_refresh_token()`
- `backend/app/routes/auth.py:15-25` - Retourner access + refresh token
- `backend/app/models.py` - Ajouter table `RefreshToken`

### 1.3 Datetime Deprecation (Priorité: MOYENNE)

**Problème:** Utilisation de `datetime.datetime.utcnow()` qui est deprecated depuis Python 3.12.

**Localisation:** `backend/app/security.py:54`
```python
# À remplacer:
expire = datetime.datetime.utcnow() + datetime.timedelta(...)

# Par:
expire = datetime.datetime.now(datetime.UTC) + datetime.timedelta(...)
```

**Impact:** Conformité avec Python 3.12+, éviter les avertissements.

### 1.4 CORS Configuration (Priorité: MOYENNE)

**Problème:** Configuration CORS par défaut avec wildcard `["*"]` si `ALLOWED_ORIGINS` n'est pas définie.

**Localisation:** `backend/app/config.py:454-458`

**Solution:**
```python
@staticmethod
def _parse_allowed_origins(raw_value: str | None) -> list[str]:
    if not raw_value:
        # Ne pas autoriser * en production
        if os.getenv("ENVIRONMENT") == "production":
            raise RuntimeError(
                "ALLOWED_ORIGINS must be explicitly set in production"
            )
        return ["http://localhost:3000", "http://localhost:8000"]
    parts = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
    return parts or ["http://localhost:3000"]
```

### 1.5 Validation des Secrets (Priorité: BASSE)

**Problème:** `AUTH_SECRET_KEY` peut être n'importe quelle chaîne sans validation de force.

**Solution:**
```python
auth_secret_key = require("AUTH_SECRET_KEY", ...)
if len(auth_secret_key) < 32:
    raise RuntimeError(
        "AUTH_SECRET_KEY must be at least 32 characters for security"
    )
```

---

## 2. Performance ⚡

### 2.1 Caching Redis (Priorité: HAUTE)

**Problème:** Redis est disponible pour Celery mais n'est pas utilisé comme cache applicatif.

**Solution proposée:**
```python
# backend/app/cache.py (nouveau fichier)
import redis.asyncio as redis
from functools import wraps
import json
import hashlib

redis_client = redis.from_url(
    "redis://localhost:6379",
    encoding="utf-8",
    decode_responses=True
)

def cache_result(ttl: int = 300):
    """Décorateur pour mettre en cache les résultats de fonction."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Générer une clé de cache
            cache_key = f"{func.__name__}:{hashlib.md5(
                json.dumps((args, kwargs), sort_keys=True).encode()
            ).hexdigest()}"

            # Vérifier le cache
            cached = await redis_client.get(cache_key)
            if cached:
                return json.loads(cached)

            # Calculer et mettre en cache
            result = await func(*args, **kwargs)
            await redis_client.setex(
                cache_key,
                ttl,
                json.dumps(result, default=str)
            )
            return result
        return wrapper
    return decorator
```

**Cas d'usage:**
- Settings applicatives (AppSettings)
- Liste des modèles disponibles
- Configuration des workflows par défaut
- Résultats de recherche vectorielle fréquents

### 2.2 Pagination Standardisée (Priorité: HAUTE)

**Problème:** Pas de système de pagination standardisé pour les endpoints qui retournent des listes.

**Solution:**
```python
# backend/app/pagination.py (nouveau fichier)
from typing import Generic, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")

class PaginationParams(BaseModel):
    page: int = Field(1, ge=1, description="Page number")
    page_size: int = Field(20, ge=1, le=100, description="Items per page")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int

def paginate(query, params: PaginationParams) -> tuple[list, int]:
    total = query.count()
    items = query.offset(params.offset).limit(params.page_size).all()
    return items, total
```

### 2.3 Query Optimization (Priorité: MOYENNE)

**Problème:** Potentiel N+1 queries sur les relations SQLAlchemy.

**Solution:** Ajouter des eager loading avec `selectinload()` ou `joinedload()`:
```python
from sqlalchemy.orm import selectinload

# Au lieu de:
workflows = session.query(Workflow).all()

# Utiliser:
workflows = session.query(Workflow)\
    .options(selectinload(Workflow.definition))\
    .all()
```

### 2.4 Connection Pooling (Priorité: BASSE)

**Amélioration actuelle:** `pool_pre_ping=True` est déjà configuré ✅

**Suggestion:** Ajouter des paramètres de pool explicites:
```python
engine = create_engine(
    settings.database_url,
    future=True,
    pool_pre_ping=True,
    pool_size=20,          # Taille du pool
    max_overflow=10,       # Connexions supplémentaires
    pool_recycle=3600,     # Recycler après 1h
)
```

---

## 3. Observabilité 📊

### 3.1 Logging Structuré (Priorité: HAUTE)

**Problème:** Logging basique sans contexte structuré, difficile à parser et analyser.

**Solution:**
```python
# requirements.txt
structlog>=24.1.0

# backend/app/logging_config.py (nouveau fichier)
import logging
import structlog

def configure_logging():
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer()
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

# Utilisation:
logger = structlog.get_logger()
logger.info("user_login", user_id=user.id, email=user.email)
```

### 3.2 Request ID / Correlation ID (Priorité: HAUTE)

**Problème:** Impossible de tracer une requête à travers les différents composants.

**Solution:**
```python
# backend/app/middleware.py (nouveau fichier)
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="")

class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request_id_var.set(request_id)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

# Dans app/__init__.py
app.add_middleware(RequestIDMiddleware)
```

### 3.3 Health Checks (Priorité: MOYENNE)

**Solution:**
```python
# backend/app/routes/health.py (nouveau fichier)
from fastapi import APIRouter, status
from sqlalchemy import text

router = APIRouter()

@router.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    """Health check basique"""
    return {"status": "healthy"}

@router.get("/health/ready", status_code=status.HTTP_200_OK)
async def readiness_check(session: Session = Depends(get_session)):
    """Vérifie que tous les services sont prêts"""
    try:
        # Check database
        session.execute(text("SELECT 1"))

        # Check Redis
        await redis_client.ping()

        return {
            "status": "ready",
            "checks": {
                "database": "ok",
                "redis": "ok"
            }
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc)
        )
```

### 3.4 Métriques Prometheus (Priorité: BASSE)

**Solution:**
```python
# requirements.txt
prometheus-fastapi-instrumentator>=6.1.0

# backend/app/__init__.py
from prometheus_fastapi_instrumentator import Instrumentator

Instrumentator().instrument(app).expose(app)
```

---

## 4. Gestion d'Erreurs 🚨

### 4.1 Gestionnaire Global d'Exceptions (Priorité: HAUTE)

**Problème:** Pas de gestion centralisée des exceptions, chaque endpoint gère ses erreurs.

**Solution:**
```python
# backend/app/exceptions.py (nouveau fichier)
from fastapi import Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

class ErrorResponse(BaseModel):
    error: str
    detail: str
    request_id: str | None = None
    timestamp: str

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Gestionnaire global pour toutes les exceptions non gérées"""
    logger.error(
        "unhandled_exception",
        error=str(exc),
        path=request.url.path,
        method=request.method,
        exc_info=exc
    )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(
            error="internal_server_error",
            detail="Une erreur interne s'est produite",
            request_id=request_id_var.get(),
            timestamp=datetime.datetime.now(datetime.UTC).isoformat()
        ).model_dump()
    )
```

### 4.2 Exceptions Métier Standardisées (Priorité: MOYENNE)

**Amélioration:** Les exceptions personnalisées existent déjà mais pourraient être standardisées.

**Localisation:** 12 fichiers avec des exceptions custom

**Solution:**
```python
# backend/app/exceptions.py
class AppException(Exception):
    """Exception de base pour l'application"""
    def __init__(
        self,
        message: str,
        status_code: int = 500,
        error_code: str = "internal_error"
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        super().__init__(message)

class ValidationError(AppException):
    def __init__(self, message: str):
        super().__init__(
            message=message,
            status_code=400,
            error_code="validation_error"
        )

class NotFoundError(AppException):
    def __init__(self, resource: str, identifier: str):
        super().__init__(
            message=f"{resource} with id {identifier} not found",
            status_code=404,
            error_code="not_found"
        )
```

---

## 5. Qualité de Code 📝

### 5.1 Optimisation de get_optional_user (Priorité: MOYENNE)

**Problème:** `get_optional_user` appelle `get_current_user` avec gestion d'exception, ce qui est inefficace.

**Localisation:** `backend/app/dependencies.py:51-60`

**Solution:**
```python
async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(http_bearer),
    session: Session = Depends(get_session),
) -> User | None:
    if credentials is None:
        return None

    try:
        payload = decode_access_token(credentials.credentials)
        user_id = payload.get("sub")
        if not user_id:
            return None

        user_pk = int(user_id)
        return session.get(User, user_pk)
    except (jwt.PyJWTError, ValueError, TypeError):
        return None
```

### 5.2 Retry Logic (Priorité: MOYENNE)

**Solution:**
```python
# requirements.txt
tenacity>=8.2.0

# Utilisation:
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10)
)
async def call_external_api():
    ...
```

### 5.3 Couverture de Tests (Priorité: HAUTE)

**Problème:** 16 fichiers de tests pour 182 fichiers Python (~8.8% en couverture de fichiers).

**Recommandations:**
- Ajouter pytest-cov pour mesurer la couverture
- Viser 80% de couverture minimum
- Prioriser les tests sur:
  - Routes d'authentification
  - Services métier critiques
  - Validation des workflows
  - Gestion des erreurs

```bash
# requirements.txt
pytest-cov>=4.1.0

# Exécution:
pytest --cov=backend/app --cov-report=html --cov-report=term
```

### 5.4 Type Hints (Priorité: BASSE)

**État actuel:** Bonne utilisation des type hints ✅ (mypy configuré)

**Amélioration possible:** Activer le mode strict de mypy
```ini
# pyproject.toml
[tool.mypy]
python_version = "3.10"
strict = true
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
```

---

## 6. Base de Données 💾

### 6.1 Migration vers Alembic (Priorité: MOYENNE)

**Problème:** Système de migration custom au lieu d'Alembic (standard de l'industrie).

**Localisation:** `backend/app/migrations.py`, `backend/app/database/ad_hoc_migrations.py`

**Solution:**
```bash
# Installation
pip install alembic

# Initialisation
alembic init backend/alembic

# Configuration dans alembic.ini
sqlalchemy.url = postgresql://...

# Génération de migration
alembic revision --autogenerate -m "initial migration"

# Application
alembic upgrade head
```

**Avantages:**
- Rollback facilité
- Migrations versionnées
- Génération automatique des migrations
- Support standard dans l'écosystème Python

### 6.2 Soft Deletes (Priorité: BASSE)

**Solution:**
```python
# Ajouter à tous les modèles importants
class BaseModel(Base):
    __abstract__ = True

    deleted_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
```

### 6.3 Audit Trail (Priorité: BASSE)

**Solution:**
```python
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False)
    changes: Mapped[dict] = mapped_column(PortableJSONB(), nullable=False)
    timestamp: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC)
    )
```

---

## 7. Design API 🌐

### 7.1 Versioning API (Priorité: MOYENNE)

**Problème:** Pas de versioning des endpoints API.

**Solution:**
```python
# Approche 1: URL versioning
app.include_router(auth.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")

# Approche 2: Header versioning
@app.middleware("http")
async def api_version_middleware(request: Request, call_next):
    version = request.headers.get("API-Version", "1")
    request.state.api_version = version
    response = await call_next(request)
    response.headers["API-Version"] = version
    return response
```

### 7.2 Documentation OpenAPI Enrichie (Priorité: BASSE)

**Solution:**
```python
app = FastAPI(
    title="ChatKit API",
    description="API pour la gestion des workflows conversationnels",
    version="1.0.0",
    contact={
        "name": "Support ChatKit",
        "email": "support@chatkit.example.com",
    },
    license_info={
        "name": "Propriétaire",
    },
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=[
        {
            "name": "auth",
            "description": "Opérations d'authentification"
        },
        {
            "name": "workflows",
            "description": "Gestion des workflows"
        },
    ]
)
```

### 7.3 Content-Type Validation (Priorité: BASSE)

**Solution:**
```python
@app.middleware("http")
async def validate_content_type(request: Request, call_next):
    if request.method in ["POST", "PUT", "PATCH"]:
        content_type = request.headers.get("content-type", "")
        if not content_type.startswith("application/json"):
            return JSONResponse(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                content={"error": "Content-Type must be application/json"}
            )
    return await call_next(request)
```

---

## 8. Configuration ⚙️

### 8.1 Validation des Variables d'Environnement (Priorité: MOYENNE)

**Solution avec Pydantic Settings:**
```python
# requirements.txt
pydantic-settings>=2.0.0

# backend/app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore"
    )

    database_url: str
    auth_secret_key: str = Field(..., min_length=32)
    allowed_origins: list[str] = ["http://localhost:3000"]
    model_provider: str = "openai"

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_origins(cls, v):
        if isinstance(v, str):
            return [x.strip() for x in v.split(",")]
        return v
```

### 8.2 Secrets Management (Priorité: HAUTE en production)

**Recommandation:** Intégrer un gestionnaire de secrets (Vault, AWS Secrets Manager, etc.)

```python
# Pour démarrer: variables d'environnement séparées
# Production: utiliser un vault
from hvac import Client

def get_secret(path: str) -> str:
    client = Client(url=os.getenv("VAULT_URL"))
    client.token = os.getenv("VAULT_TOKEN")
    return client.secrets.kv.v2.read_secret_version(path=path)
```

---

## Plan d'Implémentation Suggéré

### Phase 1 - Sécurité & Stabilité (Sprint 1-2)
1. ✅ Rate limiting sur les endpoints critiques
2. ✅ Refresh tokens
3. ✅ Correction datetime.utcnow()
4. ✅ CORS configuration stricte
5. ✅ Gestionnaire global d'exceptions

### Phase 2 - Performance & Observabilité (Sprint 3-4)
1. ✅ Caching Redis
2. ✅ Pagination standardisée
3. ✅ Logging structuré
4. ✅ Request ID / Correlation ID
5. ✅ Health checks

### Phase 3 - Qualité & Maintenance (Sprint 5-6)
1. ✅ Amélioration couverture de tests (objectif 80%)
2. ✅ Optimisation des queries (N+1)
3. ✅ Migration Alembic
4. ✅ Retry logic sur appels externes
5. ✅ Métriques Prometheus

### Phase 4 - Architecture (Sprint 7-8)
1. ✅ Versioning API
2. ✅ Circuit breaker pattern
3. ✅ Soft deletes
4. ✅ Audit trail
5. ✅ Documentation API enrichie

---

## Métriques de Succès

- **Sécurité:** 0 vulnérabilités critiques sur scan de sécurité
- **Performance:**
  - Temps de réponse moyen < 200ms (P95)
  - Requêtes DB réduites de 30% avec cache
- **Qualité:**
  - Couverture de tests > 80%
  - 0 erreurs mypy en mode strict
- **Observabilité:**
  - 100% des requêtes ont un correlation ID
  - Logs structurés sur tous les services
  - Health checks sur tous les endpoints critiques

---

## Ressources Utiles

- [FastAPI Best Practices](https://github.com/zhanymkanov/fastapi-best-practices)
- [SQLAlchemy Performance Tips](https://docs.sqlalchemy.org/en/20/faq/performance.html)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [12 Factor App](https://12factor.net/)
- [Python Logging Best Practices](https://docs.python.org/3/howto/logging.html)

---

**Dernière mise à jour:** 2025-11-11
**Auteur:** Claude (Analyse automatisée)
**Statut:** Proposition pour revue
