# Guide Complet : Infrastructure de Génération de Workflows par IA

## 🎯 Vue d'Ensemble

Cette infrastructure permet de générer des workflows conversationnels complets en utilisant l'IA (OpenAI structured output) avec **streaming en temps réel** via Celery/Redis et Server-Sent Events (SSE).

## ✅ Ce qui a été implémenté

### Backend (Python/FastAPI)

#### 1. Tâche Celery Asynchrone
**Fichier:** `backend/app/tasks/workflow_generation.py`

- Génération asynchrone avec Redis
- Mises à jour de progression en temps réel
- Étapes : init → prepare → generating → validating → saving → completed
- Gestion complète des erreurs
- Sauvegarde automatique en base de données (optionnelle)

#### 2. Endpoints API REST

**Fichiers:** `backend/app/routes/ai_workflows.py`

**Endpoints implémentés:**

```
POST   /ai-workflows/generate-async    # Démarre la génération asynchrone
GET    /ai-workflows/stream/{task_id}  # Stream SSE de progression
GET    /ai-workflows/status/{task_id}  # Statut de la tâche
POST   /ai-workflows/generate           # Génération synchrone (legacy)
POST   /ai-workflows/validate           # Validation de workflow
GET    /ai-workflows/capabilities       # Capacités du générateur
```

#### 3. Streaming Server-Sent Events (SSE)

- Progression en temps réel (toutes les 500ms)
- Détection de déconnexion client
- Format JSON structuré
- États: PENDING, PROGRESS, SUCCESS, FAILURE, ERROR

#### 4. Infrastructure de Validation

**Fichiers:** `backend/app/ai_workflow_generator/`

- `schemas.py` - Schémas Pydantic pour structured output
- `validator.py` - Validation complète des workflows
- `generator.py` - Générateur avec OpenAI
- Tests complets

### Frontend (React/TypeScript)

#### 1. Hook React avec SSE
**Fichier:** `frontend/src/hooks/useWorkflowGeneration.ts`

```typescript
const {
  progress,          // Progression en temps réel
  isGenerating,      // État de génération
  generatedWorkflow, // Workflow final
  error,             // Erreurs
  startGeneration,   // Démarrer
  cancelGeneration,  // Annuler
  reset,             // Réinitialiser
} = useWorkflowGeneration();
```

**Fonctionnalités:**
- Connexion EventSource automatique
- Nettoyage auto sur unmount
- Gestion d'erreurs SSE
- Invalidation cache React Query

#### 2. Modal de Génération
**Fichier:** `frontend/src/features/workflow-builder/components/GenerateWorkflowModal.tsx`

**UI Complète:**
- Formulaire de description
- Sélection de modèle (GPT-4o, GPT-4o Mini)
- Slider de température
- Option sauvegarde auto
- Barre de progression animée
- Indicateurs d'étapes visuels
- Affichage succès/erreurs
- Résumé du workflow généré

#### 3. Styles
**Fichier:** `frontend/src/styles/components/generate-workflow-modal.css`

- Design système cohérent
- Animations fluides
- Responsive mobile
- États visuels clairs

## 🚀 Utilisation

### Depuis le Frontend

```typescript
import { GenerateWorkflowModal } from './components/GenerateWorkflowModal';

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);

  const handleWorkflowGenerated = (workflow) => {
    console.log('Workflow généré:', workflow);
    // Utiliser le workflow dans le builder
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)}>
        Générer par IA
      </button>

      <GenerateWorkflowModal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        onWorkflowGenerated={handleWorkflowGenerated}
      />
    </>
  );
}
```

### Depuis l'API (curl)

```bash
# Démarrer la génération
curl -X POST http://localhost:8000/ai-workflows/generate-async \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Crée un chatbot de support client",
    "model": "gpt-4o-2024-08-06",
    "temperature": 0.3,
    "save_to_database": true
  }'

# Réponse: {"task_id": "abc-123", "status": "pending"}

# Streamer la progression (SSE)
curl http://localhost:8000/ai-workflows/stream/abc-123

# Obtenir le statut
curl http://localhost:8000/ai-workflows/status/abc-123
```

### Exemples de Descriptions

**Support Client:**
```
Crée un agent de support client qui :
1. Accueille l'utilisateur avec un message chaleureux
2. Pose des questions pour identifier le problème
3. Recherche dans la base de connaissances
4. Propose des solutions étape par étape
5. Si le problème persiste, transfère vers un agent humain
```

**Réservation Restaurant:**
```
Crée un assistant de réservation de restaurant qui :
1. Demande la date et l'heure souhaitées
2. Vérifie les disponibilités
3. Demande le nombre de personnes
4. Propose des options de tables
5. Confirme la réservation
6. Envoie un email de confirmation
```

## 🔧 Intégration dans le Workflow Builder

### Étape 1: Ajouter au ModalContext

**Fichier à modifier:** `frontend/src/features/workflow-builder/contexts/ModalContext.tsx`

```typescript
// Ajouter dans l'interface ModalContextType
isGenerateModalOpen: boolean;
openGenerateModal: () => void;
closeGenerateModal: () => void;

// Ajouter dans le state
const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);

// Ajouter dans le value
isGenerateModalOpen,
openGenerateModal: () => setIsGenerateModalOpen(true),
closeGenerateModal: () => setIsGenerateModalOpen(false),
```

### Étape 2: Ajouter au WorkflowBuilderModals

**Fichier à modifier:** `frontend/src/features/workflow-builder/components/WorkflowBuilderModals.tsx`

