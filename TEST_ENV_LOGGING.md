# Vérification: Avez-vous ajouté CHATKIT_CALL_TRACKER_ONLY=true à votre .env ?

## Test 1: Vérifiez que la variable est définie

Dans vos logs, cherchez cette ligne au démarrage du backend:

```
✅ Logs filtrés: UNIQUEMENT chatkit.telephony.call_tracker visible
```

### Si vous NE voyez PAS ce message:
La variable n'est pas activée. 

**Solution:** Ajoutez à votre fichier `.env`:
```bash
CHATKIT_CALL_TRACKER_ONLY=true
```

Puis **relancez complètement le backend**:
```bash
docker-compose down
docker-compose up backend
```

## Test 2: Vérifiez dans les logs de démarrage

Si vous voyez encore des logs comme:
- `INFO:chatkit.server:...`
- `INFO:chatkit.telephony.pjsua:...`
- `INFO:chatkit.realtime.gateway:...`

C'est que la variable n'est **PAS** activée.

## Où ajouter la variable?

**Fichier: `.env`** (à la racine de votre projet, à côté de docker-compose.yml)

```bash
# ... vos autres variables ...

# Activer le filtrage des logs (ne montrer que call_tracker)
CHATKIT_CALL_TRACKER_ONLY=true
```

Sauvegardez et relancez:
```bash
docker-compose restart backend
```

## Ce que vous DEVEZ voir

**Au démarrage:**
```
✅ Logs filtrés: UNIQUEMENT chatkit.telephony.call_tracker visible
```

**Pendant les appels, UNIQUEMENT:**
```
================================================================================
📞 CONFIGURATION APPEL ENTRANT
================================================================================
[infos structurées]
```

**Ce qui doit DISPARAÎTRE:**
- ❌ `INFO:chatkit.server:...`
- ❌ `INFO:chatkit.telephony.pjsua:...` 
- ❌ `DEBUG:chatkit.server:...`
- ❌ `INFO:chatkit.realtime.gateway:...`
- ❌ Tous les logs PJSUA en C (`15:09:36.871 pjsua_call.c...`)
- ❌ Les logs httpcore/httpx/mcp

## Note importante sur les logs PJSUA en C

Les logs PJSUA natifs en C (comme `15:09:36.871 pjsua_call.c`) ne peuvent pas être filtrés par la configuration Python. Ce sont des logs au niveau de la bibliothèque C.

Pour les masquer aussi, il faudrait configurer le niveau de log de PJSUA au démarrage.
