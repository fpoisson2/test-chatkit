# Utiliser LiteLLM comme passerelle LLM locale

Cette configuration permet d'agréger plusieurs fournisseurs (OpenAI, Anthropic, Mistral, etc.) derrière un proxy [LiteLLM](https://docs.litellm.ai/docs/proxy/quick_start) compatible avec les API OpenAI. Vous pouvez ensuite diriger ChatKit vers ce proxy via `MODEL_PROVIDER=litellm`.

## 1. Démarrer le service LiteLLM

1. Copiez `docker/litellm/.env.example` en `docker/litellm/.env` puis personnalisez ce nouveau fichier :
   ```bash
   cp docker/litellm/.env.example docker/litellm/.env
   ```
   Ce `.env` **ne remplace pas** celui de la racine : il ne sert qu'au proxy LiteLLM afin d'éviter que la stack n'interprète les variables de votre application principale.
   Ajoutez-y vos clés d'API fournisseurs (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, etc.) et, si nécessaire, les URL spécifiques (`MISTRAL_API_BASE=https://api.mistral.ai/v1`).
   Si vous prévoyez d'activer la persistance LiteLLM, conservez ou ajustez le DSN Postgres fourni (`DATABASE_URL=postgresql://postgres:postgres@litellmdb:5432/litellm`) afin qu'il reste au format PostgreSQL natif (`postgresql://` ou `postgres://`).
   Vous pouvez également définir `LITELLM_DATABASE_URL` pour différencier la valeur injectée dans le conteneur (l'entrypoint du service forcera toujours une URL `postgresql://` en dernier recours afin d'éviter les erreurs Prisma lorsque le `.env` racine contient un DSN SQLAlchemy tel que `postgresql+psycopg://`).
2. Définissez les variables spécifiques au proxy :
   ```bash
   MODEL_PROVIDER=litellm
   LITELLM_PORT=4000
   LITELLM_API_BASE=http://127.0.0.1:4000
   LITELLM_API_KEY=sk-litellm-proxy   # utilisée par le backend/celery pour appeler le proxy
   LITELLM_MASTER_KEY=sk-litellm-proxy # master key LiteLLM (identique à LITELLM_API_KEY par simplicité)
   LITELLM_SALT_KEY=sk-xxxxxxxx        # clé de chiffrement LiteLLM — ne plus la modifier ensuite
   DATABASE_URL=postgresql://user:pass@host:5432/db # requis si STORE_MODEL_IN_DB=True (Prisma attend postgresql:// ou postgres://)
   # LITELLM_DATABASE_URL=postgresql://user:pass@host:5432/autre_db # optionnel : surchargera la valeur passée à Prisma
   STORE_MODEL_IN_DB=True              # optionnel : persiste les modèles LiteLLM (nécessite DATABASE_URL + LITELLM_SALT_KEY)
   PORT=4000                          # utile sur Render/Railway qui imposent la variable PORT
    # Variables optionnelles si vous utilisez la base fournie par docker-compose
    # (valeurs par défaut : postgresql://postgres:postgres@litellmdb:5432/litellm)
    # LITELLM_DB_PORT=5433
    # LITELLM_POSTGRES_DB=litellm
    # LITELLM_POSTGRES_USER=postgres
    # LITELLM_POSTGRES_PASSWORD=postgres
   ```
   Laissez `STORE_MODEL_IN_DB` **non défini** (ou supprimez-le complètement) si vous ne souhaitez pas stocker de modèles dans la
   base : LiteLLM considère toute valeur présente — même "false" — comme une activation explicite.
3. Lancez d'abord la base dédiée puis le proxy pour vérifier qu'ils démarrent correctement (les images containers utilisées dans `docker-compose.yml` sont [`postgres:16-alpine`](https://hub.docker.com/_/postgres) et [`ghcr.io/berriai/litellm:main-latest`](https://ghcr.io/berriai/litellm/litellm) ; assurez-vous d'être authentifié sur le registre GitHub Container Registry si votre environnement l'exige) :
   ```bash
   docker compose --env-file docker/litellm/.env -f docker/litellm/docker-compose.yml up
   ```
   Le service `litellmdb` expose Postgres sur `localhost:5433` avec l'utilisateur/mot de passe `postgres/postgres` et la base `litellm`.
   Vous pouvez également exécuter la commande depuis `docker/litellm/` (le fichier `.env` sera automatiquement chargé tant qu'il existe).
   L'entrypoint personnalisé (`docker/litellm/entrypoint.sh`) veille à ce que Prisma voie toujours un `DATABASE_URL` au format PostgreSQL : il privilégie `LITELLM_DATABASE_URL`, sinon applique `DATABASE_URL` ou le DSN par défaut `postgresql://postgres:postgres@litellmdb:5432/litellm`.
   Le service `litellm` lit ensuite `docker/litellm/config.yaml` (chaque modèle y mentionne explicitement son fournisseur, par exemple `mistral/mistral-large-latest` pour aider LiteLLM à router correctement), applique la configuration générale (`general_settings.master_key`, `salt_key`, `database_url`, etc.) et expose une API OpenAI-compatible à l'adresse `http://127.0.0.1:4000`.
   Vous pouvez aussi déployer LiteLLM autrement (Docker standalone, VM, Kubernetes) tant que `LITELLM_API_BASE` et `LITELLM_API_KEY` correspondent à votre instance.

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
