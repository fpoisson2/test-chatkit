# Configuration Nginx et HTTPS

Ce guide explique comment utiliser Nginx avec HTTPS dans votre environnement Docker.

## Structure des fichiers

```
├── nginx/
│   ├── nginx.conf                    # Configuration principale de Nginx
│   └── conf.d/
│       └── chatkit.ve2fpd.com.conf  # Configuration du site
├── certbot/
│   ├── www/                          # Répertoire pour le challenge ACME
│   └── conf/                         # Certificats SSL
├── docker-compose.yml                # Configuration Docker mise à jour
└── init-letsencrypt.sh              # Script d'initialisation SSL
```

## Prérequis

1. Docker et Docker Compose installés
2. Le domaine `chatkit.ve2fpd.com` doit pointer vers votre serveur (192.168.1.116)
3. Les ports 80 et 443 doivent être ouverts et accessibles depuis Internet

## Installation

### Première utilisation - Obtenir les certificats SSL

1. **Modifier l'email dans le script** (optionnel mais recommandé):
   ```bash
   nano init-letsencrypt.sh
   # Changez la ligne: email=""
   # En: email="votre@email.com"
   ```

2. **Exécuter le script d'initialisation**:
   ```bash
   ./init-letsencrypt.sh
   ```

   Ce script va:
   - Créer les répertoires nécessaires
   - Télécharger les paramètres TLS recommandés
   - Créer un certificat temporaire auto-signé
   - Démarrer Nginx
   - Demander un certificat SSL valide à Let's Encrypt
   - Recharger Nginx avec le vrai certificat

### Démarrage normal (certificats déjà configurés)

```bash
docker-compose up -d
```

## Configuration

### Nginx

La configuration Nginx est dans `nginx/conf.d/chatkit.ve2fpd.com.conf`:

- **Port 80 (HTTP)**:
  - Gère le challenge ACME pour Let's Encrypt
  - Redirige tout le trafic vers HTTPS (sauf si venant de Cloudflare Tunnel)

- **Port 443 (HTTPS)**:
  - Proxie `/api/` vers le backend (localhost:8000)
  - Proxie `/` vers le frontend (localhost:5183)
  - Gère les WebSockets pour HMR (Hot Module Replacement)

### Renouvellement automatique

Le conteneur `certbot` est configuré pour renouveler automatiquement les certificats tous les 12 heures. Aucune action manuelle n'est requise.

## Commandes utiles

### Vérifier les logs Nginx
```bash
docker-compose logs -f nginx
```

### Recharger Nginx après modification de config
```bash
docker-compose exec nginx nginx -s reload
```

### Renouveler manuellement les certificats
```bash
docker-compose run --rm certbot renew
docker-compose exec nginx nginx -s reload
```

### Vérifier la validité des certificats
```bash
docker-compose run --rm certbot certificates
```

### Tester la configuration Nginx
```bash
docker-compose exec nginx nginx -t
```

## Résolution des problèmes

### Les certificats ne se génèrent pas

1. Vérifiez que le domaine pointe bien vers votre serveur:
   ```bash
   nslookup chatkit.ve2fpd.com
   ```

2. Vérifiez que les ports 80 et 443 sont accessibles:
   ```bash
   sudo netstat -tulpn | grep -E ':(80|443)'
   ```

3. Consultez les logs de Certbot:
   ```bash
   docker-compose logs certbot
   ```

### Nginx ne démarre pas

1. Vérifiez la syntaxe de la configuration:
   ```bash
   docker-compose exec nginx nginx -t
   ```

2. Consultez les logs:
   ```bash
   docker-compose logs nginx
   ```

### Erreur "Too many requests" de Let's Encrypt

Si vous testez fréquemment, utilisez le mode staging:
```bash
# Dans init-letsencrypt.sh, changez:
staging=1
```

## Mode staging pour tests

Pour éviter de dépasser les limites de rate limiting de Let's Encrypt pendant les tests:

1. Éditez `init-letsencrypt.sh` et changez `staging=0` en `staging=1`
2. Exécutez le script
3. Une fois que tout fonctionne, remettez `staging=0` et réexécutez le script

## Intégration avec Cloudflare Tunnel

La configuration HTTP inclut une logique anti-boucle pour détecter le trafic provenant du Cloudflare Tunnel:

```nginx
if ($http_x_forwarded_proto != 'https') {
    return 301 https://$host$request_uri;
}
```

Cela permet:
- Le trafic du tunnel Cloudflare (qui passe par HTTP avec header X-Forwarded-Proto: https) d'être traité normalement
- Le trafic HTTP direct d'être redirigé vers HTTPS

## Notes de sécurité

- Les certificats SSL sont stockés dans `certbot/conf/` - ne commitez jamais ce répertoire dans Git
- Le fichier `.gitignore` devrait inclure `certbot/conf/`
- Les certificats sont renouvelés automatiquement avant expiration (90 jours pour Let's Encrypt)
