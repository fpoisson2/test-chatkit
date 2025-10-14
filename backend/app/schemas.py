from __future__ import annotations

import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, constr
from typing import Any, Literal


class SessionRequest(BaseModel):
    user: str | None = None


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
    instructions: str | None = Field(default=None, description="Instructions vocales personnalisées.")
    model: str | None = Field(default=None, description="Modèle Realtime à utiliser.")
    voice: str | None = Field(default=None, description="Identifiant de la voix Realtime.")
    prompt_id: str | None = Field(default=None, description="Identifiant du prompt stocké côté serveur.")
    prompt_version: str | None = Field(default=None, description="Version optionnelle du prompt.")
    prompt_variables: dict[str, str] | None = Field(
        default=None,
        description="Variables injectées lors de la résolution du prompt.",
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


class AvailableModelBase(BaseModel):
    name: constr(strip_whitespace=True, min_length=1, max_length=128)
    display_name: constr(strip_whitespace=True, min_length=1, max_length=128) | None = None
    description: constr(strip_whitespace=True, min_length=1, max_length=512) | None = None
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


class WorkflowNodeBase(BaseModel):
    slug: str
    kind: Literal["start", "agent", "condition", "state", "end"]
    display_name: str | None = None
    agent_key: str | None = None
    is_enabled: bool = True
    parameters: dict[str, Any] = Field(default_factory=dict)
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
    parameters: dict[str, Any]
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


class WorkflowVersionCreateRequest(BaseModel):
    graph: WorkflowGraphInput
    name: str | None = None
    mark_as_active: bool = False


class WorkflowProductionUpdate(BaseModel):
    version_id: int



class WorkflowChatKitUpdate(BaseModel):
    workflow_id: int


class WidgetTemplateBase(BaseModel):
    slug: str
    title: str | None = None
    description: str | None = None
    definition: dict[str, Any]


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
