# Nouvelles Fonctionnalités de Téléphonie

Ce document décrit les trois nouvelles fonctionnalités ajoutées au système de téléphonie ChatKit.

## 1. Configuration du délai de sonnerie (Ring Timeout)

### Description
Permet de configurer le nombre de secondes que le téléphone sonne avant que l'agent vocal ne réponde automatiquement à l'appel.

### Configuration
Dans le workflow, au niveau du bloc `voice-agent`, ajoutez le paramètre `ring_timeout_seconds` :

```json
{
  "kind": "voice-agent",
  "slug": "agent-vocal-principal",
  "parameters": {
    "model": "gpt-4o-realtime",
    "instructions": "Vous êtes un assistant vocal...",
    "voice": "verse",
    "ring_timeout_seconds": 3.0,
    "tools": [],
    "handoffs": []
  }
}
```

### Paramètres
- **ring_timeout_seconds** (float, optionnel, défaut: 0.0)
  - Délai en secondes avant de répondre à l'appel
  - Valeur minimale : 0.0 (réponse immédiate)
  - Exemple : 3.0 pour 3 secondes de sonnerie

### Comportement
1. L'appel entrant déclenche l'envoi d'un message SIP "180 Ringing"
2. Le système attend le nombre de secondes configuré
3. Après le délai, un message "200 OK" est envoyé pour accepter l'appel
4. La conversation avec l'agent vocal commence

### Cas d'usage
- Simuler un temps de réponse réaliste
- Permettre à l'appelant d'entendre plusieurs sonneries avant la réponse
- Synchroniser avec d'autres systèmes téléphoniques

---

## 2. Fonction de transfert d'appel

### Description
Permet à l'agent vocal de transférer l'appel en cours vers un autre numéro de téléphone.

### Utilisation par l'agent
L'outil `transfer_call` est automatiquement disponible pour tous les agents vocaux en téléphonie.

L'agent peut l'utiliser lorsque l'appelant demande à être transféré :
- Vers un service spécifique (ex: "transférez-moi au service commercial")
- Vers un département (ex: "je voudrais parler au support technique")
- Vers une personne (ex: "passez-moi le directeur")

### Configuration dans les instructions de l'agent
Ajoutez dans les instructions de votre agent vocal :

```json
{
  "instructions": "Vous êtes un assistant vocal pour notre entreprise.

Si l'appelant demande à être transféré vers un service ou une personne spécifique,
utilisez la fonction transfer_call avec le numéro approprié :

- Service commercial : +33123456789
- Support technique : +33123456790
- Direction : +33123456791

Avant de transférer, annoncez toujours à l'appelant ce que vous allez faire."
}
```

### Signature de l'outil
```json
{
  "name": "transfer_call",
  "parameters": {
    "phone_number": "string (requis) - Numéro au format E.164 (ex: +33123456789)",
    "announcement": "string (optionnel) - Message à annoncer avant le transfert"
  }
}
```

### Exemple d'utilisation par l'agent

**Appelant :** "Je voudrais parler au service commercial"

**Agent :** "Je vais vous transférer au service commercial. Veuillez patienter."

*L'agent appelle transfer_call avec :*
```json
{
  "phone_number": "+33123456789",
  "announcement": "Transfert vers le service commercial"
}
```

### Notes importantes
- Le numéro doit être au format E.164 (recommandé) : `+33123456789`
- Les formats alternatifs sont acceptés mais seront normalisés : `01 23 45 67 89` → `0123456789`
- Le système termine automatiquement la session après un transfert réussi

### Implémentation technique
- **Fichier principal :** `backend/app/telephony/call_transfer.py`
- **Ajout automatique :** Le tool est ajouté automatiquement dans `startup.py` pour toute session téléphonique
- **Protocole SIP :** Actuellement, le transfert marque simplement la fin de session. Une implémentation future pourra utiliser le protocole SIP REFER pour un vrai transfert d'appel.

---

## 3. Gestion de plusieurs comptes SIP

### Description
Permet de configurer plusieurs comptes SIP (trunks téléphoniques) et d'associer chaque workflow à un compte SIP spécifique.

### Modèle de données

#### Table `sip_accounts`
```sql
CREATE TABLE sip_accounts (
    id SERIAL PRIMARY KEY,
    label VARCHAR(128) NOT NULL,              -- Nom descriptif du compte
    trunk_uri TEXT NOT NULL,                  -- URI du trunk SIP
    username VARCHAR(128),                     -- Nom d'utilisateur SIP
    password VARCHAR(256),                     -- Mot de passe SIP
    contact_host VARCHAR(255),                 -- Hôte de contact public
    contact_port INTEGER,                      -- Port de contact public
    contact_transport VARCHAR(16) DEFAULT 'udp', -- Transport (udp/tcp/tls)
    is_default BOOLEAN NOT NULL DEFAULT false,   -- Compte par défaut
    is_active BOOLEAN NOT NULL DEFAULT true,     -- Compte actif
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);
```

#### Relation avec les workflows
La table `workflow_definitions` a maintenant un champ `sip_account_id` :

```sql
ALTER TABLE workflow_definitions
ADD COLUMN sip_account_id INTEGER REFERENCES sip_accounts(id) ON DELETE SET NULL;
```

### Configuration

#### Création d'un compte SIP

