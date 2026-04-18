from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_session
from app.models.user import User
from app.services.auth import get_session_user

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _extract_token(request: Request) -> str | None:
    """Return the session token from either an Authorization header or cookie.

    Bearer header is checked first so the CLI (which has no cookie jar) can
    authenticate by sending `Authorization: Bearer <session_token>`.
    """
    auth = request.headers.get("authorization")
    if auth:
        scheme, _, token = auth.partition(" ")
        if scheme.lower() == "bearer" and token:
            return token.strip()
    return request.cookies.get(get_settings().session_cookie_name)


async def _resolve_current_user(request: Request, db: SessionDep) -> User:
    token = _extract_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    user = await get_session_user(db, token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
        )
    return user


CurrentUser = Annotated[User, Depends(_resolve_current_user)]
