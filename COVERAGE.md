# Guide de Couverture de Code

Ce projet utilise `pytest-cov` pour mesurer la couverture de code avec un objectif minimum de **80%**.

## Configuration

La configuration de la couverture est définie dans les fichiers `pyproject.toml` :
- `chatkit-python/pyproject.toml` - Configuration pour le SDK
- `backend/pyproject.toml` - Configuration pour le backend

### Paramètres Clés

- **Couverture minimale requise** : 80%
- **Couverture de branches** : Activée
- **Rapports** : Terminal, HTML, XML
- **Exclusions** : Tests, fichiers de cache, migrations

## Utilisation

### SDK chatkit-python

```bash
cd chatkit-python

# Exécuter les tests avec couverture
make coverage

# Générer uniquement le rapport HTML
make coverage-html

# Afficher le rapport dans le terminal
make coverage-report

# Exécuter les tests sans couverture
make test
```

Le rapport HTML est généré dans `chatkit-python/htmlcov/index.html`.

### Backend

```bash
cd backend

# Installer les dépendances de test
pip install -e .[dev]

# Exécuter les tests avec couverture
pytest --cov=app --cov-report=term-missing --cov-report=html

# Exécuter les tests pour un module spécifique
pytest --cov=app.security --cov-report=term-missing app/tests/test_*auth*.py

# Exécuter les tests pour les workflows
pytest --cov=app.workflows --cov-report=term-missing app/tests/test_workflow*.py
```

Le rapport HTML est généré dans `backend/htmlcov/index.html`.

## Modules Critiques à Prioriser

### 🔐 Authentification et Sécurité
- `backend/app/security.py` - Hachage de mots de passe, JWT, utilitaires d'authentification
- `backend/app/routes/auth.py` - Endpoints d'authentification
- Tests : `backend/app/tests/test_*auth*.py`

**Objectif** : Minimum 85% de couverture (critique pour la sécurité)

### 🔄 Workflows
- `backend/app/workflows/service.py` - Service principal de workflows
- `backend/app/workflows/executor.py` - Exécuteur de workflows
- `backend/app/workflows/executor_v2.py` - Exécuteur V2
- `backend/app/workflows/handlers/` - Gestionnaires d'événements
- Tests : `backend/app/tests/test_workflow*.py`, `backend/tests/test_workflow*.py`

**Objectif** : Minimum 80% de couverture

### 💬 Services Critiques ChatKit
- `backend/app/chatkit_server/` - Implémentation du serveur ChatKit
- `backend/app/chatkit.py` - Service principal ChatKit
- `backend/app/chatkit_realtime.py` - Communication temps réel
- `backend/app/chatkit_store.py` - Persistance des données
- `backend/app/chatkit_sessions.py` - Gestion des sessions
- Tests : `backend/app/tests/test_chatkit*.py`

**Objectif** : Minimum 80% de couverture

### 📞 Téléphonie (si utilisé)
- `backend/app/telephony/pjsua_adapter.py` - Adaptateur PJSIP
- `backend/app/telephony/invite_handler.py` - Gestion des invitations SIP
- `backend/app/telephony/outbound_call_manager.py` - Gestion des appels sortants
- Tests : `backend/app/tests/test_telephony*.py`

**Objectif** : Minimum 75% de couverture

### 🗄️ Base de Données et Modèles
- `backend/app/database/` - Module base de données
- `backend/app/models.py` - Modèles de données
- Tests : `backend/app/tests/test_database*.py`

**Objectif** : Minimum 80% de couverture

### 🎓 LTI (Learning Tools Interoperability)
- `backend/app/lti/` - Service LTI
- Tests : `backend/app/tests/test_lti*.py`

**Objectif** : Minimum 80% de couverture

## État Actuel de la Couverture

