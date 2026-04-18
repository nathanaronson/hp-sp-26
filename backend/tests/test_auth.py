import pytest
from fastapi.testclient import TestClient

from app.services import github_oauth


def test_login_redirects_to_github(client: TestClient) -> None:
    response = client.get("/api/v1/auth/github/login", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"].startswith(github_oauth.GITHUB_AUTHORIZE_URL)
    assert "state=" in response.headers["location"]


def test_me_unauthenticated(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401


def test_me_authenticated(authed_client: TestClient) -> None:
    response = authed_client.get("/api/v1/auth/me")
    assert response.status_code == 200
    body = response.json()
    assert body["login"] == "octotest"
    assert body["github_id"] == 42


def test_logout(authed_client: TestClient) -> None:
    response = authed_client.post("/api/v1/auth/logout")
    assert response.status_code == 204
    # Cookie removed on the client; subsequent /me should now be 401.
    authed_client.cookies.clear()
    follow = authed_client.get("/api/v1/auth/me")
    assert follow.status_code == 401


def test_github_callback_full_flow(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_exchange(code: str) -> github_oauth.GitHubToken:
        assert code == "abc123"
        return github_oauth.GitHubToken(
            access_token="ghu_fake_token",
            token_type="bearer",
            access_token_expires_at=None,
            refresh_token="ghr_fake_refresh",
            refresh_token_expires_at=None,
        )

    async def fake_fetch(token: str) -> github_oauth.GitHubUser:
        assert token == "ghu_fake_token"
        return github_oauth.GitHubUser(
            id=99,
            login="callbackuser",
            name="Callback User",
            email="cb@example.com",
            avatar_url="https://example.com/cb.png",
        )

    monkeypatch.setattr(
        "app.api.routes.auth.github_oauth.exchange_code_for_token",
        fake_exchange,
    )
    monkeypatch.setattr(
        "app.api.routes.auth.github_oauth.fetch_user",
        fake_fetch,
    )

    # The state is HMAC-signed; we mint a real one the same way the login route does.
    from app.services import oauth_state

    state = oauth_state.issue_state()
    response = client.get(
        "/api/v1/auth/github/callback",
        params={"code": "abc123", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "dploy_session" in response.cookies

    # Use the new session cookie to hit /me.
    client.cookies.clear()
    client.cookies.set("dploy_session", response.cookies["dploy_session"])
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["login"] == "callbackuser"