```typescript
import { GenerateWorkflowModal } from './GenerateWorkflowModal';

// Dans le composant, après les autres modals
const { isGenerateModalOpen, closeGenerateModal } = useModalContext();

return (
  <>
    {/* ... autres modals ... */}

    <GenerateWorkflowModal
      open={isGenerateModalOpen}
      onClose={closeGenerateModal}
      onWorkflowGenerated={handleWorkflowGenerated}
    />
  </>
);
```

### Étape 3: Ajouter le Bouton

**Fichier à modifier:** `frontend/src/features/workflow-builder/components/WorkflowBuilderHeader.tsx`

```typescript
import { Sparkles } from 'lucide-react';

// Dans le composant
const { openGenerateModal } = useModalContext();

// Ajouter le bouton dans le header
<button
  onClick={openGenerateModal}
  className="btn btn-primary"
  title="Générer un workflow par IA"
>
  <Sparkles size={16} />
  Générer par IA
</button>
```

## 📊 Format de Progression SSE

```json
{
  "task_id": "abc-123",
  "state": "PROGRESS",
  "status": "Génération du workflow avec gpt-4o...",
  "step": "generating",
  "current": 20,
  "total": 100,
  "description": "Crée un chatbot...",
  "nodes_count": null,
  "edges_count": null
}
```

**États possibles:**
- `PENDING` - En attente
- `PROGRESS` - En cours
- `SUCCESS` - Terminé avec succès
- `FAILURE` - Échec
- `ERROR` - Erreur

**Steps:**
- `init` - Initialisation (0%)
- `prepare` - Préparation (10%)
- `generating` - Génération IA (20%)
- `validating` - Validation (70%)
- `saving` - Sauvegarde (80%)
- `completed` - Terminé (100%)

## 🔒 Sécurité

- Authentification requise pour les endpoints
- Validation Pydantic stricte
- Structured output OpenAI (pas de JSON injection)
- Rate limiting (via slowapi)
- Timeout tasks Celery (1h max)

## ⚙️ Configuration

### Variables d'Environnement

```bash
# Backend
OPENAI_API_KEY=sk-...
CELERY_BROKER_URL=redis://localhost:6379/0

# Frontend (vite.config.ts)
# Proxy automatique vers le backend
```

### Modèles Supportés

- `gpt-4o-2024-08-06` (Recommandé) - Structured output
- `gpt-4o-mini` (Économique) - Structured output

## 📝 Page d'Administration (TODO)

Pour créer la page d'admin des paramètres IA :

**Fichier à créer:** `frontend/src/pages/AdminWorkflowGenerationPage.tsx`

```typescript
export default function AdminWorkflowGenerationPage() {
  return (
    <div className="admin-page">
      <h2>Paramètres de Génération de Workflows IA</h2>

      <FormSection title="Modèle par défaut">
        <select>
          <option value="gpt-4o-2024-08-06">GPT-4o</option>
          <option value="gpt-4o-mini">GPT-4o Mini</option>
        </select>
      </FormSection>

      <FormSection title="Température par défaut">
        <input type="range" min="0" max="1" step="0.1" />
      </FormSection>

      <FormSection title="Prompt système">
        <textarea rows={10} />
      </FormSection>

      <button type="submit">Sauvegarder</button>
    </div>
  );
}
```

**Ajouter dans:** `frontend/src/config/adminSections.ts`

```typescript
{
  key: "workflow-generation",
  labelKey: "admin.tabs.workflowGeneration",
  Component: lazy(() => import("../pages/AdminWorkflowGenerationPage")),
  requireAdmin: true,
}
```

## 🧪 Tests

### Tester le Backend

```bash
# Lancer Celery worker
cd backend
celery -A app.celery_app worker --loglevel=info

# Dans un autre terminal, lancer le backend
uvicorn app:app --reload

# Tester avec curl
curl -X POST http://localhost:8000/ai-workflows/generate-async \
  -H "Content-Type: application/json" \
  -d '{"description": "Test workflow"}'
```

### Tester le Frontend

```bash
cd frontend
npm run dev

# Ouvrir http://localhost:5173
# Cliquer sur "Générer par IA"
# Observer le streaming en temps réel
```

## 📦 Fichiers Créés

### Backend
```
backend/app/ai_workflow_generator/
├── __init__.py
├── schemas.py                    # Schémas Pydantic
├── validator.py                  # Validateur
├── generator.py                  # Générateur IA
├── example.py                    # Exemples
└── README.md                     # Documentation

backend/app/tasks/
└── workflow_generation.py        # Tâche Celery

backend/app/routes/
└── ai_workflows.py               # Endpoints API (mis à jour)

backend/app/tests/
└── test_ai_workflow_generator.py # Tests
```

### Frontend
```
frontend/src/hooks/
└── useWorkflowGeneration.ts      # Hook React + SSE

frontend/src/features/workflow-builder/components/
└── GenerateWorkflowModal.tsx     # Modal UI

frontend/src/styles/components/
└── generate-workflow-modal.css   # Styles
```

## 🎉 Résumé

✅ **Backend:** Génération asynchrone + streaming SSE complet
✅ **Frontend:** Hook React + Modal UI avec progression en temps réel
✅ **Validation:** Schémas Pydantic + validateur complet
✅ **Tests:** Suite de tests complète
✅ **Documentation:** README + exemples

**Prochaines étapes:**
1. Intégrer le modal dans ModalContext
2. Ajouter le bouton dans WorkflowBuilderHeader
3. Créer la page d'admin pour les paramètres
4. Tester end-to-end

Tous les commits ont été pushés sur la branche `claude/ai-workflow-generator-01TxEfe9QPLK92dD7fasmSRV`.
