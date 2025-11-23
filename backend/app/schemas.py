from __future__ import annotations

import datetime
import math
from typing import Any, Literal

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    constr,
    field_validator,
    model_validator,
)


class SessionRequest(BaseModel):
    user: str | None = None
    hosted_workflow_slug: str | None = None


class VoiceSessionRequest(BaseModel):
    """Requête de création d'une session vocale Realtime."""

    model: str | None = Field(
        default=None,
        description="Modèle Realtime à utiliser (optionnel).",
    )
    model_provider_id: str | None = Field(
        default=None,
        description="Identifiant du fournisseur à utiliser (optionnel).",
    )
    model_provider_slug: str | None = Field(
        default=None,
        description="Slug du fournisseur à utiliser (optionnel).",
    )
    instructions: str | None = Field(
        default=None,
        description="Instructions transmises à l'agent vocal (optionnel).",
    )
    voice: str | None = Field(
        default=None,
        description="Identifiant de la voix souhaitée (optionnel).",
    )
    thread_id: str | None = Field(
        default=None,
        description=(
            "Identifiant du thread ChatKit pour persister les transcriptions "
            "(optionnel)."
        ),
    )


class VoiceSessionResponse(BaseModel):
    """Réponse renvoyée après création d'une session vocale Realtime."""

    client_secret: dict[str, Any] | str
    expires_at: str | None = None
    model: str
    model_provider_id: str | None = None
    model_provider_slug: str | None = None
    instructions: str
    voice: str
    prompt_id: str | None = None
    prompt_version: str | None = None
    prompt_variables: dict[str, str] = Field(default_factory=dict)


class RTCSessionDescription(BaseModel):
    type: Literal["offer", "answer"]
    sdp: str


class VoiceWebRTCOfferRequest(VoiceSessionRequest):
    offer: RTCSessionDescription


class VoiceWebRTCOfferResponse(BaseModel):
    session_id: str
    answer: RTCSessionDescription
    expires_at: str | None = None


class VoiceWebRTCTeardownRequest(BaseModel):
    session_id: str


