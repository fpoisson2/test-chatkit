# EDxo

**Plateforme de création d'assistants IA pédagogiques avec workflow builder et intégration LMS**

EDxo est une plateforme complète permettant aux éducateurs et institutions de créer, personnaliser et déployer des assistants IA conversationnels directement dans leurs environnements d'apprentissage en ligne (LMS). Grâce à son workflow builder visuel et son intégration LTI 1.3, créez des expériences pédagogiques interactives sans écrire une ligne de code.

---

## 🎓 Pourquoi EDxo ?

### Conçu pour l'éducation
- **Intégration LTI 1.3** : Déployez vos assistants IA directement dans Moodle, Canvas, Blackboard, et autres LMS compatibles
- **Deep Linking** : Intégrez facilement des workflows dans vos cours
- **Assignment and Grade Services (AGS)** : Synchronisation automatique des notes et résultats
- **Confidentialité** : Gestion sécurisée des données étudiants et conformité RGPD

### Workflow Builder visuel
- **Interface no-code** : Créez des parcours d'apprentissage complexes par simple glisser-déposer
- **Graphe de workflows** : Visualisez et modifiez la logique de vos assistants pédagogiques
- **Versionning** : Gérez plusieurs versions de workflows et testez avant déploiement en production
- **Import/Export** : Partagez vos workflows avec d'autres éducateurs
- **Monitoring temps réel** : Suivez l'exécution de vos workflows et identifiez les points d'amélioration

### IA flexible et puissante
- **Multi-modèles** : OpenAI GPT-4, Claude (via LiteLLM), Gemini, Mistral, et plus
- **Personnalisation** : Instructions système adaptées à vos objectifs pédagogiques
- **Recherche sémantique** : Vector stores pour interroger vos contenus de cours
- **MCP (Model Context Protocol)** : Connectez vos assistants à des sources de données externes
- **Mode vocal** : Conversations vocales pour l'apprentissage des langues ou l'accessibilité

---

## ✨ Fonctionnalités principales

