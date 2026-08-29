import json

import pytest
from fastapi.testclient import TestClient

import KingdomWeb.app as web
from KingdomData import ContentStore, NotFoundError, ValidationError
from KingdomWeb.player_admin import PlayerAdministrationService


def prepared_store(tmp_path):
    store = ContentStore(tmp_path / "players.db"); store.initialize()
    now = "2026-08-15T10:00:00+00:00"
    item = store.save("item", "test_wood", {"name": "Bois", "emoji": "🪵", "category": "resource"}); store.publish("item", "test_wood", item["version"])
    axe = store.save("item", "test_axe", {"name": "Hache", "emoji": "🪓", "category": "tool"}); store.publish("item", "test_axe", axe["version"])
    # Le catalogue des métiers provient bien des données bâtiment, sans classe dédiée.
    with store.connection() as db:
        payload={"name":"Atelier test","modules":{"professions":[{"key":"tester","name":"Testeur","experience_per_level":100},{"key":"other","name":"Autre métier","experience_per_level":50}]}}
        db.execute("INSERT INTO content VALUES(?,?,?,?,?,?,?,NULL,NULL)",("building","test_workshop",1,"published",json.dumps(payload),"test",now))
        db.execute("INSERT INTO players(discord_id,money,energy,updated_at,display_name,created_at) VALUES(?,?,?,?,?,?)",("42",100,80,now,"Louis",now))
    return store


def test_consultation_search_and_missing_player(tmp_path):
    service=PlayerAdministrationService(prepared_store(tmp_path))
    assert service.list_players(search="lou")["players"][0]["discord_id"] == "42"
    assert service.player("42")["player"]["money"] == 100
    with pytest.raises(NotFoundError): service.player("404")


def test_money_inventory_and_audit(tmp_path):
    service=PlayerAdministrationService(prepared_store(tmp_path))
    service.resource("42",{"resource":"money","operation":"add","amount":50,"reason":"Compensation bug"},"admin")
    service.inventory("42",{"item_key":"test_wood","operation":"add","amount":5,"reason":"Récompense oubliée"},"admin")
    service.inventory("42",{"item_key":"test_wood","operation":"remove","amount":2,"reason":"Correction quantité"},"admin")
    detail=service.player("42")
    assert detail["player"]["money"] == 150
    assert detail["inventory"][0]["quantity"] == 3
    assert len(detail["history"]["administration"]) == 3


def test_negative_inventory_rolls_back_without_audit(tmp_path):
    store=prepared_store(tmp_path); service=PlayerAdministrationService(store)
    with pytest.raises(ValidationError): service.inventory("42",{"item_key":"test_wood","operation":"remove","amount":1,"reason":"Test rollback"},"admin")
    with store.connection() as db:
        assert db.execute("SELECT COUNT(*) FROM inventory").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM admin_audit_log").fetchone()[0] == 0


def test_profession_exclusivity_and_xp_level(tmp_path):
    service=PlayerAdministrationService(prepared_store(tmp_path))
    service.profession("42",{"profession_key":"tester","operation":"join","reason":"Attribution test"},"admin")
    service.profession("42",{"profession_key":"tester","operation":"set_xp","experience":250,"reason":"Correction XP"},"admin")
    job=service.player("42")["professions"][0]
    assert (job["experience"],job["level"],job["active"]) == (250,3,1)
    with pytest.raises(ValidationError): service.profession("42",{"profession_key":"other","operation":"join","reason":"Exclusivité"},"admin")


def test_tool_durability_and_activity_cancel(tmp_path):
    store=prepared_store(tmp_path); service=PlayerAdministrationService(store)
    service.tool("42",{"tool_key":"test_axe","operation":"grant","max_durability":80,"level":2,"loot_bonus":15,"reason":"Outil de test"},"admin")
    service.tool("42",{"tool_key":"test_axe","operation":"update","durability":34,"max_durability":80,"level":2,"loot_bonus":15,"reason":"Usure corrigée"},"admin")
    with store.connection() as db:
        db.execute("INSERT INTO scheduled_actions(discord_id,building_key,action_key,ready_at,effects_json,status,created_at) VALUES(?,?,?,?,?,'pending',?)",("42","test_workshop","work",9999999999,"[]","2026-08-15")); activity_id=db.execute("SELECT last_insert_rowid()").fetchone()[0]
    service.activity("42",activity_id,{"operation":"cancel","reason":"Activité bloquée"},"admin")
    detail=service.player("42")
    assert detail["tools"][0]["durability"] == 34
    assert detail["activities"][0]["status"] == "cancelled"


