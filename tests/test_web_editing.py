from fastapi.testclient import TestClient

import KingdomWeb.app as web
from KingdomData import ContentStore


def test_building_and_item_can_be_edited_and_published(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "web.db")
    store.initialize()
    building = store.save("building", "test_castle", {"name": "Château", "actions": []})
    store.publish("building", "test_castle", building["version"])
    item = store.save("item", "test_potion", {"name": "Potion", "price": 2})
    store.publish("item", "test_potion", item["version"])
    monkeypatch.setattr(web, "store", store)

    with TestClient(web.app) as client:
        headers = {"Authorization": "Bearer change-me"}
        building_response = client.post(
            "/api/content/building/test_castle",
            headers=headers,
            json={"payload": {"name": "Grand Château", "actions": []}, "expected_version": 1},
        )
        item_response = client.post(
            "/api/content/item/test_potion",
            headers=headers,
            json={"payload": {"name": "Potion rouge", "price": 4}, "expected_version": 1},
        )
        assert building_response.status_code == 200
        assert item_response.status_code == 200
        assert building_response.json()["status"] == "draft"
        assert item_response.json()["status"] == "draft"
        assert client.post("/api/content/building/test_castle/2/publish", headers=headers, json={}).status_code == 200
        assert client.post("/api/content/item/test_potion/2/publish", headers=headers, json={}).status_code == 200
        assert store.get("building", "test_castle", published=True)["payload"]["name"] == "Grand Château"
        assert store.get("item", "test_potion", published=True)["payload"]["price"] == 4


def test_editor_has_non_validating_close_controls():
    with TestClient(web.app) as client:
        html = client.get("/").text
    assert 'id="close-editor"' in html
    assert 'id="cancel-editor"' in html
    assert 'method="dialog"' not in html
    assert '<dialog' not in html
    assert 'class="modal" hidden' in html


def test_voice_bot_invite_link_uses_its_application_id(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "invite.db")
    store.initialize()
    draft = store.save("bot", "voice_bard", {
        "name": "Barde", "bot_type": "voice", "token_env": "BARD_BOT_TOKEN",
        "application_id_env": "BARD_APPLICATION_ID", "voice_channel_id": "42",
    })
    store.publish("bot", "voice_bard", draft["version"])
    monkeypatch.setattr(web, "store", store)
    monkeypatch.setenv("BARD_APPLICATION_ID", "123456789012345678")
    with TestClient(web.app) as client:
        response = client.get("/api/bots/voice_bard/invite", headers={"Authorization": "Bearer change-me"})
    assert response.status_code == 200
    assert "client_id=123456789012345678" in response.json()["url"]
    assert "permissions=" in response.json()["url"]
