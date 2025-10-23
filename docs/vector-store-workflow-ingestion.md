# Vector store workflow ingestion

Le module d'administration peut désormais créer ou mettre à jour un workflow ChatKit au moment d'ingérer un document dans un vector store. Lorsqu'un blueprint de workflow est fourni, le backend :

- valide la structure JSON du blueprint et normalise les champs texte (slug, nom, description) ;
- crée un workflow s'il n'existe pas encore ou importe une nouvelle version lorsque le slug correspond à un workflow existant ;
- marque la nouvelle version comme active par défaut lorsque `mark_active` est à `true` ou qu'aucune version active n'était définie ;
- propage l'identifiant et le slug du workflow créé dans les métadonnées du document ingéré ;
- annule toute l'opération (ingestion et création de workflow) si le blueprint est invalide afin d'éviter de stocker un document partiellement traité.

## Structure attendue du blueprint

Le payload JSON transmis au backend (via l'API `POST /api/vector-stores/{slug}/documents` ou le formulaire *VectorStoreIngestionForm*) doit inclure une clé `workflow_blueprint` conforme à la structure suivante :

```json
{
  "slug": "identifier-latin",
  "display_name": "Nom lisible du workflow",
  "description": "Texte optionnel affiché côté administration",
  "graph": {
    "nodes": [
      { "slug": "start", "kind": "start" },
      { "slug": "end", "kind": "end" }
    ],
    "edges": [
      { "source": "start", "target": "end" }
    ]
  },
  "mark_active": true
}
```

Contraintes principales :

- `slug` est obligatoire, en minuscules, et doit respecter le motif `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `display_name` est obligatoire et ne doit pas être vide après suppression des espaces superflus.
- `description` est facultatif ; si la chaîne est vide, elle sera ignorée.
- `graph` doit être un objet JSON valide décrivant le graphe du workflow (tout autre type déclenchera une erreur de validation).
- `mark_active` contrôle l'activation immédiate de la version importée. S'il est omis, la version devient active uniquement si le workflow n'a pas encore de version active.

En cas d'erreur de validation (`slug` en double, graphe invalide, etc.), la requête est rejetée avec un statut HTTP 400 et aucune donnée (document ou workflow) n'est conservée.
