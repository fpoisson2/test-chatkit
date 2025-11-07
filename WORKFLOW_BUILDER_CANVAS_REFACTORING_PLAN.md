# Plan de Refactorisation - WorkflowBuilderCanvas

## Date
2025-11-07

## Objectif
Refactoriser WorkflowBuilderCanvas pour réduire de **63 props → ~15 props** en utilisant les 7 contextes existants.

---

## 📊 État Actuel

### Métriques
- **Props actuelles:** 63 props
- **Lignes de code:** ~410 lignes
- **Contextes utilisés:** 0/7
- **Complexité:** Très élevée (63 props = prop drilling massif)

### Responsabilités Actuelles
1. Rendu du header avec navigation
2. Gestion du ReactFlow canvas
3. Affichage des contrôles mobiles (undo/redo/duplicate/delete)
4. Gestion de la BlockLibrary (desktop/mobile)
5. Gestion du PropertiesPanel (desktop/mobile)
6. Affichage des descriptions/reminders de workflow

---

## 🎯 Objectif Final

### Métriques Cibles
- **Props finales:** ~15 props (-76%)
- **Lignes de code:** ~300 lignes (-26%)
- **Contextes utilisés:** 6/7 contextes (tous sauf SaveContext)
- **Complexité:** Faible (logique isolée dans les contextes)

### Props Finales Légitimes (15 props)
```typescript
interface WorkflowBuilderCanvasProps {
  // Sidebar navigation
  openSidebar: () => void;

  // Render props (doivent rester - délégation de rendu)
  renderHeaderControls: () => ReactNode;
  renderWorkflowDescription: () => ReactNode;
  renderWorkflowPublicationReminder: () => ReactNode;
  blockLibraryContent: ReactNode;
  propertiesPanelElement: ReactNode;

  // Refs légitimes (callbacks de refs)
  reactFlowContainerRef: RefCallback<HTMLDivElement>;

  // Handlers de drag (logique complexe externe)
  handleNodeDragStart: NodeDragHandler<FlowNode>;
  handleNodeDragStop: NodeDragHandler<FlowNode>;

  // Labels de configuration
  mobileActionLabels: MobileActionLabels;

  // Conditions de rendu calculées
  shouldShowWorkflowDescription: boolean;
  shouldShowPublicationReminder: boolean;

  // Layout flag (peut aussi venir de UIContext)
  isMobileLayout: boolean;
}
```

---

## 🔄 Migration par Contexte

### 1. GraphContext (13 props → 0 props)

**Props à migrer:**
- `nodes` ✅ GraphContext.nodes
- `edges` ✅ GraphContext.edges
- `handleNodesChange` ✅ GraphContext.handleNodesChange
- `handleEdgesChange` ✅ GraphContext.handleEdgesChange
- `onConnect` ✅ GraphContext.onConnect
- `redoHistory` ✅ GraphContext.redoHistory
- `undoHistory` ✅ GraphContext.undoHistory
- `handleDuplicateSelection` ✅ GraphContext.handleDuplicateSelection
- `handleDeleteSelection` ✅ GraphContext.handleDeleteSelection
- `canRedoHistory` ✅ GraphContext.canRedoHistory
- `canUndoHistory` ✅ GraphContext.canUndoHistory
- `canDuplicateSelection` ✅ GraphContext.canDuplicateSelection
- `canDeleteSelection` ✅ GraphContext.canDeleteSelection

**Impact:** -13 props (-21%)

---

### 2. ViewportContext (12 props → 0 props)

**Props à migrer:**
- `minViewportZoom` ✅ ViewportContext.minViewportZoom
- `initialViewport` ✅ ViewportContext.initialViewport
- `reactFlowInstanceRef` ✅ ViewportContext.reactFlowInstanceRef
- `refreshViewportConstraints` ✅ ViewportContext.refreshViewportConstraints
- `pendingViewportRestoreRef` ✅ ViewportContext.pendingViewportRestoreRef
- `restoreViewport` ✅ ViewportContext.restoreViewport
- `isHydratingRef` ✅ ViewportContext.isHydratingRef
- `viewportRef` ✅ ViewportContext.viewportRef
- `hasUserViewportChangeRef` ✅ ViewportContext.hasUserViewportChangeRef
- `viewportKeyRef` ✅ ViewportContext.viewportKeyRef
- `viewportMemoryRef` ✅ ViewportContext.viewportMemoryRef
- `persistViewportMemory` ✅ ViewportContext.persistViewportMemory

