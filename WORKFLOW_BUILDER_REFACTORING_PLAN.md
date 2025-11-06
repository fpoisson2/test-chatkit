# Plan de Refactorisation - WorkflowBuilderPage

## Vue d'ensemble

**Fichier cible:** `frontend/src/features/workflow-builder/WorkflowBuilderPage.tsx`

**Situation actuelle:**
- 2,939 lignes de code dans un seul composant
- 46+ variables d'état
- 35+ refs
- 60+ gestionnaires d'événements
- Complexité cyclomatique: 6-8 (élevée)
- Index de maintenabilité: FAIBLE

**Objectif:** Transformer ce composant monolithique en une architecture modulaire, maintenable et testable.

---

## Phase 1: Préparation et Analyse ✅

### 1.1 Analyse complète du code existant
- [x] Analyser la structure du fichier
- [x] Identifier tous les composants, hooks et fonctions
- [x] Documenter les responsabilités de chaque partie
- [x] Identifier les problèmes de code et opportunités de refactorisation

### 1.2 Documentation
- [x] Créer le document d'analyse (`WORKFLOW_BUILDER_ANALYSIS.md`)
- [x] Créer le plan de refactorisation (ce document)

---

## Phase 2: Extraction des Contextes de Gestion d'État

**Objectif:** Réduire les 46+ variables d'état et éliminer le prop drilling

### 2.1 Créer WorkflowContext

**Fichier:** `frontend/src/features/workflow-builder/contexts/WorkflowContext.tsx`

**État à extraire:**
```typescript
- workflows: Workflow[]
- hostedWorkflows: HostedWorkflow[]
- selectedWorkflowId: string | number | null
- versions: WorkflowVersionSummary[]
- selectedVersionId: number | null
- selectedVersionDetail: WorkflowVersionResponse | null
- draftVersionId: number | null
- draftVersionSummary: WorkflowVersionSummary | null
- loading: boolean
- loadError: string | null
```

**Méthodes à fournir:**
```typescript
- loadWorkflows()
- loadHostedWorkflows()
- loadVersions(workflowId)
- loadVersionDetail(versionId)
- selectWorkflow(id)
- selectVersion(id)
- createWorkflow(data)
- deleteWorkflow(id)
- duplicateWorkflow(id)
- renameWorkflow(id, name)
```

**Impact:** Réduit ~15 variables d'état et ~10 handlers du composant principal

---

### 2.2 Créer SelectionContext

**Fichier:** `frontend/src/features/workflow-builder/contexts/SelectionContext.tsx`

**État à extraire:**
```typescript
- selectedNodeId: string | null
- selectedEdgeId: string | null
- selectedNodeIds: Set<string>
- selectedEdgeIds: Set<string>
- previousSelectedElement: { type: string; id: string } | null
```

**Méthodes à fournir:**
```typescript
- selectNode(id)
- selectEdge(id)
- selectMultipleNodes(ids)
- selectMultipleEdges(ids)
- clearSelection()
- handleSelectionChange(selection)
```

**Impact:** Simplifie la gestion de sélection, réduit ~8 variables d'état

---

### 2.3 Créer GraphContext

**Fichier:** `frontend/src/features/workflow-builder/contexts/GraphContext.tsx`

**État à extraire:**
```typescript
- nodes: FlowNode[]
- edges: FlowEdge[]
- graphSnapshot: string
- hasPendingChanges: boolean
- isNodeDragInProgress: boolean
```

**Méthodes à fournir:**
```typescript
- setNodes(nodes)
- setEdges(edges)
- addNode(node)
- updateNode(id, data)
- removeNode(id)
- updateEdge(id, data)
- removeEdge(id)
- onNodesChange(changes)
- onEdgesChange(changes)
- onConnect(connection)
- buildGraphPayload()
- updateHasPendingChanges()
```

**Impact:** Centralise la logique du graphe, réduit ~10 variables d'état

---

### 2.4 Créer SaveContext

**Fichier:** `frontend/src/features/workflow-builder/contexts/SaveContext.tsx`

**État à extraire:**
```typescript
- saveState: SaveState ("idle" | "saving" | "saved" | "error")
- saveMessage: string | null
- lastSavedSnapshot: string
```

**Méthodes à fournir:**
```typescript
- save()
- markAsSaving()
- markAsSaved()
- markAsError(message)
- resetSaveState()
```

**Impact:** Simplifie la logique de sauvegarde, réduit ~5 variables d'état

---

### 2.5 Créer ModalContext

**Fichier:** `frontend/src/features/workflow-builder/contexts/ModalContext.tsx`

**État à extraire:**
```typescript
- isCreateModalOpen: boolean
- isDeployModalOpen: boolean
- isAppearanceModalOpen: boolean
- createWorkflowKind: "local" | "hosted"
- createWorkflowName: string
- createWorkflowRemoteId: string
- createWorkflowError: string | null
- isCreatingWorkflow: boolean
- deployToProduction: boolean
- isDeploying: boolean
```

