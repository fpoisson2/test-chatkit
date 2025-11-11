# Analyse complète : React Query pour le Workflow Builder

## ✅ Ce qui est déjà implémenté

### Hooks disponibles dans `useWorkflows.ts`

| Hook | Endpoint | Method | Optimistic Update |
|------|----------|--------|-------------------|
| **useWorkflows** | `/api/workflows` | GET | - |
| **useWorkflowVersions** | `/api/workflows/{id}/versions` | GET | - |
| **useWorkflowVersion** | `/api/workflow_versions/{id}` | GET | - |
| **useCreateWorkflow** | `/api/workflows` | POST | ✅ Ajout optimiste |
| **useUpdateWorkflow** | `/api/workflows/{id}` | PATCH | ✅ Mise à jour optimiste |
| **useDeleteWorkflow** | `/api/workflows/{id}` | DELETE | ✅ Suppression optimiste |
| **useDuplicateWorkflow** | `/api/workflows/{id}/duplicate` | POST | ✅ Duplication optimiste |
| **useSetChatkitWorkflow** | `/api/workflows/chatkit` | POST | ✅ Flag default optimiste |

**Total : 3 queries + 5 mutations** ✅

---

## ❌ Ce qui manque

### 1. Hosted Workflows (chatkitApi)

Ces opérations sont dans `chatkitApi` mais **ne sont pas** encore intégrées avec React Query :

| Opération | Endpoint | Method | Utilisé dans |
|-----------|----------|--------|--------------|
| **Lister hosted workflows** | `/api/chatkit/hosted` | GET | `WorkflowContext.loadHostedWorkflows` |
| **Créer hosted workflow** | `/api/chatkit/hosted` | POST | `WorkflowContext.createWorkflow` |
| **Supprimer hosted workflow** | `/api/chatkit/hosted/{slug}` | DELETE | `WorkflowContext.deleteHostedWorkflow` |

**Fichier source** : `frontend/src/utils/backend.ts` lignes 1179-1258

#### Hooks manquants à créer :

```typescript
// Queries
export const useHostedWorkflows = (token: string | null) => { ... }

// Mutations avec optimistic updates
export const useCreateHostedWorkflow = () => { ... }
export const useDeleteHostedWorkflow = () => { ... }
```

### 2. Opérations sur les versions

| Opération | Endpoint | Method | Utilisé dans | Payload |
|-----------|----------|--------|--------------|---------|
| **Promouvoir une version** | `/workflow_versions/{id}/promote` | POST | `useVersionManagement.ts:156` | `{ is_active: boolean }` |
| **Déployer en production** | `/api/workflows/{id}/production` | POST | `useWorkflowDeployment.ts:151` | `{ version_id: number }` |

**Note** : Ces deux endpoints semblent faire des choses similaires mais peut-être avec des comportements différents.

#### Hooks manquants à créer :

```typescript
// Mutations avec optimistic updates
export const usePromoteVersion = () => { ... }
export const useDeployToProduction = () => { ... }
```

### 3. Potentielles autres opérations

À vérifier s'il existe dans le backend :

- **Sauvegarder une version** : `PATCH /api/workflow_versions/{id}` avec graph ?
- **Créer une nouvelle version** : `POST /api/workflows/{id}/versions` ?
- **Supprimer une version** : `DELETE /api/workflow_versions/{id}` ?

---

## 📊 Récapitulatif

### Hooks implémentés
- ✅ **8 hooks** (3 queries + 5 mutations)
- ✅ Tous avec optimistic updates
- ✅ Documentation complète

### Hooks manquants
- ❌ **5 hooks** minimum :
  - 1 query : `useHostedWorkflows`
  - 4 mutations : `useCreateHostedWorkflow`, `useDeleteHostedWorkflow`, `usePromoteVersion`, `useDeployToProduction`

### Taux de couverture
- **Workflows locaux** : 100% ✅
- **Hosted Workflows** : 0% ❌
- **Opérations sur versions** : 0% ❌

**Couverture globale estimée : 60%**

---

## 🎯 Plan d'action recommandé

### Phase 1 : Hosted Workflows (Priorité HAUTE)

Le `WorkflowContext` utilise déjà ces API calls. Sans hooks React Query, il ne peut pas bénéficier des optimistic updates.

```typescript
// À ajouter dans useWorkflows.ts

export const hostedWorkflowsKeys = {
  all: ["hostedWorkflows"] as const,
  lists: () => [...hostedWorkflowsKeys.all, "list"] as const,
  list: (token: string | null) => [...hostedWorkflowsKeys.lists(), token] as const,
};

export const useHostedWorkflows = (token: string | null) => {
  return useQuery({
    queryKey: hostedWorkflowsKeys.list(token),
    queryFn: () => chatkitApi.getHostedWorkflows(token),
    enabled: !!token,
  });
};

export const useCreateHostedWorkflow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, payload }) => chatkitApi.createHostedWorkflow(token, payload),
    onMutate: async (variables) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: hostedWorkflowsKeys.lists() });
      const previous = queryClient.getQueryData(hostedWorkflowsKeys.list(variables.token));

      const tempWorkflow = { ...variables.payload, created_at: new Date().toISOString() };
      queryClient.setQueryData(
        hostedWorkflowsKeys.list(variables.token),
        (old = []) => [...old, tempWorkflow]
      );

      return { previous };
    },
    onError: (err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(hostedWorkflowsKeys.list(variables.token), context.previous);
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: hostedWorkflowsKeys.lists() });
    },
  });
};

export const useDeleteHostedWorkflow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, slug }) => chatkitApi.deleteHostedWorkflow(token, slug),
    onMutate: async (variables) => {
      // Optimistic removal
      await queryClient.cancelQueries({ queryKey: hostedWorkflowsKeys.lists() });
      const previous = queryClient.getQueryData(hostedWorkflowsKeys.list(variables.token));

      queryClient.setQueryData(
        hostedWorkflowsKeys.list(variables.token),
        (old = []) => old.filter((w) => w.slug !== variables.slug)
      );

      return { previous };
    },
    onError: (err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(hostedWorkflowsKeys.list(variables.token), context.previous);
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: hostedWorkflowsKeys.lists() });
    },
  });
};
```

