from __future__ import annotations

import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .config import DEFAULT_THREAD_TITLE_MODEL

# Dimension pour text-embedding-3-small d'OpenAI
EMBEDDING_DIMENSION = 1536


class Base(DeclarativeBase):
    pass


class PortableJSONB(TypeDecorator):
    """Type JSONB utilisable avec SQLite en tests."""

    impl = JSONB
    cache_ok = True

    def load_dialect_impl(self, dialect):  # type: ignore[override]
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB(astext_type=Text()))
        return dialect.type_descriptor(JSON())


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(
        String(320), unique=True, nullable=False, index=True
    )
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    payload: Mapped[dict[str, Any]] = mapped_column(PortableJSONB(), nullable=False)


class ChatThreadItem(Base):
    __tablename__ = "chat_thread_items"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    thread_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("chat_threads.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    owner_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    payload: Mapped[dict[str, Any]] = mapped_column(PortableJSONB(), nullable=False)


class ChatAttachment(Base):
    __tablename__ = "chat_attachments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    payload: Mapped[dict[str, Any]] = mapped_column(PortableJSONB(), nullable=False)


class AvailableModel(Base):
    __tablename__ = "available_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    provider_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_slug: Mapped[str | None] = mapped_column(String(64), nullable=True)
    store: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    supports_reasoning: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    supports_previous_response_id: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    supports_reasoning_summary: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


class VoiceSettings(Base):
    __tablename__ = "voice_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instructions: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_slug: Mapped[str | None] = mapped_column(String(64), nullable=True)
    voice: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prompt_variables: Mapped[dict[str, Any]] = mapped_column(
        PortableJSONB(), nullable=False, default=dict
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


class TelephonyRoute(Base):
    __tablename__ = "telephony_routes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    phone_number: Mapped[str] = mapped_column(
        String(32), unique=True, nullable=False, index=True
    )
    workflow_slug: Mapped[str] = mapped_column(String(128), nullable=False)
    workflow_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", PortableJSONB(), nullable=False, default=dict
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    thread_title_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    thread_title_model: Mapped[str] = mapped_column(
        String(128), nullable=False, default=DEFAULT_THREAD_TITLE_MODEL
    )
    sip_trunk_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    sip_trunk_username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sip_trunk_password: Mapped[str | None] = mapped_column(String(256), nullable=True)
    sip_contact_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sip_contact_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sip_contact_transport: Mapped[str | None] = mapped_column(String(16), nullable=True)
    model_provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model_api_base: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_api_key_hint: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model_provider_configs: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


class SipAccount(Base):
    """Compte SIP pour la téléphonie.

    Permet de gérer plusieurs comptes SIP et de les associer à différents workflows.
    """

    __tablename__ = "sip_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    trunk_uri: Mapped[str] = mapped_column(Text, nullable=False)
    username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    password: Mapped[str | None] = mapped_column(String(256), nullable=True)
    contact_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    contact_transport: Mapped[str | None] = mapped_column(
        String(16), nullable=True, default="udp"
    )
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


class HostedWorkflow(Base):
    __tablename__ = "hosted_workflows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False, index=True
    )
    remote_workflow_id: Mapped[str] = mapped_column(String(128), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


class Workflow(Base):
    __tablename__ = "workflows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    active_version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("workflow_definitions.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_chatkit_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )

    versions: Mapped[list[WorkflowDefinition]] = relationship(
        "WorkflowDefinition",
        back_populates="workflow",
        cascade="all, delete-orphan",
        order_by=lambda: WorkflowDefinition.version.desc(),
        foreign_keys="WorkflowDefinition.workflow_id",
    )
    active_version: Mapped[WorkflowDefinition | None] = relationship(
        "WorkflowDefinition",
        primaryjoin="Workflow.active_version_id==WorkflowDefinition.id",
        foreign_keys="Workflow.active_version_id",
        viewonly=True,
    )


