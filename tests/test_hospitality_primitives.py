import asyncio
import random
from types import SimpleNamespace

import discord
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


def test_configurable_player_status_uses_real_persistent_values(tmp_path):
    from kingdomCore.discord_bot import InterfaceView

    store, engine = hospitality_engine(tmp_path)
    published(store, "interface", "inn_status", {
        "name": "État personnel", "target_building_key": "inn_house", "start_page": "home",
        "pages": [{"key": "home", "name": "Accueil", "components": [{
            "id": "player_state", "type": "player_status", "props": {
                "title": "Votre état", "show_money": True, "show_energy": True,
                "stats": [{"key": "alcohol", "label": "Alcoolémie", "emoji": "🍷", "maximum": 100}],
            },
        }]}],
    })
    with store.connection() as db:
        engine._change_player_stat(db, "42", "alcohol", 18, {"minimum": 0, "maximum": 100})
    fake = SimpleNamespace(
        owner_id=42, engine=engine,
        _cached_player=lambda: engine.player("42"),
    )
    embed = discord.Embed()

    InterfaceView._add_player_status(fake, embed, {
        "title": "Votre état", "show_money": True, "show_energy": True,
        "stats": [{"key": "alcohol", "label": "Alcoolémie", "emoji": "🍷", "maximum": 100}],
    })

    assert embed.fields[0].name == "Votre état"
    assert "100 écus" in embed.fields[0].value
    assert "50 / 100" in embed.fields[0].value
    assert "Alcoolémie :** 18 / 100" in embed.fields[0].value


def test_on_site_takeaway_and_exclusive_timed_bonus_are_persistent(tmp_path):
    store, engine = hospitality_engine(tmp_path)
    item = store.get("item", "apple_cider", published=True)["payload"]
    item["consumption"]["effects"].append({
        "type": "timed_bonus", "key": "warmth", "label": "Chaleur",
        "duration_seconds": 600, "slot": "special", "replacement": "replace",
        "modifiers": [{"property": "energy.cost", "operation": "multiply", "value": 0.5}],
    })
    draft = store.save("item", "apple_cider", item); store.publish("item", "apple_cider", draft["version"])
    building = store.get("building", "inn_house", published=True)["payload"]
    building["modules"]["products"][0].update(service_modes=["on_site", "takeaway"], takeaway_surcharge=1)
    draft = store.save("building", "inn_house", building); store.publish("building", "inn_house", draft["version"])

    served = asyncio.run(engine.execute_purchase("42", "inn_house", "served", "apple_cider", 1, "on_site"))
    assert "apple_cider" not in served["player"]["inventory"]
    assert served["bonuses"][0]["key"] == "warmth"
    assert served["player"]["money"] == 95
    carried = asyncio.run(engine.execute_purchase("42", "inn_house", "carried", "apple_cider", 1, "takeaway"))
    assert carried["player"]["inventory"]["apple_cider"] == 1
    assert carried["player"]["money"] == 89
    restarted = GameEngine(ContentStore(store.path))
    restarted.store.initialize()
    assert restarted.active_bonuses("42")[0]["remaining_seconds"] > 0


def test_dynamic_delivery_prices_each_unit_against_evolving_stock(tmp_path):
    store, engine = hospitality_engine(tmp_path)
    published(store, "item", "grain_sack", {"name": "Sac de grain"})
    published(store, "building", "granary", {"name": "Grenier", "actions": [], "modules": {
        "professions": [], "activities": [], "recipes": [], "products": [], "upgrades": [],
        "deliveries": [{"item_key": "grain_sack", "target_building_key": "granary", "unit_price": 10,
                        "minimum_quantity": 1, "dynamic_pricing": {"target_stock": 4,
                        "tiers": [{"below_ratio": 0.5, "multiplier": 2}, {"below_ratio": 1, "multiplier": 1.5}],
                        "minimum_multiplier": 1}}],
    }})
    with store.connection() as db: engine._change_resource(db, "42", "grain_sack", 4)
    result = asyncio.run(engine.execute_delivery("42", "granary", "delivery", {"grain_sack": 4}))
    assert result["delivery"][0]["price_breakdown"] == [20, 20, 15, 15]
    assert result["payments"]["money"] == 70
    assert result["player"]["money"] == 170
