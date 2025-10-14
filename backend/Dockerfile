# Dockerfile de développement pour le backend FastAPI
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Dépendance système requise par torch/sentence-transformers (libgomp pour OpenMP)
RUN apt-get update \
    && apt-get install --yes --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pré-installe les dépendances Python pour éviter les réinstallations à chaque démarrage
COPY requirements.txt pyproject.toml ./
RUN pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copie du code (écrasé ensuite par le volume monté en développement)
COPY . .

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
