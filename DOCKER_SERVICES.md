# Services Docker ChatKit

Ce document décrit les services disponibles dans le docker-compose.

## Services

### Backend (FastAPI)
- **Port** : 8000
- **Description** : API backend FastAPI
- **Dépendances** : PostgreSQL, Redis

### Frontend (Vite)
- **Port** : 5183 (configurable via `VITE_PORT`)
- **Description** : Interface utilisateur React
- **Dépendances** : Backend

### Database (PostgreSQL + pgvector)
- **Port** : 5432
- **Description** : Base de données principale avec support des vecteurs
- **Données** : Persistées dans le volume `postgres-data`

### Redis
- **Port** : 6379
- **Description** : Cache et broker pour Celery
- **Données** : Persistées dans le volume `redis-data`

### Celery Worker
- **Description** : Worker pour les tâches asynchrones (génération de langues, etc.)
- **Dépendances** : PostgreSQL, Redis

### LiteLLM Proxy ⭐ NOUVEAU
- **Port** : 4000
- **Description** : Proxy unifié pour accéder à 100+ modèles AI via une interface OpenAI
- **Configuration** : `litellm_config.yaml`
- **Documentation** : [LITELLM_PROXY_SETUP.md](./LITELLM_PROXY_SETUP.md)

## Démarrage

### Démarrer tous les services

```bash
docker-compose up -d
```

### Démarrer des services spécifiques

```bash
# Backend + dépendances
docker-compose up -d backend

# Frontend uniquement
docker-compose up -d frontend

# LiteLLM proxy uniquement
docker-compose up -d litellm
```

### Arrêter les services

```bash
# Tous
docker-compose down

# Sans supprimer les volumes
docker-compose stop

# Un service spécifique
docker-compose stop litellm
```

## Logs

```bash
# Tous les services
docker-compose logs -f

# Service spécifique
docker-compose logs -f backend
docker-compose logs -f litellm

# Dernières 100 lignes
docker-compose logs --tail=100 litellm
```

## Configuration LiteLLM Proxy

Le service LiteLLM Proxy permet d'utiliser plusieurs providers AI (OpenAI, Anthropic, Groq, etc.) via une interface unifiée.

### Configuration rapide

1. **Copier le fichier .env** :
   ```bash
   cp .env.example .env
   ```

2. **Ajouter vos clés API** :
   ```bash
   # Dans .env
   LITELLM_MASTER_KEY="sk-litellm-master-key-changeme"
   OPENAI_API_KEY="sk-your-openai-key"
   # ANTHROPIC_API_KEY="sk-ant-..."
   # GROQ_API_KEY="gsk_..."
   ```

3. **Démarrer le proxy** :
   ```bash
   docker-compose up -d litellm
   ```

4. **Vérifier** :
   ```bash
   curl http://localhost:4000/health
   ```

5. **Configurer dans ChatKit** :
   - Interface admin → Providers
   - Provider Slug: `litellm`
   - API Base: `http://localhost:4000`
   - API Key: Valeur de `LITELLM_MASTER_KEY`

### Documentation complète

Consultez [LITELLM_PROXY_SETUP.md](./LITELLM_PROXY_SETUP.md) pour :
- Configuration détaillée
- Ajout de nouveaux providers
- Sécurité et monitoring
- Dépannage

## Volumes

Les données persistantes sont stockées dans des volumes Docker :

- `postgres-data` : Base de données PostgreSQL
- `redis-data` : Données Redis
- `frontend-node_modules` : Dépendances npm du frontend

### Gestion des volumes

```bash
# Lister les volumes
docker volume ls

# Supprimer un volume (ATTENTION : perte de données)
docker volume rm test-chatkit_postgres-data

# Supprimer tous les volumes non utilisés
docker volume prune
```

## Réseau

Tous les services utilisent `network_mode: host` pour simplifier la communication entre les services. Cela signifie que les services sont accessibles directement sur les ports de l'hôte.

### Ports utilisés

| Service | Port | Description |
|---------|------|-------------|
| Backend | 8000 | API FastAPI |
| Frontend | 5183 | Interface Vite |
| PostgreSQL | 5432 | Base de données |
| Redis | 6379 | Cache et broker |
| **LiteLLM** | **4000** | **Proxy AI** |

## Mise à jour

### Mettre à jour les images

```bash
# Télécharger les dernières images
docker-compose pull

# Recréer les services avec les nouvelles images
docker-compose up -d --build
```

### Mettre à jour le proxy LiteLLM

```bash
# Télécharger la dernière version
docker-compose pull litellm

# Redémarrer avec la nouvelle image
docker-compose up -d litellm
```

## Dépannage

### Le service ne démarre pas

```bash
# Vérifier les logs
docker-compose logs <service-name>

# Exemple
docker-compose logs backend
docker-compose logs litellm
```

### Recréer un service

```bash
# Arrêter et supprimer
docker-compose rm -f <service-name>

# Recréer
docker-compose up -d <service-name>

# Exemple
docker-compose rm -f litellm
docker-compose up -d litellm
```

### Réinitialiser complètement

⚠️ **ATTENTION** : Supprime toutes les données !

```bash
# Arrêter tous les services
docker-compose down

# Supprimer les volumes
docker-compose down -v

# Redémarrer
docker-compose up -d
```

## Variables d'environnement

Les variables sont configurées dans le fichier `.env` à la racine du projet.

Consultez `.env.example` pour la liste complète des variables disponibles.

### Variables importantes

| Variable | Description | Défaut |
|----------|-------------|--------|
| `OPENAI_API_KEY` | Clé API OpenAI | - |
| `LITELLM_MASTER_KEY` | Clé master du proxy LiteLLM | `sk-litellm-master-key-changeme` |
| `DATABASE_URL` | URL de connexion PostgreSQL | `postgresql+psycopg://chatkit:chatkit@localhost:5432/chatkit` |
| `VITE_PORT` | Port du frontend | `5183` |

## Références

- [Guide de démarrage ChatKit](./README.md)
- [Configuration LiteLLM Proxy](./LITELLM_PROXY_SETUP.md)
- [Guide d'utilisation LiteLLM](./backend/examples/LITELLM_GUIDE.md)
- [Migration des workflows](./backend/examples/WORKFLOW_LITELLM_MIGRATION.md)
