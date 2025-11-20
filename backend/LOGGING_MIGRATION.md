# Guide de Migration vers Structlog

Ce guide explique comment utiliser le nouveau système de logging structuré avec structlog.

## Vue d'ensemble

Le logging a été amélioré pour offrir :
- **Sortie JSON** en production pour faciliter le parsing et l'analyse
- **Format console coloré** en développement pour une meilleure lisibilité
- **Contexte enrichi** (timestamps ISO, request_id, user_id, etc.)
- **Compatibilité** avec le logging standard de Python

## Configuration

### Variables d'environnement

```bash
# Niveau de log global (DEBUG, INFO, WARNING, ERROR, CRITICAL)
LOG_LEVEL=INFO

# Format de sortie (json ou console)
LOG_FORMAT=json          # Production
LOG_FORMAT=console       # Développement

# Niveau de log spécifique pour LiteLLM
LITELLM_LOG_LEVEL=WARNING

# Environnement (détecte automatiquement le format si LOG_FORMAT non défini)
ENVIRONMENT=production   # JSON par défaut
ENVIRONMENT=development  # Console par défaut
```

### Exemples de sortie

**Mode JSON (production) :**
```json
{
  "event": "user_login",
  "level": "info",
  "timestamp": "2025-11-20T02:34:16.123456Z",
  "logger": "chatkit.auth",
  "request_id": "abc123",
  "user_id": 42,
  "email": "user@example.com"
}
```

**Mode Console (développement) :**
```
2025-11-20 02:34:16 [info     ] user_login [chatkit.auth] request_id=abc123 user_id=42 email=user@example.com
```

## Utilisation dans le code

### Ancienne méthode (logging standard)

```python
import logging

logger = logging.getLogger(__name__)

# Logging basique
logger.info("Utilisateur connecté : %s", user.email)
logger.error("Erreur lors de la connexion : %s", str(exc))
```

### Nouvelle méthode (structlog) - RECOMMANDÉE

```python
from app.logging_config import get_logger

logger = get_logger(__name__)

# Logging structuré avec contexte
logger.info("user_login", user_id=user.id, email=user.email)
logger.error("login_failed", error=str(exc), email=email)
```

### Avantages du logging structuré

1. **Recherche facile** : Tous les logs avec `event="user_login"` sont facilement filtrables
2. **Typage** : Les données structurées peuvent être parsées automatiquement
3. **Contexte riche** : Ajouter autant de métadonnées que nécessaire

## Ajout de contexte global

### Request ID / Correlation ID

```python
from app.logging_config import bind_request_context, unbind_request_context

# Au début d'une requête (dans un middleware)
bind_request_context(
    request_id=request_id,
    user_id=user.id,
    session_id=session.id
)

# Les logs suivants incluront automatiquement ce contexte
logger.info("processing_request")  # Inclut request_id, user_id, session_id

# À la fin de la requête
unbind_request_context()
```

### Exemple avec FastAPI middleware

```python
from starlette.middleware.base import BaseHTTPMiddleware
from app.logging_config import bind_request_context, unbind_request_context, get_logger
import uuid

logger = get_logger(__name__)

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        # Générer ou récupérer un request_id
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))

        # Ajouter le contexte
        bind_request_context(
            request_id=request_id,
            path=request.url.path,
            method=request.method
        )

        logger.info("request_started")

        try:
            response = await call_next(request)
            logger.info("request_completed", status_code=response.status_code)
            return response
        except Exception as exc:
            logger.error("request_failed", error=str(exc), exc_info=True)
            raise
        finally:
            unbind_request_context()
```

## Migration progressive

### Compatibilité avec le code existant

Le code existant utilisant `logging.getLogger()` continue de fonctionner ! Structlog est configuré pour intercepter tous les logs standard de Python.

```python
import logging

# Ceci fonctionne toujours
logger = logging.getLogger(__name__)
logger.info("Ceci fonctionne")  # Sera traité par structlog
```

