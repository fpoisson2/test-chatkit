# Envoi de notes avec LTI 1.3

Ce document explique comment envoyer des notes au LMS (Learning Management System) depuis un workflow ChatKit.

## 🎯 Méthode : Tool "submit_lti_grade"

**Usage** : Pour workflows avec score progressif ou dynamique calculé par l'agent

Les agents dans le workflow peuvent appeler le tool `submit_lti_grade` à tout moment pour envoyer une note.

#### Configuration

Ajoutez le tool à la configuration de votre agent dans le workflow :

```json
{
  "slug": "tutoring-agent",
  "kind": "agent",
  "parameters": {
    "model": "gpt-4",
    "instructions": "Tu es un tuteur qui évalue les réponses de l'étudiant...",
    "tools": [
      "submit_lti_grade"
    ]
  }
}
```

#### Signature du tool

```python
submit_lti_grade(
    score: float,              # Score obtenu (ex: 85)
    score_maximum: float = 100.0,  # Score maximum (défaut: 100)
    comment: str | None = None     # Commentaire optionnel
) -> str
```

#### Exemple d'usage par un agent

L'agent peut appeler ce tool directement dans sa réponse :

```
Agent: "Excellent travail! Tu as répondu correctement à 8 questions sur 10."
[Agent calls: submit_lti_grade(score=80, score_maximum=100, comment="8/10 questions correctes")]
Agent: "Ta note de 80/100 a été envoyée à ton cours."
```

#### Multiples soumissions

Vous pouvez soumettre des notes **plusieurs fois** pendant le workflow :

```
[Après exercice 1]
submit_lti_grade(score=25, score_maximum=100, comment="Exercice 1 complété")

[Après exercice 2]
submit_lti_grade(score=50, score_maximum=100, comment="Exercice 2 complété")

[À la fin]
submit_lti_grade(score=100, score_maximum=100, comment="Tous les exercices complétés!")
```

Le LMS affichera typiquement la **dernière note envoyée**.

---

## 📊 Cas d'usage

### Cas 1 : Quiz simple à choix multiples

**Méthode** : Tool `submit_lti_grade`

```
┌──────────────────────────────────────┐
│ Start → Agent (pose questions)       │
│       → Condition (évalue réponses)  │
│       → End                          │
└──────────────────────────────────────┘

L'agent évalue les réponses et soumet la note:
- Si toutes correctes: submit_lti_grade(score=100)
- Si 8/10 correctes: submit_lti_grade(score=80)
- Si 6/10 correctes: submit_lti_grade(score=60)
```

### Cas 2 : Tutoriel progressif

**Méthode** : Tool `submit_lti_grade`

```
Agent tuteur évalue chaque réponse et accumule des points :

Étape 1: "Bonne réponse! +10 points"
         submit_lti_grade(score=10, score_maximum=100)

Étape 2: "Excellent! +20 points supplémentaires"
         submit_lti_grade(score=30, score_maximum=100)

Étape 3: "Parfait! Note finale: 30/100"
         (Note déjà envoyée, rien à faire)
```

### Cas 3 : Workflow avec tentatives multiples

**Méthode** : Tool `submit_lti_grade`

```
L'étudiant peut refaire le workflow plusieurs fois :

Tentative 1: submit_lti_grade(score=60)
Tentative 2: submit_lti_grade(score=75)  // Amélioration
Tentative 3: submit_lti_grade(score=90)  // Encore mieux!

Le LMS garde typiquement la dernière note (90).
```

### Cas 4 : Évaluation continue

**Méthode** : Tool `submit_lti_grade`

```
Pendant le workflow:
- L'agent envoie des notes progressives
- submit_lti_grade(score=25) après section 1
- submit_lti_grade(score=50) après section 2
- submit_lti_grade(score=75) après section 3
- submit_lti_grade(score=100) à la fin (note finale)
```

---

## 🔒 Sécurité et validation

### Quand la note est-elle envoyée ?

**Tool** : Quand l'agent appelle explicitement `submit_lti_grade`

### Vérifications automatiques

Le système vérifie automatiquement :

