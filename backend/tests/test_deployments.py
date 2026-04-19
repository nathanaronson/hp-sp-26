from fastapi.testclient import TestClient


def test_create_requires_auth(client: TestClient) -> None:
    response = client.post(
        "/api/v1/deployments",
        json={"github_url": "https://github.com/foo/bar"},
    )
    assert response.status_code == 401


def test_create_requires_source(authed_client: TestClient) -> None:
    response = authed_client.post("/api/v1/deployments", json={"name": "missing-src"})
    assert response.status_code == 422


def test_create_and_get_deployment(authed_client: TestClient) -> None:
    payload = {
        "name": "example",
        "github_url": "https://github.com/octocat/hello-world",
    }
    create = authed_client.post("/api/v1/deployments", json=payload)
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["id"]
    assert body["status"] == "pending"
    assert body["github_url"] == payload["github_url"]
    assert body["created_at"].endswith("Z")
    assert body["updated_at"].endswith("Z")

    deployment_id = body["id"]
    fetched = authed_client.get(f"/api/v1/deployments/{deployment_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == deployment_id
    assert fetched.json()["created_at"].endswith("Z")
    assert fetched.json()["updated_at"].endswith("Z")


def test_list_deployments(authed_client: TestClient) -> None:
    authed_client.post(
        "/api/v1/deployments",
        json={"github_url": "https://github.com/foo/bar"},
    )
    response = authed_client.get("/api/v1/deployments")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert isinstance(body["items"], list)


def test_get_unknown_deployment(authed_client: TestClient) -> None:
    response = authed_client.get("/api/v1/deployments/does-not-exist")
    assert response.status_code == 404


def test_upload_endpoint(client: TestClient) -> None:
    files = {"file": ("hello.txt", b"hello world", "text/plain")}
    response = client.post("/api/v1/uploads", files=files)
    assert response.status_code == 200
    body = response.json()
    assert body["upload_id"]
    assert body["size"] == len(b"hello world")


def test_bearer_token_auth(client: TestClient) -> None:
    """The CLI sends the session token as `Authorization: Bearer ...`."""
    # Mint a session via the same fixture path the cookie uses.
    import asyncio
    from datetime import UTC, datetime, timedelta

    from app.db.session import SessionLocal
    from app.models.session import Session
    from app.models.user import User

    async def _setup() -> str:
        async with SessionLocal() as db:
            user = User(github_id=99, login="cli-user")
            db.add(user)
            await db.flush()
            session = Session(
                token="bearer-token-xyz",
                user_id=user.id,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
            db.add(session)
            await db.commit()
            return session.token

    token = asyncio.run(_setup())
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["login"] == "cli-user"


def test_stop_deployment(authed_client: TestClient) -> None:
    create = authed_client.post(
        "/api/v1/deployments",
        json={"github_url": "https://github.com/foo/bar"},
    )
    deployment_id = create.json()["id"]

    stop = authed_client.delete(f"/api/v1/deployments/{deployment_id}")
    assert stop.status_code == 200, stop.text
    assert stop.json()["status"] == "stopped"
    assert stop.json()["sandbox_id"] is None


def test_restart_stopped_deployment(authed_client: TestClient) -> None:
    create = authed_client.post(
        "/api/v1/deployments",
        json={"name": "arc", "github_url": "https://github.com/foo/bar"},
    )
    deployment_id = create.json()["id"]

    stop = authed_client.delete(f"/api/v1/deployments/{deployment_id}")
    assert stop.status_code == 200, stop.text

    start = authed_client.post(f"/api/v1/deployments/{deployment_id}/start")
    assert start.status_code == 200, start.text
    body = start.json()
    assert body["id"] == deployment_id
    assert body["status"] == "pending"
    assert body["name"] == "arc"
    assert body["public_url"] is None
    assert body["error"] is None


def test_delete_deployment_record(authed_client: TestClient) -> None:
    create = authed_client.post(
        "/api/v1/deployments",
        json={"name": "arc", "github_url": "https://github.com/foo/bar"},
    )
    deployment_id = create.json()["id"]

    deleted = authed_client.delete(f"/api/v1/deployments/{deployment_id}/record")
    assert deleted.status_code == 204, deleted.text

    fetched = authed_client.get(f"/api/v1/deployments/{deployment_id}")
    assert fetched.status_code == 404, fetched.text