**Impact:** -12 props (-19%)

---

### 3. UIContext (11 props → 0 props)

**Props à migrer:**
- `isMobileLayout` ✅ UIContext.isMobileLayout (ou peut rester prop)
- `isBlockLibraryOpen` ✅ UIContext.isBlockLibraryOpen
- `closeBlockLibrary` ✅ UIContext.closeBlockLibrary
- `blockLibraryId` ✅ UIContext.blockLibraryId
- `isPropertiesPanelOpen` ✅ UIContext.isPropertiesPanelOpen
- `handleClosePropertiesPanel` ✅ UIContext.closePropertiesPanel
- `handleOpenPropertiesPanel` ✅ UIContext.openPropertiesPanel
- `propertiesPanelId` ✅ UIContext.propertiesPanelId
- `toggleBlockLibrary` ✅ UIContext.toggleBlockLibrary
- `propertiesPanelToggleRef` ✅ UIContext.propertiesPanelToggleRef
- `blockLibraryToggleRef` ✅ UIContext.blockLibraryToggleRef

**Impact:** -11 props (-17%)

---

### 4. SelectionContext (5 props → 0 props)

**Props à migrer:**
- `handleNodeClick` ✅ SelectionContext.handleNodeClick
- `handleEdgeClick` ✅ SelectionContext.handleEdgeClick
- `handleClearSelection` ✅ SelectionContext.handleClearSelection
- `handleSelectionChange` ✅ SelectionContext.handleSelectionChange
- `hasSelectedElement` ✅ SelectionContext.hasSelectedElement

**Impact:** -5 props (-8%)

---

### 5. WorkflowContext (2 props → 0 props)

**Props à migrer:**
- `loading` ✅ WorkflowContext.loading
- `loadError` ✅ WorkflowContext.loadError

**Impact:** -2 props (-3%)

---

### 6. Styles (6 props → 0 props) - Calculés dans Canvas

**Props à déplacer dans Canvas:**
- `headerStyle` → calculé dans useMemo à l'intérieur de Canvas
- `headerNavigationButtonStyle` → calculé dans useMemo à l'intérieur de Canvas
- `workspaceWrapperStyle` → calculé dans useMemo à l'intérieur de Canvas
- `workspaceContentStyle` → calculé dans useMemo à l'intérieur de Canvas
- `editorContainerStyle` → calculé dans useMemo à l'intérieur de Canvas
- `floatingPanelStyle` → calculé dans useMemo à l'intérieur de Canvas

**Raison:** Ces styles dépendent uniquement de `isMobileLayout` et de conditions internes. Ils peuvent être calculés directement dans Canvas.

**Impact:** -6 props (-10%)

---

### 7. Conditions de rendu (2 props → 0 props) - Calculées dans Canvas

**Option A: Garder comme props (recommandé)**
- `shouldShowWorkflowDescription` ✅ reste prop
- `shouldShowPublicationReminder` ✅ reste prop

**Option B: Calculer dans Canvas**
```typescript
// Dans Canvas, via WorkflowContext
const { selectedWorkflow } = useWorkflowContext();
const { isMobileLayout } = useUIContext();

const shouldShowWorkflowDescription = !isMobileLayout && Boolean(selectedWorkflow?.description);
const shouldShowPublicationReminder = !isMobileLayout && Boolean(selectedWorkflow) && !selectedWorkflow?.active_version_id;
```

**Recommandation:** Garder comme props pour l'instant (plus simple).

**Impact si migrées:** -2 props (-3%)

---

## 📊 Récapitulatif de la Migration

### Réduction par Contexte

| Contexte | Props éliminées | % Réduction |
|----------|-----------------|-------------|
| GraphContext | 13 props | 21% |
| ViewportContext | 12 props | 19% |
| UIContext | 11 props | 17% |
| SelectionContext | 5 props | 8% |
| WorkflowContext | 2 props | 3% |
| Styles internes | 6 props | 10% |
| **TOTAL** | **49 props** | **78%** |

