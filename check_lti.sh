#!/bin/bash
# Script pour vérifier la configuration LTI

echo "=== Configuration LTI actuelle ==="
docker compose exec db psql -U postgres -d chatkit -c "
SELECT
    id,
    issuer,
    client_id,
    authorization_endpoint,
    token_endpoint,
    key_set_url
FROM lti_registration
WHERE issuer = 'https://climoilou.moodle.decclic.qc.ca';
"

echo ""
echo "=== Test de l'endpoint authorization_endpoint ==="
echo "Vérification si l'URL retourne 404..."

# Récupérer l'authorization_endpoint de la DB
AUTH_ENDPOINT=$(docker compose exec db psql -U postgres -d chatkit -t -c "SELECT authorization_endpoint FROM lti_registration WHERE issuer = 'https://climoilou.moodle.decclic.qc.ca' LIMIT 1;" | tr -d ' \r')

if [ -n "$AUTH_ENDPOINT" ]; then
    echo "Authorization endpoint configuré: $AUTH_ENDPOINT"
    echo "Test HTTP:"
    curl -I "$AUTH_ENDPOINT" 2>&1 | head -n 5
else
    echo "Aucune registration trouvée pour cet issuer"
fi

echo ""
echo "=== URLs attendues pour Moodle LTI 1.3 ==="
echo "Authorization: https://climoilou.moodle.decclic.qc.ca/mod/lti/auth.php"
echo "Token:         https://climoilou.moodle.decclic.qc.ca/mod/lti/token.php"
echo "JWKS:          https://climoilou.moodle.decclic.qc.ca/mod/lti/certs.php"
