from KingdomData import ContentStore
from import_v1 import actions_from_modules, definitions_from_v1, import_v1, migrate_weighted_activity_results


def test_all_v1_buildings_items_and_voice_profiles_are_discovered():
    definitions = definitions_from_v1()
    buildings = {item["key"]: item["payload"] for item in definitions if item["type"] == "building"}
    interfaces = {item["key"]: item["payload"] for item in definitions if item["type"] == "interface"}
    assert set(buildings) == {"mine", "forest", "forge", "tavern", "royal_bridge"}
    assert set(interfaces) == {"ui_mine", "ui_forest", "ui_forge", "ui_tavern", "ui_royal_bridge"}
    assert len([item for item in definitions if item["type"] == "item"]) == 48
    assert len([item for item in definitions if item["type"] == "bot"]) == 5
    assert {item["key"] for item in definitions if item["type"] == "bot"} == {
        "voice_edgar", "voice_edouard", "voice_roland", "voice_sylvain", "voice_wagner"
    }
    voice_bots = sorted((item for item in definitions if item["type"] == "bot"), key=lambda item: item["payload"]["worker_number"])
    assert [item["payload"]["name"] for item in voice_bots] == [f"Voice Worker {index}" for index in range(1, 6)]
    assert [item["payload"]["token_env"] for item in voice_bots] == [f"VOICE_WORKER_{index}_TOKEN" for index in range(1, 6)]
    assert [item["payload"]["application_id_env"] for item in voice_bots] == [f"VOICE_WORKER_{index}_APPLICATION_ID" for index in range(1, 6)]
    assert buildings["mine"]["modules"]["activities"][0]["energy_cost"] == 15
    assert len(buildings["forest"]["modules"]["activities"]) == 6
    forest_outcome = buildings["forest"]["modules"]["activities"][0]["outcomes"][0]
    assert "effects" in forest_outcome
    assert {effect["type"] for effect in forest_outcome["effects"]} >= {"reward", "profession", "emit"}
    talk = next(action for action in buildings["forest"]["actions"] if action["key"] == "talk_npc")
    assert len(talk["effects"][0]["choices"]) == 5
    assert buildings["forge"]["modules"]["repairs"]["pickaxe_price_per_point"] == 2
    assert len(buildings["tavern"]["modules"]["products"]) == 22
    assert len(buildings["tavern"]["modules"]["rumors"]["catalogue"]) == 6
    assert len(buildings["royal_bridge"]["modules"]["construction"]["stages"]) == 3
    assert buildings["forge"]["modules"]["market_purchases"][0]["unit_price"] > 0
    assert all(building["action_mode"] == "generated" for building in buildings.values())
    assert all(building["interface"]["target_building_key"] == key for key, building in buildings.items())
    assert interfaces["ui_tavern"]["start_page"] == "home"
    assert interfaces["ui_tavern"]["blueprint"] == "hospitality_v1"
    tavern_components = {component["type"] for page in interfaces["ui_tavern"]["pages"] for component in page["components"]}
    assert {"dynamic_product_selector", "dynamic_consumable_selector", "dynamic_game_selector"} <= tavern_components
    beer = next(item["payload"] for item in definitions if item["type"] == "item" and item["key"] == "beer_86")
    assert {effect["type"] for effect in beer["consumption"]["effects"]} >= {"player_stat", "message"}
    assert any(component.get("interaction", {}).get("type") == "navigate" for component in interfaces["ui_tavern"]["pages"][0]["components"])
    assert any(component.get("interaction", {}).get("type") == "action" for page in interfaces["ui_tavern"]["pages"] for component in page["components"])

    forest_interface = buildings["forest"]["interface"]
    assert forest_interface["blueprint"] == "activity_professions_v7"
    page_keys = [page["key"] for page in forest_interface["pages"]]
    assert page_keys[:4] == ["home", "camp", "inventory", "job_woodcutter"]
    assert {"expedition_royal_edge", "expedition_ancient_undergrowth", "expedition_deep_oakwood", "job_hunter"} <= set(page_keys)
    camp_components = forest_interface["pages"][1]["components"]
    assert any(component.get("props", {}).get("label") == "Consulter mon inventaire" for component in camp_components)
    assert any(component.get("props", {}).get("label") == "Discuter avec Gaspard" for component in camp_components)
    assert any(component.get("interaction", {}).get("type") == "refresh" for component in camp_components)
    assert any(component.get("interaction", {}).get("type") == "close" for component in camp_components)
    assert any(component.get("type") == "dynamic_inventory_selector" for component in camp_components)
    assert any(component.get("interaction", {}).get("type") == "deliver_all" for component in camp_components)
    woodcutter_components = forest_interface["pages"][3]["components"]
    destinations = next(component for component in woodcutter_components if component["type"] == "select")
    assert [option["key"] for option in destinations["options"]] == [
        "royal_edge", "ancient_undergrowth", "deep_oakwood"
    ]
    assert all(option["interaction"]["type"] == "action" for option in destinations["options"])
    assert destinations["options"][0]["interaction"]["on_success_page"] == "expedition_royal_edge"
    expedition = next(page for page in forest_interface["pages"] if page["key"] == "expedition_royal_edge")
    claim = next(component for component in expedition["components"] if component["type"] == "button")
    assert claim["interaction"]["action"] == "claim_royal_edge"
    assert claim["interaction"]["on_success_page"] == "job_woodcutter"

    forge_interface = buildings["forge"]["interface"]
    assert forge_interface["blueprint"] == "workshop_market_v1"
    assert {page["key"] for page in forge_interface["pages"]} >= {"home", "shop", "repairs", "upgrades", "stock", "job", "recipes_tool", "recipes_weapon"}
    forge_labels = {component.get("props", {}).get("label") for page in forge_interface["pages"] for component in page["components"]}
    assert {"Commander", "Réparer un équipement", "Améliorer ma pioche", "Inventaire du bâtiment", "Devenir Forgeron", "Discuter avec Wagner", "Actualiser", "Quitter"} <= forge_labels
    assert any(component.get("interaction", {}).get("confirm") for page in forge_interface["pages"] for component in page["components"])
    assert any(component.get("type") == "dynamic_inventory_selector" for component in forge_interface["pages"][0]["components"])
    assert any(component.get("interaction", {}).get("type") == "deliver_all" for component in forge_interface["pages"][0]["components"])