### Migration recommandée

1. **Nouveau code** : Utilisez `get_logger()` de `app.logging_config`
2. **Code existant** : Migrez progressivement lors des modifications
3. **Logs critiques** : Migrez en priorité les logs d'erreur et d'événements importants

## Bonnes pratiques

### 1. Nommage des événements

Utilisez des noms d'événements descriptifs et cohérents :

```python
# Bon ✓
logger.info("user_login_success", user_id=user.id)
logger.error("database_connection_failed", error=str(exc))

# Moins bon ✗
logger.info("Login OK")
logger.error("Error: %s", exc)
```

### 2. Éviter les logs de debug excessifs

Ne loggez pas dans des boucles serrées :

```python
# Mauvais ✗
for item in large_list:
    logger.debug("processing_item", item_id=item.id)  # Trop verbeux!

# Bon ✓
logger.info("processing_batch_started", batch_size=len(large_list))
# ... traitement ...
logger.info("processing_batch_completed", items_processed=len(large_list))
```

### 3. Utiliser les niveaux de log appropriés

- **DEBUG** : Informations de développement détaillées
- **INFO** : Événements normaux et importants
- **WARNING** : Situations inhabituelles mais gérables
- **ERROR** : Erreurs nécessitant une attention
- **CRITICAL** : Erreurs catastrophiques nécessitant une intervention immédiate

```python
logger.debug("cache_lookup", key=cache_key)          # DEBUG
logger.info("user_registered", user_id=user.id)      # INFO
logger.warning("api_slow_response", duration_ms=850) # WARNING
logger.error("payment_failed", error=str(exc))       # ERROR
logger.critical("database_unreachable")              # CRITICAL
```

### 4. Inclure le contexte d'erreur

```python
try:
    result = dangerous_operation()
except Exception as exc:
    logger.error(
        "operation_failed",
        operation="dangerous_operation",
        error=str(exc),
        exc_info=True  # Inclut le stack trace
    )
    raise
```

### 5. Logger les métriques importantes

```python
import time

start = time.perf_counter()
# ... opération ...
duration_ms = (time.perf_counter() - start) * 1000

logger.info(
    "operation_completed",
    operation="data_processing",
    duration_ms=duration_ms,
    items_processed=count
)
```

## Analyse des logs

### En développement (format console)

Les logs sont lisibles directement dans la console avec des couleurs.

### En production (format JSON)

Utilisez des outils comme `jq` pour analyser les logs :

```bash
# Filtrer par événement
cat app.log | jq 'select(.event == "user_login")'

# Filtrer par niveau
cat app.log | jq 'select(.level == "error")'

# Filtrer par request_id
cat app.log | jq 'select(.request_id == "abc123")'

# Extraire les erreurs avec stack traces
cat app.log | jq 'select(.level == "error") | {timestamp, event, error, exception}'
```

### Avec des outils de logging centralisé

Les logs JSON sont parfaits pour :
- **Elasticsearch + Kibana**
- **Splunk**
- **Datadog**
- **CloudWatch Logs**

## Dépannage

### Les logs n'apparaissent pas

Vérifiez le niveau de log :
```bash
LOG_LEVEL=DEBUG python backend/server.py
```

### Format JSON illisible en développement

Utilisez le format console :
```bash
LOG_FORMAT=console python backend/server.py
```

### LiteLLM trop verbeux

Réduisez son niveau de log :
```bash
LITELLM_LOG_LEVEL=WARNING python backend/server.py
```

## Ressources

- [Documentation structlog](https://www.structlog.org/)
- [BACKEND_IMPROVEMENTS.md](./BACKEND_IMPROVEMENTS.md) - Section 3.1 Logging Structuré
- [backend/app/logging_config.py](./backend/app/logging_config.py) - Configuration complète

---

**Dernière mise à jour :** 2025-11-20
