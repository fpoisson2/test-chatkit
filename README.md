# ChatKit Sample

This repository mirrors the walkthrough in `chatkit.md`, providing a FastAPI backend endpoint for issuing ChatKit client secrets and a React/Vite frontend that embeds the ChatKit widget. The codebase is now split into two apps: `backend/` and `frontend/`.

## Commandes depuis la racine

- `npm run backend:sync` — installe les dépendances Python (utilise `uv` si présent, sinon bascule sur `python3 -m pip install -r backend/requirements.txt`)
- `npm run backend:dev` — lance le serveur FastAPI (`uv run …` si disponible, sinon `python3 -m uvicorn server:app --reload --app-dir backend`)
- `npm run frontend:install` — installe les dépendances npm de `frontend/`
- `npm run frontend:dev` — lance le serveur Vite
- `npm run frontend:build` — construit le bundle de production
- `npm run frontend:preview` — aperçu local du bundle

Les scripts utilisent `uv` et `npm` en ciblant les sous-dossiers, évitant ainsi les `cd`. Si `uv` n'est pas installé, les commandes tombent automatiquement sur l'équivalent `python3 -m pip` / `python3 -m uvicorn`.

## Backend (`backend/`)

- Install dependencies via [uv](https://github.com/astral-sh/uv): `uv sync` (ou `npm run backend:sync` à la racine)
- Create a `.env` file inside `backend/` with:
  - `OPENAI_API_KEY` – the API key with access to the ChatKit beta
  - `CHATKIT_WORKFLOW_ID` – the workflow identifier (example from the docs: `wf_68e517bc3df4819095eb9f252c9f097d057110cbe8192cd9`)
- Start the dev server from the `backend/` directory: `uv run uvicorn server:app --reload` (ou `npm run backend:dev` à la racine)

The `/api/chatkit/session` route makes an HTTP request to `https://api.openai.com/v1/chatkit/sessions` using `httpx`, mirroring the official starter app. It accepts an optional `user` id and returns the `client_secret` (and `expires_after` if present). A `requirements.txt` remains available for `pip install -r requirements.txt`.

## Frontend (`frontend/`)

- Install JavaScript dependencies from within `frontend/`: `npm install` (ou `npm run frontend:install` à la racine)
- Start the Vite dev server (also from `frontend/`): `npm run dev` (default URL `http://localhost:5173`; alias racine `npm run frontend:dev`)
- The ChatKit widget is rendered by `src/MyChat.tsx` and mounted from `src/main.tsx`
- The project depends on React 19, matching the official starter app requirements for `@openai/chatkit-react`
- `vite.config.ts` proxies `/api/chatkit/session` requests to the FastAPI backend running on port 8000
- `VITE_ALLOWED_HOSTS` permet d'ajouter une liste d'hôtes supplémentaires autorisés par le serveur Vite (séparés par des virgules)
- `index.html` already loads the ChatKit CDN script: `<script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" async></script>`
- If you want to call OpenAI directly from the browser, `src/chatkit.ts` shows the fetch helper that uses `import.meta.env.VITE_OPENAI_API_SECRET_KEY`
- If `npm` complains about cache permissions, this repo ships with a local `.npmrc` pointing the cache to `.npm-cache/`; leave it in place or run `npm install --cache .npm-cache`

With both servers running (`uv run uvicorn server:app --reload` in `backend/` and `npm run dev` inside `frontend/`), navigating to the Vite dev URL displays the embedded ChatKit widget backed by your Agent Builder workflow.

## Lancement via Docker Compose

Depuis la racine du dépôt, vous pouvez orchestrer le backend FastAPI et le frontend Vite via Docker Compose :

1. Créez un fichier `.env` à la racine (au même niveau que `docker-compose.yml`) en vous basant sur `.env.example` et renseignez au minimum :
   ```env
   OPENAI_API_KEY="sk-..."
   CHATKIT_WORKFLOW_ID="wf_..."
   # Optionnel : ajustez le port d'exposition du frontend
   VITE_PORT=5183
   # Optionnel : ajustez le hostname utilisé par le HMR (utile derrière un tunnel/proxy)
   VITE_HMR_HOST=localhost
   # Optionnel : alignez la liste d'hôtes autorisés par Vite (séparés par des virgules)
   # VITE_ALLOWED_HOSTS="chatkit.example.com"
   ```
   Les autres variables d'environnement exposées dans `docker-compose.yml` disposent de valeurs par défaut (`VITE_ALLOWED_HOSTS`, `VITE_HMR_PROTOCOL`, `VITE_HMR_CLIENT_PORT`, `VITE_BACKEND_URL`, etc.) que vous pouvez également surcharger dans `.env` si nécessaire.
2. Depuis la racine du projet, lancez `docker compose up` pour démarrer les deux services. Le backend répond sur `http://localhost:8000` et le frontend sur `http://localhost:${VITE_PORT}`.
3. Utilisez `docker compose down` pour arrêter l'environnement de développement, puis relancez `docker compose up --build` si vous modifiez les dépendances système.

Les volumes montés vous permettent de modifier le code localement tout en profitant du rafraîchissement à chaud côté frontend (`npm run dev -- --host 0.0.0.0`) et du rechargement automatique d'Uvicorn.

### Exemple derrière un reverse proxy Nginx

Si vous exposez l'environnement de développement via Nginx (par exemple sur `https://chatkit.example.com`), configurez d'abord `.env` à la racine :

- `VITE_BACKEND_URL="https://chatkit.example.com/api"` pour forcer le frontend à appeler le backend via le reverse proxy.
- `VITE_HMR_HOST="chatkit.example.com"`, `VITE_ALLOWED_HOSTS="chatkit.example.com"`, `VITE_HMR_PROTOCOL="wss"` et `VITE_HMR_CLIENT_PORT=443` afin que le hot reload Vite continue de fonctionner à travers le proxy.

Ensuite, adaptez votre bloc `server` Nginx (fichier `sites-available/chatkit.conf`, à activer via `ln -s` depuis `/etc/nginx/sites-enabled/`). Les fichiers de certificats TLS ne doivent **pas** être créés à la main : laissez `certbot` générer et renouveler `/etc/letsencrypt/live/...` pour vous (`sudo certbot --nginx -d chatkit.example.com` ou `sudo certbot certonly --nginx …`). Une fois le certificat obtenu, référencez simplement les chemins fournis par `certbot` dans votre configuration :

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen 80;
  listen 443 ssl;
  server_name chatkit.example.com;

  # Certificats TLS gérés automatiquement par certbot/letsencrypt
  ssl_certificate     /etc/letsencrypt/live/chatkit.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/chatkit.example.com/privkey.pem;

  location /api/ {
    proxy_pass http://127.0.0.1:8000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }

  location / {
    proxy_pass http://127.0.0.1:5173/; # Ajustez le port si vous avez changé VITE_PORT
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }
}
```

Redémarrez ensuite Nginx (`sudo systemctl reload nginx`) et relancez `docker compose up` depuis la racine si nécessaire. Le proxy transférera les requêtes HTTP classiques sur `/` vers Vite et les appels API `/api/…` vers FastAPI, tout en préservant les websockets nécessaires au HMR.

`certbot` créera et renouvellera automatiquement les fichiers dans `/etc/letsencrypt/live/chatkit.example.com/`; vous n'avez donc rien à ajouter manuellement dans votre dépôt ou sur le serveur. Pensez simplement à vérifier que le timer `certbot.timer` est actif (`systemctl status certbot.timer`) pour garantir le renouvellement périodique des certificats.
