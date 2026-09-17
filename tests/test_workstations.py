import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest

from KingdomData import ContentStore, ValidationError
from kingdomCore.engine import GameEngine


def run(coro):
    return asyncio.run(coro)


def workstation_world(tmp_path, *, slots=2, stock=6):
    store = ContentStore(tmp_path / "workstations.db")
    store.initialize()
    payload = {
        "name": "Atelier", "action_mode": "generated", "actions": [],
        "modules": {
            "professions": [{"key": "artisan", "name": "Artisan"}],
            "activities": [], "products": [], "deliveries": [], "upgrades": [],
            "workstations": [{"key": "heat_station", "name": "Poste chauffant", "slots": slots}],
            "recipes": [{
                "key": "transform", "name": "Transformer", "profession": "artisan",
                "required_level": 1, "ingredient_source": "building_stock",
                "ingredients": {"raw": 2}, "initial_ingredient_stock": {"raw": stock},
                "output_item_key": "finished", "output_quantity": 3,
                "output_destination": "building_stock", "workstation_key": "heat_station",
                "preparation_seconds": 10, "transformation_seconds": 20,
                "active_transformation": False, "experience": 100,
                "preparer_xp_percent": 80, "active": True,
            }],
        },
    }
    draft = store.save("building", "workshop", payload)
    store.publish("building", "workshop", draft["version"])
    engine = GameEngine(store)
    with store.connection() as db:
        for player in ("1", "2", "3"):
            engine._ensure_player(db, player)
            db.execute("INSERT INTO player_professions(discord_id,profession_key,level,experience,active) VALUES(?,?,1,0,1)", (player, "artisan"))
    return store, engine


def test_two_players_reserve_independent_slots_atomically(tmp_path):
    store, engine = workstation_world(tmp_path)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run, GameEngine(store).execute(player, "workshop", "transform", f"start-{player}")) for player in ("1", "2")]
        results = [future.result() for future in futures]
    assert {job["slot_index"] for result in results for job in result["workstations"]} == {0, 1}
    with pytest.raises(ValidationError, match="postes compatibles"):
        run(engine.execute("3", "workshop", "transform", "start-3"))
    with store.connection() as db:
        assert db.execute("SELECT quantity FROM building_stock WHERE building_key='workshop' AND item_key='raw'").fetchone()[0] == 2


def test_insufficient_stock_does_not_reserve_a_slot(tmp_path):
    store, engine = workstation_world(tmp_path, slots=1, stock=1)
    with pytest.raises(ValidationError, match="Stock insuffisant"):
        run(engine.execute("1", "workshop", "transform", "no-stock"))
    assert engine.workstation_states("workshop") == []


def test_transition_restart_single_claim_and_split_xp(tmp_path):
    store, engine = workstation_world(tmp_path, slots=1)
    run(engine.execute("1", "workshop", "transform", "start"))
    with store.connection() as db:
        db.execute("UPDATE transformation_jobs SET preparation_ends_at=0,transformation_ends_at=0")
    restarted = GameEngine(ContentStore(store.path))
    restarted.store.initialize()
    assert restarted.workstation_states("workshop")[0]["status"] == "ready"
    result = run(restarted.execute("2", "workshop", "claim_transform", "claim"))
    assert result["workstations"] == []
    with pytest.raises(ValidationError, match="Aucune production"):
        run(restarted.execute("2", "workshop", "claim_transform", "claim-again"))
    with store.connection() as db:
        assert db.execute("SELECT quantity FROM building_stock WHERE building_key='workshop' AND item_key='finished'").fetchone()[0] == 3
        xp = dict(db.execute("SELECT discord_id,experience FROM player_professions WHERE profession_key='artisan'"))
    assert xp["1"] == 80 and xp["2"] == 20


def test_active_transformation_keeps_preparer_busy_and_cancelled_job_gives_no_xp(tmp_path):
    store, engine = workstation_world(tmp_path, slots=2)
    building = store.get("building", "workshop", published=True)
    payload = building["payload"]
    payload["modules"]["recipes"][0]["active_transformation"] = True
    draft = store.save("building", "workshop", payload)
    store.publish("building", "workshop", draft["version"])
    run(engine.execute("1", "workshop", "transform", "active-start"))
    with store.connection() as db:
        db.execute("UPDATE transformation_jobs SET preparation_ends_at=0,status='preparation'")
    with pytest.raises(ValidationError, match="occupé"):
        run(engine.execute("1", "workshop", "transform", "busy"))
    with store.connection() as db:
        db.execute("UPDATE transformation_jobs SET status='cancelled'")
    assert engine.workstation_states("workshop") == []
    assert engine.player("1")["professions"]["artisan"]["experience"] == 0


def test_same_player_receives_both_xp_shares_once(tmp_path):
    store, engine = workstation_world(tmp_path, slots=1, stock=2)
    run(engine.execute("1", "workshop", "transform", "self-start"))
    with store.connection() as db:
        db.execute("UPDATE transformation_jobs SET preparation_ends_at=0,transformation_ends_at=0")
    run(engine.execute("1", "workshop", "claim_transform", "self-claim"))
    assert engine.player("1")["professions"]["artisan"]["experience"] == 100
    assert run(engine.execute("1", "workshop", "claim_transform", "self-claim"))["player"]["professions"]["artisan"]["experience"] == 100