### Avant / Après

| Métrique | Avant | Après | Amélioration |
|----------|-------|-------|--------------|
| Props totales | 63 | 14 | **-49 props (-78%)** |
| Props légitimes | 14 | 14 | 0 (inchangé) |
| Props de contexte | 49 | 0 | -49 props |
| Complexité | Très élevée | Faible | ✅✅✅ |
| Testabilité | Difficile | Facile | ✅✅✅ |

---

## 🛠️ Plan d'Implémentation

### Phase 1: Préparation (10 min)
1. ✅ Analyser les 63 props actuelles
2. ✅ Mapper chaque prop à son contexte
3. ✅ Identifier les props légitimes (doivent rester)
4. ✅ Créer ce plan de refactorisation

### Phase 2: Migration des Contextes (30 min)

#### Étape 1: Importer les contextes
```typescript
import {
  useGraphContext,
  useViewportContext,
  useUIContext,
  useSelectionContext,
  useWorkflowContext,
} from "../contexts";
```

#### Étape 2: Déstructurer les valeurs des contextes
```typescript
const WorkflowBuilderCanvas = ({
  // Props légitimes uniquement
  openSidebar,
  renderHeaderControls,
  renderWorkflowDescription,
  renderWorkflowPublicationReminder,
  reactFlowContainerRef,
  blockLibraryContent,
  propertiesPanelElement,
  handleNodeDragStart,
  handleNodeDragStop,
  mobileActionLabels,
  shouldShowWorkflowDescription,
  shouldShowPublicationReminder,
  isMobileLayout, // ou vient de UIContext
}: WorkflowBuilderCanvasProps) => {
  // GraphContext
  const {
    nodes,
    edges,
    handleNodesChange,
    handleEdgesChange,
    onConnect,
    redoHistory,
    undoHistory,
    handleDuplicateSelection,
    handleDeleteSelection,
    canRedoHistory,
    canUndoHistory,
    canDuplicateSelection,
    canDeleteSelection,
  } = useGraphContext();

  // ViewportContext
  const {
    minViewportZoom,
    initialViewport,
    reactFlowInstanceRef,
    refreshViewportConstraints,
    pendingViewportRestoreRef,
    restoreViewport,
    isHydratingRef,
    viewportRef,
    hasUserViewportChangeRef,
    viewportKeyRef,
    viewportMemoryRef,
    persistViewportMemory,
  } = useViewportContext();

  // UIContext
  const {
    // isMobileLayout, // si migré
    isBlockLibraryOpen,
    closeBlockLibrary,
    blockLibraryId,
    isPropertiesPanelOpen,
    closePropertiesPanel,
    openPropertiesPanel,
    propertiesPanelId,
    toggleBlockLibrary,
    propertiesPanelToggleRef,
    blockLibraryToggleRef,
  } = useUIContext();

  // SelectionContext
  const {
    handleNodeClick,
    handleEdgeClick,
    handleClearSelection,
    handleSelectionChange,
    hasSelectedElement,
  } = useSelectionContext();

  // WorkflowContext
  const {
    loading,
    loadError,
  } = useWorkflowContext();

  // Styles calculés localement
  const headerStyle = useMemo(() => {
    const baseStyle = getHeaderContainerStyle(isMobileLayout);
    return { ...baseStyle, position: "absolute", top: 0, left: 0, right: 0 };
  }, [isMobileLayout]);

  const headerNavigationButtonStyle = useMemo(
    () => getHeaderNavigationButtonStyle(isMobileLayout),
    [isMobileLayout],
  );

  const workspaceWrapperStyle = useMemo<CSSProperties>(() => {
    if (isMobileLayout) {
      return { position: "absolute", inset: 0, overflow: "hidden" };
    }
    return { position: "relative", flex: 1, overflow: "hidden", minHeight: 0 };
  }, [isMobileLayout]);

  const workspaceContentStyle = useMemo<CSSProperties>(() => {
    // ... logique de calcul
  }, [isMobileLayout, shouldShowPublicationReminder, shouldShowWorkflowDescription]);

  const editorContainerStyle = useMemo<CSSProperties>(() => {
    // ... logique de calcul
  }, [isMobileLayout]);

  const floatingPanelStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isMobileLayout && isBlockLibraryOpen) {
      return { /* ... */ };
    }
    return undefined;
  }, [isMobileLayout, isBlockLibraryOpen]);

  const showPropertiesPanel = isPropertiesPanelOpen && hasSelectedElement;

  // Le reste du composant reste identique
  return (
    <>
      {/* ... JSX inchangé ... */}
    </>
  );
};
```

