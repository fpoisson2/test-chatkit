# Migration du Workflow Builder vers React Query

Ce document explique la migration du Workflow Builder pour utiliser React Query avec optimistic updates.

## État actuel

Le `WorkflowContext` utilise actuellement `useState` et des fetch directs pour gérer les données des workflows. Cela contredit les guidelines React Query établies dans `AGENTS.md`.

## Hooks React Query disponibles

Le fichier `frontend/src/hooks/useWorkflows.ts` fournit maintenant tous les hooks nécessaires avec optimistic updates :

### Queries

```typescript
// Liste des workflows
const { data: workflows, isLoading, error } = useWorkflows(token);

// Versions d'un workflow
const { data: versions } = useWorkflowVersions(token, workflowId);

// Détail d'une version
const { data: versionDetail } = useWorkflowVersion(token, versionId);
```

### Mutations avec Optimistic Updates

```typescript
// Créer un workflow
const createWorkflow = useCreateWorkflow();
await createWorkflow.mutateAsync({
  token,
  payload: { display_name: "Mon workflow" }
});

// Mettre à jour un workflow
const updateWorkflow = useUpdateWorkflow();
await updateWorkflow.mutateAsync({
  token,
  id: workflowId,
  payload: { display_name: "Nouveau nom" }
});

// Supprimer un workflow
const deleteWorkflow = useDeleteWorkflow();
await deleteWorkflow.mutateAsync({ token, id: workflowId });

// Dupliquer un workflow
const duplicateWorkflow = useDuplicateWorkflow();
await duplicateWorkflow.mutateAsync({
  token,
  id: workflowId,
  newName: "Copie de workflow"
});

// Définir le workflow par défaut de Chatkit
const setChatkitWorkflow = useSetChatkitWorkflow();
await setChatkitWorkflow.mutateAsync({ token, workflowId });
```

## Bénéfices des Optimistic Updates

Tous les hooks de mutation implémentent les optimistic updates :

1. **Feedback instantané** : L'UI se met à jour immédiatement avant la réponse serveur
2. **Rollback automatique** : En cas d'erreur, l'état précédent est restauré
3. **Synchronisation** : Le cache est invalidé après succès pour garantir la cohérence

### Exemple de flow avec optimistic update

```typescript
const deleteWorkflow = useDeleteWorkflow();

// L'utilisateur clique sur supprimer
try {
  // 1. onMutate: Le workflow disparaît immédiatement de la liste
  // 2. API call en cours...
  await deleteWorkflow.mutateAsync({ token, id: workflowId });
  // 3. onSettled: Invalidation du cache pour refetch
  toast.success("Workflow supprimé");
} catch (error) {
  // 4. onError: Le workflow réapparaît (rollback)
  toast.error("Erreur lors de la suppression");
}
```

## Plan de migration du WorkflowContext

### Étape 1 : Remplacer les états locaux par React Query

**Avant :**
```typescript
const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
const [loading, setLoading] = useState(false);

const loadWorkflows = async (authHeader) => {
  setLoading(true);
  const response = await fetch("/api/workflows", { headers: authHeader });
  const data = await response.json();
  setWorkflows(data);
  setLoading(false);
};
```

**Après :**
```typescript
const { data: workflows = [], isLoading } = useWorkflows(token);
// Plus de loadWorkflows() nécessaire !
```

### Étape 2 : Remplacer les mutations manuelles

**Avant :**
```typescript
const createWorkflow = async (data, authHeader) => {
  const response = await fetch("/api/workflows", {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify({ display_name: data.name }),
  });
  const workflow = await response.json();
  await loadWorkflows(authHeader); // Refetch manuel
  return workflow;
};
```

**Après :**
```typescript
const createWorkflowMutation = useCreateWorkflow();

const createWorkflow = async (data) => {
  const workflow = await createWorkflowMutation.mutateAsync({
    token,
    payload: { display_name: data.name },
  });
  // L'UI est déjà à jour via optimistic update !
  // Le cache est automatiquement invalidé
  return workflow;
};
```

### Étape 3 : Simplifier le contexte

Le `WorkflowContext` peut être considérablement simplifié :

- ❌ Supprimer tous les `useState` pour les données serveur
- ❌ Supprimer les fonctions `loadWorkflows`, `loadVersions`, etc.
- ❌ Supprimer les états `loading` et `loadError`
- ✅ Garder uniquement les états UI locaux (sélection, modales, etc.)
- ✅ Utiliser les hooks React Query directement dans les composants

### Étape 4 : Gestion des erreurs centralisée

```typescript
const { data, error } = useWorkflows(token);

useEffect(() => {
  if (error) {
    if (isUnauthorizedError(error)) {
      logout();
    }
    toast.error(error.message);
  }
}, [error, logout]);
```

## Exemple de composant refactoré

**Avant :**
```typescript
function WorkflowList() {
  const {
    workflows,
    loading,
    loadError,
    loadWorkflows,
    deleteWorkflow,
  } = useWorkflowContext();

  useEffect(() => {
    loadWorkflows(authHeader);
  }, []);

  const handleDelete = async (id) => {
    try {
      await deleteWorkflow(id, authHeader);
      toast.success("Supprimé");
    } catch (error) {
      toast.error("Erreur");
    }
  };

  if (loading) return <Spinner />;
  if (loadError) return <Error message={loadError} />;

  return <List items={workflows} onDelete={handleDelete} />;
}
```

**Après :**
```typescript
function WorkflowList() {
  const { token } = useAuth();
  const { data: workflows = [], isLoading, error } = useWorkflows(token);
  const deleteWorkflow = useDeleteWorkflow();

  const handleDelete = async (id) => {
    try {
      await deleteWorkflow.mutateAsync({ token, id });
      toast.success("Supprimé");
    } catch (error) {
      toast.error("Erreur");
    }
  };

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return <List items={workflows} onDelete={handleDelete} />;
}
```

## Checklist de migration

- [ ] Identifier tous les `useState` qui stockent des données serveur
- [ ] Remplacer par les hooks React Query appropriés
- [ ] Supprimer les fonctions `load*` manuelles
- [ ] Migrer les mutations vers `use*Mutation` hooks
- [ ] Tester les optimistic updates
- [ ] Vérifier la gestion des erreurs
- [ ] Nettoyer le `WorkflowContext`
- [ ] Mettre à jour les tests

## Ressources

- Guidelines React Query : `/AGENTS.md` → Section "Gestion des données avec React Query"
- Hooks disponibles : `/frontend/src/hooks/useWorkflows.ts`
- Exemples d'implémentation : Voir `useModels.ts`, `useWidgets.ts`, `useUsers.ts`
