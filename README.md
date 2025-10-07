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
- `index.html` already loads the ChatKit CDN script: `<script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" async></script>`
- If you want to call OpenAI directly from the browser, `src/chatkit.ts` shows the fetch helper that uses `import.meta.env.VITE_OPENAI_API_SECRET_KEY`
- If `npm` complains about cache permissions, this repo ships with a local `.npmrc` pointing the cache to `.npm-cache/`; leave it in place or run `npm install --cache .npm-cache`

With both servers running (`uv run uvicorn server:app --reload` in `backend/` and `npm run dev` inside `frontend/`), navigating to the Vite dev URL displays the embedded ChatKit widget backed by your Agent Builder workflow.