#### Étape 3: Importer les fonctions de style
```typescript
import {
  getHeaderContainerStyle,
  getHeaderNavigationButtonStyle,
} from "../styles"; // ou depuis utils
```

### Phase 3: Mise à jour de WorkflowBuilderPage (15 min)

#### Supprimer les props obsolètes
```typescript
// AVANT (63 props)
<WorkflowBuilderCanvas
  openSidebar={openSidebar}
  headerStyle={headerStyle}
  headerNavigationButtonStyle={headerNavigationButtonStyle}
  renderHeaderControls={renderHeaderControls}
  workspaceWrapperStyle={workspaceWrapperStyle}
  // ... 58 autres props
/>

// APRÈS (14 props)
<WorkflowBuilderCanvas
  openSidebar={openSidebar}
  renderHeaderControls={renderHeaderControls}
  renderWorkflowDescription={renderWorkflowDescription}
  renderWorkflowPublicationReminder={renderWorkflowPublicationReminder}
  reactFlowContainerRef={reactFlowContainerRef}
  blockLibraryContent={blockLibraryContent}
  propertiesPanelElement={propertiesPanelElement}
  handleNodeDragStart={handleNodeDragStart}
  handleNodeDragStop={handleNodeDragStop}
  mobileActionLabels={mobileActionLabels}
  shouldShowWorkflowDescription={shouldShowWorkflowDescription}
  shouldShowPublicationReminder={shouldShowPublicationReminder}
  isMobileLayout={isMobileLayout}
/>
```

### Phase 4: Tests et Validation (15 min)

#### 1. Compilation TypeScript
```bash
npx tsc --noEmit
```

#### 2. Tests manuels
- ✅ Canvas se charge correctement
- ✅ ReactFlow fonctionne (zoom, pan, drag)
- ✅ Sélection de nodes/edges fonctionne
- ✅ Undo/redo fonctionne
- ✅ BlockLibrary s'ouvre/ferme (desktop/mobile)
- ✅ PropertiesPanel s'ouvre/ferme (desktop/mobile)
- ✅ Actions mobiles fonctionnent (undo/redo/duplicate/delete)
- ✅ Viewport persistence fonctionne

#### 3. Tests de régression
- ✅ Créer un workflow
- ✅ Ajouter des nodes
- ✅ Créer des edges
- ✅ Sauvegarder
- ✅ Changer de workflow
- ✅ Vérifier que le viewport est restauré

---

## ⚠️ Risques et Mitigation

### Risque 1: Dépendances Circulaires
**Problème:** Canvas pourrait avoir besoin de valeurs qui dépendent d'autres valeurs.

**Mitigation:**
- Utiliser les contextes existants qui gèrent déjà ces dépendances
- Ne pas recréer de logique dans Canvas

### Risque 2: Styles Cassés
**Problème:** Les styles calculés pourraient ne pas fonctionner correctement.

**Mitigation:**
- Copier la logique de calcul de style exactement
- Tester sur desktop et mobile
- Vérifier `getHeaderContainerStyle` et `getHeaderNavigationButtonStyle` existent

### Risque 3: Refs Non Synchronisés
**Problème:** Les refs des contextes pourraient ne pas être à jour.

**Mitigation:**
- Les contextes gèrent déjà la synchronisation des refs
- Utiliser directement les refs des contextes

### Risque 4: Performances
**Problème:** Utiliser 6 contextes pourrait causer des re-renders.

**Mitigation:**
- Les contextes utilisent `useMemo` et `useCallback`
- Canvas ne re-render que si les valeurs changent
- Vérifier avec React DevTools Profiler si nécessaire

---

## 📈 Bénéfices Attendus

### 1. Réduction du Prop Drilling ✅✅✅
- **Avant:** 63 props passées de Page → Canvas
- **Après:** 14 props passées de Page → Canvas
- **Réduction:** -78% de prop drilling

