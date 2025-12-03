# Configuration Nginx et Docker

Configuration Docker avec Nginx comme reverse proxy HTTP pour edxo/ChatKit.

## Architecture réseau

Tous les services communiquent via un réseau Docker interne (`app-network`). **Seul Nginx expose le port 80 à l'extérieur.**

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ :80 (exposé)
       ▼
┌─────────────────────────────────┐
│  Nginx (nginx:alpine)           │
│  • Reverse proxy HTTP           │
│  • WebSocket support            │
└──────┬──────────────────────────┘
       │ Réseau interne app-network
       │
       ├─► backend:8000 (non exposé)
       ├─► frontend:5183 (non exposé)
       ├─► db:5432 (non exposé)
       └─► redis:6380 (non exposé)
```

## Structure

```
├── nginx/
│   ├── nginx.conf                    # Configuration principale de Nginx
│   └── conf.d/
│       └── site.conf                 # Configuration du site
└── docker-compose.yml                # Configuration Docker
```

## Configuration

### Variables d'environnement importantes

Dans votre fichier `.env`, utilisez les **noms de services Docker** au lieu de localhost:

```bash
# Base de données - Utiliser le nom du service "db"
DATABASE_URL="postgresql://chatkit:password@db:5432/chatkit"

# Redis - Utiliser le nom du service "redis"
CELERY_BROKER_URL="redis://redis:6380/0"

# Les autres services communiquent via les noms Docker
# backend, frontend, nginx sont accessibles par leur nom de service
```

### Démarrage

```bash
docker-compose up -d
```

### Routes

Nginx proxie les requêtes comme suit:

- **`/api/*`** → Backend (backend:8000)
- **`/*`** → Frontend (frontend:5183)

### Support WebSocket

La configuration inclut le support pour WebSocket (utilisé par Vite HMR):

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
```

## Sécurité réseau

### Ports exposés

Seul le port 80 de Nginx est exposé à l'extérieur:

```yaml
nginx:
  ports:
    - "80:80"  # Seul port exposé
```

### Services internes

Tous les autres services sont **uniquement accessibles via le réseau Docker interne**:

- `backend:8000` - API FastAPI
- `frontend:5183` - Frontend Vite
- `db:5432` - PostgreSQL
- `redis:6380` - Redis

Ces services ne sont **pas accessibles** depuis l'extérieur du Docker.

## Commandes utiles

### Vérifier les logs

```bash
# Logs Nginx
docker-compose logs -f nginx

# Logs backend
docker-compose logs -f backend

# Tous les logs
docker-compose logs -f
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

## Accès

Une fois démarré, l'application est accessible sur:

- **http://localhost** (port 80)

Nginx redirige automatiquement:
- Les requêtes vers `/api/*` au backend
- Toutes les autres requêtes au frontend

## Dépannage

### Erreur de connexion à la base de données

Si vous avez une erreur de connexion, vérifiez que `DATABASE_URL` utilise le nom du service Docker:

```bash
# ❌ Incorrect (localhost ne fonctionne pas dans Docker)
DATABASE_URL="postgresql://chatkit:password@localhost:5432/chatkit"

# ✅ Correct (utiliser le nom du service)
DATABASE_URL="postgresql://chatkit:password@db:5432/chatkit"
```

### Erreur de connexion à Redis

Même principe pour Redis:

```bash
# ❌ Incorrect
CELERY_BROKER_URL="redis://localhost:6380/0"

# ✅ Correct
CELERY_BROKER_URL="redis://redis:6380/0"
```
