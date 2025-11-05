#!/bin/bash
# Script pour lancer facilement les tests d'appels entrants

set -e

# Python avec PJSUA2 installé
PJSIP_PY="${PJSIP_PY:-/home/fpoisson/.pyenv/versions/pjsip311/bin/python}"

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonction d'aide
show_help() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Test des Appels Entrants - Script de lancement${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Usage: $0 [OPTIONS] MODE"
    echo ""
    echo "MODES:"
    echo "  minimal     - Test minimal (sans dépendances du projet)"
    echo "  simple      - Test simple avec PJSUA"
    echo "  bridge      - Test avec Voice Bridge (nécessite OpenAI API)"
    echo "  8khz        - Test avec Voice Bridge à 8kHz direct (nécessite OpenAI API)"
    echo ""
    echo "OPTIONS:"
    echo "  -c FILE     - Fichier de configuration (défaut: test_config.env)"
    echo "  -d SECONDS  - Durée du test en secondes (défaut: infini)"
    echo "  -v          - Mode verbeux"
    echo "  -h          - Afficher cette aide"
    echo ""
    echo "EXEMPLES:"
    echo "  $0 minimal"
    echo "  $0 -v simple"
    echo "  $0 -d 300 bridge"
    echo "  $0 -c my_config.env bridge"
    echo "  $0 8khz                    # Test avec audio 8kHz direct"
    echo ""
}

# Valeurs par défaut
CONFIG_FILE="test_config.env"
DURATION=""
VERBOSE=""
MODE=""

# Parser les arguments
while getopts "c:d:vh" opt; do
    case $opt in
        c) CONFIG_FILE="$OPTARG" ;;
        d) DURATION="--duration $OPTARG" ;;
        v) VERBOSE="--verbose" ;;
        h) show_help; exit 0 ;;
        *) show_help; exit 1 ;;
    esac
done

shift $((OPTIND-1))

# Récupérer le mode
MODE="$1"

if [ -z "$MODE" ]; then
    echo -e "${RED}❌ Erreur: MODE requis${NC}"
    echo ""
    show_help
    exit 1
fi

# Vérifier que le fichier de config existe
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}❌ Erreur: Fichier de configuration '$CONFIG_FILE' introuvable${NC}"
    echo ""
    echo -e "${YELLOW}Copiez test_config.example.env en test_config.env et configurez-le:${NC}"
    echo -e "  cp test_config.example.env test_config.env"
    echo -e "  nano test_config.env"
    exit 1
fi

# Charger la configuration
echo -e "${BLUE}📋 Chargement de la configuration depuis $CONFIG_FILE...${NC}"
source "$CONFIG_FILE"

# Exporter les variables d'environnement requises par le backend
export OPENAI_API_KEY
export DATABASE_URL="${DATABASE_URL:-sqlite:///test.db}"
export AUTH_SECRET_KEY="${AUTH_SECRET_KEY:-test-secret-key-for-incoming-calls}"
export CELERY_BROKER_URL="${CELERY_BROKER_URL:-redis://localhost:6379/0}"

# Vérifier les variables requises
if [ -z "$SIP_URI" ] || [ -z "$SIP_USERNAME" ] || [ -z "$SIP_PASSWORD" ]; then
    echo -e "${RED}❌ Erreur: SIP_URI, SIP_USERNAME et SIP_PASSWORD doivent être définis${NC}"
    exit 1
fi

# Définir les valeurs par défaut
SIP_TRANSPORT="${SIP_TRANSPORT:-UDP}"
SIP_PORT="${SIP_PORT:-5060}"

# Afficher la configuration
echo -e "${GREEN}✅ Configuration chargée:${NC}"
echo -e "   SIP URI: ${SIP_URI}"
echo -e "   Username: ${SIP_USERNAME}"
echo -e "   Transport: ${SIP_TRANSPORT}:${SIP_PORT}"

# Construire les arguments communs
COMMON_ARGS="--sip-uri \"${SIP_URI}\" --username \"${SIP_USERNAME}\" --password \"${SIP_PASSWORD}\""

