# Implémentation du Système Multi-SIP

Ce document décrit l'implémentation complète du système de gestion multi-SIP pour ChatKit.

## ✅ Fonctionnalités Implémentées

### 1. **Gestion de Plusieurs Comptes SIP**

#### Backend - Modèle de Données
- **Table `sip_accounts`** (`backend/app/models.py:225-255`)
  - Stocke plusieurs comptes SIP avec leurs configurations
  - Champs : label, trunk_uri, username, password, contact_host, contact_port, contact_transport
  - Flags : is_default, is_active

- **Relation avec Workflows** (`backend/app/models.py:348-353,370-373`)
  - Ajout de `sip_account_id` dans `workflow_definitions`
  - Permet d'associer un compte SIP spécifique à chaque workflow

#### Backend - Gestionnaire Multi-SIP
- **`MultiSIPRegistrationManager`** (`backend/app/telephony/multi_sip_manager.py`)
  - Gère plusieurs instances de `SIPRegistrationManager`
  - Un gestionnaire par compte SIP actif
  - Gestion automatique du compte par défaut

**Fonctionnalités :**
```python
- load_accounts_from_db(session)  # Charge tous les comptes actifs
- start()  # Démarre tous les gestionnaires
- stop()  # Arrête tous les gestionnaires
- get_manager_for_account(account_id)  # Récupère le gestionnaire pour un compte
- get_default_manager()  # Récupère le gestionnaire par défaut
```

#### Backend - API Endpoints (`backend/app/routes/admin.py:335-503`)
- **GET** `/api/admin/sip-accounts` - Liste tous les comptes
- **POST** `/api/admin/sip-accounts` - Crée un nouveau compte
- **PATCH** `/api/admin/sip-accounts/{id}` - Met à jour un compte
- **DELETE** `/api/admin/sip-accounts/{id}` - Supprime un compte

**Fonctionnalités spéciales :**
- Rechargement automatique des comptes après création/modification/suppression
- Gestion exclusive du compte par défaut
- Validation des données (port 1-65535, transport udp/tcp/tls)

### 2. **Sélection du Compte SIP par Workflow**

#### Résolution du Workflow (`backend/app/telephony/sip_server.py:79,376-400`)
- Ajout de `sip_account_id` dans `TelephonyCallContext`
- Extraction automatique du compte SIP associé au workflow
- Log de l'association pour le debugging

#### Intégration au Démarrage (`backend/app/startup.py:57,94,1820-1948`)
- Utilisation de `MultiSIPRegistrationManager` au lieu de `SIPRegistrationManager`
- Chargement automatique des comptes depuis la BD au démarrage
- Fallback vers `AppSettings` si aucun compte n'est configuré
- Rechargement dynamique lors des modifications via l'API

### 3. **Interface d'Administration**

#### Page de Gestion SIP (`frontend/src/pages/AdminSipAccountsPage.tsx`)
**Fonctionnalités :**
- Tableau listant tous les comptes avec badges (Défaut, Actif/Inactif)
- Formulaire création/édition complet
- Actions : Créer, Modifier, Supprimer
- Messages d'erreur et de succès
- Support mode sombre

**Champs du formulaire :**
- Label (nom descriptif)
- URI SIP (requis)
- Nom d'utilisateur
- Mot de passe (masqué)
- Hôte de contact
- Port de contact (1-65535)
- Transport (UDP/TCP/TLS)
- Compte par défaut (checkbox)
- Actif (checkbox)

#### Navigation (`frontend/src/App.tsx:15,132-140`)
- Route `/admin/sip-accounts` protégée par authentification admin
- Import et configuration de la page

#### Menu d'Administration (`frontend/src/components/AdminTabs.tsx:7-19`)
- Nouvel onglet "Comptes SIP" entre "Widgets" et "Paramètres généraux"

#### Traductions (`frontend/src/i18n/translations.ts:38,642`)
- 🇫🇷 "Comptes SIP"
- 🇬🇧 "SIP Accounts"

### 4. **Migration de Base de Données**

#### Migration Automatique (`backend/app/startup.py:44,982-1010`)
Au démarrage de l'application :
1. Création de la table `sip_accounts` si elle n'existe pas
2. Ajout de la colonne `sip_account_id` dans `workflow_definitions`
3. Création d'un index sur `sip_account_id`

