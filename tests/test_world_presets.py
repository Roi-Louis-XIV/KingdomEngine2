import pytest

from KingdomData import ContentStore, default_server_settings, get_server_settings
from KingdomData.world_presets import PRESET_CATALOG, world_preset
from KingdomWeb.world_creator import WorldCreatorService


def _seed(tmp_path, key):
    store = ContentStore(tmp_path / f"{key}.db")
    store.initialize()
    store.seed(world_preset(key))
    return store


def test_catalog_exposes_blank_medieval_and_space_starters():
    assert [preset["key"] for preset in PRESET_CATALOG] == [
        "blank", "medieval_kingdom", "royal_festival", "space_station",
    ]
    assert all(preset["name"] and preset["description"] for preset in PRESET_CATALOG)


def test_blank_preset_contains_only_world_settings(tmp_path):
    store = _seed(tmp_path, "blank")
    assert len(store.list("server_settings", published=True)) == 1
    assert store.list("building") == []
    assert store.list("location") == []
    assert store.list("event") == []
    onboarding = store.get("server_settings", "kingdom_server", published=True)["payload"]["onboarding"]
    assert onboarding["title"] == "Bienvenue dans ce monde"
    assert onboarding["action_name"] == "validation d'arrivée"
    assert onboarding["currency_label"] == "unités"


def test_medieval_preset_is_a_complete_editable_vertical_slice(tmp_path):
    store = _seed(tmp_path, "medieval_kingdom")
    assert {row["entity_key"] for row in store.list("building", published=True)} == {
        "market_square", "forester_lodge", "deep_mine", "royal_forge", "healers_garden",
    }
    assert len(store.list("item", published=True)) == 22
    assert {row["entity_key"] for row in store.list("profession", published=True)} == {"forester", "miner", "blacksmith", "herbalist"}
    assert len(store.list("event", published=True)) == 4
    assert store.get("environment", "realm_climate")["payload"]["calendar"]["months"]
    assert not [
        item for item in store.list("bot")
        if item["payload"].get("name") == "Intendant du Royaume"
    ]
    onboarding = store.get("server_settings", "kingdom_server", published=True)["payload"]["onboarding"]
    assert onboarding["title"] == "Le Serment de la Sainte Pelle"
    assert onboarding["currency_label"] == "écus"


def test_space_preset_uses_the_same_generic_engine_primitives(tmp_path):
    store = _seed(tmp_path, "space_station")
    assert {row["entity_key"] for row in store.list("building", published=True)} == {
        "command_deck", "engineering_bay", "expedition_airlock", "hydroponics_lab", "xenoscience_lab",
    }
    assert len(store.list("item", published=True)) == 20
    assert len(store.list("profession", published=True)) == 4
    assert len(store.list("event", published=True)) == 4
    action = store.get("building", "expedition_airlock")["payload"]["actions"][1]
    assert action["effects"][1]["type"] == "random_result"
    assert len(action["effects"][1]["outcomes"][1]["effects"]) == 4
    assert store.get("environment", "orbital_environment")["payload"]["conditions"][1]["key"] == "solar_storm"
    onboarding = store.get("server_settings", "kingdom_server", published=True)["payload"]["onboarding"]
    assert onboarding["title"] == "Protocole d'intégration de l'équipage"
    assert onboarding["button_label"] == "Valider mon accréditation"
    assert onboarding["currency_label"] == "crédits orbitaux"


