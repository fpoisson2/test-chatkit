# Configuration Nginx

Configuration simple de Nginx comme reverse proxy HTTP pour edxo/ChatKit.

## Structure

```
├── nginx/
│   ├── nginx.conf                    # Configuration principale de Nginx
│   └── conf.d/
│       └── site.conf                 # Configuration du site
└── docker-compose.yml                # Configuration Docker
```

## Configuration

Le service Nginx est configuré dans `docker-compose.yml` et démarre automatiquement avec:

```bash
docker-compose up -d
```

### Routes

Nginx proxie les requêtes comme suit:

- **`/api/*`** → Backend (localhost:8000)
- **`/*`** → Frontend (localhost:5183)

### Support WebSocket

La configuration inclut le support pour WebSocket (utilisé par Vite HMR):

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
```

## Commandes utiles

### Vérifier les logs

```bash
docker-compose logs -f nginx
```

### Recharger la configuration

Après modification de `nginx/conf.d/site.conf`:

```bash
docker-compose restart nginx
```

### Tester la configuration

```bash
docker-compose exec nginx nginx -t
```

## Personnalisation

Pour modifier le comportement de Nginx, éditez `nginx/conf.d/site.conf`:

- Changer le `server_name`
- Ajouter des locations
- Modifier les headers
- Ajuster les timeouts

Après modification:

```bash
docker-compose restart nginx
```

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ :80
       ▼
┌─────────────────────────────────┐
│  Nginx (nginx:alpine)           │
│  • Reverse proxy HTTP           │
│  • WebSocket support            │
└──────┬──────────────────────────┘
       │
       ├─► /api/* → Backend :8000
       └─► /* → Frontend :5183
```

## Accès

Une fois démarré, l'application est accessible sur:

- **http://localhost** (port 80)

Nginx redirige automatiquement:
- Les requêtes vers `/api/*` au backend
- Toutes les autres requêtes au frontend
