# Guide de Migration - State Machine Architecture (v2)

## 📋 Vue d'Ensemble

Ce guide explique comment migrer de l'executor monolithique (`run_workflow`) vers la nouvelle architecture state machine (`run_workflow_v2`).

## 🎯 Qu'est-ce qui change ?

### Avant (v1 - Monolithique)
```python
from backend.app.workflows.executor import run_workflow

result = await run_workflow(
    workflow_input,
    agent_context=context,
    # ... autres paramètres
)
```

### Après (v2 - State Machine)
```python
from backend.app.workflows.executor_v2 import run_workflow_v2

result = await run_workflow_v2(
    workflow_input,
    agent_context=context,
    # ... mêmes paramètres !
)
```

**La signature est identique** - seule l'implémentation interne change.

## ✅ Avantages de v2

1. **Architecture Modulaire**
   - 15 handlers séparés au lieu d'une fonction de 3,270 lignes
   - Chaque type de nœud a son propre handler testable

2. **Maintenabilité**
   - Code organisé et facile à comprendre
   - Modifications localisées par type de nœud
   - Aucune variable `nonlocal` (état explicite)

3. **Testabilité**
   - Tests unitaires pour chaque handler
   - Tests d'intégration simplifiés
   - Mocking facile des dépendances

4. **Performance**
   - Même performance que v1
   - Pas d'overhead significatif
   - Exécution parallèle optimisée

5. **Extensibilité**
   - Ajout de nouveaux types de nœuds facile
   - Pattern réutilisable
   - Architecture évolutive

## 🚀 Stratégie de Migration

### Option A : Migration Progressive (Recommandée)

Migrez progressivement les workflows un par un :

```python
# Dans votre code d'appel
USE_V2_EXECUTOR = os.getenv("USE_V2_EXECUTOR", "false").lower() == "true"

if USE_V2_EXECUTOR:
    from backend.app.workflows.executor_v2 import run_workflow_v2 as run_workflow
else:
    from backend.app.workflows.executor import run_workflow

result = await run_workflow(workflow_input, agent_context=context, ...)
```

**Étapes :**
1. Déployez v2 en tant que feature flag
2. Testez sur workflows non-critiques
3. Activez progressivement par workflow
4. Une fois stable, activez globalement
5. Supprimez v1 après période de stabilisation

### Option B : Migration Directe

Remplacez directement tous les imports :

```python
# Avant
from backend.app.workflows.executor import run_workflow

# Après
from backend.app.workflows.executor_v2 import run_workflow_v2 as run_workflow
```

⚠️ **Attention** : Testez en profondeur avant de déployer en production.

### Option C : Dual Running (Validation)

Exécutez les deux versions en parallèle pour validation :

```python
from backend.app.workflows.executor import run_workflow as run_workflow_v1
from backend.app.workflows.executor_v2 import run_workflow_v2

# En production
result = await run_workflow_v1(workflow_input, agent_context=context, ...)

# En background pour validation
try:
    result_v2 = await run_workflow_v2(workflow_input, agent_context=context, ...)
    # Compare results, log differences
    if result != result_v2:
        logger.warning("V1/V2 mismatch detected")
except Exception as e:
    logger.error(f"V2 execution failed: {e}")
```

## 🧪 Testing

### Tests Unitaires (Handlers)

```python
from backend.app.workflows.handlers.condition import ConditionNodeHandler
from backend.app.workflows.runtime.state_machine import ExecutionContext

async def test_condition_handler():
    handler = ConditionNodeHandler()

    # Setup context
    context = ExecutionContext(
        state={"value": 42},
        conversation_history=[],
        last_step_context={},
        steps=[],
        nodes_by_slug=test_nodes,
        edges_by_source=test_edges,
        current_slug="test_node",
    )

    # Execute
    result = await handler.execute(test_node, context)

    # Assert
    assert result.next_slug == "expected_next"
    assert context.state["value"] == 42
```

### Tests d'Intégration

```python
async def test_full_workflow_v2():
    workflow_input = WorkflowInput(...)
    agent_context = AgentContext(...)

    result = await run_workflow_v2(
        workflow_input,
        agent_context=agent_context,
    )

    assert result.final_output is not None
    assert result.final_node_slug == "end"
    assert len(result.steps) > 0
```

### Tests de Régression

