# Comment voir UNIQUEMENT les logs d'appels

## Méthode 1: Variable d'environnement (LA PLUS SIMPLE!)

**C'EST DÉJÀ CONFIGURÉ!** Il suffit d'ajouter une ligne à votre `.env`:

```bash
CHATKIT_CALL_TRACKER_ONLY=true
```

Puis relancez votre backend:

```bash
docker-compose restart backend
# ou
docker-compose up backend
```

Vous ne verrez plus que les logs d'appels structurés! 🎉

**Voir:** `.env.example.call_tracker` pour un exemple complet avec documentation.

---

## Méthode 2: Modifier le fichier de démarrage principal

Trouvez votre fichier de démarrage (probablement `backend/app/main.py` ou similaire) et ajoutez ceci **TOUT AU DÉBUT**, avant les autres imports:

```python
import logging
import sys

# CONFIGURATION: Ne montrer QUE les logs d'appels
def setup_call_tracker_logging():
    formatter = logging.Formatter('%(message)s')
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    # Couper TOUT par défaut
    logging.basicConfig(level=logging.CRITICAL, handlers=[])

    # Désactiver tous les loggers bruyants
    for name in ['chatkit.telephony.pjsua', 'chatkit.server', 'chatkit.telephony.voice_bridge',
                 'httpcore', 'httpx', 'mcp', 'openai', 'uvicorn']:
        logging.getLogger(name).setLevel(logging.CRITICAL)
        logging.getLogger(name).propagate = False

    # Activer UNIQUEMENT le call tracker
    call_tracker = logging.getLogger('chatkit.telephony.call_tracker')
    call_tracker.setLevel(logging.INFO)
    call_tracker.handlers = [handler]
    call_tracker.propagate = False

# APPELER IMMÉDIATEMENT
setup_call_tracker_logging()

# Ensuite vos imports normaux...
from fastapi import FastAPI
# etc...
```

## Méthode 2: Utiliser le fichier Python fourni

1. Le fichier `logging_config_call_tracker_only.py` a été créé
2. Dans votre fichier de démarrage principal:

```python
# Au tout début du fichier
from logging_config_call_tracker_only import configure_call_tracker_only_logging
configure_call_tracker_only_logging()

# Ensuite vos imports normaux...
```

## Méthode 3: Variable d'environnement + code

Dans votre docker-compose.yml ou .env:

```yaml
PYTHONUNBUFFERED=1
CALL_TRACKER_ONLY=true
```

Puis dans votre code de démarrage:

```python
import os
if os.getenv('CALL_TRACKER_ONLY') == 'true':
    from logging_config_call_tracker_only import configure_call_tracker_only_logging
    configure_call_tracker_only_logging()
```

## Test

Après configuration, vous devriez voir UNIQUEMENT:

```
================================================================================
📞 CONFIGURATION APPEL ENTRANT (call_id=xxx)
================================================================================
📍 Numéro entrant: 100
🤖 Modèle: gpt-realtime
...

================================================================================
✅ SESSION VOCALE CRÉÉE AVEC SUCCÈS
================================================================================
...

================================================================================
✅ APPEL ACCEPTÉ - EN ATTENTE DE MÉDIA ACTIF
================================================================================
...
```

**Tous les autres logs (PJSUA, httpcore, mcp, etc.) seront masqués.**

## Problème: Vous voyez encore des logs ?

Si vous voyez encore des logs parasites, c'est que le logging est configuré APRÈS leur initialisation.

**Solution:** Déplacez l'appel à `configure_call_tracker_only_logging()` encore PLUS TÔT dans votre fichier de démarrage, idéalement comme toute première ligne après les imports système.
