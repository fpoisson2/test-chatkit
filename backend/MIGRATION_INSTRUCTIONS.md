# Instructions pour exécuter la migration 002_add_lti_chatkit_options.sql

La base de données doit être migrée pour ajouter les nouvelles colonnes LTI ChatKit options.

## Option 1 : Via le script Python (recommandé)

```bash
# Depuis le répertoire racine du projet
docker compose exec backend python run_migration.py
```

## Option 2 : Via psql directement

```bash
# Se connecter au conteneur de la base de données
docker compose exec db psql -U chatkit -d chatkit

# Puis exécuter dans psql:
\i /workspace/backend/migrations/002_add_lti_chatkit_options.sql
\q
```

Ou en une seule commande :

```bash
docker compose exec db psql -U chatkit -d chatkit -c "
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS lti_show_sidebar BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS lti_show_header BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS lti_enable_history BOOLEAN NOT NULL DEFAULT TRUE;
"
```

## Option 3 : Via un client PostgreSQL externe

Si vous avez accès au port PostgreSQL (5432) :

```bash
psql -h localhost -p 5432 -U chatkit -d chatkit -f backend/migrations/002_add_lti_chatkit_options.sql
```

(Mot de passe par défaut : `chatkit`)

## Vérification

Après avoir exécuté la migration, vérifiez que les colonnes ont été ajoutées :

```bash
docker compose exec db psql -U chatkit -d chatkit -c "\d workflows"
```

Vous devriez voir les nouvelles colonnes :
- lti_show_sidebar
- lti_show_header
- lti_enable_history
