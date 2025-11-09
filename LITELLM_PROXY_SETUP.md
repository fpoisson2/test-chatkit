# Guide de configuration du serveur LiteLLM Proxy

Ce guide explique comment utiliser le serveur LiteLLM Proxy intégré dans le docker-compose pour accéder à plusieurs providers de modèles (OpenAI, Anthropic, Groq, etc.) via une interface unifiée.

## Avantages du proxy LiteLLM

✅ **Centralisation** : Une seule URL et clé API pour tous vos modèles
✅ **Multi-providers** : OpenAI, Anthropic, Groq, Cohere, Together AI, etc.
✅ **Sécurité** : Les vraies clés API restent côté serveur
✅ **Simplicité** : Configuration unique dans ChatKit
✅ **Flexibilité** : Ajoutez/retirez des modèles sans toucher au code

## Installation rapide

### 1. Copier et configurer le fichier .env

```bash
cp .env.example .env
```

Éditez le fichier `.env` et ajoutez vos clés API :

```bash
# Clé master du proxy LiteLLM
LITELLM_MASTER_KEY="sk-litellm-master-key-changeme"

# Clé OpenAI (obligatoire pour les modèles GPT)
OPENAI_API_KEY="sk-your-openai-key-here"

# Clés optionnelles pour d'autres providers
# ANTHROPIC_API_KEY="sk-ant-..."
# GROQ_API_KEY="gsk_..."
# COHERE_API_KEY="..."
```

### 2. Personnaliser la configuration LiteLLM (optionnel)

Éditez `litellm_config.yaml` pour activer/désactiver des modèles :

```yaml
model_list:
  # Déjà activé par défaut
  - model_name: openai/gpt-4
    litellm_params:
      model: gpt-4
      api_key: ${OPENAI_API_KEY}

  # Pour activer Claude, décommentez :
  - model_name: anthropic/claude-3-5-sonnet
    litellm_params:
      model: claude-3-5-sonnet-20240620
      api_key: ${ANTHROPIC_API_KEY}
```

### 3. Démarrer le proxy

```bash
docker-compose up -d litellm
```

Le serveur sera accessible sur `http://localhost:4000`

### 4. Vérifier que ça fonctionne

```bash
# Test de santé
curl http://localhost:4000/health

# Lister les modèles disponibles
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-litellm-master-key-changeme"
```

### 5. Configurer ChatKit

1. Accédez à l'interface d'administration de ChatKit
2. Créez un nouveau provider :
   - **Provider Slug** : `litellm`
   - **API Base** : `http://localhost:4000`
   - **API Key** : La valeur de `LITELLM_MASTER_KEY` (ex: `sk-litellm-master-key-changeme`)

3. Ajoutez vos modèles :
   - **Nom** : `openai/gpt-4` (ou autre modèle configuré)
   - **Provider** : Sélectionnez le provider LiteLLM créé à l'étape 2
   - **Display Name** : `GPT-4` (optionnel)

4. Utilisez le modèle dans vos workflows !

## Configuration avancée

### Ajouter un provider supplémentaire

#### Exemple : Anthropic Claude

1. **Ajoutez votre clé API dans `.env`** :
   ```bash
   ANTHROPIC_API_KEY="sk-ant-api03-..."
   ```

2. **Décommentez le modèle dans `litellm_config.yaml`** :
   ```yaml
   - model_name: anthropic/claude-3-5-sonnet
     litellm_params:
       model: claude-3-5-sonnet-20240620
       api_key: ${ANTHROPIC_API_KEY}
   ```

3. **Redémarrez le service** :
   ```bash
   docker-compose restart litellm
   ```

4. **Ajoutez le modèle dans ChatKit** :
   - Nom : `anthropic/claude-3-5-sonnet`
   - Provider : LiteLLM
   - Display Name : `Claude 3.5 Sonnet`

#### Exemple : Groq (Llama 3.1)

1. **Clé API dans `.env`** :
   ```bash
   GROQ_API_KEY="gsk_..."
   ```

2. **Dans `litellm_config.yaml`** :
   ```yaml
   - model_name: groq/llama-3.1-70b
     litellm_params:
       model: llama-3.1-70b-versatile
       api_key: ${GROQ_API_KEY}
   ```

3. **Redémarrer et ajouter dans ChatKit**

### Monitoring et logs

#### Voir les logs du proxy

```bash
docker-compose logs -f litellm
```

#### Activer les logs de debug

Dans `litellm_config.yaml`, décommentez :

```yaml
litellm_settings:
  set_verbose: true
```

Puis redémarrez :
```bash
docker-compose restart litellm
```

### Sécurité

#### Changer la clé master

En production, générez une clé sécurisée :

