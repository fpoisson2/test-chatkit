# Configuration Python PJSIP

## 📍 Python spécifique pour PJSUA2

Tous les scripts utilisent maintenant un Python spécifique avec PJSUA2 installé:

```bash
PJSIP_PY="/home/fpoisson/.pyenv/versions/pjsip310/bin/python"
```

## 🔧 Configuration

### Variable d'environnement

Vous pouvez surcharger le chemin Python en définissant `PJSIP_PY`:

```bash
export PJSIP_PY="/chemin/vers/votre/python"
```

### Scripts modifiés

Tous les scripts bash utilisent maintenant `$PJSIP_PY`:
- ✅ `run_test.sh`
- ✅ `install_for_test.sh`
- ✅ `test_example.sh`
- ✅ `Makefile.test`

### Scripts Python modifiés

Les shebangs des scripts Python pointent vers le bon Python:
- ✅ `test_incoming_calls_minimal.py`
- ✅ `test_incoming_calls.py`
- ✅ `test_incoming_calls_with_bridge.py`

## 🚀 Utilisation

### Directement

Les scripts Python peuvent être exécutés directement:

```bash
./test_incoming_calls_minimal.py sip:user@domain.com username password
```

Le shebang utilise automatiquement le bon Python.

### Via les scripts bash

Les scripts bash utilisent `$PJSIP_PY`:

```bash
./run_test.sh minimal
```

### Via le Makefile

Le Makefile utilise également `$PJSIP_PY`:

```bash
make -f Makefile.test check
make -f Makefile.test test-minimal
```

## ✅ Vérification

Pour vérifier que PJSUA2 fonctionne:

```bash
"$PJSIP_PY" -c "import pjsua2; print('✅ OK')"
```

Ou avec le Makefile:

```bash
make -f Makefile.test check
```

## 🔄 Changement de Python

Si vous voulez utiliser un autre Python:

**Option 1: Variable d'environnement (temporaire)**
```bash
export PJSIP_PY="/usr/bin/python3"
./run_test.sh minimal
```

**Option 2: Modifier les fichiers (permanent)**

1. **Makefile.test** - Ligne 5:
```makefile
PJSIP_PY := /nouveau/chemin/python
```

2. **Scripts bash** - En haut de chaque fichier:
```bash
PJSIP_PY="${PJSIP_PY:-/nouveau/chemin/python}"
```

3. **Scripts Python** - Première ligne:
```python
#!/nouveau/chemin/python
```

## 📝 Notes

- Par défaut, tous les scripts utilisent `/home/fpoisson/.pyenv/versions/pjsip310/bin/python`
- Ce Python a PJSUA2 pré-installé via pyenv
- La variable `PJSIP_PY` permet de surcharger ce comportement
- Les scripts fonctionnent avec n'importe quel Python ayant PJSUA2

## 🐛 Dépannage

### "PJSUA2 non installé"

Vérifiez que votre Python a bien PJSUA2:

```bash
"$PJSIP_PY" -c "import pjsua2; print('OK')"
```

### "Command not found"

Le chemin Python est peut-être incorrect. Vérifiez:

```bash
ls -la "$PJSIP_PY"
```

Si le fichier n'existe pas, modifiez `PJSIP_PY` dans les scripts.

### Utiliser le Python système

Si vous préférez utiliser le Python système:

```bash
export PJSIP_PY="python3"
sudo apt-get install python3-pjsua2
./run_test.sh minimal
```

## 🎓 Comprendre pyenv

Le Python utilisé (`pjsip310`) a été créé avec pyenv spécifiquement pour PJSUA2.

Pour créer un environnement similaire:

```bash
# Installer pyenv
curl https://pyenv.run | bash

# Installer Python 3.10
pyenv install 3.10.13

# Créer un virtualenv
pyenv virtualenv 3.10.13 pjsip310

# Activer
pyenv activate pjsip310

# Installer PJSUA2
pip install pjsua2  # ou compiler depuis les sources
```

## 📚 Ressources

- Documentation pyenv: https://github.com/pyenv/pyenv
- Installation PJSUA2: Voir [INSTALL_PJSUA2.md](INSTALL_PJSUA2.md)