```python
async def test_v1_v2_parity():
    """Ensure v2 produces same results as v1."""
    workflow_input = WorkflowInput(...)
    agent_context = AgentContext(...)

    result_v1 = await run_workflow(workflow_input, agent_context=agent_context)
    result_v2 = await run_workflow_v2(workflow_input, agent_context=agent_context)

    assert result_v1.final_output == result_v2.final_output
    assert result_v1.state == result_v2.state
    assert len(result_v1.steps) == len(result_v2.steps)
```

## 📝 Compatibilité

### ✅ Compatible

- **Signature identique** : Tous les paramètres sont identiques
- **Résultats identiques** : Même `WorkflowRunSummary`
- **Workflows existants** : Tous les types de nœuds supportés
- **Callbacks** : `on_step`, `on_stream_event`, etc. fonctionnent
- **Nested workflows** : Support complet
- **Parallel execution** : Implémenté
- **Wait states** : Gestion complète
- **Widgets** : Support complet
- **Vector stores** : Intégré

### ⚠️ Différences Mineures

Aucune différence de comportement attendue. Si vous trouvez des différences, veuillez créer un issue.

## 🐛 Troubleshooting

### Problème : Handler non trouvé

**Erreur** : `KeyError: 'unknown_node_type'`

**Solution** : Le type de nœud n'est pas encore supporté. Vérifiez la factory :

```python
# backend/app/workflows/handlers/factory.py
machine.register_handler("your_node_type", YourNodeHandler())
```

### Problème : Dépendance manquante

**Erreur** : `KeyError: 'some_dependency'` dans `runtime_vars`

**Solution** : Ajoutez la dépendance dans `executor_v2.py` :

```python
context.runtime_vars["some_dependency"] = some_value
```

### Problème : Résultats différents v1 vs v2

**Solution** :
1. Activez le logging détaillé
2. Comparez les steps un par un
3. Vérifiez les transitions
4. Créez un issue avec l'exemple minimal

## 📊 Monitoring

### Métriques à Surveiller

```python
# Exemple de métriques
metrics = {
    "executor_version": "v2",
    "workflow_slug": workflow_slug,
    "execution_time_ms": elapsed_time,
    "steps_executed": len(result.steps),
    "final_status": result.final_end_state.status_type if result.final_end_state else "completed",
    "errors": error_count,
}
```

### Logging

```python
logger.info(
    f"Workflow executed with v2",
    extra={
        "workflow_slug": workflow_slug,
        "steps": len(result.steps),
        "duration_ms": duration,
    }
)
```

## 🔄 Rollback Plan

Si vous rencontrez des problèmes avec v2 :

1. **Désactivez le feature flag** :
   ```bash
   export USE_V2_EXECUTOR=false
   ```

2. **Revertez les imports** :
   ```python
   from backend.app.workflows.executor import run_workflow
   ```

3. **Redéployez** la version précédente

4. **Analysez les logs** pour identifier le problème

5. **Créez un issue** avec les détails

## 📚 Ressources

- [REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md) - Vue d'ensemble de l'architecture
- [STATE_MACHINE_REFACTORING.md](STATE_MACHINE_REFACTORING.md) - Documentation technique détaillée
- [executor_v2.py](executor_v2.py) - Code source v2
- [handlers/](handlers/) - Tous les handlers implémentés

## ❓ FAQ

### Q: Est-ce que v2 est stable ?
**R**: Oui, tous les handlers sont implémentés et testés. Cependant, nous recommandons une migration progressive.

### Q: Est-ce que v2 est plus lent ?
**R**: Non, les performances sont équivalentes. La state machine ajoute un overhead négligeable.

### Q: Puis-je utiliser v1 et v2 simultanément ?
**R**: Oui, utilisez des feature flags pour contrôler quelle version utiliser.

### Q: Que faire si un handler est manquant ?
**R**: Tous les types de nœuds core sont implémentés (15 handlers). Si vous utilisez un type custom, créez un handler.

### Q: Comment ajouter un nouveau type de nœud ?
**R**:
1. Créez un handler dans `handlers/your_handler.py`
2. Héritez de `BaseNodeHandler`
3. Implémentez `execute()`
4. Enregistrez dans `factory.py`

## 🎯 Next Steps

1. ✅ Lisez ce guide complètement
2. ✅ Configurez un environnement de test
3. ✅ Testez v2 sur un workflow simple
4. ✅ Comparez les résultats v1 vs v2
5. ✅ Migrez progressivement
6. ✅ Moniteur et ajustez
7. ✅ Partagez votre feedback

---

**Status** : ✅ Production Ready (avec migration progressive recommandée)

**Version** : 2.0.0

**Dernière mise à jour** : 2025-01-XX
