# 🚀 Démarrage Rapide - Test des Appels Entrants

## 📦 Installation (3 étapes)

### 1. Installer PJSUA2 (système)

```bash
sudo apt-get update
sudo apt-get install python3-pjsua2
```

**Vérification:**
```bash
python3 -c "import pjsua2; print('✅ PJSUA2 OK')"
```

### 2. Installation automatique (recommandé)

```bash
./install_for_test.sh
```

Ce script va:
- ✅ Vérifier PJSUA2
- ✅ Installer les dépendances Python
- ✅ Lier PJSUA2 au venv
- ✅ Créer test_config.env

**OU installation manuelle:**

```bash
# Activer le venv
source venv/bin/activate

# Installer les dépendances
pip install openai python-dotenv

# Lier pjsua2 (optionnel, pour utiliser le venv)
python3 <<EOF
import sys, os
pv = f"{sys.version_info.major}.{sys.version_info.minor}"
site = f"venv/lib/python{pv}/site-packages"
os.system(f"ln -sf /usr/lib/python3/dist-packages/pjsua2* {site}/")
EOF
```

### 3. Configuration

```bash
# Créer le fichier de config
cp test_config.example.env test_config.env

# Éditer avec vos paramètres SIP
nano test_config.env
```

**Exemple de configuration:**
```bash
SIP_URI=sip:1234@voip.example.com
SIP_USERNAME=1234
SIP_PASSWORD=votre_mot_de_passe
SIP_TRANSPORT=UDP
SIP_PORT=5060
```

## 🧪 Test

### Test rapide (sans venv)

```bash
python3 test_incoming_calls_minimal.py \
  sip:1234@voip.example.com \
  1234 \
  votre_mot_de_passe
```

### Test avec le Makefile

```bash
# Vérifier la config
make -f Makefile.test check

# Lancer un test
make -f Makefile.test test-minimal
```

### Test avec le script bash

```bash
# Sortir du venv si activé
deactivate

# Test minimal
./run_test.sh minimal

# Test simple
./run_test.sh simple
```

## ✅ Vérification complète

```bash
make -f Makefile.test check
```

Devrait afficher:
```
✅ PJSUA2 installé
✅ test_config.env existe
✅ SIP_URI défini
✅ SIP_USERNAME défini
✅ SIP_PASSWORD défini
```

## 🎯 Quel test choisir?

### `test-minimal` - Le plus simple
- ✅ 3 arguments seulement
- ✅ Pas de dépendances complexes
- ✅ Idéal pour débuter

```bash
python3 test_incoming_calls_minimal.py sip:user@domain.com username password
```

### `test-simple` - Complet
- ✅ Options avancées
- ✅ Logs détaillés
- ✅ Support TCP/UDP

```bash
./run_test.sh simple
```

### `test-bridge` - Avec OpenAI
- 🤖 Assistant vocal IA
- 📝 Transcriptions
- ⚠️ Nécessite OPENAI_API_KEY

```bash
export OPENAI_API_KEY="sk-..."
./run_test.sh bridge
```

## 🐛 Problèmes courants

### "PJSUA2 non installé"

```bash
sudo apt-get install python3-pjsua2
python3 -c "import pjsua2; print('OK')"
```

### "test_config.env manquant"

```bash
make -f Makefile.test config
nano test_config.env
```

### "venv/bin/activate: Aucun fichier"

```bash
# Recréer le venv
rm -rf venv
python3 -m venv venv
source venv/bin/activate
```

### Les tests utilisent Python système, pas le venv

C'est normal! PJSUA2 est installé au niveau système.
Les scripts fonctionnent avec ou sans venv.

## 📞 Utilisation

1. **Lancez un test**
```bash
./run_test.sh minimal
```

2. **Appelez votre numéro SIP**
   - L'appel sera accepté automatiquement
   - L'audio sera connecté
   - Vous pouvez parler!

3. **Arrêtez avec Ctrl+C**
   - Le nettoyage est automatique

## 🎬 Exemple complet

```bash
# 1. Installation
sudo apt-get install python3-pjsua2
./install_for_test.sh

# 2. Configuration
nano test_config.env
# (Remplir SIP_URI, SIP_USERNAME, SIP_PASSWORD)

# 3. Vérification
make -f Makefile.test check

# 4. Test!
./run_test.sh minimal

# 5. Appeler votre numéro SIP
# → L'appel sera accepté et vous pourrez parler
```

## 📚 Documentation

- **Ce fichier**: Démarrage rapide
- **README_TEST_APPELS.md**: Guide complet
- **TEST_APPELS_ENTRANTS.md**: Documentation détaillée
- **INSTALL_PJSUA2.md**: Installation avancée de PJSUA2

## 💡 Conseil Pro

Pour un premier test, utilisez le script minimal sans venv:

```bash
deactivate  # Sortir du venv si activé

python3 test_incoming_calls_minimal.py \
  sip:votre_numero@votre_provider.com \
  votre_numero \
  votre_mot_de_passe
```

C'est le moyen le plus rapide de vérifier que tout fonctionne! 🚀
