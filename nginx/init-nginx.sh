#!/bin/sh

# Script d'initialisation pour Nginx
# Crée un certificat auto-signé temporaire si nécessaire pour permettre à Nginx de démarrer

set -e

# Validation des variables d'environnement requises
if [ -z "$DOMAIN_NAME" ]; then
    echo "❌ Erreur: La variable DOMAIN_NAME n'est pas définie"
    exit 1
fi

CERT_PATH="/etc/letsencrypt/live/$DOMAIN_NAME"
RSA_KEY_SIZE=4096

echo "📝 Génération de la configuration Nginx à partir du template..."

# Générer la configuration à partir du template
export DOMAIN_NAME
envsubst '${DOMAIN_NAME}' < /etc/nginx/conf.d/site.conf.template > /etc/nginx/conf.d/site.conf

echo "✅ Configuration Nginx générée"

echo "🔍 Vérification de l'existence des certificats pour $DOMAIN_NAME..."

# Vérifier si les certificats existent déjà
if [ -f "$CERT_PATH/fullchain.pem" ] && [ -f "$CERT_PATH/privkey.pem" ]; then
    echo "✅ Certificats SSL trouvés"
else
    echo "⚠️  Aucun certificat trouvé, création d'un certificat auto-signé temporaire..."

    # Créer le répertoire si nécessaire
    mkdir -p "$CERT_PATH"

    # Créer un certificat auto-signé temporaire
    openssl req -x509 -nodes -newkey "rsa:$RSA_KEY_SIZE" -days 1 \
        -keyout "$CERT_PATH/privkey.pem" \
        -out "$CERT_PATH/fullchain.pem" \
        -subj "/CN=$DOMAIN_NAME" \
        2>/dev/null

    echo "✅ Certificat temporaire créé"
    echo "ℹ️  Certbot va remplacer ce certificat par un vrai certificat Let's Encrypt"
fi

# Démarrer Nginx
echo "🚀 Démarrage de Nginx..."
exec nginx -g 'daemon off;'
