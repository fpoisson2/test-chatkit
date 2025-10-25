from __future__ import annotations

import datetime
import math
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field, constr, field_validator


class SessionRequest(BaseModel):
    user: str | None = None
    hosted_workflow_slug: str | None = None


class VoiceSessionRequest(BaseModel):
    """Requête de création d'une session vocale Realtime."""

    model: str | None = Field(
        default=None,
        description="Modèle Realtime à utiliser (optionnel).",
    )
    instructions: str | None = Field(
        default=None,
        description="Instructions transmises à l'agent vocal (optionnel).",
    )
    voice: str | None = Field(
        default=None,
        description="Identifiant de la voix souhaitée (optionnel).",
    )


class VoiceSessionResponse(BaseModel):
    """Réponse renvoyée après création d'une session vocale Realtime."""

    client_secret: dict[str, Any] | str
    expires_at: str | None = None
    model: str
    instructions: str
    voice: str
    prompt_id: str | None = None
    prompt_version: str | None = None
    prompt_variables: dict[str, str] = Field(default_factory=dict)


class HostedWorkflowOption(BaseModel):
    """Métadonnées minimales pour un workflow hébergé ChatKit."""

    id: str
    slug: str
    label: str
    description: str | None = None
    available: bool
    managed: bool = False


class HostedWorkflowCreateRequest(BaseModel):
    """Payload de création pour une entrée de workflow hébergé."""

    slug: constr(strip_whitespace=True, min_length=1, max_length=128)
    label: constr(strip_whitespace=True, min_length=1, max_length=128)
    workflow_id: constr(strip_whitespace=True, min_length=1, max_length=128)
    description: constr(strip_whitespace=True, max_length=512) | None = None


class ChatKitWorkflowResponse(BaseModel):
    """Description minimaliste du workflow utilisé par ChatKit."""

    workflow_id: int
    workflow_slug: str | None
    workflow_display_name: str | None
    definition_id: int
    definition_version: int
    auto_start: bool
    auto_start_user_message: str | None = Field(
        default=None,
        description=(
            "Message utilisateur injecté lors du démarrage automatique (optionnel, "
            "mutuellement exclusif avec auto_start_assistant_message)."
        ),
    )
    auto_start_assistant_message: str | None = Field(
        default=None,
        description=(
            "Message assistant diffusé lors du démarrage automatique (optionnel, "
            "mutuellement exclusif avec auto_start_user_message)."
        ),
    )
    updated_at: datetime.datetime


class VoiceSettingsResponse(BaseModel):
    instructions: str
    model: str
    voice: str
    prompt_id: str | None = None
    prompt_version: str | None = None
    prompt_variables: dict[str, str] = Field(default_factory=dict)
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class VoiceSettingsUpdateRequest(BaseModel):
    instructions: str | None = Field(
        default=None, description="Instructions vocales personnalisées."
    )
    model: str | None = Field(default=None, description="Modèle Realtime à utiliser.")
    voice: str | None = Field(
        default=None, description="Identifiant de la voix Realtime."
    )
    prompt_id: str | None = Field(
        default=None, description="Identifiant du prompt stocké côté serveur."
    )
    prompt_version: str | None = Field(
        default=None, description="Version optionnelle du prompt."
    )
    prompt_variables: dict[str, str] | None = Field(
        default=None,
        description="Variables injectées lors de la résolution du prompt.",
    )


class AppSettingsResponse(BaseModel):
    thread_title_prompt: str
    default_thread_title_prompt: str
    is_custom_thread_title_prompt: bool
    sip_trunk_uri: str | None = None
    sip_trunk_username: str | None = None
    sip_trunk_password: str | None = None
    sip_contact_host: str | None = None
    sip_contact_port: int | None = None
    sip_contact_transport: str | None = None
    created_at: datetime.datetime | None = None
    updated_at: datetime.datetime | None = None


