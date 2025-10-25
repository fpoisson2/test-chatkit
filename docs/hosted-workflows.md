# Configurer un workflow hébergé ChatKit

Ce guide explique comment connecter une instance auto-hébergée de ChatKit à un workflow publié dans la console OpenAI. Il complète les traces visibles dans les logs du backend (`POST /api/chatkit`, requêtes sortantes vers `api.openai.com`) et décrit les réglages nécessaires pour obtenir un workflow hébergé opérationnel.

## 1. Pré-requis côté OpenAI

1. Publiez un workflow depuis la console ChatKit et notez son **identifiant** (champ `id`).
2. Créez une clé API disposant de l'accès ChatKit.
3. Facultatif : vérifiez l'environnement réseau. Depuis le serveur ChatKit auto-hébergé, un simple `curl https://api.openai.com/v1/models` doit retourner `200`.

## 2. Configurer l'accès API

Dans votre fichier `.env` (ou via `docker compose`), définissez les variables nécessaires pour appeler l'API OpenAI :

```bash
MODEL_PROVIDER=openai
MODEL_API_BASE=https://api.openai.com
OPENAI_API_KEY="sk-..."
```

Points d'attention :

- `MODEL_PROVIDER` et `MODEL_API_BASE` doivent correspondre au point d'accès OpenAI utilisé pour ChatKit.
- `OPENAI_API_KEY` (ou la variable définie par `MODEL_API_KEY_ENV`) doit porter les permissions ChatKit.
- Si vous passez par un proxy, ajustez `MODEL_API_BASE` en conséquence.
- Optionnel : `CHATKIT_WORKFLOW_ID` reste pris en charge pour les déploiements existants. Lorsqu'elle est définie, elle est simplement ajoutée à la liste des workflows disponibles mais n'est plus obligatoire.

Redémarrez ensuite le backend :

```bash
docker compose up -d backend
```

Sur un démarrage réussi, les logs doivent indiquer la création du serveur ChatKit puis les appels sortants vers `https://api.openai.com` lors des requêtes `/api/chatkit`.

## 3. Déclarer le workflow hébergé dans l'interface

Dans le Workflow Builder, ouvrez l'onglet **Workflows hébergés**, puis cliquez sur **Ajouter** :

1. Saisissez un **slug** (ex : `assistant-voix`).
2. Renseignez l'identifiant du workflow OpenAI (`wf_...`).
3. Optionnel : ajoutez un libellé et une description pour aider les agents à le reconnaître.

Une fois l'entrée enregistrée, elle apparaît dans la liste et le frontend peut l'utiliser. Vous pouvez également référencer ce slug dans l'étape **Start** du workflow pour un accès direct depuis l'UI.

Par défaut, le backend utilisera le premier workflow géré (ou celui déclaré dans l'étape **Start**) lorsque le frontend demande une session sans slug spécifique. Plus besoin de variable d'environnement : l'enregistrement dans l'interface suffit.

## 4. Forcer l'usage du workflow hébergé côté frontend

Le frontend peut se connecter automatiquement au workflow distant. Pour forcer ce mode (utile en développement sans workflow local) :

```bash
VITE_CHATKIT_FORCE_HOSTED=true npm run frontend:dev
```

Le widget sélectionnera alors automatiquement le premier workflow hébergé disponible (ou celui dont le slug est demandé via l'UI). En cas d'erreur (`hosted_workflow_not_configured` ou `hosted_workflow_not_found`), l'interface affichera le message correspondant et désactivera le mode hébergé.

## 5. Vérification des logs

Lorsqu'une session hébergée est ouverte, vous verrez des lignes similaires dans les logs du backend :

```
INFO  backend - "POST /api/chatkit" 200 OK
DEBUG httpcore.connection:connect_tcp.started host='api.openai.com'
```

Ces traces confirment que ChatKit relaie la requête vers l'API OpenAI. En cas d'échec, cherchez `ChatKit session creation failed` dans les logs : la réponse distante y est détaillée.

## 6. Aller plus loin

- Utilisez l'onglet **Workflows hébergés** du Workflow Builder pour exposer plusieurs workflows distants et permettre aux agents d'y accéder.
- Combinez les workflows hébergés avec la téléphonie (`TELEPHONY_DEFAULT_WORKFLOW_SLUG`) pour répondre aux appels entrants directement via la version publiée.

Avec cette configuration, votre instance ChatKit agit comme une passerelle sécurisée vers vos workflows hébergés OpenAI tout en conservant la supervision locale des utilisateurs et des journaux.
