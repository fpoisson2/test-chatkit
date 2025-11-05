#!/bin/bash
# Exemple de test d'intégration complet

# Python avec PJSUA2 installé
PJSIP_PY="${PJSIP_PY:-/home/fpoisson/.pyenv/versions/pjsip311/bin/python}"

echo "==============================================="
echo "  Exemple de Test des Appels Entrants"
echo "==============================================="
echo ""
echo "Ce script montre comment tester les appels"
echo "entrants de manière automatisée."
echo ""

# 1. Vérifier que pjsua2 est installé
echo "1️⃣ Vérification de PJSUA2..."
if "$PJSIP_PY" -c "import pjsua2" 2>/dev/null; then
    echo "   ✅ PJSUA2 est installé (via $PJSIP_PY)"
else
    echo "   ❌ PJSUA2 n'est pas installé"
    echo "   Vérifiez \$PJSIP_PY: $PJSIP_PY"
    exit 1
fi

# 2. Vérifier la configuration
echo ""
echo "2️⃣ Vérification de la configuration..."
if [ -f "test_config.env" ]; then
    echo "   ✅ test_config.env trouvé"
    source test_config.env

    if [ -z "$SIP_URI" ] || [ -z "$SIP_USERNAME" ] || [ -z "$SIP_PASSWORD" ]; then
        echo "   ❌ Configuration incomplète dans test_config.env"
        exit 1
    fi

    echo "   ✅ Configuration valide"
    echo "      SIP URI: $SIP_URI"
else
    echo "   ❌ test_config.env non trouvé"
    echo "   Copiez test_config.example.env en test_config.env"
    exit 1
fi

# 3. Proposer les tests
echo ""
echo "3️⃣ Tests disponibles:"
echo ""
echo "   a) Test minimal (30 secondes)"
echo "   b) Test simple (60 secondes)"
echo "   c) Test avec Voice Bridge (OpenAI - 60 secondes)"
echo "   q) Quitter"
echo ""
read -p "Choisissez un test (a/b/c/q): " choice

case "$choice" in
    a)
        echo ""
        echo "🚀 Lancement du test minimal (30 secondes)..."
        echo ""
        timeout 30 ./test_incoming_calls_minimal.py "$SIP_URI" "$SIP_USERNAME" "$SIP_PASSWORD" || true
        ;;

    b)
        echo ""
        echo "🚀 Lancement du test simple (60 secondes)..."
        echo ""
        ./run_test.sh -d 60 simple
        ;;

    c)
        if [ -z "$OPENAI_API_KEY" ]; then
            echo ""
            echo "❌ OPENAI_API_KEY non défini dans test_config.env"
            exit 1
        fi

        echo ""
        echo "🚀 Lancement du test avec Voice Bridge (60 secondes)..."
        echo ""
        ./run_test.sh -d 60 bridge
        ;;

    q)
        echo "👋 Au revoir!"
        exit 0
        ;;

    *)
        echo "❌ Choix invalide"
        exit 1
        ;;
esac

echo ""
echo "==============================================="
echo "  Test terminé!"
echo "==============================================="
echo ""
echo "Pour relancer un test:"
echo "  ./run_test.sh minimal"
echo "  ./run_test.sh simple"
echo "  ./run_test.sh bridge"
