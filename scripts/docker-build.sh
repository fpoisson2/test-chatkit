#!/usr/bin/env bash
# =============================================================================
# docker-build.sh - Script de build optimisé avec cache registry
# =============================================================================
# Ce script permet de builder les images Docker avec support du cache registry.
# Après un `docker system prune -a`, le rebuild sera rapide car les images
# de cache sont stockées dans un registry externe.
#
# Usage:
#   ./scripts/docker-build.sh              # Build local avec cache local
#   ./scripts/docker-build.sh --push       # Build et pousse le cache vers le registry
#   ./scripts/docker-build.sh --pull       # Build en tirant le cache du registry
#   ./scripts/docker-build.sh --push-base  # Pousse uniquement les images de base (PJSIP + deps)
#
# Variables d'environnement:
#   REGISTRY     - Registry Docker (défaut: ghcr.io/fpoisson2)
#   IMAGE_NAME   - Nom de l'image (défaut: chatkit-backend)
#   PJSIP_VERSION - Version de PJSIP (défaut: 2.15.1)
# =============================================================================

set -euo pipefail

# Configuration
REGISTRY="${REGISTRY:-ghcr.io/fpoisson2}"
IMAGE_NAME="${IMAGE_NAME:-chatkit-backend}"
PJSIP_VERSION="${PJSIP_VERSION:-2.15.1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Tags pour le cache
TAG_BASE="${REGISTRY}/${IMAGE_NAME}:cache-base"
TAG_PJSIP="${REGISTRY}/${IMAGE_NAME}:cache-pjsip-${PJSIP_VERSION}"
TAG_PYDEPS="${REGISTRY}/${IMAGE_NAME}:cache-pydeps"
TAG_FINAL="${REGISTRY}/${IMAGE_NAME}:latest"

# Vérifie que Docker BuildKit est disponible
check_buildkit() {
    if ! docker buildx version &>/dev/null; then
        log_error "Docker BuildKit (buildx) n'est pas disponible."
        log_info "Installez-le avec: docker buildx install"
        exit 1
    fi
    log_success "Docker BuildKit disponible"
}

# Build local sans registry
build_local() {
    log_info "Build local avec cache BuildKit..."
    cd "$PROJECT_ROOT"

    DOCKER_BUILDKIT=1 docker build \
        --file backend/Dockerfile \
        --target final \
        --build-arg PJSIP_VERSION="$PJSIP_VERSION" \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --tag "${IMAGE_NAME}:latest" \
        .

    log_success "Build terminé: ${IMAGE_NAME}:latest"
}

# Build avec pull du cache depuis le registry
build_with_cache_pull() {
    log_info "Build avec cache depuis le registry..."
    cd "$PROJECT_ROOT"

    # Tente de tirer les images de cache (ignore les erreurs si elles n'existent pas)
    log_info "Téléchargement des images de cache..."
    docker pull "$TAG_PJSIP" 2>/dev/null || log_warn "Image PJSIP non trouvée dans le registry"
    docker pull "$TAG_PYDEPS" 2>/dev/null || log_warn "Image Python deps non trouvée dans le registry"
    docker pull "$TAG_FINAL" 2>/dev/null || log_warn "Image finale non trouvée dans le registry"

    DOCKER_BUILDKIT=1 docker build \
        --file backend/Dockerfile \
        --target final \
        --build-arg PJSIP_VERSION="$PJSIP_VERSION" \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --cache-from "$TAG_PJSIP" \
        --cache-from "$TAG_PYDEPS" \
        --cache-from "$TAG_FINAL" \
        --tag "${IMAGE_NAME}:latest" \
        --tag "$TAG_FINAL" \
        .

    log_success "Build terminé avec cache registry"
}

