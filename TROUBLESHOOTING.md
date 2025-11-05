# 🔧 Dépannage - Tests des Appels Entrants

Guide pour résoudre les problèmes courants lors des tests d'appels entrants.

## 🎯 Problèmes courants

### 1. L'appel se déconnecte immédiatement (0s)

**Symptôme:**
```
Call time: 00h:00m:00s, conn in 0ms
[DISCONNECTED]
```

**Causes possibles:**

#### A. Erreurs Jack Audio
```
Cannot connect to server socket err = No such file or directory
jack server is not running or cannot be started
```

**Solution:** C'est **normal**! PJSUA essaie d'abord Jack, puis utilise ALSA en fallback.

Le script a été mis à jour pour désactiver VAD et mieux gérer l'audio:
```python
ep_cfg.medConfig.noVad = True
```

#### B. L'appelant raccroche immédiatement

Si la personne qui appelle raccroche tout de suite, l'appel sera très court.

**Test:** Attendez quelques secondes avant de raccrocher lors de l'appel.

#### C. Problème de codec audio

Les téléphones peuvent ne pas avoir de codec commun.

**Solution:** Vérifiez les codecs supportés des deux côtés (PCMU/PCMA/G729).

#### D. Problème de firewall/NAT

Les paquets RTP (audio) peuvent être bloqués.

**Vérification:**
```bash
# Vérifier que les ports RTP ne sont pas bloqués
sudo netstat -tulpn | grep pjsua
```

**Solution:** Ouvrir les ports RTP (généralement 10000-20000).

---

### 2. Erreur "PJSUA2 non installé"

**Symptôme:**
```
❌ PJSUA2 n'est pas disponible
```

**Solution:**
```bash
# Vérifier le chemin Python
echo $PJSIP_PY

# Vérifier que PJSUA2 est installé
"$PJSIP_PY" -c "import pjsua2; print('OK')"

# Si ça échoue, vérifier le Python par défaut
/home/fpoisson/.pyenv/versions/pjsip310/bin/python -c "import pjsua2"
```

---

### 3. Erreur de parsing dans test_config.env

**Symptôme:**
```
test_config.env: ligne 26: OPENAI_INSTRUCTIONS : commande introuvable
```

**Cause:** Espace avant le signe `=`

**Mauvais:**
```bash
OPENAI_INSTRUCTIONS = "texte"
```

**Correct:**
```bash
OPENAI_INSTRUCTIONS="texte"
```

**Solution:**
```bash
# Éditer le fichier
nano test_config.env

# Enlever tous les espaces autour des =
# Remplacer: VARIABLE = "valeur"
# Par:       VARIABLE="valeur"
```

---

### 4. Pas d'enregistrement SIP

**Symptôme:**
```
❌ ÉCHEC (Forbidden)
```

**Causes:**
- Mauvais username/password
- Mauvais serveur SIP
- Firewall bloque le port 5060

**Solution:**
```bash
# Vérifier la configuration
cat test_config.env

# Tester la connectivité
ping 192.168.1.155  # Votre serveur SIP

# Vérifier le port SIP
nc -zv 192.168.1.155 5060
```

---

### 5. Pas d'audio bidirectionnel

**Symptôme:** L'appel reste connecté mais pas d'audio.

**Solution A: Vérifier les devices audio**
```bash
# Lister les devices audio disponibles
aplay -l    # Lecture
arecord -l  # Capture

# Tester l'audio
speaker-test -t sine -f 440 -c 2
arecord -d 5 test.wav && aplay test.wav
```

**Solution B: Vérifier ALSA**
```bash
# Installer ALSA si nécessaire
sudo apt-get install alsa-utils

# Régler le volume
alsamixer
```

**Solution C: Désactiver Jack complètement**

Ajoutez au script Python (dans main()):
```python
# Avant ep.libStart()
import os
os.environ['AUDIODEV'] = 'default'  # Forcer ALSA
```

---

### 6. Le script crash au démarrage

**Symptôme:**
```
Segmentation fault
```

**Causes:** Problème avec PJSUA2 ou la bibliothèque.

