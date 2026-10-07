"""Parcours ciblés du nouveau scénario officiel, sans toucher au pack précédent."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from datetime import datetime, timezone

from KingdomData import ContentStore
from KingdomData.official_content import OfficialContentStore
from KingdomData.world_presets import world_preset
from KingdomWeb.accounts import SCHEMA_COMPTES
from KingdomWeb.world_creator import WorldCreatorService
from kingdomCore.engine import GameEngine
from kingdomCore.npc import NpcEngine
from kingdomCore.discord_bot import InterfaceView, QuestBoardView, grant_oath_reward
from KingdomVoice.bot_manager import ManagedVoiceBot
from kingdomEvent.lifecycle import EventLifecycle
from import_v1 import actions_from_modules


def _world(tmp_path, name="world"):
    store = ContentStore(tmp_path / f"{name}.db")
    store.initialize()
    store.seed(world_preset("storm_sainte_pelle"))
    return store


def test_new_official_template_is_published_once_and_clones_cleanly(tmp_path):
    path = tmp_path / "platform.db"
    with sqlite3.connect(path) as db:
        db.executescript(SCHEMA_COMPTES)
    official = OfficialContentStore(path)
    official.migrate_legacy_presets()
    official.migrate_legacy_presets()
    packs = [entry for entry in official.list(content_type="world_template", published_only=True)
             if entry["key"] == "storm_sainte_pelle"]
    assert len(packs) == 1
    assert packs[0]["catalog_scope"] == "official"
    template = official.get("storm_sainte_pelle", published_only=True)
    assert template["validation"]["valid"]
    world = ContentStore(tmp_path / "installed.db")
    world.initialize()
    world.seed(template["entities"])
    assert {row["entity_key"] for row in world.list("building", published=True)} >= {
        "market_square", "old_bridge", "saint_shovel_church", "deep_mine", "royal_forge",
    }
    assert len(world.list("quest", published=True)) >= 20
    assert world.get("npc", "church_priest", published=True)["payload"]["voice_presence_key"] == "presence_church_priest"
    assert not any(row["entity_key"] == "festival_esplanade" for row in world.list("building", published=True))
    assert any(row["key"] == "festival_esplanade" for row in world_preset("royal_festival") if row["type"] == "building")


def test_storm_onboarding_roles_currency_and_single_grant(tmp_path):
    world = _world(tmp_path)
    settings = world.get("server_settings", "kingdom_server", published=True)["payload"]
    assert settings["onboarding"]["starting_money"] == 100
    assert settings["onboarding"]["currency_label_singular"] == "écu"
    assert settings["onboarding"]["currency_label_plural"] == "écus"
    assert settings["roles"]["game_master"] == "Roi"
    assert settings["roles"]["player"] == "Habitants du Royaume"
    member = SimpleNamespace(id=9001, display_name="Testeuse", display_avatar=SimpleNamespace(url="https://example/avatar.png"))
    assert grant_oath_reward(world, member) is True
    assert grant_oath_reward(ContentStore(world.path), member) is False
    assert GameEngine(world).player("9001")["money"] == 100


def test_quest_board_and_mine_repair_survive_restart(tmp_path):
    world = _world(tmp_path)
    start = time.time() - 106 * 60
    WorldCreatorService(world).start_live_operations(now=start)
    engine = GameEngine(world)
    engine.accept_quest("42", "p01_first_steps", "accept-first")
    for index, key in enumerate(("edgar_tavern", "deep_mine", "forester_lodge")):
        engine.record_quest_visit("42", f"visit-{index}", building_key=key)
    assert engine.quest_board("42")["active"]["status"] == "ready"
    assert engine.claim_quest("42", "p01_first_steps", "claim-first")["reward_xp"] == 40
    assert GameEngine(ContentStore(world.path)).player("42")["quest_experience"] == 40

    with world.connection() as db:
        db.execute("INSERT OR REPLACE INTO inventory(discord_id,item_key,quantity) VALUES('42','oak_timber',8)")
        db.execute("INSERT OR REPLACE INTO inventory(discord_id,item_key,quantity) VALUES('42','stone_block',8)")
    lifecycle = EventLifecycle(world)
    assert next(item for item in lifecycle.list() if item["event_key"] == "storm_mine_damage")["status"] == "active"
    asyncio.run(engine.execute("42", "deep_mine", "deposit_mine_wood_8", "mine-wood"))
    asyncio.run(engine.execute("42", "deep_mine", "deposit_mine_stone_8", "mine-stone"))
    asyncio.run(engine.execute("42", "deep_mine", "start_storm_mine_repaired", "mine-start"))
    with world.connection() as db:
        db.execute("UPDATE scheduled_actions SET ready_at=0 WHERE discord_id='42' AND action_key='storm_mine_repaired'")
    restarted = GameEngine(ContentStore(world.path))
    asyncio.run(restarted.execute("42", "deep_mine", "claim_storm_mine_repaired", "mine-finish"))
    assert next(item for item in EventLifecycle(world).list() if item["event_key"] == "storm_mine_damage")["status"] == "finished"
    with world.connection() as db:
        count = db.execute("SELECT COALESCE(SUM(amount),0) FROM collective_contributions WHERE objective_key='storm_mine_repaired'").fetchone()[0]
    assert count == 1
    mine_interface = world.get("building", "deep_mine", published=True)["payload"]["interface"]
    repaired_view = InterfaceView(restarted, mine_interface, page_key="home", owner_id=42)
    repaired_labels = {str(getattr(item, "label", "")) for item in repaired_view.children}
    assert "Sécuriser la galerie" not in repaired_labels
    assert "Apporter des matériaux" not in repaired_labels


def test_storm_player_ui_timeline_is_clean_and_lore_first(tmp_path):
    world = _world(tmp_path, "ui-zero")
    WorldCreatorService(world).start_live_operations(now=time.time())
    engine = GameEngine(world)
    buildings = {row["entity_key"]: row["payload"] for row in world.list("building", published=True)}

    def home(key):
        return next(page for page in buildings[key]["interface"]["pages"] if page["key"] == "home")

    church_definition = buildings["saint_shovel_church"]["interface"]
    church_view = InterfaceView(engine, church_definition, page_key="home", owner_id=42)
    labels = [str(getattr(item, "label", "")) for item in church_view.children]
    assert labels == ["Prier", "Parler au prêtre"]
    collective = next(item for item in home("market_square")["components"] if item.get("id") == "ux_nav_place_collective")
    assert not engine.condition_met("42", "market_square", "collective", collective["visibility_conditions"])
    assert any(item.get("id") == "ux_nav_place_quests" for item in home("market_square")["components"])
    for key in ("market_square", "edgar_tavern", "deep_mine", "royal_forge", "forester_lodge", "old_bridge", "saint_shovel_church"):
        view = InterfaceView(engine, buildings[key]["interface"], page_key="home", owner_id=42)
        assert len(view.children) <= 5, (key, [getattr(item, "label", "") for item in view.children])
    visible = json.dumps(world_preset("storm_sainte_pelle"), ensure_ascii=False)
    assert all(marker not in visible for marker in ("Fête du Royaume", "Préparatifs", "BALANCE_DRAFT / À VALIDER"))

    damaged_world = _world(tmp_path, "ui-damaged")
    WorldCreatorService(damaged_world).start_live_operations(now=time.time() - 111 * 60)
    damaged_interface = damaged_world.get("building", "saint_shovel_church", published=True)["payload"]["interface"]
    damaged_view = InterfaceView(GameEngine(damaged_world), damaged_interface, page_key="home", owner_id=42)
    assert [str(getattr(item, "label", "")) for item in damaged_view.children] == ["Examiner les dégâts", "Parler au prêtre"]

    later = _world(tmp_path, "ui-later")
    WorldCreatorService(later).start_live_operations(now=time.time() - 121 * 60)
    later_engine = GameEngine(later)
    church_definition = later.get("building", "saint_shovel_church", published=True)["payload"]["interface"]
    open_view = InterfaceView(later_engine, church_definition, page_key="home", owner_id=42)
    assert {str(getattr(item, "label", "")) for item in open_view.children} == {
        "Dégager l'arbre", "Apporter des matériaux", "Participer au chantier", "Voir l'effort collectif",
    }
    waiting = InterfaceView(later_engine, church_definition, page_key="ux_church_clear", owner_id=42)
    assert not any(str(getattr(item, "label", "")).startswith("Terminer") for item in waiting.children)
    asyncio.run(later_engine.execute("42", "saint_shovel_church", "start_church_tree_cleared", "tree-start"))
    with later.connection() as db:
        db.execute("UPDATE scheduled_actions SET ready_at=0 WHERE discord_id='42' AND action_key='church_tree_cleared'")
    ready = InterfaceView(later_engine, church_definition, page_key="ux_church_clear", owner_id=42)
    assert any(str(getattr(item, "label", "")).startswith("Terminer") for item in ready.children)

    mine_interface = later.get("building", "deep_mine", published=True)["payload"]["interface"]
    mine_view = InterfaceView(later_engine, mine_interface, page_key="home", owner_id=42)
    mine_labels = {str(getattr(item, "label", "")) for item in mine_view.children}
    assert {"Sécuriser la galerie", "Apporter des matériaux", "Parler à Roland"} <= mine_labels

    storm = _world(tmp_path, "ui-storm")
    WorldCreatorService(storm).start_live_operations(now=time.time() - 91 * 60)
    forest_interface = storm.get("building", "forester_lodge", published=True)["payload"]["interface"]
    assert InterfaceView(GameEngine(storm), forest_interface, page_key="home", owner_id=42).embed().title.endswith("Tempête en forêt")


def test_storm_discord_ux_routes_and_actions_are_real():
    rows = world_preset("storm_sainte_pelle")
    buildings = {row["key"]: row["payload"] for row in rows if row["type"] == "building"}
    main = {"market_square", "edgar_tavern", "deep_mine", "royal_forge", "forester_lodge", "old_bridge", "saint_shovel_church"}
    settings = next(row["payload"] for row in rows if row["type"] == "server_settings" and row["key"] == "kingdom_server")
    assert settings["template_revision"] == 8
    assert all(not any(page["key"] == "storm_services" for page in buildings[key]["interface"]["pages"]) for key in main)
    for key in main:
        interface = buildings[key]["interface"]
        pages = {page["key"] for page in interface["pages"]}
        assert "home" in pages
        for page in interface["pages"]:
            for component in page.get("components", []):
                interaction = component.get("interaction", {})
                if interaction.get("type") == "navigate":
                    assert interaction["page"] in pages, (key, component["id"], interaction["page"])
                elif interaction.get("type") == "action":
                    target = interaction["building"]
                    target_building = buildings[target]
                    actions = (actions_from_modules(target, target_building.get("modules", {}))
                               if target_building.get("action_mode") == "generated"
                               else target_building.get("actions", []))
                    action_keys = {item["key"] for item in actions}
                    assert interaction["action"] in action_keys, (key, component["id"], interaction["action"])
    bridge_home = next(page for page in buildings["old_bridge"]["interface"]["pages"] if page["key"] == "home")
    fish = next(component for component in bridge_home["components"] if component.get("props", {}).get("label") == "Pêcher")
    assert fish["interaction"] == {"type": "action", "building": "old_bridge", "action": "fish_old_bridge"}


def test_tavern_uses_shared_cauldrons_and_six_validated_player_routes(tmp_path):
    world = _world(tmp_path, "tavern-shared-kitchen")
    building = world.get("building", "edgar_tavern", published=True)["payload"]
    workstations = building["modules"]["workstations"]
    assert len(workstations) == 1
    assert {key: workstations[0][key] for key in ("key", "name", "emoji", "slots")} == {
        "key": "tavern_cauldrons", "name": "Marmite", "emoji": "🍲", "slots": 3,
    }
    assert workstations[0]["idle_text"] and workstations[0]["busy_text"] and workstations[0]["ready_text"]
    assert building["modules"]["recipes"]
    assert all(recipe["workstation_key"] == "tavern_cauldrons" for recipe in building["modules"]["recipes"])
    pages = {page["key"]: page for page in building["interface"]["pages"]}
    assert {"home", "ux_tavern_drinks", "ux_tavern_meals", "ux_tavern_edgar", "ux_tavern_kitchen", "ux_tavern_counter"} <= set(pages)
    home = InterfaceView(GameEngine(world), building["interface"], page_key="home", owner_id=42)
    assert [str(getattr(item, "label", "")) for item in home.children] == [
        "Commander à boire", "Commander à manger", "Parler à Edgar", "Cuisiner", "Stocks & livraisons",
    ]
    kitchen = InterfaceView(GameEngine(world), building["interface"], page_key="ux_tavern_kitchen", owner_id=42)
    assert "Libre" in kitchen.embed().to_dict()["fields"][0]["value"]
    assert any(getattr(item, "placeholder", "") == "Choisir une recette ou voir sa préparation…" for item in kitchen.children)


def test_tavern_shared_recipe_start_status_claim_and_restart(tmp_path):
    world = _world(tmp_path, "tavern-shared-cycle")
    engine = GameEngine(world)
    asyncio.run(engine.execute("42", "edgar_tavern", "join_innkeeper", "join-cook"))
    result = asyncio.run(engine.execute("42", "edgar_tavern", "cook_onion_soup", "start-soup", {"display_name": "Attila"}))
    assert result["workstations"][0]["status"] in {"preparation", "transformation"}
    active = InterfaceView(engine, world.get("building", "edgar_tavern", published=True)["payload"]["interface"], page_key="ux_tavern_kitchen", owner_id=42)
    rendered = active.embed().to_dict()["fields"][0]["value"]
    assert "Attila" in rendered and "soupes à l'oignon" in rendered and "Production" in rendered
    with world.connection() as db:
        db.execute("UPDATE transformation_jobs SET preparation_ends_at=0,transformation_ends_at=0")
    restarted = GameEngine(ContentStore(world.path))
    assert restarted.workstation_states("edgar_tavern")[0]["status"] == "ready"
    asyncio.run(restarted.execute("42", "edgar_tavern", "claim_cook_onion_soup", "claim-soup"))
    assert restarted.workstation_states("edgar_tavern") == []
    with world.connection() as db:
        assert db.execute("SELECT quantity FROM building_stock WHERE building_key='edgar_tavern' AND item_key='soupe_oignon'").fetchone()[0] >= 5


def test_edgar_dialogue_uses_real_quest_state_and_contextual_stock(tmp_path):
    world = _world(tmp_path, "edgar-dialogue")
    WorldCreatorService(world).start_live_operations(now=time.time())
    npc = NpcEngine(world)
    offered = npc.dialogue("edgar", "42", "quetes")
    assert "quatre œufs" in offered["text"]
    assert any(choice.get("quest_operation") == "accept" for choice in offered["choices"])
    accepted = npc.choose_dialogue("edgar", "42", "quetes", "accepter_fournee")
    quest = GameEngine(world).accept_quest("42", accepted["quest_key"], "dialogue-accept")
    assert quest["quest"]["key"] == "p07_edgar_batch"
    active = npc.dialogue("edgar", "42", "quetes")
    assert "commande est en cours" in active["text"]
    assert any(choice.get("next_node") == "quetes_active" for choice in active["choices"])

    building = world.get("building", "edgar_tavern", published=True)["payload"]
    counter = InterfaceView(GameEngine(world), building["interface"], page_key="ux_tavern_counter", owner_id=42)
    rendered = json.dumps(counter.embed().to_dict(), ensure_ascii=False)
    assert "État des réserves" in rendered and "Stock" in rendered and "Livraisons demandées" in rendered

    beer_page = next(page for page in building["interface"]["pages"] if page["key"] == "ux_tavern_beer")
    contextual = next(component for component in beer_page["components"] if component["type"] == "contextual_content")
    followed_item = contextual["props"]["variants"][0]["condition"]["item"]
    with world.connection() as db:
        db.execute("INSERT INTO building_stock(building_key,item_key,quantity) VALUES('edgar_tavern',?,0) ON CONFLICT(building_key,item_key) DO UPDATE SET quantity=0", (followed_item,))
    shop = InterfaceView(GameEngine(world), building["interface"], page_key="ux_tavern_beer", owner_id=42)
    assert "réserves baissent" in shop.embed().description

    interface = building["interface"]
    assert InterfaceView(GameEngine(world), interface, owner_id=42)._currency_label("money", 2) == "écus"


def test_edgar_rumours_are_multilevel_returnable_and_follow_scenario(tmp_path):
    texts = []
    for name, elapsed in (("before", 0), ("during", 91), ("after", 106)):
        world = _world(tmp_path, f"rumour-{name}")
        WorldCreatorService(world).start_live_operations(now=time.time() - elapsed * 60)
        npc = NpcEngine(world)
        root = npc.dialogue("edgar", "42", "rumeurs")
        texts.append(root["text"])
        assert {choice["next_node"] for choice in root["choices"] if choice.get("next_node")} >= {"rumeur_mine", "rumeur_foret", "rumeur_autre"}
        branch = npc.choose_dialogue("edgar", "42", "rumeurs", "mine")["next"]
        assert branch["parent_node"] == "rumeurs"
        assert npc.choose_dialogue("edgar", "42", "rumeur_mine", "retour")["back"] is True
    assert "Roland raconte" in texts[0]
    assert "murs commencent à trembler" in texts[1]
    assert "l’église" in texts[2]


def test_recipe_lock_explains_missing_profession_then_ingredients(tmp_path):
    world = _world(tmp_path, "recipe-locks")
    building = world.get("building", "edgar_tavern", published=True)["payload"]
    recipe = building["modules"]["recipes"][0]
    page_key = f"ux_recipe_{recipe['key']}"[:64]
    locked = InterfaceView(GameEngine(world), building["interface"], page_key=page_key, owner_id=42)
    assert any(str(getattr(item, "label", "")).startswith("Métier requis") for item in locked.children)
    engine = GameEngine(world)
    asyncio.run(engine.execute("42", "edgar_tavern", "join_innkeeper", "join-for-lock"))
    with world.connection() as db:
        for item in recipe["ingredients"]:
            db.execute("INSERT INTO building_stock(building_key,item_key,quantity) VALUES(?,?,0) ON CONFLICT(building_key,item_key) DO UPDATE SET quantity=0", ("edgar_tavern", item))
    missing = InterfaceView(engine, building["interface"], page_key=page_key, owner_id=42)
    assert any(str(getattr(item, "label", "")).startswith("Manque :") for item in missing.children)


def test_tavern_ambiance_changes_before_during_and_after_storm(tmp_path):
    snapshots = []
    for name, elapsed in (("before", 0), ("during", 91), ("after", 106)):
        world = _world(tmp_path, f"tavern-{name}")
        WorldCreatorService(world).start_live_operations(now=time.time() - elapsed * 60)
        interface = world.get("building", "edgar_tavern", published=True)["payload"]["interface"]
        snapshots.append(InterfaceView(GameEngine(world), interface, page_key="home", owner_id=42).embed().description)
    assert "soirée presque ordinaire" in snapshots[0]
    assert "volets tremblent" in snapshots[1]
    assert "vent s’est enfin calmé" in snapshots[2]


def test_fishing_completes_p14_and_delivers_two_real_fish(tmp_path):
    world = _world(tmp_path, "fishing")
    WorldCreatorService(world).start_live_operations(now=time.time())
    engine = GameEngine(world)
    engine.accept_quest("77", "p14_bridge_fishing", "accept-p14")

    async def fish_twice():
        for index in range(2):
            await engine.execute("77", "old_bridge", "fish_old_bridge", f"fish-start-{index}")
            with world.connection() as db:
                db.execute("UPDATE scheduled_actions SET ready_at=0 WHERE discord_id='77' AND action_key='fish_old_bridge' AND status='pending'")
            await engine.execute("77", "old_bridge", "claim_fish_old_bridge", f"fish-claim-{index}")
        assert engine.player("77")["inventory"]["river_fish"] == 2
        await engine.execute("77", "edgar_tavern", "deliver_river_fish", "fish-delivery")

    asyncio.run(fish_twice())
    active = engine.quest_board("77")["active"]
    assert active["status"] == "ready", [(goal["key"], goal["progress"], goal["required"]) for goal in active["objectives"]]
    assert [goal["progress"] for goal in active["objectives"]] == [2, 2]
    board = QuestBoardView(engine, 77, "market_square", return_view=SimpleNamespace())
    rendered = json.dumps(board.embed().to_dict(), ensure_ascii=False)
    assert not any(key in rendered for key in ("old_bridge", "edgar_tavern", "river_fish", "claim_fish_old_bridge"))
    assert any(getattr(item, "label", None) == "Retour" for item in board.children)


def test_all_supplied_voice_files_resolve_through_kingdomvoice(tmp_path):
    world = _world(tmp_path, "voice-paths")
    bot = object.__new__(ManagedVoiceBot)
    bot.store = world
    bot.assets_root = tmp_path / "runtime-assets"
    audio = [row for row in world.list("audio", published=True) if row["entity_key"].startswith("storm_voice_")]
    assert len(audio) == 80
    resolved = {row["entity_key"]: bot._entity_track(row["entity_key"])[0] for row in audio}
    assert all(path.is_file() and path.stat().st_size > 0 for path in resolved.values())
    assert all(any(key.startswith(f"storm_voice_{npc}_") for key in resolved) for npc in ("edgar", "roland", "wagner"))


def test_only_the_true_mass_variant_activates_at_minute_170(tmp_path):
    for name, outcome, expected in [
        ("full", "full", "storm_mass_full"),
        ("partial", "partial", "storm_mass_partial"),
        ("deferred", "deferred", "storm_mass_deferred"),
    ]:
        world = _world(tmp_path, name)
        start = time.time()
        WorldCreatorService(world).start_live_operations(now=start)
        if outcome != "deferred":
            stamp = datetime.fromtimestamp(start + 160 * 60, timezone.utc).isoformat()
            with world.connection() as db:
                contributions = [
                    ("church_tree_cleared", "saint_shovel_church", "progress", 3),
                    ("church_wood", "saint_shovel_church", "oak_timber", 40),
                    ("church_stone", "saint_shovel_church", "stone_block", 28),
                    ("church_brackets", "saint_shovel_church", "church_bracket", 4),
                    ("church_provisions", "saint_shovel_church", "storm_ration", 8),
                    ("church_assembly", "saint_shovel_church", "progress", 2),
                ] if outcome == "full" else [
                    ("church_tree_cleared", "saint_shovel_church", "progress", 3),
                    ("church_assembly", "saint_shovel_church", "progress", 1),
                ]
                for objective, building, resource, amount in contributions:
                    db.execute("INSERT INTO collective_contributions(objective_key,discord_id,building_key,resource_key,amount,metadata_json,created_at) VALUES(?,?,?,?,?,'{}',?)",
                               (objective, "builder", building, resource, amount, stamp))
        states = {item["event_key"]: item["status"] for item in EventLifecycle(world).list(now=start + 171 * 60)}
        variants = {key: states[key] for key in ("storm_mass_full", "storm_mass_partial", "storm_mass_deferred")}
        assert variants[expected] == "active", variants
        assert sum(status == "active" for status in variants.values()) == 1, variants
        assert all(status in {"active", "disabled"} for status in variants.values())


def test_live_ops_prepare_schedule_stop_reset_and_restart(tmp_path):
    world = _world(tmp_path)
    service = WorldCreatorService(world)
    prepared = service.prepare_live_operations()
    assert prepared["status"] == "prepared"
    assert EventLifecycle(world).list() == []

    start = time.time() + 600
    scheduled = service.start_live_operations(now=start - 600, start_at=start)
    assert scheduled["status"] == "scheduled"
    assert scheduled["scheduled"] >= 17
    assert WorldCreatorService(ContentStore(world.path)).live_operations()["state"]["status"] == "scheduled"

    stopped = service.stop_live_operations(now=start - 300)
    assert stopped["status"] == "stopped"
    assert all(row["status"] == "finished" for row in EventLifecycle(world).list(now=start - 300))

    reset = service.reset_live_operations()
    assert reset["status"] == "prepared"
    assert EventLifecycle(world).list() == []


def test_seed_orders_location_dependencies_and_rejects_invalid_graph(tmp_path):
    store = ContentStore(tmp_path / "locations.db"); store.initialize()
    child = {"type": "location", "key": "child", "payload": {
        "name": "Enfant", "location_type": "place", "parent_key": "root", "connections": []}}
    root = {"type": "location", "key": "root", "payload": {
        "name": "Racine", "location_type": "kingdom", "parent_key": "", "connections": []}}
    store.seed([child, root])
    assert store.get("location", "child", published=True)

    from KingdomData import ValidationError
    broken = ContentStore(tmp_path / "broken.db"); broken.initialize()
    try:
        broken.seed([{**child, "payload": {**child["payload"], "parent_key": "missing"}}])
        assert False, "un parent absent doit être refusé"
    except ValidationError as exc:
        assert "Lieu parent introuvable : missing" in str(exc)

    cyclic = ContentStore(tmp_path / "cyclic.db"); cyclic.initialize()
    try:
        cyclic.seed([
            {**root, "payload": {**root["payload"], "parent_key": "child"}},
            child,
        ])
        assert False, "un cycle doit être refusé"
    except ValidationError as exc:
        assert "Cycle de lieux détecté" in str(exc)


def test_nine_players_contribute_atomically_without_double_consumption(tmp_path):
    world = _world(tmp_path)
    WorldCreatorService(world).start_live_operations(now=time.time() - 121 * 60)
    now = datetime.now(timezone.utc).isoformat()
    with world.connection() as db:
        for index in range(9):
            player = str(1000 + index)
            db.execute("INSERT INTO players(discord_id,money,energy,updated_at,created_at) VALUES(?,100,100,?,?)", (player, now, now))
            db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES(?,'oak_timber',1)", (player,))

    def contribute(index: int):
        player = str(1000 + index)
        return asyncio.run(GameEngine(ContentStore(world.path)).execute(
            player, "saint_shovel_church", "deposit_church_wood_1", f"nine-{index}"))

    with ThreadPoolExecutor(max_workers=9) as pool:
        results = list(pool.map(contribute, range(9)))
    assert len(results) == 9
    with world.connection() as db:
        assert db.execute("SELECT COALESCE(SUM(amount),0) FROM collective_contributions WHERE objective_key='church_wood'").fetchone()[0] == 9
        assert db.execute("SELECT COALESCE(SUM(quantity),0) FROM inventory WHERE item_key='oak_timber'").fetchone()[0] == 0
    # Une répétition Discord du même identifiant rejoue le résultat mémorisé,
    # jamais la consommation ni la contribution.
    asyncio.run(GameEngine(world).execute("1000", "saint_shovel_church", "deposit_church_wood_1", "nine-0"))
    with world.connection() as db:
        assert db.execute("SELECT COALESCE(SUM(amount),0) FROM collective_contributions WHERE objective_key='church_wood'").fetchone()[0] == 9
