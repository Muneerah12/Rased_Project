import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database
import main


TEST_ADMIN_TOKEN = "configuration-test-admin-token"


@pytest.fixture
def isolated_api(monkeypatch):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    main.Base.metadata.create_all(bind=test_engine)
    test_session = sessionmaker(
        autocommit=False, autoflush=False, bind=test_engine
    )

    def override_get_db():
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(main, "SessionLocal", test_session)
    main.app.dependency_overrides[main.get_db] = override_get_db
    yield
    main.app.dependency_overrides.clear()
    main.Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


def test_admin_token_loads_from_env_file_and_process_env_wins(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        f"ADMIN_PROVISIONING_TOKEN={TEST_ADMIN_TOKEN}\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("ADMIN_PROVISIONING_TOKEN", raising=False)

    assert main.load_admin_provisioning_token(env_file) == TEST_ADMIN_TOKEN

    monkeypatch.setenv("ADMIN_PROVISIONING_TOKEN", "shell-configured-token")
    assert main.load_admin_provisioning_token(env_file) == "shell-configured-token"


def test_rasid_integration_token_loads_from_env_file_and_process_env_wins(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "RASID_INTEGRATION_TOKEN=file-configured-token\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("RASID_INTEGRATION_TOKEN", raising=False)

    assert main.load_rasid_integration_token(env_file) == "file-configured-token"

    monkeypatch.setenv("RASID_INTEGRATION_TOKEN", "shell-configured-token")
    assert main.load_rasid_integration_token(env_file) == "shell-configured-token"


def test_configured_admin_token_starts_and_authorizes(isolated_api, monkeypatch):
    monkeypatch.setattr(main, "ADMIN_PROVISIONING_TOKEN", TEST_ADMIN_TOKEN)

    with TestClient(main.app) as client:
        response = client.get(
            "/nodes",
            headers={"X-Admin-Token": TEST_ADMIN_TOKEN},
        )

    assert response.status_code == 200
    assert response.json() == []


def test_missing_admin_token_fails_at_startup(isolated_api, monkeypatch):
    monkeypatch.setattr(main, "ADMIN_PROVISIONING_TOKEN", None)

    with pytest.raises(RuntimeError, match="ADMIN_PROVISIONING_TOKEN is required") as error:
        with TestClient(main.app):
            pass

    assert TEST_ADMIN_TOKEN not in str(error.value)


def test_wrong_admin_token_returns_401(isolated_api, monkeypatch):
    monkeypatch.setattr(main, "ADMIN_PROVISIONING_TOKEN", TEST_ADMIN_TOKEN)

    with TestClient(main.app) as client:
        response = client.get("/nodes", headers={"X-Admin-Token": "wrong-token"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid admin provisioning token"


def test_correct_admin_token_is_authorized(isolated_api, monkeypatch):
    monkeypatch.setattr(main, "ADMIN_PROVISIONING_TOKEN", TEST_ADMIN_TOKEN)

    with TestClient(main.app) as client:
        response = client.get(
            "/nodes",
            headers={"X-Admin-Token": TEST_ADMIN_TOKEN},
        )

    assert response.status_code == 200


def test_sqlite_path_is_anchored_to_backend_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    assert Path(database.engine.url.database) == (
        Path(database.__file__).resolve().parent / "cps.db"
    )
    assert Path(database.engine.url.database).is_absolute()
