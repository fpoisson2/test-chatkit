#!/bin/sh

# Script d'entrypoint automatique pour Certbot
# Ce script vérifie si les certificats existent et les crée automatiquement si nécessaire

set -e

# Validation des variables d'environnement requises
if [ -z "$DOMAIN_NAME" ]; then
    echo "❌ Erreur: La variable DOMAIN_NAME n'est pas définie"
    exit 1
fi

# Configuration
CERT_PATH="/etc/letsencrypt/live/$DOMAIN_NAME"
RSA_KEY_SIZE=4096

echo "🔐 Vérification des certificats SSL pour $DOMAIN_NAME..."

# Vérifier si les certificats existent déjà
if [ -d "$CERT_PATH" ] && [ -f "$CERT_PATH/fullchain.pem" ] && [ -f "$CERT_PATH/privkey.pem" ]; then
    echo "✅ Certificats SSL trouvés pour $DOMAIN_NAME"
    echo "🔄 Démarrage du renouvellement automatique..."

    # Mode renouvellement automatique
    trap exit TERM
    while :; do
        certbot renew
        sleep 12h & wait ${!}
    done
else
    echo "⚠️  Aucun certificat trouvé pour $DOMAIN_NAME"
    echo "📝 Demande d'un nouveau certificat..."

    # Créer le répertoire si nécessaire
    mkdir -p "$CERT_PATH"

    # Construire les arguments pour Certbot
    CERTBOT_ARGS="certonly --webroot -w /var/www/certbot"
    CERTBOT_ARGS="$CERTBOT_ARGS -d $DOMAIN_NAME"
    CERTBOT_ARGS="$CERTBOT_ARGS --rsa-key-size $RSA_KEY_SIZE"
    CERTBOT_ARGS="$CERTBOT_ARGS --agree-tos"
    CERTBOT_ARGS="$CERTBOT_ARGS --non-interactive"

    # Ajouter l'email si fourni
    if [ -n "$SSL_EMAIL" ]; then
        CERTBOT_ARGS="$CERTBOT_ARGS --email $SSL_EMAIL"
    else
        CERTBOT_ARGS="$CERTBOT_ARGS --register-unsafely-without-email"
    fi

    # Mode staging si activé
    if [ "$SSL_STAGING" = "true" ]; then
        echo "⚠️  Mode STAGING activé (certificats de test)"
        CERTBOT_ARGS="$CERTBOT_ARGS --staging"
    fi

    # Demander le certificat
    echo "🚀 Exécution de Certbot avec les arguments: $CERTBOT_ARGS"
    if certbot $CERTBOT_ARGS; then
        echo "✅ Certificat SSL généré avec succès!"
        echo "🔄 Redémarrage de Nginx pour appliquer les certificats..."

        # Attendre un peu pour que Nginx soit prêt
        sleep 5

        # Essayer de recharger Nginx si docker est disponible
        if command -v docker >/dev/null 2>&1; then
            if docker exec nginx nginx -s reload 2>/dev/null; then
                echo "✅ Nginx rechargé avec succès"
            else
                echo "⚠️  Impossible de recharger Nginx (il se rechargera au prochain démarrage)"
            fi
        else
            echo "ℹ️  Docker CLI non disponible, Nginx se rechargera au prochain redémarrage"
        fi

        # Passer en mode renouvellement
        echo "🔄 Démarrage du renouvellement automatique..."
        trap exit TERM
        while :; do
            certbot renew
            sleep 12h & wait ${!}
        done
    else
        echo "❌ Échec de la génération du certificat"
        echo "ℹ️  Vérifiez que:"
        echo "   - Le domaine $DOMAIN_NAME pointe vers ce serveur"
        echo "   - Les ports 80 et 443 sont accessibles depuis Internet"
        echo "   - Nginx est démarré et répond sur le port 80"
        echo ""
        echo "💡 Vous pouvez activer le mode staging pour les tests:"
        echo "   SSL_STAGING=true dans le fichier .env"
        exit 1
    fi
fi