if [ -n "$REGISTRAR_URI" ]; then
    COMMON_ARGS="$COMMON_ARGS --registrar-uri \"${REGISTRAR_URI}\""
fi

COMMON_ARGS="$COMMON_ARGS --transport ${SIP_TRANSPORT} --port ${SIP_PORT}"

if [ -n "$DURATION" ]; then
    COMMON_ARGS="$COMMON_ARGS $DURATION"
fi

if [ -n "$VERBOSE" ]; then
    COMMON_ARGS="$COMMON_ARGS $VERBOSE"
fi

# Lancer le test selon le mode
echo ""
case "$MODE" in
    minimal)
        echo -e "${BLUE}🚀 Lancement du test minimal...${NC}"
        echo ""
        eval "\"$PJSIP_PY\" test_incoming_calls_minimal.py \"${SIP_URI}\" \"${SIP_USERNAME}\" \"${SIP_PASSWORD}\""
        ;;

    simple)
        echo -e "${BLUE}🚀 Lancement du test simple...${NC}"
        echo ""
        eval "\"$PJSIP_PY\" test_incoming_calls.py $COMMON_ARGS"
        ;;

    bridge)
        echo -e "${BLUE}🚀 Lancement du test avec Voice Bridge...${NC}"

        # Vérifier la clé API OpenAI
        if [ -z "$OPENAI_API_KEY" ]; then
            echo -e "${RED}❌ Erreur: OPENAI_API_KEY doit être défini pour le mode bridge${NC}"
            exit 1
        fi

        # Exporter la clé API
        export OPENAI_API_KEY

        # Construire les arguments du bridge
        BRIDGE_ARGS="$COMMON_ARGS"

        if [ -n "$OPENAI_MODEL" ]; then
            BRIDGE_ARGS="$BRIDGE_ARGS --model \"${OPENAI_MODEL}\""
        fi

        if [ -n "$OPENAI_VOICE" ]; then
            BRIDGE_ARGS="$BRIDGE_ARGS --voice \"${OPENAI_VOICE}\""
        fi

        if [ -n "$OPENAI_INSTRUCTIONS" ]; then
            BRIDGE_ARGS="$BRIDGE_ARGS --instructions \"${OPENAI_INSTRUCTIONS}\""
        fi

        echo ""
        eval "\"$PJSIP_PY\" test_incoming_calls_with_bridge.py $BRIDGE_ARGS"
        ;;

    8khz)
        echo -e "${BLUE}🚀 Lancement du test avec Voice Bridge 8kHz direct...${NC}"
        echo -e "${YELLOW}⚠️  Mode expérimental: envoie l'audio à 8kHz sans upsampling${NC}"

        # Vérifier la clé API OpenAI
        if [ -z "$OPENAI_API_KEY" ]; then
            echo -e "${RED}❌ Erreur: OPENAI_API_KEY doit être défini pour le mode 8khz${NC}"
            exit 1
        fi

        # Exporter la clé API
        export OPENAI_API_KEY

        # Construire les arguments du bridge
        BRIDGE_ARGS="$COMMON_ARGS"

        if [ -n "$OPENAI_MODEL" ]; then
            BRIDGE_ARGS="$BRIDGE_ARGS --model \"${OPENAI_MODEL}\""
        fi

        if [ -n "$OPENAI_VOICE" ]; then
            BRIDGE_ARGS="$BRIDGE_ARGS --voice \"${OPENAI_VOICE}\""
        fi

        if [ -n "$OPENAI_INSTRUCTIONS" ]; then
            BRIDGE_ARGS="$BRIDGE_ARGS --instructions \"${OPENAI_INSTRUCTIONS}\""
        fi

        echo ""
        echo -e "${GREEN}🎯 Configuration: Audio 8kHz direct (pas d'upsampling à 24kHz)${NC}"
        eval "\"$PJSIP_PY\" test_incoming_calls_with_bridge_8khz.py $BRIDGE_ARGS"
        ;;

    *)
        echo -e "${RED}❌ Erreur: Mode inconnu '$MODE'${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac
