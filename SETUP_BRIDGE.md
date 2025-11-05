# 🌉 Configuration du Test avec Voice Bridge

Guide pour configurer et utiliser le test avec Voice Bridge (intégration OpenAI).

## 📋 Prérequis

1. **PJSUA2** installé (voir [INSTALL_PJSUA2.md](INSTALL_PJSUA2.md))
2. **Clé API OpenAI** valide
3. **Python 3.10+** avec venv

## 🚀 Installation

### 1. Activer le venv

```bash
source venv/bin/activate
```

### 2. Installer les dépendances

**Option A: Installation rapide (recommandé)**
```bash
pip install -r requirements_bridge.txt
```

**Option B: Installation manuelle**
```bash
pip install openai python-dotenv httpx fastapi numpy psutil soxr
```

### 3. Configuration

```bash
# Éditer test_config.env
nano test_config.env
```

**Paramètres requis:**
```bash
# Configuration SIP
SIP_URI=sip:votre_numero@domaine.com
SIP_USERNAME=votre_numero
SIP_PASSWORD=votre_mot_de_passe

# Configuration OpenAI (IMPORTANT!)
OPENAI_API_KEY=sk-proj-...  # Votre clé API
OPENAI_MODEL=gpt-4o-realtime-preview  # Modèle Realtime
OPENAI_VOICE=alloy  # Ou: echo, shimmer, ash, ballad, coral, sage, verse

# Instructions (IMPORTANT: pas d'espace autour du =)
OPENAI_INSTRUCTIONS="Vous êtes un assistant vocal. Répondez brièvement en français."
```

## ✅ Vérification

```bash
# Vérifier les dépendances
python3 -c "import openai, fastapi, numpy, soxr, pjsua2; print('✅ Toutes les dépendances OK')"

# Vérifier la configuration
make -f Makefile.test check
```

## 🧪 Test

### Test basique (60 secondes)

```bash
./run_test.sh bridge
```

### Test personnalisé

```bash
"$PJSIP_PY" test_incoming_calls_with_bridge.py \
  --sip-uri sip:102@192.168.1.155 \
  --username 102 \
  --password votre_password \
  --voice shimmer \
  --instructions "Tu es un robot sympathique qui parle français" \
  --duration 300
```

## 📖 Utilisation

### Workflow typique

1. **Lancer le test:**
```bash
./run_test.sh bridge
```

2. **Appeler votre numéro SIP** depuis un téléphone

3. **Parler avec l'assistant IA**
   - L'assistant utilise l'API Realtime d'OpenAI
   - Il répond vocalement en temps réel
   - Les transcriptions sont affichées dans les logs

4. **Raccrocher** quand vous avez fini

5. **Voir les statistiques:**
   - Durée de l'appel
   - Audio entrant/sortant (bytes)
   - Nombre de transcriptions
   - Erreurs éventuelles

### Options avancées

**Changer la voix:**
```bash
# Tester différentes voix
for voice in alloy echo shimmer ash ballad coral sage verse; do
  echo "Test avec $voice"
  ./run_test.sh bridge # avec OPENAI_VOICE=$voice dans config
done
```

**Changer les instructions:**
```bash
# Éditer test_config.env
OPENAI_INSTRUCTIONS="Tu es un expert en cuisine française. Réponds brièvement."
```

**Changer le modèle:**
```bash
# Dans test_config.env
OPENAI_MODEL=gpt-4o-realtime-preview  # Modèle recommandé
```

## 🐛 Dépannage

### Erreur: "No module named 'fastapi'"

**Solution:**
```bash
source venv/bin/activate
pip install fastapi numpy psutil soxr
```

### Erreur: "No module named 'backend'"

**Cause:** Le script ne trouve pas les modules backend.

**Solution:** Le script ajoute automatiquement le répertoire backend au path. Vérifiez que vous êtes dans le bon répertoire:
```bash
pwd
# Devrait afficher: /home/fpoisson/Documents/GitHub/test-chatkit

ls backend/app/telephony/
# Devrait lister: voice_bridge.py, pjsua_adapter.py, etc.
```

### Erreur: "OPENAI_API_KEY doit être défini"

**Solution:**
```bash
# Dans test_config.env
OPENAI_API_KEY=sk-proj-votre-clé

# OU export temporaire
export OPENAI_API_KEY="sk-proj-votre-clé"
./run_test.sh bridge
```

### Erreur: Invalid API key

**Causes:**
- Clé API expirée
- Clé API invalide
- Compte OpenAI sans crédit

**Vérification:**
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | head
```

### L'audio est haché ou saccadé

**Cause:** Problème de resampling ou de latence réseau.

**Solutions:**
1. **Vérifier la connexion Internet:**
```bash
ping 8.8.8.8
```

2. **Vérifier la latence avec OpenAI:**
```bash
ping api.openai.com
```

3. **Réduire la charge CPU** (fermer autres applications)

### Pas de transcription

**Cause:** L'API Realtime ne détecte pas la parole.

**Solutions:**
1. **Parler plus fort** ou plus clairement
2. **Vérifier le micro** du téléphone
3. **Activer les logs verbeux:**
```bash
./run_test.sh -v bridge
```

## 📊 Statistiques

Le test affiche des statistiques à la fin:

```
✅ Voice bridge terminé pour l'appel 1
   Durée: 45.23 secondes
   Audio entrant: 123456 bytes
   Audio sortant: 234567 bytes
   Transcriptions: 12

📊 Statistiques:
   total_sessions: 1
   total_errors: 0
   total_outbound_audio_bytes: 234567
```

## 🎓 Architecture

Le test avec bridge utilise:

```
Téléphone SIP
    ↓ (SIP/RTP)
PJSUAAdapter (backend/app/telephony/pjsua_adapter.py)
    ↓
PJSUAAudioBridge (backend/app/telephony/pjsua_audio_bridge.py)
    ↓ (resampling 8kHz→16kHz)
TelephonyVoiceBridge (backend/app/telephony/voice_bridge.py)
    ↓ (WebSocket)
OpenAI Realtime API
```

## 💡 Conseils

### Optimiser les coûts

L'API Realtime d'OpenAI est **payante**. Pour limiter les coûts:

1. **Utiliser `--duration`** pour limiter la durée:
```bash
./run_test.sh -d 60 bridge  # Max 60 secondes
```

2. **Tester d'abord avec le test simple** (gratuit):
```bash
./run_test.sh simple
```

3. **Raccrocher rapidement** après validation

### Tester sans appel réel

Pour tester la configuration sans appeler:

```bash
# Test des imports seulement
"$PJSIP_PY" -c "
from backend.app.telephony.voice_bridge import TelephonyVoiceBridge
print('✅ Imports OK')
"
```

### Logs détaillés

Pour débugger:
```bash
./run_test.sh -v bridge  # Mode verbeux

# OU éditer le script et changer le niveau de log
logging.getLogger().setLevel(logging.DEBUG)
```

## 📚 Ressources

- **OpenAI Realtime API:** https://platform.openai.com/docs/guides/realtime
- **PJSUA2 Python:** https://www.pjsip.org/pjsua2.htm
- **Code source:** `backend/app/telephony/voice_bridge.py`
- **Audio bridge:** `backend/app/telephony/pjsua_audio_bridge.py`

---

**Dernière mise à jour:** 2025-11-05