**Méthodes à fournir:**
```typescript
- openCreateModal(kind?)
- closeCreateModal()
- openDeployModal(toProduction?)
- closeDeployModal()
- openAppearanceModal()
- closeAppearanceModal()
- setCreateWorkflowData(data)
- submitCreateWorkflow()
- confirmDeploy()
```

**Impact:** Centralise toute la logique des modales, réduit ~12 variables d'état

---

### 2.6 Créer ViewportContext

**Fichier:** `frontend/src/features/workflow-builder/contexts/ViewportContext.tsx`

**État à extraire:**
```typescript
- viewport: Viewport
- minViewportZoom: number
- initialViewport: Viewport | undefined
- viewportMemory: Map<string, Viewport>
- hasUserViewportChange: boolean
- pendingViewportRestore: boolean
```

**Méthodes à fournir:**
```typescript
- saveViewport(key, viewport)
- restoreViewport(key)
- updateViewport(viewport)
- calculateMinZoom()
- refreshViewportConstraints()
- viewportKeyFor(workflowId, versionId, deviceType)
```

**Impact:** Isole la logique complexe du viewport, réduit ~8 variables d'état

---

### 2.7 Créer UIContext

**Fichier:** `frontend/src/features/workflow-builder/contexts/UIContext.tsx`

**État à extraire:**
```typescript
- isBlockLibraryOpen: boolean
- isPropertiesPanelOpen: boolean
- isMobileLayout: boolean
- deviceType: DeviceType
- openWorkflowMenuId: string | number | null
```

**Méthodes à fournir:**
```typescript
- toggleBlockLibrary()
- openBlockLibrary()
- closeBlockLibrary()
- togglePropertiesPanel()
- openPropertiesPanel()
- closePropertiesPanel()
- openWorkflowMenu(id)
- closeWorkflowMenu()
```

**Impact:** Gère l'état de l'UI, réduit ~6 variables d'état

---

## Phase 3: Création des Hooks Personnalisés

**Objectif:** Extraire la logique métier complexe en hooks réutilisables

### 3.1 Créer useWorkflowGraph

**Fichier:** `frontend/src/features/workflow-builder/hooks/useWorkflowGraph.ts`

**Responsabilités:**
- Gestion de l'état du graphe (nodes, edges)
- Opérations sur les nœuds (add, update, remove, decorate)
- Opérations sur les edges (add, update, remove)
- Gestion des changements ReactFlow
- Construction du payload pour l'API
- Validation de la structure du graphe

**Fonctions fournies:**
```typescript
const {
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  addNode,
  updateNodeData,
  removeNode,
  updateEdge,
  removeEdge,
  buildGraphPayload,
  graphSnapshot,
  conditionGraphError
} = useWorkflowGraph(initialNodes, initialEdges)
```

**Impact:** Réduit ~150 lignes du composant principal

---

### 3.2 Créer useVersionManagement

**Fichier:** `frontend/src/features/workflow-builder/hooks/useVersionManagement.ts`

**Responsabilités:**
- Gestion des versions (draft, production)
- Chargement des détails de version
- Promotion/déploiement de versions
- Résolution de la version à promouvoir
- Gestion du polling des changements distants

**Fonctions fournies:**
```typescript
const {
  versions,
  selectedVersionId,
  selectedVersionDetail,
  draftVersionId,
  draftVersionSummary,
  loadVersions,
  loadVersionDetail,
  selectVersion,
  resolveVersionIdToPromote,
  deployVersion,
  isDeploying
} = useVersionManagement(workflowId)
```

**Impact:** Réduit ~200 lignes du composant principal

---

### 3.3 Créer useWorkflowOperations

**Fichier:** `frontend/src/features/workflow-builder/hooks/useWorkflowOperations.ts`

**Responsabilités:**
- Opérations CRUD sur les workflows
- Gestion des erreurs API
- Retry logic avec endpoint candidates
- Invalidation du cache

**Fonctions fournies:**
```typescript
const {
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  renameWorkflow,
  isProcessing,
  error
} = useWorkflowOperations()
```

**Impact:** Réduit ~300 lignes du composant principal

---

### 3.4 Créer useRefSynchronization

**Fichier:** `frontend/src/features/workflow-builder/hooks/useRefSynchronization.ts`

**Responsabilités:**
- Synchroniser les refs avec l'état React
- Gérer les 10+ refs qui nécessitent une synchronisation
- Pattern réutilisable pour d'autres composants

**Fonctions fournies:**
```typescript
const syncedRefs = useRefSynchronization({
  nodes,
  edges,
  versions,
  hasPendingChanges,
  saveState,
  selectedWorkflowId,
  selectedVersionId,
  selectedNodeId,
  selectedEdgeId
})
```

**Impact:** Réduit ~50 lignes et simplifie les effets

---

### 3.5 Créer useApiRetry

**Fichier:** `frontend/src/features/workflow-builder/hooks/useApiRetry.ts`

