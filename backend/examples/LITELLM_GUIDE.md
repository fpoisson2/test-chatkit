# Guide d'utilisation de LitellmModel avec les modèles de la BD

Ce guide explique comment utiliser `LitellmModel` du SDK OpenAI Agents avec les modèles configurés en base de données.

## Installation

Installez d'abord la dépendance LiteLLM pour le SDK agents :

```bash
pip install "openai-agents[litellm]"
```

## Configuration

### 1. Configurer un provider dans l'interface admin

Avant d'utiliser `LitellmModel`, vous devez configurer un provider dans l'interface d'administration :

1. Accédez à la page d'administration
2. Ajoutez un nouveau provider de modèles :
   - **Provider**: `litellm`
   - **API Base**: URL de votre serveur LiteLLM (ex: `http://localhost:4000`)
   - **API Key**: Votre clé API

### 2. Créer un modèle dans la BD

Ajoutez un modèle qui utilise ce provider :

- **Nom**: Le nom du modèle pour LiteLLM (ex: `openai/gpt-4`, `anthropic/claude-3-5-sonnet`)
- **Provider**: Sélectionnez le provider LiteLLM que vous avez créé
- **Display name** et **Description**: Informations d'affichage (optionnel)

## Utilisation

### Méthode 1 : Utiliser `build_litellm_model_from_db()`

C'est la méthode **recommandée** car elle récupère automatiquement toutes les informations depuis la BD.

```python
from agents import Agent, Runner, ModelSettings
from app.chatkit.agent_registry import build_litellm_model_from_db

# Charger le modèle depuis la BD
model = build_litellm_model_from_db("openai/gpt-4")

# Créer l'agent
agent = Agent(
    name="Assistant",
    instructions="You are a helpful assistant.",
    model=model,
    # Optionnel: activer le suivi d'utilisation
    model_settings=ModelSettings(include_usage=True),
)

# Exécuter
result = await Runner.run(agent, "Hello!")
print(result.final_output)
```

### Méthode 2 : Créer manuellement un `LitellmModel`

Si vous voulez plus de contrôle, vous pouvez créer manuellement une instance :

```python
from agents import Agent, Runner
from agents.extensions.models.litellm_model import LitellmModel

# Créer le modèle manuellement
model = LitellmModel(
    model="openai/gpt-4",
    api_key="votre_cle_api",
    api_base="http://localhost:4000",  # Optionnel
)

# Créer l'agent
agent = Agent(
    name="Assistant",
    instructions="You are a helpful assistant.",
    model=model,
)

result = await Runner.run(agent, "Hello!")
```

## Suivi d'utilisation (Usage tracking)

Pour activer le suivi des tokens et des requêtes, passez `ModelSettings(include_usage=True)` :

```python
from agents import Agent, ModelSettings
from app.chatkit.agent_registry import build_litellm_model_from_db

model = build_litellm_model_from_db("openai/gpt-4")

agent = Agent(
    name="Assistant",
    model=model,
    model_settings=ModelSettings(include_usage=True),
)

result = await Runner.run(agent, "Hello!")

# Accéder aux statistiques
usage = result.context_wrapper.usage
print(f"Input tokens: {usage.input_tokens}")
print(f"Output tokens: {usage.output_tokens}")
print(f"Total tokens: {usage.total_tokens}")
```

## Exemple complet

Voir le fichier `litellm_weather_example.py` pour un exemple complet avec :
- Chargement du modèle depuis la BD
- Utilisation d'un outil (function_tool)
- Gestion d'erreurs
- Affichage des statistiques d'utilisation

## Exécution de l'exemple

```bash
# Depuis le répertoire backend/
cd examples
python litellm_weather_example.py --model "openai/gpt-4"

# Ou en mode interactif
python litellm_weather_example.py
# Puis entrez le nom du modèle quand demandé
```

## Modèles supportés

LiteLLM supporte plus de 100 modèles. Voici quelques exemples de noms de modèles :

### OpenAI
- `openai/gpt-4`
- `openai/gpt-4-turbo`
- `openai/gpt-3.5-turbo`

### Anthropic
- `anthropic/claude-3-5-sonnet-20240620`
- `anthropic/claude-3-opus-20240229`
- `anthropic/claude-3-haiku-20240307`

### Autres
- `cohere/command-r-plus`
- `groq/llama-3.1-70b-versatile`
- `together_ai/meta-llama/Llama-3-70b-chat-hf`

Pour la liste complète, consultez la [documentation LiteLLM](https://docs.litellm.ai/docs/providers).

## Dépannage

### Le modèle retourne `None`

Vérifiez que :
1. Le modèle existe en base de données
2. Un provider est configuré pour ce modèle
3. Les credentials du provider sont valides (API key, API base)

### ImportError: No module named 'litellm'

Installez la dépendance :
```bash
pip install "openai-agents[litellm]"
```

### Erreur d'authentification

Vérifiez que :
1. L'API key est correcte dans la configuration du provider
2. L'API base pointe vers le bon serveur
3. Le serveur LiteLLM est accessible

## Différence avec l'approche OpenAIProvider

Le projet supporte deux approches :

### Approche 1 : `OpenAIProvider` + `RunConfig` (ancienne méthode)

```python
from agents import Agent, RunConfig, Runner
from app.chatkit.agent_registry import get_agent_provider_binding

# Récupérer le provider
binding = get_agent_provider_binding(provider_id="...", provider_slug="litellm")

# Créer l'agent avec juste le nom du modèle
agent = Agent(name="Assistant", model="gpt-4")

# Passer le provider via RunConfig
run_config = RunConfig(model_provider=binding.provider)
result = await Runner.run(agent, "Hello!", run_config=run_config)
```

### Approche 2 : `LitellmModel` (nouvelle méthode - recommandée)

```python
from agents import Agent, Runner
from app.chatkit.agent_registry import build_litellm_model_from_db

# Charger le modèle directement
model = build_litellm_model_from_db("gpt-4")

# Créer l'agent avec l'instance du modèle
agent = Agent(name="Assistant", model=model)

# Pas besoin de RunConfig
result = await Runner.run(agent, "Hello!")
```

**Avantages de l'approche 2 :**
- Plus simple (pas besoin de `RunConfig`)
- Conforme à la documentation officielle du SDK
- Support natif du suivi d'utilisation
- Meilleure intégration avec LiteLLM

## Références

- [Documentation LiteLLM SDK](https://docs.openai-agents.dev/docs/models/litellm)
- [Documentation LiteLLM Providers](https://docs.litellm.ai/docs/providers)
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python)
