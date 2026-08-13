from KingdomData import ConflictError, ContentStore


def test_revision_and_publish(tmp_path):
    store = ContentStore(tmp_path / "test.db"); store.initialize()
    one = store.save("item", "iron_ore", {"name":"Minerai de fer"}, "test")
    published = store.publish("item", "iron_ore", one["version"], "test")
    assert published["status"] == "published"
    two = store.save("item", "iron_ore", {"name":"Fer brut"}, "test", expected_version=1)
    assert two["version"] == 2
    try: store.save("item", "iron_ore", {"name":"Conflit"}, "test", expected_version=1)
    except ConflictError: pass
    else: raise AssertionError("Un conflit de version devait être détecté")

