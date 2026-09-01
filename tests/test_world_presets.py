from KingdomData import ContentStore
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


def test_medieval_preset_is_a_complete_editable_vertical_slice(tmp_path):
    store = _seed(tmp_path, "medieval_kingdom")
    assert {row["entity_key"] for row in store.list("building", published=True)} == {
        "market_square", "forester_lodge", "deep_mine",
    }
    assert {row["entity_key"] for row in store.list("profession", published=True)} == {"forester", "miner"}
    assert store.get("environment", "realm_climate")["payload"]["calendar"]["months"]
    assert store.get("bot", "realm_steward")["payload"]["bot_type"] == "text"


def test_space_preset_uses_the_same_generic_engine_primitives(tmp_path):
    store = _seed(tmp_path, "space_station")
    assert {row["entity_key"] for row in store.list("building", published=True)} == {
        "command_deck", "engineering_bay", "expedition_airlock",
    }
    action = store.get("building", "expedition_airlock")["payload"]["actions"][1]
    assert action["effects"][1]["type"] == "random_result"
    assert len(action["effects"][1]["outcomes"][1]["effects"]) == 4
    assert store.get("environment", "orbital_environment")["payload"]["conditions"][1]["key"] == "solar_storm"


def test_unknown_preset_is_rejected():
    try:
        world_preset("unknown")
    except ValueError as exc:
        assert "inconnu" in str(exc)
    else:
        raise AssertionError("An unknown preset must not create a partially initialized world")
