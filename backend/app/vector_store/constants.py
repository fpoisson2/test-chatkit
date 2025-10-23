"""Constantes partagées pour la gestion des vector stores internes."""

WORKFLOW_VECTOR_STORE_SLUG = "chatkit-workflows"
"""Identifiant du vector store réservé aux workflows générés."""

WORKFLOW_VECTOR_STORE_TITLE = "Bibliothèque de workflows"
"""Titre appliqué lors de la création automatique du vector store protégé."""

WORKFLOW_VECTOR_STORE_DESCRIPTION = (
    "Vector store système réservé aux définitions de workflows ChatKit."
)
"""Description par défaut utilisée lors de la création automatique."""

WORKFLOW_VECTOR_STORE_METADATA = {
    "scope": "workflow_library",
    "protected": True,
}
"""Métadonnées associées au vector store protégé."""

PROTECTED_VECTOR_STORE_ERROR_MESSAGE = (
    "Ce vector store est protégé et ne peut pas être supprimé."
)
"""Message renvoyé lorsque l'on tente de supprimer le magasin protégé."""