def test_royal_festival_matches_the_playable_demo_brief(tmp_path):
    store = _seed(tmp_path, "royal_festival")
    settings = get_server_settings(store)
    live_ops = settings["live_ops"]
    assert len(live_ops["objectives"]) == 6
    assert live_ops["scenario_duration_minutes"] == 180
    assert [step["minute"] for step in live_ops["timeline"]] == [0,45,70,90,110,125,135,170,180]
    assert len(store.list("building", published=True)) == 7
    assert {"edgar_tavern","festival_farm","festival_esplanade"} <= {row["entity_key"] for row in store.list("building", published=True)}
    assert {"edgar", "roland", "wagner", "sylvain", "agathe", "maelis"} == {
        row["entity_key"] for row in store.list("npc", published=True)
    }
    assert len(store.list("voice_profile", published=True)) == 6
    assert all(row["payload"].get("voice_presence_key") for row in store.list("npc", published=True))
    with store.connection() as db:
        db.execute("INSERT INTO players(discord_id,money,energy,updated_at,display_name,created_at) VALUES('42',100,80,'now','Louis','now')")
        db.execute("INSERT INTO action_log(interaction_id,discord_id,building_key,action_key,result_json,created_at) VALUES('festival-1','42','edgar_tavern','prepare_drinks','{}','2026-09-09T12:00:00+00:00')")
        db.execute("INSERT INTO collective_contributions(objective_key,discord_id,building_key,resource_key,amount,metadata_json,created_at) VALUES('drinks','42','festival_esplanade','festival_drink_crate',2,'{}','2026-09-09T12:00:00+00:00')")
    live_ops = WorldCreatorService(store).live_operations()
    drinks = next(item for item in live_ops["objectives"] if item["key"] == "drinks")
    assert drinks["current"] == 2 and len(live_ops["timeline"]) == 9


def test_royal_festival_relations_and_gdd_screens_are_complete(tmp_path):
    store = _seed(tmp_path, "royal_festival")
    buildings = {row["entity_key"]: row["payload"] for row in store.list("building", published=True)}
    required_pages = {
        "market_square": "preparations", "edgar_tavern": "kitchen",
        "deep_mine": "incident", "royal_forge": "festival_orders",
        "forester_lodge": "rain_resources", "festival_farm": "mill",
        "festival_esplanade": "storm_alert",
    }
    for key, page in required_pages.items():
        assert page in {entry["key"] for entry in buildings[key]["interface"]["pages"]}
    assert any(effect.get("type") == "contribution" for building in buildings.values() for action in building["actions"] for effect in action["effects"])
    assert any(building.get("modules", {}).get("recipes") for building in buildings.values())
    assert any(building.get("modules", {}).get("deliveries") for building in buildings.values())
    for npc in store.list("npc", published=True):
        payload = npc["payload"]
        assert payload["building_key"] in buildings
        assert payload["voice_profile_key"] and payload["voice_presence_key"]
        assert any(reaction["trigger"] == "activity_success" for reaction in payload["reactions"])


def test_royal_festival_professions_commerce_and_three_hour_timeline_are_operational(tmp_path):
    store = _seed(tmp_path, "royal_festival")
    buildings = {row["entity_key"]: row["payload"] for row in store.list("building", published=True)}

    for building_key, profession_key in {
        "forester_lodge": "forester",
        "deep_mine": "miner",
        "royal_forge": "blacksmith",
        "edgar_tavern": "innkeeper",
        "festival_farm": "farmer",
    }.items():
        actions = buildings[building_key]["actions"]
        assert any(any(effect.get("type") == "profession_join" for effect in action["effects"]) for action in actions)
        assert any(any(effect.get("type") == "profession_leave" for effect in action["effects"]) for action in actions)
        assert buildings[building_key]["modules"]["activities"]
        assert buildings[building_key]["modules"]["products"]

    start = 1_900_000_000.0
    service = WorldCreatorService(store)
    started = service.start_live_operations(now=start)
    assert started["started"] is True and started["scheduled"] == 5
    assert service.start_live_operations(now=start + 10)["started"] is False
    occurrences = __import__("kingdomEvent.lifecycle", fromlist=["EventLifecycle"]).EventLifecycle(store).list(now=start)
    assert len(occurrences) == 5
    assert all(item["status"] == "scheduled" for item in occurrences)
    after_rain = __import__("kingdomEvent.lifecycle", fromlist=["EventLifecycle"]).EventLifecycle(store).list(now=start + 45 * 60)
    assert next(item for item in after_rain if item["event_key"] == "festival_rain")["status"] == "active"
    before_opening = next(item for item in after_rain if item["event_key"] == "festival_opening")
    assert before_opening["status"] == "scheduled"

    objectives = service.live_operations()["objectives"]
    with store.connection() as database:
        for objective in objectives:
            database.execute(
                "INSERT INTO collective_contributions(objective_key,discord_id,building_key,resource_key,amount,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)",
                (objective["key"], "collective", "festival_esplanade", objective["unit"], objective["target"], "{}", "2026-09-10T00:00:00+00:00"),
            )
    after_completion = __import__("kingdomEvent.lifecycle", fromlist=["EventLifecycle"]).EventLifecycle(store).list(now=start + 170 * 60)
    assert next(item for item in after_completion if item["event_key"] == "festival_opening")["status"] == "active"

    with store.connection() as database:
        runtime = database.execute(
            "SELECT value_json FROM world_runtime WHERE runtime_key='live_ops_scenario'"
        ).fetchone()
    assert runtime is not None


