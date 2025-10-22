# Dockerfile de développement pour le backend FastAPI
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Pré-installe les dépendances Python (dont la version locale d'openai-chatkit)
COPY chatkit-python /tmp/chatkit-python
COPY backend/requirements.txt backend/pyproject.toml /tmp/backend/
RUN pip install --upgrade pip \
    && cd /tmp/backend \
    && pip install --no-cache-dir -r requirements.txt \
    && rm -rf /tmp/backend /tmp/chatkit-python \
    && cd /app

# Copie du code (écrasé ensuite par le volume monté en développement)
COPY backend/ .

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