def test_api_permissions(tmp_path, monkeypatch):
    store=prepared_store(tmp_path); monkeypatch.setattr(web,"store",store); monkeypatch.setattr(web,"DEFINITIONS",[]); monkeypatch.setattr(web,"import_v1",lambda _store:0)
    with TestClient(web.app) as client:
        assert client.get("/api/admin/players").status_code == 401
        assert client.post("/api/admin/players/42/resources",json={"resource":"money","operation":"add","amount":1,"reason":"Sans permission"}).status_code == 401
        response=client.post("/api/admin/players/42/resources",headers={"Authorization":"Bearer change-me","X-Kingdom-Admin":"louis"},json={"resource":"money","operation":"add","amount":1,"reason":"Test autorisé"})
        assert response.status_code == 200


def test_live_snapshot_unifies_tool_inventory_and_presence(tmp_path):
    store=prepared_store(tmp_path)
    with store.connection() as db:
        db.execute("INSERT INTO inventory VALUES('42','test_axe',1)")
        db.execute("INSERT INTO inventory VALUES('42','test_wood',12)")
        db.execute("INSERT INTO player_tools VALUES('42','test_axe',34,80,2,15)")
        db.execute("INSERT INTO player_professions VALUES('42','tester',4,320,1)")
        db.execute("INSERT INTO player_professions VALUES('42','other',2,90,0)")
        db.execute("INSERT INTO player_presence VALUES('42',1,'123','Mine','test_workshop','2026-08-15')")
        db.execute("INSERT INTO scheduled_actions(discord_id,building_key,action_key,ready_at,effects_json,status,created_at) VALUES('42','test_workshop','extract',9999999999,'[]','pending','2026-08-15')")
    player=PlayerAdministrationService(store).list_players()["players"][0]
    assert player["online"] is True and player["location"] == "Mine"
    assert player["current_activity"]["action_key"] == "extract"
    assert [(job["profession_key"],job["active"]) for job in player["professions"]] == [("tester",1),("other",0)]
    assert [item["item_key"] for item in player["inventory"]] == ["test_axe","test_wood"]
    assert player["inventory"][0]["tool_state"] == {"discord_id":"42","tool_key":"test_axe","durability":34,"max_durability":80,"level":2,"loot_bonus":15}
    assert sum(item["item_key"]=="test_axe" for item in player["inventory"]) == 1


def test_offline_and_empty_inventory_snapshot(tmp_path):
    player=PlayerAdministrationService(prepared_store(tmp_path)).list_players(status="offline")["players"][0]
    assert player["online"] is False
    assert player["location"] == "Aucun salon vocal"
    assert player["inventory"] == []


def test_tool_grant_and_inventory_removal_share_one_possession(tmp_path):
    service=PlayerAdministrationService(prepared_store(tmp_path))
    service.tool("42",{"tool_key":"test_axe","operation":"grant","max_durability":50,"reason":"Attribution outil"},"admin")
    assert service.player("42")["inventory"][0]["item_key"] == "test_axe"
    service.inventory("42",{"item_key":"test_axe","operation":"set","amount":0,"reason":"Retrait complet"},"admin")
    detail=service.player("42")
    assert detail["inventory"] == [] and detail["tools"] == []


