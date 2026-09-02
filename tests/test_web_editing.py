from fastapi.testclient import TestClient
from pathlib import Path
import pytest

import KingdomWeb.app as web
from KingdomData import ContentStore, default_server_settings


@pytest.fixture(autouse=True)
def configured_legacy_admin_token(monkeypatch):
    monkeypatch.setenv("KINGDOM_ADMIN_TOKEN", "change-me")


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

        deleted = client.delete("/api/content/building/new_inn", headers=headers)
        assert deleted.status_code == 200
        assert deleted.json()["discord_sync"]["requested"] is True
        latest = store.discord_provision_status()
        assert latest["scope"] == "building"
        assert latest["building_key"] == "new_inn"
        assert latest["requested_by"] == "building-deletion"


def test_building_secondary_menu_does_not_open_the_editor():
    javascript = (Path(web.__file__).parent / "static" / "app.js").read_text(encoding="utf-8")
    assert 'event.target.closest(".building-card-actions details")' in javascript
    assert 'event.target.closest("details,summary")' in javascript
    assert 'event.target.closest("details,summary,.building-card-actions")' not in javascript
    assert '$$("#cards [data-edit]").forEach' in javascript
    assert "await openEditor(entity)" in javascript


def test_discord_connections_show_every_audio_bot_and_future_access_marker():
    static_root = Path(web.__file__).parent / "static"
    javascript = (static_root / "app.js").read_text(encoding="utf-8")
    styles = (static_root / "generation-v3.css").read_text(encoding="utf-8")
    assert "async function loadDiscordConnections" in javascript
    assert "Bots audio disponibles" in javascript
    assert "Tous les bots audio sont affichés" in javascript
    assert 'data-access-tier="included"' in javascript
    assert ".discord-connection-card.audio-connection" in styles


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
    assert '["light","dark","system"]' in script
    assert 'data-theme-choice="system"' in script
    assert 'id="platform-admin-entry"' in script
    assert 'account.platform_role!=="platform_admin"' in script
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


def test_discord_status_includes_unpublished_audio_bots(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "draft-bot-status.db")
    store.initialize()
    store.save("bot", "voice_draft", {
        "name": "Voix en préparation", "bot_type": "voice",
        "token_env": "DRAFT_VOICE_TOKEN", "application_id_env": "DRAFT_VOICE_APPLICATION_ID",
        "voice_channel_id": "42", "enabled": False,
    })
    monkeypatch.setattr(web, "store", store)
    with TestClient(web.app) as client:
        response = client.get("/api/bots/status", headers={"Authorization": "Bearer change-me"})
    assert response.status_code == 200
    draft = next(item for item in response.json() if item["key"] == "voice_draft")
    assert draft["enabled"] is False


def test_voice_worker_status_accepts_legacy_secret_during_migration(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "worker-status.db"); store.initialize()
    draft = store.save("bot", "voice_worker_test", {
        "name": "Voice Worker 1", "bot_type": "voice", "voice_channel_id": "42",
        "token_env": "VOICE_WORKER_1_TOKEN", "application_id_env": "VOICE_WORKER_1_APPLICATION_ID",
        "legacy_token_env": "EDGAR_BOT_TOKEN", "legacy_application_id_env": "EDGAR_APPLICATION_ID",
    }); store.publish("bot", "voice_worker_test", draft["version"])
    monkeypatch.setattr(web, "store", store)
    monkeypatch.setenv("EDGAR_BOT_TOKEN", "legacy-token")
    monkeypatch.setenv("EDGAR_APPLICATION_ID", "123456789012345678")
    with TestClient(web.app) as client:
        statuses = client.get("/api/bots/status", headers={"Authorization": "Bearer change-me"}).json()
        status = next(item for item in statuses if item["key"] == "voice_worker_test")
    assert status["token_configured"] is True
    assert status["application_id_configured"] is True


