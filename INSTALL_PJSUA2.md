# Installation de PJSUA2

PJSUA2 peut être difficile à installer via pip. Voici plusieurs méthodes.

## ⚠️ Problème commun

L'installation via `pip install pjsua2` échoue souvent avec:
```
FileNotFoundError: [Errno 2] No such file or directory: '../../../../version.mak'
```

## 🔧 Solutions

### Option 1: Installation via le système (Recommandé)

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install python3-pjsua2
```

**Ensuite, pour utiliser avec votre venv:**
```bash
# Créer un lien symbolique vers le pjsua2 système
cd venv/lib/python3.*/site-packages/
ln -s /usr/lib/python3/dist-packages/pjsua2.so .
```

### Option 2: Installation depuis les sources

```bash
# Télécharger PJSIP
cd /tmp
wget https://github.com/pjsip/pjproject/archive/2.14.1.tar.gz
tar xzf 2.14.1.tar.gz
cd pjproject-2.14.1

# Compiler PJSIP
./configure --enable-shared
make dep
make

# Compiler les bindings Python
cd pjsip-apps/src/swig/python
make
python3 setup.py install

# Ou dans votre venv:
source ~/Documents/GitHub/test-chatkit/venv/bin/activate
python3 setup.py install
```

### Option 3: Utiliser le pjsua2 système sans venv

Si vous ne pouvez pas installer dans le venv, utilisez le Python système:

```bash
# Installer sur le système
sudo apt-get install python3-pjsua2

# Puis lancez les scripts avec python3 système
deactivate  # Sortir du venv
python3 test_incoming_calls_minimal.py sip:user@domain.com username password
```

### Option 4: Docker (pour isoler)

```bash
# Créer un Dockerfile
cat > Dockerfile.test <<EOF
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \\
    python3 \\
    python3-pip \\
    python3-pjsua2

WORKDIR /app
COPY test_incoming_calls*.py /app/
COPY run_test.sh /app/

CMD ["/bin/bash"]
EOF

# Builder et lancer
docker build -f Dockerfile.test -t test-incoming .
docker run -it --network host test-incoming

# Dans le container:
./test_incoming_calls_minimal.py sip:user@domain.com username password
```

## ✅ Vérification

Une fois installé, vérifiez:

```bash
python3 -c "import pjsua2; print('✅ PJSUA2 OK')"
```

## 🎯 Solution rapide pour tester maintenant

Si vous voulez juste tester rapidement:

```bash
# Sortir du venv
deactivate

# Installer pjsua2 sur le système
sudo apt-get install python3-pjsua2

# Vérifier
python3 -c "import pjsua2; print('✅ OK')"

# Tester
python3 test_incoming_calls_minimal.py sip:test@example.com test password
```

## 📚 Ressources

- Documentation PJSIP: https://www.pjsip.org/
- Bindings Python: https://www.pjsip.org/pjsua2.htm
- Problèmes connus: https://github.com/pjsip/pjproject/issues

## 💡 Alternative: Tester sans PJSUA2

Si vous voulez juste tester la logique sans PJSUA2, créez un mock:

```python
# mock_pjsua2.py
class Endpoint:
    pass

class Account:
    pass

class Call:
    pass
```

Mais pour de vrais tests d'appels SIP, PJSUA2 est nécessaire.
