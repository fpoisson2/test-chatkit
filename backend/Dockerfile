# Dockerfile de développement pour le backend FastAPI
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PJSIP_VERSION=2.15.1

WORKDIR /app

# Installer les dépendances système pour PJSIP et autres outils
RUN set -eux; \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential \
      wget \
      ca-certificates \
      pkg-config \
      python3 \
      python3-pip \
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

# Télécharger, compiler et installer PJSIP avec Python bindings
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
    export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH:-}"; \
    cd pjsip-apps/src/swig/python; \
    python3 -m pip install --no-cache-dir .; \
    ldconfig; \
    python3 - <<'PY'; \
import pjsua2
ep = pjsua2.Endpoint()
ep.libCreate()
v = ep.libVersion()
print("PJSUA2 version:", v.full)
ep.libDestroy()
PY
    cd /tmp; rm -rf /tmp/pjproject-${PJSIP_VERSION} /tmp/${PJSIP_VERSION}.tar.gz

# Pré-installe les dépendances Python (dont la version locale d'openai-chatkit)
COPY chatkit-python /tmp/chatkit-python
COPY backend/requirements.txt backend/pyproject.toml /tmp/backend/
RUN pip install --upgrade pip \
    && cd /tmp/backend \
    && pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install --with-deps chromium \
    && rm -rf /tmp/backend /tmp/chatkit-python \
    && cd /app

# Copie du code (écrasé ensuite par le volume monté en développement)
COPY backend/ .

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
