# 🎯 COMMENCEZ ICI!

## ✅ Ce qui a été créé

```
📂 test-chatkit/
├── 🚀 QUICKSTART.md              ← Lisez ceci en premier!
├── 📖 INDEX_TESTS.md             ← Index complet de tous les fichiers
│
├── 🐍 Scripts Python:
│   ├── test_incoming_calls_minimal.py        (le plus simple)
│   ├── test_incoming_calls.py                (complet)
│   └── test_incoming_calls_with_bridge.py    (avec OpenAI)
│
├── 🔧 Scripts d'aide:
│   ├── run_test.sh               (lanceur principal)
│   ├── install_for_test.sh       (installation auto)
│   └── Makefile.test             (commandes make)
│
├── 📚 Documentation:
│   ├── QUICKSTART.md             (démarrage rapide)
│   ├── README_TEST_APPELS.md     (guide complet)
│   ├── TEST_APPELS_ENTRANTS.md   (doc détaillée)
│   └── INSTALL_PJSUA2.md         (installation PJSUA2)
│
└── ⚙️ Configuration:
    ├── test_config.example.env   (exemple)
    └── test_config.env           (à éditer)
```

## 🚀 Installation en 3 étapes

### 1️⃣ Installer PJSUA2
```bash
sudo apt-get install python3-pjsua2
```

### 2️⃣ Configurer
```bash
nano test_config.env
# Remplir: SIP_URI, SIP_USERNAME, SIP_PASSWORD
```

### 3️⃣ Tester!
```bash
./run_test.sh minimal
# Puis appeler votre numéro SIP
```

## 💡 Exemples rapides

**Test le plus simple (30 secondes):**
```bash
python3 test_incoming_calls_minimal.py \
  sip:1234@voip.example.com \
  1234 \
  motdepasse
```

**Test avec menu:**
```bash
./test_example.sh
```

**Test avec OpenAI:**
```bash
export OPENAI_API_KEY="sk-..."
./run_test.sh bridge
```

## 📖 Documentation

| Je veux... | Lire... |
|-----------|---------|
| **Démarrer rapidement** | [QUICKSTART.md](QUICKSTART.md) |
| **Voir tous les fichiers** | [INDEX_TESTS.md](INDEX_TESTS.md) |
| **Des exemples** | [README_TEST_APPELS.md](README_TEST_APPELS.md) |
| **Tout comprendre** | [TEST_APPELS_ENTRANTS.md](TEST_APPELS_ENTRANTS.md) |

## 🆘 Aide

```bash
make -f Makefile.test help    # Liste des commandes
make -f Makefile.test check   # Vérifier la config
./run_test.sh --help          # Options du script
```

## ✨ C'est tout!

**Prochaine étape:** Ouvrez [QUICKSTART.md](QUICKSTART.md)

---

*Scripts créés pour tester les appels entrants SIP avec PJSUA*
