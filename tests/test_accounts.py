import os
from pathlib import Path

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


def test_platform_admin_page_and_api_are_server_side_protected(tmp_path, monkeypatch):
    primary = ContentStore(tmp_path / "platform-access.db")
    registry = RegistreComptes(primary.path)
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "platform-owner")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "platform-password-123")
    monkeypatch.setenv("KINGDOM_PLATFORM_ADMIN_USERNAME", "platform-owner")
    monkeypatch.setenv("KINGDOM_ALLOW_REGISTRATION", "1")
    monkeypatch.setattr(web, "magasin_principal", primary)
    monkeypatch.setattr(web, "store", web.MagasinsServeurs(primary))
    monkeypatch.setattr(web, "comptes", registry)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)

    with TestClient(web.app) as client:
        normal = client.post("/api/auth/register", json={"username": "client-normal", "display_name": "Client", "email": "", "password": "client-password-123", "password_confirmation": "client-password-123"})
        assert normal.status_code == 200
        assert client.get("/platform-admin").status_code == 403
        assert client.get("/api/platform/overview").status_code == 403
        client.post("/api/auth/logout")
        assert client.post("/api/auth/login", json={"username": "platform-owner", "password": "platform-password-123"}).status_code == 200
        assert client.get("/platform-admin").status_code == 200
        assert client.get("/api/platform/overview").status_code == 200


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
        unassigned_profile = client.get("/api/profile")
        assert unassigned_profile.status_code == 200
        assert unassigned_profile.json()["account"]["username"] == "atilla"
        assert unassigned_profile.json()["servers"] == []
        assert unassigned_profile.json()["current_server"] == ""

        assert client.post("/api/auth/login", json={
            "username": "registration-admin", "password": "registration-password",
        }).status_code == 200
        accounts = client.get("/api/accounts").json()["accounts"]
        registered = next(account for account in accounts if account["username"] == "atilla")
        assert registered["server_count"] == 0
        assert registered["administered_server_count"] == 0
        administrator = next(account for account in accounts if account["is_admin"])
        assert administrator["administered_server_count"] == 1

        reset = client.post(f'/api/accounts/{registered["id"]}/password', json={"new_password": "nouveau-password-atilla"})
        assert reset.status_code == 200
        assert registry.authentifier("atilla", "nouveau-password-atilla")["id"] == registered["id"]


def test_public_registration_can_be_disabled(tmp_path, monkeypatch):
    primary = ContentStore(tmp_path / "registration-disabled.db")
    registry = RegistreComptes(primary.path)
    monkeypatch.setenv("KINGDOM_ALLOW_REGISTRATION", "0")
    monkeypatch.setattr(web, "comptes", registry)
    with TestClient(web.app) as client:
        response = client.post("/api/auth/register", json={})
    assert response.status_code == 403


def test_unassigned_account_can_create_its_first_server_and_becomes_owner(tmp_path, monkeypatch):
    primary = ContentStore(tmp_path / "self-service-server.db")
    registry = RegistreComptes(primary.path)
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "self-service-admin")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "self-service-password")
    monkeypatch.setenv("KINGDOM_ALLOW_REGISTRATION", "1")
    monkeypatch.setattr(web, "magasin_principal", primary)
    monkeypatch.setattr(web, "store", web.MagasinsServeurs(primary))
    monkeypatch.setattr(web, "comptes", registry)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)
    web._inscriptions_recentes.clear()

    with TestClient(web.app) as client:
        registration = client.post("/api/auth/register", json={
            "username": "nouveau-roi", "display_name": "Nouveau Roi",
            "password": "royaume-password", "password_confirmation": "royaume-password",
        })
        assert registration.status_code == 200
        assert client.get("/api/profile").json()["servers"] == []

        created = client.post("/api/servers", json={
            "name": "Royaume autonome", "guild_id": "123456789012345678",
        })
        assert created.status_code == 200
        profile = client.get("/api/profile").json()
        assert profile["current_server"] == created.json()["slug"]
        assert profile["servers"][0]["role"] == "proprietaire"
        assert profile["servers"][0]["guild_id"] == "123456789012345678"


