from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    project_name: str = "Backend API"
    version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    database_url: str = "sqlite+aiosqlite:///./app.db"
    db_echo: bool = False

    # GitHub App (user-to-server "Login with GitHub" flow).
    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = "http://localhost:8000/api/v1/auth/github/callback"

    # Where to send the user after a successful login.
    frontend_url: str = "http://localhost:5173"

    # Session cookie.
    session_cookie_name: str = "dploy_session"
    session_cookie_secure: bool = False
    session_ttl_hours: int = 24 * 7

    # Used to HMAC-sign short-lived values like the OAuth `state` param. Set
    # this to a long random string in production.
    session_secret: str = "dev-only-change-me"

    dedalus_api_key: str = ""
    anthropic_api_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
