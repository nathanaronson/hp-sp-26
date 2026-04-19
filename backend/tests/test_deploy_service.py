from app.services.deploy import _normalize_build_command, _normalize_plan_commands


class _FakeResult:
    def __init__(self, ok: bool) -> None:
        self._ok = ok

    def ok(self) -> bool:
        return self._ok


class _FakeSandbox:
    def __init__(self, files: set[str]) -> None:
        self.files = files

    def exec(self, command: str, **kwargs) -> _FakeResult:  # noqa: ANN003
        if "mvnw" in command:
            return _FakeResult("mvnw" in self.files)
        if "gradlew" in command:
            return _FakeResult("gradlew" in self.files)
        return _FakeResult(False)


def test_normalize_build_command_prefers_maven_wrapper() -> None:
    sb = _FakeSandbox({"mvnw"})

    normalized = _normalize_build_command(sb, "mvn clean package")

    assert normalized == "./mvnw clean package"


def test_normalize_build_command_prefers_gradle_wrapper() -> None:
    sb = _FakeSandbox({"gradlew"})

    normalized = _normalize_build_command(sb, "gradle build")

    assert normalized == "./gradlew build"


def test_normalize_plan_commands_rewrites_install_and_build() -> None:
    sb = _FakeSandbox({"mvnw"})

    plan = _normalize_plan_commands(
        sb,
        {
            "install_commands": ["mvn clean package"],
            "build_commands": ["mvn -q test"],
        },
    )

    assert plan["install_commands"] == ["./mvnw clean package"]
    assert plan["build_commands"] == ["./mvnw -q test"]
