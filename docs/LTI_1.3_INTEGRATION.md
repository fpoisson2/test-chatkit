# LTI 1.3 Integration Guide

Ce guide explique comment configurer et utiliser l'intégration LTI 1.3 (Learning Tools Interoperability) avec ChatKit.

## Vue d'ensemble

L'intégration LTI 1.3 permet à ChatKit de :
- **S'intégrer avec les plateformes LMS** (Moodle, Canvas, Blackboard, etc.)
- **Authentification automatique** via le JWT LTI (pas besoin de compte séparé)
- **Deep Linking** : Sélection de workflows depuis le LMS
- **Assignment and Grade Services (AGS)** : Envoi automatique de notes au LMS

## Architecture

### Modèles de données

- **LTIPlatform** : Configuration des plateformes LMS (Moodle, Canvas, etc.)
- **LTIDeployment** : Déploiements LTI par plateforme
- **LTISession** : Sessions LTI actives
- **LTINonce** : Validation de nonce pour la sécurité
- **User** : Modifié pour supporter les utilisateurs LTI
- **Workflow** : Modifié avec champs `lti_enabled`, `lti_title`, `lti_description`

### Flux d'authentification LTI 1.3

```
1. LMS → POST /api/lti/login (OIDC Login Initiation)
2. ChatKit → Redirect vers LMS auth endpoint
3. LMS → POST /api/lti/launch (avec JWT)
4. ChatKit → Validation JWT, création/récupération utilisateur
5. ChatKit → Redirect vers workflow ou deep link
```

## Installation

### 1. Installer les dépendances

La bibliothèque `pylti1p3` a déjà été ajoutée à `requirements.txt`.

```bash
cd backend
pip install -r requirements.txt
```

### 2. Créer les tables de base de données

Les nouveaux modèles LTI seront créés automatiquement au démarrage de l'application.

```bash
# Démarrer le serveur backend
python server.py
```

Les tables suivantes seront créées :
- `lti_platforms`
- `lti_deployments`
- `lti_sessions`
- `lti_nonces`

Les colonnes suivantes seront ajoutées aux tables existantes :
- **users** : `is_lti_user`, `lti_user_id`, `lti_platform_id`, `lti_given_name`, `lti_family_name`, `lti_roles`
- **workflows** : `lti_enabled`, `lti_title`, `lti_description`

## Configuration

### 1. Configurer une plateforme LTI

Accédez à l'interface d'administration : **Admin → LTI Platforms** (`/admin/lti-platforms`)

Cliquez sur **"Add Platform"** et remplissez :

#### Exemple pour Moodle :

```
Name: Moodle Production
Issuer: https://moodle.example.com
Client ID: [fourni par Moodle]
Auth Login URL: https://moodle.example.com/mod/lti/auth.php
Auth Token URL: https://moodle.example.com/mod/lti/token.php
Key Set URL: https://moodle.example.com/mod/lti/certs.php
```

#### Exemple pour Canvas :

```
Name: Canvas Production
Issuer: https://canvas.instructure.com
Client ID: [fourni par Canvas]
Auth Login URL: https://canvas.instructure.com/api/lti/authorize_redirect
Auth Token URL: https://canvas.instructure.com/login/oauth2/token
Key Set URL: https://canvas.instructure.com/api/lti/security/jwks
```

### 2. Ajouter un déploiement

Une fois la plateforme créée, ajoutez un déploiement :

```
Deployment ID: [fourni par le LMS, souvent "1" ou "2"]
Name: Production Deployment (optionnel)
```

### 3. Configurer un workflow pour LTI

Dans l'interface d'administration des workflows :

1. Accédez à **Workflows**
2. Sélectionnez un workflow
3. Dans les paramètres LTI :
   - Cochez **"LTI Enabled"**
   - Définissez **"LTI Title"** (titre affiché dans le LMS)
   - Définissez **"LTI Description"** (description affichée dans le LMS)

## Configuration du LMS

### URLs de configuration pour le LMS

Lors de l'enregistrement de l'outil LTI dans votre LMS, utilisez ces URLs :

```
Login Initiation URL: https://votre-domaine.com/api/lti/login
Redirect/Launch URL: https://votre-domaine.com/api/lti/launch
Public JWK URL: https://votre-domaine.com/api/lti/jwks/{platform_id}
```

### Scopes requis

Pour le support AGS (envoi de notes), activez ces scopes :