### SDK chatkit-python
- **Couverture totale** : 82.82% ✅ (objectif atteint)
- **Détails par module** :
  - `chatkit/types.py` : 100% ✅
  - `chatkit/widgets.py` : 99.85% ✅
  - `chatkit/store.py` : 95.45% ✅
  - `chatkit/server.py` : 84.63% ✅
  - `chatkit/agents.py` : 73.33% ⚠️ (nécessite amélioration)
  - `chatkit/errors.py` : 62.50% ❌ (nécessite tests)
  - `chatkit/actions.py` : 55.88% ❌ (nécessite tests)
  - `chatkit/logger.py` : 46.15% ❌ (nécessite tests)

### Backend
*À mesurer après résolution des dépendances de test*

## Rapports de Couverture

### Format Terminal
Affiche la couverture avec les lignes manquantes directement dans le terminal.

### Format HTML
Génère un rapport HTML interactif avec :
- Vue d'ensemble de la couverture par fichier
- Code source annoté montrant les lignes couvertes/non couvertes
- Statistiques de couverture de branches

### Format XML
Utilisé pour l'intégration CI/CD (compatible avec la plupart des outils de CI).

## Intégration CI/CD

Pour intégrer la couverture dans votre pipeline CI/CD :

```yaml
# Exemple GitHub Actions
- name: Run tests with coverage
  run: |
    cd chatkit-python
    make coverage

- name: Upload coverage reports
  uses: codecov/codecov-action@v3
  with:
    files: ./chatkit-python/coverage.xml,./backend/coverage.xml
    fail_ci_if_error: true
```

## Bonnes Pratiques

1. **Exécuter les tests avant chaque commit**
   ```bash
   cd chatkit-python && make check  # lint + type check + tests
   ```

2. **Vérifier la couverture des nouvelles fonctionnalités**
   - Toute nouvelle fonctionnalité doit avoir des tests
   - Viser 100% de couverture pour le nouveau code

3. **Priorités de test**
   - Sécurité et authentification : Couverture maximale
   - Logique métier critique : 80%+ minimum
   - Utilitaires et helpers : 70%+ minimum

4. **Exclusions raisonnables**
   - Code de débogage (`if __name__ == "__main__"`)
   - Imports conditionnels pour typage (`if TYPE_CHECKING`)
   - Méthodes abstraites
   - Code d'erreur impossible à atteindre

## Améliorer la Couverture

### Identifier les zones non couvertes

```bash
# Générer le rapport HTML
cd chatkit-python && make coverage-html

# Ouvrir le rapport
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
start htmlcov/index.html  # Windows
```

### Ajouter des tests pour les modules prioritaires

1. Identifier les fichiers avec <80% de couverture
2. Examiner les lignes non couvertes dans le rapport HTML
3. Écrire des tests pour couvrir les cas manquants
4. Exécuter à nouveau la couverture pour vérifier

### Exemple de test pour améliorer la couverture

```python
# tests/test_security.py
import pytest
from app.security import hash_password, verify_password

def test_hash_password_creates_valid_hash():
    """Test que le hachage produit un hash valide"""
    password = "test_password_123"
    hashed = hash_password(password)
    assert hashed != password
    assert len(hashed) > 0
    assert verify_password(password, hashed)

def test_verify_password_rejects_invalid():
    """Test que la vérification rejette les mots de passe invalides"""
    password = "test_password_123"
    hashed = hash_password(password)
    assert not verify_password("wrong_password", hashed)
```

## Dépannage

### Les tests ne trouvent pas les modules

```bash
# Assurez-vous que le PYTHONPATH est correctement défini
PYTHONPATH=. pytest --cov=chatkit
```

### La couverture semble incorrecte

```bash
# Nettoyer les anciens fichiers de couverture
rm -rf htmlcov .coverage .coverage.*

# Réexécuter les tests
pytest --cov=app --cov-report=html
```

### Erreur "Module not found"

```bash
# Installer les dépendances de développement
pip install -e .[dev]
```

## Ressources

- [pytest-cov documentation](https://pytest-cov.readthedocs.io/)
- [Coverage.py documentation](https://coverage.readthedocs.io/)
- [pytest documentation](https://docs.pytest.org/)
