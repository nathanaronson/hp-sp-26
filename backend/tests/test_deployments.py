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

    deployment_id = body["id"]
    fetched = authed_client.get(f"/api/v1/deployments/{deployment_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == deployment_id


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
