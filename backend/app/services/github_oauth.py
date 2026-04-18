from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_USER_EMAILS_URL = "https://api.github.com/user/emails"


@dataclass
class GitHubUser:
    id: int
    login: str
    name: str | None
    email: str | None
    avatar_url: str | None


@dataclass
class GitHubToken:
    """Result of an access-token exchange or refresh.

    GitHub App user tokens expire (8h by default). `refresh_token` can be used
    to mint a new access token until it too expires (~6 months by default).
    Both expiry fields will be `None` if the App opted out of expiration.
    """

    access_token: str
    token_type: str
    access_token_expires_at: datetime | None
    refresh_token: str | None
    refresh_token_expires_at: datetime | None


def build_authorize_url(state: str) -> str:
    """Build the URL we redirect users to so they can authorize the GitHub App.

    GitHub App user tokens use the App's fine-grained permissions, so no
    `scope` parameter is sent.
    """
    settings = get_settings()
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_redirect_uri,
        "state": state,
    }
    return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"


def _parse_token_response(body: dict) -> GitHubToken:
    if "access_token" not in body:
        raise ValueError(f"GitHub token response missing access_token: {body!r}")

    now = datetime.now(UTC)
    access_expires = (
        now + timedelta(seconds=int(body["expires_in"])) if body.get("expires_in") else None
    )
    refresh_expires = (
        now + timedelta(seconds=int(body["refresh_token_expires_in"]))
        if body.get("refresh_token_expires_in")
        else None
    )

    return GitHubToken(
        access_token=body["access_token"],
        token_type=body.get("token_type", "bearer"),
        access_token_expires_at=access_expires,
        refresh_token=body.get("refresh_token"),
        refresh_token_expires_at=refresh_expires,
    )


async def exchange_code_for_token(code: str) -> GitHubToken:
    """Exchange an OAuth `code` for a user access token."""
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
                "redirect_uri": settings.github_redirect_uri,
            },
        )
        response.raise_for_status()
        return _parse_token_response(response.json())


async def refresh_access_token(refresh_token: str) -> GitHubToken:
    """Use a refresh token to mint a new user access token."""
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
        )
        response.raise_for_status()
        return _parse_token_response(response.json())


async def fetch_user(access_token: str) -> GitHubUser:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    async with httpx.AsyncClient(timeout=10.0, headers=headers) as client:
        user_resp = await client.get(GITHUB_USER_URL)
        user_resp.raise_for_status()
        user = user_resp.json()

        email = user.get("email")
        if not email:
            # /user omits email when the user has it set to private; /user/emails
            # returns the verified addresses (requires `email` user permission
            # on the GitHub App, otherwise this returns 404 and we just skip).
            emails_resp = await client.get(GITHUB_USER_EMAILS_URL)
            if emails_resp.status_code == 200:
                emails = emails_resp.json()
                primary = next(
                    (e for e in emails if e.get("primary") and e.get("verified")),
                    None,
                )
                email = primary["email"] if primary else None

    return GitHubUser(
        id=int(user["id"]),
        login=user["login"],
        name=user.get("name"),
        email=email,
        avatar_url=user.get("avatar_url"),
    )