class AppSettingsUpdateRequest(BaseModel):
    thread_title_prompt: str | None = Field(
        default=None,
        description=(
            "Prompt personnalisé pour les titres de fils. Laisser vide pour revenir "
            "à la valeur par défaut."
        ),
        max_length=4000,
    )
    sip_trunk_uri: str | None = Field(
        default=None,
        description="URI du trunk SIP à joindre pour les appels entrants.",
        max_length=512,
    )
    sip_trunk_username: str | None = Field(
        default=None,
        description="Identifiant d'authentification SIP (optionnel).",
        max_length=128,
    )
    sip_trunk_password: str | None = Field(
        default=None,
        description="Mot de passe SIP (laisser vide pour le supprimer).",
        max_length=256,
    )
    sip_contact_host: str | None = Field(
        default=None,
        description=(
            "Nom d'hôte ou adresse IP à publier dans l'en-tête Contact. "
            "Laisser vide pour déduire automatiquement l'adresse."
        ),
        max_length=255,
    )
    sip_contact_port: int | None = Field(
        default=None,
        description=(
            "Port d'écoute du serveur SIP local. Utilise 5060 si non défini."
        ),
        ge=1,
        le=65535,
    )
    sip_contact_transport: str | None = Field(
        default=None,
        description=(
            "Transport SIP à annoncer (udp, tcp, tls). "
            "Laisser vide pour conserver la valeur par défaut."
        ),
        max_length=16,
    )


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    is_admin: bool = False


class UserUpdate(BaseModel):
    password: str | None = None
    is_admin: bool | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    is_admin: bool
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class TelephonyRouteBase(BaseModel):
    phone_number: constr(strip_whitespace=True, min_length=1, max_length=32)
    workflow_slug: constr(strip_whitespace=True, min_length=1, max_length=128)
    workflow_id: int | None = None
    metadata: dict[str, Any] | None = None


class TelephonyRouteCreateRequest(TelephonyRouteBase):
    pass


class TelephonyRouteUpdateRequest(BaseModel):
    phone_number: constr(strip_whitespace=True, min_length=1, max_length=32) | None = (
        None
    )
    workflow_slug: (
        constr(strip_whitespace=True, min_length=1, max_length=128) | None
    ) = None
    workflow_id: int | None = None
    metadata: dict[str, Any] | None = None


class TelephonyRouteResponse(TelephonyRouteBase):
    id: int
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias="metadata_",
        serialization_alias="metadata",
    )
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = ConfigDict(from_attributes=True)


class AvailableModelBase(BaseModel):
    name: constr(strip_whitespace=True, min_length=1, max_length=128)
    display_name: constr(strip_whitespace=True, min_length=1, max_length=128) | None = (
        None
    )
    description: constr(strip_whitespace=True, min_length=1, max_length=512) | None = (
        None
    )
    supports_reasoning: bool = False


class AvailableModelCreateRequest(AvailableModelBase):
    pass


class AvailableModelResponse(AvailableModelBase):
    id: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


TokenResponse.model_rebuild()


class WeatherResponse(BaseModel):
    city: str
    country: str | None
    latitude: str
    longitude: str
    temperature_celsius: str
    wind_speed_kmh: str
    weather_code: str
    weather_description: str
    observation_time: str
    timezone: str | None
    source: str = "open-meteo"


KNOWN_WORKFLOW_NODE_KINDS = (
    "start",
    "agent",
    "voice_agent",
    "condition",
    "state",
    "watch",
    "assistant_message",
    "user_message",
    "json_vector_store",
    "widget",
    "end",
)


class WorkflowAgentWorkflowReference(BaseModel):
    """Référence à un workflow exécuté par un outil d'agent."""

    model_config = ConfigDict(extra="allow")

    id: int | None = Field(
        default=None,
        gt=0,
        description="Identifiant numérique du workflow cible (facultatif).",
    )
    slug: constr(strip_whitespace=True, min_length=1) | None = Field(
        default=None,
        description="Slug du workflow cible (facultatif).",
    )


class WorkflowAgentToolDefinition(BaseModel):
    """Déclaration d'un outil accessible par un agent (texte ou vocal)."""

    model_config = ConfigDict(extra="allow")

    type: constr(strip_whitespace=True, min_length=1) | None = Field(
        default=None,
        description=(
            "Type d'outil (ex. workflow, web_search, file_search, computer_use, "
            "function)."
        ),
    )
    workflow: WorkflowAgentWorkflowReference | None = Field(
        default=None,
        description=(
            "Référence au workflow exécuté lorsque l'outil est de type "
            "workflow."
        ),
    )
    function: dict[str, Any] | None = Field(
        default=None,
        description="Déclaration brute d'une fonction OpenAI (outils function_call).",
    )
    agent: dict[str, Any] | None = Field(
        default=None,
        description="Configuration d'un agent imbriqué si supporté.",
    )
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Métadonnées complémentaires laissées libres pour le frontend.",
    )


