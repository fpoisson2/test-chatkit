# 📑 Index - Tests des Appels Entrants

Tous les fichiers créés pour tester les appels entrants SIP.

## 🚀 Démarrage Rapide

**Pour commencer immédiatement:** Lisez [QUICKSTART.md](QUICKSTART.md)

## 📁 Fichiers créés

### 🐍 Scripts Python (exécutables)

| Fichier | Taille | Description |
|---------|--------|-------------|
| `test_incoming_calls_minimal.py` | 4.7K | **Script minimal** - Le plus simple (3 arguments) |
| `test_incoming_calls.py` | 13K | **Script complet** - Options avancées, logs détaillés |
| `test_incoming_calls_with_bridge.py` | 13K | **Avec OpenAI** - Intégration Voice Bridge + API Realtime |

**Usage:**
```bash
# Minimal
./test_incoming_calls_minimal.py sip:user@domain.com username password

# Complet
./test_incoming_calls.py --sip-uri sip:user@domain.com --username user --password pass

# Avec bridge
./test_incoming_calls_with_bridge.py --sip-uri sip:user@domain.com --username user --password pass
```

### 🔧 Scripts d'aide (exécutables)

| Fichier | Taille | Description |
|---------|--------|-------------|
| `run_test.sh` | 4.9K | **Lanceur principal** - Lance les tests facilement |
| `install_for_test.sh` | 3.8K | **Installation auto** - Configure tout automatiquement |
| `test_example.sh` | 2.6K | **Menu interactif** - Test avec menu de choix |

**Usage:**
```bash
# Lancer un test
./run_test.sh minimal
./run_test.sh simple
./run_test.sh bridge

# Installation automatique
./install_for_test.sh

# Menu interactif
./test_example.sh
```

### 📖 Documentation

| Fichier | Taille | Contenu |
|---------|--------|---------|
| **QUICKSTART.md** | 4.1K | ⭐ **Commencez ici!** Guide de démarrage rapide en 5 étapes |
| **README_TEST_APPELS.md** | 4.6K | Guide complet avec exemples et cas d'usage |
| **TEST_APPELS_ENTRANTS.md** | 8.3K | Documentation détaillée (architecture, dépannage) |
| **INSTALL_PJSUA2.md** | 2.9K | Guide d'installation de PJSUA2 (4 méthodes) |
| **INDEX_TESTS.md** | - | Ce fichier - Index de tous les fichiers |

### ⚙️ Configuration et outils

| Fichier | Taille | Description |
|---------|--------|-------------|
| `Makefile.test` | 3.6K | Makefile avec commandes simplifiées |
| `test_config.example.env` | 726 | Exemple de configuration SIP |
| `test_config.env` | 726 | Configuration SIP (à éditer) |
| `requirements_test.txt` | 255 | Dépendances Python minimales |

**Usage:**
```bash
# Makefile
make -f Makefile.test help
make -f Makefile.test check
make -f Makefile.test test-minimal

# Configuration
cp test_config.example.env test_config.env
nano test_config.env
```

## 🎯 Quel fichier lire?

### Je débute → [QUICKSTART.md](QUICKSTART.md)
Installation et premier test en 5 minutes.

### Je veux des exemples → [README_TEST_APPELS.md](README_TEST_APPELS.md)
Cas d'usage pratiques et exemples concrets.

### Je veux tout comprendre → [TEST_APPELS_ENTRANTS.md](TEST_APPELS_ENTRANTS.md)
Documentation complète avec architecture et dépannage.

### Problème avec PJSUA2 → [INSTALL_PJSUA2.md](INSTALL_PJSUA2.md)
4 méthodes d'installation alternatives.

## 🔄 Workflow typique

```bash
# 1. Installation (une seule fois)
./install_for_test.sh

# 2. Configuration (une seule fois)
nano test_config.env

# 3. Vérification
make -f Makefile.test check

# 4. Test
./run_test.sh minimal

# 5. Appeler votre numéro SIP
# → L'appel sera accepté automatiquement
```

## 📊 Comparaison des scripts

| Caractéristique | Minimal | Simple | Bridge |
|----------------|---------|--------|--------|
| Arguments | 3 | ~10 | ~15 |
| Dépendances | PJSUA2 | PJSUA2 | PJSUA2 + OpenAI |
| Configuration | CLI | CLI + fichier | CLI + fichier + API Key |
| Logs | Basiques | Détaillés | Très détaillés |
| Transcription | ❌ | ❌ | ✅ |
| OpenAI | ❌ | ❌ | ✅ |
| **Idéal pour** | Débuter | Tester config | Production |

## 🛠️ Commandes utiles

### Makefile (recommandé)
```bash
make -f Makefile.test help      # Aide
make -f Makefile.test check     # Vérifier config
make -f Makefile.test m         # Test minimal
make -f Makefile.test s         # Test simple
make -f Makefile.test b         # Test bridge
```

### Scripts bash
```bash
./run_test.sh minimal           # Test minimal
./run_test.sh -d 300 simple     # Test 5 minutes
./run_test.sh -v bridge         # Mode verbeux
./run_test.sh -c custom.env bridge  # Config personnalisée
```

### Python direct
```bash
# Minimal (le plus rapide)
python3 test_incoming_calls_minimal.py sip:user@domain.com user pass

# Simple (avec options)
python3 test_incoming_calls.py --sip-uri sip:user@domain.com --username user --password pass

# Bridge (avec OpenAI)
export OPENAI_API_KEY="sk-..."
python3 test_incoming_calls_with_bridge.py --sip-uri sip:user@domain.com --username user --password pass --voice shimmer
```

## 🆘 Aide rapide

### Problème | Solution
```bash
# PJSUA2 non installé
sudo apt-get install python3-pjsua2

# Config manquante
make -f Makefile.test config

# Vérifier tout
make -f Makefile.test check

# Voir les options
./run_test.sh --help

# Mode debug
./run_test.sh -v simple
```

## 📚 Ressources externes

- PJSIP Documentation: https://www.pjsip.org/
- OpenAI Realtime API: https://platform.openai.com/docs/guides/realtime
- PJSUA2 Python: https://www.pjsip.org/pjsua2.htm

## 🎓 Pour aller plus loin

Après avoir testé les appels entrants:

1. **Personnaliser les instructions** (bridge)
   ```bash
   ./test_incoming_calls_with_bridge.py \
     --instructions "Tu es un robot qui parle comme un pirate"
   ```

2. **Tester différentes voix** (bridge)
   ```bash
   for voice in alloy echo shimmer ash ballad coral sage verse; do
     echo "Test avec $voice"
     ./run_test.sh -d 60 bridge --voice $voice
   done
   ```

3. **Intégrer dans votre projet**
   - Utilisez les classes du projet: `PJSUAAdapter`, `TelephonyVoiceBridge`
   - Voir `backend/app/telephony/` pour le code source
   - Exemple: `test_incoming_calls_with_bridge.py`

## 📝 Notes

- Les scripts acceptent **automatiquement** tous les appels entrants
- L'audio est connecté **bidirectionnellement** (micro ↔ téléphone)
- Arrêt propre avec **Ctrl+C**
- Les statistiques sont affichées à la fin
- Tous les scripts ont des **logs avec emojis** 📞🎵✅

---

**Bon test! 🚀**

*Créé le: 2025-11-05*
*Dernière mise à jour: 2025-11-05*
