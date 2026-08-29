from fastapi.testclient import TestClient
from pathlib import Path

import KingdomWeb.app as web
from KingdomData import ContentStore, default_server_settings


def test_building_and_item_editor_exposes_searchable_emoji_library():
    static_root = Path(web.__file__).parent / "static"
    html = (static_root / "index.html").read_text(encoding="utf-8")
    javascript = (static_root / "app.js").read_text(encoding="utf-8")
    assert 'id="open-emoji-library"' in html
    assert 'id="emoji-search"' in html
    assert '["building","item"].includes(state.type)' in javascript
    assert 'data-emoji-choice' in javascript


def test_tutorial_keeps_profession_and_zone_creation_in_simple_mode():
    static_root = Path(web.__file__).parent / "static"
    tutorial = (static_root / "tutorial-content.js").read_text(encoding="utf-8")
    javascript = (static_root / "app.js").read_text(encoding="utf-8")
    styles = (static_root / "tutorials.css").read_text(encoding="utf-8")
    assert '#add-simple-mechanic' in tutorial
    assert '[data-add-simple-zone]' in tutorial
    assert '#simple-profession-dialog' in tutorial
    assert 'id="add-simple-action"' in javascript
    assert 'backdrop-filter:none!important' in styles


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


def test_web_queues_server_install_and_building_publication(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "discord-web.db")
    store.initialize()
    building = store.save("building", "new_inn", {"name": "Nouvelle auberge", "actions": []})
    monkeypatch.setattr(web, "store", store)
    monkeypatch.setattr(web, "DEFINITIONS", [])
    monkeypatch.setattr(web, "import_v1", lambda _store: 0)

    with TestClient(web.app) as client:
        headers = {"Authorization": "Bearer change-me"}
        install = client.post("/api/admin/discord/provision", headers=headers, json={"scope": "server"})
        assert install.status_code == 200
        assert install.json()["status"] == "pending"

        status = client.get("/api/admin/discord/provision/status", headers=headers)
        assert status.status_code == 200
        assert status.json()["scope"] == "server"

        published = client.post(
            f"/api/content/building/new_inn/{building['version']}/publish",
            headers=headers,
            json={},
        )
        assert published.status_code == 200
        latest = store.discord_provision_status()
        assert latest["scope"] == "building"
        assert latest["building_key"] == "new_inn"
        assert latest["status"] == "pending"


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
    assert 'Comment construire une mécanique ?' in script
    assert 'building_mechanics' in script
    assert 'id="wizard-back"' in html
    assert "building-presets.js" in html
    for preset in ("harvest", "production", "commerce", "social", "administration", "custom"):
        assert f'key: "{preset}"' in presets
    assert 'data-duplicate=' in script
    assert 'data-delete=' in script
    assert 'openEditor(entity,true)' in script
    assert 'response.status===409' in script
    assert 'expected_version:latest.version' in script
    assert 'id="audio-preview-player" controls' in script
    assert 'function closeAudioPreview()' in script
    assert 'function itemMenuPicker(component)' in script
    assert 'data-item-menu-search' in script
    assert 'data-item-menu-category' in script
    assert 'data-item-menu-sort' in script
    assert 'interaction:{type:"purchase",item_key:key}' in script
    assert 'function catalogOptions(type, currentValue="")' in script
    assert 'Choisir une ressource…' in script
    assert 'id="profession-modules"' in script
    assert 'id="activity-modules"' in script
    assert 'outcome-effects' in script
    assert 'condition-editors' in script
    assert 'delivery-modules' in script
    assert 'Ajouter une ressource livrable' in script
    assert 'delivery_event_success' in script
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
    assert 'id="product-modules"' in script
    assert 'id="recipe-modules"' in script
    assert 'id="rumor-modules"' in script
    assert 'id="game-modules"' in script
    assert 'Issues gagnantes' in script
    assert 'function bindItemSelectors' in script
    assert 'Contenu de l’embed' in script
    assert 'Boutons et menus' in script
    assert 'PREDEFINED_INTERACTIONS' in script
    assert 'data-component-preset' in script
    assert 'interaction:{type:"refresh"}' in script
    assert 'interaction:{type:"close"}' in script
    assert 'building_inventory: {name:"Inventaire du bâtiment"' in script
    assert 'Schéma de liaison des pages' in script
    assert 'data-graph-page' in script
    assert 'page-graph-edge' in script
    assert 'Attribuer / rejoindre le métier' in script
    assert 'effect_profession_operation' in script
    assert 'Un message n’a pas de quantité' in script
    assert 'Récompenses remises à la récupération' in script
    assert 'Points d’expérience gagnés' in script
    assert 'add-scheduled-effect' in script
    assert 'Actions générées depuis les modules' in script
    assert 'clone(state.buildingBase || {})' in script
    assert 'data-type="interface"' not in html
    assert 'data-type="dashboard"' in html
    assert 'data-type="supervision"' in html
    assert 'data-type="settings"' in html
    assert 'data-nav-group="world"' in html
    assert 'data-nav-group="gameplay"' in html
    assert 'data-nav-group="tools"' in html
    assert 'data-nav-submenu="world"' in html
    # La navigation de production ne présente plus de commandes factices.
    assert 'Quêtes <small>À venir</small>' not in html
    assert 'Test / Simulation <small>À venir</small>' not in html
    assert 'id="theme-toggle"' in html
    assert 'localStorage.getItem("kingdomTheme")' in html
    assert 'function applyTheme(theme, persist=false)' in script
    assert 'data-building-tab="visual"' in script
    assert 'id="interaction-grid"' in script
    assert 'draggable="true"' in script
    assert 'interaction_type' in script
    assert 'loadDashboard' in script
    assert 'loadSupervision' in script
    assert 'loadSettings' in script
    assert 'data-supervision-tab="services"' in script
    assert 'data-settings-tab="onboarding"' in script
    assert 'Relations du bâtiment' in script
    assert 'data-field="relation_primary_profession"' in script
    assert 'id="create-related-profession"' in script
    assert 'data-field="relation_bot_key"' in script
    assert 'data-field="relation_ambience_key"' in script
    assert 'function persistBuildingBotRelation' in script
    assert 'menu.hidden=false' in script
    assert 'openNavigationGroup(parent?.dataset.navSubmenu||"")' in script
    assert "else{$$('[data-nav-submenu]').forEach(menu=>menu.hidden=true)" not in script
    assert 'data-building-tab="overview"' in script
    assert 'data-building-tab="advanced"' in script
    assert 'data-open-building-tab="visual"' in script
    assert 'function gameplayProjection()' in script
    assert 'id="simple-gameplay-root"' in script
    assert 'id="advanced-gameplay-root"' in script
    assert 'data-gameplay-toggle="simple"' in script
    assert 'function openSimpleZoneEditor(index,discardOnCancel=false)' in script
    assert 'cancelZoneCreation' in script
    assert 'activityElement.remove();refreshSimpleGameplay()' in script
    assert 'module_activity_duration' in script
    assert 'module_activity_energy' in script
    assert 'Configuration technique générée' in script
    assert 'id="add-simple-result"' in script
    assert 'function openSimpleResultEditor' in script
    assert 'function openSimpleProfessionEditor' in script
    assert 'function openSimpleRecipeEditor' in script
    assert 'function openSimpleDeliveryEditor' in script
    assert 'function openSimpleProductEditor' in script
    assert 'id="add-simple-recipe"' in script
    assert 'id="add-simple-delivery"' in script
    assert 'openSimpleActionEditor(Number(button.dataset.simpleAction))' in script
    assert 'function simpleAudioMarkup' in script
    assert 'function openSimpleSfxEditor' in script
    assert 'global_ambience' in script
    assert 'function derivedBuildingRelationsMarkup' in script
    assert 'RELATIONS DÉRIVÉES' in script
    assert 'function simpleDiscordMarkup' in script
    assert 'function openSimplePageEditor' in script
    assert 'function openSimpleComponentEditor' in script
    assert 'className=\'grouped-deliveries\'' in script
    assert 'outcome_effect_min' in script
    assert 'outcome_effect_max' in script
    assert 'id="dissociate-building-bot"' in script
    assert 'id="remove-building-ambience"' in script
    assert 'function markEditorDirty()' in script
    assert 'beforeunload' in script