**Responsabilités:**
- Logique de retry avec endpoint candidates
- Gestion des AbortController pour annulation
- Gestion des timeouts
- Pattern réutilisable pour tous les appels API

**Fonctions fournies:**
```typescript
const { fetchWithRetry, abort } = useApiRetry(backendUrl, authHeader)
```

**Impact:** Réduit la duplication de code, ajoute l'annulation des requêtes

---

### 3.6 Créer useWorkflowValidation

**Fichier:** `frontend/src/features/workflow-builder/hooks/useWorkflowValidation.ts`

**Responsabilités:**
- Validation de la structure du graphe
- Validation des paramètres des nœuds
- Validation des références (vector stores, widgets)
- Calcul de disableSave

**Fonctions fournies:**
```typescript
const {
  conditionGraphError,
  hasParameterErrors,
  hasVectorStoreErrors,
  hasWidgetErrors,
  disableSave,
  validationMessage
} = useWorkflowValidation(nodes, edges, resources)
```

**Impact:** Réduit ~75 lignes de logique de validation complexe

---

### 3.7 Créer useMobileDoubleTap

**Fichier:** `frontend/src/features/workflow-builder/hooks/useMobileDoubleTap.ts`

**Responsabilités:**
- Gestion du double-tap pour mobile
- Timeout de reset
- Pattern réutilisable

**Fonctions fournies:**
```typescript
const { handleTap, resetTap } = useMobileDoubleTap(
  onDoubleTap,
  timeoutMs = 300
)
```

**Impact:** Réduit ~30 lignes et simplifie la logique mobile

---

## Phase 4: Séparation des Composants UI

**Objectif:** Diviser le composant de 2,939 lignes en composants focalisés

### 4.1 Créer WorkflowBuilderContainer

**Fichier:** `frontend/src/features/workflow-builder/WorkflowBuilderContainer.tsx`

**Responsabilités:**
- Orchestration de haut niveau
- Fournir tous les contextes
- Gérer les providers
- Initialisation de l'application

**Structure:**
```tsx
export default function WorkflowBuilderContainer() {
  return (
    <ReactFlowProvider>
      <WorkflowProvider>
        <SelectionProvider>
          <GraphProvider>
            <SaveProvider>
              <ModalProvider>
                <ViewportProvider>
                  <UIProvider>
                    <WorkflowBuilderPage />
                  </UIProvider>
                </ViewportProvider>
              </ModalProvider>
            </SaveProvider>
          </GraphProvider>
        </SelectionProvider>
      </WorkflowProvider>
    </ReactFlowProvider>
  )
}
```

**Taille estimée:** ~150 lignes

---

### 4.2 Créer WorkflowBuilderPage (refactorisé)

**Fichier:** `frontend/src/features/workflow-builder/WorkflowBuilderPage.tsx`

**Responsabilités:**
- Layout principal
- Composition des sous-composants
- Gestion des raccourcis clavier globaux
- Coordination entre les parties

**Structure:**
```tsx
export default function WorkflowBuilderPage() {
  // Utilise les contextes au lieu de l'état local
  // Compose les sous-composants

  return (
    <>
      <WorkflowBuilderSidebar />
      <WorkflowBuilderMain>
        <WorkflowBuilderHeader />
        <WorkflowBuilderCanvas />
        <WorkflowBuilderBlockLibrary />
        <WorkflowBuilderPropertiesPanel />
      </WorkflowBuilderMain>
      <WorkflowBuilderModals />
      <WorkflowBuilderToast />
    </>
  )
}
```

**Taille estimée:** ~300 lignes (réduction de 90%)

---

### 4.3 Créer WorkflowBuilderHeader

**Fichier:** `frontend/src/features/workflow-builder/components/WorkflowBuilderHeader.tsx`

**Responsabilités:**
- Affichage de l'en-tête
- Sélecteur de version
- Boutons d'action (Import/Export/Deploy)
- Description et rappel de publication

**Props:** Aucune (utilise les contextes)

**Taille estimée:** ~200 lignes

---

### 4.4 Créer WorkflowBuilderCanvas

**Fichier:** `frontend/src/features/workflow-builder/components/WorkflowBuilderCanvas.tsx`

**Responsabilités:**
- Wrapper ReactFlow
- Gestion du viewport
- Handlers de drag & drop
- Handlers de clic
- Gestion de la sélection

**Props réduites:** ~15 au lieu de 50+

```typescript
interface WorkflowBuilderCanvasProps {
  // ReactFlow specific
  nodeTypes: NodeTypes
  edgeTypes: EdgeTypes
  defaultEdgeOptions: DefaultEdgeOptions

  // Styling
  proOptions: ProOptions

  // Refs (si nécessaire)
  reactFlowWrapperRef?: RefObject<HTMLDivElement>
}
```

**Taille estimée:** ~400 lignes

---

### 4.5 Créer WorkflowBuilderSidebar (refactorisé)

**Fichier:** `frontend/src/features/workflow-builder/components/WorkflowBuilderSidebar.tsx`