- ✅ **Contexte LTI** : La note n'est envoyée que si le workflow est lancé via LTI
- ✅ **Permissions AGS** : Vérifie que le LMS autorise l'envoi de notes
- ✅ **Session valide** : Vérifie que la session LTI est active
- ✅ **Authentification** : Utilise OAuth 2.0 pour s'authentifier auprès du LMS

### Cas d'erreur

Si l'envoi échoue :

- **Tool** : Un message d'erreur est retourné à l'agent (ex: "❌ Erreur: Permission insuffisante")

Le workflow **ne plante jamais** en cas d'échec d'envoi de note.

---

## 🎓 Exemple complet : Tuteur de mathématiques

```json
{
  "nodes": [
    {
      "slug": "start",
      "kind": "start"
    },
    {
      "slug": "tutor",
      "kind": "agent",
      "parameters": {
        "model": "gpt-4",
        "instructions": "Tu es un tuteur de mathématiques. Pose 5 questions progressives à l'étudiant. Pour chaque bonne réponse, attribue 20 points. Utilise submit_lti_grade pour envoyer le score progressif après chaque question.",
        "tools": ["submit_lti_grade"]
      }
    },
    {
      "slug": "end",
      "kind": "end",
      "parameters": {
        "message": "Félicitations! Tutoriel terminé."
      }
    }
  ],
  "edges": [
    {"source": "start", "target": "tutor"},
    {"source": "tutor", "target": "end"}
  ]
}
```

**Déroulement** :

1. L'agent pose la question 1 → Bonne réponse → `submit_lti_grade(score=20)` → Note: 20/100
2. L'agent pose la question 2 → Bonne réponse → `submit_lti_grade(score=40)` → Note: 40/100
3. L'agent pose la question 3 → Bonne réponse → `submit_lti_grade(score=60)` → Note: 60/100
4. L'agent pose la question 4 → Bonne réponse → `submit_lti_grade(score=80)` → Note: 80/100
5. L'agent pose la question 5 → Bonne réponse → `submit_lti_grade(score=100)` → Note: 100/100
6. Workflow atteint "end" → Tutoriel terminé

---

## 📝 Notes importantes

### Scores multiples

- Le LMS reçoit chaque soumission de note
- La plupart des LMS affichent la **dernière note** dans le carnet
- Certains LMS gardent un historique de toutes les soumissions

### Scores vs note maximale

- Si `score_maximum` n'est pas spécifié, la valeur par défaut est 100
- Le LMS calcule le pourcentage : `(score / score_maximum) * 100`
- Exemple : `score=17, score_maximum=20` → 85% dans le LMS

### Contexte non-LTI

- Si le workflow n'est **pas** lancé via LTI :
  - Le tool `submit_lti_grade` retourne un message d'erreur à l'agent

### Performance

- L'envoi de note est **asynchrone** et ne bloque pas le workflow
- En cas d'erreur réseau, le workflow continue normalement
- Les erreurs sont loggées pour le debugging

---

## 🛠️ Debugging

### Logs

Les soumissions de notes sont loggées :

```
INFO: Auto-submitted LTI grade: 85/100 (85.0%) for session abc123
INFO: Grade submitted successfully: 75/100 (75.0%) for LTI session xyz789
```

Les erreurs sont également loggées :

```
ERROR: Failed to auto-submit LTI grade: HTTP 403 - Insufficient scope
ERROR: Failed to submit grade: The LMS server returned an error (500)
```

### Vérification manuelle

Pour vérifier si une note a été envoyée :

1. Consultez la table `lti_sessions` dans la base de données
2. Champs pertinents :
   - `score` : Le score soumis
   - `score_maximum` : Le score maximum
   - `score_submitted` : `true` si envoyé avec succès
   - `score_submitted_at` : Timestamp de l'envoi

---

## 🔗 Références

- [IMS LTI 1.3 Specification](https://www.imsglobal.org/spec/lti/v1p3/)
- [LTI Assignment and Grade Services (AGS)](https://www.imsglobal.org/spec/lti-ags/v2p0)
- [Guide d'intégration LTI 1.3](./LTI_1.3_INTEGRATION.md)
