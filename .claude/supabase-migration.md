# Migration vers Supabase PostgreSQL

Ce guide décrit comment migrer la base de données locale PostgreSQL vers Supabase pour une architecture stateless.

## Prérequis

- Compte Supabase (gratuit ou payant)
- Accès à la base de données locale
- `psql` et `pg_dump` installés localement

## Étape 1: Créer le projet Supabase

1. Aller sur [supabase.com](https://supabase.com)
2. Créer un nouveau projet
3. Noter:
   - **Project Reference**: visible dans l'URL (`https://supabase.com/dashboard/project/[PROJECT-REF]`)
   - **Database Password**: défini lors de la création
   - **Region**: choisir la plus proche de vos utilisateurs

## Étape 2: Activer pgVector

Dans **Supabase Dashboard → SQL Editor**, exécuter:

```sql
-- Activer l'extension pgVector (requis pour les embeddings)
CREATE EXTENSION IF NOT EXISTS vector;

-- Vérifier
SELECT * FROM pg_extension WHERE extname = 'vector';
```

## Étape 3: Obtenir les URLs de connexion

Aller dans **Project Settings → Database** pour obtenir:

### Connection Strings

| Type | Usage | Exemple |
|------|-------|---------|
| **Direct** | Migrations, scripts one-shot | `postgresql://postgres.[REF]:[PASS]@db.[REF].supabase.co:5432/postgres` |
| **Pooler (Transaction)** | Application stateless | `postgresql://postgres.[REF]:[PASS]@[REGION].pooler.supabase.co:6543/postgres` |

> **Important**: Pour une application stateless, utiliser le **Pooler en mode Transaction**.

## Étape 4: Migrer les données

### Option A: Script automatique

```bash
# Définir les variables
export LOCAL_DATABASE_URL="postgresql://chatkit:password@localhost:5432/chatkit"
export SUPABASE_DATABASE_URL="postgresql://postgres.[REF]:[PASS]@db.[REF].supabase.co:5432/postgres"

# Lancer la migration
./scripts/migrate_to_supabase.sh
```

### Option B: Migration manuelle

```bash
# 1. Exporter la base locale
pg_dump "$LOCAL_DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  > backup.sql

# 2. Importer dans Supabase (utiliser l'URL DIRECT, pas le pooler)
psql "$SUPABASE_DATABASE_URL" < backup.sql
```

### Option C: Supabase CLI (recommandé pour les nouvelles installations)

```bash
# Installer Supabase CLI
npm install -g supabase

# Lier le projet
supabase link --project-ref [PROJECT-REF]

# Créer une migration depuis le schéma existant
supabase db pull

# Pousser les migrations
supabase db push
```

## Étape 5: Configurer l'application

### Variables d'environnement

Ajouter dans `.env`:

```bash
# Supabase PostgreSQL (utiliser l'URL POOLER pour l'application)
SUPABASE_DATABASE_URL=postgresql://postgres.[REF]:[PASS]@[REGION].pooler.supabase.co:6543/postgres?sslmode=require
DATABASE_USE_SUPABASE_POOLER=true
```

### Lancer avec Docker Compose

```bash
# Utiliser le fichier override pour Supabase
docker-compose -f docker-compose.yml -f docker-compose.supabase.yml up -d
```

Cela désactive le conteneur PostgreSQL local et configure l'application pour Supabase.

## Étape 6: Vérification

```bash
# Vérifier les logs
docker-compose logs -f backend

# Vous devriez voir:
# "Database configured for Supabase pooler (NullPool, no prepared statements)"
```

## Configuration technique

### Pourquoi NullPool?

Supabase utilise PgBouncer en mode transaction. Pour éviter les conflits:

1. **NullPool**: Pas de pooling côté application (Supabase gère le pooling)
2. **prepare_threshold=None**: Désactive les prepared statements (incompatibles avec pgbouncer transaction mode)

### Limites du plan gratuit Supabase

| Ressource | Limite |
|-----------|--------|
| Database size | 500 MB |
| Bandwidth | 2 GB/mois |
| Connections (pooler) | 60 max |
| Pause après inactivité | 7 jours |

Pour la production, considérer le plan Pro ($25/mois).

## Rollback

Pour revenir à PostgreSQL local:

```bash
# Simplement utiliser docker-compose sans l'override
docker-compose up -d
```

## Troubleshooting

### Erreur "prepared statement already exists"

Vérifier que `DATABASE_USE_SUPABASE_POOLER=true` est défini.

### Connexion refusée

- Vérifier que l'IP est autorisée dans Supabase (Settings → Database → Network)
- Utiliser `?sslmode=require` dans l'URL

### Extension vector non trouvée

Exécuter dans SQL Editor:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Performance lente

- Vérifier la région Supabase (doit être proche des serveurs)
- Considérer le plan Pro pour plus de ressources
- Vérifier les index (surtout `ix_json_chunks_embedding` pour pgVector)
