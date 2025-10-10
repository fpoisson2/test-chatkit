# ChatKit Sample

This repository mirrors the walkthrough in `chatkit.md`, providing a FastAPI backend endpoint for issuing ChatKit client secrets and a React/Vite frontend that embeds the ChatKit widget. La base de code est scindée entre `backend/` et `frontend/` et inclut désormais une authentification basique (connexion + rôles) ainsi qu'un panneau d'administration pour gérer les utilisateurs.

## Authentification et administration

- La connexion se fait depuis `/login` et repose sur un token JWT signé côté backend.
- L'accueil (`/`) est protégé : sans authentification valide, l'utilisateur est redirigé vers la page de connexion avant d'accéder au widget ChatKit.
- Un compte administrateur (créé via variables d'environnement) peut gérer les utilisateurs depuis `/admin` : création, promotion/déclassement, réinitialisation de mot de passe et suppression.
- Les requêtes vers `/api/chatkit/session` utilisent automatiquement l'identité de l'utilisateur connecté si un token est présent dans les en-têtes.

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
- Créez un fichier `.env` dans `backend/` avec au minimum :
  - `OPENAI_API_KEY` – clé API autorisée sur la bêta ChatKit
  - `CHATKIT_WORKFLOW_ID` – identifiant du workflow (exemple : `wf_68e517bc3df4819095eb9f252c9f097d057110cbe8192cd9`)
  - `DATABASE_URL` – URL SQLAlchemy vers PostgreSQL (ex. `postgresql+psycopg://chatkit:chatkit@localhost:5432/chatkit`). En
    environnement Docker Compose, utilisez le hostname du service PostgreSQL (`db`) plutôt que `localhost`, par exemple
    `postgresql+psycopg://chatkit:chatkit@db:5432/chatkit`.
  - `AUTH_SECRET_KEY` – clé secrète utilisée pour signer les tokens JWT
  - Optionnel : `ALLOWED_ORIGINS` pour lister les origines autorisées par CORS (séparées par des virgules, par défaut `*`)
  - Optionnel : `ACCESS_TOKEN_EXPIRE_MINUTES` pour ajuster la durée de validité du token (par défaut 120 min)
  - Optionnel : `ADMIN_EMAIL` et `ADMIN_PASSWORD` pour provisionner automatiquement un compte administrateur au démarrage
  - Optionnel : `DATABASE_CONNECT_RETRIES` / `DATABASE_CONNECT_DELAY` pour ajuster la stratégie d'attente au démarrage
- Start the dev server from the `backend/` directory: `uv run uvicorn server:app --reload` (ou `npm run backend:dev` à la racine)

The `/api/chatkit/session` route makes an HTTP request to `https://api.openai.com/v1/chatkit/sessions` using `httpx`, mirroring the official starter app. Si un utilisateur est authentifié, son identifiant interne est réutilisé pour générer la session. La session résultante autorise désormais l'envoi de fichiers, prolonge l'expiration à une heure et porte la limite de requêtes à 50 par minute. A `requirements.txt` remains available for `pip install -r requirements.txt`.

> ℹ️ **CORS et flux de conversation** — l'API hébergée ChatKit ne renvoie pas systématiquement d'en-têtes `Access-Control-Allow-Origin`, ce qui provoque un blocage navigateur lors de la diffusion des réponses (SSE). Le backend expose donc un proxy de streaming `OPTIONS|POST /api/chatkit/proxy/{path:path}` qui relaie l'intégralité des requêtes `https://api.openai.com/v1/chatkit/*` vers OpenAI et renvoie un flux compatible navigateur.

### Outil météo exposé au workflow ChatKit

Le backend expose également un point d'entrée `GET /api/tools/weather` qui interroge l'API libre [Open-Meteo](https://open-meteo.com/) pour fournir les conditions actuelles d'une ville donnée. Cette route est pensée pour être appelée depuis un outil de workflow ChatKit, mais elle reste publique afin de faciliter les tests manuels.

- Paramètres : `city` (obligatoire) et `country` (optionnel, code ou nom du pays pour affiner la recherche).
- Réponse : température, vitesse du vent, code météo, description et fuseau horaire de la mesure.

Pour vérifier manuellement la réponse, démarrez le serveur FastAPI puis, **depuis la racine du dépôt**, exécutez par exemple :

```bash
curl "http://localhost:8000/api/tools/weather?city=Lyon"
```

La charge utile retournée est sérialisable en JSON et peut être consommée directement par un outil ChatKit (fonction Python, workflow Agent Builder, etc.).

### Exemple d'agent Python dédié

Le dossier `backend/workflows/` contient désormais un exemple minimal `weather_agent.py` basé sur la librairie Python `agents`. L'agent "Fournis la météo à l'utilisateur" illustre comment instancier un `Agent`, lancer un `Runner` avec un historique de conversation initial et renvoyer la sortie finale formattée (`output_text`). Vous pouvez vous en servir comme point de départ pour héberger votre workflow Agent Builder dans votre propre codebase, puis l'adapter (gestion d'état, appels d'API météo, etc.) avant de le connecter à votre serveur ChatKit.

### Intégration côté widget ChatKit

Le composant React `MyChat` enregistre un gestionnaire `onClientTool` pour l'outil client `get_weather`. Lorsque le workflow déclenche cet outil, le navigateur appelle automatiquement `GET /api/tools/weather` avec les paramètres fournis, puis renvoie la réponse JSON au backend ChatKit. Aucune configuration supplémentaire n'est nécessaire dans l'interface : il suffit que le workflow émette un appel d'outil nommé `get_weather` avec au minimum `{ "city": "Paris" }`.

Le champ de composition autorise désormais l'ajout de pièces jointes (images, PDF, texte brut jusqu'à 10 Mo, quatre fichiers maximum), ce qui reflète les capacités de la session générée côté backend.

Pour contourner le problème CORS mentionné plus haut, `src/MyChat.tsx` installe une surcharge légère de `window.fetch` qui redirige les appels `https://api.openai.com/v1/chatkit/...` vers le proxy FastAPI (`/api/chatkit/proxy/*`). Le widget conserve ainsi les flux SSE natifs tout en restant servi depuis votre domaine.

## Frontend (`frontend/`)

- Install JavaScript dependencies from within `frontend/`: `npm install` (ou `npm run frontend:install` à la racine)
- Start the Vite dev server (also from `frontend/`): `npm run dev` (default URL `http://localhost:5173`; alias racine `npm run frontend:dev`)
- `src/App.tsx` définit le routage entre l'accueil (`/`), la page de connexion (`/login`) et le panneau d'administration (`/admin`)
- Le widget ChatKit reste géré par `src/MyChat.tsx`, désormais capable d'inclure automatiquement le token d'un utilisateur connecté
- The project depends on React 19, matching the official starter app requirements for `@openai/chatkit-react`
- `vite.config.ts` proxies `/api/chatkit/session` requests to the FastAPI backend running on port 8000
- `VITE_BACKEND_URL` définit l'URL cible du backend pour l'ensemble des appels `/api/*`
- `VITE_HMR_HOST` doit se limiter à un nom d'hôte (avec éventuellement un port). Une faute de frappe du type `https//mon-domaine`
  conduit le navigateur à tenter de joindre `https://https//mon-domaine`, ce qui se traduit par une erreur DNS (`net::ERR_NAME_NOT_RESOLVED`).
  Le fichier `vite.config.ts` nettoie désormais automatiquement ce genre d'entrée, mais il est préférable de corriger la valeur dans
  votre `.env` pour éviter toute ambiguïté.
- Les requêtes de connexion basculent automatiquement sur `/api/auth/login` (même origine) puis, en cas d'échec réseau, réessaient avec `VITE_BACKEND_URL` ; cela évite les erreurs « Failed to fetch » lorsque le navigateur n'a pas de résolution DNS pour `backend` en environnement Docker.
- `VITE_ALLOWED_HOSTS` permet d'ajouter une liste d'hôtes supplémentaires autorisés par le serveur Vite (séparés par des virgules)
- `index.html` already loads the ChatKit CDN script: `<script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" async></script>`
- If you want to call OpenAI directly from the browser, `src/chatkit.ts` shows the fetch helper that uses `import.meta.env.VITE_OPENAI_API_SECRET_KEY`
- If `npm` complains about cache permissions, this repo ships with a local `.npmrc` pointing the cache to `.npm-cache/`; leave it in place or run `npm install --cache .npm-cache`

With both servers running (`uv run uvicorn server:app --reload` in `backend/` and `npm run dev` inside `frontend/`), navigating to the Vite dev URL displays the embedded ChatKit widget backed by your Agent Builder workflow.

### Utiliser votre propre backend ChatKit

Pour les intégrations avancées, vous pouvez auto‑héberger ChatKit et piloter le widget via votre propre serveur. Cette approche vous permet de gérer l'authentification, l'orchestration d'outils et la résidence des données selon vos exigences.

1. **Installer le serveur ChatKit** — Depuis le répertoire de votre projet serveur (par exemple `backend/` ou un dépôt dédié) et dans un environnement Python virtuel (créé via `uv` ou `python -m venv`), installez la dépendance :
   ```bash
   pip install openai-chatkit
   ```
2. **Implémenter une classe de serveur** — Créez un module (par exemple `my_chatkit_server.py`) qui hérite de `ChatKitServer` et surcharge la méthode `respond`. Vous pouvez réutiliser l'exemple suivant en l'adaptant à vos agents et à vos outils :
   ```python
   class MyChatKitServer(ChatKitServer):
       assistant_agent = Agent[AgentContext](
           model="gpt-4.1",
           name="Assistant",
           instructions="Vous êtes un assistant utile",
       )

       async def respond(self, thread, input, context):
           agent_context = AgentContext(thread=thread, store=self.store, request_context=context)
           result = Runner.run_streamed(
               self.assistant_agent,
               await to_input_item(input, self.to_message_content),
               context=agent_context,
           )
           async for event in stream_agent_response(agent_context, result):
               yield event
   ```
   Adaptez `to_message_content` si vous acceptez des fichiers ou des images.
3. **Exposer l'endpoint HTTP** — Avec FastAPI, servez votre instance via un point d'entrée `POST /chatkit` et relayez les réponses `StreamingResult` en SSE :
   ```python
   app = FastAPI()
   data_store = SQLiteStore()
   file_store = DiskFileStore(data_store)
   server = MyChatKitServer(data_store, file_store)

   @app.post("/chatkit")
   async def chatkit_endpoint(request: Request):
       result = await server.process(await request.body(), {})
       if isinstance(result, StreamingResult):
           return StreamingResponse(result, media_type="text/event-stream")
       return Response(content=result.json, media_type="application/json")
   ```
4. **Persister les données** — Implémentez l'interface `chatkit.store.Store` pour conserver les fils, messages et fichiers selon votre base de données (PostgreSQL, DynamoDB, etc.).
5. **Gérer les fichiers** — Fournissez un `FileStore` si vous autorisez les uploads (directs ou en deux temps via URL signée) et exposez les prévisualisations nécessaires au widget.
6. **Déclencher des outils côté client** — Enregistrez vos outils à la fois sur l'agent et côté client, puis déclenchez‑les via `ctx.context.client_tool_call` lorsque l'agent doit renvoyer un travail au navigateur.
7. **Exploiter le contexte serveur** — Passez un objet `context` personnalisé à `server.process(body, context)` pour propager l'identité de l'utilisateur, ses rôles ou toute autre métadonnée requise par vos règles métier.

Une fois votre serveur en place, pointez le widget ChatKit (via `apiURL`) vers votre nouvelle route `/chatkit`. Vous bénéficiez alors d'un contrôle complet sur la session, la stratégie d'authentification et l'exécution des outils tout en conservant l'ergonomie du composant ChatKit.

### Configurer le frontend Vite pour un serveur ChatKit personnalisé

1. **Créez un fichier `.env` à la racine** en dupliquant `.env.example`.
2. **Renseignez `VITE_CHATKIT_API_URL`** avec l'URL publique de votre serveur ChatKit (par exemple `https://chatkit.example.com/chatkit`).
3. **Indiquez `VITE_CHATKIT_DOMAIN_KEY`** : la clé de domaine générée lors de l'enregistrement de votre intégration côté serveur.
4. **Choisissez la stratégie d'upload** via `VITE_CHATKIT_UPLOAD_STRATEGY` :
   - `two_phase` si votre serveur fournit des URL signées via un échange en deux temps.
   - `direct` si le serveur accepte un upload direct. Dans ce cas, précisez aussi `VITE_CHATKIT_DIRECT_UPLOAD_URL`.
5. **Redémarrez le serveur Vite** (`npm run frontend:dev` depuis la racine) pour recharger les nouvelles variables.

Lorsque ces variables sont définies, le composant `MyChat` n'appelle plus `/api/chatkit/session` et utilise directement votre serveur via l'API ChatKit. Sans configuration explicite, l'application conserve le comportement hébergé par OpenAI (récupération d'un `client_secret` côté backend). Si aucune stratégie d'upload n'est fournie, les pièces jointes sont automatiquement désactivées pour éviter les erreurs de configuration.

