# syntax=docker/dockerfile:1.4
# =============================================================================
# Dockerfile de développement optimisé pour le backend FastAPI
# =============================================================================
# Structure multi-stage pour maximiser le cache:
#   1) base            - Python + dépendances système
#   2) pjsip-builder   - Compilation PJSIP (recaché si PJSIP_VERSION change)
#   3) playwright-deps - Playwright + Chromium (recaché si PLAYWRIGHT_VERSION change)
#   4) python-deps     - pip install avec cache mount (seuls les nouveaux packages téléchargés)
#   5) final           - Image de développement
#
# Grâce aux cache mounts, même si requirements.txt change:
#   - Les packages pip déjà téléchargés restent en cache
#   - Playwright n'est PAS retéléchargé
#   - Seuls les nouveaux/modifiés packages sont installés
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

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    set -eux; \
    rm -f /etc/apt/apt.conf.d/docker-clean; \
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
      liblzma-dev


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
# Stage 3: Playwright - Installé une fois, recaché tant que PLAYWRIGHT_VERSION
#          ne change pas (~200 MB de téléchargement pour Chromium).
# -----------------------------------------------------------------------------
FROM base AS playwright-deps

# Changer cette version pour forcer un retéléchargement de Playwright
ARG PLAYWRIGHT_VERSION=1.49.0

RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    pip install --upgrade pip && \
    pip install playwright==${PLAYWRIGHT_VERSION}

# Installer les dépendances Playwright manuellement (certains packages ont été
# renommés dans Debian Trixie: ttf-unifont -> fonts-unifont, etc.)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    set -eux; \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      # Fonts (noms corrigés pour Debian Trixie)
      fonts-unifont \
      fonts-ubuntu \
      fonts-liberation \
      fonts-noto-color-emoji \
      fontconfig \
      # Libs requises par Chromium
      libnss3 \
      libnspr4 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libasound2 \
      libpango-1.0-0 \
      libcairo2 \
      libatspi2.0-0

# Installer Chromium (sans --with-deps car on a déjà installé les deps)
RUN python -m playwright install chromium


# -----------------------------------------------------------------------------
# Stage 4: Dépendances Python - pip install avec cache mount
#          Le cache pip est persisté: seuls les NOUVEAUX packages sont téléchargés.
# -----------------------------------------------------------------------------
FROM base AS python-deps

# Copie UNIQUEMENT les fichiers qui impactent les dépendances
COPY chatkit-python /tmp/chatkit-python
COPY backend/requirements.txt backend/pyproject.toml /tmp/backend/

# --mount=type=cache : garde le cache pip entre les builds
# Même si requirements.txt change, les packages déjà téléchargés sont réutilisés
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    set -eux; \
    pip install --upgrade pip; \
    cd /tmp/backend; \
    pip install -r requirements.txt; \
    rm -rf /tmp/backend /tmp/chatkit-python


# -----------------------------------------------------------------------------
# Stage 5: Image finale de développement
#          Combine PJSIP + Playwright + deps Python + code backend
# -----------------------------------------------------------------------------
FROM base AS final

# Récupérer PJSIP (libs + includes + bindings Python)
COPY --from=pjsip-builder /usr/local /usr/local

# Récupérer Playwright et Chromium (installés séparément pour meilleur cache)
COPY --from=playwright-deps /usr/local/lib/python3.11/site-packages/playwright /usr/local/lib/python3.11/site-packages/playwright
COPY --from=playwright-deps /root/.cache/ms-playwright /root/.cache/ms-playwright

# Récupérer les modules Python installés (site-packages)
COPY --from=python-deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages

# Installer les libs runtime requises par Chromium (noms corrigés pour Debian Trixie)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    set -eux; \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      fonts-unifont \
      fonts-liberation \
      fonts-noto-color-emoji \
      fontconfig \
      libnss3 \
      libnspr4 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libasound2 \
      libpango-1.0-0 \
      libcairo2 \
      libatspi2.0-0

# S'assurer que les libs partagées sont trouvées
RUN ldconfig

WORKDIR /app

# Copie du code backend (écrasé en dev par le volume monté)
COPY backend/ .

# Healthcheck pour docker-compose
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