**Responsabilités:**
- Liste des workflows
- Menu de workflow
- Actions de création/suppression
- État de pinned

**Props réduites:** ~8 au lieu de 20+

**Taille estimée:** ~300 lignes

---

### 4.6 Créer WorkflowBuilderBlockLibrary

**Fichier:** `frontend/src/features/workflow-builder/components/WorkflowBuilderBlockLibrary.tsx`

**Responsabilités:**
- Affichage de la bibliothèque de blocs
- Gestion du toggle desktop/mobile
- Liste des types de nœuds
- Drag pour ajouter des nœuds

**Props réduites:** ~5 au lieu de 10+

**Taille estimée:** ~250 lignes

---

### 4.7 Créer WorkflowBuilderPropertiesPanel

**Fichier:** `frontend/src/features/workflow-builder/components/WorkflowBuilderPropertiesPanel.tsx`

**Responsabilités:**
- Panel de propriétés desktop/mobile
- Inspecteur de nœud
- Inspecteur d'edge
- Gestion du toggle

**Structure:**
```tsx
export default function WorkflowBuilderPropertiesPanel() {
  const { selectedNodeId, selectedEdgeId } = useSelection()
  const { isPropertiesPanelOpen } = useUI()

  if (!isPropertiesPanelOpen) return null

  return (
    <PropertiesPanelWrapper>
      {selectedNodeId && <NodeInspector nodeId={selectedNodeId} />}
      {selectedEdgeId && <EdgeInspector edgeId={selectedEdgeId} />}
    </PropertiesPanelWrapper>
  )
}
```

**Taille estimée:** ~200 lignes

---

### 4.8 Créer WorkflowBuilderModals

**Fichier:** `frontend/src/features/workflow-builder/components/WorkflowBuilderModals.tsx`

**Responsabilités:**
- Gestion de tous les modales
- Composition des modales
- État ouvert/fermé

**Structure:**
```tsx
export default function WorkflowBuilderModals() {
  return (
    <>
      <CreateWorkflowModal />
      <DeployWorkflowModal />
      <WorkflowAppearanceModal />
    </>
  )
}
```

**Taille estimée:** ~50 lignes

---

### 4.9 Créer WorkflowBuilderToast

**Fichier:** `frontend/src/features/workflow-builder/components/WorkflowBuilderToast.tsx`

**Responsabilités:**
- Affichage des notifications de sauvegarde
- Gestion des styles selon l'état
- Auto-dismiss

**Taille estimée:** ~100 lignes

---

### 4.10 Extraire les Modales en composants séparés

#### CreateWorkflowModal

**Fichier:** `frontend/src/features/workflow-builder/modals/CreateWorkflowModal.tsx`

**Taille estimée:** ~300 lignes

#### DeployWorkflowModal

**Fichier:** `frontend/src/features/workflow-builder/modals/DeployWorkflowModal.tsx`

**Taille estimée:** ~250 lignes

#### WorkflowAppearanceModal

**Fichier:** `frontend/src/features/workflow-builder/modals/WorkflowAppearanceModal.tsx`

**Taille estimée:** ~200 lignes

---

## Phase 5: Refactoring des Fonctions Complexes

**Objectif:** Simplifier les fonctions avec haute complexité cyclomatique

### 5.1 Refactorer loadVersionDetail()

**Problème:** ~150 lignes, complexité 12-15, mélange de multiples responsabilités

**Solution:** Diviser en fonctions plus petites

**Nouvelles fonctions:**
```typescript
// frontend/src/features/workflow-builder/utils/versionLoader.ts

async function fetchVersionFromApi(
  versionId: number,
  backendUrl: string,
  authHeader: Record<string, string>
): Promise<WorkflowVersionResponse>

function transformApiResponseToGraph(
  response: WorkflowVersionResponse
): { nodes: FlowNode[], edges: FlowEdge[] }

function decorateNodes(
  nodes: FlowNode[],
  decoratorFn: (node: FlowNode) => FlowNode
): FlowNode[]

async function loadVersionWithViewportRestore(
  versionId: number,
  options: LoadVersionOptions
): Promise<LoadVersionResult>
```

**Impact:** Réduit complexité de 12-15 à 4-6 par fonction

---

### 5.2 Refactorer loadVersions()

**Problème:** ~170 lignes, logique complexe de résolution de version

**Solution:** Extraire la logique de sélection de version

**Nouvelles fonctions:**
```typescript
// frontend/src/features/workflow-builder/utils/versionResolver.ts

function resolveVersionToSelect(
  versions: WorkflowVersionSummary[],
  currentVersionId: number | null,
  draftVersionId: number | null
): number | null

function findDraftVersion(
  versions: WorkflowVersionSummary[]
): WorkflowVersionSummary | null

function findProductionVersion(
  versions: WorkflowVersionSummary[]
): WorkflowVersionSummary | null

async function loadVersionsWithSelection(
  workflowId: string | number,
  options: LoadVersionsOptions
): Promise<LoadVersionsResult>
```