class WorkflowNodeParameters(BaseModel):
    """Paramètres d'un nœud de workflow, incluant la déclaration d'outils."""

    model_config = ConfigDict(extra="allow")

    tools: list[WorkflowAgentToolDefinition] | None = Field(
        default=None,
        description=(
            "Liste d'outils accessibles pour l'agent. Chaque entrée reprend la "
            "structure déjà utilisée pour les agents texte (type, workflow, "
            "function, etc.)."
        ),
    )


class WorkflowNodeBase(BaseModel):
    slug: str
    kind: str = Field(
        description=(
            "Type du nœud dans le graphe. Valeurs actuellement reconnues : "
            + ", ".join(KNOWN_WORKFLOW_NODE_KINDS)
            + ". Cette API accepte également d'autres valeurs afin de "
            "rester compatible avec de futurs blocs personnalisés."
        )
    )
    display_name: str | None = None
    agent_key: str | None = None
    is_enabled: bool = True
    parameters: WorkflowNodeParameters = Field(
        default_factory=WorkflowNodeParameters,
        description=(
            "Paramètres propres au nœud. Pour les agents, le champ optionnel "
            "workflow peut référencer un autre workflow via un id ou un slug."
        ),
    )
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowNodeInput(WorkflowNodeBase):
    pass


class WorkflowNodeResponse(WorkflowNodeBase):
    id: int
    position: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class WorkflowEdgeBase(BaseModel):
    source: str
    target: str
    condition: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowEdgeInput(WorkflowEdgeBase):
    pass


class WorkflowEdgeResponse(WorkflowEdgeBase):
    id: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class WorkflowGraphInput(BaseModel):
    nodes: list[WorkflowNodeInput]
    edges: list[WorkflowEdgeInput]


class WorkflowGraphResponse(BaseModel):
    nodes: list[WorkflowNodeResponse]
    edges: list[WorkflowEdgeResponse]

    class Config:
        from_attributes = True


class WorkflowStepResponse(BaseModel):
    id: int
    agent_key: str | None
    position: int
    is_enabled: bool
    parameters: WorkflowNodeParameters = Field(
        default_factory=WorkflowNodeParameters,
        description=(
            "Paramètres normalisés du nœud. Lorsqu'un agent exécute un workflow "
            "imbriqué, parameters['workflow'] contient un identifiant ou un slug."
        ),
    )
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class WorkflowDefinitionResponse(BaseModel):
    id: int
    workflow_id: int
    workflow_slug: str | None = None
    workflow_display_name: str | None = None
    workflow_is_chatkit_default: bool = False
    name: str
    version: int
    is_active: bool
    created_at: datetime.datetime
    updated_at: datetime.datetime
    steps: list[WorkflowStepResponse]
    graph: WorkflowGraphResponse

    class Config:
        from_attributes = True


class WorkflowDefinitionUpdate(BaseModel):
    graph: WorkflowGraphInput


class WorkflowSummaryResponse(BaseModel):
    id: int
    slug: str
    display_name: str
    description: str | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    active_version_id: int | None = None
    active_version_number: int | None = None
    is_chatkit_default: bool
    versions_count: int


class WorkflowVersionSummaryResponse(BaseModel):
    id: int
    workflow_id: int
    name: str | None = None
    version: int
    is_active: bool
    created_at: datetime.datetime
    updated_at: datetime.datetime


class WorkflowCreateRequest(BaseModel):
    slug: str
    display_name: str
    description: str | None = None
    graph: WorkflowGraphInput | None = None


class WorkflowUpdateRequest(BaseModel):
    slug: str | None = None
    display_name: str | None = None
    description: str | None = None


class WorkflowVersionCreateRequest(BaseModel):
    graph: WorkflowGraphInput
    name: str | None = None
    mark_as_active: bool = False


class WorkflowVersionUpdateRequest(BaseModel):
    graph: WorkflowGraphInput


class WorkflowProductionUpdate(BaseModel):
    version_id: int


class WorkflowChatKitUpdate(BaseModel):
    workflow_id: int


