# Rate Limiting Implementation

## Overview

Rate limiting has been implemented using the `slowapi` library to protect the application against abuse, brute force attacks, and excessive usage.

## Configuration

The rate limiting configuration is centralized in `/backend/app/rate_limit.py`.

### Rate Limit Strategy

The limiter uses a **hybrid key strategy**:
- For authenticated requests: Uses `user:{user_id}`
- For unauthenticated requests: Uses `ip:{ip_address}`

This provides more accurate tracking for authenticated users while still protecting unauthenticated endpoints.

### Enabling/Disabling

Rate limiting can be disabled by setting the environment variable:
```bash
RATE_LIMIT_ENABLED=false
```

By default, rate limiting is **enabled**.

## Rate Limit Configurations

| Endpoint Type | Rate Limit | Description |
|--------------|-----------|-------------|
| `auth_login` | 5/minute | Login attempts to prevent brute force |
| `auth_register` | 3/hour | Registration to prevent spam accounts |
| `api_default` | 60/minute | Default for general API calls |
| `api_read` | 100/minute | Read operations (GET requests) |
| `api_write` | 30/minute | Write operations (POST/PATCH/DELETE) |
| `admin` | 30/minute | Admin panel operations |
| `workflow_execute` | 20/minute | Workflow execution |
| `file_upload` | 10/minute | File uploads (attachments, documents) |
| `ai_chat` | 30/minute | AI chat interactions |
| `ai_voice` | 10/minute | AI voice sessions (expensive operations) |

## Protected Endpoints

### Authentication (`/api/auth/*`)
- **POST /api/auth/login**: 5 requests/minute
  - Protects against brute force password attacks
  - Returns HTTP 429 when limit exceeded

### Admin (`/api/admin/*`)
- **PATCH /api/admin/app-settings**: 30 requests/minute
- All admin modification endpoints are protected

### ChatKit (`/api/chatkit/*`)
- **POST /api/chatkit**: 30 requests/minute (AI chat)
- **POST /api/chatkit/attachments/{id}/upload**: 10 requests/minute
- **POST /api/chatkit/voice/session**: 10 requests/minute

### Workflows (`/api/workflows/*`)
- **POST /api/workflows**: 30 requests/minute

### Documents (`/api/docs/*`)
- **POST /api/docs**: 30 requests/minute

### Vector Stores (`/api/vector-stores/*`)
- **POST /api/vector-stores/{slug}/documents**: 10 requests/minute

## Response Format

When rate limit is exceeded, the API returns:

**HTTP Status**: `429 Too Many Requests`

**Headers**:
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1234567890
Retry-After: 60
```

**Response Body**:
```json
{
  "error": "Rate limit exceeded"
}
```

## Testing Rate Limits

To test rate limiting during development:

```bash
# Test login rate limit (should fail after 5 attempts within 1 minute)
for i in {1..10}; do
  curl -X POST http://localhost:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}' \
    -w "\nStatus: %{http_code}\n"
  sleep 1
done
```

## Production Considerations

### Current Implementation
- Uses **in-memory storage** (default slowapi backend)
- Works for **single-worker deployments**
- Simple and fast for development

### For Multi-Worker Production

If deploying with multiple Uvicorn workers or multiple servers, consider upgrading to **Redis backend**:

```python
# In app/rate_limit.py
from slowapi import Limiter
from slowapi.util import get_remote_address
import redis

redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    db=int(os.getenv("REDIS_DB", 0)),
)

limiter = Limiter(
    key_func=_get_rate_limit_key,
    storage_uri=f"redis://{redis_client.connection_pool.connection_kwargs['host']}",
)
```

### Monitoring

Consider adding metrics for:
- Rate limit hits per endpoint
- Top rate-limited users/IPs
- Rate limit effectiveness

Integration with monitoring tools (Prometheus, DataDog, etc.) can be added via slowapi callbacks.

## Customization

To modify rate limits for specific endpoints:

1. Update `RATE_LIMITS` dict in `/backend/app/rate_limit.py`
2. Apply the decorator to the endpoint:

```python
from ..rate_limit import get_rate_limit, limiter

@router.post("/api/my-endpoint")
@limiter.limit(get_rate_limit("my_custom_limit"))
async def my_endpoint(request: Request):
    ...
```

3. Add your custom limit to `RATE_LIMITS`:

```python
RATE_LIMITS = {
    ...
    "my_custom_limit": "50/minute",
}
```

## Security Benefits

- **Brute Force Protection**: Login attempts limited to 5/minute
- **DoS Prevention**: API endpoints protected from excessive requests
- **Resource Protection**: Expensive AI operations strictly limited
- **Cost Control**: Rate limiting on LLM endpoints prevents runaway costs
- **Fair Usage**: Ensures all users get fair access to resources

## Future Improvements

- [ ] Add Redis backend for production multi-worker support
- [ ] Implement per-user tier-based limits (free vs premium)
- [ ] Add metrics and monitoring
- [ ] Create admin dashboard for rate limit management
- [ ] Implement dynamic rate limits based on system load
- [ ] Add whitelisting for trusted IPs/users
