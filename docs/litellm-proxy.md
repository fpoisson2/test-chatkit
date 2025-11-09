# Utiliser LiteLLM comme passerelle LLM locale

Cette configuration permet d'agréger plusieurs fournisseurs (OpenAI, Anthropic, Mistral, etc.) derrière un proxy [LiteLLM](https://docs.litellm.ai/docs/proxy/quick_start) compatible avec les API OpenAI. Vous pouvez ensuite diriger ChatKit vers ce proxy via `MODEL_PROVIDER=litellm`.

## 1. Démarrer le service LiteLLM

1. Ajoutez vos clés d'API fournisseurs dans votre `.env` (ex. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`). Pour les
   fournisseurs qui nécessitent une URL spécifique, vous pouvez également exposer des surcharges comme `MISTRAL_API_BASE=https://api.mistral.ai/v1`.
   Profitez-en pour définir `DATABASE_URL` si ce n'est pas déjà fait (PostgreSQL via Docker ou un DSN SQLite local) car le backend refusera de démarrer sans cette variable.
   Si vous prévoyez d'activer la persistance LiteLLM, ajoutez également un DSN séparé `LITELLM_DATABASE_URL`. Par défaut le stack
   `docker-compose` fournit déjà `postgresql://litellm:litellm@localhost:5433/litellm` via le service `litellm-db`, ce qui évite
   de partager un DSN SQLAlchemy (`postgresql+psycopg://…`) que LiteLLM/Prisma ne sait pas interpréter. Ajustez cette valeur si
   vous déployez LiteLLM sur une autre base.
2. Définissez les variables spécifiques au proxy :
   ```bash
   MODEL_PROVIDER=litellm
   LITELLM_PORT=4000
   LITELLM_API_BASE=http://127.0.0.1:4000
   LITELLM_API_KEY=sk-litellm-proxy   # utilisée par le backend/celery pour appeler le proxy
   LITELLM_MASTER_KEY=sk-litellm-proxy # master key LiteLLM (identique à LITELLM_API_KEY par simplicité)
   LITELLM_SALT_KEY=sk-xxxxxxxx        # clé de chiffrement LiteLLM — ne plus la modifier ensuite
   LITELLM_DATABASE_URL=postgresql://user:pass@host:5432/db # requis si STORE_MODEL_IN_DB=True (Prisma attend postgresql:// ou postgres://)
   STORE_MODEL_IN_DB=True              # optionnel : persiste les modèles LiteLLM (nécessite LITELLM_DATABASE_URL + LITELLM_SALT_KEY)
   PORT=4000                          # utile sur Render/Railway qui imposent la variable PORT
   # Variables optionnelles si vous utilisez la base fournie par docker-compose
   # LITELLM_DB_PORT=5433
   # LITELLM_POSTGRES_DB=litellm
   # LITELLM_POSTGRES_USER=litellm
   # LITELLM_POSTGRES_PASSWORD=litellm
   ```
   Laissez `STORE_MODEL_IN_DB` **non défini** (ou supprimez-le complètement) si vous ne souhaitez pas stocker de modèles dans la
   base : LiteLLM considère toute valeur présente — même "false" — comme une activation explicite.
3. Lancez d'abord la base dédiée puis le proxy pour vérifier qu'ils démarrent correctement (les images containers utilisées dans `docker-compose.yml` sont [`postgres:16-alpine`](https://hub.docker.com/_/postgres) et [`ghcr.io/berriai/litellm:main-latest`](https://ghcr.io/berriai/litellm/litellm) ; assurez-vous d'être authentifié sur le registre GitHub Container Registry si votre environnement l'exige) :
   ```bash
   docker compose up litellm-db litellm
   ```
   Le service `litellm-db` expose Postgres sur `localhost:5433` avec un utilisateur/mot de passe `litellm` par défaut. Le service `litellm`
   charge ensuite `docker/litellm/config.yaml` (chaque modèle y mentionne explicitement son fournisseur, par exemple `mistral/mistral-large-latest` pour aider LiteLLM à router correctement), applique la configuration générale (`general_settings.master_key`, `salt_key`, `database_url`, etc.) et expose une API OpenAI-compatible à l'adresse `http://127.0.0.1:4000`.

## 2. Connecter le backend et les workers

Lorsque `MODEL_PROVIDER=litellm` est présent dans votre `.env`, les services `backend` et `celery-worker` utilisent automatiquement `http://127.0.0.1:${LITELLM_PORT}` comme point d'accès par défaut et transmettent `LITELLM_API_KEY` lors des appels (pensez à aligner sa valeur sur `LITELLM_MASTER_KEY`).

Pour lancer l'ensemble de la pile :
```bash
docker compose up backend celery-worker
```

## 3. Vérifier la configuration

Le script d'audit d'environnement remontera les éventuelles variables manquantes avant de lancer l'application :
```bash
node scripts/check-env.js
```

Assurez-vous qu'il détecte bien vos clés fournisseur (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.), la clé partagée du proxy (`LITELLM_API_KEY`), la master key chiffrée (`LITELLM_MASTER_KEY`), la clé de sel (`LITELLM_SALT_KEY`) ainsi que la connexion base de données (`DATABASE_URL`).

Une fois ces vérifications effectuées, ChatKit peut router ses requêtes via LiteLLM pour sélectionner dynamiquement le modèle le plus adapté parmi les fournisseurs configurés.
