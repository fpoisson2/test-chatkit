# Utiliser le navigateur hébergé Playwright

Le mode *computer-use* peut lancer un navigateur Chromium piloté par Playwright. Par défaut il tourne en mode **headless** (aucune fenêtre visible) et sans port de débogage ouvert. Les variables d'environnement ci-dessous permettent d'afficher la fenêtre ou d'activer DevTools.

## Variables d'environnement

| Variable | Effet | Valeurs utiles |
| --- | --- | --- |
| `CHATKIT_HOSTED_BROWSER_HEADLESS` | Force Playwright à tourner en mode headless (`true`) ou visible (`false`). | `0`, `false`, `no` ou `off` rendent la fenêtre visible. Toute autre valeur (ou variable absente) garde le mode headless. |
| `CHATKIT_HOSTED_BROWSER_DEBUG_HOST` | Adresse d'écoute pour le serveur de débogage Chromium. | Utilise `0.0.0.0` pour exposer DevTools à l'extérieur d'un conteneur Docker. Valeur par défaut : `127.0.0.1`. |
| `CHATKIT_HOSTED_BROWSER_DEBUG_PORT` | Ouvre un serveur DevTools sur le port indiqué et consigne l'URL dans les logs. | Exemple : `9333`. Laisser vide désactive DevTools. |
| `CHATKIT_HOSTED_BROWSER_INSTALL_WITH_DEPS` | Contrôle l'installation automatique de Chromium si Playwright détecte qu'il manque des binaires. | Valeur absente (par défaut) : installe Chromium avec `--with-deps`. `0`, `false`, `no` ou `off` : n'installe que le binaire sans dépendances système. |
| `CHATKIT_HOSTED_BROWSER_XVFB_DISPLAY` | Identifiant du serveur d'affichage virtuel lancé lorsque le mode visible est demandé sans `$DISPLAY` existant. | Valeur par défaut : `:99`. |
| `CHATKIT_HOSTED_BROWSER_XVFB_SCREEN` | Numéro d'écran fourni à Xvfb. | Valeur par défaut : `0`. |
| `CHATKIT_HOSTED_BROWSER_XVFB_RESOLUTION` | Résolution (avec profondeur) utilisée pour Xvfb. | Valeur par défaut : `WIDTHxHEIGHTx24` selon la configuration de l'agent. |

Lorsque le navigateur se lance, les logs backend indiquent si la fenêtre est visible et, le cas échéant, l'URL DevTools (par exemple `http://0.0.0.0:9333`).

## Exemples

### Exécution locale (sans Docker)

```bash
export CHATKIT_HOSTED_BROWSER_HEADLESS=0
export CHATKIT_HOSTED_BROWSER_DEBUG_HOST=0.0.0.0
export CHATKIT_HOSTED_BROWSER_DEBUG_PORT=9333
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

Ensuite ouvrez `http://localhost:9333` dans Chrome ou Edge pour inspecter la session Playwright.

### Avec `docker compose`

Ajoutez les variables dans votre shell (ou un fichier `.env`) :

```bash
export CHATKIT_HOSTED_BROWSER_HEADLESS=0
export CHATKIT_HOSTED_BROWSER_DEBUG_HOST=0.0.0.0
export CHATKIT_HOSTED_BROWSER_DEBUG_PORT=9333
```

`docker-compose.yml` expose désormais le port `9333` du backend par défaut, ce qui suffit pour accéder à DevTools dans la plupart des configurations Docker. Si aucun serveur X n'est disponible, le backend démarre automatiquement **Xvfb** avec les paramètres ci-dessus afin que Chromium puisse s'exécuter en mode visible.

Puis démarrez uniquement le service backend pour éviter de redémarrer les autres services :

```bash
docker compose up backend
```

Lorsque la fenêtre est visible, vous pouvez la contrôler via un serveur X11/Wayland local ou via votre environnement Docker s'il supporte l'affichage (ex. VS Code Dev Containers avec forwarding GUI). Sinon, utilisez simplement DevTools pour voir l'écran et le DOM.

## Dépannage

* Aucun flux vidéo ? Avec l'image Docker fournie, Playwright et Chromium sont installés automatiquement au démarrage. Si un agent déclenche le navigateur et que Chromium manque malgré tout, le backend relance automatiquement Playwright après avoir exécuté `python -m playwright install [--with-deps] chromium`. En exécution locale, installez-les manuellement (`pip install playwright` puis `playwright install chromium`).
* Message "Missing X server" ? Le backend essaie maintenant de lancer Xvfb automatiquement lorsque `CHATKIT_HOSTED_BROWSER_HEADLESS=0` et qu'aucun `$DISPLAY` n'est défini. Vérifiez les logs pour confirmer le démarrage de Xvfb ou ajustez les variables `CHATKIT_HOSTED_BROWSER_XVFB_*` pour pointer vers un serveur existant.
* L'URL DevTools n'apparaît pas dans les logs ? Assurez-vous que `CHATKIT_HOSTED_BROWSER_DEBUG_PORT` est défini sur un port valide (1-65535) et exposé si vous êtes dans un conteneur.
* Les actions semblent figées ? Le navigateur retombe automatiquement sur un simulateur PNG si Playwright ne démarre pas. Consultez les logs `chatkit.computer.hosted_browser` pour confirmer et ajuster votre configuration.