**Impact:** Réduit complexité de 10-12 à 4-5 par fonction

---

### 5.3 Refactorer handleConfirmDeploy()

**Problème:** ~105 lignes, 3-4 niveaux de nesting, complexité 10-12

**Solution:** Utiliser early returns et extraire la logique

**Nouvelles fonctions:**
```typescript
// frontend/src/features/workflow-builder/utils/deploymentHandler.ts

async function ensureChangesAreSaved(
  hasPendingChanges: boolean,
  saveFn: () => Promise<void>
): Promise<boolean>

function validateDeploymentPrerequisites(
  selectedWorkflowId: string | number | null,
  versionIdToPromote: number | null
): { valid: boolean; error?: string }

async function promoteVersionToProduction(
  workflowId: string | number,
  versionId: number,
  backendUrl: string,
  authHeader: Record<string, string>
): Promise<void>

async function deployWorkflow(
  options: DeployWorkflowOptions
): Promise<DeployWorkflowResult>
```

**Impact:** Réduit nesting de 3-4 à 1-2 niveaux, complexité de 10-12 à 4-6

---

### 5.4 Refactorer handleSubmitCreateWorkflow()

**Problème:** ~85 lignes de logique de validation et d'appels API imbriqués

**Solution:** Extraire validation et logique de création

**Nouvelles fonctions:**
```typescript
// frontend/src/features/workflow-builder/utils/workflowCreator.ts

function validateWorkflowCreationData(
  kind: "local" | "hosted",
  name: string,
  remoteId: string
): { valid: boolean; error?: string }

async function createLocalWorkflow(
  name: string,
  backendUrl: string,
  authHeader: Record<string, string>
): Promise<Workflow>

async function createHostedWorkflow(
  name: string,
  remoteId: string,
  token: string
): Promise<HostedWorkflow>

async function createWorkflowWithValidation(
  data: CreateWorkflowData
): Promise<CreateWorkflowResult>
```

**Impact:** Réduit complexité de 8-10 à 3-5 par fonction

---

### 5.5 Refactorer la logique de validation disableSave

**Problème:** ~75 lignes de validation imbriquée

**Solution:** Créer des validateurs composables

**Nouvelles fonctions:**
```typescript
// frontend/src/features/workflow-builder/utils/validators.ts

function validateNodeParameters(
  nodes: FlowNode[],
  availableModels: string[],
  vectorStores: VectorStore[],
  widgets: Widget[]
): ValidationResult

function validateGraphStructure(
  nodes: FlowNode[],
  edges: FlowEdge[]
): ValidationResult

function validateVectorStoreReferences(
  nodes: FlowNode[],
  vectorStores: VectorStore[]
): ValidationResult

function validateWidgetReferences(
  nodes: FlowNode[],
  widgets: Widget[]
): ValidationResult

function canSaveWorkflow(
  validations: ValidationResult[]
): { canSave: boolean; reason?: string }
```

**Impact:** Code plus testable, réutilisable, complexité réduite

---

## Phase 6: Optimisation et Nettoyage

**Objectif:** Améliorer les performances et la qualité du code

### 6.1 Optimiser les Re-renders

**Actions:**

1. **Memoïser les composants coûteux**
   ```typescript
   export const WorkflowBuilderCanvas = React.memo(WorkflowBuilderCanvasComponent)
   export const NodeInspector = React.memo(NodeInspectorComponent)
   export const BlockLibrary = React.memo(BlockLibraryComponent)
   ```

2. **Utiliser useMemo pour les calculs coûteux**
   ```typescript
   const decoratedNodes = useMemo(
     () => nodes.map(decorateNode),
     [nodes, decorateNode]
   )
   ```

3. **Optimiser graphSnapshot**
   ```typescript
   // Au lieu de JSON.stringify à chaque render
   const graphSnapshot = useMemo(
     () => buildGraphPayloadHash(nodes, edges),
     [nodes, edges]
   )
   ```

**Impact:** Réduit les re-renders inutiles de ~30%

---

### 6.2 Ajouter l'annulation des requêtes

**Actions:**

1. **Implémenter AbortController dans useApiRetry**
   ```typescript
   const abortControllerRef = useRef<AbortController | null>(null)

   useEffect(() => {
     return () => {
       abortControllerRef.current?.abort()
     }
   }, [])
   ```

2. **Annuler lors des changements de workflow**
   ```typescript
   useEffect(() => {
     return () => {
       cancelPendingRequests()
     }
   }, [selectedWorkflowId])
   ```

**Impact:** Prévient les race conditions et les fuites mémoire

---

### 6.3 Nettoyer viewportMemoryRef

**Actions:**

1. **Ajouter une limite de taille**
   ```typescript
   const MAX_VIEWPORT_MEMORY = 50

   function addToViewportMemory(key: string, viewport: Viewport) {
     if (viewportMemory.size >= MAX_VIEWPORT_MEMORY) {
       const oldestKey = viewportMemory.keys().next().value
       viewportMemory.delete(oldestKey)
     }
     viewportMemory.set(key, viewport)
   }
   ```

