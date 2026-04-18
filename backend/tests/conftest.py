import asyncio
import os
import tempfile
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

_db_path = Path(tempfile.gettempdir()) / "hp-sp-26-test.db"
if _db_path.exists():
    _db_path.unlink()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_path}"
os.environ.setdefault("GITHUB_CLIENT_ID", "test-client-id")
os.environ.setdefault("GITHUB_CLIENT_SECRET", "test-client-secret")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.session import Session  # noqa: E402
from app.models.user import User  # noqa: E402

get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _reset_db() -> Iterator[None]:
    """Drop & recreate all tables before every test for isolation."""

    async def _do_reset() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_do_reset())
    yield


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def authed_client(client: TestClient) -> TestClient:
    """Insert a user + session into the DB and attach the cookie to the client."""

    async def _setup() -> str:
        async with SessionLocal() as db:
            user = User(
                github_id=42,
                login="octotest",
                name="Octo Test",
                email="octo@test.dev",
                avatar_url="https://example.com/avatar.png",
                github_access_token="ghu_test",
            )
            db.add(user)
            await db.flush()
            session = Session(
                token="test-session-token",
                user_id=user.id,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
            db.add(session)
            await db.commit()
            return session.token

    token = asyncio.run(_setup())
    client.cookies.set(get_settings().session_cookie_name, token)
    return client
