# ChatKit Sample

This repository mirrors the walkthrough in `chatkit.md`, providing both the legacy FastAPI endpoint that issues ChatKit client secrets and a lightweight ChatKit server (`/api/chatkit`) driven by the Python SDK. La base de code est scindée entre `backend/` et `frontend/` et inclut désormais une authentification basique (connexion + rôles) ainsi qu'un panneau d'administration pour gérer les utilisateurs.

## Authentification et administration

- La connexion se fait depuis `/login` et repose sur un token JWT signé côté backend.
- L'accueil (`/`) est protégé : sans authentification valide, l'utilisateur est redirigé vers la page de connexion avant d'accéder au widget ChatKit.
- Un compte administrateur (créé via variables d'environnement) peut gérer les utilisateurs depuis `/admin` : création, promotion/déclassement, réinitialisation de mot de passe et suppression.
- L'onglet `/admin/vector-stores` récapitule les magasins JSON (`pgvector`) disponibles, permet d'en créer de nouveaux, d'uploader un fichier JSON pour l'ingérer, de déclencher l'indexation et de tester les requêtes hybrides (`/search_json`) avec un aperçu du document source (`/documents/{doc_id}`).
- L'onglet `/admin/widgets` offre une interface complète pour constituer la bibliothèque de widgets ChatKit : création, validation/prévisualisation, édition et suppression des définitions JSON avant leur utilisation dans le workflow builder.
- Les requêtes vers `/api/chatkit/session` utilisent automatiquement l'identité de l'utilisateur connecté si un token est présent dans les en-têtes.
- Une implémentation ChatKit auto‑hébergée est disponible sur `/api/chatkit`. Elle orchestre l'Agents SDK en local pour répondre via le widget sans passer par un workflow hébergé.
- Les endpoints `/api/chatkit/session`, `/api/chatkit` et `/api/chatkit/proxy/*` exigent désormais un JWT valide : toute tentative non authentifiée renvoie `401` avant même de contacter l'API ChatKit.

## Commandes depuis la racine

- `npm run backend:sync` — installe les dépendances Python (utilise `uv` si présent, sinon bascule sur `python3 -m pip install -r backend/requirements.txt`)
- `npm run backend:dev` — lance le serveur FastAPI (`uv run …` si disponible, sinon `python3 -m uvicorn server:app --reload --app-dir backend`)
- `npm run frontend:install` — installe les dépendances npm de `frontend/`
- `npm run frontend:dev` — lance le serveur Vite
- `npm run frontend:build` — construit le bundle de production
- `npm run frontend:preview` — aperçu local du bundle

Le backend référence désormais la copie locale du package `openai-chatkit` située dans `chatkit-python/`, ce qui garantit que `npm run backend:sync` synchronise la version embarquée avec le reste du dépôt.

Les scripts utilisent `uv` et `npm` en ciblant les sous-dossiers, évitant ainsi les `cd`. Si `uv` n'est pas installé, les commandes tombent automatiquement sur l'équivalent `python3 -m pip` / `python3 -m uvicorn`.

### Activer le mode voix

Le parcours vocal exploite WebRTC : prévoyez un navigateur récent capable d'accéder au microphone via `navigator.mediaDevices.getUserMedia` et autorisez la permission audio lors du premier démarrage.【F:frontend/src/voice/VoiceChat.tsx†L31-L63】 Un micro fonctionnel est indispensable pour initier la session.

Toutes les commandes ci-dessous se lancent **depuis la racine du dépôt** :

```bash
# depuis la racine du dépôt
npm run backend:dev   # expose POST /api/chatkit/voice/session pour générer les secrets éphémères
npm run frontend:dev  # démarre le client Vite et la page /voice
```

L'appel `POST /api/chatkit/voice/session` retourne un `client_secret` temporaire, la configuration (modèle, voix, instructions) ainsi que l'horodatage d'expiration. Le backend s'appuie par défaut sur les variables `CHATKIT_REALTIME_MODEL`, `CHATKIT_REALTIME_INSTRUCTIONS` et `CHATKIT_REALTIME_VOICE`, mais vous pouvez les surcharger depuis l'interface admin (« Paramètres du mode voix »).【F:backend/app/routes/chatkit.py†L154-L204】【F:.env.example†L12-L16】

Côté navigateur, configurez la section « Paramétrage du mode voix » de votre `.env` Vite pour pointer vers le backend et définir les valeurs par défaut utilisées avant la première personnalisation :

```env
VITE_VOICE_SESSION_URL="/api/chatkit/voice/session"
VITE_VOICE_DEFAULT_MODEL="gpt-4o-realtime-preview-2024-12-17"
VITE_VOICE_DEFAULT_INSTRUCTIONS="Sois chaleureux et garde des réponses courtes"
VITE_VOICE_DEFAULT_VOICE="verse"
```

Ces variables servent de repli lorsque la base de données ne contient pas encore de préférences vocales et permettent de diriger le frontend vers un backend distant si `VITE_BACKEND_URL` est renseigné.【F:.env.example†L44-L53】【F:frontend/src/voice/useVoiceSession.ts†L17-L48】【F:frontend/src/voice/useVoiceSession.ts†L324-L371】 Le secret renvoyé par OpenAI expira rapidement : le frontend anticipe un rafraîchissement environ une minute avant la date `expires_at`. Prévoyez de relancer la capture microphone si vous suspendez la session trop longtemps.【F:frontend/src/voice/useVoiceSession.ts†L54-L68】【F:frontend/src/voice/useVoiceSession.ts†L406-L462】

### Initialiser un vector store via l'interface admin

Toutes les commandes ci-dessous se lancent **depuis la racine du dépôt** :

```bash
# depuis la racine du dépôt
npm run backend:sync   # installe les dépendances Python (pgvector, sentence-transformers…)
npm run backend:dev    # démarre FastAPI et initialise les tables json_vector_stores
npm run frontend:dev   # lance Vite pour accéder au panneau d'administration
```

Une fois les deux serveurs démarrés, ouvrez `http://localhost:5173/admin/vector-stores` :

1. Créez un magasin (slug + métadonnées) via **Nouveau vector store**.
2. Déposez un fichier JSON et validez l'ingestion pour générer les embeddings.
3. Testez une requête de recherche hybride et inspectez le document complet retourné par l'API.

> ℹ️ **Versions toujours à jour** — les manifestes (`backend/requirements.txt`, `backend/pyproject.toml`, `frontend/package.json`) ne fixent plus de contrainte de version. Chaque exécution de `npm run backend:sync` ou `npm run frontend:install` installe donc les dernières publications disponibles. Pensez à régénérer vos environnements locaux après un `git pull` pour récupérer les évolutions amont.

### Gérer la bibliothèque de widgets via l'interface admin

Toujours **depuis la racine du dépôt** :

```bash
# depuis la racine du dépôt
npm run backend:dev   # expose les routes /api/widgets protégées par authentification
npm run frontend:dev  # lance Vite et l'interface d'administration
```

Ouvrez ensuite `http://localhost:5173/admin/widgets` :

1. Cliquez sur **Nouveau widget** pour saisir un slug, un titre et coller la définition JSON (ex. un `Card` avec des `Text`).
2. Utilisez le bouton **Prévisualiser** pour valider la définition côté backend (`chatkit.widgets.WidgetRoot`) et visualiser le JSON normalisé.
3. Enregistrez le widget pour le retrouver dans la table, prêt à être référencé depuis vos modules d'agent (slug).
4. Ouvrez un widget existant pour le mettre à jour ou supprimez-le lorsqu'il n'est plus utilisé.

La prévisualisation en direct évite de propager des définitions invalides dans vos workflows et fournit un exemple de JSON prêt à copier/coller dans le workflow builder.

## Backend (`backend/`)

- Install dependencies via [uv](https://github.com/astral-sh/uv): `uv sync` (ou `npm run backend:sync` à la racine)
- Créez un fichier `.env` dans `backend/` avec au minimum :
  - `OPENAI_API_KEY` – clé API autorisée sur la bêta ChatKit
  - `DATABASE_URL` – URL SQLAlchemy vers PostgreSQL (ex. `postgresql+psycopg://chatkit:chatkit@localhost:5432/chatkit`). En
    environnement Docker Compose, utilisez le hostname du service PostgreSQL (`db`) plutôt que `localhost`, par exemple
    `postgresql+psycopg://chatkit:chatkit@db:5432/chatkit`.
  - `AUTH_SECRET_KEY` – clé secrète utilisée pour signer les tokens JWT
  - Optionnel : `CHATKIT_WORKFLOW_ID` si vous souhaitez toujours pouvoir émettre un `client_secret` via l'API hébergée.
  - Optionnel : `CHATKIT_AGENT_MODEL` / `CHATKIT_AGENT_INSTRUCTIONS` pour personnaliser l'agent exécuté par `/api/chatkit` (par défaut, le dépôt charge le workflow local défini dans `backend/app/chatkit.py`).
  - Optionnel : `ALLOWED_ORIGINS` pour lister les origines autorisées par CORS (séparées par des virgules, par défaut `*`)
  - Optionnel : `ACCESS_TOKEN_EXPIRE_MINUTES` pour ajuster la durée de validité du token (par défaut 120 min)
  - Optionnel : `ADMIN_EMAIL` et `ADMIN_PASSWORD` pour provisionner automatiquement un compte administrateur au démarrage. Sans ces deux variables définies dans votre fichier `.env`, aucun compte n'est créé.
  - Optionnel : `DATABASE_CONNECT_RETRIES` / `DATABASE_CONNECT_DELAY` pour ajuster la stratégie d'attente au démarrage
- Start the dev server from the `backend/` directory: `uv run uvicorn server:app --reload` (ou `npm run backend:dev` à la racine)

> 🔁 **Environnements virtuels** — sans fichier `uv.lock`, c'est l'index PyPI qui fait foi. En CI/CD, épinglez vos versions en générant un lockfile temporaire (`uv pip compile backend/requirements.txt`) si vous avez besoin de reproductibilité stricte.

Le backend expose deux intégrations complémentaires :

- `/api/chatkit` est un serveur ChatKit auto‑hébergé basé sur `openai-chatkit`. Il persiste désormais les fils, messages et pièces jointes dans PostgreSQL via `PostgresChatKitStore`, tout en invoquant le workflow `run_workflow` défini dans `backend/app/chatkit.py`. Vous pouvez toujours le personnaliser en fournissant `CHATKIT_AGENT_MODEL` / `CHATKIT_AGENT_INSTRUCTIONS`.
- `/api/chatkit/session` conserve le flux historique de l'application d'origine : un appel `httpx` vers `https://api.openai.com/v1/chatkit/sessions` pour récupérer un `client_secret`. Cette route reste disponible pour tester rapidement un workflow existant (nécessite `CHATKIT_WORKFLOW_ID`).

> ℹ️ **CORS et flux de conversation** — l'API ChatKit hébergée ne renvoie pas systématiquement d'en-têtes `Access-Control-Allow-Origin`, ce qui provoque un blocage lors de la diffusion SSE. Le backend expose donc un proxy `OPTIONS|POST /api/chatkit/proxy/{path:path}` qui relaie `https://api.openai.com/v1/chatkit/*`. Le serveur custom n'en a pas besoin mais le proxy reste utile pour le mode hébergé ou pour récupérer des logs bruts.

### Indexation JSON vectorielle (`pgvector`)

Le backend persiste désormais les documents JSON enrichis dans trois tables dédiées.
⚠️ Cette fonctionnalité repose exclusivement sur PostgreSQL (>= 14) avec l'extension `pgvector` activée ; aucun mode de repli SQLite n'est prévu.

- `json_vector_stores` pour référencer les collections (`slug`, titre optionnel, métadonnées) ;
- `json_documents` pour stocker le JSON brut, sa version linéarisée et les métadonnées associées à un document (`store_id`, `doc_id`) ;
- `json_chunks` pour conserver chaque extrait linéarisé, son embedding `VECTOR`, le JSON source correspondant, les métadonnées et les timestamps.

Au démarrage, `backend/app/startup.py` appelle automatiquement `CREATE EXTENSION IF NOT EXISTS vector` (PostgreSQL) puis crée les index spécialisés :

- `ivfflat` sur `json_chunks.embedding` (`vector_cosine_ops`) ;
- `GIN` plein texte sur `to_tsvector('simple', linearized_text)` ;
- `GIN` sur les colonnes `metadata` pour accélérer les filtres JSONB.

Dans l'environnement Docker Compose fourni, le service PostgreSQL repose sur l'image officielle `pgvector/pgvector:pg16`, qui
embarque l'extension `vector` prête à l'emploi. Sur une instance managée, vérifiez auprès de votre administrateur que le
paquet `pgvector` est installé avant de lancer le backend.

Assurez-vous que l'utilisateur PostgreSQL dispose du droit `CREATE EXTENSION`. En cas de déploiement manuel, vous pouvez forcer l'initialisation depuis la **racine du dépôt** avec :

```bash
# depuis la racine du dépôt
psql "postgresql://user:password@host:5432/chatkit" -c "CREATE EXTENSION IF NOT EXISTS vector"
```

L'ingestion est centralisée dans `backend/app/vector_store/service.py`. Le service linéarise automatiquement le JSON, découpe le texte en segments avec chevauchement, génère des embeddings via le modèle local `intfloat/multilingual-e5-small` (`sentence-transformers`) puis normalise les vecteurs avant de les enregistrer. Exemple minimal :

> 💡 **Dépendances système** — Sur les distributions Debian/Ubuntu minimalistes (dont l'image officielle `python:3.11-slim` utilisée en Docker Compose), PyTorch nécessite la bibliothèque `libgomp1` pour activer OpenMP. Le `Dockerfile` du backend installe ce paquet automatiquement ; sur une machine hôte, ajoutez-le via `sudo apt install libgomp1` si vous rencontrez une erreur « libgomp.so.1: cannot open shared object file » lors du chargement du modèle d'embedding.

```python
from backend.app.database import SessionLocal
from backend.app.vector_store import JsonVectorStoreService

payload = {"title": "Guide", "sections": ["Introduction", "FAQ"]}

with SessionLocal() as session:
    service = JsonVectorStoreService(session)
    service.ingest(
        "documentation",
        "guide-v1",
        payload,
        store_title="Documentation produit",
        document_metadata={"source": "wiki interne"},
    )
    session.commit()
```

Le chargement du modèle e5 est effectué paresseusement et mis en cache. Pensez à relancer `npm run backend:sync` (depuis la racine) pour installer les nouvelles dépendances Python (`pgvector`, `sentence-transformers`).

### Bibliothèque de widgets ChatKit

Un nouvel ensemble d'endpoints REST permet aux administrateurs de constituer une bibliothèque de widgets réutilisables par les modules d'agent du workflow builder. Les définitions sont stockées dans la table `widget_templates` et validées via `chatkit.widgets.WidgetRoot` avant d'être persistées.

Chaque création ou mise à jour indexe désormais la définition JSON dans un vector store dédié (`chatkit-widgets`). Celui-ci est automatiquement créé au besoin et enrichi de métadonnées (slug, titre, description). Les recherches hybrides peuvent ainsi exploiter la bibliothèque de widgets pour suggérer des composants pertinents dans vos prompts.

- `GET /api/widgets` — lister l'ensemble des widgets disponibles (administrateur uniquement) ;
- `POST /api/widgets` — créer un widget (`slug`, titres/description optionnels et JSON décrivant le widget) ;
- `PATCH /api/widgets/{slug}` — mettre à jour le libellé, la description ou la définition JSON d'un widget ;
- `DELETE /api/widgets/{slug}` — retirer un widget de la bibliothèque ;
- `POST /api/widgets/preview` — valider une définition JSON et obtenir la version normalisée sans l'enregistrer.

Toutes ces routes sont protégées par un contrôle d'accès administrateur. Une fois `npm run backend:dev` lancé **depuis la racine du dépôt**, vous pouvez vérifier une définition depuis le terminal avec :

```bash
# depuis la racine du dépôt
curl -X POST http://localhost:8000/api/widgets/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_ADMIN>" \
  -d '{
        "definition": {
          "type": "Card",
          "size": "lg",
          "children": [
            {"type": "Text", "id": "titre", "value": "Résumé"},
            {"type": "Markdown", "id": "details", "value": "**Points clés**"}
          ]
        }
      }'
```

Le JSON renvoyé peut être utilisé tel quel comme sortie d'un module d'agent dans le workflow builder ChatKit.

### Bloc widget dans le workflow builder

Une fois la bibliothèque alimentée, le workflow builder propose un **bloc widget** autonome dans la palette de gauche. Ajoutez-le après n'importe quel nœud (agent, état, condition…) pour diffuser le widget correspondant dans ChatKit dès que l'exécution atteint ce bloc.

- Depuis la page **Workflows**, sélectionnez une version de workflow et cliquez sur **Modifier** pour afficher le builder.
- Dans la colonne de gauche, cliquez sur **Bloc widget** : un nouveau nœud rose apparaît dans le canvas.
- Sélectionnez le nœud afin d'ouvrir l'inspecteur, choisissez le slug du widget à afficher puis, si besoin, mappez les variables du widget avec des expressions de l'état (ex. `state.resume`).
- Le bloc est complètement indépendant des étapes d'agent : les widgets s'affichent immédiatement dans ChatKit sans attendre une réponse textuelle.

Vous pouvez ainsi enchaîner plusieurs widgets (cartes, formulaires, listes…) pour enrichir la conversation, tout en gardant la possibilité d'utiliser les widgets comme format de sortie d'un agent classique si nécessaire.

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

Le module `backend/app/chatkit.py` regroupe désormais l'exemple complet basé sur la librairie Python `agents` : il expose le serveur `DemoChatKitServer`, les agents composant le workflow `run_workflow` et la logique de streaming utilisée par `/api/chatkit`.

### Intégration côté widget ChatKit

Le composant React `MyChat` enregistre un gestionnaire `onClientTool` pour l'outil client `get_weather`. Lorsque le workflow déclenche cet outil, le navigateur appelle automatiquement `GET /api/tools/weather` avec les paramètres fournis, puis renvoie la réponse JSON au backend ChatKit. Aucune configuration supplémentaire n'est nécessaire dans l'interface : il suffit que le workflow émette un appel d'outil nommé `get_weather` avec au minimum `{ "city": "Paris" }`.

Le champ de composition autorise désormais l'ajout de pièces jointes (images, PDF, texte brut jusqu'à 10 Mo, quatre fichiers maximum), ce qui reflète les capacités de la session générée côté backend.

Lorsque vous définissez `VITE_CHATKIT_API_URL`, `src/MyChat.tsx` fournit une fonction `fetch` personnalisée qui ajoute automatiquement le jeton JWT à chaque appel `fetch`, ce qui permet au serveur `/api/chatkit` d'identifier l'utilisateur côté backend. Si vous restez sur l'API hébergée, le composant continue d'utiliser `/api/chatkit/session` et peut s'appuyer sur le proxy `/api/chatkit/proxy/*` pour contourner les restrictions CORS lors du streaming SSE.

> ❗ **Erreurs 502 sur un serveur externe** — si le navigateur affiche `Failed to load resource: 502 (Bad Gateway)` lors d'un appel vers `VITE_CHATKIT_API_URL`, cela signifie que l'URL configurée ne répond pas ou que le reverse proxy renvoie une erreur. Le widget remontera désormais un message d'erreur explicite dans l'interface ; vérifiez que votre serveur ChatKit auto‑hébergé est joignable et que la variable `VITE_CHATKIT_API_URL` pointe bien vers l'endpoint `/api/chatkit` exposé.

## Frontend (`frontend/`)

- Install JavaScript dependencies from within `frontend/`: `npm install` (ou `npm run frontend:install` à la racine)
- Start the Vite dev server (also from `frontend/`): `npm run dev` (default URL `http://localhost:5173`; alias racine `npm run frontend:dev`)
- `src/App.tsx` définit le routage entre l'accueil (`/`), la page de connexion (`/login`) et le panneau d'administration (`/admin`)
- Le widget ChatKit reste géré par `src/MyChat.tsx`, désormais capable d'inclure automatiquement le token d'un utilisateur connecté
- Aucun `package-lock.json` n'est versionné afin de toujours récupérer la dernière version des dépendances lors du `npm install`. Gérez un lock local ou CI si vous avez besoin de versions figées.
- The project depends on React 19, matching the official starter app requirements for `@openai/chatkit-react`
- `vite.config.ts` proxies toutes les routes `/api/*` (dont `/api/chatkit`) vers le backend FastAPI exposé sur le port 8000
- Le composant `MyChat` se branche par défaut sur `/api/chatkit`. Pour forcer le mode hébergé (client secret), définissez `VITE_CHATKIT_FORCE_HOSTED=true` dans votre `.env`. Pensez à ajouter `VITE_CHATKIT_DOMAIN_KEY` si vous exposez votre propre domaine.
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

With both servers running (`uv run uvicorn server:app --reload` in `backend/` and `npm run dev` inside `frontend/`), navigating to the Vite dev URL displays the embedded ChatKit widget, alimenté soit par votre agent local (`/api/chatkit`), soit par le workflow hébergé si vous avez conservé le mode `client_secret`.

### Utiliser votre propre backend ChatKit

Ce dépôt embarque déjà une implémentation de référence (`DemoChatKitServer`) accessible sur `/api/chatkit`. Elle s'appuie sur `openai-chatkit`, un store PostgreSQL (`PostgresChatKitStore`) et l'Agents SDK pour exécuter `run_workflow` (défini dans `backend/app/chatkit.py`). Vous pouvez la conserver telle quelle, la personnaliser (instructions, modèle, persistance) ou repartir d'un projet vierge suivant les étapes ci-dessous.

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
2. **Renseignez `VITE_CHATKIT_API_URL`** avec l'URL publique de votre serveur ChatKit (par exemple `https://chatkit.example.com/chatkit`). Sans cette variable, l'application pointe par défaut sur `/api/chatkit` (le backend FastAPI inclus).
3. **Optionnel : fournissez `VITE_CHATKIT_DOMAIN_KEY`** si vous disposez d'une clé enregistrée auprès d'OpenAI. Sans valeur, le widget fonctionnera néanmoins en mode auto-hébergé et la vérification de domaine sera ignorée.
4. **Optionnel : contournez la vérification distante** — définissez `VITE_CHATKIT_SKIP_DOMAIN_VERIFICATION=true` si votre environnement ne peut pas joindre l'API OpenAI `domain_keys/verify_hosted`. Dans ce cas, toute requête de vérification est court‑circuitée côté navigateur et le widget continue de fonctionner.
5. **Choisissez la stratégie d'upload** via `VITE_CHATKIT_UPLOAD_STRATEGY` :
   - `two_phase` si votre serveur fournit des URL signées via un échange en deux temps.
   - `direct` si le serveur accepte un upload direct. Dans ce cas, précisez aussi `VITE_CHATKIT_DIRECT_UPLOAD_URL`.
6. **Optionnel : forcer le mode hébergé** – définissez `VITE_CHATKIT_FORCE_HOSTED=true` si vous souhaitez ignorer le serveur custom et générer un `client_secret` (utile lorsque vous testez un workflow existant).
7. **Redémarrez le serveur Vite** (`npm run frontend:dev` depuis la racine) pour recharger les nouvelles variables.

 Lorsque ces variables sont définies, le composant `MyChat` n'appelle plus `/api/chatkit/session` et dialogue directement avec votre serveur via l'API ChatKit fournie par le backend FastAPI. Sans clé de domaine, le frontend ignore la vérification distante et reste pleinement fonctionnel en mode auto-hébergé. Si `VITE_CHATKIT_SKIP_DOMAIN_VERIFICATION=true`, la requête correspondante est neutralisée et le widget s'exécute sans dépendre de l'endpoint OpenAI `domain_keys/verify_hosted`. Vous pouvez à tout moment forcer le flux hébergé en définissant `VITE_CHATKIT_FORCE_HOSTED=true`. Dans le mode auto-hébergé, si aucune stratégie d'upload n'est fournie, les pièces jointes sont automatiquement désactivées afin d'éviter les erreurs de configuration.

### Vérifier rapidement votre fichier `.env`

Un doute sur la configuration appliquée ? Depuis la **racine du dépôt**, lancez :

```bash
npm run diagnostic:env
```

Le script `scripts/check-env.js` parcourt votre fichier `.env` et signale les oublis les plus fréquents :

- présence et format de `OPENAI_API_KEY` ;
- correspondance des URL (`VITE_BACKEND_URL`, `VITE_CHATKIT_API_URL`) ;
- stratégie d'upload et variables associées ;
- clé de domaine et options de forçage du mode hébergé.

En sortie, chaque ligne est préfixée par ✅ ou ⚠️ selon que le paramètre semble correct ou nécessite votre attention. En cas d'erreur 502 persistante, le script rappelle également la commande `curl -i <URL>` à exécuter pour vérifier que votre reverse proxy relaie bien l'endpoint `/api/chatkit`.

## Lancement via Docker Compose

Depuis la racine du dépôt, vous pouvez orchestrer le backend FastAPI et le frontend Vite via Docker Compose :

1. Créez un fichier `.env` à la racine (au même niveau que `docker-compose.yml`) en vous basant sur `.env.example` et renseignez au minimum :
   ```env
   OPENAI_API_KEY="sk-..."
   AUTH_SECRET_KEY="change-me"
   # Optionnel : ajustez la connexion PostgreSQL (défaut : postgresql+psycopg://chatkit:chatkit@db:5432/chatkit).
   # En Docker Compose, laissez `db` comme hostname ou omettez complètement cette variable pour conserver la valeur par défaut.
   # DATABASE_URL="postgresql+psycopg://user:password@host:5432/chatkit"
   # Optionnel : activez le mode workflow hébergé
   # CHATKIT_WORKFLOW_ID="wf_..."
   # Optionnel : personnalisez l'agent exécuté par /api/chatkit
   # CHATKIT_AGENT_MODEL="gpt-4.1-mini"
   # CHATKIT_AGENT_INSTRUCTIONS="Tu es un assistant conversationnel…"
   # Optionnel : alignez le frontend sur votre endpoint ChatKit
   # VITE_CHATKIT_API_URL="https://chatkit.example.com/api/chatkit"
   # VITE_CHATKIT_DOMAIN_KEY="domain_pk_..."
   # VITE_CHATKIT_FORCE_HOSTED="false"
   # VITE_CHATKIT_SKIP_DOMAIN_VERIFICATION="true"
   # VITE_CHATKIT_UPLOAD_STRATEGY="two_phase"
   # VITE_CHATKIT_DIRECT_UPLOAD_URL="https://chatkit.example.com/upload"
   # Optionnel : ajustez le port d'exposition du frontend
   VITE_PORT=5183
   # Optionnel : ajustez le hostname utilisé par le HMR (utile derrière un tunnel/proxy)
   VITE_HMR_HOST=localhost
   # Optionnel : alignez la liste d'hôtes autorisés par Vite (séparés par des virgules)
   # VITE_ALLOWED_HOSTS="chatkit.example.com"
   ```
   Pour créer automatiquement un compte administrateur lors du démarrage du backend, ajoutez dans ce même fichier :

   ```env
   ADMIN_EMAIL="admin@example.com"
   ADMIN_PASSWORD="adminpass"
   ```

   Tant que ces variables ne figurent pas dans votre `.env`, aucun compte administrateur n'est provisionné par défaut.
   Les autres variables d'environnement exposées dans `docker-compose.yml` disposent de valeurs par défaut (`VITE_ALLOWED_HOSTS`, `VITE_HMR_PROTOCOL`, `VITE_HMR_CLIENT_PORT`, `VITE_BACKEND_URL`, etc.) que vous pouvez également surcharger dans `.env` si nécessaire.
2. Depuis la racine du projet, lancez `docker compose up --build` pour démarrer les trois services (backend, frontend, base PostgreSQL). Cette première exécution construit l'image `backend` à partir de `backend/Dockerfile` (installation de `libgomp1` + dépendances Python) et récupère l'image `pgvector/pgvector:pg16` pour la base de données, avec l'extension `vector` déjà disponible. Le backend répond sur `http://localhost:8000`, la base de données sur `localhost:5432` et le frontend sur `http://localhost:${VITE_PORT}`. Le build Docker copie le dossier `chatkit-python/` afin que `pip` installe la version embarquée d'`openai-chatkit`.
3. Utilisez `docker compose down` pour arrêter l'environnement de développement. Rejouez `docker compose up --build` à chaque fois que vous modifiez `backend/requirements.txt` ou le Dockerfile ; dans les autres cas, un simple `docker compose up` suffit.

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