2. **Nettoyer lors de la suppression de workflow**
   ```typescript
   function cleanupViewportsForWorkflow(workflowId: string | number) {
     const keysToDelete = Array.from(viewportMemory.keys())
       .filter(key => key.startsWith(`${workflowId}-`))

     keysToDelete.forEach(key => viewportMemory.delete(key))
   }
   ```

**Impact:** Prévient la croissance infinie de la mémoire

---

### 6.4 Extraire les constantes magiques

**Actions:**

1. **Créer un fichier de constantes**
   ```typescript
   // frontend/src/features/workflow-builder/constants.ts

   export const MOBILE_BREAKPOINT = 768 // px
   export const HYDRATING_TIMEOUT = 100 // ms
   export const SAVE_MESSAGE_DISMISS_DELAY = 1500 // ms
   export const DOUBLE_TAP_THRESHOLD = 2
   export const DOUBLE_TAP_TIMEOUT = 300 // ms
   export const HISTORY_LIMIT = 50
   export const MAX_VIEWPORT_MEMORY = 50
   export const DEFAULT_BORDER_RADIUS = "1.25rem"
   export const DEFAULT_ZOOM_MIN = 0.5
   export const DEFAULT_ZOOM_MAX = 2
   ```

2. **Remplacer les valeurs hardcodées**

**Impact:** Code plus lisible et configurable

---

### 6.5 Améliorer l'internationalisation

**Actions:**

1. **Identifier toutes les chaînes hardcodées**
   - "Suppression en cours…"
   - "Sélectionnez le workflow..."
   - Messages d'erreur

2. **Remplacer par des clés i18n**
   ```typescript
   const t = useI18n()

   // Au lieu de: "Suppression en cours…"
   t("workflow.deleting")
   ```

3. **Créer les traductions**
   ```json
   {
     "workflow": {
       "deleting": "Suppression en cours…",
       "select_placeholder": "Sélectionnez le workflow...",
       // ...
     }
   }
   ```

**Impact:** Support multilingue complet

---

### 6.6 Combiner les useEffect de synchronisation

**Actions:**

1. **Créer un seul effet pour toutes les syncs de refs**
   ```typescript
   // Au lieu de 10 useEffect séparés
   useEffect(() => {
     nodesRef.current = nodes
     edgesRef.current = edges
     versionsRef.current = versions
     hasPendingChangesRef.current = hasPendingChanges
     saveStateRef.current = saveState
     selectedWorkflowIdRef.current = selectedWorkflowId
     selectedVersionIdRef.current = selectedVersionId
     selectedNodeIdRef.current = selectedNodeId
     selectedEdgeIdRef.current = selectedEdgeId
   }, [nodes, edges, versions, hasPendingChanges, saveState,
       selectedWorkflowId, selectedVersionId, selectedNodeId, selectedEdgeId])
   ```

2. **Ou utiliser useRefSynchronization hook**

**Impact:** Réduit le nombre d'effets de 10 à 1

---

### 6.7 Améliorer la sécurité des types

**Actions:**

1. **Créer des types stricts pour l'état**
   ```typescript
   // frontend/src/features/workflow-builder/types.ts

   export type SaveState = "idle" | "saving" | "saved" | "error"
   export type DeviceType = "mobile" | "desktop"
   export type WorkflowKind = "local" | "hosted"

   export interface ValidationResult {
     valid: boolean
     errors: ValidationError[]
   }

   export interface LoadVersionOptions {
     versionId: number
     workflowId: string | number
     shouldRestoreViewport?: boolean
   }

   // ...
   ```

2. **Typer strictement les handlers**
   ```typescript
   type NodeClickHandler = (
     event: React.MouseEvent,
     node: FlowNode
   ) => void

   type EdgeClickHandler = (
     event: React.MouseEvent,
     edge: FlowEdge
   ) => void
   ```

**Impact:** Moins d'erreurs, meilleure autocomplete

---

### 6.8 Ajouter des error boundaries

**Actions:**

1. **Créer ErrorBoundary pour le workflow builder**
   ```typescript
   // frontend/src/features/workflow-builder/components/WorkflowBuilderErrorBoundary.tsx

   export class WorkflowBuilderErrorBoundary extends React.Component {
     // Handle errors gracefully
   }
   ```

2. **Wrapper les composants critiques**
   ```tsx
   <WorkflowBuilderErrorBoundary>
     <WorkflowBuilderCanvas />
   </WorkflowBuilderErrorBoundary>
   ```

**Impact:** Meilleure gestion des erreurs, UX améliorée

---

## Phase 7: Tests et Validation

**Objectif:** Assurer que la refactorisation n'introduit pas de régressions

### 7.1 Créer des tests unitaires pour les hooks

**Fichiers de test à créer:**