def test_missing_inventory_reference_can_be_removed_but_not_added(tmp_path):
    store=prepared_store(tmp_path);service=PlayerAdministrationService(store)
    with store.connection() as db:
        db.execute("INSERT INTO inventory VALUES('42','deleted_legacy_item',2)")
    missing=service.player("42")["inventory"][0]
    assert missing["missing"] is True and missing["item_key"] == "deleted_legacy_item"
    service.inventory("42",{"item_key":"deleted_legacy_item","operation":"remove","amount":1,"reason":"Nettoyage référence cassée"},"admin")
    assert service.player("42")["inventory"] == []
    with pytest.raises(ValidationError):
        service.inventory("42",{"item_key":"deleted_legacy_item","operation":"add","amount":1,"reason":"Ajout interdit"},"admin")


def test_player_cards_keep_v1_ergonomics_and_live_refresh():
    from pathlib import Path
    root=Path(__file__).parents[1]
    script=(root/"KingdomWeb"/"static"/"app.js").read_text(encoding="utf-8")
    styles=(root/"KingdomWeb"/"static"/"players.css").read_text(encoding="utf-8")
    for marker in ("live-player-grid","live-player-card","Modifier ce joueur","unifiedInventory","document.hidden","5000"):
        assert marker in script
    assert "grid-template-columns:repeat(2" in styles
    assert "@media(max-width:1100px)" in styles


def test_oath_grants_configured_coins_once_and_saves_discord_identity(tmp_path):
    from types import SimpleNamespace
    from kingdomCore.discord_bot import grant_oath_reward
    class Avatar:
        url="https://cdn.example/avatar.png"
        def __str__(self): return "https://cdn.example/avatar.png"
    store=ContentStore(tmp_path/"oath.db");store.initialize()
    from KingdomData.server_settings import default_server_settings
    settings=default_server_settings();settings["onboarding"]["starting_money"]=275
    draft=store.save("server_settings","kingdom_server",settings);store.publish("server_settings","kingdom_server",draft["version"])
    member=SimpleNamespace(id=123,display_name="Louis",display_avatar=Avatar())
    assert grant_oath_reward(store,member) is True
    assert grant_oath_reward(store,member) is False
    with store.connection() as db:
        player=db.execute("SELECT money,display_name,avatar_url FROM players WHERE discord_id='123'").fetchone()
        assert tuple(player) == (275,"Louis","https://cdn.example/avatar.png")
        assert db.execute("SELECT COUNT(*) FROM onboarding_grants WHERE discord_id='123'").fetchone()[0] == 1


