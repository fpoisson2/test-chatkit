# Utiliser LiteLLM comme passerelle LLM locale

Cette configuration permet d'agréger plusieurs fournisseurs (OpenAI, Anthropic, Mistral, etc.) derrière un proxy [LiteLLM](https://docs.litellm.ai/docs/proxy/quick_start) compatible avec les API OpenAI. Vous pouvez ensuite diriger ChatKit vers ce proxy via `MODEL_PROVIDER=litellm`.

## 1. Démarrer le service LiteLLM

1. Ajoutez vos clés d'API fournisseurs dans votre `.env` (ex. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`). Pour les
    fournisseurs qui nécessitent une URL spécifique, vous pouvez également exposer des surcharges comme `MISTRAL_API_BASE=https://api.mistral.ai/v1`.
    Profitez-en pour définir `DATABASE_URL` si ce n'est pas déjà fait (PostgreSQL via Docker ou un DSN SQLite local) car le backend refusera de démarrer sans cette variable.
2. Définissez les variables spécifiques au proxy :
   ```bash
   MODEL_PROVIDER=litellm
   LITELLM_PORT=4000
   LITELLM_API_BASE=http://127.0.0.1:4000
   LITELLM_API_KEY=sk-litellm-proxy
   ```
3. Lancez uniquement le proxy pour vérifier qu'il démarre correctement (l'image container utilisée dans `docker-compose.yml` est [`ghcr.io/berriai/litellm:main-latest`](https://ghcr.io/berriai/litellm/litellm) ; assurez-vous d'être authentifié sur le registre GitHub Container Registry si votre environnement l'exige) :
   ```bash
   docker compose up litellm
   ```
   Le service charge `docker/litellm/config.yaml` (chaque modèle y mentionne explicitement son fournisseur, par exemple `mistral/mistral-large-latest` pour aider LiteLLM à router correctement) et expose une API OpenAI-compatible à l'adresse `http://127.0.0.1:4000`.

## 2. Connecter le backend et les workers

Lorsque `MODEL_PROVIDER=litellm` est présent dans votre `.env`, les services `backend` et `celery-worker` utilisent automatiquement `http://127.0.0.1:${LITELLM_PORT}` comme point d'accès par défaut et transmettent `LITELLM_API_KEY` lors des appels.

Pour lancer l'ensemble de la pile :
```bash
docker compose up backend celery-worker
```

## 3. Vérifier la configuration

Le script d'audit d'environnement remontera les éventuelles variables manquantes avant de lancer l'application :
```bash
node scripts/check-env.js
```

Assurez-vous qu'il détecte bien vos clés fournisseur (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.), la clé partagée du proxy (`LITELLM_API_KEY`) ainsi que la connexion base de données (`DATABASE_URL`).

Une fois ces vérifications effectuées, ChatKit peut router ses requêtes via LiteLLM pour sélectionner dynamiquement le modèle le plus adapté parmi les fournisseurs configurés.
