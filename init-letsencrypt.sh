#!/bin/bash

# Script d'initialisation pour Let's Encrypt avec Docker Compose
# Ce script génère les certificats SSL initiaux pour votre domaine

set -e

# Configuration
domains=(chatkit.ve2fpd.com)
rsa_key_size=4096
data_path="./certbot"
email="" # Ajoutez votre email ici (optionnel mais recommandé)
staging=0 # Set to 1 if you're testing your setup to avoid hitting request limits

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Initialisation de Let's Encrypt ===${NC}"

# Vérifier si Docker Compose est installé
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Erreur: docker-compose n'est pas installé${NC}"
    exit 1
fi

# Créer les répertoires nécessaires
echo -e "${YELLOW}Création des répertoires...${NC}"
mkdir -p "$data_path/www"
mkdir -p "$data_path/conf/live/$domains"

# Télécharger les paramètres TLS recommandés si nécessaire
if [ ! -e "$data_path/conf/options-ssl-nginx.conf" ] || [ ! -e "$data_path/conf/ssl-dhparams.pem" ]; then
  echo -e "${YELLOW}Téléchargement des paramètres TLS recommandés...${NC}"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$data_path/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$data_path/conf/ssl-dhparams.pem"
  echo
fi

# Créer un certificat auto-signé temporaire
if [ ! -d "$data_path/conf/live/$domains" ]; then
  echo -e "${YELLOW}Création d'un certificat auto-signé temporaire pour $domains...${NC}"
  path="/etc/letsencrypt/live/$domains"
  mkdir -p "$data_path/conf/live/$domains"
  docker-compose run --rm --entrypoint "\
    openssl req -x509 -nodes -newkey rsa:$rsa_key_size -days 1\
      -keyout '$path/privkey.pem' \
      -out '$path/fullchain.pem' \
      -subj '/CN=localhost'" certbot
  echo
fi

# Démarrer Nginx
echo -e "${YELLOW}Démarrage de Nginx...${NC}"
docker-compose up -d nginx

# Supprimer le certificat temporaire
echo -e "${YELLOW}Suppression du certificat temporaire...${NC}"
docker-compose run --rm --entrypoint "\
  rm -Rf /etc/letsencrypt/live/$domains && \
  rm -Rf /etc/letsencrypt/archive/$domains && \
  rm -Rf /etc/letsencrypt/renewal/$domains.conf" certbot
echo

# Demander un vrai certificat
echo -e "${YELLOW}Demande d'un certificat SSL pour $domains...${NC}"

# Construire les arguments pour certbot
domain_args=""
for domain in "${domains[@]}"; do
  domain_args="$domain_args -d $domain"
done

# Choisir entre staging et production
case "$staging" in
  1) staging_arg="--staging" ;;
  *) staging_arg="" ;;
esac

# Construire l'argument email
email_arg=""
if [ -n "$email" ]; then
  email_arg="--email $email"
else
  email_arg="--register-unsafely-without-email"
fi

# Demander le certificat
docker-compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $staging_arg \
    $email_arg \
    $domain_args \
    --rsa-key-size $rsa_key_size \
    --agree-tos \
    --force-renewal" certbot

# Recharger Nginx
echo -e "${YELLOW}Rechargement de Nginx...${NC}"
docker-compose exec nginx nginx -s reload

echo -e "${GREEN}=== Configuration terminée avec succès! ===${NC}"
echo -e "${GREEN}Vos certificats SSL ont été générés et Nginx est configuré.${NC}"
echo -e "${YELLOW}Note: Les certificats seront automatiquement renouvelés par le conteneur certbot.${NC}"