### 🎨 Workflow Builder
- Éditeur graphique intuitif pour concevoir des parcours conversationnels
- Bibliothèque de widgets réutilisables (questions, feedbacks, branchements conditionnels)
- Validation en temps réel des workflows
- Apparence personnalisable (logos, couleurs, messages d'accueil)
- Prévisualisation avant déploiement

### 🔗 Intégration LMS (LTI 1.3)
- Configuration simplifiée des registrations LTI
- Support complet du protocole LTI 1.3 et LTI Advantage
- Deep Linking pour l'intégration dans les modules de cours
- Assignment and Grade Services (AGS) pour le retour automatique de notes
- Gestion des déploiements par plateforme et institution

### 🤖 Gestion des modèles IA
- Configuration centralisée des fournisseurs (OpenAI, LiteLLM, Azure, etc.)
- Paramétrage par utilisateur ou par workflow
- Gestion des quotas et limitations
- Support des modèles vision et vocaux
- Logs et monitoring des appels API

### 📚 Bases de connaissances (Vector Stores)
- Indexation de vos documents de cours (PDF, TXT, Markdown)
- Recherche sémantique avec pgVector
- Interrogation par les assistants IA pour des réponses contextualisées
- Mise à jour et versionning des contenus

### 🎙️ Interactions vocales
- Mode conversation vocale temps réel (OpenAI Realtime API)
- Idéal pour l'apprentissage des langues
- Support téléphonie SIP/VoIP pour accès par téléphone
- WebRTC pour communications dans le navigateur
- Voix personnalisables

### 🛠️ Administration complète
- Gestion des utilisateurs et permissions
- Tableau de bord des métriques d'utilisation
- Configuration des langues et internationalisation
- Personnalisation de l'apparence (thème, logos)
- Gestion centralisée des serveurs MCP
- Configuration des comptes SIP pour la téléphonie

---

## 🚀 Démarrage rapide

### Prérequis

- **Docker** et **Docker Compose** (recommandé)
- Ou installation locale : Python 3.11+, Node.js 20+, PostgreSQL 16+, Redis 7+

### Installation avec Docker (5 minutes)

1. **Cloner le dépôt**
   ```bash
   git clone <url-du-repo>
   cd edxo
   ```

2. **Configurer l'environnement**
   ```bash
   cp .env.example .env
   ```

   Éditez `.env` avec vos paramètres :
   ```bash
   # Clé API pour votre fournisseur IA (obligatoire)
   OPENAI_API_KEY=sk-votre-clé-openai

   # Sécurité (CHANGEZ CES VALEURS !)
   AUTH_SECRET_KEY=une-clé-secrète-aléatoire-très-longue-et-sécurisée

   # Compte administrateur
   ADMIN_EMAIL=admin@votre-ecole.fr
   ADMIN_PASSWORD=MotDePasseSecurise123!

   # Configuration de base
   ALLOWED_ORIGINS=http://localhost:5183,http://127.0.0.1:5183
   DATABASE_URL=postgresql+psycopg://chatkit:chatkit@localhost:5432/chatkit
   ```

3. **Lancer la plateforme**
   ```bash
   docker-compose up -d
   ```

4. **Accéder à l'interface**
   - **Frontend** : http://localhost:5183
   - **API** : http://localhost:8000
   - **Documentation API** : http://localhost:8000/docs

5. **Première connexion**
   - Email : celui défini dans `ADMIN_EMAIL`
   - Mot de passe : celui défini dans `ADMIN_PASSWORD`

---

## 📖 Guide d'utilisation

### 1. Créer votre premier workflow

1. Connectez-vous en tant qu'administrateur
2. Accédez à **Workflow Builder** dans le menu
3. Créez un nouveau workflow ou dupliquez un exemple
4. Utilisez l'éditeur graphique pour :
   - Ajouter des nœuds de conversation
   - Définir des branchements conditionnels
   - Configurer les réponses de l'IA
   - Ajouter des widgets interactifs
5. **Prévisualisez** votre workflow
6. **Publiez en production** quand vous êtes satisfait

### 2. Intégrer dans votre LMS

#### Configuration LTI dans EDxo

1. Allez dans **Admin** → **LTI**
2. Récupérez les informations de votre outil :
   - **Redirect URL** : Pour l'OIDC
   - **Deep Link URL** : Pour l'intégration dans les cours
   - **Public Key URL** : Pour la validation JWT
3. Cliquez sur **Créer une registration**
4. Saisissez les informations de votre plateforme LMS :
   - **Issuer** : L'identifiant unique de votre LMS
   - **Client ID** : Fourni par votre LMS
   - **Authorization Endpoint**, **Token Endpoint**, **KeySet URL** : URLs de votre LMS

#### Configuration dans Moodle

1. **Site administration** → **Plugins** → **External tool** → **Manage tools**
2. Cliquez sur **Configure a tool manually**
3. Remplissez :
   - **Tool name** : EDxo
   - **Tool URL** : `http://votre-serveur:8000/lti/launch`
   - **LTI version** : LTI 1.3
   - **Public key type** : Keyset URL
   - **Public keyset** : `http://votre-serveur:8000/lti/jwks`
   - **Initiate login URL** : `http://votre-serveur:8000/lti/login`
   - **Redirection URI(s)** : `http://votre-serveur:8000/lti/launch`
4. Activez **Deep Linking**
5. Sauvegardez et récupérez le **Client ID** pour l'ajouter dans EDxo

#### Configuration dans Canvas

1. **Settings** → **Apps** → **View App Configurations**
2. Cliquez sur **+ App**
3. Sélectionnez **By URL** ou **Paste JSON**
4. Utilisez la configuration JSON générée par EDxo
5. Ajoutez la registration dans EDxo avec les informations Canvas

### 3. Ajouter des bases de connaissances

1. **Admin** → **Vector Stores**
2. Créez un nouveau store
3. Uploadez vos documents (PDF, TXT, Markdown, etc.)
4. Liez le store à vos workflows
5. L'assistant pourra interroger ces documents pour répondre aux étudiants

### 4. Configurer un modèle IA personnalisé

1. **Admin** → **Model Providers**
2. Ajoutez un nouveau fournisseur (ex: Azure OpenAI, LiteLLM)
3. **Admin** → **Models**
4. Configurez les modèles disponibles et leurs capacités
5. Sélectionnez le modèle par défaut pour vos workflows

### 5. Personnaliser l'apparence

1. **Admin** → **Appearance**
2. Uploadez votre logo
3. Personnalisez les couleurs
4. Définissez les messages d'accueil
5. Configurez les traductions si besoin

---

## 🏗️ Architecture technique

```
EDxo/
├── backend/                      # API FastAPI (Python)
│   ├── app/
│   │   ├── routes/               # Endpoints REST
│   │   │   ├── workflows.py      # API Workflow Builder
│   │   │   ├── lti.py            # Endpoints LTI 1.3
│   │   │   ├── workflow_monitor_ws.py  # WebSocket monitoring
│   │   │   └── ...
│   │   ├── workflows/            # Service de gestion des workflows
│   │   ├── lti/                  # Service LTI 1.3 complet
│   │   │   ├── service.py        # Logique LTI
│   │   │   └── ags.py            # Assignment & Grade Services
│   │   ├── vector_store/         # Recherche sémantique
│   │   ├── telephony/            # SIP/VoIP
│   │   ├── chatkit/              # Intégration ChatKit
│   │   ├── mcp/                  # Model Context Protocol
│   │   ├── models.py             # Modèles SQLAlchemy
│   │   └── schemas.py            # Validation Pydantic
│   ├── migrations/               # Migrations Alembic
│   └── tests/                    # Tests unitaires
├── frontend/                     # Interface React + TypeScript
│   └── src/
│       ├── features/
│       │   └── workflow-builder/ # Éditeur graphique de workflows
│       ├── pages/
│       │   ├── WorkflowBuilderPage.tsx
│       │   ├── AdminLtiPage.tsx
│       │   ├── AdminWorkflowMonitorPage.tsx
│       │   ├── VectorStoresPage.tsx
│       │   └── ...
│       └── components/           # Composants réutilisables
├── chatkit-python/               # Bibliothèque Python ChatKit
├── docker-compose.yml            # Orchestration complète
└── README.md                     # Ce fichier
```

### Stack technologique

**Backend**
- FastAPI (API REST asynchrone)
- SQLAlchemy + PostgreSQL (avec pgVector)
- Celery + Redis (tâches asynchrones)
- LiteLLM (intégration multi-modèles)
- PyJWT (authentification LTI)
- PJSIP (téléphonie SIP)

**Frontend**
- React 18 avec TypeScript
- Vite (build ultra-rapide)
- React Flow (workflow builder graphique)
- React Hook Form + Zod (validation)
- TanStack Query (gestion état serveur)

**Infrastructure**
- Docker & Docker Compose
- Nginx (reverse proxy production)
- PostgreSQL 16 (pgvector pour recherche sémantique)
- Redis 7 (cache & broker Celery)

---

## 🔧 Configuration avancée

### Fournisseurs IA

#### OpenAI (par défaut)
```bash
MODEL_PROVIDER=openai
OPENAI_API_KEY=sk-votre-clé
CHATKIT_API_BASE=https://api.openai.com
```

#### LiteLLM (multi-fournisseurs)
```bash
MODEL_PROVIDER=litellm
LITELLM_API_BASE=http://localhost:4000
LITELLM_API_KEY=sk-litellm

# Ajoutez les clés nécessaires
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
```

#### Azure OpenAI
```bash
MODEL_PROVIDER=openai
MODEL_API_BASE=https://votre-instance.openai.azure.com
AZURE_OPENAI_API_KEY=votre-clé-azure
```

### Mode vocal

Configuration côté serveur :
```bash
CHATKIT_REALTIME_MODEL=gpt-4o-realtime-preview-2024-12-17
CHATKIT_REALTIME_INSTRUCTIONS="Assistant pédagogique bienveillant"
CHATKIT_REALTIME_VOICE=verse
```

Configuration côté client (frontend) :
```bash
VITE_VOICE_SESSION_URL=/api/chatkit/voice/session
VITE_VOICE_DEFAULT_MODEL=gpt-4o-realtime-preview-2024-12-17
VITE_VOICE_DEFAULT_VOICE=alloy
```

### Téléphonie SIP

Pour permettre aux étudiants d'appeler vos assistants par téléphone :

```bash
SIP_BIND_HOST=0.0.0.0
SIP_BIND_PORT=40118
SIP_CONTACT_HOST=votre-ip-publique
SIP_TRANSPORT=udp
```

Configurez ensuite un compte SIP dans **Admin** → **SIP Accounts**.

### Rate Limiting

Protégez votre API avec rate limiting :
```bash
RATE_LIMIT_ENABLED=true
CELERY_BROKER_URL=redis://localhost:6379/0
```

Désactiver en développement :
```bash
RATE_LIMIT_ENABLED=false
```

### Internationalisation

Ajoutez des langues dans **Admin** → **Languages** :
- Interface multilingue automatique
- Traductions personnalisables
- Support RTL pour arabe/hébreu

---

## 📊 Monitoring et maintenance

### Logs

**Développement** (logs console colorés) :
```bash
ENVIRONMENT=development
LOG_LEVEL=DEBUG
```

**Production** (logs JSON structurés) :
```bash
ENVIRONMENT=production
LOG_LEVEL=INFO
LOG_FORMAT=json
```

### Workflow Monitor

Interface de monitoring temps réel :
- **Admin** → **Workflow Monitor**
- Visualisez les exécutions en direct
- Identifiez les erreurs et bottlenecks
- Analysez les parcours étudiants

### Métriques

Consultez les métriques d'utilisation :
- Nombre de sessions par workflow
- Temps de réponse moyen
- Taux de satisfaction (si configuré)
- Usage par modèle IA

### Sauvegarde

**Base de données PostgreSQL** :
```bash
docker-compose exec db pg_dump -U chatkit chatkit > backup_$(date +%Y%m%d).sql
```

**Restauration** :
```bash
docker-compose exec -T db psql -U chatkit chatkit < backup_20240615.sql
```

**Workflows et configurations** :
- Exportez vos workflows depuis l'interface (JSON)
- Sauvegardez le fichier `.env`
- Conservez les registrations LTI

---

## 🚀 Déploiement en production

### Checklist de sécurité

- [ ] Changer `AUTH_SECRET_KEY` (minimum 32 caractères aléatoires)
- [ ] Utiliser des mots de passe forts pour PostgreSQL et Redis
- [ ] Configurer `ALLOWED_ORIGINS` avec vos domaines uniquement
- [ ] Activer HTTPS avec certificats SSL/TLS valides
- [ ] Activer le rate limiting
- [ ] Configurer les logs JSON (`LOG_FORMAT=json`)
- [ ] Définir `ENVIRONMENT=production`
- [ ] Désactiver les logs de debug
- [ ] Configurer les sauvegardes automatiques
- [ ] Restreindre l'accès réseau aux ports nécessaires

### Variables d'environnement production

```bash
# Environnement
ENVIRONMENT=production
LOG_LEVEL=INFO
LOG_FORMAT=json

# Sécurité
AUTH_SECRET_KEY=<généré-avec-openssl-rand-base64-32>
ALLOWED_ORIGINS=https://edxo.votre-ecole.fr
RATE_LIMIT_ENABLED=true

# Base de données (utilisez des mots de passe forts)
DATABASE_URL=postgresql+psycopg://eduflow:PASSWORD_SECURISE@postgres:5432/eduflow
CELERY_BROKER_URL=redis://:REDIS_PASSWORD@redis:6379/0

# Admin
ADMIN_EMAIL=admin@votre-ecole.fr
ADMIN_PASSWORD=<mot-de-passe-très-sécurisé>

# IA
OPENAI_API_KEY=<votre-clé-production>
```

### Reverse proxy Nginx

```nginx
upstream backend {
    server 127.0.0.1:8000;
}

upstream frontend {
    server 127.0.0.1:5183;
}

server {
    listen 443 ssl http2;
    server_name edxo.votre-ecole.fr;

    ssl_certificate /etc/letsencrypt/live/edxo.votre-ecole.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/edxo.votre-ecole.fr/privkey.pem;

    # Sécurité SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # API Backend
    location /api/ {
        proxy_pass http://backend/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # LTI Endpoints
    location /lti/ {
        proxy_pass http://backend/lti/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend
    location / {
        proxy_pass http://frontend/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}

# Redirection HTTP vers HTTPS
server {
    listen 80;
    server_name edxo.votre-ecole.fr;
    return 301 https://$server_name$request_uri;
}
```

### Docker Compose Production

Créez un `docker-compose.prod.yml` :

```yaml
version: '3.8'

services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    restart: always
    environment:
      - ENVIRONMENT=production
    # ... reste de la config

  frontend:
    build:
      context: frontend
      dockerfile: Dockerfile.prod
    restart: always
    # ... reste de la config

  db:
    image: pgvector/pgvector:pg16
    restart: always
    volumes:
      - postgres-data:/var/lib/postgresql/data
    # Ajoutez des backups automatiques

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
```

---

## 🧪 Tests

### Tests backend

```bash
cd backend

# Tests unitaires
pytest tests/ -v

# Avec couverture
pytest tests/ --cov=app --cov-report=html

# Tests spécifiques
pytest tests/test_workflows.py -v
pytest tests/test_lti.py -v
```

### Tests d'intégration LTI

```bash
# Vérifier la configuration LTI
./check_lti.sh

# Tester un workflow complet
./test_example.sh
```

### Tests téléphonie

```bash
# Test minimal d'appel entrant
./test_incoming_calls_minimal.py

# Test complet avec bridge audio
./test_incoming_calls_with_bridge.py

# Test création de ports audio
./test_audio_port_creation.py
```

---

## 🤝 Contribution

Les contributions sont les bienvenues ! EDxo est un projet open source destiné à la communauté éducative.

### Comment contribuer

1. **Forkez** le projet
2. Créez une branche : `git checkout -b feature/ma-super-fonctionnalite`
3. Committez : `git commit -m 'Ajout de ma super fonctionnalité'`
4. Pushez : `git push origin feature/ma-super-fonctionnalite`
5. Ouvrez une **Pull Request**

### Standards de code

**Python**
- Suivre PEP 8
- Utiliser Black pour le formatage
- Utiliser isort pour les imports
- Type hints obligatoires
- Docstrings pour les fonctions publiques

**TypeScript**
- Suivre les règles ESLint configurées
- Types stricts (pas de `any` sauf justifié)
- Composants fonctionnels avec hooks
- Tests pour les composants critiques

**Commits**
- Messages en français ou anglais
- Format : `Type: Description courte`
- Types : Feature, Fix, Refactor, Docs, Test, Chore

### Zones à améliorer

- [ ] Support de plus de LMS (Brightspace, Schoology, etc.)
- [ ] Marketplace de workflows partagés
- [ ] Analytics avancés pour les éducateurs
- [ ] Support de l'API Assistants d'OpenAI
- [ ] Intégration avec H5P pour contenus interactifs
- [ ] Mobile app (React Native)
- [ ] SSO avec SAML/OAuth2
- [ ] Gamification (badges, points, leaderboards)

---

## ❓ FAQ

### Quelle est la différence avec ChatGPT ?

EDxo est conçu **spécifiquement pour l'éducation** :
- Intégration LMS native (pas besoin de sortir de Moodle/Canvas)
- Workflows personnalisables par cours/module
- Gestion des notes et feedback automatique
- Contrôle total des données étudiants
- Auto-hébergement possible (souveraineté des données)

### Puis-je utiliser d'autres modèles que GPT ?

Oui ! EDxo supporte :
- Claude (Anthropic) via LiteLLM
- Gemini (Google) via LiteLLM
- Mistral AI
- Llama (via Ollama ou LiteLLM)
- Azure OpenAI
- Tout modèle compatible OpenAI API

### Est-ce gratuit ?

Le logiciel est open source (licence à définir), mais vous devez :
- Fournir votre propre infrastructure (serveur)
- Payer les API des fournisseurs IA (OpenAI, Anthropic, etc.)

### Combien ça coûte en API IA ?

Cela dépend de votre usage. Exemple avec GPT-4:
- 1000 messages étudiants ≈ 5-10€
- Pour réduire les coûts : utilisez GPT-3.5, Claude Haiku, ou hébergez Llama

### Mes données étudiants sont-elles sécurisées ?

Oui :
- Vous hébergez la plateforme (auto-hébergement possible)
- Chiffrement HTTPS obligatoire
- Conformité RGPD si configuré correctement
- Les conversations avec les IA passent par les API des fournisseurs (voir leurs CGU)

### Puis-je l'utiliser sans LMS ?

Oui ! EDxo fonctionne aussi en standalone :
- Interface web accessible directement
- Gestion manuelle des comptes utilisateurs
- Pas besoin de LTI si vous n'utilisez pas de LMS

### Support commercial disponible ?

Pour l'instant, le projet est communautaire.
- Support : via GitHub Issues
- Documentation : ce README et `/docs`
- Communauté : [Discord/Forum à venir]

---

## 📚 Ressources

### Documentation
- **LTI 1.3** : https://www.imsglobal.org/spec/lti/v1p3/
- **OpenAI Realtime API** : https://platform.openai.com/docs/guides/realtime
- **LiteLLM** : https://docs.litellm.ai/
- **FastAPI** : https://fastapi.tiangolo.com/
- **React Flow** : https://reactflow.dev/

### Tutoriels
- Configuration LTI dans Moodle : [Lien à venir]
- Créer son premier workflow : [Lien à venir]
- Intégrer des documents de cours : [Lien à venir]

### Communauté
- GitHub Issues : Rapporter des bugs
- GitHub Discussions : Poser des questions
- [Discord/Slack à venir]

---

## 📄 Licence

[À définir - MIT, Apache 2.0, ou autre]

---

## 🙏 Remerciements

- **IMS Global** pour les standards LTI
- **OpenAI** pour les API ChatGPT et Realtime
- **Anthropic** pour Claude
- La communauté **LiteLLM** pour le proxy multi-fournisseurs
- Tous les contributeurs open source

---

## 📞 Contact

- **Email** : [À définir]
- **Website** : [À définir]
- **GitHub** : [Ce dépôt]

---

**Créons ensemble l'avenir de l'éducation avec l'IA ! 🚀🎓**
