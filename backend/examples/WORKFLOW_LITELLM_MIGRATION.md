# Migration des workflows vers LitellmModel

Ce guide explique comment migrer vos workflows pour utiliser `LitellmModel` au lieu de l'ancienne approche `OpenAIProvider`.

## Qu'est-ce qui change ?

### Avant (OpenAIProvider)

L'ancienne méthode utilisait :
1. Un `OpenAIProvider` avec un client `AsyncOpenAI` compatible
2. Le provider était passé via `RunConfig(model_provider=...)`
3. Nécessitait une configuration manuelle du provider

### Après (LitellmModel)

La nouvelle méthode utilise :
1. `LitellmModel` du SDK OpenAI Agents officiel
2. Le modèle est directement intégré dans l'agent
3. Configuration automatique depuis la base de données
4. Conforme à la documentation officielle

## Migration automatique

**Bonne nouvelle !** La migration est **automatique** pour tous les workflows existants.

Si votre workflow utilise un provider de type `litellm`, le système détectera automatiquement et utilisera `LitellmModel` au lieu de `OpenAIProvider`.

### Exemple de configuration de workflow

```json
{
  "steps": [
    {
      "id": "agent_1",
      "kind": "agent",
      "parameters": {
        "model": "openai/gpt-4",
        "model_provider_slug": "litellm",
        "instructions": "You are a helpful assistant."
      }
    }
  ]
}
```

Avec cette configuration, le système :
1. Détecte que `model_provider_slug == "litellm"`
2. Charge automatiquement le modèle "openai/gpt-4" depuis la BD
3. Récupère les credentials du provider LiteLLM associé
4. Crée une instance de `LitellmModel`
5. L'injecte dans l'agent

## Vérifier que ça fonctionne

### Logs

Quand un workflow utilise `LitellmModel`, vous verrez ce log :

```
INFO - Utilisation de LitellmModel pour l'étape agent_1 (modèle: openai/gpt-4)
```

Si le modèle ne peut pas être chargé, vous verrez :

```
WARNING - Impossible de créer LitellmModel pour le modèle 'openai/gpt-4'
à l'étape agent_1, fallback sur OpenAIProvider
```

### Fallback automatique

Si `LitellmModel` ne peut pas être créé (ex: dépendance non installée), le système revient automatiquement à `OpenAIProvider` pour assurer la compatibilité.

## Configuration requise

### 1. Installer la dépendance

```bash
pip install "openai-agents[litellm]"
```

### 2. Configurer le provider dans la BD

1. Créez un provider de type `litellm` dans l'interface admin :
   - Provider: `litellm`
   - API Base: `http://localhost:4000` (ou votre URL LiteLLM)
   - API Key: Votre clé API

2. Créez un modèle qui utilise ce provider :
   - Nom: `openai/gpt-4` (ou autre modèle LiteLLM)
   - Provider: Sélectionnez le provider LiteLLM créé

### 3. Utiliser le modèle dans vos workflows

Dans vos étapes agent, spécifiez :

```json
{
  "model": "openai/gpt-4",
  "model_provider_slug": "litellm"
}
```

Ou si vous avez un ID de provider spécifique :

```json
{
  "model": "openai/gpt-4",
  "model_provider_id": "your-provider-id"
}
```

## Avantages de la migration

### 1. Conformité SDK officiel

- Utilise l'intégration officielle du SDK OpenAI Agents
- Meilleur support et mises à jour

### 2. Suivi d'utilisation

Avec `LitellmModel`, vous pouvez facilement activer le suivi des tokens :

```json
{
  "model": "openai/gpt-4",
  "model_provider_slug": "litellm",
  "model_settings": {
    "include_usage": true
  }
}
```

### 3. Configuration simplifiée

- Pas besoin de `RunConfig` séparé
- Le provider est intégré dans le modèle
- Configuration centralisée en base de données

### 4. Meilleure intégration LiteLLM

- Support natif des fonctionnalités LiteLLM
- Compatibilité avec 100+ modèles
- Gestion automatique des credentials

## Exemples de modèles supportés

### OpenAI via LiteLLM
```json
{
  "model": "openai/gpt-4",
  "model_provider_slug": "litellm"
}
```

### Anthropic via LiteLLM
```json
{
  "model": "anthropic/claude-3-5-sonnet-20240620",
  "model_provider_slug": "litellm"
}
```

### Groq via LiteLLM
```json
{
  "model": "groq/llama-3.1-70b-versatile",
  "model_provider_slug": "litellm"
}
```

### Cohere via LiteLLM
```json
{
  "model": "cohere/command-r-plus",
  "model_provider_slug": "litellm"
}
```

## Dépannage

### Le workflow ne trouve pas le modèle

**Erreur** : `WARNING - Modèle 'openai/gpt-4' introuvable en base de données`

**Solution** : Créez le modèle dans la BD via l'interface admin.

### Impossible de créer LitellmModel

**Erreur** : `WARNING - Impossible de créer LitellmModel`

**Causes possibles** :
1. Dépendance non installée : `pip install "openai-agents[litellm]"`
2. Provider non configuré en BD
3. Credentials invalides (API key, API base)

**Solution** : Le système utilisera automatiquement le fallback `OpenAIProvider`.

### Le workflow utilise toujours OpenAIProvider

**Cause** : Le `model_provider_slug` n'est pas défini sur `"litellm"`

**Solution** : Ajoutez `"model_provider_slug": "litellm"` dans les paramètres de votre étape agent.

## Migration manuelle (optionnel)

Si vous voulez migrer manuellement un workflow :

### Avant
```json
{
  "steps": [
    {
      "id": "agent_1",
      "kind": "agent",
      "parameters": {
        "model": "gpt-4",
        "model_provider_id": "openai-provider-1"
      }
    }
  ]
}
```

### Après
```json
{
  "steps": [
    {
      "id": "agent_1",
      "kind": "agent",
      "parameters": {
        "model": "openai/gpt-4",
        "model_provider_slug": "litellm"
      }
    }
  ]
}
```

**Note** : Changez `"gpt-4"` en `"openai/gpt-4"` pour le format LiteLLM.

## Tests

Pour tester que votre workflow utilise bien `LitellmModel` :

1. Activez les logs de debug
2. Exécutez votre workflow
3. Vérifiez les logs pour `"Utilisation de LitellmModel"`
4. Vérifiez que le workflow s'exécute correctement

## Support

Si vous rencontrez des problèmes :

1. Vérifiez que la dépendance est installée : `pip list | grep litellm`
2. Vérifiez les logs pour les messages d'erreur
3. Assurez-vous que le provider est correctement configuré en BD
4. Testez avec l'exemple `litellm_weather_example.py`

## Références

- [Guide d'utilisation LitellmModel](./LITELLM_GUIDE.md)
- [Exemple de code](./litellm_weather_example.py)
- [Documentation LiteLLM](https://docs.litellm.ai/docs/providers)
- [OpenAI Agents SDK](https://docs.openai-agents.dev/docs/models/litellm)
