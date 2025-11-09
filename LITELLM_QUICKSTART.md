# Guide de démarrage rapide LiteLLM

Ce guide vous permet de tester rapidement l'intégration LiteLLM avec un exemple concret utilisant l'outil météo.

## 🚀 Installation en 5 minutes

### 1. Configurer les variables d'environnement

```bash
# Copier le fichier d'exemple
cp .env.example .env

# Éditer le fichier .env et configurer :
# - OPENAI_API_KEY : votre clé API OpenAI
# - LITELLM_MASTER_KEY : clé pour accéder au proxy (changez en production)
# - LITELLM_SALT_KEY : clé de chiffrement (générez-la une seule fois)
```

Générer une clé de chiffrement sécurisée :
```bash
python3 -c "import secrets; print(f'sk-{secrets.token_urlsafe(32)}')"
```

### 2. Démarrer les services

```bash
# Démarrer PostgreSQL, Redis et LiteLLM proxy
docker-compose up -d db redis litellm

# Vérifier que LiteLLM fonctionne
curl http://localhost:4000/health

# Lister les modèles disponibles
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-litellm-master-key-changeme"
```

### 3. Démarrer ChatKit backend

```bash
# Installer les dépendances Python
cd backend
pip install -r requirements.txt
pip install 'openai-agents[litellm]'

# Lancer le serveur FastAPI
uvicorn server:app --reload
```

### 4. Configurer un modèle dans ChatKit

Via l'interface admin ou directement en base de données :

1. **Créer un provider LiteLLM** :
   - Slug : `litellm`
   - API Base : `http://localhost:4000`
   - API Key : valeur de `LITELLM_MASTER_KEY` (ex: `sk-litellm-master-key-changeme`)

2. **Ajouter un modèle** :
   - Nom : `openai/gpt-4` (doit correspondre à un modèle dans `litellm_config.yaml`)
   - Provider : Sélectionner le provider `litellm` créé ci-dessus
   - Display Name : `GPT-4 via LiteLLM` (optionnel)

### 5. Tester avec l'exemple météo

```bash
# Exécuter l'exemple
python backend/examples/litellm_weather_agent.py
```

Sortie attendue :
```
INFO: Chargement du modèle 'openai/gpt-4' depuis la base de données...
INFO: ✓ Modèle 'openai/gpt-4' chargé avec succès
INFO: Construction de l'outil météo...
INFO: ✓ Outil météo créé : fetch_weather
INFO: Création de l'agent météo...
INFO: ✓ Agent créé avec succès

============================================================
Test : Météo à Paris, France
============================================================
Question : Quelle est la météo actuelle à Paris, France ?

Réponse de l'agent :
À Paris, France, il fait actuellement 15°C avec un ciel partiellement nuageux...
```

## 🎯 Prochaines étapes

### Ajouter d'autres providers

#### Anthropic Claude

1. **Obtenir une clé API** sur https://console.anthropic.com/

2. **Ajouter dans `.env`** :
   ```bash
   ANTHROPIC_API_KEY="sk-ant-api03-..."
   ```

3. **Décommenter dans `litellm_config.yaml`** :
   ```yaml
   - model_name: anthropic/claude-3-5-sonnet
     litellm_params:
       model: claude-3-5-sonnet-20240620
       api_key: ${ANTHROPIC_API_KEY}
   ```

4. **Redémarrer LiteLLM** :
   ```bash
   docker-compose restart litellm
   ```

5. **Ajouter le modèle dans ChatKit** :
   - Nom : `anthropic/claude-3-5-sonnet`
   - Provider : `litellm`
   - Display Name : `Claude 3.5 Sonnet`

#### Groq (Llama 3.1)

1. **Obtenir une clé API** sur https://console.groq.com/

2. **Ajouter dans `.env`** :
   ```bash
   GROQ_API_KEY="gsk_..."
   ```

3. **Décommenter dans `litellm_config.yaml`** :
   ```yaml
   - model_name: groq/llama-3.1-70b
     litellm_params:
       model: llama-3.1-70b-versatile
       api_key: ${GROQ_API_KEY}
   ```

4. **Redémarrer et ajouter dans ChatKit**

