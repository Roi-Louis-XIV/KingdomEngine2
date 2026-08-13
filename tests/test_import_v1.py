from KingdomData import ContentStore
from import_v1 import definitions_from_v1, import_v1


def test_all_v1_items_and_voice_profiles_are_discovered():
    definitions = definitions_from_v1()
    assert len([item for item in definitions if item["type"] == "item"]) == 48
    assert len([item for item in definitions if item["type"] == "bot"]) == 5
    assert {item["key"] for item in definitions if item["type"] == "bot"} == {
        "voice_edgar", "voice_edouard", "voice_roland", "voice_sylvain", "voice_wagner"
    }


def test_import_is_idempotent(tmp_path):
    store = ContentStore(tmp_path / "import.db")
    store.initialize()
    assert import_v1(store) == 53
    assert import_v1(store) == 0
    assert len(store.list("item", published=True)) == 48
    assert len(store.list("bot", published=True)) == 5
