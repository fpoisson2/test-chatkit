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
