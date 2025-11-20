#!/bin/bash

# Script pour exécuter la couverture de code sur des modules spécifiques
# Usage: ./scripts/run_coverage.sh [module] [options]

set -e

# Couleurs pour l'affichage
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Fonction d'aide
show_help() {
    cat << EOF
Usage: ./scripts/run_coverage.sh [module] [options]

Modules disponibles:
  all               Exécuter tous les tests avec couverture
  sdk               SDK chatkit-python uniquement
  backend           Backend complet
  auth              Modules d'authentification et sécurité
  workflows         Modules de workflows
  chatkit           Services ChatKit
  telephony         Modules de téléphonie
  lti               Modules LTI
  database          Modules de base de données

Options:
  --html            Générer uniquement le rapport HTML
  --xml             Générer uniquement le rapport XML
  --term            Afficher uniquement dans le terminal (défaut)
  --fail-under N    Échouer si la couverture est inférieure à N% (défaut: 80)
  -h, --help        Afficher cette aide

Exemples:
  ./scripts/run_coverage.sh sdk
  ./scripts/run_coverage.sh auth --html
  ./scripts/run_coverage.sh workflows --fail-under 85
  ./scripts/run_coverage.sh all
EOF
}

# Valeurs par défaut
MODULE="all"
REPORT_TYPE="term-missing"
FAIL_UNDER=80
GENERATE_HTML=false
GENERATE_XML=false

# Parser les arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --html)
            GENERATE_HTML=true
            shift
            ;;
        --xml)
            GENERATE_XML=true
            shift
            ;;
        --term)
            REPORT_TYPE="term-missing"
            shift
            ;;
        --fail-under)
            FAIL_UNDER="$2"
            shift 2
            ;;
        all|sdk|backend|auth|workflows|chatkit|telephony|lti|database)
            MODULE="$1"
            shift
            ;;
        *)
            echo -e "${RED}Argument inconnu: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Construire les options de rapport
REPORT_OPTS="--cov-report=${REPORT_TYPE}"
if [ "$GENERATE_HTML" = true ]; then
    REPORT_OPTS="${REPORT_OPTS} --cov-report=html"
fi
if [ "$GENERATE_XML" = true ]; then
    REPORT_OPTS="${REPORT_OPTS} --cov-report=xml"
fi

# Fonction pour exécuter les tests du SDK
run_sdk_coverage() {
    echo -e "${GREEN}=== Exécution de la couverture pour le SDK chatkit-python ===${NC}"
    cd chatkit-python
    PYTHONPATH=. python -m pytest \
        --cov=chatkit \
        ${REPORT_OPTS} \
        --cov-fail-under=${FAIL_UNDER} \
        -v
    cd ..
}

# Fonction pour exécuter les tests du backend complet
run_backend_coverage() {
    echo -e "${GREEN}=== Exécution de la couverture pour le backend ===${NC}"
    cd backend
    python -m pytest \
        --cov=app \
        ${REPORT_OPTS} \
        --cov-fail-under=${FAIL_UNDER} \
        -v
    cd ..
}

# Fonction pour exécuter les tests d'authentification
run_auth_coverage() {
    echo -e "${GREEN}=== Exécution de la couverture pour Auth/Security ===${NC}"
    cd backend
    python -m pytest \
        --cov=app.security \
        --cov=app.routes.auth \
        ${REPORT_OPTS} \
        --cov-fail-under=${FAIL_UNDER} \
        app/tests/test_*auth*.py \
        -v
    cd ..
}

# Fonction pour exécuter les tests de workflows
run_workflows_coverage() {
    echo -e "${GREEN}=== Exécution de la couverture pour Workflows ===${NC}"
    cd backend
    python -m pytest \
        --cov=app.workflows \
        ${REPORT_OPTS} \
        --cov-fail-under=${FAIL_UNDER} \
        app/tests/test_workflow*.py \
        tests/test_workflow*.py \
        -v
    cd ..
}

# Fonction pour exécuter les tests ChatKit
run_chatkit_coverage() {
    echo -e "${GREEN}=== Exécution de la couverture pour ChatKit Services ===${NC}"
    cd backend
    python -m pytest \
        --cov=app.chatkit \
        --cov=app.chatkit_server \
        --cov=app.chatkit_realtime \
        --cov=app.chatkit_store \
        --cov=app.chatkit_sessions \
        ${REPORT_OPTS} \
        --cov-fail-under=${FAIL_UNDER} \
        app/tests/test_chatkit*.py \
        -v
    cd ..
}

# Fonction pour exécuter les tests de téléphonie
run_telephony_coverage() {
    echo -e "${GREEN}=== Exécution de la couverture pour Telephony ===${NC}"
    cd backend
    python -m pytest \
        --cov=app.telephony \
        ${REPORT_OPTS} \
        --cov-fail-under=${FAIL_UNDER} \
        app/tests/test_telephony*.py \
        app/tests/test_pjsua*.py \
        -v
    cd ..
}

# Fonction pour exécuter les tests LTI
run_lti_coverage() {
    echo -e "${GREEN}=== Exécution de la couverture pour LTI ===${NC}"
    cd backend
    python -m pytest \
        --cov=app.lti \
        ${REPORT_OPTS} \
        --cov-fail-under=${FAIL_UNDER} \
        app/tests/test_lti*.py \
        app/tests/test_routes_lti*.py \
        -v
    cd ..
}

# Fonction pour exécuter les tests de base de données
run_database_coverage() {
    echo -e "${GREEN}=== Exécution de la couverture pour Database ===${NC}"
    cd backend
    python -m pytest \
        --cov=app.database \
        --cov=app.models \
        ${REPORT_OPTS} \
        --cov-fail-under=${FAIL_UNDER} \
        app/tests/test_database*.py \
        -v
    cd ..
}

# Fonction pour exécuter tous les tests
run_all_coverage() {
    echo -e "${GREEN}=== Exécution de la couverture complète ===${NC}"
    run_sdk_coverage
    echo ""
    run_backend_coverage
}

# Exécuter le module sélectionné
case $MODULE in
    sdk)
        run_sdk_coverage
        ;;
    backend)
        run_backend_coverage
        ;;
    auth)
        run_auth_coverage
        ;;
    workflows)
        run_workflows_coverage
        ;;
    chatkit)
        run_chatkit_coverage
        ;;
    telephony)
        run_telephony_coverage
        ;;
    lti)
        run_lti_coverage
        ;;
    database)
        run_database_coverage
        ;;
    all)
        run_all_coverage
        ;;
esac

# Message de succès
echo ""
echo -e "${GREEN}✓ Couverture exécutée avec succès!${NC}"

if [ "$GENERATE_HTML" = true ]; then
    echo -e "${YELLOW}Rapport HTML généré dans htmlcov/index.html${NC}"
fi

if [ "$GENERATE_XML" = true ]; then
    echo -e "${YELLOW}Rapport XML généré dans coverage.xml${NC}"
fi
