import os

from fastapi.testclient import TestClient

from KingdomData import ContentStore, NotFoundError
from KingdomWeb import app as web
from KingdomWeb.accounts import RegistreComptes


def test_account_sessions_and_server_roles(tmp_path, monkeypatch):
    database = tmp_path / "principal.db"
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "root")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "mot-de-passe-solide")
    registry = RegistreComptes(database)
    registry.initialiser()

    admin = registry.authentifier("root", "mot-de-passe-solide")
    token = registry.ouvrir_session(admin["id"])
    assert registry.compte_session(token)["username"] == "root"

    editor = registry.creer_compte("alice", "Alice", "mot-de-passe-alice")
    server = registry.lister_serveurs(admin["id"], True)[0]
    registry.attribuer_acces(editor["id"], server["slug"], "editeur")
    granted = registry.serveur_autorise(editor, server["slug"])
    assert registry.autorise(editor, granted, "contenu:modifier") is True
    assert registry.autorise(editor, granted, "serveur:parametrer") is False
    assert registry.lister_comptes()[1]["access"][0]["role"] == "editeur"
    registry.retirer_acces(editor["id"], server["slug"])
    assert registry.lister_acces(editor["id"]) == []


def test_web_accounts_and_servers_are_isolated(tmp_path, monkeypatch):
    primary = ContentStore(tmp_path / "kingdom.db")
    registry = RegistreComptes(primary.path)
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "admin-test")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "password-test-123")
    monkeypatch.setattr(web, "magasin_principal", primary)
    monkeypatch.setattr(web, "store", web.MagasinsServeurs(primary))
    monkeypatch.setattr(web, "comptes", registry)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)

    with TestClient(web.app) as client:
        refused = client.post("/api/auth/login", json={"username": "admin-test", "password": "incorrect-password"})
        assert refused.status_code == 401
        assert "incorrect" in refused.json()["detail"]
        login = client.post("/api/auth/login", json={"username": "admin-test", "password": "password-test-123"})
        assert login.status_code == 200
        profile = client.get("/api/profile").json()
        primary_slug = profile["current_server"]

        created = client.post("/api/servers", headers={"X-Kingdom-Server": primary_slug}, json={"name": "Second Royaume", "guild_id": "987654321"})
        assert created.status_code == 200
        second_slug = created.json()["slug"]

        payload = {"name": "Tour du premier royaume", "actions": []}
        first = client.post("/api/content/building/tour_premiere", headers={"X-Kingdom-Server": primary_slug}, json={"payload": payload})
        assert first.status_code == 200
        missing = client.get("/api/content/building/tour_premiere", headers={"X-Kingdom-Server": second_slug})
        assert missing.status_code == 404

        account = client.post("/api/accounts", headers={"X-Kingdom-Server": primary_slug}, json={
            "username": "editeur-test", "display_name": "Editeur", "password": "password-editor-123",
            "access": [{"server_slug": second_slug, "role": "lecture"}],
        })
        assert account.status_code == 200

    assert os.path.isfile(created.json()["database_path"])


def test_public_registration_creates_an_unassigned_account_visible_to_admin(tmp_path, monkeypatch):
    primary = ContentStore(tmp_path / "registration.db")
    registry = RegistreComptes(primary.path)
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "registration-admin")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "registration-password")
    monkeypatch.setenv("KINGDOM_ALLOW_REGISTRATION", "1")
    monkeypatch.setattr(web, "magasin_principal", primary)
    monkeypatch.setattr(web, "store", web.MagasinsServeurs(primary))
    monkeypatch.setattr(web, "comptes", registry)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)
    web._inscriptions_recentes.clear()

    with TestClient(web.app) as client:
        mismatch = client.post("/api/auth/register", json={
            "username": "atilla", "display_name": "Atilla", "email": "atilla@example.test",
            "password": "password-atilla", "password_confirmation": "different-password",
        })
        assert mismatch.status_code == 422
        created = client.post("/api/auth/register", json={
            "username": "atilla", "display_name": "Atilla", "email": "atilla@example.test",
            "password": "password-atilla", "password_confirmation": "password-atilla",
        })
        assert created.status_code == 200
        assert "administrateur" in created.json()["message"]
        assert registry.lister_acces(created.json()["account"]["id"]) == []

        assert client.post("/api/auth/login", json={
            "username": "registration-admin", "password": "registration-password",
        }).status_code == 200
        accounts = client.get("/api/accounts").json()["accounts"]
        registered = next(account for account in accounts if account["username"] == "atilla")
        assert registered["server_count"] == 0
        assert registered["administered_server_count"] == 0
        administrator = next(account for account in accounts if account["is_admin"])
        assert administrator["administered_server_count"] == 1


