from fastapi.testclient import TestClient

import KingdomWeb.app as web
from KingdomData import ContentStore, default_server_settings


def publish(store, entity_type, key, payload):
    draft = store.save(entity_type, key, payload)
    return store.publish(entity_type, key, draft["version"])


def configured_client(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "map.db")
    store.initialize()
    publish(store, "server_settings", "kingdom_server", default_server_settings())
    monkeypatch.setattr(web, "store", store)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)
    monkeypatch.setattr(web, "KINGDOM_DATA_ROOT", tmp_path)
    monkeypatch.setattr(web, "MAP_ASSETS", tmp_path / "assets" / "maps")
    return store, TestClient(web.app)


def test_world_map_settings_are_published_without_weather(tmp_path, monkeypatch):
    store, client = configured_client(tmp_path, monkeypatch)
    with client:
        response = client.post(
            "/api/world/map/settings",
            headers={"Authorization": "Bearer change-me"},
            json={"background_path": "", "width": 2200, "height": 1200},
        )
    assert response.status_code == 200
    settings = store.get("server_settings", "kingdom_server", published=True)["payload"]
    assert settings["world_map"] == {"background_path": "", "width": 2200, "height": 1200}
    assert store.list("environment") == []


def test_world_map_background_upload_is_stored_and_served(tmp_path, monkeypatch):
    store, client = configured_client(tmp_path, monkeypatch)
    headers = {"Authorization": "Bearer change-me"}
    image = b"\x89PNG\r\n\x1a\n" + b"test-map"
    with client:
        uploaded = client.post("/api/world/map/background", headers=headers, files={"file": ("royaume.png", image, "image/png")})
        served = client.get("/api/world/map/background", headers=headers)
    assert uploaded.status_code == 200
    assert served.status_code == 200
    assert served.content == image
    path = store.get("server_settings", "kingdom_server", published=True)["payload"]["world_map"]["background_path"]
    assert path.startswith("assets/maps/") and path.endswith("/world_map.png")


def test_map_editor_exposes_drag_zoom_background_and_building_anchor_controls():
    with TestClient(web.app) as client:
        script = client.get("/static/app.js").text
        css = client.get("/static/world-map-editor.css").text
    for marker in ("bindWorldMapEditor", "map-background-input", "map-zoom-in", "data-map-building", "application/x-kingdom-building"):
        assert marker in script
    assert "building-drop-target" in css