```
https://purl.imsglobal.org/spec/lti-ags/scope/lineitem
https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly
https://purl.imsglobal.org/spec/lti-ags/scope/score
```

### Example : Configuration dans Moodle

1. **Administration du site → Plugins → Gestion des activités → Outil externe**
2. Cliquez sur **"Configurer un outil manuellement"**
3. Remplissez :
   ```
   Nom de l'outil : ChatKit Workflows
   URL de l'outil : https://votre-domaine.com/api/lti/launch
   Version LTI : LTI 1.3
   URL d'initiation de connexion : https://votre-domaine.com/api/lti/login
   URL de redirection : https://votre-domaine.com/api/lti/launch
   URL du jeu de clés publiques : https://votre-domaine.com/api/lti/jwks/{platform_id}
   ```
4. **Services** :
   - Cochez "IMS LTI Assignment and Grade Services"
5. **Confidentialité** :
   - Partagez le nom du lanceur avec l'outil : Toujours
   - Partagez l'adresse électronique du lanceur : Toujours

### Example : Configuration dans Canvas

1. **Admin → Developer Keys**
2. Cliquez sur **"+ Developer Key" → "+ LTI Key"**
3. **Method** : Manual Entry
4. Remplissez :
   ```
   Key Name: ChatKit Workflows
   Redirect URIs: https://votre-domaine.com/api/lti/launch
   Method: JWK Method
   Public JWK URL: https://votre-domaine.com/api/lti/jwks/{platform_id}
   Target Link URI: https://votre-domaine.com/api/lti/launch
   OpenID Connect Initiation URL: https://votre-domaine.com/api/lti/login
   ```
5. **Scopes** : Activez
   - LTI AGS Line Item
   - LTI AGS Score

## Utilisation

### 1. Deep Linking (Sélection de workflow)

Lorsqu'un enseignant ajoute une activité LTI depuis le LMS :

1. Le LMS redirige vers ChatKit avec un message `LtiDeepLinkingRequest`
2. ChatKit affiche la page de sélection de workflows (`/lti/deep-link`)
3. L'enseignant sélectionne un workflow
4. ChatKit renvoie un JWT Deep Link au LMS
5. Le LMS crée l'activité avec le lien vers le workflow

### 2. Lancement de workflow (Resource Link)

Lorsqu'un étudiant clique sur une activité LTI dans le LMS :

1. Le LMS redirige vers ChatKit avec un message `LtiResourceLinkRequest`
2. ChatKit valide le JWT LTI
3. ChatKit crée ou récupère l'utilisateur LTI
4. ChatKit affiche le workflow (`/lti/workflow/{slug}`)
5. L'étudiant interagit avec le workflow

### 3. Envoi automatique de notes (AGS)

Lorsqu'un workflow se termine avec un bloc "end" :

1. Le workflow appelle `handleWorkflowComplete(score)`
2. ChatKit envoie le score au LMS via AGS
3. La note apparaît dans le carnet de notes du LMS

## API Endpoints

### Endpoints publics LTI

- `POST /api/lti/login` - Initiation de connexion OIDC
- `POST /api/lti/launch` - Launch LTI (Resource Link ou Deep Link)
- `GET /api/lti/jwks/{platform_id}` - Public key set (JWKS)
- `GET /api/lti/config` - Configuration JSON pour enregistrement
- `GET /api/lti/sessions/{session_id}` - Détails de session LTI

### Endpoints Deep Linking

- `POST /api/lti/deep-link/submit?session_id={id}` - Soumettre une sélection Deep Link

### Endpoints AGS (Assignment and Grade Services)

- `POST /api/lti/grades/submit` - Soumettre une note au LMS

### Endpoints d'administration (admin uniquement)

#### Plateformes

- `GET /api/admin/lti/platforms` - Liste des plateformes
- `POST /api/admin/lti/platforms` - Créer une plateforme
- `GET /api/admin/lti/platforms/{id}` - Détails d'une plateforme
- `PUT /api/admin/lti/platforms/{id}` - Modifier une plateforme
- `DELETE /api/admin/lti/platforms/{id}` - Supprimer une plateforme

#### Déploiements

- `GET /api/admin/lti/platforms/{id}/deployments` - Liste des déploiements
- `POST /api/admin/lti/platforms/{id}/deployments` - Créer un déploiement
- `DELETE /api/admin/lti/deployments/{id}` - Supprimer un déploiement

#### Workflows LTI

