# Laboratoires Markdown interactifs

## Décision d'architecture

Les laboratoires sont un domaine parallèle aux workflows et à ChatKit. Leur lecture, leur saisie, leur autosauvegarde et leur remise n'exécutent aucun workflow et ne nécessitent aucun modèle d'IA.

- `LabActivity` porte l'identité stable (`slug`) et la définition publiée courante.
- `LabVersion` conserve chaque source Markdown compilée de façon immuable. Une modification crée une version seulement si le SHA-256 change.
- `LabAttempt` lie une version, un utilisateur et, lors d'un lancement Moodle, un `LTIResourceLink`. Le JSON des réponses est hors de l'historique ChatKit.
- `LTIResourceLink.lab_activity_id` cible directement un laboratoire. Un lien peut cibler un laboratoire ou un workflow, jamais les deux lors d'un nouveau lancement.

Les équipes pourront être ajoutées avec `LabTeam`, `LabTeamMember` et un `team_id` exclusif de `user_id` sur la tentative. Elles ne font pas partie du prototype.

## Syntaxe Markdown enrichie

Le Markdown ordinaire reste inchangé. Un contrôle est inséré avec `{{ type attribut="valeur" }}`. Chaque `id` doit être unique, stable et respecter `[a-z][a-z0-9_]+`.

```md
## Première mesure

Mesurez la pile dans les deux polarités.

{{ number id="pile_normale" label="Rouge sur +, noir sur -" unit="V" required=true }}
{{ textarea id="effet_inversion" label="Que change l'inversion?" rows=3 required=true }}
```

Types du prototype :

- `text`, `number`, `textarea`, `checkbox`;
- `radio` et `select`, avec `options="dc:Continue|ac:Alternative"`;
- `table` et `matrix`, avec `rows="r1:Ligne 1|r2:Ligne 2"` et `columns="v:Valeur|u:Unité"`;
- `teacher_validation`, visible par l'étudiant mais modifiable uniquement depuis l'espace enseignant;
- colonnes typées avec `id:Libellé:type:unité`, par exemple `tension:Tension:number:V`;
- colonnes `select` avec leurs choix séparés par `;`, et colonnes `color` pour les codes de résistances.

Les identifiants de ligne et de colonne sont eux aussi stables. Une cellule est stockée sous la clé `ligne.colonne`, ce qui permet de conserver les réponses lors de changements de libellé ou de contenu Markdown.

La source maîtresse du laboratoire 1 est le fichier du dépôt `243-1J5-LI`. En développement, Docker le monte en lecture seule dans le backend avec `LAB_COURSE_MARKDOWN_PATH`. La copie interne n'est qu'un repli lorsque le dépôt du cours n'est pas monté. Le document complet contient les trois parties, toutes les consignes et 21 groupes de réponses structurés.

## Cycle d'une tentative

1. `POST /api/labs/{slug}/attempt` crée ou reprend la tentative. Un brouillon d'une version antérieure est migré vers la version active par identifiants stables; les réponses supprimées sont archivées dans l'historique de migration.
2. `PATCH /api/labs/attempts/{id}` valide les valeurs côté serveur et exige la révision courante.
3. Le navigateur sauvegarde une copie locale temporaire avant l'appel réseau et la renvoie au retour de la connexion.
4. `POST /api/labs/attempts/{id}/submit` valide les champs obligatoires, passe la tentative à `submitted` et la verrouille.
5. L'espace `/lab-review` permet de valider une étape enseignante, rouvrir une tentative, l'évaluer et demander la publication AGS à Moodle.

Le contrôle de révision fournit une concurrence optimiste : un onglet ancien reçoit `409` au lieu d'écraser des réponses plus récentes.

## Parcours Moodle LTI 1.3

1. Deep Linking charge `/api/lti/deep-link/resources`, qui retourne les laboratoires et les workflows comme deux types distincts.
2. Pour un laboratoire, le content item contient `resource_type=lab`, `lab_activity_id` et `lab_slug`.
3. Au lancement, edxo valide le JWT, provisionne l'utilisateur, associe le `LTIResourceLink` au `LabActivity` et conserve le contexte de cours et les claims AGS.
4. Aucun thread ChatKit n'est créé. Le navigateur est envoyé à `/lab/{slug}`.
5. La tentative est reprise pour l'utilisateur, la version et le lien Moodle concernés.
6. Après évaluation enseignante, edxo reconstruit le contexte AGS depuis `LTIUserSession`, garantit le line item puis publie le résultat avec le client AGS existant.

## Exécution locale

```bash
# installer les dépendances déjà verrouillées
cd frontend && npm ci --include=dev

# démarrer l'application complète
cd .. && ./dev.sh

# après connexion, ouvrir le prototype
http://localhost/lab/laboratoire-1

# espace enseignant
http://localhost/lab-review

# tests ciblés
cd backend
PYTHONPATH=. CHATKIT_SKIP_APP_BOOTSTRAP=1 ../venv/bin/pytest -q -o addopts='' app/tests/test_labs_markdown.py

# vérification frontend
cd ../frontend && npm run build
```

Au démarrage, `sync_bundled_labs` compile le fichier fourni et crée sa version de manière idempotente.

## Créer un laboratoire

L'espace enseignant `/lab-review` crée un laboratoire en téléversant un fichier `.md` UTF-8 de 2 Mo maximum. Le téléversement valide entièrement la syntaxe puis conserve la source dans la version immuable en base de données. Aucun dépôt ni système de fichiers partagé n'est requis en production.

Une nouvelle version se publie de la même façon, en téléversant un autre Markdown depuis la fiche du laboratoire. Après publication, le laboratoire apparaît automatiquement parmi les ressources de Deep Linking Moodle. Le laboratoire 1 intégré à l'application est créé automatiquement au démarrage afin de fournir un exemple fonctionnel par défaut.

## Limites restantes

- ajouter les équipes sans collaboration simultanée dans un premier temps;
- prendre en charge les pièces jointes et captures avec stockage objet;
- améliorer la présentation du rapport de migration avant publication;
- ajouter les tests Moodle d'intégration avec un jeu de clés et de claims LTI réels.
