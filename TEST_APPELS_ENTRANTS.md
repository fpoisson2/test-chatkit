# Test des Appels Entrants

Ce document explique comment tester les appels entrants SIP avec les scripts fournis.

## 📋 Prérequis

### Installation des dépendances

```bash
cd backend
pip install -r requirements.txt
```

Les dépendances principales sont :
- `pjsua2` : Stack SIP/RTP pour la téléphonie
- `openai` : Pour l'API Realtime (si utilisation du voice bridge)
- `asyncio` : Pour la gestion asynchrone

### Configuration

Pour le test avec voice bridge, vous devez configurer votre clé API OpenAI :

```bash
export OPENAI_API_KEY="votre-clé-api"
```

## 🧪 Scripts de Test

### 1. Test Simple (sans Voice Bridge)

Le script `test_incoming_calls.py` permet de tester les appels entrants de manière basique, sans connexion à l'API Realtime.

#### Utilisation

```bash
python test_incoming_calls.py \
  --sip-uri "sip:utilisateur@domaine.com" \
  --username "utilisateur" \
  --password "motdepasse"
```

#### Options disponibles

- `--sip-uri` : URI SIP de votre compte (requis)
- `--registrar-uri` : URI du registrar SIP (optionnel, extrait de sip-uri si non spécifié)
- `--username` : Nom d'utilisateur pour l'authentification (requis)
- `--password` : Mot de passe (requis)
- `--transport` : Type de transport (UDP ou TCP, défaut: UDP)
- `--port` : Port d'écoute SIP (défaut: 5060)
- `--duration` : Durée du test en secondes (0 = infini)
- `--verbose` : Active le mode verbeux

#### Exemples

**Test basique:**
```bash
python test_incoming_calls.py \
  --sip-uri "sip:test@sip.example.com" \
  --username "test" \
  --password "secret123"
```

**Test avec TCP sur port 5061:**
```bash
python test_incoming_calls.py \
  --sip-uri "sip:test@sip.example.com" \
  --username "test" \
  --password "secret123" \
  --transport TCP \
  --port 5061
```

**Test avec timeout de 60 secondes:**
```bash
python test_incoming_calls.py \
  --sip-uri "sip:test@sip.example.com" \
  --username "test" \
  --password "secret123" \
  --duration 60
```

#### Ce que fait le script

1. ✅ Initialise PJSUA avec votre configuration SIP
2. ✅ Enregistre votre compte auprès du serveur SIP
3. ✅ Attend les appels entrants
4. ✅ Accepte automatiquement tous les appels entrants
5. ✅ Connecte l'audio (microphone ↔ téléphone ↔ haut-parleur)
6. ✅ Affiche les informations sur l'appel dans les logs

### 2. Test avec Voice Bridge (avec API Realtime)

Le script `test_incoming_calls_with_bridge.py` utilise les librairies du projet pour tester les appels entrants avec connexion à l'API Realtime d'OpenAI.

#### Utilisation

```bash
python test_incoming_calls_with_bridge.py \
  --sip-uri "sip:utilisateur@domaine.com" \
  --username "utilisateur" \
  --password "motdepasse"
```

#### Options disponibles

Toutes les options du test simple, plus :

