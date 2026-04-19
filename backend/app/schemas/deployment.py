from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator


def _utc_isoformat(value: datetime) -> str:
    dt = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return dt.isoformat().replace("+00:00", "Z")


class UTCReadModel(BaseModel):
    @field_serializer("created_at", "updated_at", when_used="json", check_fields=False)
    def _serialize_dt(self, value: datetime) -> str:
        return _utc_isoformat(value)


class DeploymentCreate(BaseModel):
    """Request body for creating a deployment.

    Provide either a `github_url` or an `upload_id` returned from the upload endpoint.
    """

    name: str | None = None
    github_url: str | None = Field(default=None, description="https://github.com/owner/repo[.git]")
    upload_id: str | None = Field(default=None, description="ID returned from POST /upload")
    model: str | None = Field(
        default=None,
        description=(
            "Override the LLM the deployment agents use. "
            "Format: '<provider>/<model-id>'. "
            "If null, uses the backend default (currently claude-haiku-4-5)."
        ),
    )

    @model_validator(mode="after")
    def _require_source(self) -> "DeploymentCreate":
        if not self.github_url and not self.upload_id:
            raise ValueError("Either github_url or upload_id must be provided")
        return self


class DeploymentUpdate(BaseModel):
    """Request body for updating a deployment (partial)."""

    name: str | None = None


class AgentRunRead(UTCReadModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    deployment_id: str
    kind: str
    status: str
    model: str | None
    terminal_tool: str | None
    result: dict[str, Any] | None
    tool_call_count: int
    input_tokens: int | None
    output_tokens: int | None
    error: str | None
    created_at: datetime
    updated_at: datetime


class AgentRunDetail(AgentRunRead):
    """Includes the full transcript — heavier payload."""

    system_prompt: str | None
    transcript: list[dict[str, Any]] | None


class DeploymentRead(UTCReadModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str | None
    github_url: str | None
    upload_id: str | None
    status: str
    sandbox_id: str | None
    model: str | None
    kind: str
    entrypoint: list[str] | None
    runtime: str | None
    package_manager: str | None
    install_commands: list[str] | None
    build_commands: list[str] | None
    start_command: str | None
    start_commands: list[dict] | None
    run_commands: list[str] | None
    env_required: list[str] | None
    port: int | None
    bound_address: str | None
    health_path: str | None
    http_status: int | None
    exposed_ports: list[int] | None
    public_url: str | None
    backend_url: str | None
    tunnel_urls: dict[str, str] | None
    logs: str | None
    error: str | None
    created_at: datetime
    updated_at: datetime


class DeploymentDetail(DeploymentRead):
    agent_runs: list[AgentRunRead] = []


class DeploymentList(BaseModel):
    items: list[DeploymentRead]
    total: int


class UploadResponse(BaseModel):
    upload_id: str
    filename: str
    size: int