class WorkflowViewportEntry(BaseModel):
    workflow_id: int
    version_id: int | None = None
    device_type: str = "desktop"
    x: float
    y: float
    zoom: float
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class WorkflowViewportUpsert(BaseModel):
    workflow_id: int
    version_id: int | None = None
    device_type: str = "desktop"
    x: float
    y: float
    zoom: float

    @field_validator("x", "y", "zoom")
    @classmethod
    def _ensure_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("La valeur doit être un nombre fini.")
        return value

    @field_validator("device_type")
    @classmethod
    def _validate_device_type(cls, value: str) -> str:
        if value not in ("mobile", "desktop"):
            raise ValueError("device_type doit être 'mobile' ou 'desktop'")
        return value


class WorkflowViewportReplaceRequest(BaseModel):
    viewports: list[WorkflowViewportUpsert] = Field(default_factory=list)


class WorkflowViewportListResponse(BaseModel):
    viewports: list[WorkflowViewportEntry]


class DocumentationMetadataResponse(BaseModel):
    slug: str
    title: str | None = None
    summary: str | None = None
    language: str | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class DocumentationResponse(DocumentationMetadataResponse):
    content_markdown: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentationCreateRequest(BaseModel):
    slug: str
    title: str | None = None
    summary: str | None = None
    language: str | None = Field(
        default=None,
        description=(
            "Code langue facultatif (BCP 47) comme 'en', 'fr' ou 'en-us'."
        ),
        min_length=2,
        max_length=32,
    )
    content_markdown: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentationUpdateRequest(BaseModel):
    title: str | None = None
    summary: str | None = None
    language: str | None = Field(
        default=None,
        description=(
            "Nouveau code langue (BCP 47) ou null pour réinitialiser la langue."
        ),
        min_length=2,
        max_length=32,
    )
    content_markdown: str | None = None
    metadata: dict[str, Any] | None = None
class WorkflowImportRequest(BaseModel):
    workflow_id: int | None = None
    slug: str | None = None
    display_name: str | None = None
    description: str | None = None
    version_name: str | None = None
    mark_as_active: bool | None = False
    graph: WorkflowGraphInput


class WidgetTemplateBase(BaseModel):
    slug: str
    title: str | None = None
    description: str | None = None
    definition: dict[str, Any]


class WidgetTemplateSummaryResponse(BaseModel):
    slug: str
    title: str | None = None
    description: str | None = None

    class Config:
        from_attributes = True


class WidgetTemplateResponse(WidgetTemplateBase):
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class WidgetTemplateCreateRequest(BaseModel):
    slug: str
    title: str | None = None
    description: str | None = None
    definition: dict[str, Any]


class WidgetTemplateUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    definition: dict[str, Any] | None = None


class WidgetPreviewRequest(BaseModel):
    definition: dict[str, Any]


class WidgetPreviewResponse(BaseModel):
    definition: dict[str, Any]


class VectorStoreCreateRequest(BaseModel):
    slug: str
    title: str | None = None
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class VectorStoreUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    metadata: dict[str, Any] | None = None


class VectorStoreResponse(BaseModel):
    slug: str
    title: str | None = None
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime.datetime
    updated_at: datetime.datetime
    documents_count: int = 0


class VectorStoreWorkflowBlueprint(BaseModel):
    slug: str
    display_name: str
    description: str | None = None
    graph: dict[str, Any]
    mark_active: bool = False


class VectorStoreDocumentIngestRequest(BaseModel):
    doc_id: str
    document: dict[str, Any]
    metadata: dict[str, Any] = Field(default_factory=dict)
    store_title: str | None = None
    store_metadata: dict[str, Any] | None = None


class VectorStoreDocumentResponse(BaseModel):
    doc_id: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    chunk_count: int
    created_at: datetime.datetime
    updated_at: datetime.datetime


class VectorStoreDocumentDetailResponse(VectorStoreDocumentResponse):
    document: dict[str, Any]


class VectorStoreSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=5, ge=1, le=50)
    metadata_filters: dict[str, Any] | None = None
    dense_weight: float = Field(default=0.5, ge=0.0)
    sparse_weight: float = Field(default=0.5, ge=0.0)


class VectorStoreSearchResult(BaseModel):
    doc_id: str
    chunk_index: int
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    document_metadata: dict[str, Any] = Field(default_factory=dict)
    dense_score: float
    bm25_score: float
    score: float
