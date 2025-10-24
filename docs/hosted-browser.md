# Utiliser le navigateur hébergé Playwright

Le mode *computer-use* peut lancer un navigateur Chromium piloté par Playwright. Par défaut il tourne en mode **headless** (aucune fenêtre visible) et sans port de débogage ouvert. Les variables d'environnement ci-dessous permettent d'afficher la fenêtre ou d'activer DevTools.

## Variables d'environnement

| Variable | Effet | Valeurs utiles |
| --- | --- | --- |
| `CHATKIT_HOSTED_BROWSER_HEADLESS` | Force Playwright à tourner en mode headless (`true`) ou visible (`false`). | `0`, `false`, `no` ou `off` rendent la fenêtre visible. Toute autre valeur (ou variable absente) garde le mode headless. |
| `CHATKIT_HOSTED_BROWSER_DEBUG_HOST` | Adresse d'écoute pour le serveur de débogage Chromium. | Utilise `0.0.0.0` pour exposer DevTools à l'extérieur d'un conteneur Docker. Valeur par défaut : `127.0.0.1`. |
| `CHATKIT_HOSTED_BROWSER_DEBUG_PORT` | Ouvre un serveur DevTools sur le port indiqué et consigne l'URL dans les logs. | Exemple : `9333`. Laisser vide désactive DevTools. |

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

`docker-compose.yml` expose désormais le port `9333` du backend par défaut, ce qui suffit pour accéder à DevTools dans la plupart des configurations Docker.

Puis démarrez uniquement le service backend pour éviter de redémarrer les autres services :

```bash
docker compose up backend
```

Lorsque la fenêtre est visible, vous pouvez la contrôler via un serveur X11/Wayland local ou via votre environnement Docker s'il supporte l'affichage (ex. VS Code Dev Containers avec forwarding GUI). Sinon, utilisez simplement DevTools pour voir l'écran et le DOM.

## Dépannage

* Aucun flux vidéo ? Avec l'image Docker fournie, Playwright et Chromium sont installés automatiquement au démarrage. En exécution locale, installez-les manuellement (`pip install playwright` puis `playwright install chromium`).
* L'URL DevTools n'apparaît pas dans les logs ? Assurez-vous que `CHATKIT_HOSTED_BROWSER_DEBUG_PORT` est défini sur un port valide (1-65535) et exposé si vous êtes dans un conteneur.
* Les actions semblent figées ? Le navigateur retombe automatiquement sur un simulateur PNG si Playwright ne démarre pas. Consultez les logs `chatkit.computer.hosted_browser` pour confirmer et ajuster votre configuration.
