# Guide pour les tests frontend sans backend

Pour tester uniquement le frontend en local avec des API simulées :

1. Installe les dépendances si nécessaire :
   ```bash
   npm run frontend:install
   ```
2. Expose la variable d'environnement pour activer les mocks côté Vite, puis lance le serveur de développement :
   ```bash
   VITE_USE_MOCK_API=true npm run frontend:dev
   ```
   Ce script est défini dans le `package.json` racine et démarre Vite depuis le dossier `frontend` avec `enableDevMocks` activé.
3. Ouvre ton navigateur sur l'URL indiquée par Vite (généralement http://localhost:5173) pour interagir avec l'UI alimentée par les données simulées.

Pense à désactiver `VITE_USE_MOCK_API` lorsque tu veux reconnecter le frontend au backend réel.

## Qualité du code Python

Avant de soumettre une modification Python, exécute `ruff check` (dans les dossiers pertinents comme `backend` ou `chatkit-python`) et corrige **tous** les problèmes signalés.
