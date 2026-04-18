import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.session import Session
from app.models.user import User
from app.services import github_oauth
from app.services.github_oauth import GitHubToken, GitHubUser


def _apply_token(user: User, token: GitHubToken) -> None:
    user.github_access_token = token.access_token
    user.github_access_token_expires_at = token.access_token_expires_at
    if token.refresh_token is not None:
        user.github_refresh_token = token.refresh_token
        user.github_refresh_token_expires_at = token.refresh_token_expires_at


async def upsert_user(
    db: AsyncSession,
    gh_user: GitHubUser,
    token: GitHubToken,
) -> User:
    user = await db.scalar(select(User).where(User.github_id == gh_user.id))
    if user is None:
        user = User(
            github_id=gh_user.id,
            login=gh_user.login,
            name=gh_user.name,
            email=gh_user.email,
            avatar_url=gh_user.avatar_url,
        )
        db.add(user)
    else:
        user.login = gh_user.login
        user.name = gh_user.name
        user.email = gh_user.email
        user.avatar_url = gh_user.avatar_url
    _apply_token(user, token)
    await db.flush()
    return user


async def create_session(db: AsyncSession, user: User) -> Session:
    settings = get_settings()
    session = Session(
        token=secrets.token_urlsafe(32),
        user_id=user.id,
        expires_at=datetime.now(UTC) + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(session)
    await db.flush()
    return session


def _as_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def get_session_user(db: AsyncSession, token: str) -> User | None:
    session = await db.get(Session, token)
    if session is None:
        return None
    expires_at = _as_aware_utc(session.expires_at)
    if expires_at is not None and expires_at < datetime.now(UTC):
        await db.delete(session)
        await db.flush()
        return None
    return await db.get(User, session.user_id)


async def delete_session(db: AsyncSession, token: str) -> None:
    session = await db.get(Session, token)
    if session is not None:
        await db.delete(session)
        await db.flush()


async def get_valid_github_token(db: AsyncSession, user: User) -> str | None:
    """Return a non-expired GitHub access token for `user`, refreshing if needed.

    Returns None if there's no token or it can no longer be refreshed.
    """
    now = datetime.now(UTC)
    skew = timedelta(seconds=60)
    expires_at = _as_aware_utc(user.github_access_token_expires_at)

    if user.github_access_token and (expires_at is None or expires_at - skew > now):
        return user.github_access_token

    if not user.github_refresh_token:
        return None
    refresh_expires = _as_aware_utc(user.github_refresh_token_expires_at)
    if refresh_expires is not None and refresh_expires <= now:
        return None

    new_token = await github_oauth.refresh_access_token(user.github_refresh_token)
    _apply_token(user, new_token)
    await db.flush()
    return user.github_access_token
