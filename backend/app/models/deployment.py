import uuid
from typing import Final

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Allowed values for Deployment.status. Stored as plain strings.
DEPLOYMENT_STATUS_PENDING: Final = "pending"
DEPLOYMENT_STATUS_ANALYZING: Final = "analyzing"
DEPLOYMENT_STATUS_BUILDING: Final = "building"
DEPLOYMENT_STATUS_RUNNING: Final = "running"
DEPLOYMENT_STATUS_FAILED: Final = "failed"
DEPLOYMENT_STATUS_STOPPED: Final = "stopped"

DEPLOYMENT_STATUSES: Final = (
    DEPLOYMENT_STATUS_PENDING,
    DEPLOYMENT_STATUS_ANALYZING,
    DEPLOYMENT_STATUS_BUILDING,
    DEPLOYMENT_STATUS_RUNNING,
    DEPLOYMENT_STATUS_FAILED,
    DEPLOYMENT_STATUS_STOPPED,
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

    # Filled in by Agent #1 once it inspects the code.
    run_commands: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    env_required: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # Filled in by Agent #2 once ports are exposed.
    exposed_ports: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    public_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    logs: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