1. `useWorkflowGraph.test.ts`
   - Test add/update/remove node
   - Test add/update/remove edge
   - Test buildGraphPayload
   - Test validation

2. `useVersionManagement.test.ts`
   - Test loadVersions
   - Test loadVersionDetail
   - Test resolveVersionIdToPromote
   - Test deployVersion

3. `useWorkflowOperations.test.ts`
   - Test createWorkflow
   - Test deleteWorkflow
   - Test duplicateWorkflow
   - Test renameWorkflow
   - Test retry logic

4. `useWorkflowValidation.test.ts`
   - Test validateGraphStructure
   - Test validateNodeParameters
   - Test validateVectorStoreReferences
   - Test canSaveWorkflow

**Impact:** Couverture de tests > 80%

---

### 7.2 Créer des tests d'intégration pour les composants

**Fichiers de test à créer:**

1. `WorkflowBuilderPage.test.tsx`
   - Test rendering
   - Test workflow selection
   - Test version switching
   - Test keyboard shortcuts

2. `WorkflowBuilderCanvas.test.tsx`
   - Test node creation
   - Test edge connection
   - Test drag & drop
   - Test selection

3. `WorkflowBuilderSidebar.test.tsx`
   - Test workflow list
   - Test create workflow
   - Test delete workflow
   - Test menu interactions

4. `WorkflowBuilderPropertiesPanel.test.tsx`
   - Test node inspector
   - Test edge inspector
   - Test parameter updates

**Impact:** Tests end-to-end pour les flows critiques

---

### 7.3 Créer des tests pour les utilitaires

**Fichiers de test à créer:**

1. `versionLoader.test.ts`
2. `versionResolver.test.ts`
3. `deploymentHandler.test.ts`
4. `workflowCreator.test.ts`
5. `validators.test.ts`

**Impact:** Validation de la logique métier

---

### 7.4 Tests de régression manuels

**Checklist de test:**

- [ ] Créer un nouveau workflow local
- [ ] Créer un nouveau workflow hosted
- [ ] Ajouter des nœuds au graphe
- [ ] Connecter des nœuds
- [ ] Modifier des paramètres de nœud
- [ ] Sauvegarder le workflow
- [ ] Déployer en production
- [ ] Créer un draft
- [ ] Undo/Redo
- [ ] Copy/Paste de nœuds
- [ ] Supprimer des nœuds
- [ ] Import/Export de workflow
- [ ] Dupliquer un workflow
- [ ] Renommer un workflow
- [ ] Supprimer un workflow
- [ ] Changer de version
- [ ] Responsive mobile
- [ ] Raccourcis clavier
- [ ] Double-tap mobile
- [ ] Gestion des erreurs

**Impact:** Validation complète de l'UX

---

### 7.5 Tests de performance

**Métriques à mesurer:**

1. **Temps de chargement initial**
   - Avant: X ms
   - Après: Y ms
   - Objectif: -20%

2. **Nombre de re-renders**
   - Avant: X renders par action
   - Après: Y renders par action
   - Objectif: -30%

3. **Temps de sauvegarde**
   - Avant: X ms
   - Après: Y ms
   - Objectif: identique ou mieux

4. **Utilisation mémoire**
   - Avant: X MB
   - Après: Y MB
   - Objectif: -15%

**Outils:**
- React DevTools Profiler
- Chrome Performance tab
- Memory profiler

**Impact:** Validation des améliorations de performance

---

### 7.6 Validation avec les utilisateurs

**Actions:**

1. **Deploy sur un environnement de staging**
2. **Inviter 3-5 utilisateurs clés à tester**
3. **Collecter les retours**
4. **Identifier les problèmes bloquants**
5. **Itérer si nécessaire**

**Impact:** Validation UX réelle

---

## Résumé des Bénéfices Attendus

### Métriques de Code

| Métrique | Avant | Après | Amélioration |
|----------|-------|-------|--------------|
| Lignes de code du composant principal | 2,939 | ~300 | -90% |
| Variables d'état | 46+ | ~8 | -82% |
| Nombre de refs | 35+ | ~10 | -71% |
| Props passées à WorkflowBuilderCanvas | 50+ | ~15 | -70% |
| Complexité cyclomatique (moyenne) | 6-8 | 3-4 | -50% |
| Nombre de fichiers | 1 | ~35 | +3400% |
| Couverture de tests | 0% | >80% | +80% |

---

### Bénéfices Qualitatifs

1. **Maintenabilité**
   - Code modulaire et focalisé
   - Responsabilités clairement séparées
   - Facile à comprendre et à modifier

2. **Testabilité**
   - Hooks et utils isolés et testables
   - Injection de dépendances facilitée
   - Mocks plus simples

3. **Réutilisabilité**
   - Hooks génériques réutilisables
   - Composants UI composables
   - Logique métier découplée

4. **Performance**
   - Re-renders réduits
   - Memoïsation optimisée
   - Pas de fuites mémoire

5. **Développement**
   - Nouveaux développeurs comprennent plus vite
   - Moins de merge conflicts
   - Refactorings futurs plus faciles