**Solution:**
```bash
# Vérifier la version PJSUA
"$PJSIP_PY" -c "import pjsua2; print(pjsua2.version())"

# Réinstaller si nécessaire
cd /tmp
# ... suivre INSTALL_PJSUA2.md
```

---

### 7. Timeout lors de l'enregistrement

**Symptôme:** Le script reste bloqué sur "⏳ Attente de l'enregistrement..."

**Solution:**
```bash
# Augmenter le niveau de log pour voir ce qui se passe
# Dans le script, changer:
ep_cfg.logConfig.level = 5  # Plus verbeux

# Vérifier la connectivité réseau
ping <IP_DU_SERVEUR>
traceroute <IP_DU_SERVEUR>
```

---

## 🔍 Diagnostics

### Activer les logs détaillés

**Script minimal:**
```python
# Ligne 118 (environ)
ep_cfg.logConfig.level = 5  # Au lieu de 3
```

**Script complet:**
```bash
./run_test.sh -v simple  # Mode verbeux
```

### Vérifier l'état réseau

```bash
# Ports ouverts
sudo netstat -tulpn | grep -E '5060|pjsua'

# Connexions actives
sudo ss -tunap | grep pjsua

# Traffic SIP
sudo tcpdump -i any port 5060 -v
```

### Capturer le trafic SIP

```bash
# Installer tcpdump si nécessaire
sudo apt-get install tcpdump

# Capturer le traffic SIP
sudo tcpdump -i any -s 0 -w /tmp/sip.pcap port 5060

# Analyser avec Wireshark
wireshark /tmp/sip.pcap
```

---

## ✅ Checklist de dépannage

Avant de signaler un bug, vérifiez:

- [ ] PJSUA2 est bien installé (`"$PJSIP_PY" -c "import pjsua2"`)
- [ ] `test_config.env` est correct (pas d'espaces autour des `=`)
- [ ] Le serveur SIP est accessible (`ping` + `nc -zv`)
- [ ] Les ports ne sont pas bloqués (5060 SIP, 10000-20000 RTP)
- [ ] Les devices audio fonctionnent (`speaker-test`, `arecord`)
- [ ] Les logs détaillés sont activés (level 5)
- [ ] La configuration réseau est correcte (pas de NAT problématique)

---

## 📊 Tests de validation

### Test 1: Vérification PJSUA2
```bash
"$PJSIP_PY" -c "import pjsua2; print('Version:', pjsua2.version())"
```

### Test 2: Vérification SIP
```bash
# Avec sipsak (installer si nécessaire: sudo apt-get install sipsak)
sipsak -s sip:102@192.168.1.155
```

### Test 3: Vérification audio
```bash
# Test rapide du micro
arecord -d 3 -f cd test.wav && aplay test.wav
```

### Test 4: Test complet
```bash
# Avec durée limitée
timeout 60 ./test_incoming_calls_minimal.py \
  sip:102@192.168.1.155 102 password
```

---

## 🆘 Obtenir de l'aide

Si le problème persiste:

1. **Activer les logs détaillés** (level 5)
2. **Capturer les informations:**
   ```bash
   # Version système
   uname -a

   # Version Python
   "$PJSIP_PY" --version

   # Version PJSUA2
   "$PJSIP_PY" -c "import pjsua2; print(pjsua2.version())"

   # Configuration audio
   aplay -l && arecord -l
   ```

3. **Copier les logs complets** du test

4. **Ouvrir une issue** avec toutes ces informations

---

## 💡 Astuces

### Test sans audio

Pour tester juste la signalisation SIP sans audio:

```python
# Dans le script, après ep.libStart():
audDevManager = ep.audDevManager()
audDevManager.setNullDev()
print("🔇 Mode sans audio (signalisation uniquement)")
```

### Test avec durée limitée

```bash
# Arrêt automatique après 60 secondes
timeout 60 ./test_incoming_calls_minimal.py sip:user@domain.com user pass
```

### Forcer ALSA

```bash
# Avant de lancer le script
export AUDIODEV=default
export AUDIODRIVER=alsa
./test_incoming_calls_minimal.py ...
```

---

**Dernière mise à jour:** 2025-11-05