def test_voice_worker_avatar_is_stored_and_served(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "worker-avatar.db"); store.initialize()
    draft = store.save("bot", "voice_worker_test", {
        "name": "Voice Worker 1", "bot_type": "voice", "token_env": "VOICE_WORKER_1_TOKEN",
        "voice_channel_id": "42",
    }); published = store.publish("bot", "voice_worker_test", draft["version"])
    monkeypatch.setattr(web, "store", store)
    monkeypatch.setattr(web, "KINGDOM_DATA_ROOT", tmp_path)
    monkeypatch.setattr(web, "BOT_AVATAR_ASSETS", tmp_path / "assets" / "bot-avatars")
    headers = {"Authorization": "Bearer change-me"}
    with TestClient(web.app) as client:
        uploaded = client.post("/api/bots/voice_worker_test/avatar", headers=headers, files={"file": ("worker.png", b"fake-png", "image/png")})
        assert uploaded.status_code == 200
        payload = {**published["payload"], "avatar_path": uploaded.json()["avatar_path"]}
        saved = client.post("/api/content/bot/voice_worker_test", headers=headers, json={"payload": payload, "expected_version": published["version"]}).json()
        client.post(f'/api/content/bot/voice_worker_test/{saved["version"]}/publish', headers=headers, json={})
        avatar = client.get("/api/bots/voice_worker_test/avatar", headers=headers)
    assert avatar.status_code == 200
    assert avatar.content == b"fake-png"


def test_voice_worker_identity_fields_are_available_in_kingdomweb():
    script = (Path(web.__file__).parent / "static" / "app.js").read_text(encoding="utf-8")
    for marker in ("server_nickname", "server_bio", "bot-avatar-file", "uploadBotAvatar"):
        assert marker in script


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


def test_reference_building_is_an_isolated_rich_academy_demo():
    from seed import DEFINITIONS, REFERENCE_BUILDING

    assert not any(row["type"] == "building" and row["key"] == "nocode_academy" for row in DEFINITIONS)
    assert REFERENCE_BUILDING["is_reference"] is True
    assert REFERENCE_BUILDING["modules"]["professions"]
    assert len(REFERENCE_BUILDING["modules"]["professions"]) >= 2
    assert len(REFERENCE_BUILDING["modules"]["activities"]) >= 2
    assert REFERENCE_BUILDING["modules"]["activities"][0]["outcomes"]
    assert len(REFERENCE_BUILDING["modules"]["activities"][0]["outcomes"][1]["effects"]) >= 3
    assert REFERENCE_BUILDING["modules"]["audio"]["groups"]
    assert REFERENCE_BUILDING["modules"]["upgrades"]
    assert REFERENCE_BUILDING["modules"]["repairs"]
    assert len(REFERENCE_BUILDING["academy_showcase"]["chapters"]) >= 6
    assert REFERENCE_BUILDING["interface"]["pages"]

    static = Path(web.__file__).with_name("static")
    script = (static / "app.js").read_text(encoding="utf-8")
    assert "/api/tutorials/reference-building" in script
    assert "installReferenceAcademyCard" in script
    assert '$("#save").hidden=true' in script


def test_reference_building_cannot_be_saved_or_published_through_world_api(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "reference-protection.db"); store.initialize()
    monkeypatch.setattr(web, "store", store)
    with TestClient(web.app) as client:
        headers = {"Authorization": "Bearer change-me"}
        saved = client.post(
            "/api/content/building/nocode_academy", headers=headers,
            json={"payload": {"name": "Copie interdite", "is_reference": True}},
        )
        assert saved.status_code == 422
        legacy = store.save("building", "legacy_demo", {"name": "Ancienne démo", "is_reference": True})
        published = client.post(
            f"/api/content/building/legacy_demo/{legacy['version']}/publish", headers=headers,
        )
        assert published.status_code == 422
        assert store.get("building", "legacy_demo")["status"] == "draft"


def test_reference_building_is_filtered_from_game_engine(tmp_path):
    from kingdomCore.engine import GameEngine

    store = ContentStore(tmp_path / "reference.db"); store.initialize()
    normal = store.save("building", "forge", {"name": "Forge", "actions": []})
    store.publish("building", "forge", normal["version"])
    demo = store.save("building", "nocode_academy", {"name": "Atelier", "is_reference": True, "actions": []})
    store.publish("building", "nocode_academy", demo["version"])
    assert [row["entity_key"] for row in GameEngine(store).buildings()] == ["forge"]