def test_playable_presets_link_pages_professions_tools_and_actions(tmp_path):
    for preset_key in ("medieval_kingdom", "space_station"):
        store = _seed(tmp_path, preset_key)
        item_keys = {row["entity_key"] for row in store.list("item", published=True)}
        profession_keys = {row["entity_key"] for row in store.list("profession", published=True)}
        for row in store.list("building", published=True):
            building = row["payload"]
            interface = building["interface"]
            page_keys = {page["key"] for page in interface["pages"]}
            assert {"home", "inventories"} <= page_keys
            action_buttons = {
                component["interaction"]["action"]
                for page in interface["pages"]
                for component in page["components"]
                if component.get("interaction", {}).get("type") == "action"
            }
            assert action_buttons == {action["key"] for action in building["actions"]}
            profession_key = building.get("relations", {}).get("primary_profession_key")
            if profession_key:
                assert profession_key in profession_keys
                assert building["modules"]["professions"][0]["key"] == profession_key
                required_item = building["modules"]["professions"][0]["required_item"]
                assert required_item in item_keys
                join = next(action for action in building["actions"] if any(effect.get("type") == "profession_join" for effect in action["effects"]))
                assert any(effect.get("resource") == required_item for effect in join["effects"])
            if building["modules"]["products"]:
                assert "shop" in page_keys


def test_historic_oath_keeps_its_medieval_currency_label(tmp_path):
    store = ContentStore(tmp_path / "historic-oath.db")
    store.initialize()
    payload = default_server_settings()
    payload["onboarding"]["title"] = "Ancien Serment du Royaume"
    payload["onboarding"].pop("action_name")
    payload["onboarding"].pop("currency_label")
    draft = store.save("server_settings", "kingdom_server", payload)
    store.publish("server_settings", "kingdom_server", draft["version"])
    onboarding = get_server_settings(store)["onboarding"]
    assert onboarding["action_name"] == "serment"
    assert onboarding["currency_label"] == "écus"


@pytest.mark.parametrize("preset_key", ["medieval_kingdom", "royal_festival", "space_station"])
def test_playable_templates_install_audio_groups_and_automatic_presences(tmp_path, preset_key):
    store = _seed(tmp_path, preset_key)
    assert store.list("audio", published=True)
    assert store.list("audio_group", published=True)
    presences = store.list("voice_presence", published=True)
    assert presences
    assert all(item["payload"]["assignment_mode"] == "automatic" for item in presences)


def test_unknown_preset_is_rejected():
    try:
        world_preset("unknown")
    except ValueError as exc:
        assert "inconnu" in str(exc)
    else:
        raise AssertionError("An unknown preset must not create a partially initialized world")
