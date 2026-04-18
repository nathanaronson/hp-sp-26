from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DeploymentCreate(BaseModel):
    """Request body for creating a deployment.

    Provide either a `github_url` or an `upload_id` returned from the upload endpoint.
    """

    name: str | None = None
    github_url: str | None = Field(default=None, description="https://github.com/owner/repo[.git]")
    upload_id: str | None = Field(default=None, description="ID returned from POST /upload")

    @model_validator(mode="after")
    def _require_source(self) -> "DeploymentCreate":
        if not self.github_url and not self.upload_id:
            raise ValueError("Either github_url or upload_id must be provided")
        return self


class DeploymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str | None
    github_url: str | None
    upload_id: str | None
    status: str
    run_commands: list[str] | None
    env_required: list[str] | None
    exposed_ports: list[int] | None
    public_url: str | None
    error: str | None
    created_at: datetime
    updated_at: datetime


class DeploymentList(BaseModel):
    items: list[DeploymentRead]
    total: int


class UploadResponse(BaseModel):
    upload_id: str
    filename: str
    size: int
