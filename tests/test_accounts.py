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
