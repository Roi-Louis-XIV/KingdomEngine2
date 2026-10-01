from types import SimpleNamespace

from KingdomData.store import ContentStore
from kingdomCore.discord_bot import InterfaceView


def test_collective_objective_shows_target_and_unit_without_changing_legacy_display(tmp_path):
    store = ContentStore(tmp_path / "objectives.db")
    store.initialize()
    with store.connection() as db:
        db.execute(
            "INSERT INTO collective_contributions(objective_key,discord_id,building_key,resource_key,amount,metadata_json,created_at) "
            "VALUES('church_wood','42','church','wood',3,'{}','2026-09-28T00:00:00+00:00')"
        )
    components = [
        {"id": "wood", "type": "collective_objective", "props": {
            "title": "Bois", "objective_key": "church_wood", "target": 40, "unit": "bois",
        }},
        {"id": "stone", "type": "collective_objective", "props": {
            "title": "Pierre", "objective_key": "church_stone", "target": 28,
        }},
        {"id": "legacy", "type": "collective_objective", "props": {
            "title": "Ancien panneau", "objective_key": "church_wood",
        }},
    ]
    definition = {"name": "Chantier", "start_page": "home", "pages": [{
        "key": "home", "name": "Chantier", "components": components,
    }]}

    fields = InterfaceView(SimpleNamespace(store=store), definition).embed().fields
    assert [(field.name, field.value) for field in fields] == [
        ("Bois", "**3 / 40** bois"),
        ("Pierre", "**0 / 28**"),
        ("Ancien panneau", "**3** contribution(s)"),
    ]
