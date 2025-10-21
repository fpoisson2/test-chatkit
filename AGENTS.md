# Instructions pour les agents

- Ce dépôt privilégie la rédaction de la documentation en français.
- Lorsque vous ajoutez des commandes destinées aux utilisateurs, précisez depuis quel répertoire elles doivent être exécutées.
- Si la configuration Docker évolue, mettez toujours à jour les sections correspondantes dans la documentation.

## Rôle du code

Le dépôt illustre une application de démonstration ChatKit composée d'un backend FastAPI (`backend/`) chargé de générer des secrets
clients via l'API OpenAI et d'un frontend React/Vite (`frontend/`) qui embarque le widget ChatKit et dialogue avec le backend.
L'objectif est de présenter rapidement un flux complet pour lancer un agent ChatKit depuis un navigateur.

## Démarrage rapide (hors Docker)

Toutes les commandes ci-dessous se lancent depuis la racine du dépôt.

1. Préparez l'environnement Python du backend : `npm run backend:sync`.
2. Démarrez le serveur FastAPI : `npm run backend:dev` (expose `http://localhost:8000`).
3. Installez les dépendances du frontend : `npm run frontend:install`.
4. Lancez le serveur Vite : `npm run frontend:dev` (expose `http://localhost:5173`).

Le frontend proxyfie automatiquement les requêtes `/api/chatkit/session` vers le backend, ce qui permet de tester l'intégration
ChatKit en quelques minutes.

## Tests backend (Pytest)

Toujours depuis la racine du dépôt :

1. Synchronisez les dépendances Python si ce n'est pas déjà fait : `npm run backend:sync`.
2. Démarrez PostgreSQL depuis la racine du dépôt :
   - via Docker Compose : `docker compose up -d db` (l'image `pgvector/pgvector:pg16` expose l'extension `vector`) ;
   - ou en démarrant votre service local (veillez à activer l'extension `vector`).
3. Exportez les variables minimales attendues par la configuration FastAPI :
   ```bash
   export DATABASE_URL="postgresql+psycopg://chatkit:chatkit@localhost:5432/chatkit"
   export OPENAI_API_KEY="sk-test"
   export AUTH_SECRET_KEY="secret-key"
   ```
   Adaptez ces valeurs à votre environnement (`DATABASE_URL` doit pointer vers la base PostgreSQL démarrée à l'étape précédente).
4. Exécutez la suite Pytest :
   - avec `uv` installé : `uv run --project backend pytest` ;
   - sans `uv` : `python3 -m pytest backend`.

Pensez à arrêter la base de tests lorsque vous avez terminé (`docker compose stop db` ou commande équivalente sur votre service local).
