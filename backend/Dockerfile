# Dockerfile de développement pour le backend FastAPI
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PJSIP_VERSION=2.15.1

WORKDIR /app

# Installer les dépendances système pour PJSIP et autres outils
RUN apt-get update && apt-get install -y --no-install-recommends \
    # PJSIP build dependencies
    build-essential \
    autoconf \
    automake \
    libtool \
    pkg-config \
    swig \
    # PJSIP audio/video dependencies
    libasound2-dev \
    libssl-dev \
    libv4l-dev \
    libsdl2-dev \
    # Python headers and additional libs for pjsua2 Python bindings
    python3-dev \
    libffi-dev \
    libz-dev \
    liblzma-dev \
    # Download tools
    wget \
    ca-certificates \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Télécharger, compiler et installer PJSIP avec Python bindings
RUN cd /tmp \
    && wget https://github.com/pjsip/pjproject/archive/refs/tags/${PJSIP_VERSION}.tar.gz \
    && tar xzf ${PJSIP_VERSION}.tar.gz \
    && cd pjproject-${PJSIP_VERSION} \
    # Configure PJSIP avec support Python
    && ./configure \
        --enable-shared \
        --disable-video \
        --disable-openh264 \
        --disable-libyuv \
        CFLAGS="-O2 -DNDEBUG" \
    && make dep \
    && make -j$(nproc) \
    && make install \
    # Compiler les bindings Python pjsua2 (nouveau chemin pour 2.15+)
    && cd pjsip-apps/src/pjsua2 \
    && python3 setup.py build \
    && pip install . \
    # Mettre à jour le cache des bibliothèques partagées
    && ldconfig \
    # Vérifier l'installation
    && python3 -c "import pjsua2; ep = pjsua2.Endpoint(); ep.libCreate(); print('PJSUA2 version:', ep.libVersion().full); ep.libDestroy()" \
    # Cleanup
    && cd /tmp \
    && rm -rf /tmp/pjproject-${PJSIP_VERSION} /tmp/${PJSIP_VERSION}.tar.gz

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