## Lancement via Docker Compose

Depuis la racine du dépôt, vous pouvez orchestrer le backend FastAPI et le frontend Vite via Docker Compose :

1. Créez un fichier `.env` à la racine (au même niveau que `docker-compose.yml`) en vous basant sur `.env.example` et renseignez au minimum :
   ```env
   OPENAI_API_KEY="sk-..."
   CHATKIT_WORKFLOW_ID="wf_..."
   AUTH_SECRET_KEY="change-me"
   ADMIN_EMAIL="admin@example.com"
   ADMIN_PASSWORD="adminpass"
   # Optionnel : ajustez la connexion PostgreSQL (défaut : postgresql+psycopg://chatkit:chatkit@db:5432/chatkit).
   # En Docker Compose, laissez `db` comme hostname ou omettez complètement cette variable pour conserver la valeur par défaut.
   # DATABASE_URL="postgresql+psycopg://user:password@host:5432/chatkit"
   # Optionnel : ajustez le port d'exposition du frontend
   VITE_PORT=5183
   # Optionnel : ajustez le hostname utilisé par le HMR (utile derrière un tunnel/proxy)
   VITE_HMR_HOST=localhost
   # Optionnel : alignez la liste d'hôtes autorisés par Vite (séparés par des virgules)
   # VITE_ALLOWED_HOSTS="chatkit.example.com"
   ```
   Les autres variables d'environnement exposées dans `docker-compose.yml` disposent de valeurs par défaut (`VITE_ALLOWED_HOSTS`, `VITE_HMR_PROTOCOL`, `VITE_HMR_CLIENT_PORT`, `VITE_BACKEND_URL`, etc.) que vous pouvez également surcharger dans `.env` si nécessaire.
2. Depuis la racine du projet, lancez `docker compose up` pour démarrer les trois services (backend, frontend, base PostgreSQL). Le backend répond sur `http://localhost:8000`, la base de données sur `localhost:5432` et le frontend sur `http://localhost:${VITE_PORT}`.
3. Utilisez `docker compose down` pour arrêter l'environnement de développement, puis relancez `docker compose up --build` si vous modifiez les dépendances système.

Les volumes montés vous permettent de modifier le code localement tout en profitant du rafraîchissement à chaud côté frontend (`npm run dev -- --host 0.0.0.0`) et du rechargement automatique d'Uvicorn. Le volume nommé `postgres-data` conserve l'état de la base entre deux relances.

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
