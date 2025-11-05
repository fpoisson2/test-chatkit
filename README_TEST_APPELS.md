# 📞 Test des Appels Entrants - Guide Rapide

Scripts Python pour tester les appels entrants SIP avec PJSUA.

## 🚀 Démarrage Rapide

### 1. Installation

```bash
# Installer les dépendances
cd backend
pip install -r requirements.txt
```

### 2. Configuration

```bash
# Copier le fichier de configuration exemple
cp test_config.example.env test_config.env

# Éditer avec vos paramètres SIP
nano test_config.env
```

### 3. Lancement

**Option A: Script bash (recommandé)**
```bash
# Test minimal
./run_test.sh minimal

# Test simple
./run_test.sh simple

# Test avec Voice Bridge (OpenAI)
./run_test.sh bridge
```

**Option B: Scripts Python directs**
```bash
# Test minimal (ultra-simple)
./test_incoming_calls_minimal.py sip:user@domain.com username password

# Test simple (complet)
./test_incoming_calls.py --sip-uri sip:user@domain.com --username user --password pass

# Test avec bridge (intégration OpenAI)
export OPENAI_API_KEY="sk-..."
./test_incoming_calls_with_bridge.py --sip-uri sip:user@domain.com --username user --password pass
```

## 📁 Fichiers Créés

| Fichier | Description |
|---------|-------------|
| `test_incoming_calls_minimal.py` | Script minimal sans dépendances (3 arguments) |
| `test_incoming_calls.py` | Script complet avec PJSUA (options avancées) |
| `test_incoming_calls_with_bridge.py` | Intégration complète avec Voice Bridge + OpenAI |
| `run_test.sh` | Script bash pour lancer facilement les tests |
| `test_config.example.env` | Exemple de configuration |
| `TEST_APPELS_ENTRANTS.md` | Documentation complète |

## 🎯 Quel Script Utiliser ?

### `test_incoming_calls_minimal.py`
✅ **Quand :** Vous voulez juste vérifier que PJSUA fonctionne
✅ **Avantages :** Ultra-simple, 3 arguments seulement
✅ **Utilisation :**
```bash
./test_incoming_calls_minimal.py sip:test@example.com test secret
```

### `test_incoming_calls.py`
✅ **Quand :** Vous voulez tester en détail votre configuration SIP
✅ **Avantages :** Options avancées (TCP, ports, timeout)
✅ **Utilisation :**
```bash
./test_incoming_calls.py \
  --sip-uri sip:test@example.com \
  --username test \
  --password secret \
  --transport UDP \
  --port 5060
```

### `test_incoming_calls_with_bridge.py`
✅ **Quand :** Vous voulez tester l'intégration complète avec OpenAI
✅ **Avantages :** Voice Bridge, API Realtime, transcriptions
✅ **Nécessite :** Clé API OpenAI
✅ **Utilisation :**
```bash
export OPENAI_API_KEY="sk-..."
./test_incoming_calls_with_bridge.py \
  --sip-uri sip:test@example.com \
  --username test \
  --password secret \
  --voice shimmer \
  --instructions "Parlez français et soyez bref"
```

## 🔧 Configuration SIP

Éditez `test_config.env` :

```bash
# Configuration SIP
SIP_URI=sip:votre_numero@votre_provider.com
REGISTRAR_URI=sip:votre_provider.com
SIP_USERNAME=votre_numero
SIP_PASSWORD=votre_mot_de_passe

# OpenAI (pour test avec bridge)
OPENAI_API_KEY=sk-...
OPENAI_VOICE=alloy
```

## 📊 Logs

Les scripts affichent des logs avec emojis :

- 📞 Événements d'appel
- 🎵 Événements audio
- ✅ Succès
- ❌ Erreurs
- 🧹 Nettoyage

Activez le mode verbeux pour plus de détails :
```bash
./run_test.sh -v simple
```

## 🐛 Dépannage

### "PJSUA2 n'est pas disponible"
```bash
pip install pjsua2
```

### "OPENAI_API_KEY doit être défini"
```bash
export OPENAI_API_KEY="sk-..."
# OU
echo 'OPENAI_API_KEY=sk-...' >> test_config.env
```

### Le script ne reçoit pas d'appels

1. Vérifiez l'enregistrement SIP (cherchez "✅ ENREGISTRÉ" dans les logs)
2. Vérifiez que le port 5060 n'est pas bloqué
3. Testez en mode verbeux : `./run_test.sh -v simple`

## 📖 Documentation Complète

Voir [TEST_APPELS_ENTRANTS.md](TEST_APPELS_ENTRANTS.md) pour :
- Guide détaillé de chaque script
- Exemples avancés
- Architecture du système
- Dépannage complet

## 🎬 Exemples d'utilisation

### Test rapide de 5 minutes
```bash
./run_test.sh -d 300 simple
```

### Test avec configuration personnalisée
```bash
./run_test.sh -c my_custom_config.env bridge
```

### Test avec voix personnalisée
```bash
./test_incoming_calls_with_bridge.py \
  --sip-uri sip:test@example.com \
  --username test \
  --password secret \
  --voice shimmer \
  --instructions "Tu es un robot sympathique"
```

## 🛑 Arrêt

Appuyez sur **Ctrl+C** pour arrêter proprement un test.

## 📝 Notes

- Les scripts acceptent automatiquement tous les appels entrants
- L'audio est connecté bidirectionnellement (microphone ↔ téléphone)
- Les statistiques sont affichées à la fin
- Le nettoyage est automatique

---

**Bon test ! 🚀**
