import asyncio
import random

import pytest

from KingdomData import ContentStore, ValidationError
from kingdomCore import GameEngine


def published(store, entity_type, key, payload):
    draft = store.save(entity_type, key, payload)
    return store.publish(entity_type, key, draft["version"])


def hospitality_engine(tmp_path, rng=None):
    store = ContentStore(tmp_path / "hospitality.db"); store.initialize()
    published(store, "item", "apple_cider", {
        "name": "Cidre", "consumable": True,
        "consumption": {"effects": [
            {"type": "player_stat", "stat": "energy", "amount": 3, "minimum": 0, "maximum": 100},
            {"type": "player_stat", "stat": "alcohol", "amount": 18, "minimum": 0, "maximum": 100, "change_per_hour": -4},
            {"type": "message", "text": "Le cidre réchauffe."},
        ]},
    })
    published(store, "building", "inn_house", {"name": "Auberge", "actions": [], "modules": {
        "professions": [], "activities": [], "recipes": [], "deliveries": [], "upgrades": [],
        "products": [{"item_key": "apple_cider", "name": "Cidre", "price": 5, "initial_stock": 10, "maximum_per_purchase": 4}],
        "games": {"bones": {"key": "bones", "stake": 5, "stake_resource": "money", "outcomes": [1, 2, 3, 4, 5, 6], "choices": [
            {"key": "even", "name": "Pair", "winning_outcomes": [2, 4, 6], "multiplier": 2},
        ]}},
    }})
    engine = GameEngine(store, rng=rng or random.Random(1))
    with store.connection() as db:
        db.execute("INSERT INTO players(discord_id,money,energy,updated_at,created_at) VALUES('42',100,50,'now','now')")
    return store, engine


def test_quantity_purchase_is_atomic_stocked_and_idempotent(tmp_path):
    store, engine = hospitality_engine(tmp_path)
    first = asyncio.run(engine.execute_purchase("42", "inn_house", "buy-1", "apple_cider", 3))
    second = asyncio.run(engine.execute_purchase("42", "inn_house", "buy-1", "apple_cider", 3))
    assert first == second
    assert first["player"]["money"] == 85
    assert first["player"]["inventory"]["apple_cider"] == 3
    assert engine.commerce_options("inn_house")[0]["quantity"] == 7
    with pytest.raises(ValidationError):
        asyncio.run(engine.execute_purchase("42", "inn_house", "buy-too-many", "apple_cider", 5))


def test_consumption_applies_multiple_configured_effects_once(tmp_path):
    _store, engine = hospitality_engine(tmp_path)
    asyncio.run(engine.execute_purchase("42", "inn_house", "buy", "apple_cider", 1))
    result = asyncio.run(engine.execute_consumption("42", "inn_house", "drink", "apple_cider"))
    duplicate = asyncio.run(engine.execute_consumption("42", "inn_house", "drink", "apple_cider"))
    assert result == duplicate
    assert result["stats"] == {"alcohol": 18.0, "energy": 53.0}
    assert result["player"]["energy"] == 53
    assert "apple_cider" not in result["player"]["inventory"]
    assert result["messages"] == ["Le cidre réchauffe."]


def test_game_session_has_owner_confirmation_cancellation_and_single_settlement(tmp_path):
    _store, engine = hospitality_engine(tmp_path, random.Random(0))
    cancelled = engine.prepare_game("42", "inn_house", "bones", "even")
    assert engine.cancel_game("42", cancelled["session_key"])
    with pytest.raises(ValidationError): asyncio.run(engine.confirm_game("42", cancelled["session_key"], "roll-cancelled"))
    prepared = engine.prepare_game("42", "inn_house", "bones", "even")
    with pytest.raises(ValidationError): asyncio.run(engine.confirm_game("7", prepared["session_key"], "roll-foreign"))
    result = asyncio.run(engine.confirm_game("42", prepared["session_key"], "roll-1"))
    duplicate = asyncio.run(engine.confirm_game("42", prepared["session_key"], "roll-1"))
    assert result == duplicate
    assert result["outcome"] in range(1, 7)
    assert result["player"]["money"] == 100 - result["stake"] + result["payout"]


def test_commerce_rejects_insufficient_money_without_touching_stock(tmp_path):
    _store, engine = hospitality_engine(tmp_path)
    with engine.store.connection() as db: db.execute("UPDATE players SET money=1 WHERE discord_id='42'")
    with pytest.raises(ValidationError): asyncio.run(engine.execute_purchase("42", "inn_house", "poor", "apple_cider", 1))
    assert engine.commerce_options("inn_house")[0]["quantity"] == 10
