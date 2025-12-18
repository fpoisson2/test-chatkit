# Workflow Builder - Reference des blocs

Ce document decrit l'ensemble des blocs disponibles dans le workflow builder de test-chatkit (edxo). Il est concu pour permettre a une IA de generer des workflows JSON valides.

## Structure d'un workflow

Un workflow est compose de deux tableaux principaux :

```json
{
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

### Structure d'un noeud (node)

```json
{
  "id": 100,
  "slug": "identifiant-unique-textuel",
  "kind": "type_du_bloc",
  "display_name": "Nom affiche dans l'editeur",
  "agent_key": null,
  "parent_slug": null,
  "position": 1,
  "is_enabled": true,
  "parameters": { },
  "metadata": { "order": 1 }
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `id` | integer | Identifiant unique numerique |
| `slug` | string | Identifiant textuel unique (reference par les edges) |
| `kind` | string | Type du bloc (voir sections ci-dessous) |
| `display_name` | string | Nom affiche dans l'editeur |
| `agent_key` | string/null | Reference a un agent predefini |
| `parent_slug` | string/null | Parent pour les noeuds imbriques (while) |
| `position` | integer | Ordre d'affichage |
| `is_enabled` | boolean | Noeud actif ou desactive |
| `parameters` | object | Configuration specifique au type |
| `metadata` | object | Metadonnees (order, position visuelle) |

### Structure d'une connexion (edge)

```json
{
  "id": 1001,
  "source": "slug-noeud-source",
  "target": "slug-noeud-cible",
  "condition": null,
  "metadata": { "label": "", "order": 1 }
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `id` | integer | Identifiant unique |
| `source` | string | Slug du noeud source |
| `target` | string | Slug du noeud cible |
| `condition` | string/null | Valeur pour les branchements (`"true"`, `"false"`, valeur specifique) |
| `metadata.label` | string | Label affiche sur la connexion |

---

## Blocs de controle de flux

### start

Point de depart obligatoire du workflow. Un seul par workflow.

**Parametres:**
```json
{
  "parameters": {
    "auto_start": true,
    "auto_start_message": "Message utilisateur initial (optionnel)",
    "auto_start_assistant_message": "Message assistant initial (optionnel)",
    "telephony_sip_account_id": null,
    "telephony_ring_timeout": 30,
    "telephony_speak_first": false,
    "lti_enabled": false,
    "lti_registration_ids": [],
    "lti_show_sidebar": true,
    "lti_show_header": true,
    "lti_enable_history": true
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `auto_start` | boolean | Demarre automatiquement le workflow |
| `auto_start_message` | string | Message utilisateur injecte au demarrage |
| `auto_start_assistant_message` | string | Message assistant affiche au demarrage |
| `telephony_*` | various | Configuration pour les workflows telephoniques |
| `lti_*` | various | Configuration pour l'integration LTI (education) |

**Exemple:**
```json
{
  "id": 1,
  "slug": "start",
  "kind": "start",
  "display_name": "Debut",
  "parameters": {
    "auto_start": true
  },
  "metadata": { "order": 1 }
}
```

---

### end

Point de fin du workflow. Plusieurs points de fin possibles.

**Parametres:**
```json
{
  "parameters": {
    "message": "Message de fin affiche a l'utilisateur",
    "status": {
      "type": "closed",
      "reason": "Raison de la fermeture"
    },
    "ags_variable_id": null,
    "ags_score_expression": null,
    "ags_maximum_expression": null
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `message` | string | Message final affiche |
| `status.type` | string | Type de cloture (`closed`, `completed`, etc.) |
| `status.reason` | string | Raison de la cloture |
| `ags_*` | various | Configuration AGS pour notation LTI |

**Exemple:**
```json
{
  "id": 999,
  "slug": "end-success",
  "kind": "end",
  "display_name": "Fin - Succes",
  "parameters": {
    "status": {
      "type": "closed",
      "reason": "Workflow complete avec succes"
    },
    "message": "Merci d'avoir utilise notre service!"
  },
  "metadata": { "order": 999 }
}
```

---

### condition

Branchement conditionnel base sur une valeur ou expression.

**Parametres:**
```json
{
  "parameters": {
    "path": "input.output_structured.ok",
    "mode": "value"
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `path` | string | Chemin vers la valeur a evaluer |
| `mode` | string | Mode d'evaluation (`value`, `equals`, `not_equals`, `contains`, etc.) |

**Chemins courants:**
- `input.output_structured.*` - Sortie structuree d'un agent
- `input.user_message` - Message texte de l'utilisateur
- `input.action.raw_payload.value.` - Valeur d'un widget
- `state.*` - Variable d'etat personnalisee
- `global.*` - Variable globale

**Connexions (edges):**
- Les branches sont definies par la propriete `condition` dans les edges
- Une branche sans condition (`null`) sert de fallback/default

**Exemple:**
```json
{
  "id": 10,
  "slug": "condition-evaluation",
  "kind": "condition",
  "display_name": "Reponse correcte?",
  "parameters": {
    "mode": "value",
    "path": "input.output_structured.ok"
  }
}
```

Avec les edges:
```json
[
  { "source": "condition-evaluation", "target": "success", "condition": "true" },
  { "source": "condition-evaluation", "target": "retry", "condition": "false" }
]
```

---

### while

Boucle repetitive avec condition de sortie. Peut contenir d'autres noeuds.

**Parametres:**
```json
{
  "parameters": {
    "condition": "state.get('compteur', 0) < 5",
    "max_iterations": 100,
    "iteration_var": "iteration"
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `condition` | string | Expression Python qui doit etre vraie pour continuer |
| `max_iterations` | number | Nombre maximum d'iterations (securite) |
| `iteration_var` | string | Nom de la variable compteur |

**Note:** Les noeuds enfants ont `parent_slug` defini vers le slug du while.

---

### parallel_split

Division en branches paralleles. Execute plusieurs chemins simultanement.

**Parametres:**
```json
{
  "parameters": {
    "join_slug": "parallel-join-1",
    "branches": [
      { "slug": "branch-a", "label": "Branche A" },
      { "slug": "branch-b", "label": "Branche B" }
    ]
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `join_slug` | string | Slug du noeud parallel_join correspondant |
| `branches` | array | Liste des branches avec slug et label |

---

### parallel_join

Convergence des branches paralleles. Attend toutes les branches avant de continuer.

**Parametres:** Aucun parametre specifique.

---

## Blocs de gestion d'etat

### state

Manipulation de variables d'etat et globales.

**Parametres:**
```json
{
  "parameters": {
    "state": [
      { "target": "state.compteur", "expression": "0" },
      { "target": "state.nom", "expression": "'valeur'" }
    ],
    "global": [
      { "target": "global.total", "expression": "state.get('compteur', 0) + 1" }
    ]
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `state` | array | Assignations de variables d'etat |
| `global` | array | Assignations de variables globales |

**Syntaxe des expressions (Python):**
- `"0"` - Valeur litterale numerique
- `"'texte'"` - Valeur litterale texte (guillemets simples a l'interieur)
- `"state.get('var', 0)"` - Lecture avec valeur par defaut
- `"(state.get('compteur', 0) or 0) + 1"` - Incrementation securisee

**Exemple - Initialisation:**
```json
{
  "slug": "state-init",
  "kind": "state",
  "display_name": "Initialisation compteur",
  "parameters": {
    "state": [
      { "target": "state.compteur", "expression": "0" }
    ]
  }
}
```

**Exemple - Incrementation:**
```json
{
  "slug": "state-incr",
  "kind": "state",
  "display_name": "Incrementation",
  "parameters": {
    "state": [
      { "target": "state.compteur", "expression": "(state.get('compteur', 0) or 0) + 1" }
    ]
  }
}
```

---

### transform

Transformation de donnees avec interpolation Jinja2.

**Parametres:**
```json
{
  "parameters": {
    "transform_expressions_text": "{\n  \"result\": \"{{ state.valeur }}\",\n  \"computed\": \"{{ input.data | int * 2 }}\"\n}"
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `transform_expressions_text` | string | JSON avec interpolation Jinja2 |

**Syntaxe:**
- `{{ state.variable }}` - Interpolation de variable d'etat
- `{{ input.champ }}` - Interpolation de donnee d'entree
- Filtres Jinja2 disponibles (`| int`, `| default('val')`, etc.)

---

### watch

Inspection du flux de donnees. Utile pour le debogage.

**Parametres:** Aucun parametre specifique.

**Note:** Affiche les variables disponibles depuis le noeud precedent sans les modifier.

---

## Blocs de messages

### assistant_message

Affiche un message de l'assistant a l'utilisateur.

**Parametres:**
```json
{
  "parameters": {
    "message": "Contenu du message avec **markdown** et {{ variables }}",
    "simulate_stream_delay_ms": 5
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `message` | string | Contenu du message (Markdown supporte) |
| `simulate_stream_delay_ms` | number | Delai en ms entre les caracteres (effet streaming) |

**Fonctionnalites:**
- Markdown complet supporte (titres, listes, tableaux, code, mermaid)
- Interpolation de variables avec `{{ state.variable }}`
- Streaming simule pour une experience plus naturelle

**Exemple:**
```json
{
  "slug": "message-bienvenue",
  "kind": "assistant_message",
  "display_name": "Message de bienvenue",
  "parameters": {
    "message": "# Bienvenue!\n\nJe suis votre assistant. Comment puis-je vous aider?",
    "simulate_stream_delay_ms": 5
  }
}
```

---

### user_message

Injecte un message utilisateur dans le flux de conversation.

**Parametres:**
```json
{
  "parameters": {
    "message": "Texte du message utilisateur"
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `message` | string | Texte injecte comme message utilisateur |

---

### wait_for_user_input

Pause le workflow et attend une entree utilisateur.

**Parametres:**
```json
{
  "parameters": {
    "message": "Message optionnel affiche avant l'attente"
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `message` | string | Message affiche avant l'attente (optionnel) |

**Sortie:**
- `input.user_message` - Texte saisi par l'utilisateur

**Exemple:**
```json
{
  "slug": "attente-reponse",
  "kind": "wait_for_user_input",
  "display_name": "Attente de la reponse",
  "parameters": {}
}
```

---

## Blocs d'agents IA

### agent

Appel a un agent IA pour traitement intelligent.

**Parametres complets:**
```json
{
  "parameters": {
    "model": "gpt-4o",
    "model_provider": "openai",
    "model_provider_slug": "openai",
    "instructions": "Instructions systeme pour l'agent...",
    "model_settings": {
      "text": { "verbosity": "low" },
      "reasoning": { "effort": "low" },
      "include_chat_history": true
    },
    "response_format": {
      "name": "workflow_output",
      "type": "json_schema",
      "schema": {
        "type": "object",
        "required": ["ok"],
        "properties": {
          "ok": { "type": "boolean" }
        }
      },
      "strict": true
    },
    "tools": []
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `model` | string | Nom du modele (`gpt-4o`, `gpt-5-nano`, `claude-3-5-sonnet`, etc.) |
| `model_provider` | string | Fournisseur (`openai`, `anthropic`, `google`) |
| `instructions` | string | Prompt systeme pour l'agent |
| `model_settings` | object | Configuration du modele |
| `response_format` | object | Schema JSON pour reponse structuree |
| `tools` | array | Outils disponibles pour l'agent |

**Modeles recommandes:**
- `gpt-5-nano` - Rapide et economique pour evaluation simple
- `gpt-4o` - Equilibre performance/cout
- `gpt-4o-mini` - Plus rapide que gpt-4o
- `claude-3-5-sonnet` - Alternative Anthropic

**Response format (sortie structuree):**
```json
{
  "response_format": {
    "name": "evaluation_result",
    "type": "json_schema",
    "schema": {
      "type": "object",
      "required": ["ok", "feedback"],
      "properties": {
        "ok": { "type": "boolean" },
        "feedback": { "type": "string" },
        "score": { "type": "number" }
      }
    },
    "strict": true
  }
}
```

**Sortie:**
- `input.output_structured.*` - Champs du JSON structure
- `input.output_text` - Reponse textuelle (si pas de format structure)

**Exemple - Agent evaluateur:**
```json
{
  "slug": "agent-eval",
  "kind": "agent",
  "display_name": "Evaluation de la reponse",
  "parameters": {
    "model": "gpt-5-nano",
    "model_provider": "openai",
    "model_provider_slug": "openai",
    "instructions": "Evalue si la reponse de l'utilisateur est correcte.\n\nCriteres:\n- Point 1\n- Point 2\n\nSi correct: ok=true\nSinon: ok=false",
    "model_settings": {
      "text": { "verbosity": "low" },
      "reasoning": { "effort": "low" },
      "include_chat_history": true
    },
    "response_format": {
      "name": "workflow_output",
      "type": "json_schema",
      "schema": {
        "type": "object",
        "required": ["ok"],
        "properties": {
          "ok": { "type": "boolean" }
        }
      },
      "strict": true
    }
  }
}
```

---

### voice_agent

Agent vocal utilisant l'API Realtime d'OpenAI.

**Parametres:**
```json
{
  "parameters": {
    "voice": "alloy",
    "instructions": "Instructions pour l'agent vocal",
    "model": "gpt-4o-realtime-preview",
    "tools": []
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `voice` | string | Voix utilisee (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`) |
| `instructions` | string | Instructions pour l'agent |
| `model` | string | Modele Realtime |
| `tools` | array | Outils vocaux disponibles |

---

### computer_use

Agent capable d'utiliser un ordinateur via SSH. Permet d'executer des commandes shell et de modifier des fichiers sur une machine distante de facon autonome.

**Parametres:**
```json
{
  "parameters": {
    "display_width": 1920,
    "display_height": 1080,
    "environment": "ssh",
    "mode": "agent",
    "ssh_host": "192.168.1.100",
    "ssh_port": 22,
    "ssh_username": "user",
    "ssh_password": "password",
    "ssh_private_key": null,
    "instructions": "Instructions specifiques pour l'agent..."
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `display_width` | number | Largeur pour le rendu (typiquement 1920) |
| `display_height` | number | Hauteur pour le rendu (typiquement 1080) |
| `environment` | string | Type d'environnement - utiliser `ssh` |
| `mode` | string | Mode d'operation (`agent` pour autonome, `manual` pour interactif) |
| `ssh_host` | string | Adresse IP ou hostname du serveur SSH |
| `ssh_port` | number | Port SSH (defaut: 22) |
| `ssh_username` | string | Nom d'utilisateur SSH |
| `ssh_password` | string | Mot de passe SSH (ou utiliser ssh_private_key) |
| `ssh_private_key` | string | Cle privee SSH (alternative au mot de passe) |
| `instructions` | string | Instructions systeme pour guider l'agent |

**Outils disponibles pour computer_use:**

#### 1. Shell Tool

Execute des commandes shell sur la machine distante via SSH. L'agent peut :
- Executer n'importe quelle commande bash/shell
- Lire des fichiers avec `cat`, `less`, `head`, `tail`
- Naviguer dans le systeme de fichiers
- Installer des paquets (si sudo disponible)
- Compiler et executer du code
- Gerer des services systemd
- Manipuler des conteneurs Docker

**Exemples de commandes:**
```bash
# Exploration du systeme
ls -la /home/user/project/
cat /etc/hosts
pwd

# Developpement
git clone https://github.com/user/repo.git
cd project && npm install
python3 script.py
./run_tests.sh

# Administration
sudo systemctl status nginx
docker ps
journalctl -u myservice -n 50
```

**Timeout:** 30 secondes par commande par defaut.

#### 2. ApplyPatch Tool

Modifie des fichiers de maniere structuree en utilisant un format de patch. Permet des modifications atomiques et traçables.

**Format du patch:**

**Creer un fichier:**
```
*** Begin Patch
*** Add File: /path/to/new_file.py
+#!/usr/bin/env python3
+
+def hello():
+    print("Hello World")
+
+if __name__ == "__main__":
+    hello()
*** End Patch
```

**Modifier un fichier existant:**
```
*** Begin Patch
*** Update File: /path/to/existing_file.py
 def hello():
-    print("Hello World")
+    print("Hello, Universe!")
+    print("Welcome!")

 if __name__ == "__main__":
*** End Patch
```

**Supprimer un fichier:**
```
*** Begin Patch
*** Delete File: /path/to/file_to_delete.py
*** End Patch
```

**Syntaxe du patch:**
- Lignes commencant par `+` : ajout
- Lignes commencant par `-` : suppression
- Lignes commencant par ` ` (espace) : contexte (inchangees)
- Le contexte aide a localiser ou appliquer les modifications

**Avantages de ApplyPatch:**
- Modifications atomiques et reversibles
- Contexte clair des changements (diff lisible)
- Reduction des erreurs par rapport a l'edition complete
- Meilleur taux de reussite que les formats JSON bruts

**Exemple complet de workflow avec computer_use:**
```json
{
  "slug": "dev-agent",
  "kind": "computer_use",
  "display_name": "Agent de developpement",
  "parameters": {
    "environment": "ssh",
    "mode": "agent",
    "ssh_host": "dev-server.local",
    "ssh_port": 22,
    "ssh_username": "developer",
    "ssh_password": "secret123",
    "display_width": 1920,
    "display_height": 1080,
    "instructions": "Tu es un assistant de developpement. Tu as acces a un serveur Linux via SSH. Tu peux executer des commandes et modifier des fichiers. Sois prudent avec les commandes destructives. Explique ce que tu fais avant de le faire."
  }
}
```

**Cas d'utilisation:**
- Automatisation de taches DevOps
- Debugging de problemes sur serveurs distants
- Deploiement d'applications
- Configuration de services
- Refactoring de code assiste par IA
- Generation de code et tests

---

### outbound_call

Declenche un appel telephonique sortant.

**Parametres:**
```json
{
  "parameters": {
    "to_number": "+15551234567",
    "voice_workflow_id": 123,
    "sip_account_id": 1,
    "wait_for_completion": true
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `to_number` | string | Numero de telephone a appeler |
| `voice_workflow_id` | number | ID du workflow vocal a executer |
| `sip_account_id` | number | Compte SIP a utiliser |
| `wait_for_completion` | boolean | Attendre la fin de l'appel |

---

## Outils disponibles pour les agents

Les agents (`agent`, `voice_agent`, `computer_use`) peuvent avoir acces a differents outils.

### Outils integres (Function Tools)

| Outil | Description | Configuration |
|-------|-------------|---------------|
| `weather` | Obtient la meteo d'un lieu | Toggle dans l'interface |
| `widget_validation` | Valide un widget | Toggle dans l'interface |
| `workflow_validation` | Valide un workflow | Toggle dans l'interface |

### Outils de recherche

| Outil | Description |
|-------|-------------|
| `web_search` | Recherche sur le web |
| `file_search` | Recherche dans des fichiers/documents |
| `image_generation` | Generation d'images |

### Outils de developpement (Computer Use)

#### Shell Tool

Permet a l'agent d'executer des commandes shell sur une machine distante via SSH.

**Utilisation:** L'agent peut executer n'importe quelle commande shell sur la machine cible.

```
Exemples de commandes:
- ls -la /home/user/
- cat /etc/hosts
- python3 script.py
- npm install && npm run build
```

#### ApplyPatch Tool

Permet a l'agent de creer, modifier et supprimer des fichiers en utilisant des diffs structures.

**Operations supportees:**

1. **Creer un fichier:**
```
*** Begin Patch
*** Add File: /path/to/new_file.py
+def hello():
+    print("Hello World")
+
+if __name__ == "__main__":
+    hello()
*** End Patch
```

2. **Modifier un fichier:**
```
*** Begin Patch
*** Update File: /path/to/existing_file.py
 def hello():
-    print("Hello World")
+    print("Hello, Universe!")

 if __name__ == "__main__":
*** End Patch
```

3. **Supprimer un fichier:**
```
*** Begin Patch
*** Delete File: /path/to/file_to_delete.py
*** End Patch
```

**Avantages:**
- Modifications atomiques et reversibles
- Contexte clair des changements
- Reduction des erreurs par rapport a l'edition manuelle
- Taux de reussite 35% superieur aux formats JSON

### Serveurs MCP (Model Context Protocol)

Les agents peuvent se connecter a des serveurs MCP externes pour acceder a des outils personnalises.

**Configuration dans l'interface:**
1. Ajouter un serveur MCP (URL + authentification)
2. Selectionner les outils a activer
3. Optionnel: restreindre a certains outils specifiques

### Outils de workflow

Les agents peuvent declencher d'autres workflows comme outils.

**Configuration:**
- Selectionner les workflows disponibles dans l'interface
- L'agent peut appeler ces workflows comme des fonctions

---

## Blocs d'interaction

### widget

Widget interactif (boutons, formulaires, etc.).

**Parametres:**
```json
{
  "parameters": {
    "widget": {
      "slug": "pret-a-debuter",
      "source": "library",
      "variables": {
        "text": "Je suis pret!",
        "button_label": "Continuer"
      }
    }
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `widget.slug` | string | Identifiant du widget dans la bibliotheque |
| `widget.source` | string | Source du widget (`library`, `custom`) |
| `widget.variables` | object | Variables de configuration du widget |

**Widgets courants:**
- `pret-a-debuter` - Bouton de confirmation simple
- `choix-multiple` - Selection parmi plusieurs options
- `formulaire` - Formulaire avec champs

**Sortie:**
- `input.action.raw_payload.value.` - Valeur du widget (souvent `true`/`false`)

**Exemple:**
```json
{
  "slug": "widget-confirmation",
  "kind": "widget",
  "display_name": "Confirmation",
  "parameters": {
    "widget": {
      "slug": "pret-a-debuter",
      "source": "library",
      "variables": {
        "text": "J'ai compris, je suis pret a continuer!"
      }
    }
  }
}
```

---

## Blocs de donnees

### json_vector_store

Indexation de donnees dans un vector store pour recherche semantique.

**Parametres:**
```json
{
  "parameters": {
    "vector_store_slug": "mon-vector-store",
    "doc_id_expression": "{{ state.doc_id }}",
    "document_expression": "{{ input.data | tojson }}",
    "metadata_expression": "{ \"type\": \"article\" }",
    "blueprint_expression": null
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `vector_store_slug` | string | Identifiant du vector store cible |
| `doc_id_expression` | string | Expression pour l'ID du document |
| `document_expression` | string | JSON a indexer |
| `metadata_expression` | string | Metadonnees du document |

---

### docx_template

Generation de document DOCX a partir d'un template.

**Parametres:**
```json
{
  "parameters": {
    "template_path": "/path/to/template.docx",
    "output_path": "output.docx",
    "data_text": "{ \"nom\": \"{{ state.nom }}\", \"date\": \"{{ state.date }}\" }"
  }
}
```

| Parametre | Type | Description |
|-----------|------|-------------|
| `template_path` | string | Chemin vers le template DOCX |
| `output_path` | string | Nom du fichier de sortie |
| `data_text` | string | JSON de donnees pour le template |

**Note:** Ce bloc est en developpement.

---

## Patterns de workflow courants

### Pattern 1: Sequence lineaire simple

```
start → assistant_message → wait_for_user_input → agent → end
```

### Pattern 2: Branchement conditionnel

```
start → assistant_message → wait_for_user_input → agent
    → condition (ok?)
        → true: assistant_message (succes) → end
        → false: assistant_message (echec) → end
```

### Pattern 3: Boucle de validation avec limite de tentatives

```
start → assistant_message (question) → state (init compteur=0)
    → wait_for_user_input → agent (evaluation)
    → condition (ok?)
        → true: assistant_message (succes) → suite...
        → false: state (compteur++) → condition (compteur >= 3?)
            → oui: assistant_message (aide) → wait_for_user_input → condition (code?)
                → correct: suite...
                → incorrect: boucle...
            → non: agent (retroaction) → wait_for_user_input (reboucle vers evaluation)
```

### Pattern 4: Confirmation par widget

```
assistant_message → widget (bouton) → condition
    → true: continuer
    → autre: end (abandon)
```

### Pattern 5: Workflow parallele

```
start → parallel_split
    → branche A: agent_1 → transform_A
    → branche B: agent_2 → transform_B
    → parallel_join → agent (synthese) → end
```

### Pattern 6: Agent de developpement (Computer Use)

```
start → assistant_message (contexte)
    → computer_use (avec shell + apply_patch)
        → L'agent analyse, execute des commandes, modifie des fichiers
    → assistant_message (rapport) → end
```

---

## Acces aux donnees dans les expressions

| Path | Description |
|------|-------------|
| `input.user_message` | Message texte de l'utilisateur |
| `input.output_structured.*` | Sortie structuree d'un agent |
| `input.output_text` | Sortie textuelle d'un agent |
| `input.action.raw_payload.value.` | Valeur d'un widget |
| `state.*` | Variables d'etat (portee: session) |
| `global.*` | Variables globales (portee: workflow) |

---

## Conventions de nommage des slugs

- Format recommande: `type-description-numero`
- Exemples:
  - `start`
  - `assistant-message-intro`
  - `widget-confirmation-1`
  - `condition-evaluation-q1`
  - `state-init-compteur`
  - `agent-eval-reponse`
  - `end-success`
  - `end-abandon`

---

## Exemple de workflow complet

```json
{
  "nodes": [
    {
      "id": 1,
      "slug": "start",
      "kind": "start",
      "display_name": "Debut",
      "parameters": { "auto_start": true },
      "metadata": { "order": 1 }
    },
    {
      "id": 2,
      "slug": "assistant-message-bienvenue",
      "kind": "assistant_message",
      "display_name": "Bienvenue",
      "parameters": {
        "message": "Bienvenue! Je vais vous poser une question.",
        "simulate_stream_delay_ms": 5
      },
      "metadata": { "order": 2 }
    },
    {
      "id": 3,
      "slug": "assistant-message-question",
      "kind": "assistant_message",
      "display_name": "Question",
      "parameters": {
        "message": "Quelle est la capitale de la France?",
        "simulate_stream_delay_ms": 5
      },
      "metadata": { "order": 3 }
    },
    {
      "id": 4,
      "slug": "wait-reponse",
      "kind": "wait_for_user_input",
      "display_name": "Attente reponse",
      "parameters": {},
      "metadata": { "order": 4 }
    },
    {
      "id": 5,
      "slug": "agent-evaluation",
      "kind": "agent",
      "display_name": "Evaluation",
      "parameters": {
        "model": "gpt-5-nano",
        "model_provider": "openai",
        "model_provider_slug": "openai",
        "instructions": "Evalue si la reponse mentionne 'Paris'. Si oui: ok=true. Sinon: ok=false.",
        "model_settings": {
          "text": { "verbosity": "low" },
          "reasoning": { "effort": "low" },
          "include_chat_history": true
        },
        "response_format": {
          "name": "workflow_output",
          "type": "json_schema",
          "schema": {
            "type": "object",
            "required": ["ok"],
            "properties": { "ok": { "type": "boolean" } }
          },
          "strict": true
        }
      },
      "metadata": { "order": 5 }
    },
    {
      "id": 6,
      "slug": "condition-resultat",
      "kind": "condition",
      "display_name": "Resultat?",
      "parameters": {
        "mode": "value",
        "path": "input.output_structured.ok"
      },
      "metadata": { "order": 6 }
    },
    {
      "id": 7,
      "slug": "assistant-message-succes",
      "kind": "assistant_message",
      "display_name": "Succes",
      "parameters": {
        "message": "Bravo! C'est bien Paris.",
        "simulate_stream_delay_ms": 5
      },
      "metadata": { "order": 7 }
    },
    {
      "id": 8,
      "slug": "assistant-message-echec",
      "kind": "assistant_message",
      "display_name": "Echec",
      "parameters": {
        "message": "Non, la bonne reponse etait Paris.",
        "simulate_stream_delay_ms": 5
      },
      "metadata": { "order": 8 }
    },
    {
      "id": 9,
      "slug": "end-success",
      "kind": "end",
      "display_name": "Fin",
      "parameters": {
        "status": { "type": "closed", "reason": "Complete" },
        "message": "Merci d'avoir participe!"
      },
      "metadata": { "order": 9 }
    }
  ],
  "edges": [
    { "id": 1, "source": "start", "target": "assistant-message-bienvenue", "condition": null, "metadata": {} },
    { "id": 2, "source": "assistant-message-bienvenue", "target": "assistant-message-question", "condition": null, "metadata": {} },
    { "id": 3, "source": "assistant-message-question", "target": "wait-reponse", "condition": null, "metadata": {} },
    { "id": 4, "source": "wait-reponse", "target": "agent-evaluation", "condition": null, "metadata": {} },
    { "id": 5, "source": "agent-evaluation", "target": "condition-resultat", "condition": null, "metadata": {} },
    { "id": 6, "source": "condition-resultat", "target": "assistant-message-succes", "condition": "true", "metadata": { "label": "true" } },
    { "id": 7, "source": "condition-resultat", "target": "assistant-message-echec", "condition": "false", "metadata": { "label": "false" } },
    { "id": 8, "source": "assistant-message-succes", "target": "end-success", "condition": null, "metadata": {} },
    { "id": 9, "source": "assistant-message-echec", "target": "end-success", "condition": null, "metadata": {} }
  ]
}
```

---

## Notes pour la generation par IA

1. **Toujours inclure un `start` et au moins un `end`**
2. **Les IDs doivent etre uniques** - numeriques croissants
3. **Les slugs doivent etre uniques** - descriptifs et en kebab-case
4. **Les edges doivent former un graphe connexe** - chaque noeud (sauf end) doit avoir au moins une sortie
5. **Les conditions dans les edges** correspondent aux valeurs possibles du path defini
6. **Pour les agents avec response_format**, le schema JSON doit etre valide
7. **Les expressions Python dans state** doivent etre valides
8. **L'ordre des metadata** affecte l'affichage visuel dans l'editeur
9. **Pour computer_use**, configurer SSH et specifier les outils (shell, apply_patch)
10. **Les outils MCP** doivent etre configures dans l'interface avant utilisation