# Build et push du cache vers le registry
build_and_push_cache() {
    log_info "Build et push des images de cache..."
    cd "$PROJECT_ROOT"

    # Build et tag chaque stage séparément pour le cache
    log_info "1/4 - Build du stage 'base'..."
    DOCKER_BUILDKIT=1 docker build \
        --file backend/Dockerfile \
        --target base \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --tag "$TAG_BASE" \
        .

    log_info "2/4 - Build du stage 'pjsip-builder'..."
    DOCKER_BUILDKIT=1 docker build \
        --file backend/Dockerfile \
        --target pjsip-builder \
        --build-arg PJSIP_VERSION="$PJSIP_VERSION" \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --cache-from "$TAG_BASE" \
        --tag "$TAG_PJSIP" \
        .

    log_info "3/4 - Build du stage 'python-deps'..."
    DOCKER_BUILDKIT=1 docker build \
        --file backend/Dockerfile \
        --target python-deps \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --cache-from "$TAG_BASE" \
        --tag "$TAG_PYDEPS" \
        .

    log_info "4/4 - Build du stage 'final'..."
    DOCKER_BUILDKIT=1 docker build \
        --file backend/Dockerfile \
        --target final \
        --build-arg PJSIP_VERSION="$PJSIP_VERSION" \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --cache-from "$TAG_BASE" \
        --cache-from "$TAG_PJSIP" \
        --cache-from "$TAG_PYDEPS" \
        --tag "${IMAGE_NAME}:latest" \
        --tag "$TAG_FINAL" \
        .

    # Push des images de cache
    log_info "Push des images vers le registry..."
    docker push "$TAG_PJSIP"
    docker push "$TAG_PYDEPS"
    docker push "$TAG_FINAL"

    log_success "Images de cache poussées vers le registry"
    log_info "Images disponibles:"
    echo "  - $TAG_PJSIP"
    echo "  - $TAG_PYDEPS"
    echo "  - $TAG_FINAL"
}

# Push uniquement les images de base (pour CI/CD initial)
push_base_images() {
    log_info "Push des images de base uniquement..."
    cd "$PROJECT_ROOT"

    # Build PJSIP
    log_info "Build de l'image PJSIP (peut prendre 5-10 minutes)..."
    DOCKER_BUILDKIT=1 docker build \
        --file backend/Dockerfile \
        --target pjsip-builder \
        --build-arg PJSIP_VERSION="$PJSIP_VERSION" \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --tag "$TAG_PJSIP" \
        .

    # Build Python deps
    log_info "Build de l'image Python deps..."
    DOCKER_BUILDKIT=1 docker build \
        --file backend/Dockerfile \
        --target python-deps \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --tag "$TAG_PYDEPS" \
        .

    # Push
    log_info "Push vers le registry..."
    docker push "$TAG_PJSIP"
    docker push "$TAG_PYDEPS"

    log_success "Images de base poussées:"
    echo "  - $TAG_PJSIP"
    echo "  - $TAG_PYDEPS"
    echo ""
    log_info "Pour utiliser le cache après un 'docker system prune -a':"
    echo "  ./scripts/docker-build.sh --pull"
}

# Affiche l'aide
show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Script de build Docker optimisé avec support du cache registry.
Permet des rebuilds rapides même après un 'docker system prune -a'.

Options:
  --local       Build local avec cache BuildKit (défaut)
  --pull        Build en tirant le cache depuis le registry
  --push        Build complet et push du cache vers le registry
  --push-base   Push uniquement les images de base (PJSIP + Python deps)
  --help        Affiche cette aide

Variables d'environnement:
  REGISTRY       Registry Docker (défaut: ghcr.io/fpoisson2)
  IMAGE_NAME     Nom de l'image (défaut: chatkit-backend)
  PJSIP_VERSION  Version PJSIP à compiler (défaut: 2.15.1)

Exemples:
  # Build local standard
  ./scripts/docker-build.sh

  # Première fois: build et push du cache
  docker login ghcr.io
  ./scripts/docker-build.sh --push-base

  # Après docker system prune -a: rebuild rapide
  ./scripts/docker-build.sh --pull

  # Avec un registry différent
  REGISTRY=docker.io/monuser ./scripts/docker-build.sh --push-base

EOF
}

# Main
main() {
    check_buildkit

    case "${1:-}" in
        --pull)
            build_with_cache_pull
            ;;
        --push)
            build_and_push_cache
            ;;
        --push-base)
            push_base_images
            ;;
        --help|-h)
            show_help
            ;;
        --local|"")
            build_local
            ;;
        *)
            log_error "Option inconnue: $1"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