6. **Qualité**
   - Moins de bugs
   - Erreurs détectées plus tôt
   - Code review plus efficace

---

## Ordre d'Exécution Recommandé

### Sprint 1 (Fondations)
1. Phase 2.1-2.3: Créer WorkflowContext, SelectionContext, GraphContext
2. Phase 3.1: Créer useWorkflowGraph
3. Tests unitaires pour Phase 2.1-2.3 et 3.1

### Sprint 2 (Gestion d'État)
4. Phase 2.4-2.7: Créer SaveContext, ModalContext, ViewportContext, UIContext
5. Phase 3.2-3.3: Créer useVersionManagement, useWorkflowOperations
6. Tests unitaires pour Phase 2.4-2.7 et 3.2-3.3

### Sprint 3 (Hooks Utilitaires)
7. Phase 3.4-3.7: Créer hooks utilitaires (useRefSynchronization, useApiRetry, etc.)
8. Phase 5.1-5.5: Refactorer les fonctions complexes
9. Tests unitaires pour Phase 3.4-3.7 et 5.1-5.5

### Sprint 4 (Composants UI - Partie 1)
10. Phase 4.1-4.2: Créer WorkflowBuilderContainer et refactorer WorkflowBuilderPage
11. Phase 4.3-4.4: Créer WorkflowBuilderHeader et WorkflowBuilderCanvas
12. Tests d'intégration pour 4.1-4.4

### Sprint 5 (Composants UI - Partie 2)
13. Phase 4.5-4.7: Créer WorkflowBuilderSidebar, BlockLibrary, PropertiesPanel
14. Phase 4.8-4.10: Créer WorkflowBuilderModals et extraire les modales
15. Tests d'intégration pour 4.5-4.10

### Sprint 6 (Optimisation)
16. Phase 6.1-6.4: Optimisations de performance
17. Phase 6.5-6.8: Nettoyage et améliorations de qualité
18. Tests de performance

### Sprint 7 (Validation)
19. Phase 7.1-7.3: Compléter tous les tests
20. Phase 7.4-7.6: Tests de régression et validation utilisateurs
21. Documentation et formation

---

## Risques et Mitigations

### Risque 1: Régressions fonctionnelles

**Impact:** Élevé

**Probabilité:** Moyenne

**Mitigation:**
- Tests de régression complets avant chaque merge
- Feature flags pour activer progressivement les changements
- Monitoring en production
- Rollback plan prêt

---

### Risque 2: Complexité accrue pour les nouveaux développeurs

**Impact:** Moyen

**Probabilité:** Faible

**Mitigation:**
- Documentation complète de l'architecture
- Diagrammes de l'architecture
- Onboarding guide
- Code comments détaillés

---

### Risque 3: Performance dégradée

**Impact:** Élevé

**Probabilité:** Faible

**Mitigation:**
- Tests de performance à chaque phase
- Profiling régulier
- Benchmarks avant/après
- Monitoring des métriques clés

---

### Risque 4: Délais dépassés

**Impact:** Moyen

**Probabilité:** Moyenne

**Mitigation:**
- Sprints bien définis avec objectifs clairs
- Checkpoints réguliers
- Priorisation stricte (MVP first)
- Buffer time dans le planning

---

### Risque 5: Conflits de merge

**Impact:** Moyen

**Probabilité:** Moyenne

**Mitigation:**
- Feature branches pour chaque phase
- Merges fréquents dans main
- Communication dans l'équipe
- Pair programming pour les parties critiques

---

## Critères de Succès

### Critères Techniques

- [ ] Réduction de 80%+ des lignes de code du composant principal
- [ ] Complexité cyclomatique < 5 pour toutes les fonctions
- [ ] Couverture de tests > 80%
- [ ] 0 warnings TypeScript
- [ ] 0 erreurs ESLint
- [ ] Performance identique ou meilleure

### Critères Fonctionnels

- [ ] Tous les tests de régression passent
- [ ] Aucune régression détectée en production
- [ ] 0 bugs critiques ou bloquants
- [ ] Temps de réponse < 200ms pour toutes les actions

### Critères Qualitatifs

- [ ] Code review approuvé par 2+ développeurs seniors
- [ ] Documentation complète et à jour
- [ ] Architecture validée par l'équipe
- [ ] Retours positifs des utilisateurs testeurs

---

## Conclusion

Cette refactorisation transformera un composant monolithique de 2,939 lignes en une architecture modulaire, maintenable et testable. Les bénéfices incluent:

- **-90% de lignes** dans le composant principal
- **-82% de variables d'état**
- **+80% de couverture de tests**
- **-50% de complexité**

L'exécution en 7 sprints permet une livraison incrémentale avec validation continue. Les risques sont identifiés et mitigés. Le succès sera mesuré par des critères techniques, fonctionnels et qualitatifs clairs.

**Prochaine étape:** Obtenir l'approbation de l'équipe et commencer le Sprint 1.