- `GET /api/admin/lti/workflows/{id}/lti` - Paramètres LTI d'un workflow
- `PUT /api/admin/lti/workflows/{id}/lti` - Modifier les paramètres LTI
- `GET /api/admin/lti/workflows/lti-enabled` - Liste des workflows LTI

## Sécurité

### Validation JWT

- Vérification de la signature avec la clé publique de la plateforme
- Vérification de l'audience (`aud` = `client_id`)
- Vérification de l'expiration (`exp`)
- Validation du nonce (anti-replay)

### Nonces

Les nonces sont stockés pendant 1 heure et automatiquement nettoyés.

### Clés privées

Chaque plateforme génère automatiquement une paire de clés RSA 2048 bits :
- **Clé privée** : Stockée dans la base de données, utilisée pour signer les JWT
- **Clé publique** : Exposée via `/api/lti/jwks/{platform_id}`

## Schéma de flux complet

```
┌──────────────────────────────────────────────────────────────────┐
│                         LMS (Moodle/Canvas)                      │
└────────────┬─────────────────────────────────────┬───────────────┘
             │                                     │
             │ 1. POST /api/lti/login              │ 3. POST /api/lti/launch
             │    (iss, login_hint, target_uri)    │    (id_token JWT)
             │                                     │
             v                                     v
┌─────────────────────────────────────────────────────────────────┐
│                         ChatKit Backend                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 1. Recherche plateforme (issuer + client_id)               │ │
│  │ 2. Génère auth URL avec state/nonce                        │ │
│  │ 3. Redirect vers LMS auth endpoint                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 4. Reçoit id_token JWT du LMS                              │ │
│  │ 5. Valide JWT (signature, exp, aud, nonce)                 │ │
│  │ 6. Extrait claims LTI (user, context, AGS, etc.)           │ │
│  │ 7. Crée/récupère utilisateur LTI                           │ │
│  │ 8. Crée session LTI                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Si Deep Link → /lti/deep-link                              │ │
│  │ Si Resource Link → /lti/workflow/{slug}                    │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
             │                                     │
             v                                     v
┌─────────────────────────┐         ┌──────────────────────────────┐
│  Deep Link Selection    │         │   Workflow Execution         │
│  - Liste workflows      │         │   - Affiche workflow         │
│  - Sélection            │         │   - Interaction utilisateur  │
│  - Génère JWT Deep Link │         │   - Calcule score            │
│  - POST au LMS          │         │   - POST score via AGS       │
└─────────────────────────┘         └──────────────────────────────┘
```

## Dépannage

### Erreur : "Platform not found"

- Vérifiez que l'issuer et le client_id correspondent exactement
- Vérifiez que la plateforme est active (`is_active = true`)

### Erreur : "Invalid JWT token"

- Vérifiez que l'URL du JWKS est correcte
- Vérifiez que les clés publiques sont à jour
- Vérifiez l'horloge système (problème d'expiration)

### Erreur : "Invalid or reused nonce"

- Le nonce a déjà été utilisé (replay attack détecté)
- Attendez quelques secondes et réessayez

### Les notes ne sont pas envoyées

- Vérifiez que le scope AGS est activé dans le LMS
- Vérifiez que `ags_lineitem_url` est présent dans la session
- Vérifiez les logs backend pour les erreurs OAuth

## Développement

### Tester localement avec un LMS

1. Utilisez ngrok pour exposer votre serveur local :
   ```bash
   ngrok http 3000
   ```

2. Utilisez l'URL ngrok dans la configuration LMS :
   ```
   https://xxxxx.ngrok.io/api/lti/login
   https://xxxxx.ngrok.io/api/lti/launch
   https://xxxxx.ngrok.io/api/lti/jwks/{platform_id}
   ```

### Logs de débogage

Les JWT décodés et les données de launch sont stockés dans `LTISession.launch_data` pour faciliter le débogage.

## Références

- [IMS LTI 1.3 Specification](https://www.imsglobal.org/spec/lti/v1p3/)
- [LTI Advantage - Deep Linking](https://www.imsglobal.org/spec/lti-dl/v2p0)
- [LTI Advantage - AGS](https://www.imsglobal.org/spec/lti-ags/v2p0)
- [Moodle LTI Configuration](https://docs.moodle.org/en/LTI_and_Moodle)
- [Canvas LTI Configuration](https://canvas.instructure.com/doc/api/file.lti_dev_key_config.html)

## Support

Pour toute question ou problème, consultez :
- Issues GitHub du projet
- Documentation IMS Global LTI
- Forums de votre LMS spécifique