- `--model` : Modèle OpenAI à utiliser (défaut: gpt-4o-realtime-preview)
- `--voice` : Voix à utiliser (alloy, echo, shimmer, ash, ballad, coral, sage, verse)
- `--instructions` : Instructions pour l'assistant vocal
- `--api-key` : Clé API OpenAI (défaut: variable d'environnement OPENAI_API_KEY)

#### Exemples

**Test basique avec voice bridge:**
```bash
export OPENAI_API_KEY="sk-..."

python test_incoming_calls_with_bridge.py \
  --sip-uri "sip:test@sip.example.com" \
  --username "test" \
  --password "secret123"
```

**Test avec voix personnalisée:**
```bash
python test_incoming_calls_with_bridge.py \
  --sip-uri "sip:test@sip.example.com" \
  --username "test" \
  --password "secret123" \
  --voice shimmer
```

**Test avec instructions personnalisées:**
```bash
python test_incoming_calls_with_bridge.py \
  --sip-uri "sip:test@sip.example.com" \
  --username "test" \
  --password "secret123" \
  --instructions "Vous êtes un robot sympathique qui parle français. Soyez bref et clair."
```

#### Ce que fait le script

1. ✅ Initialise PJSUA avec votre configuration SIP
2. ✅ Enregistre votre compte auprès du serveur SIP
3. ✅ Attend les appels entrants
4. ✅ Accepte automatiquement tous les appels entrants
5. ✅ Crée un pont audio (PJSUAAudioBridge)
6. ✅ Démarre une session Realtime avec OpenAI
7. ✅ Traite l'audio bidirectionnel (utilisateur ↔ OpenAI)
8. ✅ Affiche les transcriptions et statistiques
9. ✅ Nettoie proprement les ressources

## 🔍 Logs et Débogage

Les scripts affichent des logs détaillés avec des emojis pour faciliter le suivi :

- 📞 : Événements d'appel
- 🎵 : Événements audio
- ✅ : Opérations réussies
- ❌ : Erreurs
- ⚠️ : Avertissements
- 🚀 : Initialisation
- 🧹 : Nettoyage
- 📊 : Statistiques

### Mode verbeux

Pour activer le mode verbeux et voir tous les détails :

```bash
python test_incoming_calls.py \
  --sip-uri "sip:test@sip.example.com" \
  --username "test" \
  --password "secret123" \
  --verbose
```

## 🐛 Dépannage

### Erreur "PJSUA2 n'est pas disponible"

```bash
pip install pjsua2
```

Si l'installation échoue, vérifiez que vous avez les dépendances système :

**Ubuntu/Debian:**
```bash
sudo apt-get install build-essential python3-dev
```

**macOS:**
```bash
brew install python
```

### Erreur "OPENAI_API_KEY doit être défini"

Définissez votre clé API OpenAI :

```bash
export OPENAI_API_KEY="sk-..."
```

Ou passez-la en paramètre :

```bash
python test_incoming_calls_with_bridge.py \
  --sip-uri "sip:test@sip.example.com" \
  --username "test" \
  --password "secret123" \
  --api-key "sk-..."
```

### Le script ne reçoit pas d'appels

1. Vérifiez que votre compte SIP est bien enregistré (cherchez "✅ Enregistrement SIP réussi" dans les logs)
2. Vérifiez que le port SIP (5060) n'est pas bloqué par un firewall
3. Vérifiez que votre configuration NAT est correcte si vous êtes derrière un routeur
4. Testez avec le mode verbeux pour voir plus de détails

### L'audio ne fonctionne pas

1. Vérifiez que les ports RTP (10000-20000) ne sont pas bloqués
2. Vérifiez la configuration audio de votre système
3. Pour le test simple : vérifiez que votre microphone et haut-parleur fonctionnent
4. Pour le test avec bridge : vérifiez les logs du voice bridge

## 📝 Notes

### Test simple vs Test avec bridge

- **Test simple** : Idéal pour vérifier que la configuration SIP fonctionne et que vous pouvez recevoir des appels
- **Test avec bridge** : Permet de tester l'intégration complète avec l'API Realtime et le système de pont audio

### Arrêt du script

Appuyez sur `Ctrl+C` pour arrêter proprement le script. Les ressources seront automatiquement nettoyées.

### Durée du test

Par défaut, les scripts tournent indéfiniment. Utilisez `--duration` pour limiter la durée :

```bash
# Tester pendant 5 minutes (300 secondes)
python test_incoming_calls.py \
  --sip-uri "sip:test@sip.example.com" \
  --username "test" \
  --password "secret123" \
  --duration 300
```

## 🎯 Cas d'usage

### Tester une nouvelle configuration SIP

Utilisez le test simple pour vérifier rapidement que votre compte SIP fonctionne :

```bash
python test_incoming_calls.py \
  --sip-uri "sip:nouveau@provider.com" \
  --username "nouveau" \
  --password "pass123"
```

### Valider l'intégration avec l'API Realtime

Utilisez le test avec bridge pour valider que tout fonctionne correctement :

```bash
python test_incoming_calls_with_bridge.py \
  --sip-uri "sip:test@provider.com" \
  --username "test" \
  --password "pass123" \
  --voice alloy \
  --instructions "Parlez français et soyez bref"
```

### Test automatisé

Pour des tests automatisés avec timeout :

```bash
#!/bin/bash

# Test de 5 minutes
timeout 300 python test_incoming_calls.py \
  --sip-uri "sip:test@provider.com" \
  --username "test" \
  --password "pass123" \
  --duration 300

echo "Test terminé"
```

## 📚 Architecture

Les scripts utilisent :

- **PJSUA2** : Stack complète SIP/RTP/RTCP
- **pjsua_adapter.py** : Adaptateur Python pour PJSUA
- **voice_bridge.py** : Pont entre SIP et API Realtime
- **pjsua_audio_bridge.py** : Pont audio pour la conversion et le streaming

## 🤝 Contribution

Pour améliorer ces scripts :

1. Créez une branche pour vos modifications
2. Testez vos changements avec différentes configurations SIP
3. Mettez à jour ce README si nécessaire
4. Créez une pull request

## 📞 Support

En cas de problème :

1. Vérifiez les logs avec `--verbose`
2. Consultez la documentation PJSUA : https://www.pjsip.org/
3. Vérifiez les exemples dans `backend/app/tests/`
