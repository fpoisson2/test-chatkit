"""Constantes partagées pour la gestion des vector stores internes."""

WORKFLOW_VECTOR_STORE_SLUG = "chatkit-workflows"
"""Identifiant du vector store réservé aux workflows générés."""

WORKFLOW_VECTOR_STORE_TITLE = "Bibliothèque de workflows"
"""Titre appliqué lors de la création automatique du vector store protégé."""

WORKFLOW_VECTOR_STORE_DESCRIPTION = (
    "Vector store système réservé aux définitions de workflows ChatKit."
)
"""Description par défaut utilisée lors de la création automatique."""

WORKFLOW_VECTOR_STORE_BASE_DOCUMENT_ID = "workflow-agent-de-base"
"""Identifiant recommandé pour le blueprint de workflow de démonstration."""

WORKFLOW_LIBRARY_BASE_BLUEPRINT = {
    "slug": WORKFLOW_VECTOR_STORE_BASE_DOCUMENT_ID,
    "display_name": "Agent de base",
    "description": (
        "Workflow minimal reliant un agent entre les blocs Début et Fin."
    ),
    "graph": {
        "nodes": [
            {
                "slug": "start",
                "kind": "start",
                "display_name": "Début",
                "is_enabled": True,
                "parameters": {},
                "metadata": {"position": {"x": 0, "y": 0}},
            },
            {
                "slug": "agent",
                "kind": "agent",
                "display_name": "Agent",
                "is_enabled": True,
                "parameters": {
                    "instructions": (
                        "Répondez aux questions des utilisateurs de manière concise."
                    ),
                    "model_settings": {
                        "model": "gpt-4o-mini",
                        "temperature": 0.6,
                    },
                },
                "metadata": {"position": {"x": 320, "y": 0}},
            },
            {
                "slug": "end",
                "kind": "end",
                "display_name": "Fin",
                "is_enabled": True,
                "parameters": {
                    "message": "Merci pour votre question !",
                    "status": {"type": "closed", "reason": "terminé"},
                },
                "metadata": {"position": {"x": 640, "y": 0}},
            },
        ],
        "edges": [
            {"source": "start", "target": "agent", "metadata": {"label": ""}},
            {"source": "agent", "target": "end", "metadata": {"label": ""}},
        ],
        "metadata": {"version": 1, "template": "base_agent"},
    },
    "mark_active": False,
}
"""Blueprint JSON exposé dans le vector store protégé."""

WORKFLOW_VECTOR_STORE_METADATA = {
    "scope": "workflow_library",
    "protected": True,
    "base_document": {
        "doc_id": WORKFLOW_VECTOR_STORE_BASE_DOCUMENT_ID,
        "document": WORKFLOW_LIBRARY_BASE_BLUEPRINT,
        "metadata": {
            "category": "workflow_blueprint",
            "template": "starter",
        },
    },
}
"""Métadonnées associées au vector store protégé."""

PROTECTED_VECTOR_STORE_ERROR_MESSAGE = (
    "Ce vector store est protégé et ne peut pas être supprimé."
)
"""Message renvoyé lorsque l'on tente de supprimer le magasin protégé."""