def test_voice_presence_has_a_real_client_ui_and_hides_worker_details():
    static = Path(web.__file__).with_name("static")
    page = (static / "index.html").read_text(encoding="utf-8")
    script = (static / "app.js").read_text(encoding="utf-8")
    styles = (static / "voice-presence.css").read_text(encoding="utf-8")
    assert 'data-type="voice_presence"' in page
    assert "loadVoicePresenceStudio" in script
    assert "openVoicePresenceDialog" in script
    assert "openVoiceProfileDialog" in script
    assert "Une capacité audio, plusieurs identités" in script
    assert "Aucune présence vocale" in script
    assert "worker_01" not in script
    assert ".voice-presence-grid" in styles
    assert "@media(max-width:760px)" in styles


def test_navigation_uses_generic_world_editor_vocabulary():
    static = Path(web.__file__).with_name("static")
    page = (static / "index.html").read_text(encoding="utf-8")
    assert "Entités & lieux" in page


def test_navigation_and_dark_theme_remain_available_in_desktop_and_mobile_shells():
    static = Path(web.__file__).with_name("static")
    page = (static / "index.html").read_text(encoding="utf-8")
    script = (static / "app.js").read_text(encoding="utf-8")
    styles = (static / "generation-v3.css").read_text(encoding="utf-8")
    assert 'id="sidebar-theme"' in page
    assert '$('# + '"nav"' + ').addEventListener("click"' in script
    assert 'applyTheme(current==="dark"?"light":"dark",true)' in script
    assert ':root[data-theme="dark"]' in styles
    assert '--accent:#24945f' in styles
    assert '--violet:#7667d8' in styles
    assert '[hidden]{display:none!important}' in styles
    assert "Espaces interactifs" in page
    assert "Objets & ressources" in page
    assert "Temps & calendrier" in page
    assert "Présences vocales" in page


def test_building_and_item_editors_keep_full_size_workspaces_and_profession_delete():
    static = Path(web.__file__).with_name("static")
    script = (static / "app.js").read_text(encoding="utf-8")
    styles = (static / "premium-builder.css").read_text(encoding="utf-8")
    assert 'classList.add("item-mode")' in script
    assert "data-workbench-building" in script
    assert "data-delete-profession" in script
    assert ".wizard-panel.building-mode .editor-layout" in styles
    assert "grid-template-columns:260px minmax(640px,1fr) 330px" in styles
    assert ".wizard-panel.item-mode" in styles
    assert ".building-workbench-nav header{display:grid" in styles
    assert "word-break:normal" in styles
    assert ".wizard-panel.item-mode .emoji-input-row{grid-template-columns:72px minmax(145px,1fr)" in styles


def test_profession_delete_detaches_its_building_mechanics(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "profession-delete.db"); store.initialize()
    profession = store.save("profession", "woodcutter", {"name": "Bûcheron", "emoji": "🪓"})
    store.publish("profession", "woodcutter", profession["version"])
    building = store.save("building", "forest", {
        "name": "Forêt", "relations": {"primary_profession_key": "woodcutter"},
        "modules": {
            "professions": [{"key": "woodcutter", "name": "Bûcheron"}],
            "activities": [{"key": "chop", "name": "Couper du bois", "profession": "woodcutter", "outcomes": []}],
        },
        "actions": [
            {"key": "join_woodcutter", "name": "Devenir bûcheron", "effects": [{"type": "profession_join", "profession": "woodcutter"}]},
            {"key": "look", "name": "Observer", "effects": [{"type": "message", "text": "Silence."}]},
        ],
    })
    store.publish("building", "forest", building["version"])
    monkeypatch.setattr(web, "store", store)
    with TestClient(web.app) as client:
        response = client.delete("/api/world/professions/woodcutter", headers={"Authorization": "Bearer change-me"})
    assert response.status_code == 200
    result = response.json()
    assert result["updated_buildings"] == ["forest"]
    updated = store.get("building", "forest", published=True)["payload"]
    assert updated["modules"]["professions"] == []
    assert updated["modules"]["activities"] == []
    assert [action["key"] for action in updated["actions"]] == ["look"]
    assert updated["relations"]["primary_profession_key"] == ""