def test_action_conditions_hide_irrelevant_profession_buttons(tmp_path):
    from kingdomCore.discord_bot import InterfaceView
    from kingdomCore.engine import GameEngine
    store=ContentStore(tmp_path/"conditional-buttons.db");store.initialize()
    payload={"name":"Atelier","actions":[
        {"key":"join_job","name":"Devenir Artisan","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"artisan"}]},
        {"key":"leave_job","name":"Démissionner","conditions":{"type":"profession_active","profession":"artisan"},"effects":[{"type":"profession_leave","profession":"artisan"}]},
    ]}
    draft=store.save("building","condition_workshop",payload);store.publish("building","condition_workshop",draft["version"])
    definition={"name":"Atelier","target_building_key":"condition_workshop","start_page":"home","pages":[{"key":"home","name":"Accueil","components":[
        {"id":"join","type":"button","slot":0,"props":{"label":"Devenir Artisan"},"interaction":{"type":"action","building":"condition_workshop","action":"join_job"}},
        {"id":"leave","type":"button","slot":1,"props":{"label":"Démissionner"},"interaction":{"type":"action","building":"condition_workshop","action":"leave_job"}},
    ]}]}
    engine=GameEngine(store)
    assert [item.label for item in InterfaceView(engine,definition,owner_id=42).children] == ["Devenir Artisan"]
    import asyncio
    asyncio.run(engine.execute("42","condition_workshop","join_job","join-once"))
    assert [item.label for item in InterfaceView(engine,definition,owner_id=42).children] == ["Démissionner"]


def test_claim_button_is_grey_during_countdown_then_green(monkeypatch):
    import time
    import discord
    from kingdomCore.discord_bot import InterfaceView
    class Engine:
        def __init__(self,ready_at): self.ready_at=ready_at
        def pending_actions(self,_player,_building): return [{"action":"royal_edge","ready_at":self.ready_at}]
    definition={"name":"Forêt","target_building_key":"forest","start_page":"expedition","pages":[{"key":"expedition","name":"Expédition","components":[{"id":"claim_royal_edge","type":"button","slot":0,"props":{"label":"Récupérer : Lisière royale","style":"success"},"interaction":{"type":"action","building":"forest","action":"claim_royal_edge"}}]}]}
    waiting=InterfaceView(Engine(time.time()+30),definition,owner_id=42).children[0]
    assert waiting.disabled is True and waiting.style is discord.ButtonStyle.secondary
    assert "Expédition en cours" in waiting.label
    ready=InterfaceView(Engine(time.time()-1),definition,owner_id=42).children[0]
    assert ready.disabled is False and ready.style is discord.ButtonStyle.success
    assert ready.label == "Récupérer : Lisière royale"


def test_interface_reflows_select_when_explicit_slots_overlap_buttons():
    import discord
    from kingdomCore.discord_bot import InterfaceView

    definition = {"name": "Taverne", "target_building_key": "tavern", "start_page": "shop", "pages": [{
        "key": "shop", "name": "Comptoir", "components": [
            {"id": "order", "type": "button", "slot": 0, "props": {"label": "Commander"}, "interaction": {"type": "refresh"}},
            {"id": "products", "type": "select", "slot": 0, "props": {"placeholder": "Choisir"}, "options": [{"key": "beer", "label": "Bière"}]},
            {"id": "back", "type": "button", "slot": 1, "props": {"label": "Retour"}, "interaction": {"type": "refresh"}},
        ],
    }]}
    view = InterfaceView(object(), definition, owner_id=42)
    buttons = [item for item in view.children if isinstance(item, discord.ui.Button)]
    selector = next(item for item in view.children if isinstance(item, discord.ui.Select))
    assert [button.row for button in buttons] == [0, 0]
    assert selector.row == 1


def test_activity_interface_shows_locked_zones_but_filters_them_from_selector():
    import discord
    from import_v1 import definitions_from_v1
    from kingdomCore.discord_bot import InterfaceView

    forest = next(
        item["payload"] for item in definitions_from_v1()
        if item["type"] == "building" and item["key"] == "forest"
    )

    class Engine:
        def player(self, _player):
            return {"professions": {"woodcutter": {"level": 1, "experience": 0}}}

        def pending_actions(self, _player, _building):
            return []

    view = InterfaceView(Engine(), forest["interface"], page_key="job_woodcutter", owner_id=42)
    selector = next(child for child in view.children if isinstance(child, discord.ui.Select))
    accessible = [
        activity for activity in forest["modules"]["activities"]
        if activity.get("profession") == "woodcutter" and int(activity.get("required_level", 1)) <= 1
    ]
    assert len(selector.options) == len(accessible)
    assert all("Niv. 1" in (option.description or "") for option in selector.options)
    assert any("🔒 Niveau" in field.name for field in view.embed().fields)
    assert all(field.inline for field in view.embed().fields)


def test_animated_text_sequence_advances_and_applies_conditions():
    import time
    from kingdomCore.discord_bot import InterfaceView

    class Engine:
        def player(self, _player):
            return {"professions": {"woodcutter": {"level": 2, "experience": 0}}}

        def pending_actions(self, _player, _building):
            return []

    definition={"name":"Forêt","target_building_key":"forest","start_page":"story","pages":[{"key":"story","name":"Histoire","components":[{"id":"story_steps","type":"sequence","props":{"steps":[{"text":"Le vent se lève.","delay_seconds":0},{"text":"Un passage apparaît.","delay_seconds":2,"visible_when":{"profession_level":{"profession":"woodcutter","minimum":2}}}]}}]}]}
    view=InterfaceView(Engine(),definition,owner_id=42)
    assert view.embed().description == "Le vent se lève."
    view.page_started_at=time.time()-3
    assert view.embed().description == "Un passage apparaît."