class VoiceWebRTCTranscript(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    text: str
    status: Literal["completed", "in_progress", "incomplete"] = "completed"


class VoiceWebRTCTeardownResponse(BaseModel):
    session_id: str
    closed: bool
    transcripts: list[VoiceWebRTCTranscript] = Field(default_factory=list)
    error: str | None = None
    stats: dict[str, float | int] = Field(default_factory=dict)


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
    provider_id: str | None = None
    provider_slug: str | None = None
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
    provider_id: str | None = Field(
        default=None,
        description="Identifiant du fournisseur Realtime (optionnel).",
    )
    provider_slug: str | None = Field(
        default=None,
        description="Slug du fournisseur Realtime (optionnel).",
    )
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


class ModelProviderSettings(BaseModel):
    id: str
    provider: str
    api_base: str | None
    api_key_hint: str | None = None
    has_api_key: bool = False
    is_default: bool = False


class ModelProviderSettingsUpdate(BaseModel):
    id: str | None = Field(
        default=None,
        description=(
            "Identifiant interne de la configuration (laisser vide pour une "
            "nouvelle entrée)."
        ),
        max_length=128,
    )
    provider: constr(strip_whitespace=True, min_length=1, max_length=64)
    api_base: str | None = Field(
        default=None,
        description=(
            "URL de base de l'API (optionnel). Pour LiteLLM avec auto-routing, "
            "laissez vide. Pour un serveur personnalisé, entrez l'URL complète."
        ),
        max_length=512,
    )
    api_key: str | None = Field(
        default=None,
        description=(
            "Clé API à associer à ce fournisseur (laisser vide pour conserver "
            "la valeur existante)."
        ),
        max_length=512,
    )
    delete_api_key: bool = Field(
        default=False,
        description="Indique s'il faut supprimer la clé API enregistrée.",
    )
    is_default: bool = Field(
        default=False,
        description="Marque cette configuration comme fournisseur par défaut.",
    )

    @field_validator("api_base", mode="before")
    @classmethod
    def normalize_api_base(cls, v: Any) -> str | None:
        """Convert empty strings to None for optional api_base."""
        if isinstance(v, str):
            stripped = v.strip()
            if not stripped:
                return None
            return stripped
        return v


class AppearanceSettingsResponse(BaseModel):
    color_scheme: Literal["system", "light", "dark"]
    radius_style: Literal["pill", "round", "soft", "sharp"]
    accent_color: constr(pattern=r"^#[0-9a-fA-F]{6}$")
    use_custom_surface_colors: bool
    surface_hue: float
    surface_tint: float
    surface_shade: float
    heading_font: str
    body_font: str
    start_screen_greeting: str
    start_screen_prompt: str
    start_screen_placeholder: str
    start_screen_disclaimer: str
    created_at: datetime.datetime | None = None
    updated_at: datetime.datetime | None = None


class AppearanceSettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    color_scheme: Literal["system", "light", "dark"] | None = Field(
        default=None,
        description="Mode de couleur à appliquer (system, light ou dark).",
    )
    radius_style: Literal["pill", "round", "soft", "sharp"] | None = Field(
        default=None,
        description="Style d'arrondi des coins pour l'interface.",
    )
    accent_color: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = Field(
        default=None,
        description="Couleur d'accentuation au format hexadécimal (#RRGGBB).",
    )
    use_custom_surface_colors: bool | None = Field(
        default=None,
        description="Active les couleurs de surface personnalisées.",
    )
    surface_hue: float | None = Field(
        default=None,
        ge=0.0,
        le=360.0,
        description="Teinte HSL pour les surfaces personnalisées (0-360).",
    )
    surface_tint: float | None = Field(
        default=None,
        ge=0.0,
        le=100.0,
        description="Luminosité claire pour les surfaces personnalisées (0-100).",
    )
    surface_shade: float | None = Field(
        default=None,
        ge=0.0,
        le=100.0,
        description="Luminosité sombre pour les surfaces personnalisées (0-100).",
    )
    heading_font: (
        constr(strip_whitespace=True, min_length=1, max_length=256) | None
    ) = Field(
        default=None,
        description="Pile de polices à utiliser pour les titres.",
    )
    body_font: (
        constr(strip_whitespace=True, min_length=1, max_length=256) | None
    ) = Field(
        default=None,
        description="Pile de polices à utiliser pour le texte principal.",
    )
    start_screen_greeting: constr(max_length=4000) | None = Field(
        default=None,
        description="Message d'accueil affiché sur l'écran de démarrage.",
    )
    start_screen_prompt: constr(max_length=4000) | None = Field(
        default=None,
        description="Phrase d'accroche affichée sur l'écran de démarrage.",
    )
    start_screen_placeholder: constr(max_length=4000) | None = Field(
        default=None,
        description="Placeholder du champ de saisie principal.",
    )
    start_screen_disclaimer: constr(max_length=4000) | None = Field(
        default=None,
        description="Avertissement facultatif pour l'écran de démarrage.",
    )


class WorkflowAppearanceOverride(BaseModel):
    color_scheme: Literal["system", "light", "dark"] | None = None
    accent_color: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    use_custom_surface_colors: bool | None = None
    surface_hue: float | None = None
    surface_tint: float | None = None
    surface_shade: float | None = None
    heading_font: str | None = None
    body_font: str | None = None
    start_screen_greeting: str | None = None
    start_screen_prompt: str | None = None
    start_screen_placeholder: str | None = None
    start_screen_disclaimer: str | None = None
    created_at: datetime.datetime | None = None
    updated_at: datetime.datetime | None = None


class WorkflowAppearanceResponse(BaseModel):
    target_kind: Literal["local", "hosted"]
    workflow_id: int | None = None
    workflow_slug: str
    label: str
    remote_workflow_id: str | None = None
    override: WorkflowAppearanceOverride | None = None
    effective: AppearanceSettingsResponse
    inherited_from_global: bool


class WorkflowAppearanceUpdateRequest(AppearanceSettingsUpdateRequest):
    inherit_from_global: bool | None = Field(default=None)


class AppSettingsResponse(BaseModel):
    thread_title_prompt: str
    default_thread_title_prompt: str
    is_custom_thread_title_prompt: bool
    thread_title_model: str
    default_thread_title_model: str
    is_custom_thread_title_model: bool
    model_provider: str
    model_api_base: str | None
    is_model_provider_overridden: bool
    is_model_api_base_overridden: bool
    is_model_api_key_managed: bool
    model_api_key_hint: str | None = None
    model_providers: list[ModelProviderSettings] = Field(default_factory=list)
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
    thread_title_model: str | None = Field(
        default=None,
        description=(
            "Modèle personnalisé pour générer les titres de fil. Laisser vide pour "
            "revenir à la valeur par défaut."
        ),
        max_length=128,
    )
    model_provider: str | None = Field(
        default=None,
        description=(
            "Identifiant du fournisseur de modèles à utiliser. Laisser vide pour "
            "conserver la configuration d'environnement."
        ),
        max_length=64,
    )
    model_api_base: str | None = Field(
        default=None,
        description=(
            "URL de base de l'API du fournisseur. Requis si un fournisseur "
            "personnalisé est défini."
        ),
        max_length=512,
    )
    model_api_key: str | None = Field(
        default=None,
        description=(
            "Nouvelle clé API à stocker pour le fournisseur sélectionné. "
            "Envoyer null pour effacer la clé enregistrée."
        ),
        max_length=512,
    )
    model_providers: list[ModelProviderSettingsUpdate] | None = Field(
        default=None,
        description=(
            "Liste complète des fournisseurs disponibles. Passer une liste vide pour"
            " tout supprimer."
        ),
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
    email: str  # Changed from EmailStr to allow LTI synthetic emails like user@lti.local
    is_admin: bool
    is_lti: bool
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


class LTIRegistrationBase(BaseModel):
    issuer: constr(strip_whitespace=True, min_length=1, max_length=512)
    client_id: constr(strip_whitespace=True, min_length=1, max_length=255)
    key_set_url: AnyHttpUrl
    authorization_endpoint: AnyHttpUrl
    token_endpoint: AnyHttpUrl
    deep_link_return_url: AnyHttpUrl | None = None
    audience: constr(strip_whitespace=True, max_length=512) | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("deep_link_return_url", mode="before")
    @classmethod
    def _normalize_optional_url(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            candidate = value.strip()
            return candidate or None
        return value

    @field_validator("audience", mode="before")
    @classmethod
    def _normalize_optional(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            candidate = value.strip()
            return candidate or None
        return value


class LTIRegistrationCreateRequest(LTIRegistrationBase):
    pass


class LTIRegistrationUpdateRequest(BaseModel):
    issuer: constr(strip_whitespace=True, min_length=1, max_length=512) | None = None
    client_id: constr(strip_whitespace=True, min_length=1, max_length=255) | None = None
    key_set_url: AnyHttpUrl | None = None
    authorization_endpoint: AnyHttpUrl | None = None
    token_endpoint: AnyHttpUrl | None = None
    deep_link_return_url: AnyHttpUrl | None = None
    audience: constr(strip_whitespace=True, max_length=512) | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator(
        "issuer",
        "client_id",
        "audience",
        mode="before",
    )
    @classmethod
    def _normalize_optional(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            candidate = value.strip()
            return candidate or None
        return value

    @field_validator(
        "key_set_url",
        "authorization_endpoint",
        "token_endpoint",
        "deep_link_return_url",
        mode="before",
    )
    @classmethod
    def _normalize_optional_url(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            candidate = value.strip()
            return candidate or None
        return value


class LTIRegistrationResponse(LTIRegistrationBase):
    id: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = ConfigDict(from_attributes=True)


class LtiToolSettingsResponse(BaseModel):
    client_id: str | None
    key_set_url: str | None
    audience: str | None
    key_id: str | None
    has_private_key: bool
    private_key_hint: str | None
    private_key_path: str | None = None
    public_key_path: str | None = None
    public_key_pem: str | None = None
    public_key_last_updated_at: datetime.datetime | None = None
    is_client_id_overridden: bool
    is_key_set_url_overridden: bool
    is_audience_overridden: bool
    is_key_id_overridden: bool
    is_private_key_overridden: bool
    created_at: datetime.datetime | None = None
    updated_at: datetime.datetime | None = None


class LtiToolSettingsUpdateRequest(BaseModel):
    client_id: constr(strip_whitespace=True, min_length=1, max_length=255) | None = None
    key_set_url: AnyHttpUrl | None = None
    audience: constr(strip_whitespace=True, min_length=1, max_length=512) | None = None
    key_id: constr(strip_whitespace=True, min_length=1, max_length=255) | None = None
    private_key: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator(
        "client_id",
        "audience",
        "key_id",
        mode="before",
    )
    @classmethod
    def _normalize_optional(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            candidate = value.strip()
            return candidate or None
        return value

    @field_validator("key_set_url", mode="before")
    @classmethod
    def _normalize_optional_url(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            candidate = value.strip()
            return candidate or None
        return value

    @field_validator("private_key", mode="before")
    @classmethod
    def _normalize_private_key(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            candidate = value.strip()
            return candidate or None
        return value


class SipAccountBase(BaseModel):
    label: constr(strip_whitespace=True, min_length=1, max_length=128)
    trunk_uri: constr(strip_whitespace=True, min_length=1)
    username: constr(strip_whitespace=True, max_length=128) | None = None
    password: str | None = None
    contact_host: constr(strip_whitespace=True, max_length=255) | None = None
    contact_port: int | None = Field(default=None, ge=1, le=65535)
    contact_transport: Literal["udp", "tcp", "tls"] | None = "udp"
    is_default: bool = False
    is_active: bool = True

    @field_validator("trunk_uri")
    @classmethod
    def validate_sip_uri(cls, v: str) -> str:
        """Valide que l'URI SIP est au bon format."""
        v = v.strip()
        if not v:
            raise ValueError("L'URI SIP ne peut pas être vide")

        # Vérifier que l'URI commence par sip: ou sips:
        if not (v.lower().startswith("sip:") or v.lower().startswith("sips:")):
            raise ValueError(
                "L'URI SIP doit commencer par 'sip:' ou 'sips:'. "
                f"Exemple: sip:username@provider.com (reçu: {v})"
            )

        # Vérifier qu'il y a un @ dans l'URI (format user@host requis)
        if "@" not in v:
            raise ValueError(
                "L'URI SIP doit contenir un '@'. "
                f"Format attendu: sip:username@provider.com (reçu: {v})"
            )

        return v


class SipAccountCreateRequest(SipAccountBase):
    pass


class SipAccountUpdateRequest(BaseModel):
    label: constr(strip_whitespace=True, min_length=1, max_length=128) | None = None
    trunk_uri: constr(strip_whitespace=True, min_length=1) | None = None
    username: constr(strip_whitespace=True, max_length=128) | None = None
    password: str | None = None
    contact_host: constr(strip_whitespace=True, max_length=255) | None = None
    contact_port: int | None = Field(default=None, ge=1, le=65535)
    contact_transport: Literal["udp", "tcp", "tls"] | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class SipAccountResponse(SipAccountBase):
    id: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = ConfigDict(from_attributes=True)


class McpServerBase(BaseModel):
    label: constr(strip_whitespace=True, min_length=1, max_length=128)
    server_url: AnyHttpUrl
    transport: Literal["http_sse"] | None = "http_sse"
    is_active: bool = True
    oauth_client_id: (
        constr(strip_whitespace=True, min_length=1, max_length=255) | None
    ) = None
    oauth_scope: constr(strip_whitespace=True, min_length=1) | None = None
    oauth_authorization_endpoint: AnyHttpUrl | None = None
    oauth_token_endpoint: AnyHttpUrl | None = None
    oauth_redirect_uri: AnyHttpUrl | None = None
    oauth_metadata: dict[str, Any] | None = None

    @field_validator("server_url", mode="before")
    @classmethod
    def _normalize_server_url(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("transport", mode="before")
    @classmethod
    def _normalize_transport(
        cls, value: str | None
    ) -> Literal["http_sse"] | None:
        if value is None:
            return "http_sse"
        candidate = value.strip().lower()
        if candidate in {"http_sse", "sse"}:
            return "http_sse"
        raise ValueError("Le transport MCP supporté est 'http_sse'.")

    @field_validator(
        "oauth_client_id",
        "oauth_scope",
    )
    @classmethod
    def _normalize_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        return candidate or None

    @field_validator(
        "oauth_authorization_endpoint",
        "oauth_token_endpoint",
        "oauth_redirect_uri",
        mode="before",
    )
    @classmethod
    def _normalize_optional_url(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    model_config = ConfigDict(extra="forbid")


class McpServerCreateRequest(McpServerBase):
    authorization: constr(strip_whitespace=True, min_length=1) | None = None
    access_token: constr(strip_whitespace=True, min_length=1) | None = None
    refresh_token: constr(strip_whitespace=True, min_length=1) | None = None
    oauth_client_secret: constr(strip_whitespace=True, min_length=1) | None = None
    refresh_tools: bool = True


class McpServerUpdateRequest(BaseModel):
    label: constr(strip_whitespace=True, min_length=1, max_length=128) | None = None
    server_url: AnyHttpUrl | None = None
    transport: Literal["http_sse"] | None = None
    is_active: bool | None = None
    authorization: constr(strip_whitespace=True, min_length=1) | None = None
    access_token: constr(strip_whitespace=True, min_length=1) | None = None
    refresh_token: constr(strip_whitespace=True, min_length=1) | None = None
    oauth_client_id: (
        constr(strip_whitespace=True, min_length=1, max_length=255) | None
    ) = None
    oauth_client_secret: constr(strip_whitespace=True, min_length=1) | None = None
    oauth_scope: constr(strip_whitespace=True, min_length=1) | None = None
    oauth_authorization_endpoint: AnyHttpUrl | None = None
    oauth_token_endpoint: AnyHttpUrl | None = None
    oauth_redirect_uri: AnyHttpUrl | None = None
    oauth_metadata: dict[str, Any] | None = None
    refresh_tools: bool | None = None

    model_config = ConfigDict(extra="forbid")


class McpServerResponse(McpServerBase):
    id: int
    authorization_hint: str | None = None
    access_token_hint: str | None = None
    refresh_token_hint: str | None = None
    oauth_client_secret_hint: str | None = None
    tools_cache: dict[str, Any] | None = None
    tools_cache_updated_at: datetime.datetime | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = ConfigDict(from_attributes=True)


class McpServerPublicResponse(BaseModel):
    id: int
    label: str
    server_url: str
    transport: str | None = None
    is_active: bool
    tools_cache: dict[str, Any] | None = None
    tools_cache_updated_at: datetime.datetime | None = None
    has_authorization: bool
    has_access_token: bool
    has_refresh_token: bool
    has_oauth_client_secret: bool

    model_config = ConfigDict(from_attributes=True)


class AvailableModelBase(BaseModel):
    name: constr(strip_whitespace=True, min_length=1, max_length=128)
    display_name: constr(strip_whitespace=True, min_length=1, max_length=128) | None = (
        None
    )
    description: constr(strip_whitespace=True, min_length=1, max_length=512) | None = (
        None
    )
    provider_id: constr(strip_whitespace=True, min_length=1, max_length=128) | None = (
        None
    )
    provider_slug: constr(strip_whitespace=True, min_length=1, max_length=64) | None = (
        None
    )
    supports_reasoning: bool = False

    @field_validator("provider_id")
    @classmethod
    def _normalize_provider_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            raise ValueError("provider_id ne peut pas être vide")
        return candidate

    @field_validator("provider_slug")
    @classmethod
    def _normalize_provider_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            raise ValueError("provider_slug ne peut pas être vide")
        return candidate.lower()

    @model_validator(mode="after")
    def _ensure_provider_pair(self) -> AvailableModelBase:
        has_id = self.provider_id is not None
        has_slug = self.provider_slug is not None
        if has_id and not has_slug:
            raise ValueError(
                "provider_slug doit être fourni lorsque provider_id est défini"
            )
        return self


class AvailableModelCreateRequest(AvailableModelBase):
    pass


class AvailableModelUpdateRequest(BaseModel):
    name: constr(strip_whitespace=True, min_length=1, max_length=128) | None = None
    display_name: (
        constr(strip_whitespace=True, min_length=1, max_length=128) | None
    ) = None
    description: (
        constr(strip_whitespace=True, min_length=1, max_length=512) | None
    ) = None
    provider_id: (
        constr(strip_whitespace=True, min_length=1, max_length=128) | None
    ) = None
    provider_slug: (
        constr(strip_whitespace=True, min_length=1, max_length=64) | None
    ) = None
    supports_reasoning: bool | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("provider_id")
    @classmethod
    def _normalize_provider_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            raise ValueError("provider_id ne peut pas être vide")
        return candidate

    @field_validator("provider_slug")
    @classmethod
    def _normalize_provider_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            raise ValueError("provider_slug ne peut pas être vide")
        return candidate.lower()


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
    "while",
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
    parent_slug: str | None = None
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
    lti_enabled: bool
    lti_registration_ids: list[int] = Field(default_factory=list)
    lti_show_sidebar: bool = True
    lti_show_header: bool = True
    lti_enable_history: bool = True
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
    lti_enabled: bool | None = None
    lti_registration_ids: list[int] | None = None
    lti_show_sidebar: bool | None = None
    lti_show_header: bool | None = None
    lti_enable_history: bool | None = None


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


class WorkflowDuplicateRequest(BaseModel):
    display_name: str


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
    chunks_per_document: int | None = Field(
        default=None,
        ge=1,
        le=50,
        description=(
            "Nombre maximum de chunks renvoyés par document lors de la"
            " recherche agrégée."
        ),
    )


class VectorStoreSearchResult(BaseModel):
    doc_id: str
    chunk_index: int
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    document_metadata: dict[str, Any] = Field(default_factory=dict)
    dense_score: float
    bm25_score: float
    score: float


class VectorStoreDocumentSearchResult(BaseModel):
    doc_id: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)
    matches: list[VectorStoreSearchResult] = Field(default_factory=list)


# ============================================================================
# Workflow Monitoring (Admin)
# ============================================================================


class WorkflowStepInfo(BaseModel):
    """Information sur une étape du workflow."""

    slug: str
    display_name: str
    timestamp: str | None = None


class WorkflowUserInfo(BaseModel):
    """Information sur un utilisateur."""

    id: int
    email: str
    is_admin: bool


class WorkflowInfo(BaseModel):
    """Information sur un workflow."""

    id: int
    slug: str
    display_name: str
    definition_id: int | None = None


class ActiveWorkflowSession(BaseModel):
    """Session de workflow active pour un utilisateur."""

    thread_id: str
    user: WorkflowUserInfo
    workflow: WorkflowInfo
    current_step: WorkflowStepInfo
    step_history: list[WorkflowStepInfo]
    started_at: str
    last_activity: str
    status: Literal["active", "waiting_user", "paused"]


class ActiveWorkflowSessionsResponse(BaseModel):
    """Liste des sessions de workflow actives."""

    sessions: list[ActiveWorkflowSession]
    total_count: int
