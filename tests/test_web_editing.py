from fastapi.testclient import TestClient

import KingdomWeb.app as web
from KingdomData import ContentStore, default_server_settings


def test_content_deletion_keeps_history_but_hides_definition(tmp_path):
    from KingdomData import NotFoundError
    import pytest
    store = ContentStore(tmp_path / "delete.db"); store.initialize()
    draft = store.save("item", "old_item", {"name": "Ancien objet"})
    store.publish("item", "old_item", draft["version"])
    deleted = store.delete("item", "old_item")
    assert deleted["status"] == "deleted"
    assert store.list("item") == []
    assert store.list("item", published=True) == []
    assert store.get("item", "old_item", version=1)["payload"]["name"] == "Ancien objet"
    with pytest.raises(NotFoundError): store.get("item", "old_item")


def test_building_and_item_can_be_edited_and_published(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "web.db")
    store.initialize()
    building = store.save("building", "test_castle", {"name": "Château", "actions": []})
    store.publish("building", "test_castle", building["version"])
    item = store.save("item", "test_potion", {"name": "Potion", "price": 2})
    store.publish("item", "test_potion", item["version"])
    monkeypatch.setattr(web, "store", store)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)

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


def test_building_editor_exposes_beginner_wizard_and_presets():
    with TestClient(web.app) as client:
        html = client.get("/").text
        presets = client.get("/static/building-presets.js").text
        script = client.get("/static/app.js").text

    assert 'id="preset-step"' in html
    assert 'id="context-help"' in html
    assert 'id="wizard-back"' in html
    assert "building-presets.js" in html
    for preset in ("harvest", "production", "commerce", "social", "administration", "custom"):
        assert f'key: "{preset}"' in presets
    assert 'data-duplicate=' in script
    assert 'data-delete=' in script
    assert 'openEditor(entity,true)' in script
    assert 'catalogOptions(catalogType, value)' in script
    assert 'Choisir une ressource…' in script
    assert 'id="profession-modules"' in script
    assert 'id="activity-modules"' in script
    assert 'outcome-effects' in script
    assert 'condition-editors' in script
    assert 'addConditionEditor' in script
    assert 'readConditions' in script
    assert 'Toutes les conditions' in script
    assert 'Au moins une condition' in script
    assert 'Inverser (NOT)' in script
    assert 'module_activity_min_durability' in script
    assert 'module_hook_claim' in script
    assert 'action_hook_failure' in script
    assert 'catalogOptions("building"' in script
    assert '["player","Toutes mes activités"]' in script
    assert '["player_building","Dans ce bâtiment"]' in script
    assert '["player_action","Pour cette action"]' in script
    assert '["stock_reward","Ajouter au stock d’un bâtiment"]' in script
    assert 'data-field="modules_json"' in script
    assert 'Actions générées depuis les modules' in script
    assert 'clone(state.buildingBase || {})' in script
    assert 'data-type="interface"' not in html
    assert 'data-type="dashboard"' in html
    assert 'data-type="supervision"' in html
    assert 'data-type="settings"' in html
    assert 'data-nav-group="world"' in html
    assert 'data-nav-group="modules"' in html
    assert 'data-nav-group="administration"' in html
    assert 'data-nav-submenu="world" hidden' in html
    assert 'data-building-tab="visual"' in script
    assert 'id="interaction-grid"' in script
    assert 'draggable="true"' in script
    assert 'interaction_type' in script
    assert 'loadDashboard' in script
    assert 'loadSupervision' in script
    assert 'loadSettings' in script
    assert 'data-supervision-tab="services"' in script
    assert 'data-settings-tab="onboarding"' in script


def test_visual_interface_and_administration_api(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "visual.db")
    store.initialize()
    building = store.save("building", "test_tavern", {"name": "Taverne", "actions": [{"key": "say_hello", "name": "Saluer", "effects": [{"type": "message", "text": "Bonjour"}]}]})
    store.publish("building", "test_tavern", building["version"])
    interface_payload = {
        "name": "Interface Taverne", "target_building_key": "test_tavern", "start_page": "home",
        "pages": [
            {"key": "home", "name": "Accueil", "components": [
                {"id": "hero_home", "type": "hero", "props": {"title": "Taverne"}},
                {"id": "open_actions", "type": "button", "props": {"label": "Entrer"}, "interaction": {"type": "navigate", "page": "actions"}},
            ]},
            {"key": "actions", "name": "Actions", "components": [
                {"id": "say_hello", "type": "button", "props": {"label": "Saluer"}, "interaction": {"type": "action", "building": "test_tavern", "action": "say_hello"}},
            ]},
        ],
    }
    monkeypatch.setattr(web, "store", store)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)
    with TestClient(web.app) as client:
        headers = {"Authorization": "Bearer change-me"}
        saved = client.post("/api/content/interface/ui_test_tavern", headers=headers, json={"payload": interface_payload})
        overview = client.get("/api/admin/overview", headers=headers)
    assert saved.status_code == 200
    assert overview.status_code == 200
    assert overview.json()["metrics"]["buildings"] == 1
    assert overview.json()["buildings"][0]["actions"] == 1


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
    assert "applications.commands" not in response.json()["url"]


def test_server_settings_are_saved_and_published_from_one_endpoint(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "settings.db")
    store.initialize()
    initial = store.save("server_settings", "kingdom_server", default_server_settings())
    store.publish("server_settings", "kingdom_server", initial["version"])
    monkeypatch.setattr(web, "store", store)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)
    payload = default_server_settings()
    payload["roles"]["player"] = "⚔️ Habitants assermentés"
    with TestClient(web.app) as client:
        headers = {"Authorization": "Bearer change-me"}
        response = client.post("/api/server/settings", headers=headers, json={"payload": payload, "expected_version": 1})
    assert response.status_code == 200
    assert response.json()["status"] == "published"
    assert store.get("server_settings", "kingdom_server", published=True)["payload"]["roles"]["player"] == "⚔️ Habitants assermentés"


def test_legacy_entry_channel_is_presented_as_building_name(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "legacy-settings.db")
    store.initialize()
    payload = default_server_settings()
    payload["discord"]["building_text_channel"] = "entree"
    initial = store.save("server_settings", "kingdom_server", payload)
    store.publish("server_settings", "kingdom_server", initial["version"])
    monkeypatch.setattr(web, "store", store)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)

    with TestClient(web.app) as client:
        response = client.get("/api/server/settings", headers={"Authorization": "Bearer change-me"})

    assert response.status_code == 200
    assert response.json()["payload"]["discord"]["building_text_channel"] == "{name}"


def test_building_embeds_its_visual_interface_with_select_menu(tmp_path):
    store = ContentStore(tmp_path / "unified.db")
    store.initialize()
    payload = {
        "name": "Taverne unifiée", "actions": [],
        "interface": {
            "name": "Interface de la Taverne", "target_building_key": "unified_tavern", "start_page": "home",
            "pages": [{"key": "home", "name": "Accueil", "components": [{
                "id": "main_menu", "type": "select", "slot": 0,
                "props": {"placeholder": "Choisir un service"},
                "options": [{"key": "open_home", "label": "Accueil", "interaction": {"type": "navigate", "page": "home"}}],
            }]}],
        },
    }
    draft = store.save("building", "unified_tavern", payload)
    published = store.publish("building", "unified_tavern", draft["version"])
    assert published["payload"]["interface"]["pages"][0]["components"][0]["slot"] == 0