### Utiliser dans les workflows

Les workflows ChatKit détectent automatiquement le provider `litellm` et utilisent LitellmModel.

Exemple dans un workflow :

```python
from app.chatkit.agent_registry import build_litellm_model_from_db
from agents import Agent

# Le modèle est automatiquement chargé depuis la BD
model = build_litellm_model_from_db("anthropic/claude-3-5-sonnet")

# Créer l'agent
agent = Agent(
    name="Mon agent",
    model=model,
    instructions="Tu es un assistant utile",
)

# Exécuter
result = await agent.run("Bonjour!")
```

Pour plus d'exemples, consultez :
- `backend/examples/LITELLM_GUIDE.md` - Guide complet LitellmModel
- `backend/examples/WORKFLOW_LITELLM_MIGRATION.md` - Migration des workflows
- `LITELLM_PROXY_SETUP.md` - Configuration avancée du proxy

## 📊 Monitoring et analytics

### Vérifier les logs

```bash
# Logs du proxy LiteLLM
docker-compose logs -f litellm

# Logs du backend ChatKit
docker-compose logs -f backend
```

### Activer le mode debug

Dans `litellm_config.yaml`, décommentez :
```yaml
litellm_settings:
  set_verbose: true
```

Puis redémarrez :
```bash
docker-compose restart litellm
```

### Consulter les analytics en base de données

```bash
# Se connecter à PostgreSQL
docker-compose exec db psql -U chatkit -d chatkit

# Voir les requêtes récentes (une fois que LiteLLM a fait des appels)
SELECT * FROM litellm_spendlogs ORDER BY startTime DESC LIMIT 10;
```

## 🔧 Dépannage

### Le proxy ne démarre pas

```bash
# Vérifier les logs
docker-compose logs litellm

# Erreurs courantes :
# 1. Port 4000 déjà utilisé -> changez le port dans docker-compose.yml
# 2. YAML invalide -> vérifiez la syntaxe de litellm_config.yaml
# 3. DATABASE_URL invalide -> vérifiez le format postgresql://
```

### Le modèle n'est pas trouvé

```bash
# Vérifier que le modèle existe en BD et est associé au bon provider
# Via l'interface admin ou SQL :
SELECT name, provider_id FROM models WHERE name LIKE '%gpt-4%';
```

### Erreur d'authentification

```bash
# Vérifier que LITELLM_MASTER_KEY correspond entre :
# 1. Le fichier .env
# 2. La configuration du provider en BD
# 3. Les requêtes curl de test

# Redémarrer après modification
docker-compose restart litellm
```

### Test de connectivité complet

```bash
# 1. Santé du proxy
curl http://localhost:4000/health

# 2. Liste des modèles
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-litellm-master-key-changeme"

# 3. Test d'appel direct
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-litellm-master-key-changeme" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## 📚 Ressources

- [Documentation LiteLLM](https://docs.litellm.ai/)
- [OpenAI Agents SDK](https://github.com/openai/agents-sdk)
- [Guide complet ChatKit + LiteLLM](./backend/examples/LITELLM_GUIDE.md)
- [Configuration du proxy](./LITELLM_PROXY_SETUP.md)

## 💡 Conseils de production

1. **Sécurité** :
   - Changez `LITELLM_MASTER_KEY` avec une clé forte
   - Générez `LITELLM_SALT_KEY` une seule fois et **ne la changez jamais**
   - Restreignez `allowed_origins` dans `litellm_config.yaml`

2. **Performance** :
   - Augmentez `num_workers` pour plus de requêtes parallèles
   - Activez le cache Redis dans `litellm_config.yaml`
   - Utilisez des modèles plus rapides (GPT-3.5, Claude Haiku) pour les tâches simples

3. **Monitoring** :
   - Activez Prometheus pour les métriques
   - Consultez régulièrement les logs en base de données
   - Configurez des alertes sur les coûts et erreurs

4. **Coûts** :
   - Suivez l'utilisation via `litellm_spendlogs`
   - Configurez des budgets dans `litellm_config.yaml`
   - Utilisez le routing intelligent pour équilibrer coûts/performance
