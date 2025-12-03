# Configuration Nginx et HTTPS

Configuration automatique de Nginx avec certificats SSL Let's Encrypt pour votre environnement Docker.

## Fonctionnalités

✅ **Configuration automatique** - Aucun script manuel à exécuter
✅ **Certificats SSL automatiques** - Let's Encrypt intégré
✅ **Renouvellement automatique** - Les certificats sont renouvelés tous les 12 heures
✅ **Configuration par variables d'environnement** - Changez simplement le domaine dans `.env`
✅ **Support Cloudflare Tunnel** - Détection automatique du trafic tunnel

## Structure des fichiers

```
├── nginx/
│   ├── nginx.conf                    # Configuration principale de Nginx
│   ├── conf.d/
│   │   └── site.conf.template       # Template de configuration (utilise ${DOMAIN_NAME})
│   ├── init-nginx.sh                # Script de démarrage Nginx
│   └── certbot-entrypoint.sh        # Script d'initialisation SSL
├── certbot/                          # Créé automatiquement
│   ├── www/                          # Répertoire pour le challenge ACME
│   └── conf/                         # Certificats SSL (git ignored)
├── docker-compose.yml                # Configuration Docker
└── .env                              # Variables d'environnement
```

## Configuration

### 1. Variables d'environnement

Configurez votre domaine dans le fichier `.env`:

```bash
# Nom de domaine pour l'application
DOMAIN_NAME="chatkit.ve2fpd.com"

# Email pour Let's Encrypt (recommandé)
SSL_EMAIL="votre@email.com"

# Mode staging pour les tests (true/false)
SSL_STAGING="false"
```

### 2. Prérequis

Avant de démarrer, assurez-vous que:

1. **Le domaine pointe vers votre serveur**
   ```bash
   nslookup chatkit.ve2fpd.com
   # Doit renvoyer l'IP de votre serveur (192.168.1.116)
   ```

2. **Les ports 80 et 443 sont accessibles**
   ```bash
   sudo netstat -tulpn | grep -E ':(80|443)'
   # Aucun autre service ne doit utiliser ces ports
   ```

### 3. Démarrage

```bash
docker-compose up -d
```

**C'est tout!** 🎉

Au premier démarrage:
1. Nginx démarre avec un certificat auto-signé temporaire
2. Certbot demande automatiquement un certificat Let's Encrypt valide
3. Les certificats sont installés
4. Nginx recharge sa configuration
5. Le renouvellement automatique est activé

## Fonctionnement

### Nginx

Le conteneur Nginx:
- Génère automatiquement sa configuration à partir du template
- Crée un certificat auto-signé temporaire si nécessaire
- Proxie le trafic vers backend et frontend

**Routes configurées:**
- `/api/*` → Backend (localhost:8000)
- `/*` → Frontend (localhost:5183)
- Support WebSocket pour Vite HMR

### Certbot

Le conteneur Certbot:
- Vérifie si un certificat existe au démarrage
- Si non: demande automatiquement un certificat à Let's Encrypt
- Si oui: lance le renouvellement automatique (toutes les 12h)

### Mode Staging

Pour éviter les limites de rate limiting pendant les tests:

```bash
# Dans .env
SSL_STAGING="true"
```

Les certificats en mode staging ne sont **pas valides** mais permettent de tester la configuration sans limites.

Une fois validé, remettez `SSL_STAGING="false"` et redémarrez:
```bash
docker-compose down
sudo rm -rf certbot/conf  # Supprimer les certificats de test
docker-compose up -d
```

## Cloudflare Tunnel

La configuration Nginx inclut une détection automatique du trafic Cloudflare Tunnel:

```nginx
if ($http_x_forwarded_proto != 'https') {
    return 301 https://$host$request_uri;
}
```

- Le trafic du tunnel Cloudflare (HTTP avec header `X-Forwarded-Proto: https`) est traité normalement
- Le trafic HTTP direct est redirigé vers HTTPS

## Commandes utiles

### Vérifier les logs

```bash
# Logs Nginx
docker-compose logs -f nginx

# Logs Certbot
docker-compose logs -f certbot

# Tous les logs
docker-compose logs -f
```

### Recharger Nginx

Après modification de la configuration:

```bash
# Régénérer la configuration et redémarrer
docker-compose restart nginx

# Ou juste recharger
docker-compose exec nginx nginx -s reload
```

### Vérifier les certificats

```bash
# Liste des certificats
docker-compose exec certbot certbot certificates

# Forcer le renouvellement
docker-compose exec certbot certbot renew --force-renewal
```

### Tester la configuration Nginx

```bash
docker-compose exec nginx nginx -t
```

## Résolution des problèmes

### Erreur: "Failed to obtain certificate"

**Causes possibles:**

1. **Le domaine ne pointe pas vers ce serveur**
   ```bash
   nslookup votre-domaine.com
   # Vérifiez que l'IP correspond
   ```

2. **Les ports ne sont pas accessibles**
   ```bash
   # Depuis une machine externe
   telnet votre-domaine.com 80
   telnet votre-domaine.com 443
   ```

3. **Un autre service utilise le port 80/443**
   ```bash
   sudo lsof -i :80
   sudo lsof -i :443
   ```

**Solution:** Activez le mode staging pour tester:
```bash
SSL_STAGING="true"  # Dans .env
docker-compose restart certbot
```

### Nginx ne démarre pas

```bash
# Vérifier la syntaxe
docker-compose exec nginx nginx -t

# Vérifier les logs
docker-compose logs nginx
```

### Le certificat n'est pas valide

Si vous utilisez `SSL_STAGING="true"`, les certificats ne sont **pas valides** en production.

Pour obtenir un vrai certificat:
```bash
# 1. Mettre à jour .env
SSL_STAGING="false"

# 2. Supprimer les certificats de test
docker-compose down
sudo rm -rf certbot/conf

# 3. Redémarrer
docker-compose up -d
```

### Erreur "Too many requests"

Let's Encrypt limite à 5 certificats par semaine par domaine.

**Solution:** Utilisez le mode staging pour les tests:
```bash
SSL_STAGING="true"
```

## Changer de domaine

Pour utiliser un nouveau domaine:

```bash
# 1. Modifier .env
DOMAIN_NAME="nouveau-domaine.com"

# 2. Supprimer les anciens certificats
docker-compose down
sudo rm -rf certbot/conf

# 3. Redémarrer
docker-compose up -d
```

## Sécurité

### Variables d'environnement sensibles

Les variables suivantes sont dans `.env` (git ignored):
- `SSL_EMAIL` - Votre email (pour les notifications Let's Encrypt)

### Certificats SSL

Les certificats sont stockés dans `certbot/conf/` (git ignored).

**Ne committez JAMAIS ce répertoire!**

## Architecture

```
┌─────────────┐
│   Internet  │
└──────┬──────┘
       │ :80, :443
       ▼
┌─────────────────────────────────┐
│  Nginx (nginx:alpine)           │
│  • Configuration dynamique      │
│  • Certificat auto-signé temp   │
│  • Reverse proxy                │
└──────┬──────────────────────────┘
       │
       ├─► /api/* → Backend :8000
       └─► /* → Frontend :5183

┌─────────────────────────────────┐
│  Certbot (certbot/certbot)      │
│  • Demande certificats SSL      │
│  • Renouvellement auto (12h)    │
└─────────────────────────────────┘
```

## Performance

- **Démarrage initial:** ~30 secondes
- **Génération certificat:** ~10-30 secondes
- **Renouvellement:** Transparent, sans downtime

## Références

- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Certbot Documentation](https://eff-certbot.readthedocs.io/)