```sql
CREATE TABLE sip_accounts (
    id SERIAL PRIMARY KEY,
    label VARCHAR(128) NOT NULL,
    trunk_uri TEXT NOT NULL,
    username VARCHAR(128),
    password VARCHAR(256),
    contact_host VARCHAR(255),
    contact_port INTEGER,
    contact_transport VARCHAR(16) DEFAULT 'udp',
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

ALTER TABLE workflow_definitions
ADD COLUMN sip_account_id INTEGER
REFERENCES sip_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_workflow_definitions_sip_account
ON workflow_definitions(sip_account_id);
```

## 📊 Architecture

### Flux de Traitement d'un Appel

```
1. Appel SIP entrant
   ↓
2. resolve_workflow_for_phone_number()
   ├─ Récupère le workflow SIP
   ├─ Extrait sip_account_id du workflow
   └─ Retourne TelephonyCallContext (avec sip_account_id)
   ↓
3. MultiSIPRegistrationManager
   ├─ get_manager_for_account(sip_account_id)
   ├─ Utilise le gestionnaire spécifique OU le gestionnaire par défaut
   └─ Traite l'appel avec le bon compte SIP
```

### Gestion des Comptes SIP

```
MultiSIPRegistrationManager
  │
  ├─ SIPRegistrationManager (Account 1) ─── Trunk Principal
  │
  ├─ SIPRegistrationManager (Account 2) ─── Trunk Secondaire
  │
  └─ SIPRegistrationManager (Account 3) ─── Trunk Test
```

## 🎯 Cas d'Usage

### Scénario 1 : Plusieurs Lignes Téléphoniques
```
- Compte SIP 1 (défaut) : 0123456789 → Workflow "Accueil"
- Compte SIP 2 : 0123456790 → Workflow "Support Technique"
- Compte SIP 3 : 0123456791 → Workflow "Commercial"
```

### Scénario 2 : Environnements Séparés
```
- Compte SIP 1 (défaut) : Production → Workflow "Production"
- Compte SIP 2 : Staging → Workflow "Staging"
- Compte SIP 3 (inactif) : Dev → Workflow "Dev"
```

### Scénario 3 : Multi-Tenant
```
- Compte SIP 1 : Client A → Workflows Client A
- Compte SIP 2 (défaut) : Client B → Workflows Client B
- Compte SIP 3 : Client C → Workflows Client C
```

## 📝 Configuration

### 1. Créer un Compte SIP

**Via l'Interface Admin :**
1. Aller dans Administration → Comptes SIP
2. Cliquer sur "+ Ajouter un compte"
3. Remplir les champs (URI SIP obligatoire)
4. Cocher "Compte par défaut" si souhaité
5. Cocher "Actif" pour activer immédiatement
6. Cliquer sur "Créer"

**Via SQL :**
```sql
INSERT INTO sip_accounts (
    label,
    trunk_uri,
    username,
    password,
    contact_host,
    contact_port,
    contact_transport,
    is_default,
    is_active
)
VALUES (
    'Trunk Principal',
    'sip:username@provider.com',
    'username',
    'password',
    'votre-ip-publique.com',
    5060,
    'udp',
    true,
    true
);
```

### 2. Associer un Compte SIP à un Workflow

**Via SQL :**
```sql
-- Associer le workflow 'support' au compte SIP avec ID 2
UPDATE workflow_definitions
SET sip_account_id = 2
WHERE workflow_id = (SELECT id FROM workflows WHERE slug = 'support');
```

**Via le Workflow Builder :** (À venir)
- Ouvrir le workflow dans le builder
- Sélectionner le compte SIP dans le panneau de configuration
- Enregistrer

### 3. Vérifier la Configuration

**Logs au démarrage :**
```
INFO - Chargement des comptes SIP depuis la base de données
INFO - Trouvé 3 compte(s) SIP actif(s)
INFO - Compte SIP par défaut : Trunk Principal (ID: 1)
INFO - Création d'un gestionnaire SIP pour 'Trunk Principal' (URI: sip:user@provider.com)
INFO - Démarrage de tous les gestionnaires SIP (3 compte(s))
INFO - Gestionnaire SIP démarré pour l'ID 1
INFO - Enregistrement SIP réussi auprès de provider.com:5060
```

**Logs lors d'un appel :**
```
INFO - Appel SIP entrant pour +33123456789
INFO - Workflow SIP sélectionné : support
INFO - Workflow associé au compte SIP ID: 2
INFO - Démarrage du pont voix Realtime
```

## 🔄 Comportement par Défaut

### Priorité de Sélection du Compte SIP

