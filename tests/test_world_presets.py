from KingdomData import ContentStore, default_server_settings, get_server_settings
from KingdomData.world_presets import PRESET_CATALOG, world_preset


def _seed(tmp_path, key):
    store = ContentStore(tmp_path / f"{key}.db")
    store.initialize()
    store.seed(world_preset(key))
    return store


def test_catalog_exposes_blank_medieval_and_space_starters():
    assert [preset["key"] for preset in PRESET_CATALOG] == [
        "blank", "medieval_kingdom", "space_station",
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
    assert store.get("bot", "realm_steward")["payload"]["bot_type"] == "text"
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


def test_unknown_preset_is_rejected():
    try:
        world_preset("unknown")
    except ValueError as exc:
        assert "inconnu" in str(exc)
    else:
        raise AssertionError("An unknown preset must not create a partially initialized world")
