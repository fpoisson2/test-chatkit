# WorkflowBuilder Simplification - Phase 1

## Objectif
Réduire la complexité de WorkflowBuilderPage.tsx (7717 lignes) via l'extraction de la gestion d'état dans un contexte React.

## Problèmes identifiés
- WorkflowBuilderPage.tsx : 7717 lignes (monolithique)
- 52 useState dispersés
- 156 useCallback
- Prop drilling extrême :
  - WorkflowBuilderCanvas : 110+ props
  - NodeInspector : 127+ props callbacks
  - 14 sections inspector avec patterns dupliqués

## Travail effectué

### 1. Structure créée
- ✅ `/contexts/WorkflowBuilderContext.tsx` - Interface du contexte (217 lignes)
- ✅ `/contexts/WorkflowBuilderProvider.tsx` - Provider squelette  
- ✅ `/hooks/` - Répertoire pour les hooks personnalisés

### 2. Fichiers de travail
- `WorkflowBuilderPage.backup.tsx` - Backup de l'original
- `WorkflowBuilderLogic.tsx` - Copie pour extraction

## Prochaines étapes pour compléter la refactorisation

### Phase 1 : Wrapper avec Provider (Impact immédiat)
1. Ajouter import de WorkflowBuilderContext dans WorkflowBuilderPage.tsx
2. Créer contextValue avec toutes les valeurs/handlers (après ligne 7439)
3. Wrapper le return dans `<WorkflowBuilderContext.Provider value={contextValue}>`
4. Ajouter closing tag `</WorkflowBuilderContext.Provider>` à la fin

**Impact attendu** : Prépare l'infrastructure pour éliminer le prop drilling

### Phase 2 : Refactor WorkflowBuilderCanvas (Réduction ~100 lignes)
1. Modifier WorkflowBuilderCanvas pour utiliser `const ctx = useWorkflowBuilder()`
2. Remplacer toutes les props par `ctx.propName`  
3. Supprimer les 110+ props passées depuis WorkflowBuilderPage

**Impact attendu** : Réduction de ~110 lignes dans WorkflowBuilderPage

### Phase 3 : Refactor NodeInspector (Réduction ~127 lignes)
1. Modifier NodeInspector pour utiliser `useWorkflowBuilder()`
2. Remplacer les 127+ callback props par accès au contexte
3. Supprimer les props depuis WorkflowBuilderPage

**Impact attendu** : Réduction de ~127 lignes dans WorkflowBuilderPage

### Phase 4 : Refactor Inspector Sections (Réduction importante)
1. Créer un hook `useNodeInspectorHandlers()` qui expose les handlers spécifiques
2. Modifier les 14 sections pour utiliser ce hook
3. Éliminer la duplication d'interfaces

**Impact attendu** : Réduction de ~500+ lignes au total

### Résultat final attendu
- WorkflowBuilderPage.tsx : ~7000 lignes → ~6300 lignes (phase 2+3)
- Code mieux organisé et plus maintenable
- Base pour refactorizations futures

## Commandes Git pour finalisation
```bash
git add frontend/src/features/workflow-builder/contexts/
git add frontend/src/features/workflow-builder/hooks/
git add frontend/src/features/workflow-builder/WorkflowBuilderPage.tsx
git commit -m "feat(workflow-builder): Extract state management to React Context

- Create WorkflowBuilderContext with complete type definitions
- Prepare infrastructure for eliminating prop drilling
- Reduces coupling between components

This is phase 1 of the simplification. Next phases will:
- Refactor WorkflowBuilderCanvas (~110 props → context)
- Refactor NodeInspector (~127 callbacks → context)
- Eliminate duplication in inspector sections"
```