def test_managed_server_install_and_safe_removal_lifecycle(tmp_path, monkeypatch):
    primary = ContentStore(tmp_path / "server-lifecycle.db")
    registry = RegistreComptes(primary.path)
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "lifecycle-admin")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "lifecycle-password")
    monkeypatch.setenv("KINGDOM_APPLICATION_ID", "123456789012345678")
    monkeypatch.setattr(web, "magasin_principal", primary)
    monkeypatch.setattr(web, "store", web.MagasinsServeurs(primary))
    monkeypatch.setattr(web, "comptes", registry)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)

    with TestClient(web.app) as client:
        assert client.post("/api/auth/login", json={
            "username": "lifecycle-admin", "password": "lifecycle-password",
        }).status_code == 200
        created = client.post("/api/servers", json={"name": "Royaume à retirer", "guild_id": "987654321012345678"})
        assert created.status_code == 200
        server = created.json()

        install = client.post(f'/api/servers/{server["slug"]}/install', json={})
        assert install.status_code == 200
        assert "discord.com" in install.json()["url"]
        target = ContentStore(server["database_path"])
        assert target.discord_provision_status()["scope"] == "server"

        with primary.connection() as database:
            database.execute("UPDATE managed_servers SET bot_installed=1 WHERE slug=?", (server["slug"],))
        uninstall = client.post(f'/api/servers/{server["slug"]}/uninstall', json={})
        assert uninstall.status_code == 200
        latest = target.discord_provision_status()
        assert latest["scope"] == "uninstall"
        assert client.delete(f'/api/servers/{server["slug"]}').status_code == 409
        target.finish_discord_provision(latest["id"], report="Discord nettoyé")
        removed = client.delete(f'/api/servers/{server["slug"]}')
        assert removed.status_code == 200
        assert Path(server["database_path"]).exists()
        assert all(item["slug"] != server["slug"] for item in registry.lister_serveurs(1, True))


def test_login_interface_exposes_registration_and_account_statistics():
    with TestClient(web.app) as client:
        script = client.get("/static/app.js").text
    assert "CRÉER UN COMPTE" in script
    assert "/api/auth/register" in script
    assert "COMPTES CRÉÉS" in script
    assert "administered_server_count" in script


def test_login_interface_uses_the_immersive_brand_assets():
    with TestClient(web.app) as client:
        page = client.get("/")
        stylesheet = client.get("/static/login-v2.css")
        panorama = client.get("/static/login-kingdom-panorama.png")

    assert page.status_code == 200
    assert "/static/login-v2.css" in page.text
    assert "/static/kingdomengine-logo-transparent.png" in page.text
    assert "PAYEN" in page.text
    assert stylesheet.status_code == 200
    assert "place-items:stretch" in stylesheet.text
    assert 'url("/static/login-kingdom-panorama.png")' in stylesheet.text
    assert "@media(max-width:960px)" in stylesheet.text
    assert panorama.status_code == 200
    assert panorama.headers["content-type"] == "image/png"


def test_mobile_shell_keeps_essential_tools_within_thumb_reach():
    with TestClient(web.app) as client:
        page = client.get("/")
        stylesheet = client.get("/static/mobile.css")
        script = client.get("/static/app.js")

    assert page.status_code == 200
    assert "/static/mobile.css" in page.text
    assert 'id="mobile-dock"' in page.text
    for target in ("dashboard", "live_world", "players", "supervision"):
        assert f'data-mobile-type="{target}"' in page.text
    assert stylesheet.status_code == 200
    assert "@media(max-width:760px)" in stylesheet.text
    assert "env(safe-area-inset-bottom)" in stylesheet.text
    assert "height:100dvh" in stylesheet.text
    assert "body:has(.login-screen:not([hidden])) .mobile-dock" in stylesheet.text
    assert "navigateTo(button.dataset.mobileType)" in script.text
    assert "mobileCreationBlocked" in script.text
    assert "La création de contenu" in script.text
    assert '[data-type="building"]' in stylesheet.text
    tablet = client.get("/static/tablet.css")
    assert "min-width:761px" in tablet.text
    assert "max-width:1024px" in tablet.text


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


def test_existing_accounts_and_servers_are_migrated_to_product_foundations(tmp_path, monkeypatch):
    database = tmp_path / "legacy-product.db"
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "owner")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "owner-password")
    registry = RegistreComptes(database); registry.initialiser()
    owner = registry.authentifier("owner", "owner-password")
    foundations = registry.fondations_produit(owner["id"])
    assert foundations["organizations"][0]["role"] == "owner"
    assert foundations["worlds"][0]["slug"] == "royaume-principal"
    assert foundations["worlds"][0]["guild_id"] == ""
    assert foundations["plans"][0]["plan_key"] == "standard"


def test_support_mode_is_scoped_expiring_revocable_and_audited(tmp_path, monkeypatch):
    database = tmp_path / "support.db"
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "owner")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "owner-password")
    registry = RegistreComptes(database); registry.initialiser()
    owner = registry.authentifier("owner", "owner-password")
    grant = registry.demander_assistance(owner["id"], "royaume-principal", ["diagnostics", "service_health", "secrets"], 30)
    assert grant["status"] == "active"
    assert grant["scopes"] == ["diagnostics", "service_health"]
    assert registry.revoquer_assistance(grant["grant_id"], owner["id"])["status"] == "revoked"
    with registry.connexion() as database_connection:
        actions = [row[0] for row in database_connection.execute("SELECT action FROM platform_audit ORDER BY id")]
    assert actions == ["support.granted", "support.revoked"]