def test_building_relations_survive_edit_without_losing_legacy_data(tmp_path):
    store = ContentStore(tmp_path / "relations.db")
    store.initialize()
    legacy = {
        "name": "Boulangerie",
        "description": "Ancienne définition",
        "custom_legacy_value": {"keep": True},
        "modules": {"professions": [{"key": "baker", "name": "Boulanger"}]},
        "actions": [],
    }
    first = store.save("building", "bakery", legacy)
    edited = dict(first["payload"])
    edited["relations"] = {"primary_profession_key": "baker", "ambience_audio_key": "bakery_day"}
    second = store.save("building", "bakery", edited, expected_version=first["version"])

    assert second["payload"]["relations"]["primary_profession_key"] == "baker"
    assert second["payload"]["modules"] == legacy["modules"]
    assert second["payload"]["custom_legacy_value"] == {"keep": True}


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


def test_secondary_server_receives_missing_voice_bot_templates(tmp_path):
    principal = ContentStore(tmp_path / "principal.db")
    principal.initialize()
    draft = principal.save("bot", "voice_bard", {
        "name": "Barde", "bot_type": "voice", "token_env": "BARD_BOT_TOKEN",
        "application_id_env": "BARD_APPLICATION_ID", "voice_channel_id": "42", "enabled": True,
    })
    principal.publish("bot", "voice_bard", draft["version"])
    stores = web.MagasinsServeurs(principal)
    secondary_path = tmp_path / "secondary.db"

    secondary = stores.selectionner({"database_path": str(secondary_path)})
    copied = secondary.get("bot", "voice_bard", published=True)

    assert copied["payload"]["bot_type"] == "voice"
    assert copied["payload"]["application_id_env"] == "BARD_APPLICATION_ID"


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
    payload["onboarding"]["starting_money"] = 250
    with TestClient(web.app) as client:
        headers = {"Authorization": "Bearer change-me"}
        response = client.post("/api/server/settings", headers=headers, json={"payload": payload, "expected_version": 1})
    assert response.status_code == 200
    assert response.json()["status"] == "published"
    assert store.get("server_settings", "kingdom_server", published=True)["payload"]["roles"]["player"] == "⚔️ Habitants assermentés"
    assert store.get("server_settings", "kingdom_server", published=True)["payload"]["onboarding"]["starting_money"] == 250


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


