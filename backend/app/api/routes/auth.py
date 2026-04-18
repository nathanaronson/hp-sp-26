from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse

from app.api.deps import CurrentUser, SessionDep
from app.core.config import get_settings
from app.schemas.user import UserRead
from app.services import github_oauth, oauth_state
from app.services.auth import create_session, delete_session, upsert_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/github/login")
async def github_login() -> RedirectResponse:
    """Kick off the GitHub OAuth flow for a browser."""
    settings = get_settings()
    if not settings.github_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub OAuth is not configured",
        )

    return RedirectResponse(
        url=github_oauth.build_authorize_url(oauth_state.issue_state()),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


@router.get("/cli/login")
async def cli_login(cli_port: int) -> RedirectResponse:
    """Kick off the OAuth flow for the CLI.

    The CLI starts a local HTTP server on `cli_port`, opens this URL, and
    receives the session token back at http://127.0.0.1:<cli_port>/callback.
    """
    settings = get_settings()
    if not settings.github_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub OAuth is not configured",
        )
    if not (1 <= cli_port <= 65535):
        raise HTTPException(status_code=400, detail="Invalid cli_port")

    return RedirectResponse(
        url=github_oauth.build_authorize_url(oauth_state.issue_state(cli_port=cli_port)),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


@router.get("/github/callback")
async def github_callback(
    db: SessionDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    settings = get_settings()
    if error:
        raise HTTPException(status_code=400, detail=f"GitHub error: {error}")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")
    info = oauth_state.parse_state(state)
    if not info.valid:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    token = await github_oauth.exchange_code_for_token(code)
    gh_user = await github_oauth.fetch_user(token.access_token)

    user = await upsert_user(db, gh_user, token)
    session = await create_session(db, user)
    await db.commit()

    if info.cli_port is not None:
        # Hand the token to the CLI's local HTTP server and let it close the loop.
        return RedirectResponse(
            url=f"http://127.0.0.1:{info.cli_port}/callback?token={session.token}",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    redirect = RedirectResponse(
        url=settings.frontend_url,
        status_code=status.HTTP_303_SEE_OTHER,
    )
    redirect.set_cookie(
        settings.session_cookie_name,
        session.token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return redirect


@router.get("/me", response_model=UserRead)
async def me(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: SessionDep) -> Response:
    settings = get_settings()
    # Honor either header- or cookie-based auth so the CLI can also log out.
    auth = request.headers.get("authorization", "")
    scheme, _, header_token = auth.partition(" ")
    bearer = header_token.strip() if scheme.lower() == "bearer" else None
    cookie_token = request.cookies.get(settings.session_cookie_name)

    for token in {bearer, cookie_token}:
        if token:
            await delete_session(db, token)
    await db.commit()

    response.delete_cookie(settings.session_cookie_name, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/login", include_in_schema=False)
async def login_alias() -> RedirectResponse:
    return RedirectResponse(
        url="/api/v1/auth/github/login",
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )
