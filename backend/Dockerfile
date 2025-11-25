# =============================================================================
# Dockerfile de développement optimisé pour le backend FastAPI
# =============================================================================
# Structure multi-stage pour maximiser le cache:
#   1) base          - Python + dépendances système
#   2) pjsip-builder - Compilation PJSIP (recaché seulement si PJSIP_VERSION change)
#   3) python-deps   - pip install + playwright (recaché seulement si requirements change)
#   4) final         - Image de développement
#
# Utilisation avec cache registry (survit à docker system prune -a):
#   ./scripts/docker-build.sh --push   # Build et pousse le cache
#   ./scripts/docker-build.sh --pull   # Build en tirant le cache du registry
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base commune - Python + dépendances système
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN set -eux; \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential \
      wget \
      ca-certificates \
      pkg-config \
      python3-dev \
      swig \
      libasound2-dev \
      libssl-dev \
      libuuid1 \
      uuid-dev \
      libncurses5-dev \
      libreadline-dev \
      libffi-dev \
      libz-dev \
      liblzma-dev \
    && rm -rf /var/lib/apt/lists/*


# -----------------------------------------------------------------------------
# Stage 2: PJSIP Builder - Compilé une fois, recaché tant que PJSIP_VERSION
#          ne change pas. C'est le stage le plus long (~5-10 min).
# -----------------------------------------------------------------------------
FROM base AS pjsip-builder

# Changer cette version pour forcer une recompilation de PJSIP
ARG PJSIP_VERSION=2.15.1

RUN set -eux; \
    cd /tmp && wget -q https://github.com/pjsip/pjproject/archive/refs/tags/${PJSIP_VERSION}.tar.gz; \
    tar xzf ${PJSIP_VERSION}.tar.gz; \
    cd pjproject-${PJSIP_VERSION}; \
    CFLAGS="-O2 -DNDEBUG -fPIC" \
    ./configure \
        --prefix=/usr/local \
        --enable-shared \
        --disable-video \
        --disable-openh264 \
        --disable-libyuv; \
    make dep && make -j"$(nproc)" && make install; \
    ldconfig; \
    cd pjsip-apps/src/swig/python; \
    make && make install; \
    ldconfig; \
    # Vérification que PJSIP fonctionne
    python3 -c "import pjsua2; ep = pjsua2.Endpoint(); ep.libCreate(); v = ep.libVersion(); print('PJSUA2 version:', v.full); ep.libDestroy()"; \
    # Nettoyage
    cd /tmp; rm -rf /tmp/pjproject-${PJSIP_VERSION} /tmp/${PJSIP_VERSION}.tar.gz


# -----------------------------------------------------------------------------
# Stage 3: Dépendances Python - pip install + playwright
#          Recaché seulement si requirements.txt ou pyproject.toml changent.
# -----------------------------------------------------------------------------
FROM base AS python-deps

# Copie UNIQUEMENT les fichiers qui impactent les dépendances
COPY chatkit-python /tmp/chatkit-python
COPY backend/requirements.txt backend/pyproject.toml /tmp/backend/

RUN set -eux; \
    pip install --upgrade pip; \
    cd /tmp/backend; \
    pip install --no-cache-dir -r requirements.txt; \
    # Playwright: télécharge Chromium (~200 MB, long à télécharger)
    python -m playwright install --with-deps chromium; \
    # Nettoyage
    rm -rf /tmp/backend /tmp/chatkit-python


# -----------------------------------------------------------------------------
# Stage 4: Image finale de développement
#          Combine PJSIP + deps Python + code backend
# -----------------------------------------------------------------------------
FROM base AS final

# Récupérer PJSIP (libs + includes + bindings Python)
COPY --from=pjsip-builder /usr/local /usr/local

# Récupérer les modules Python installés (site-packages + playwright)
COPY --from=python-deps /usr/local /usr/local
COPY --from=python-deps /root/.cache/ms-playwright /root/.cache/ms-playwright

# S'assurer que les libs partagées sont trouvées
RUN ldconfig

WORKDIR /app

# Copie du code backend (écrasé en dev par le volume monté)
COPY backend/ .

# Healthcheck pour docker-compose
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
