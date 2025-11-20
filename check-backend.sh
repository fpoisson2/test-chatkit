#!/bin/bash
# Script de diagnostic pour vérifier l'état du backend

echo "=== Diagnostic Backend ChatKit ==="
echo ""

echo "1. Vérification que slowapi est installé..."
docker-compose exec -T backend pip show slowapi 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ slowapi est installé"
else
    echo "❌ slowapi N'EST PAS installé"
fi
echo ""

echo "2. Test de l'endpoint de login..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"wrong"}' 2>/dev/null)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Status HTTP: $HTTP_CODE"
echo "Réponse: $BODY"
echo ""

if [ "$HTTP_CODE" = "000" ]; then
    echo "❌ Le backend ne répond pas du tout!"
    echo ""
    echo "3. Vérification des logs backend..."
    docker-compose logs backend --tail 30
elif echo "$BODY" | grep -q '"detail"'; then
    echo "✅ Le backend répond avec le bon format"
else
    echo "⚠️  Le backend répond mais avec un format inattendu"
fi