def test_import_is_idempotent(tmp_path):
    store = ContentStore(tmp_path / "import.db")
    store.initialize()
    assert import_v1(store) == 63
    assert import_v1(store) == 0
    assert len(store.list("item", published=True)) == 48
    assert len(store.list("bot", published=True)) == 5
    assert len(store.list("building", published=True)) == 5
    assert len(store.list("interface", published=True)) == 5


def test_existing_v1_building_is_linked_without_losing_its_custom_parameters(tmp_path):
    store = ContentStore(tmp_path / "upgrade.db")
    store.initialize()
    draft = store.save("building", "mine", {"name": "Mine personnalisee", "source": "KingdomEngine V1", "custom_value": 42, "actions": []})
    store.publish("building", "mine", draft["version"])
    import_v1(store)
    upgraded = store.get("building", "mine", published=True)["payload"]
    assert upgraded["interface_key"] == "ui_mine"
    assert upgraded["interface"]["target_building_key"] == "mine"
    assert upgraded["name"] == "Mine personnalisee"
    assert upgraded["custom_value"] == 42


def test_incomplete_upgrade_does_not_break_generated_actions_or_supervision():
    actions = actions_from_modules("forge", {"upgrades": [{"name": "Brouillon incomplet"}]})
    assert actions == []


def test_existing_multi_profession_v1_building_is_upgraded_without_name_specific_logic(tmp_path):
    store = ContentStore(tmp_path / "weighted-upgrade.db"); store.initialize()
    payload = {"name": "Étendues", "source": "KingdomEngine V1", "action_mode": "generated", "custom_value": 42, "actions": [], "modules": {
        "rules": {"experience_per_level": 50},
        "professions": [{"key": "job_one"}, {"key": "job_two"}],
        "activities": [{"key": "zone_one", "profession": "job_one", "experience": 15, "outcomes": [{"key": "mixed", "weight": 2, "rewards": {"resource_one": [1, 2], "resource_two": 1}}]}],
        "products": [], "recipes": [], "deliveries": [], "upgrades": [],
    }}
    draft=store.save("building","wild_expanse",payload);store.publish("building","wild_expanse",draft["version"])
    assert migrate_weighted_activity_results(store) == 1
    upgraded=store.get("building","wild_expanse",published=True)["payload"]
    effects=upgraded["modules"]["activities"][0]["outcomes"][0]["effects"]
    assert upgraded["custom_value"] == 42
    assert [effect["type"] for effect in effects] == ["reward", "reward", "profession", "emit"]
    assert migrate_weighted_activity_results(store) == 0


def test_existing_forge_receives_workshop_interface_automatically(tmp_path):
    store = ContentStore(tmp_path / "forge-interface.db"); store.initialize()
    canonical = next(item["payload"] for item in definitions_from_v1() if item["type"] == "building" and item["key"] == "forge")
    old = {**canonical, "interface": {"name": "Ancienne interface", "target_building_key": "forge", "start_page": "home", "pages": [{"key": "home", "name": "Accueil", "components": [{"id": "old_hero", "type": "hero", "props": {"title": "Forge"}}]}]}}
    old.pop("interface_blueprint", None)  # format réellement présent dans les premières installations
    draft = store.save("building", "forge", old); store.publish("building", "forge", draft["version"])
    import_v1(store)
    migrated = store.get("building", "forge", published=True)["payload"]
    assert migrated["interface"]["blueprint"] == "workshop_market_v2"
    assert migrated["interface_texts"]["talk_label"] == "Discuter avec Wagner"
