from KingdomData import ContentStore
from import_v1 import actions_from_modules, definitions_from_v1, import_v1


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
    assert buildings["mine"]["modules"]["activities"][0]["energy_cost"] == 15
    assert len(buildings["forest"]["modules"]["activities"]) == 6
    assert buildings["forge"]["modules"]["repairs"]["pickaxe_price_per_point"] == 2
    assert len(buildings["tavern"]["modules"]["products"]) == 22
    assert len(buildings["tavern"]["modules"]["rumors"]["catalogue"]) == 6
    assert len(buildings["royal_bridge"]["modules"]["construction"]["stages"]) == 3
    assert buildings["forge"]["modules"]["market_purchases"][0]["unit_price"] > 0
    assert all(building["action_mode"] == "generated" for building in buildings.values())
    assert all(building["interface"]["target_building_key"] == key for key, building in buildings.items())
    assert interfaces["ui_tavern"]["start_page"] == "home"
    assert any(component.get("interaction", {}).get("type") == "navigate" for component in interfaces["ui_tavern"]["pages"][0]["components"])
    assert any(component.get("interaction", {}).get("type") == "action" for page in interfaces["ui_tavern"]["pages"] for component in page["components"])

    forest_interface = buildings["forest"]["interface"]
    assert forest_interface["blueprint"] == "activity_professions_v1"
    assert [page["key"] for page in forest_interface["pages"]] == [
        "home", "camp", "inventory", "job_woodcutter", "job_hunter"
    ]
    camp_components = forest_interface["pages"][1]["components"]
    assert any(component.get("props", {}).get("label") == "Consulter mon inventaire" for component in camp_components)
    woodcutter_components = forest_interface["pages"][3]["components"]
    destinations = next(component for component in woodcutter_components if component["type"] == "select")
    assert [option["key"] for option in destinations["options"]] == [
        "royal_edge", "ancient_undergrowth", "deep_oakwood"
    ]
    assert all(option["interaction"]["type"] == "action" for option in destinations["options"])


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