def test_public_registration_can_be_disabled(tmp_path, monkeypatch):
    primary = ContentStore(tmp_path / "registration-disabled.db")
    registry = RegistreComptes(primary.path)
    monkeypatch.setenv("KINGDOM_ALLOW_REGISTRATION", "0")
    monkeypatch.setattr(web, "comptes", registry)
    with TestClient(web.app) as client:
        response = client.post("/api/auth/register", json={})
    assert response.status_code == 403


def test_login_interface_exposes_registration_and_account_statistics():
    with TestClient(web.app) as client:
        script = client.get("/static/app.js").text
    assert "CRÉER UN COMPTE" in script
    assert "/api/auth/register" in script
    assert "COMPTES CRÉÉS" in script
    assert "administered_server_count" in script


def test_tutorial_progress_is_scoped_by_account_and_server(tmp_path, monkeypatch):
    database = tmp_path / "tutorials.db"
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "guide")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "mot-de-passe-guide")
    registry = RegistreComptes(database)
    registry.initialiser()
    account = registry.authentifier("guide", "mot-de-passe-guide")

    assert registry.progression_tutoriels(account["id"], "royaume-a") == {
        "tutorials": {}, "onboarding_seen": False,
    }
    saved = registry.enregistrer_progression_tutoriel(
        account["id"], "royaume-a", "building", ["create", "create", "name"], dismissed=True,
    )
    assert saved["completed_steps"] == ["create", "name"]
    progress = registry.progression_tutoriels(account["id"], "royaume-a")
    assert progress["tutorials"]["building"]["dismissed"] is True
    assert registry.progression_tutoriels(account["id"], "royaume-b")["tutorials"] == {}

    registry.reinitialiser_tutoriel(account["id"], "royaume-a", "building")
    assert registry.progression_tutoriels(account["id"], "royaume-a")["tutorials"] == {}


def test_tutorial_progress_api_can_resume_and_reset(tmp_path, monkeypatch):
    primary = ContentStore(tmp_path / "tutorial-api.db")
    registry = RegistreComptes(primary.path)
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "tutorial-admin")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "tutorial-password")
    monkeypatch.setattr(web, "magasin_principal", primary)
    monkeypatch.setattr(web, "store", web.MagasinsServeurs(primary))
    monkeypatch.setattr(web, "comptes", registry)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)

    with TestClient(web.app) as client:
        client.post("/api/auth/login", json={"username": "tutorial-admin", "password": "tutorial-password"})
        profile = client.get("/api/profile").json()
        request_headers = {"X-Kingdom-Server": profile["current_server"]}
        saved = client.put("/api/tutorials/progress/world", headers=request_headers, json={
            "completed_steps": ["map", "route"], "completed": False, "dismissed": True,
        })
        assert saved.status_code == 200
        resumed = client.get("/api/tutorials/progress", headers=request_headers).json()
        assert resumed["tutorials"]["world"]["completed_steps"] == ["map", "route"]
        assert resumed["tutorials"]["world"]["dismissed"] is True
        assert client.delete("/api/tutorials/progress/world", headers=request_headers).status_code == 200
        assert client.get("/api/tutorials/progress", headers=request_headers).json()["tutorials"] == {}
