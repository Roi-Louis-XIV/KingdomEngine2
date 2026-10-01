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


def test_voice_profiles_and_presences_are_versioned_content(tmp_path):
    store = ContentStore(tmp_path / "voice-content.db"); store.initialize()
    profile = store.save("voice_profile", "guide_voice", {
        "name": "Voix du guide", "provider": "files", "language": "fr",
        "volume": 1, "clips": [], "tags": ["guide"],
    })
    store.publish("voice_profile", "guide_voice", profile["version"])
    presence = store.save("voice_presence", "station_guide", {
        "name": "Guide de la station", "presence_type": "custom",
        "voice_profile_key": "guide_voice", "assignment_mode": "on_demand",
        "priority": 20, "release_timeout_seconds": 30,
    })
    assert store.publish("voice_presence", "station_guide", presence["version"])["status"] == "published"
    assert store.get("voice_presence", "station_guide")["payload"]["voice_profile_key"] == "guide_voice"