### 2. Meilleure Séparation des Préoccupations ✅✅
- Canvas ne gère que le rendu visuel
- La logique métier vit dans les contextes
- Plus facile à comprendre et maintenir

### 3. Testabilité Améliorée ✅✅
- Canvas peut être testé en mockant les contextes
- Moins de props à mocker
- Tests plus focalisés

### 4. Réutilisabilité ✅
- Canvas peut être utilisé dans d'autres contextes
- Les contextes peuvent être réutilisés ailleurs
- Architecture plus modulaire

### 5. Code Plus Maintenable ✅✅
- Moins de lignes dans WorkflowBuilderPage
- Logique centralisée dans les contextes
- Moins de bugs potentiels

---

## 🎯 Objectifs de Succès

### Métriques Quantitatives
- ✅ Props Canvas: 63 → 14 (-78%)
- ✅ Lignes Canvas: ~410 → ~350 (-15%)
- ✅ Contextes utilisés: 0/7 → 6/7 (86%)
- ✅ Compilation TypeScript: 0 erreurs
- ✅ Tests manuels: 100% passent

### Métriques Qualitatives
- ✅ Code plus lisible
- ✅ Architecture plus claire
- ✅ Maintenance plus facile
- ✅ Pattern Context + Hook bien établi

---

## 📝 Prochaines Étapes Après Canvas

Après la refactorisation de Canvas, on peut attaquer les autres composants :

### 1. WorkflowBuilderSidebar
- **Props actuelles:** ~20 props
- **Props finales:** ~8 props
- **Contextes à utiliser:** WorkflowContext, ModalContext, UIContext
- **Effort estimé:** 2 heures

### 2. BlockLibrary
- **Props actuelles:** ~10 props
- **Props finales:** ~5 props
- **Contextes à utiliser:** UIContext, GraphContext
- **Effort estimé:** 1 heure

### 3. WorkflowBuilderPage Cleanup Final
- Supprimer les variables d'état locales restantes
- Supprimer les useMemo de styles maintenant dans Canvas
- Objectif final: ~300 lignes (actuel: 2,964 lignes)

---

## 🚀 Estimation Globale

### Temps Total
- **Phase 1 (Préparation):** 10 min ✅ FAIT
- **Phase 2 (Migration):** 30 min
- **Phase 3 (Update Page):** 15 min
- **Phase 4 (Tests):** 15 min
- **TOTAL:** **~70 minutes (1h10)**

### Complexité
- **Technique:** Moyenne (utilisation de contextes)
- **Risque:** Moyen (nombreux refs et handlers)
- **Impact:** Élevé (réduction massive du prop drilling)

### Recommandation
✅ **GO** - Cette refactorisation est fortement recommandée car :
- Les contextes sont déjà prêts et testés
- L'impact est majeur (-78% props)
- Le risque est maîtrisable avec des tests
- Ça complète la Phase 4 de manière cohérente

---

## 📚 Références

### Fichiers à Modifier
1. `/frontend/src/features/workflow-builder/components/WorkflowBuilderCanvas.tsx` (refactoriser)
2. `/frontend/src/features/workflow-builder/WorkflowBuilderPage.tsx` (supprimer props)

### Contextes à Utiliser
1. `/frontend/src/features/workflow-builder/contexts/GraphContext.tsx`
2. `/frontend/src/features/workflow-builder/contexts/ViewportContext.tsx`
3. `/frontend/src/features/workflow-builder/contexts/UIContext.tsx`
4. `/frontend/src/features/workflow-builder/contexts/SelectionContext.tsx`
5. `/frontend/src/features/workflow-builder/contexts/WorkflowContext.tsx`

### Documentation Existante
- `WORKFLOW_BUILDER_PHASE_4_STATUS_FINAL.md` - État de la Phase 4
- `WORKFLOW_BUILDER_REFACTORING_PLAN.md` - Plan global (si existe)

---

**Créé le:** 2025-11-07
**Auteur:** Claude (AI Assistant)
**Statut:** ✅ **PRÊT À IMPLÉMENTER**
**Complexité:** Moyenne
**Impact:** Élevé
**Recommandation:** GO ✅
