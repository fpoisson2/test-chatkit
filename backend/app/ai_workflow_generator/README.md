# Infrastructure de Génération de Workflows par IA

Cette infrastructure permet de générer des workflows conversationnels complets en utilisant l'IA (OpenAI structured output).

## 🎯 Fonctionnalités

- ✅ **Génération par IA** : Créez des workflows à partir de descriptions en langage naturel
- ✅ **Structured Output** : Garantit que l'IA génère du JSON conforme au schéma Pydantic
- ✅ **Validation complète** : Vérifie la structure, les connexions, et la cohérence des workflows
- ✅ **API REST** : Endpoints faciles à utiliser depuis le frontend
- ✅ **Sauvegarde automatique** : Option pour sauvegarder directement en base de données

## 📋 Structure du Module

```
ai_workflow_generator/
├── __init__.py          # Exports publics
├── schemas.py           # Schémas Pydantic pour structured output
├── validator.py         # Validateur de workflows
├── generator.py         # Générateur de workflows par IA
└── README.md           # Cette documentation
```

## 🚀 Utilisation

### Depuis le Frontend (API REST)

#### 1. Générer un Workflow

**Endpoint** : `POST /ai-workflows/generate`

**Exemple de requête** :

```json
{
  "description": "Crée un agent de support client qui accueille l'utilisateur, identifie son problème, propose des solutions, et transfère vers un humain si nécessaire",
  "workflow_name": "Support Client IA",
  "temperature": 0.3,
  "save_to_database": true
}
```

**Réponse** :

```json
{
  "graph": {
    "nodes": [
      {
        "slug": "start",
        "kind": "start",
        "display_name": "Démarrage",
        ...
      },
      {
        "slug": "agent_accueil",
        "kind": "agent",
        "display_name": "Agent d'accueil",
        "parameters": {
          "model": "gpt-4o",
          "instructions": "Accueillez chaleureusement l'utilisateur..."
        },
        ...
      },
      ...
    ],
    "edges": [
      {
        "source": "start",
        "target": "agent_accueil"
      },
      ...
    ]
  },
  "workflow_name": "Support Client IA",
  "workflow_slug": "support_client_ia",
  "validation_passed": true,
  "validation_errors": [],
  "workflow_id": 42,
  "tokens_used": 1250
}
```

#### 2. Valider un Workflow

**Endpoint** : `POST /ai-workflows/validate`

**Exemple de requête** :

```json
{
  "graph": {
    "nodes": [...],
    "edges": [...]
  }
}
```

**Réponse** :

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    "Le workflow ne contient aucun nœud 'end'"
  ],
  "suggestions": [
    "Le nœud agent 'agent_principal' devrait avoir un max_iterations pour éviter les boucles infinies"
  ]
}
```

#### 3. Obtenir les Capacités

**Endpoint** : `GET /ai-workflows/capabilities`

Retourne les types de nœuds supportés, modèles IA disponibles, limites, etc.

### Depuis le Code Python

```python
from app.ai_workflow_generator import WorkflowAIGenerator, WorkflowGenerationRequest

# Créer une requête
request = WorkflowGenerationRequest(
    description="Crée un chatbot pour répondre aux questions fréquentes",
    workflow_name="FAQ Bot",
    temperature=0.3,
)

# Générer le workflow
generator = WorkflowAIGenerator()
response = await generator.generate(request)

# Vérifier la validation
if response.validation_passed:
    print(f"Workflow généré avec {len(response.graph.nodes)} nœuds")
else:
    print(f"Erreurs : {response.validation_errors}")
```

## 📝 Types de Nœuds Supportés

| Type | Description | Paramètres Requis |
|------|-------------|-------------------|
| `start` | Point d'entrée du workflow | Aucun |
| `agent` | Agent conversationnel IA | `agent_key`, `instructions` |
| `voice_agent` | Agent vocal | `agent_key`, `instructions` |
| `condition` | Branchement conditionnel | `expression` |
| `while` | Boucle conditionnelle | `expression` |
| `state` | Assignation de variable | `variable`, `value` |
| `assistant_message` | Message prédéfini de l'assistant | `content` |
| `user_message` | Message simulé de l'utilisateur | `content` |
| `widget` | Affichage d'un widget UI | Configuration du widget |
| `end` | Point de sortie du workflow | Aucun |

## ✅ Validation

Le validateur vérifie :

1. **Schéma Pydantic** : Format JSON conforme
2. **Structure** : Présence de nœuds start/end
3. **Connexions** : Validité des edges (source/target existent)
4. **Cycles** : Détection de boucles invalides
5. **Accessibilité** : Tous les nœuds sont accessibles depuis start
6. **Paramètres** : Validation spécifique par type de nœud

## 🛠️ Configuration

### Variables d'Environnement

```bash
# Clé API OpenAI (requis)
OPENAI_API_KEY=sk-...
```

### Modèles Supportés

- `gpt-4o-2024-08-06` (recommandé, supporte structured output)
- `gpt-4o-mini` (économique, supporte structured output)

**Important** : Seuls les modèles supportant structured output peuvent être utilisés.

## 📊 Exemples de Descriptions

### Support Client

```
Crée un agent de support client qui :
1. Accueille l'utilisateur avec un message chaleureux
2. Pose des questions pour identifier le problème
3. Recherche dans la base de connaissances
4. Propose des solutions étape par étape
5. Si le problème persiste, transfère vers un agent humain
```

### Assistant de Réservation

```
Crée un assistant de réservation de restaurant qui :
1. Demande la date et l'heure souhaitées
2. Vérifie les disponibilités
3. Demande le nombre de personnes
4. Propose des options de tables
5. Confirme la réservation
6. Envoie un email de confirmation
```

### Quiz Interactif

```
Crée un quiz interactif qui :
1. Présente le quiz et les règles
2. Pose 10 questions à choix multiples
3. Garde le score en mémoire
4. Affiche un récapitulatif final
5. Propose de recommencer
```

## 🔍 Débogage

### Activer les Logs

```python
import structlog
logger = structlog.get_logger()

# Les logs du générateur apparaîtront automatiquement
```

### Erreurs Communes

**"Une clé API OpenAI est requise"**
- Solution : Définir `OPENAI_API_KEY` dans les variables d'environnement

**"Aucun graphe n'a été généré par le modèle"**
- Solution : Vérifier que le modèle supporte structured output
- Vérifier que la description est suffisamment claire

**"Le workflow doit contenir au moins un nœud de type 'start'"**
- Solution : Le validateur a détecté un workflow invalide
- Vérifier la réponse de l'IA ou ajuster la description

## 📚 Ressources

- [Documentation OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [Documentation Pydantic](https://docs.pydantic.dev/)
- [Documentation FastAPI](https://fastapi.tiangolo.com/)

## 🤝 Contribution

Pour ajouter de nouveaux types de nœuds :

1. Ajouter le type dans `KNOWN_WORKFLOW_NODE_KINDS` (schemas.py)
2. Mettre à jour `WorkflowNodeSpec.kind` avec le nouveau type
3. Ajouter une validation spécifique dans `validator.py`
4. Mettre à jour le `SYSTEM_PROMPT` dans `generator.py`

## 📄 Licence

Ce code fait partie du projet test-chatkit.
