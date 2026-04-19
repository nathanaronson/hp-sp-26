import uuid
from typing import Final

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Allowed values for Deployment.status. Stored as plain strings.
DEPLOYMENT_STATUS_PENDING: Final = "pending"
DEPLOYMENT_STATUS_PROVISIONING: Final = "provisioning"
DEPLOYMENT_STATUS_ANALYZING: Final = "analyzing"
DEPLOYMENT_STATUS_BUILDING: Final = "building"
DEPLOYMENT_STATUS_EXPOSING: Final = "exposing"
DEPLOYMENT_STATUS_RUNNING: Final = "running"
DEPLOYMENT_STATUS_FAILED: Final = "failed"
DEPLOYMENT_STATUS_STOPPED: Final = "stopped"

DEPLOYMENT_STATUSES: Final = (
    DEPLOYMENT_STATUS_PENDING,
    DEPLOYMENT_STATUS_PROVISIONING,
    DEPLOYMENT_STATUS_ANALYZING,
    DEPLOYMENT_STATUS_BUILDING,
    DEPLOYMENT_STATUS_EXPOSING,
    DEPLOYMENT_STATUS_RUNNING,
    DEPLOYMENT_STATUS_FAILED,
    DEPLOYMENT_STATUS_STOPPED,
)

# AgentRun.kind
AGENT_KIND_ANALYZE: Final = "analyze"
AGENT_KIND_EXPOSE: Final = "expose"
AGENT_KINDS: Final = (AGENT_KIND_ANALYZE, AGENT_KIND_EXPOSE)

# AgentRun.status
AGENT_STATUS_PENDING: Final = "pending"
AGENT_STATUS_RUNNING: Final = "running"
AGENT_STATUS_SUCCEEDED: Final = "succeeded"
AGENT_STATUS_FAILED: Final = "failed"
AGENT_STATUSES: Final = (
    AGENT_STATUS_PENDING,
    AGENT_STATUS_RUNNING,
    AGENT_STATUS_SUCCEEDED,
    AGENT_STATUS_FAILED,
)


def _new_id() -> str:
    return uuid.uuid4().hex


class Deployment(Base):
    __tablename__ = "deployments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # One of these is provided by the client at creation time.
    github_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    upload_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    status: Mapped[str] = mapped_column(
        String(32),
        default=DEPLOYMENT_STATUS_PENDING,
        nullable=False,
    )

    # Modal sandbox object id (set during provisioning, used for teardown).
    sandbox_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Per-deployment model override. NULL → use deploy.DEFAULT_MODEL.
    # Format: "<provider>/<model-id>", e.g. "anthropic/claude-haiku-4-5".
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Filled in by Agent #1 once it inspects the code.
    runtime: Mapped[str | None] = mapped_column(String(32), nullable=True)
    package_manager: Mapped[str | None] = mapped_column(String(32), nullable=True)
    install_commands: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    build_commands: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    start_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_commands: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    # Legacy column kept for backwards-compat with existing API consumers.
    run_commands: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    env_required: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # Filled in by Agent #2 once ports are exposed.
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bound_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    health_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exposed_ports: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    public_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    backend_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    tunnel_urls: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    logs: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AgentRun(Base):
    """One execution of an agent (analyze or expose) against a deployment.

    Stores enough to reproduce / debug the run after the fact: the model used,
    the full transcript (list of {role, content} dicts mirroring the Anthropic
    Messages API), the parsed terminal report, and any error.
    """

    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    deployment_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("deployments.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16),
        default=AGENT_STATUS_PENDING,
        nullable=False,
    )
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Anthropic Messages API transcript (system prompt is stored separately).
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)

    # The parsed terminal report tool input (`report_install_plan`,
    # `report_port`, or `report_failure`). Type/shape depends on `kind`.
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    terminal_tool: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Bookkeeping.
    tool_call_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
