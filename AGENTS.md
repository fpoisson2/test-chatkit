# Guide pour les tests frontend sans backend

Pour tester uniquement le frontend en local avec des API simulées :

1. Installe les dépendances si nécessaire :
   ```bash
   npm run frontend:install
   ```
2. Expose la variable d'environnement pour activer les mocks côté Vite, puis lance le serveur de développement :
   ```bash
   VITE_USE_MOCK_API=true npm run frontend:dev
   ```
   Ce script est défini dans le `package.json` racine et démarre Vite depuis le dossier `frontend` avec `enableDevMocks` activé.
3. Ouvre ton navigateur sur l'URL indiquée par Vite (généralement http://localhost:5173) pour interagir avec l'UI alimentée par les données simulées.

Pense à désactiver `VITE_USE_MOCK_API` lorsque tu veux reconnecter le frontend au backend réel.

## Qualité du code Python

Avant de soumettre une modification Python, exécute `ruff check` (dans les dossiers pertinents comme `backend` ou `chatkit-python`) et corrige **tous** les problèmes signalés.

## Localisation frontend

Chaque fois que tu ajoutes ou modifies un texte côté UI, pense à l'exposer via le système i18n du dossier `frontend/src/i18n` et à fournir les traductions en anglais **et** en français.

## Design System

Le frontend s'appuie sur un design system maison (couleurs, typographies, composants). Lorsque tu ajoutes ou modifies une UI :

1. **Privilégie les composants existants** du dossier `frontend/src/components/design-system` (ou `frontend/src/features/**/components/design-system`) avant d'en créer de nouveaux.
2. **Respecte les tokens de design** définis dans `frontend/src/styles/tokens/design-system-vars.css` (espacements, couleurs, rayons...).
3. Si un nouveau composant est vraiment nécessaire, **factorise-le dans le design system** avec sa documentation et ses stories, puis réutilise-le dans l'application.
4. Ne surcharge pas les styles en ligne : préfère les classes utilitaires fournies par `frontend/src/styles/design-system/base.css`.
5. Pense à vérifier le rendu dans les thèmes clair et sombre si disponibles et à maintenir l'accessibilité (contraste, focus visibles).

## Gestion des données avec React Query

**TOUJOURS** utiliser React Query (@tanstack/react-query) pour toutes les opérations de gestion de données dans le frontend :

### Principes de base

1. **Pas de useState pour les données serveur** : Ne jamais utiliser `useState` pour stocker des données provenant du backend. Utiliser uniquement `useQuery` et `useMutation`.

2. **Créer des hooks personnalisés** : Toutes les interactions avec le backend doivent être encapsulées dans des hooks personnalisés dans `frontend/src/hooks/`.

3. **Structure des hooks** :
   ```typescript
   // 1. Définir les query keys avec une factory
   export const entityKeys = {
     all: ["entity"] as const,
     lists: () => [...entityKeys.all, "list"] as const,
     list: (token: string | null) => [...entityKeys.lists(), token] as const,
     detail: (id: string) => [...entityKeys.all, "detail", id] as const,
   };

   // 2. Créer les hooks de query
   export function useEntities(token: string | null) {
     return useQuery({
       queryKey: entityKeys.list(token),
       queryFn: () => fetchEntities(token),
       enabled: !!token,
     });
   }

   // 3. Créer les hooks de mutation avec optimistic updates
   export function useCreateEntity() {
     const queryClient = useQueryClient();
     return useMutation({
       mutationFn: (vars: { token: string; payload: EntityPayload }) =>
         createEntity(vars.token, vars.payload),
       onMutate: async (variables) => {
         await queryClient.cancelQueries({ queryKey: entityKeys.list(variables.token) });
         const previous = queryClient.getQueryData(entityKeys.list(variables.token));
         queryClient.setQueryData(
           entityKeys.list(variables.token),
           (old: Entity[] = []) => [...old, { ...variables.payload, id: "temp-id" }]
         );
         return { previous };
       },
       onError: (err, variables, context) => {
         if (context?.previous) {
           queryClient.setQueryData(entityKeys.list(variables.token), context.previous);
         }
       },
       onSettled: (data, error, variables) => {
         queryClient.invalidateQueries({ queryKey: entityKeys.lists() });
       },
     });
   }
   ```

### Optimistic Updates

Toutes les mutations DOIVENT implémenter les optimistic updates pour une meilleure UX :

- **onCreate** : Ajouter l'élément temporairement à la liste
- **onUpdate** : Modifier l'élément temporairement dans la liste
- **onDelete** : Retirer l'élément temporairement de la liste

En cas d'erreur, restaurer l'état précédent via `onError`.

### Invalidation du cache

Utiliser l'invalidation appropriée :
- `invalidateQueries` après succès d'une mutation pour rafraîchir les données
- Utiliser les query keys hiérarchiques pour invalider plusieurs queries liées

### Gestion des erreurs

- Gérer les erreurs 401 (Unauthorized) en déconnectant l'utilisateur
- Utiliser `isUnauthorizedError()` depuis `frontend/src/api/backend.ts`
- Afficher des messages d'erreur appropriés à l'utilisateur

### Exemple d'utilisation dans un composant

```typescript
function MyComponent() {
  const { token } = useAuth();
  const { data = [], isLoading, error } = useEntities(token);
  const createEntity = useCreateEntity();

  const handleCreate = async (payload: EntityPayload) => {
    try {
      await createEntity.mutateAsync({ token, payload });
      // L'UI est déjà mise à jour optimistiquement
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
      }
      // Afficher l'erreur à l'utilisateur
    }
  };

  if (isLoading) return <div>Chargement...</div>;
  if (error) return <div>Erreur: {error.message}</div>;

  return <div>{/* Utiliser data */}</div>;
}
```

### DevTools

En développement, utiliser React Query DevTools pour déboguer :
```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// Dans App.tsx
<QueryClientProvider client={queryClient}>
  <App />
  <ReactQueryDevtools initialIsOpen={false} />
</QueryClientProvider>
```