Via SQL :
```sql
INSERT INTO sip_accounts (label, trunk_uri, username, password, contact_host, contact_port, is_default)
VALUES (
    'Trunk Principal',
    'sip:username@provider.com',
    'username',
    'password',
    'votre-ip-publique.com',
    5060,
    true
);

INSERT INTO sip_accounts (label, trunk_uri, username, password, is_default)
VALUES (
    'Trunk Secondaire',
    'sip:other@provider2.com',
    'other',
    'password2',
    false
);
```

#### Association d'un compte SIP à un workflow

Via SQL :
```sql
-- Associer le workflow 'support' au compte SIP avec ID 1
UPDATE workflow_definitions
SET sip_account_id = 1
WHERE workflow_id = (SELECT id FROM workflows WHERE slug = 'support');

-- Associer le workflow 'commercial' au compte SIP avec ID 2
UPDATE workflow_definitions
SET sip_account_id = 2
WHERE workflow_id = (SELECT id FROM workflows WHERE slug = 'commercial');
```

### Cas d'usage

#### Scénario 1 : Plusieurs lignes téléphoniques
- **Compte SIP 1 :** Numéro principal de l'entreprise (0123456789)
- **Compte SIP 2 :** Numéro du support technique (0123456790)
- **Workflow A :** Accueil général → utilise Compte SIP 1
- **Workflow B :** Support technique → utilise Compte SIP 2

#### Scénario 2 : Environnements de test et production
- **Compte SIP 1 :** Production (trunk principal)
- **Compte SIP 2 :** Test (trunk de développement)
- **Workflows de production :** utilisent Compte SIP 1
- **Workflows de test :** utilisent Compte SIP 2

#### Scénario 3 : Multi-tenant
- **Compte SIP 1 :** Client A
- **Compte SIP 2 :** Client B
- **Workflows Client A :** utilisent Compte SIP 1
- **Workflows Client B :** utilisent Compte SIP 2

### Comportement par défaut
Si un workflow n'a pas de `sip_account_id` défini, le système utilisera :
1. Le compte SIP marqué comme `is_default = true`
2. Si aucun compte par défaut, les paramètres de `AppSettings` (ancienne configuration)

### Migration depuis l'ancienne configuration
Les anciens paramètres SIP dans `app_settings` restent fonctionnels pour la rétrocompatibilité. Pour migrer :

```sql
-- Créer un compte SIP à partir de app_settings
INSERT INTO sip_accounts (label, trunk_uri, username, password, contact_host, contact_port, contact_transport, is_default)
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
```

---

## Fichiers modifiés

### Ring Timeout
- `backend/app/telephony/invite_handler.py` - Ajout du paramètre et du délai
- `backend/app/telephony/sip_server.py` - Extraction du paramètre depuis le workflow
- `backend/app/startup.py` - Passage du paramètre à handle_incoming_invite

### Transfert d'appel
- `backend/app/telephony/call_transfer.py` - Nouveau fichier avec la logique de transfert
- `backend/app/telephony/voice_bridge.py` - Import du module
- `backend/app/startup.py` - Ajout automatique du tool

### Multi-SIP
- `backend/app/models.py` - Nouvelle table `SipAccount` et relation avec `WorkflowDefinition`
- `backend/app/telephony/registration.py` - (À modifier pour gérer plusieurs comptes)
- `backend/app/telephony/sip_server.py` - (À modifier pour sélectionner le bon compte)

---

## TODO : Implémentations futures

### Ring Timeout
- ✅ Configuration du délai
- ✅ Implémentation du sleep entre 180 Ringing et 200 OK
- ⏱️ Support d'un timeout maximum côté serveur
- ⏱️ Possibilité d'annuler le timeout si l'appelant raccroche

### Transfert d'appel
- ✅ Outil disponible pour l'agent vocal
- ✅ Normalisation du numéro de téléphone
- ⏱️ Implémentation du protocole SIP REFER pour le transfert réel
- ⏱️ Support du transfert "attendu" (supervised transfer)
- ⏱️ Support du transfert "aveugle" (blind transfer)
- ⏱️ Gestion des échecs de transfert

### Multi-SIP
- ✅ Modèle de données créé
- ✅ Relation avec les workflows
- ⏱️ Interface d'administration pour gérer les comptes SIP
- ⏱️ Modification du `SIPRegistrationManager` pour gérer plusieurs comptes
- ⏱️ Registration simultanée de tous les comptes actifs
- ⏱️ Sélection automatique du compte SIP lors de la résolution de workflow
- ⏱️ Métriques et monitoring par compte SIP
- ⏱️ Fallback vers compte secondaire en cas d'échec

---

## Support et questions

Pour toute question ou problème concernant ces fonctionnalités :
1. Consultez les logs dans `backend/logs/`
2. Vérifiez la configuration de votre workflow
3. Assurez-vous que la base de données contient les bonnes données

### Exemples de logs

**Ring timeout :**
```
INFO - Attente de 3.00 secondes avant de répondre (Call-ID=abc123)
```

**Transfert d'appel :**
```
INFO - Ajout du tool de transfert d'appel (total tools: 1)
INFO - Demande de transfert d'appel vers +33123456789 (annonce: aucune)
```

**Multi-SIP :**
```
INFO - Compte SIP sélectionné pour workflow 'support': Trunk Principal (ID: 1)
```
