import asyncio

from KingdomData import ContentStore, ValidationError
from kingdomCore import GameEngine


def test_action_is_atomic_and_idempotent(tmp_path):
    store=ContentStore(tmp_path/"game.db");store.initialize()
    draft=store.save("building","test_mine",{"name":"Mine","actions":[{"key":"mine_ore","name":"Miner","effects":[{"type":"cost","resource":"energy","amount":5},{"type":"reward","resource":"iron_ore","amount":2}]}]})
    store.publish("building","test_mine",draft["version"])
    engine=GameEngine(store)
    first=asyncio.run(engine.execute("42","test_mine","mine_ore","interaction-1"))
    second=asyncio.run(engine.execute("42","test_mine","mine_ore","interaction-1"))
    assert first==second
    assert engine.player("42")["energy"]==95
    assert engine.player("42")["inventory"]=={"iron_ore":2}


def test_failed_action_rolls_back(tmp_path):
    store=ContentStore(tmp_path/"game.db");store.initialize()
    draft=store.save("building","royal_shop",{"name":"Boutique","actions":[{"key":"buy_sword","name":"Acheter","effects":[{"type":"cost","resource":"money","amount":10},{"type":"reward","resource":"sword_item","amount":1}]}]})
    store.publish("building","royal_shop",draft["version"])
    engine=GameEngine(store)
    try: asyncio.run(engine.execute("42","royal_shop","buy_sword","x"))
    except ValidationError: pass
    else: raise AssertionError("L’achat devait échouer")
    assert engine.player("42")["inventory"]=={}

