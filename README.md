# ChatKit Sample

This repository mirrors the walkthrough in `chatkit.md`, providing both the FastAPI backend endpoint for issuing ChatKit client secrets and the frontend scaffolding needed to embed the ChatKit widget.

## Python backend

- Install dependencies via [uv](https://github.com/astral-sh/uv): `uv sync`
- Create a `.env` file at the project root with:
  - `OPENAI_API_KEY` – the API key with access to the ChatKit beta
  - `CHATKIT_WORKFLOW_ID` – the workflow identifier (example from the docs: `wf_68e517bc3df4819095eb9f252c9f097d057110cbe8192cd9`)
- Run the dev server through npm: `npm run backend` (or directly `uv run uvicorn server:app --reload`)

The `/api/chatkit/session` route makes an HTTP request to `https://api.openai.com/v1/chatkit/sessions` using `httpx`, mirroring the official starter app. It accepts an optional `user` id and returns the `client_secret` (and `expires_after` if present). A `requirements.txt` remains available for `pip install -r requirements.txt`.

## Frontend scaffold

- Install JavaScript dependencies: `npm install`
- Start the Vite dev server: `npm run dev` (default URL `http://localhost:5173`)
- The ChatKit widget is rendered by `src/MyChat.tsx` and mounted from `src/main.tsx`
- The project depends on React 19, matching the official starter app requirements for `@openai/chatkit-react`
- `vite.config.ts` proxies `/api/chatkit/session` requests to the FastAPI backend running on port 8000
- `index.html` already loads the ChatKit CDN script: `<script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" async></script>`
- If you want to call OpenAI directly from the browser, `src/chatkit.ts` shows the fetch helper that uses `import.meta.env.VITE_OPENAI_API_SECRET_KEY`
- If `npm` complains about cache permissions, this repo ships with a local `.npmrc` pointing the cache to `.npm-cache/`; leave it in place or run `npm install --cache .npm-cache`

With both servers running (`npm run backend` and `npm run dev`), navigating to the Vite dev URL displays the embedded ChatKit widget backed by your Agent Builder workflow.
