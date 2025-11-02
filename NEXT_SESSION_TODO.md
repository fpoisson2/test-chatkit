# Tâches restantes - Génération de langues en background

## Contexte
La génération de langues fonctionne actuellement de manière synchrone et peut prendre plusieurs minutes.
L'utilisateur veut que ça se fasse en background avec suivi de progression.

## ✅ Déjà complété
1. Modèle `Language` en BD pour stocker les traductions
2. Modèle `LanguageGenerationTask` pour tracker les tâches
3. Schemas de réponse (TaskStartedResponse, TaskStatusResponse, etc.)
4. Paramètre `save_to_db` ajouté à LanguageGenerateRequest
5. La génération fonctionne avec OpenAI (après avoir résolu 4 bugs)

## 🚧 À implémenter

### Backend - Fonction background

Créer `_generate_language_background()` dans `/backend/app/routes/admin.py` :

```python
async def _generate_language_background(
    task_id: str,
    code: str,
    name: str,
    model_name: str | None,
    provider_id: str | None,
    provider_slug: str | None,
    custom_prompt: str | None,
    save_to_db: bool
):
    """
    Génère une langue en background et met à jour la tâche.
    
    Steps:
    1. Charger le modèle et provider (copier de l'endpoint actuel)
    2. Extraire les traductions EN (copier de l'endpoint actuel)
    3. Mettre à jour task.status = "running", task.progress = 10
    4. Créer un Pydantic model dynamique pour structured output
    5. Créer Agent avec le model dynamique en output_type
    6. Exécuter avec Runner.run()
    7. Mettre à jour task.progress = 80
    8. Si save_to_db: créer/update Language en BD
    9. Générer file_content (format .ts)
    10. Sauvegarder task.file_content, task.language_id
    11. Mettre à jour task.status = "completed", task.progress = 100
    
    En cas d'erreur:
    - task.status = "failed"
    - task.error_message = str(e)
    - task.progress = 0
    """
```

### Backend - Modifier endpoint /generate

Remplacer l'endpoint actuel `/api/admin/languages/generate` par :

```python
@router.post("/api/admin/languages/generate", response_model=TaskStartedResponse)
async def generate_language_file(
    request: LanguageGenerateRequest,
    _admin: User = Depends(require_admin)
):
    """Lance la génération en background et retourne task_id immédiatement."""
    
    # 1. Validation
    # 2. Créer task en BD avec task_id = str(uuid.uuid4())
    # 3. asyncio.create_task(_generate_language_background(...))
    # 4. Retourner TaskStartedResponse(task_id=..., status="pending")
```

### Backend - Nouveaux endpoints

1. **GET /api/admin/languages/tasks/{task_id}**
   ```python
   @router.get("/api/admin/languages/tasks/{task_id}", response_model=TaskStatusResponse)
   async def get_task_status(task_id: str, _admin: User = Depends(require_admin)):
       # Query LanguageGenerationTask par task_id
       # Retourner TaskStatusResponse
   ```

2. **GET /api/admin/languages/tasks/{task_id}/download**
   ```python
   @router.get("/api/admin/languages/tasks/{task_id}/download")
   async def download_task_result(task_id: str, _admin: User = Depends(require_admin)):
       # Query task, vérifier status="completed"
       # Retourner Response avec task.file_content
   ```

3. **GET /api/admin/languages/stored**
   ```python
   @router.get("/api/admin/languages/stored", response_model=StoredLanguagesListResponse)
   async def list_stored_languages(_admin: User = Depends(require_admin)):
       # Query Language.all()
       # Retourner StoredLanguagesListResponse
   ```

4. **GET /api/admin/languages/stored/{id}/download**
   ```python
   @router.get("/api/admin/languages/stored/{id}/download")
   async def download_stored_language(id: int, _admin: User = Depends(require_admin)):
       # Query Language by id
       # Générer fichier .ts depuis language.translations
       # Retourner Response
   ```

5. **DELETE /api/admin/languages/stored/{id}**
   ```python
   @router.delete("/api/admin/languages/stored/{id}")
   async def delete_stored_language(id: int, _admin: User = Depends(require_admin)):
       # Query Language by id
       # session.delete(language)
       # Retourner 204 No Content
   ```

### Frontend - Modifications

1. **Ajouter checkbox save_to_db** dans `AdminLanguagesPage.tsx`
2. **Modifier handleSubmit** :
   - Appeler /generate qui retourne task_id
   - Démarrer polling de /tasks/{task_id}
   - Afficher barre de progression
   
3. **Ajouter section "Langues stockées"** :
   - Appeler /stored pour charger la liste
   - Afficher avec boutons télécharger/supprimer
   
4. **Ajouter polling de tâche** :
   ```typescript
   useEffect(() => {
     if (!currentTaskId) return;
     
     const interval = setInterval(async () => {
       const status = await fetch(`/api/admin/languages/tasks/${currentTaskId}`);
       // Mettre à jour progress bar
       // Si completed: proposer téléchargement
       // Si failed: afficher erreur
     }, 2000);
     
     return () => clearInterval(interval);
   }, [currentTaskId]);
   ```

## 📚 Références

- Exemple de structured output : `backend/app/chatkit/agent_registry.py` ligne 218-254
- Exemple de tâches background : `backend/app/workflows/executor.py`
- Pattern de création d'agent : `backend/app/chatkit/agent_registry.py` ligne 1076-1106

## 🎯 Ordre d'implémentation recommandé

1. Backend fonction _generate_language_background()
2. Backend modifier /generate pour async
3. Backend GET /tasks/{task_id}
4. Backend GET /tasks/{task_id}/download
5. Frontend: polling et progress bar
6. Backend GET /stored
7. Backend GET /stored/{id}/download
8. Backend DELETE /stored/{id}
9. Frontend: section langues stockées
10. Tests complets