### Phase 2 : Opérations sur versions (Priorité MOYENNE)

Ces opérations sont critiques pour le déploiement mais peuvent être ajoutées après.

```typescript
// À ajouter dans useWorkflows.ts ou dans un nouveau useWorkflowVersions.ts

export const usePromoteVersion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, versionId, isActive }) =>
      workflowsApi.promoteVersion(token, versionId, isActive),
    onMutate: async (variables) => {
      // Optimistic update of version status
      // Cancel and snapshot
      // Update version in cache
    },
    onError: (err, variables, context) => {
      // Rollback
    },
    onSettled: () => {
      // Invalidate versions queries
      queryClient.invalidateQueries({ queryKey: workflowsKeys.all });
    },
  });
};

export const useDeployToProduction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, workflowId, versionId }) =>
      workflowsApi.deployToProduction(token, workflowId, versionId),
    onMutate: async (variables) => {
      // Optimistic update of active version
      // Update workflow.active_version_id
    },
    onError: (err, variables, context) => {
      // Rollback
    },
    onSettled: () => {
      // Invalidate both workflows and versions
      queryClient.invalidateQueries({ queryKey: workflowsKeys.lists() });
    },
  });
};
```

### Phase 3 : Ajout dans backend.ts (Priorité MOYENNE)

Ajouter les méthodes manquantes dans `workflowsApi` :

```typescript
// Dans frontend/src/utils/backend.ts

export const workflowsApi = {
  // ... méthodes existantes ...

  async promoteVersion(
    token: string | null,
    versionId: number,
    isActive: boolean
  ): Promise<WorkflowVersionResponse> {
    const response = await requestWithFallback(`/workflow_versions/${versionId}/promote`, {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify({ is_active: isActive }),
    });
    return response.json();
  },

  async deployToProduction(
    token: string | null,
    workflowId: number,
    versionId: number
  ): Promise<WorkflowVersionResponse> {
    const response = await requestWithFallback(`/api/workflows/${workflowId}/production`, {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify({ version_id: versionId }),
    });
    return response.json();
  },
};
```

---

## 🔍 Points d'attention

### 1. Cache manuel dans chatkitApi

Le `chatkitApi.getHostedWorkflows` utilise un **cache manuel** avec `hostedWorkflowCache`. Ce cache devra être **supprimé** une fois React Query en place, car React Query gère déjà le cache.

```typescript
// À supprimer après migration
let hostedWorkflowCache: HostedWorkflowMetadata[] | null | undefined = undefined;
let hostedWorkflowPromise: Promise<HostedWorkflowMetadata[] | null> | null = null;
```

### 2. Refs dans WorkflowContext

Le `WorkflowContext` utilise des refs pour synchroniser l'état. Avec React Query, ces refs **ne seront plus nécessaires** car le cache React Query est déjà synchronisé.

```typescript
// Ces refs peuvent être supprimés après migration
workflowsRef: React.MutableRefObject<WorkflowSummary[]>;
hostedWorkflowsRef: React.MutableRefObject<HostedWorkflowMetadata[]>;
versionsRef: React.MutableRefObject<WorkflowVersionSummary[]>;
```

### 3. États de loading

Le `WorkflowContext` gère manuellement les états de loading. React Query les fournit automatiquement via `isLoading`, `isFetching`, `isPending`, etc.

```typescript
// Ces états peuvent être supprimés après migration
const [loading, setLoading] = useState(false);
const [hostedLoading, setHostedLoading] = useState(false);
```

---

## ✅ Checklist finale

### Implémentation
- [ ] Ajouter `useHostedWorkflows` query
- [ ] Ajouter `useCreateHostedWorkflow` mutation avec optimistic update
- [ ] Ajouter `useDeleteHostedWorkflow` mutation avec optimistic update
- [ ] Ajouter `usePromoteVersion` mutation avec optimistic update
- [ ] Ajouter `useDeployToProduction` mutation avec optimistic update
- [ ] Ajouter les méthodes dans `workflowsApi` (backend.ts)

### Migration WorkflowContext
- [ ] Remplacer `useState` par `useHostedWorkflows`
- [ ] Remplacer `createHostedWorkflow` par `useCreateHostedWorkflow`
- [ ] Remplacer `deleteHostedWorkflow` par `useDeleteHostedWorkflow`
- [ ] Supprimer le cache manuel de `chatkitApi`
- [ ] Supprimer les refs inutiles
- [ ] Supprimer les états de loading manuels

### Tests
- [ ] Tester optimistic updates pour hosted workflows
- [ ] Tester rollback en cas d'erreur
- [ ] Vérifier la synchronisation du cache
- [ ] Tester le déploiement en production

---

## 📈 Estimation

- **Temps de développement** : 2-3 heures
- **Complexité** : Moyenne
- **Impact** : ÉLEVÉ (déblocage de la migration complète du WorkflowContext)

**Priorité recommandée : HAUTE** 🔥

Une fois ces hooks implémentés, le workflow builder aura une couverture React Query complète et pourra être entièrement migré du pattern `useState` vers React Query.
