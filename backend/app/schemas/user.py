from pydantic import BaseModel, ConfigDict


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    github_id: int
    login: str
    name: str | None
    email: str | None
    avatar_url: str | None
