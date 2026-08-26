from KingdomData import ContentStore
from KingdomData.paths import assets_root, database_path, persistent_data_root


def test_external_data_directory_hosts_database_and_assets(tmp_path, monkeypatch):
    external = tmp_path / "large-hdd"
    monkeypatch.setenv("KINGDOM_DATA_DIR", str(external))
    monkeypatch.setenv("KINGDOM_DATABASE", "var/kingdom.db")

    assert persistent_data_root() == external.resolve()
    assert assets_root() == external.resolve() / "assets"
    store = ContentStore()
    assert store.path == external.resolve() / "kingdom.db"
    store.initialize()
    assert store.path.is_file()


def test_explicit_database_path_remains_an_advanced_override(tmp_path, monkeypatch):
    external = tmp_path / "large-hdd"
    custom_database = tmp_path / "database-only" / "custom.db"
    monkeypatch.setenv("KINGDOM_DATA_DIR", str(external))
    monkeypatch.setenv("KINGDOM_DATABASE", str(custom_database))

    assert database_path() == custom_database
    assert ContentStore().path == custom_database