1. **Compte associé au workflow** : Si le workflow a un `sip_account_id` défini, utiliser ce compte
2. **Compte par défaut** : Si `sip_account_id` est NULL, utiliser le compte avec `is_default = true`
3. **Premier compte actif** : Si aucun compte par défaut, utiliser le premier compte actif disponible
4. **Fallback AppSettings** : Si aucun compte en BD, utiliser l'ancien système (AppSettings)

### Rechargement Automatique

Les comptes SIP sont rechargés automatiquement dans les cas suivants :
- Au démarrage de l'application
- Après création d'un compte via l'API
- Après modification d'un compte via l'API
- Après suppression d'un compte via l'API

## ⚠️ Migration depuis l'Ancienne Configuration

### Compatibilité Rétrograde

Le système est **100% rétrocompatible** :
- Si aucun compte SIP n'est configuré en BD, le système utilise `AppSettings`
- Les anciens paramètres dans `app_settings` continuent de fonctionner
- Aucune interruption de service lors de la mise à jour

### Migration Recommandée

```sql
-- 1. Créer un compte SIP à partir de app_settings
INSERT INTO sip_accounts (
    label,
    trunk_uri,
    username,
    password,
    contact_host,
    contact_port,
    contact_transport,
    is_default
)
SELECT
    'Compte Principal (migré)',
    sip_trunk_uri,
    sip_trunk_username,
    sip_trunk_password,
    sip_contact_host,
    sip_contact_port,
    sip_contact_transport,
    true
FROM app_settings
WHERE sip_trunk_uri IS NOT NULL
LIMIT 1;

-- 2. Vérifier la création
SELECT * FROM sip_accounts;

-- 3. Redémarrer l'application pour utiliser le nouveau système
```

## 🐛 Debugging

### Vérifier les Comptes SIP

```sql
-- Lister tous les comptes
SELECT id, label, trunk_uri, is_default, is_active
FROM sip_accounts
ORDER BY is_default DESC, label;

-- Vérifier les associations workflow-compte
SELECT
    w.slug AS workflow_slug,
    wd.version,
    sa.label AS sip_account,
    sa.trunk_uri
FROM workflow_definitions wd
JOIN workflows w ON w.id = wd.workflow_id
LEFT JOIN sip_accounts sa ON sa.id = wd.sip_account_id
WHERE wd.is_active = true;
```

### Logs Utiles

```bash
# Voir les logs de registration SIP
grep "SIP" backend/logs/app.log | tail -50

# Voir les appels entrants
grep "Appel SIP entrant" backend/logs/app.log

# Voir les associations compte-workflow
grep "Workflow associé au compte SIP" backend/logs/app.log
```

## 📚 Fichiers Modifiés

### Backend
- `backend/app/models.py` - Nouveau modèle `SipAccount` + relation
- `backend/app/schemas.py` - Schémas Pydantic pour l'API
- `backend/app/routes/admin.py` - Endpoints CRUD pour les comptes SIP
- `backend/app/telephony/multi_sip_manager.py` - **NOUVEAU** Gestionnaire multi-SIP
- `backend/app/telephony/sip_server.py` - Ajout sip_account_id dans TelephonyCallContext
- `backend/app/startup.py` - Migration BD + utilisation de MultiSIPRegistrationManager

### Frontend
- `frontend/src/pages/AdminSipAccountsPage.tsx` - **NOUVEAU** Page de gestion
- `frontend/src/App.tsx` - Route pour la page SIP
- `frontend/src/components/AdminTabs.tsx` - Onglet dans le menu admin
- `frontend/src/i18n/translations.ts` - Traductions FR/EN

## 🚀 Prochaines Améliorations Possibles

1. **Workflow Builder**
   - Ajouter un sélecteur de compte SIP dans l'interface
   - Afficher le compte SIP actuel dans le panneau de configuration

2. **Monitoring**
   - Dashboard montrant l'état de chaque compte SIP (enregistré/échec)
   - Métriques par compte (appels reçus, durée, etc.)
   - Alertes en cas d'échec d'enregistrement

3. **Load Balancing**
   - Répartition automatique des appels entre plusieurs comptes
   - Round-robin ou weighted distribution

4. **Failover**
   - Basculement automatique vers un compte secondaire
   - Health checks périodiques

5. **Sécurité**
   - Chiffrement des mots de passe en BD
   - Rotation automatique des credentials
   - Audit log des modifications

## 📞 Support

En cas de problème :
1. Vérifier les logs de l'application
2. Vérifier la configuration en BD
3. Tester avec un compte SIP simple (sans authentification)
4. Consulter la documentation TELEPHONY_FEATURES.md

---

**Version :** 1.0
**Date :** 2025-01-XX
**Auteur :** ChatKit Development Team
