from __future__ import annotations

import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field
from typing import Any, Literal


class SessionRequest(BaseModel):
    user: str | None = None


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
    name: str
    is_active: bool
    created_at: datetime.datetime
    updated_at: datetime.datetime
    steps: list[WorkflowStepResponse]
    graph: WorkflowGraphResponse

    class Config:
        from_attributes = True


class WorkflowDefinitionUpdate(BaseModel):
    graph: WorkflowGraphInput