```bash
# Générer une clé aléatoire
openssl rand -base64 32

# Ou utilisez Python
python3 -c "import secrets; print(f'sk-litellm-{secrets.token_urlsafe(32)}')"
```

Mettez à jour dans `.env` :
```bash
LITELLM_MASTER_KEY="sk-litellm-votre-nouvelle-cle-securisee"
```

Et redémarrez :
```bash
docker-compose restart litellm
```

N'oubliez pas de mettre à jour la clé dans l'interface admin de ChatKit !

#### Restreindre les origines CORS

En production, éditez `litellm_config.yaml` :

```yaml
general_settings:
  master_key: ${LITELLM_MASTER_KEY}
  allowed_origins: ["https://chatkit.votredomaine.com"]
```

### Analytics et métriques (optionnel)

#### Activer les logs en base de données

Dans `litellm_config.yaml` :

```yaml
general_settings:
  master_key: ${LITELLM_MASTER_KEY}
  database_url: ${DATABASE_URL}
```

Dans `docker-compose.yml`, décommentez :

```yaml
environment:
  DATABASE_URL: ${DATABASE_URL:-postgresql+psycopg://chatkit:chatkit@localhost:5432/chatkit}
```

Redémarrez :
```bash
docker-compose restart litellm
```

#### Activer Prometheus

Dans `litellm_config.yaml` :

```yaml
general_settings:
  master_key: ${LITELLM_MASTER_KEY}
  enable_prometheus: true
```

Les métriques seront disponibles sur `http://localhost:4000/metrics`

## Modèles supportés

### Providers principaux

| Provider | Préfixe | Exemple |
|----------|---------|---------|
| OpenAI | `openai/` | `openai/gpt-4`, `openai/gpt-3.5-turbo` |
| Anthropic | `anthropic/` | `anthropic/claude-3-5-sonnet-20240620` |
| Groq | `groq/` | `groq/llama-3.1-70b-versatile` |
| Cohere | `cohere/` | `cohere/command-r-plus` |
| Together AI | `together_ai/` | `together_ai/meta-llama/Llama-3-70b-chat-hf` |
| Google | `gemini/` | `gemini/gemini-pro` |
| Mistral | `mistral/` | `mistral/mistral-large-latest` |

### Liste complète

Pour la liste complète des modèles supportés, consultez :
- [Documentation LiteLLM Providers](https://docs.litellm.ai/docs/providers)
- [Liste des modèles](https://docs.litellm.ai/docs/providers/openai)

## Dépannage

### Le service ne démarre pas

**Vérifiez les logs** :
```bash
docker-compose logs litellm
```

**Erreurs courantes** :
- Configuration YAML invalide : vérifiez la syntaxe de `litellm_config.yaml`
- Port 4000 déjà utilisé : changez le port dans `docker-compose.yml`

### Erreur d'authentification

**Cause** : La clé master est incorrecte

**Solution** :
1. Vérifiez que `LITELLM_MASTER_KEY` dans `.env` correspond à celle dans ChatKit
2. Redémarrez le service après modification

### Le modèle ne fonctionne pas

**Vérifiez** :
1. La clé API du provider est correcte dans `.env`
2. Le modèle est bien configuré dans `litellm_config.yaml`
3. Redémarrez après chaque modification

**Test direct** :
```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-litellm-master-key-changeme" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Le proxy est lent

**Augmentez le nombre de workers** dans `litellm_config.yaml` :

```yaml
litellm_settings:
  num_workers: 8  # au lieu de 4
```

**Augmentez le timeout** :
```yaml
litellm_settings:
  request_timeout: 900  # 15 minutes
```

## Commandes utiles

```bash
# Démarrer le proxy
docker-compose up -d litellm

# Arrêter le proxy
docker-compose stop litellm

# Redémarrer le proxy
docker-compose restart litellm

# Voir les logs en temps réel
docker-compose logs -f litellm

# Supprimer et recréer le proxy
docker-compose rm -f litellm
docker-compose up -d litellm

# Tester la santé
curl http://localhost:4000/health

# Lister les modèles
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}"
```

## Références

- [Documentation LiteLLM](https://docs.litellm.ai/)
- [Configuration du proxy](https://docs.litellm.ai/docs/proxy/configs)
- [Liste des providers](https://docs.litellm.ai/docs/providers)
- [Guide d'utilisation dans ChatKit](./backend/examples/LITELLM_GUIDE.md)
- [Migration des workflows](./backend/examples/WORKFLOW_LITELLM_MIGRATION.md)

## Support

En cas de problème :
1. Vérifiez les logs : `docker-compose logs litellm`
2. Consultez la [documentation officielle](https://docs.litellm.ai/)
3. Vérifiez les [issues GitHub](https://github.com/BerriAI/litellm/issues)