class WorkflowDefinition(Base):
    __tablename__ = "workflow_definitions"
    __table_args__ = (
        UniqueConstraint(
            "workflow_id",
            "version",
            name="workflow_definitions_workflow_version",
        ),
        UniqueConstraint(
            "workflow_id",
            "name",
            name="workflow_definitions_workflow_name",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workflow_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("workflows.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sip_account_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("sip_accounts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )
    workflow: Mapped[Workflow] = relationship(
        "Workflow",
        back_populates="versions",
        foreign_keys=[workflow_id],
    )
    sip_account: Mapped[SipAccount | None] = relationship(
        "SipAccount",
        foreign_keys=[sip_account_id],
    )

    steps: Mapped[list[WorkflowStep]] = relationship(
        "WorkflowStep",
        back_populates="definition",
        cascade="all, delete-orphan",
        order_by="WorkflowStep.position",
    )
    transitions: Mapped[list[WorkflowTransition]] = relationship(
        "WorkflowTransition",
        back_populates="definition",
        cascade="all, delete-orphan",
        order_by="WorkflowTransition.id",
    )


class WorkflowStep(Base):
    __tablename__ = "workflow_steps"
    __table_args__ = (
        UniqueConstraint(
            "definition_id", "slug", name="workflow_steps_definition_slug"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    definition_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("workflow_definitions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="agent")
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    agent_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    parameters: Mapped[dict[str, Any]] = mapped_column(
        PortableJSONB(), nullable=False, default=dict
    )
    ui_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", PortableJSONB(), nullable=False, default=dict
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )

    definition: Mapped[WorkflowDefinition] = relationship(
        "WorkflowDefinition", back_populates="steps"
    )
    outgoing_transitions: Mapped[list[WorkflowTransition]] = relationship(
        "WorkflowTransition",
        foreign_keys="WorkflowTransition.source_step_id",
        back_populates="source_step",
        cascade="all, delete-orphan",
    )
    incoming_transitions: Mapped[list[WorkflowTransition]] = relationship(
        "WorkflowTransition",
        foreign_keys="WorkflowTransition.target_step_id",
        back_populates="target_step",
    )


class WorkflowTransition(Base):
    __tablename__ = "workflow_transitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    definition_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("workflow_definitions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_step_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("workflow_steps.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_step_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("workflow_steps.id", ondelete="CASCADE"),
        nullable=False,
    )
    condition: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ui_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", PortableJSONB(), nullable=False, default=dict
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )

    definition: Mapped[WorkflowDefinition] = relationship(
        "WorkflowDefinition", back_populates="transitions"
    )
    source_step: Mapped[WorkflowStep] = relationship(
        "WorkflowStep",
        foreign_keys=[source_step_id],
        back_populates="outgoing_transitions",
    )
    target_step: Mapped[WorkflowStep] = relationship(
        "WorkflowStep",
        foreign_keys=[target_step_id],
        back_populates="incoming_transitions",
    )


class WorkflowViewport(Base):
    __tablename__ = "workflow_viewports"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "workflow_id",
            "version_id",
            "device_type",
            name="workflow_viewports_user_workflow_version_device",
        ),
        Index("ix_workflow_viewports_user_workflow", "user_id", "workflow_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workflow_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("workflows.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("workflow_definitions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    device_type: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="desktop",
    )
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    zoom: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


class JsonVectorStore(Base):
    __tablename__ = "json_vector_stores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True, index=True
    )
    title: Mapped[str | None] = mapped_column(String(256), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(
        "metadata", PortableJSONB(), nullable=False, default=dict
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )

    documents: Mapped[list[JsonDocument]] = relationship(
        "JsonDocument",
        back_populates="store",
        cascade="all, delete-orphan",
        order_by="JsonDocument.id",
    )


class JsonDocument(Base):
    __tablename__ = "json_documents"
    __table_args__ = (
        UniqueConstraint("store_id", "doc_id", name="json_documents_store_doc"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("json_vector_stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    doc_id: Mapped[str] = mapped_column(String(255), nullable=False)
    raw_document: Mapped[dict[str, Any]] = mapped_column(
        "raw_json", PortableJSONB(), nullable=False
    )
    linearized_text: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(
        "metadata", PortableJSONB(), nullable=False, default=dict
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )

    store: Mapped[JsonVectorStore] = relationship(
        "JsonVectorStore", back_populates="documents"
    )
    chunks: Mapped[list[JsonChunk]] = relationship(
        "JsonChunk",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="JsonChunk.chunk_index",
    )


class JsonChunk(Base):
    __tablename__ = "json_chunks"
    __table_args__ = (
        UniqueConstraint(
            "document_id", "chunk_index", name="json_chunks_document_chunk"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("json_vector_stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_id: Mapped[int] = mapped_column(
        ForeignKey("json_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    doc_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_chunk: Mapped[dict[str, Any]] = mapped_column(
        "raw_json", PortableJSONB(), nullable=False
    )
    linearized_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(
        Vector(EMBEDDING_DIMENSION), nullable=False
    )
    metadata_json: Mapped[dict[str, Any]] = mapped_column(
        "metadata", PortableJSONB(), nullable=False, default=dict
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )

    store: Mapped[JsonVectorStore] = relationship("JsonVectorStore")
    document: Mapped[JsonDocument] = relationship(
        "JsonDocument", back_populates="chunks"
    )


class OutboundCall(Base):
    """Enregistrement d'un appel sortant."""

    __tablename__ = "outbound_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    call_sid: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )

    # Configuration de l'appel
    to_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    from_number: Mapped[str] = mapped_column(String(32), nullable=False)
    workflow_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("workflow_definitions.id"), nullable=False
    )
    sip_account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sip_accounts.id"), nullable=False
    )

    # Workflow context (quel workflow a déclenché cet appel)
    triggered_by_workflow_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("workflow_definitions.id"), nullable=True
    )
    triggered_by_session_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    trigger_node_slug: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # États
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="queued", index=True
    )

    # Timestamps
    queued_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.UTC),
    )
    initiated_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    answered_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Métriques
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    conversation_duration: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Erreurs
    failure_reason: Mapped[str | None] = mapped_column(String(256), nullable=True)
    sip_response_code: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Metadata
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", PortableJSONB(), nullable=False, default=dict
    )

    # Relations
    workflow: Mapped[WorkflowDefinition] = relationship(
        "WorkflowDefinition", foreign_keys=[workflow_id]
    )
    sip_account: Mapped[SipAccount] = relationship("SipAccount")


Index("ix_json_documents_metadata", JsonDocument.metadata_json, postgresql_using="gin")
Index("ix_json_chunks_metadata", JsonChunk.metadata_json, postgresql_using="gin")
Index(
    "ix_json_chunks_store_doc",
    JsonChunk.store_id,
    JsonChunk.doc_id,
)
