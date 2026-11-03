"""V3 contract tests: real sessions, SQLite, world isolation and durable publication."""
import pytest
from fastapi.testclient import TestClient

from KingdomData import ContentStore
from KingdomWeb import app as web
from KingdomWeb.accounts import RegistreComptes


@pytest.fixture
def studio(tmp_path, monkeypatch):
    primary = ContentStore(tmp_path / "primary.db")
    registry = RegistreComptes(primary.path)
    monkeypatch.setenv("KINGDOM_ADMIN_USERNAME", "creator")
    monkeypatch.setenv("KINGDOM_ADMIN_PASSWORD", "creator-test-password")
    monkeypatch.delenv("KINGDOM_ADMIN_TOKEN", raising=False)
    monkeypatch.setattr(web, "magasin_principal", primary)
    monkeypatch.setattr(web, "store", web.MagasinsServeurs(primary))
    monkeypatch.setattr(web, "comptes", registry)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _: 0)
    monkeypatch.setattr(web, "seed_legacy_audio_catalog", lambda _: 0)
    monkeypatch.setattr(web.OfficialContentStore, "migrate_legacy_presets", lambda _: None)
    with TestClient(web.app) as client:
        yield client, primary, registry


def test_next_entrypoint_preserves_legacy_and_reports_missing_build(tmp_path, monkeypatch):
    monkeypatch.setattr(web, "NEXT_INDEX", tmp_path / "index.html", raising=False)
    client = TestClient(web.app)
    assert client.get("/next").status_code == 503
    (tmp_path / "index.html").write_text('<html lang="fr">Next studio</html>')
    response = client.get("/next")
    assert response.status_code == 200
    assert "Next studio" in response.text
    assert "no-store" in response.headers["cache-control"]
    assert client.get("/next/").status_code == 200
    assert client.get("/").status_code == 200


def login(client):
    response = client.post("/api/auth/login", json={"username": "creator", "password": "creator-test-password"})
    assert response.status_code == 200
    return client.get("/api/profile").json()


def test_draft_publish_conflict_and_player_state_survive_restart(studio):
    client, store, _ = studio
    assert client.get("/api/content").status_code == 401
    profile = login(client)
    headers = {"X-Kingdom-Server": profile["current_server"]}
    with store.connection() as db:
        db.execute("INSERT INTO players(discord_id,display_name,money,energy,updated_at) VALUES('p1','Joueur',145,71,'2026-11-03')")
    original = {"name": "Atelier", "actions": [], "modules": {}, "future_extension": {"keep": True}}
    created = client.post("/api/content/building/atelier_test", headers=headers, json={"payload": original, "expected_version": 0})
    assert created.status_code == 200
    changed = {**original, "name": "Atelier modifié"}
    saved = client.post("/api/content/building/atelier_test", headers=headers, json={"payload": changed, "expected_version": 1})
    assert saved.status_code == 200
    stale = client.post("/api/content/building/atelier_test", headers=headers, json={"payload": original, "expected_version": 1})
    assert stale.status_code == 409
    published = client.post("/api/content/building/atelier_test/2/publish", headers=headers, json={})
    assert published.status_code == 200
    assert client.post("/api/content/building/atelier_test/2/publish", headers=headers, json={}).status_code == 409
    sync = client.get("/api/admin/discord/provision/status", headers=headers).json()
    assert sync["status"] == "pending"
    assert sync["building_key"] == "atelier_test"
    reopened = ContentStore(store.path)
    reopened.initialize()
    assert reopened.get("building", "atelier_test", published=True)["payload"] == changed
    with reopened.connection() as db:
        assert tuple(db.execute("SELECT money,energy FROM players WHERE discord_id='p1'").fetchone()) == (145, 71)


def test_inaccessible_world_cannot_read_or_write(studio):
    client, _, registry = studio
    profile = login(client)
    user = registry.creer_compte("reader", "Lecteur", "reader-test-password")
    registry.attribuer_acces(user["id"], profile["current_server"], "lecture")
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"username": "reader", "password": "reader-test-password"}).status_code == 200
    headers = {"X-Kingdom-Server": "unknown_world"}
    assert client.get("/api/content", headers=headers).status_code == 403
    headers = {"X-Kingdom-Server": profile["current_server"]}
    assert client.post("/api/content/building/blocked", headers=headers, json={"payload": {"name": "Interdit"}, "expected_version": 0}).status_code == 403