def test_interactive_tutorial_supports_real_actions_and_stable_building_targets():
    static = Path(web.__file__).with_name("static")
    script = (static / "tutorial-engine.js").read_text(encoding="utf-8")
    content = (static / "tutorial-content.js").read_text(encoding="utf-8")
    app_script = (static / "app.js").read_text(encoding="utf-8")
    styles = (static / "tutorials.css").read_text(encoding="utf-8")

    assert 'tutorial-mode-blocked' in script
    assert 'tutorial-mode-target' in script
    assert 'tutorial-mode-free' in script
    assert 'function notify(event,value=null)' in script
    assert 'function observeRealInteraction(event)' in script
    assert 'new MutationObserver' in script
    assert 'data-tutorial-skip>Passer cette étape' in script
    assert 'data-tutorial-stop>Quitter' in script
    assert 'completion:{event:"building_editor_opened"}' in content
    assert 'completion:{event:"building_tab_changed",value:"relations"}' in content
    assert 'id:"actions"' in content
    assert 'id:"discord_interface"' in content
    assert 'id:"weather"' in content
    assert 'id:"events"' in content
    assert 'selector:"#add-simple-action"' in content
    assert 'selector:"#add-weather-option"' in content
    assert 'selector:"#add-event-audio-layer"' in content
    assert 'data-tutorial="building-open"' in app_script
    assert 'data-tutorial="building-tab-relations"' in app_script
    assert 'KingdomTutorials.notify("building_editor_opened"' in app_script
    assert 'KingdomTutorials.notify("building_tab_changed"' in app_script
    assert 'KingdomTutorials.notify("content_saved"' in app_script
    assert '.tutorial-mode-target .tutorial-target' in styles
    assert 'pointer-events:auto!important' in styles
