#!/bin/bash
# Script d'installation pour les tests d'appels entrants

set -e

# Python avec PJSUA2 installé
PJSIP_PY="${PJSIP_PY:-/home/fpoisson/.pyenv/versions/pjsip311/bin/python}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Installation pour tests d'appels entrants${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# 1. Vérifier PJSUA2
echo -e "${BLUE}1️⃣ Vérification de PJSUA2...${NC}"
if "$PJSIP_PY" -c "import pjsua2" 2>/dev/null; then
    echo -e "   ${GREEN}✅ PJSUA2 déjà installé (via $PJSIP_PY)${NC}"
else
    echo -e "   ${YELLOW}Installation de python3-pjsua2...${NC}"
    sudo apt-get update
    sudo apt-get install -y python3-pjsua2

    if "$PJSIP_PY" -c "import pjsua2" 2>/dev/null; then
        echo -e "   ${GREEN}✅ PJSUA2 installé avec succès${NC}"
    else
        echo -e "   ${RED}❌ Échec de l'installation de PJSUA2${NC}"
        exit 1
    fi
fi

# 2. Installer les dépendances Python dans le venv
echo ""
echo -e "${BLUE}2️⃣ Installation des dépendances Python...${NC}"
if [ -d "venv" ]; then
    source venv/bin/activate
    pip install openai python-dotenv
    echo -e "   ${GREEN}✅ Dépendances installées${NC}"
else
    echo -e "   ${RED}❌ venv non trouvé${NC}"
    echo -e "   ${YELLOW}Créez d'abord le venv: python3 -m venv venv${NC}"
    exit 1
fi

# 3. Lier pjsua2 système au venv
echo ""
echo -e "${BLUE}3️⃣ Liaison de PJSUA2 au venv...${NC}"

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
SITE_PACKAGES="venv/lib/python${PYTHON_VERSION}/site-packages"

if [ ! -d "$SITE_PACKAGES" ]; then
    echo -e "   ${RED}❌ Site-packages non trouvé: $SITE_PACKAGES${NC}"
    exit 1
fi

# Trouver pjsua2.so
PJSUA_SYSTEM=$("$PJSIP_PY" -c "import pjsua2, os; print(os.path.dirname(pjsua2.__file__))" 2>/dev/null)

if [ -n "$PJSUA_SYSTEM" ]; then
    echo -e "   ${YELLOW}Liaison de $PJSUA_SYSTEM vers venv...${NC}"

    # Créer un lien symbolique
    ln -sf "$PJSUA_SYSTEM"/* "$SITE_PACKAGES/" 2>/dev/null || true

    # Vérifier
    if "$PJSIP_PY" -c "import pjsua2" 2>/dev/null; then
        echo -e "   ${GREEN}✅ PJSUA2 disponible dans le venv${NC}"
    else
        echo -e "   ${YELLOW}⚠️  Liaison échouée, utilisez $PJSIP_PY${NC}"
    fi
else
    echo -e "   ${YELLOW}⚠️  Impossible de trouver pjsua2 système${NC}"
fi

# 4. Créer la configuration
echo ""
echo -e "${BLUE}4️⃣ Configuration...${NC}"
if [ ! -f "test_config.env" ]; then
    cp test_config.example.env test_config.env
    echo -e "   ${GREEN}✅ test_config.env créé${NC}"
    echo -e "   ${YELLOW}⚠️  Éditez-le avec vos paramètres: nano test_config.env${NC}"
else
    echo -e "   ${GREEN}✅ test_config.env existe déjà${NC}"
fi

# 5. Test final
echo ""
echo -e "${BLUE}5️⃣ Test final...${NC}"
"$PJSIP_PY" -c "import pjsua2; print('   ✅ PJSUA2: OK')" 2>/dev/null || echo -e "   ${RED}❌ PJSUA2 non disponible${NC}"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Installation terminée!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Prochaines étapes:"
echo -e "  1. Éditez test_config.env avec vos paramètres SIP"
echo -e "  2. Lancez un test: ${BLUE}./run_test.sh minimal${NC}"
echo ""
