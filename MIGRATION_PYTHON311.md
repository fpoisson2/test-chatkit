# 🔄 Migration vers Python 3.11

Guide pour migrer les tests d'appels entrants vers Python 3.11.

## 📊 État actuel

- **Python 3.10** : environnement `pjsip310` avec PJSUA2 ✅
- **Python 3.12** : système mais sans PJSUA2 ❌
- **Python 3.11** : **pas installé** ❌

## 🎯 Options

### Option 1: Créer pjsip311 avec pyenv (Recommandé)

**Avantages:**
- Environnement isolé
- Version Python spécifique (3.11)
- Contrôle total

**Installation:**

```bash
# 1. Installer Python 3.11 avec pyenv
~/.pyenv/bin/pyenv install 3.11.9

# 2. Créer un virtualenv pour PJSIP
~/.pyenv/bin/pyenv virtualenv 3.11.9 pjsip311

# 3. Activer l'environnement
~/.pyenv/bin/pyenv activate pjsip311

# 4. Compiler et installer PJSIP avec Python bindings
cd /tmp
wget https://github.com/pjsip/pjproject/archive/refs/tags/2.14.1.tar.gz
tar xzf 2.14.1.tar.gz
cd pjproject-2.14.1

# Configure
./configure --enable-shared --disable-video

# Build
make dep
make -j$(nproc)
sudo make install

# Build Python bindings
cd pjsip-apps/src/swig/python
make
~/.pyenv/versions/pjsip311/bin/python setup.py install

# Vérifier
~/.pyenv/versions/pjsip311/bin/python -c "import pjsua2; print('✅ OK')"

# 5. Installer les autres dépendances
~/.pyenv/versions/pjsip311/bin/pip install -r requirements_bridge.txt
```

### Option 2: Utiliser Docker (Le plus simple!)

**Avantages:**
- Déjà configuré avec Python 3.11 + PJSUA2
- Pas besoin de compiler
- Environnement identique à la production

**Utilisation:**

```bash
# 1. Build le container (si pas déjà fait)
docker-compose build backend

# 2. Lancer les tests dans le container
docker-compose run --rm backend python /app/test_incoming_calls_minimal.py \
  sip:102@192.168.1.155 102 password

# 3. Test avec bridge
docker-compose run --rm backend python /app/test_incoming_calls_with_bridge.py \
  --sip-uri sip:102@192.168.1.155 \
  --username 102 \
  --password password
```

### Option 3: Utiliser Python 3.12 système

**Avantages:**
- Déjà installé
- Plus récent que 3.11

**Installation PJSUA2:**

```bash
# Installer PJSUA2 pour Python 3.12
sudo apt-get install python3-pjsua2

# OU compiler depuis les sources
# (mêmes étapes que Option 1, mais avec /usr/bin/python3)
```

## 🚀 Mise à jour des scripts

Une fois Python 3.11 installé (avec l'une des options ci-dessus), mettez à jour:

### 1. Définir PJSIP_PY

**Option 1 (pyenv):**
```bash
export PJSIP_PY="/home/fpoisson/.pyenv/versions/pjsip311/bin/python"
```

**Option 2 (Docker):**
Pas besoin, utilisez directement Docker

**Option 3 (système):**
```bash
export PJSIP_PY="/usr/bin/python3"
```

### 2. Mettre à jour les fichiers

Les fichiers suivants contiennent `pjsip310` et doivent être mis à jour:

- `Makefile.test` (ligne 5)
- `run_test.sh` (ligne 7)
- `install_for_test.sh` (ligne 7)
- `test_example.sh` (ligne 5)
- `test_incoming_calls_minimal.py` (ligne 1 - shebang)
- `test_incoming_calls.py` (ligne 1 - shebang)
- `test_incoming_calls_with_bridge.py` (ligne 1 - shebang)

**Commande de remplacement automatique:**

```bash
# Pour pyenv (pjsip311)
find . -maxdepth 1 -type f \( -name "*.sh" -o -name "*.py" -o -name "Makefile.test" \) \
  -exec sed -i 's|pjsip310|pjsip311|g' {} \;

# Pour système (python3)
find . -maxdepth 1 -type f \( -name "*.sh" -o -name "*.py" -o -name "Makefile.test" \) \
  -exec sed -i 's|/home/fpoisson/.pyenv/versions/pjsip310/bin/python|/usr/bin/python3|g' {} \;
```

### 3. Simplifier test_incoming_calls_with_bridge.py

Avec Python 3.11, les patches ne sont plus nécessaires. Supprimer:

```python
# IMPORTANT: Patches pour Python 3.10 (fonctionnalités ajoutées en 3.11)
# ... (tout le bloc de patches)
```

## ✅ Vérification

Après la migration:

```bash
# Vérifier Python
"$PJSIP_PY" --version
# Devrait afficher: Python 3.11.x

# Vérifier PJSUA2
"$PJSIP_PY" -c "import pjsua2; print('✅ OK')"

# Vérifier la config
make -f Makefile.test check

# Tester
./test_incoming_calls_minimal.py sip:102@192.168.1.155 102 password
```

## 📝 Recommandation

**Pour développement local:** Utilisez **Option 2 (Docker)** - c'est le plus simple et rapide!

**Pour tests rapides:** Créez **Option 1 (pjsip311 avec pyenv)** - une seule fois

**Pour CI/CD:** Utilisez Docker

## 🐳 Exemple complet avec Docker

```bash
# 1. Copier les scripts de test dans le backend
cp test_incoming_calls*.py backend/

# 2. Lancer le test
docker-compose run --rm backend bash -c "
  export PJSIP_PY=python
  python test_incoming_calls_minimal.py sip:102@192.168.1.155 102 password
"

# 3. Test avec bridge
docker-compose run --rm -e OPENAI_API_KEY="\$OPENAI_API_KEY" backend \
  python test_incoming_calls_with_bridge.py \
  --sip-uri sip:102@192.168.1.155 \
  --username 102 \
  --password password
```

---

**Dernière mise à jour:** 2025-11-05
