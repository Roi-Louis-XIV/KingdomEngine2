"""Import idempotent de KingdomEngine V1 vers les definitions pilotables par KingdomWeb."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from KingdomData import (
    ConflictError,
    ContentStore,
    interface_from_activity_modules,
    interface_from_hospitality_modules,
    interface_from_building,
    interface_from_workshop_modules,
    migrate_activity_profession_interfaces,
    migrate_reference_labels,
    migrate_published_building_interfaces,
)
from KingdomData.audio_storage import AUDIO_EXTENSIONS, audio_key


LEGACY_VOICE_WORKERS = {
    "voice_edgar": (1, "EDGAR_BOT_TOKEN", "EDGAR_APPLICATION_ID"),
    "voice_edouard": (2, "EDOUARD_BOT_TOKEN", "EDOUARD_APPLICATION_ID"),
    "voice_roland": (3, "ROLAND_BOT_TOKEN", "ROLAND_APPLICATION_ID"),
    "voice_sylvain": (4, "SYLVAIN_BOT_TOKEN", "SYLVAIN_APPLICATION_ID"),
    "voice_wagner": (5, "WAGNER_BOT_TOKEN", "WAGNER_APPLICATION_ID"),
}


def definitions_from_v1(v1_root: str | Path | None = None) -> list[dict[str, Any]]:
    root = Path(v1_root) if v1_root else Path(__file__).resolve().parent.parent / "KingdomEngine"
    definitions = _building_definitions(root)
    tavern_path = root / "KingdomData" / "buildings" / "tavern.json"
    product_categories = {str(item["item_key"]): str(item.get("category", "")) for item in _read(tavern_path).get("products", [])} if tavern_path.exists() else {}
    items_root = root / "KingdomData" / "items"
    for catalogue in sorted(items_root.glob("*.json")):
        category = catalogue.stem
        for key, payload in _read(catalogue).items():
            normalized = {
                **payload,
                "category": category,
                "stack_limit": 999 if payload.get("stackable", True) else 1,
                "source": "KingdomEngine V1",
            }
            product_category = product_categories.get(key)
            if payload.get("consumable") and product_category:
                alcohol = {"bieres": 18, "vins": 24, "spiritueux": 34}.get(product_category, 0)
                food = product_category == "nourriture"
                normalized["consumption"] = {"effects": [
                    {"type": "player_stat", "stat": "energy", "amount": 20 if food else 2 if alcohol else 8, "minimum": 0, "maximum": 100, "change_per_hour": 10},
                    *([{"type": "player_stat", "stat": "alcohol", "amount": alcohol, "minimum": 0, "maximum": 100, "change_per_hour": -4}] if alcohol else []),
                    *([{"type": "player_stat", "stat": "alcohol", "amount": -12, "minimum": 0, "maximum": 100, "change_per_hour": -4}] if food else []),
                    {"type": "message", "text": "Tu consommes {item}."},
                ]}
            definitions.append({"type": "item", "key": key, "payload": normalized})
    voice_root = root / "KingdomVoice" / "config"
    for config in sorted(voice_root.glob("*.json")):
        payload = _read(config)
        key = config.stem
        building = str(payload.get("building", "")).lower()
        worker_number, legacy_token, legacy_application = LEGACY_VOICE_WORKERS.get(
            f"voice_{key}", (len([item for item in definitions if item.get("type") == "bot"]) + 1, f"{key.upper()}_BOT_TOKEN", f"{key.upper()}_APPLICATION_ID")
        )
        normalized = {
            **payload,
            "name": f"Voice Worker {worker_number}",
            "emoji": "🎙️",
            "description": "Capacité vocale générique, attribuable à n’importe quel bâtiment ou présence.",
            "bot_type": "voice",
            "enabled": False,
            "token_env": f"VOICE_WORKER_{worker_number}_TOKEN",
            "application_id_env": f"VOICE_WORKER_{worker_number}_APPLICATION_ID",
            "legacy_token_env": legacy_token,
            "legacy_application_id_env": legacy_application,
            "worker_number": worker_number,
            "building_key": _building_key(building),
            "auto_join": True,
            "source": "KingdomEngine V1",
        }
        definitions.append({"type": "bot", "key": f"voice_{key}", "payload": normalized})
    return definitions


def import_v1(store: ContentStore, v1_root: str | Path | None = None) -> int:
    before = {(x["entity_type"], x["entity_key"]) for x in store.list()}
    definitions = definitions_from_v1(v1_root)
    # Un profil vocal V1 peut viser un lieu transversal fourni par la V2
    # (la place du village, par exemple). Dans une installation complète ce
    # lieu existe déjà. Pour un import V1 autonome, conserve son ciblage par
    # variable de salon plutôt que d'introduire un faux bâtiment dans l'import.
    available_buildings = {
        item["entity_key"] for item in store.list("building")
    } | {
        item["key"] for item in definitions if item["type"] == "building"
    }
    seedable = []
    for item in definitions:
        payload = item["payload"]
        if (
            item["type"] == "bot"
            and payload.get("building_key") not in available_buildings
            and (payload.get("voice_channel_env") or payload.get("voice_channel_id"))
        ):
            payload = {**payload, "building_key": ""}
            item = {**item, "payload": payload}
        seedable.append(item)
    store.seed(seedable)
    _migrate_voice_workers(store)
    # Les fichiers V1 livrés avec KingdomEngine2 deviennent aussi des fiches
    # no-code visibles et attribuables depuis la banque « Voix & audio ».
    seed_legacy_audio_catalog(store)
    _link_existing_v1_items(store, definitions)
    _link_existing_v1_buildings(store, definitions)
    migrate_weighted_activity_results(store)
    for migration in (
        migrate_published_building_interfaces,
        migrate_activity_profession_interfaces,
        migrate_reference_labels,
    ):
        _run_concurrent_migration(store, migration)
    return sum((x["type"], x["key"]) not in before for x in definitions)


def _migrate_voice_workers(store: ContentStore) -> None:
    """Neutralise les identités V1 sans casser leurs références historiques."""
    for entity in store.list("bot", published=True):
        worker = LEGACY_VOICE_WORKERS.get(entity["entity_key"])
        if not worker:
            continue
        number, legacy_token, legacy_application = worker
        payload = dict(entity["payload"])
        expected = {
            "name": f"Voice Worker {number}",
            "description": "Capacité vocale générique, attribuable à n’importe quel bâtiment ou présence.",
            "token_env": f"VOICE_WORKER_{number}_TOKEN",
            "application_id_env": f"VOICE_WORKER_{number}_APPLICATION_ID",
            "legacy_token_env": payload.get("legacy_token_env") or legacy_token,
            "legacy_application_id_env": payload.get("legacy_application_id_env") or legacy_application,
            "worker_number": number,
        }
        if all(payload.get(key) == value for key, value in expected.items()):
            continue
        payload.update(expected)
        try:
            draft = store.save("bot", entity["entity_key"], payload, "migration-voice-workers", entity["version"])
            store.publish("bot", entity["entity_key"], draft["version"], "migration-voice-workers")
        except ConflictError:
            pass


def _legacy_audio_definitions(assets_root: str | Path | None = None) -> list[dict[str, Any]]:
    root = Path(assets_root) if assets_root else Path(__file__).resolve().parent / "KingdomData" / "assets"
    bot_by_building = {
        "forest": "voice_sylvain", "forge": "voice_wagner", "mine": "voice_roland",
        "tavern": "voice_edgar", "village": "voice_edouard",
    }
    labels = {"forest": "Forêt", "forge": "Forge", "mine": "Mine", "tavern": "Taverne", "village": "Village"}
    definitions: list[dict[str, Any]] = []
    for building, bot_key in bot_by_building.items():
        folder = root / building
        if not folder.exists():
            continue
        for path in sorted(item for item in folder.rglob("*") if item.is_file() and item.suffix.lower() in AUDIO_EXTENSIONS):
            relative = path.relative_to(root.parent).as_posix()
            section = path.relative_to(folder).parts[0].lower() if len(path.relative_to(folder).parts) > 1 else "ambience"
            audio_type = section if section in {"voice", "music", "ambience", "sfx"} else "voice" if section == "welcome" else "ambience"
            display = path.stem.replace("_", " ").replace("#U00e9", "é").replace("#U00e8", "è").strip().title()
            key = audio_key(f"v1_{building}_{path.relative_to(folder).with_suffix('').as_posix()}")
            definitions.append({"type": "audio", "key": key, "payload": {
                "name": display, "description": f"Son historique de {labels[building]} importé depuis KingdomEngine V1.",
                "emoji": "🔊", "audio_type": audio_type, "channel": audio_type,
                "speaker_bot_key": bot_key, "tags": [building, labels[building].lower(), "v1", section],
                "volume": 0.35 if audio_type == "ambience" else 0.15 if audio_type == "music" else 0.7,
                "loop": audio_type in {"ambience", "music"}, "triggers": [],
                "storage_path": relative, "file_name": path.name, "size_bytes": path.stat().st_size,
                "source": "KingdomEngine V1",
            }})
    return definitions


def seed_legacy_audio_catalog(store: ContentStore, assets_root: str | Path | None = None) -> int:
    """Publie la banque V1 et conserve l'attribution uniquement si le bot existe."""
    bots = {item["entity_key"] for item in store.list("bot") if item["payload"].get("bot_type") == "voice"}
    definitions = []
    for item in _legacy_audio_definitions(assets_root):
        payload = dict(item["payload"])
        if payload.get("speaker_bot_key") not in bots:
            payload["speaker_bot_key"] = ""
        definitions.append({**item, "payload": payload})
    before = len(store.list("audio", published=True))
    store.seed(definitions)
    return len(store.list("audio", published=True)) - before


def _run_concurrent_migration(store: ContentStore, migration, attempts: int = 4) -> None:
    """Laisse Web, Core et Voice migrer la base partagee sans se faire tomber.

    Une collision signifie qu'un autre service vient de publier une version
    plus recente. On relit alors la base en relancant la migration idempotente.
    """
    for attempt in range(attempts):
        try:
            migration(store)
            return
        except ConflictError:
            time.sleep(0.05 * (attempt + 1))
    print(f"[KingdomData] Migration concurrente differee : {migration.__name__}.")


def _link_existing_v1_items(store: ContentStore, definitions: list[dict[str, Any]]) -> None:
    """Ajoute les contrats de consommation aux objets V1 déjà publiés."""
    for definition in (item for item in definitions if item["type"] == "item" and item["payload"].get("consumption")):
        current = store.get("item", definition["key"])
        if current["status"] != "published" or current["payload"].get("consumption"):
            continue
        upgraded = {**current["payload"], "consumption": definition["payload"]["consumption"]}
        try:
            draft = store.save("item", definition["key"], upgraded, "migration-consommables", current["version"])
            store.publish("item", definition["key"], draft["version"], "migration-consommables")
        except ConflictError:
            # Un autre service (Web/Core/Voice) a terminé la migration entre
            # la lecture et l'écriture. Sa version plus récente fait foi.
            continue


def migrate_weighted_activity_results(store: ContentStore) -> int:
    """Convertit les anciens butins groupés en listes d'effets, sans nom de bâtiment.

    Seuls les bâtiments multi-métiers importés et toujours publiés sans brouillon
    sont concernés. Les personnalisations ajoutées autour des activités sont conservées.
    """
    migrated = 0
    for published in store.list("building", published=True):
        payload = published["payload"]
        modules = payload.get("modules", {})
        if payload.get("source") != "KingdomEngine V1" or len(modules.get("professions", [])) < 2:
            continue
        if not any("rewards" in outcome for activity in modules.get("activities", []) for outcome in activity.get("outcomes", [])):
            continue
        latest = store.get("building", published["entity_key"])
        if latest["status"] != "published" or latest["version"] != published["version"]:
            continue
        xp_per_level = int(modules.get("rules", {}).get("experience_per_level", 100))
        upgraded_activities = []
        for activity in modules.get("activities", []):
            outcomes = []
            for outcome in activity.get("outcomes", []):
                if "effects" in outcome:
                    outcomes.append(outcome); continue
                effects = [
                    {"type": "reward", "resource": resource, "amount": amount}
                    for resource, amount in outcome.get("rewards", {}).items()
                ]
                if activity.get("profession"):
                    effects.append({"type": "profession", "profession": activity["profession"], "experience": int(activity.get("experience", 0)), "experience_per_level": xp_per_level})
                effects.append({"type": "emit", "event": "building.activity.completed", "payload": {"building": published["entity_key"], "activity": activity["key"], "profession": activity.get("profession", ""), "outcome": outcome.get("key", "result")}})
                outcomes.append({"key": outcome.get("key", "result"), "weight": outcome.get("weight", 1), "effects": effects})
            upgraded_activities.append({**activity, "outcomes": outcomes})
        upgraded = {**payload, "modules": {**modules, "activities": upgraded_activities}}
        upgraded["actions"] = actions_from_modules(published["entity_key"], upgraded["modules"])
        try:
            draft = store.save("building", published["entity_key"], upgraded, "migration-random-result", published["version"])
            store.publish("building", published["entity_key"], draft["version"], "migration-random-result")
            migrated += 1
        except ConflictError:
            continue
    return migrated


def _link_existing_v1_buildings(store: ContentStore, definitions: list[dict[str, Any]]) -> None:
    """Ajoute seulement la reference visuelle aux imports anterieurs, sans ecraser leur configuration."""
    for definition in (item for item in definitions if item["type"] == "building"):
        current = store.get("building", definition["key"])
        payload = current["payload"]
        if current["status"] != "published" or payload.get("source") != "KingdomEngine V1":
            continue
        canonical = definition["payload"]
        current_blueprint = payload.get("interface", {}).get("blueprint")
        target_blueprint = canonical.get("interface", {}).get("blueprint")
        if target_blueprint and current_blueprint != target_blueprint:
            upgraded = {**payload, "interface_texts": canonical.get("interface_texts", payload.get("interface_texts", {}))}
            # Les modules absents des premières importations sont complétés,
            # sans écraser les valeurs déjà personnalisées dans KingdomWeb.
            upgraded["modules"] = {**canonical.get("modules", {}), **payload.get("modules", {})}
            upgraded["actions"] = actions_from_modules(definition["key"], upgraded.get("modules", {}))
            renderer = (interface_from_workshop_modules if str(target_blueprint).startswith("workshop_") else
                        interface_from_hospitality_modules if str(target_blueprint).startswith("hospitality") else
                        interface_from_activity_modules)
            upgraded["interface"] = renderer(definition["key"], upgraded, upgraded["actions"])
            try:
                draft = store.save("building", definition["key"], upgraded, "migration-v1-interface-v2", current["version"])
                store.publish("building", definition["key"], draft["version"], "migration-v1-interface-v2")
            except ConflictError:
                pass
            continue
        if payload.get("interface"):
            continue
        upgraded = {
            **payload,
            "interface_key": definition["payload"]["interface_key"],
            "interface": clone_interface(definition["payload"]["interface"]),
        }
        try:
            draft = store.save("building", definition["key"], upgraded, "migration-v1-interface", current["version"])
            store.publish("building", definition["key"], draft["version"], "migration-v1-interface")
        except ConflictError:
            continue


def _building_definitions(root: Path) -> list[dict[str, Any]]:
    buildings_root = root / "KingdomData" / "buildings"
    item_prices = _item_prices(root / "KingdomData" / "items")
    item_catalogue = _item_catalogue(root / "KingdomData" / "items")
    delivery_markets = _read(buildings_root / "deliveries.json").get("buildings", {}) if (buildings_root / "deliveries.json").exists() else {}
    tavern_rumors = _read(buildings_root / "tavern_rumors.json").get("rumors", []) if (buildings_root / "tavern_rumors.json").exists() else []
    builders = {
        "mine": lambda data: _mine_payload(data),
        "forest": lambda data: _forest_payload(data),
        "forge": lambda data: _forge_payload(data, item_prices, item_catalogue),
        "tavern": lambda data: _tavern_payload(data, tavern_rumors),
    }
    definitions: list[dict[str, Any]] = []
    for key, builder in builders.items():
        path = buildings_root / f"{key}.json"
        if path.exists():
            payload = builder(_read(path))
            market = delivery_markets.get(key, {})
            payload["modules"]["market_purchases"] = [
                {"item_key": item, "unit_price": price,
                 "name": item_catalogue.get(item, {}).get("name", item.replace("_", " ").capitalize()),
                 "emoji": item_catalogue.get(item, {}).get("emoji", "📦")}
                for item, price in market.get("prices", {}).items()
            ]
            payload["action_mode"] = "generated"
            payload["actions"] = actions_from_modules(key, payload["modules"])
            payload["interface_key"] = f"ui_{key}"
            blueprint = payload.get("interface_blueprint")
            payload["interface"] = (interface_from_activity_modules if blueprint == "activity_professions" else interface_from_workshop_modules if blueprint == "workshop_market" else interface_from_hospitality_modules if blueprint == "hospitality" else interface_from_building)(key, payload, payload["actions"])
            definitions.append({"type": "building", "key": key, "payload": payload})
            definitions.append({"type": "interface", "key": f"ui_{key}", "payload": clone_interface(payload["interface"])})
    projects_path = buildings_root / "construction_projects.json"
    if projects_path.exists():
        for project in _read(projects_path).get("projects", []):
            payload = _project_payload(project)
            payload["action_mode"] = "generated"
            payload["actions"] = actions_from_modules(project["key"], payload["modules"])
            payload["interface_key"] = f"ui_{project['key']}"
            payload["interface"] = interface_from_building(project["key"], payload, payload["actions"])
            definitions.append({"type": "building", "key": project["key"], "payload": payload})
            definitions.append({"type": "interface", "key": f"ui_{project['key']}", "payload": clone_interface(payload["interface"])})
    return definitions


def clone_interface(payload: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(payload, ensure_ascii=False))


def _item_prices(items_root: Path) -> dict[str, int]:
    prices: dict[str, int] = {}
    for catalogue in items_root.glob("*.json"):
        for key, payload in _read(catalogue).items():
            prices[key] = int(payload.get("price", 0))
    return prices


def _item_catalogue(items_root: Path) -> dict[str, dict[str, Any]]:
    return {key: payload for catalogue in items_root.glob("*.json") for key, payload in _read(catalogue).items()}


def _base_payload(data: dict[str, Any], emoji: str, description: str, kind: str) -> dict[str, Any]:
    npc_key = str(data.get("npc", data.get("npc_name", ""))).strip().lower().replace(" ", "_")
    npc = {
        "key": npc_key,
        "name": data.get("npc_name", str(data.get("npc", "")).title()),
        "profession": data.get("npc_profession", ""),
        "age": data.get("npc_age"),
        "personality": data.get("npc_personality", data.get("npc_traits", [])),
        "phrases": data.get("npc_phrases", []),
    }
    return {
        "name": data.get("name", kind.title()),
        "emoji": emoji,
        "description": description,
        "building_kind": kind,
        "color": "7a1f1f",
        "npc_name": npc["name"],
        "source": "KingdomEngine V1",
        "modules": {"npc": npc},
    }


def _mine_payload(data: dict[str, Any]) -> dict[str, Any]:
    payload = _base_payload(data, "⛏️", "Extraire minerais et pierre dans les galeries royales.", "harvest")
    activities = []
    for gallery in data.get("galleries", []):
        outcomes = [
            {"key": loot["item_key"], "weight": loot.get("weight", 1), "rewards": {loot["item_key"]: [loot.get("min", 1), loot.get("max", 1)]}}
            for loot in gallery.get("loot", [])
        ]
        activities.append({
            **gallery, "profession": "miner", "tool": "simple_pickaxe",
            "tool_max_durability": int(data.get("starter_pickaxe", {}).get("durability", 20)),
            "outcomes": outcomes,
        })
    payload["modules"].update({
        "rules": {
            "energy_max": data.get("energy_max", 100),
            "energy_recovery_per_hour": data.get("energy_recovery_per_hour", 10),
            "experience_per_level": data.get("experience_per_level", 100),
        },
        "professions": [{
            "key": "miner", "name": data.get("npc_profession", "Mineur"),
            "required_item": "simple_pickaxe", "grant_required_item": True,
            "starter_tool": data.get("starter_pickaxe", {}),
            "tool_tiers": data.get("pickaxe_tiers", {}),
        }],
        "activities": activities,
        "products": [], "recipes": [], "deliveries": [], "repairs": {}, "upgrades": [],
    })
    return payload


def _forest_payload(data: dict[str, Any]) -> dict[str, Any]:
    payload = _base_payload(data, "🌲", "Exploiter la foret, chasser et livrer ses ressources.", "harvest")
    payload["interface_blueprint"] = "activity_professions"
    activities = []
    for profession, zones in data.get("zones", {}).items():
        for zone in zones:
            tool = data.get("profession_requirements", {}).get(profession)
            tool_tier = data.get("tool_tiers", {}).get(tool, {})
            activities.append({
                **zone,
                "profession": profession,
                "tool": tool,
                "durability_cost": zone.get("durability_cost", 1 if profession == "hunter" else 0),
                "tool_max_durability": tool_tier.get("max_durability", 90 if profession == "hunter" else data.get("axe_durability", 20)),
                "outcomes": [
                    {
                        "key": outcome.get("key", "result"),
                        "weight": outcome.get("weight", 1),
                        "effects": [
                            *[
                                {"type": "reward", "resource": resource, "amount": amount}
                                for resource, amount in outcome.get("loot", {}).items()
                            ],
                            {"type": "profession", "profession": profession, "experience": int(zone.get("experience", 0)), "experience_per_level": int(data.get("experience_per_level", 100))},
                            {"type": "emit", "event": "building.activity.completed", "payload": {"building": "forest", "activity": zone["key"], "profession": profession, "outcome": outcome.get("key", "result")}},
                        ],
                    }
                    for outcome in zone.get("outcomes", [])
                ],
            })
    professions = [
        {
            "key": key,
            "name": {"woodcutter": "Bûcheron", "hunter": "Chasseur"}.get(key, key.title()),
            "emoji": {"woodcutter": "🪓", "hunter": "🏹"}.get(key, "📜"),
            "required_item": item, "tool_tiers": data.get("tool_tiers", {}).get(item, {}),
        }
        for key, item in data.get("profession_requirements", {}).items()
    ]
    deliveries = [
        {"item_key": item, "target_building_key": config.get("building_key", ""), "unit_price": config.get("unit_price", 0)}
        for item, config in data.get("deliveries", {}).items()
    ]
    payload["modules"].update({
        "rules": {"experience_per_level": data.get("experience_per_level", 100), "default_axe_durability": data.get("axe_durability", 20)},
        "professions": professions,
        "activities": activities,
        "deliveries": deliveries,
        "delivery_mode": "all_available",
        "products": [], "recipes": [], "repairs": {}, "upgrades": [],
    })
    payload["interface_texts"] = {
        "home_title": "🌲 LA FORÊT DU ROYAUME",
        "welcome": "Le vent traverse les cimes, le gibier remue dans les fougères.\n\n━━━━━━━━━━  **REFUGE FORESTIER**  ━━━━━━━━━━",
        "enter_label": "Entrer dans la Forêt",
        "refuge_title": "🌲 LA FORÊT DU ROYAUME",
        "refuge_subtitle": "Choisis ta voie, pars en expédition ou livre les ressources récoltées.",
        "talk_label": "Discuter avec Gaspard",
        "zones_subtitle": "Le résultat est tiré et conservé dès ton départ.",
        "deliveries_label": "Livrer les ressources de la Forêt…",
    }
    return payload


def _forge_payload(data: dict[str, Any], item_prices: dict[str, int], item_catalogue: dict[str, dict[str, Any]]) -> dict[str, Any]:
    payload = _base_payload(data, "⚒️", "Forger, reparer, ameliorer et approvisionner les equipements du Royaume.", "production")
    initial_stock = int(data.get("initial_stock", 0))
    products = [
        {"item_key": item, "price": item_prices.get(item, 0), "active": True, "initial_stock": initial_stock,
         "name": item_catalogue.get(item, {}).get("name", item), "emoji": item_catalogue.get(item, {}).get("emoji", "📦"),
         "description": item_catalogue.get(item, {}).get("description", "")}
        for item in data.get("products", [])
    ]
    deliveries = [
        {"item_key": item, "target_building_key": "forge", "unit_price": price}
        for item, price in data.get("delivery_prices", {}).items()
    ]
    recipes = [{
        **recipe, "profession": "blacksmith", "active": recipe.get("active", True),
        "ingredient_source": "building_stock", "output_destination": "building_stock",
    } for recipe in data.get("recipes", [])]
    upgrades = [
        {"path": path, "tool_key": "simple_pickaxe" if path == "miner_pickaxe" else path, **upgrade}
        for path, values in data.get("upgrades", {}).items()
        for upgrade in values
    ]
    payload["modules"].update({
        "rules": {"experience_per_level": data.get("experience_per_level", 100)},
        "professions": [{"key": "blacksmith", "name": "Forgeron"}],
        "products": products,
        "recipes": recipes,
        "activities": [],
        "deliveries": deliveries,
        "delivery_mode": "all_available",
        "repairs": data.get("repair", {}),
        "upgrades": upgrades,
    })
    payload["interface_blueprint"] = "workshop_market"
    payload["interface_texts"] = {
        "home_title": "🔥 LA FORGE DORÉE",
        "welcome": "Le feu rugit tandis que les marteaux frappent l'acier.\n\n━━━━━━━━━━  **COMPTOIR DE WAGNER**  ━━━━━━━━━━",
        "talk_label": "Discuter avec Wagner",
        "upgrade_label": "Améliorer ma pioche",
    }
    return payload


def _tavern_payload(data: dict[str, Any], rumor_catalogue: list[dict[str, Any]]) -> dict[str, Any]:
    payload = _base_payload(data, "🍺", "Acheter des plats, travailler en cuisine, jouer et ecouter les rumeurs.", "commerce")
    cook = data.get("cook_job", {})
    recipes = [
        {
            **recipe, "name": recipe.get("title", recipe.get("key", "Recette")), "profession": "cook",
            "energy_cost": recipe.get("energy_cost", 15), "ingredient_source": "building_stock",
            "output_destination": "building_stock",
            "initial_ingredient_stock": cook.get("initial_ingredient_stock", {}),
        }
        for recipe in cook.get("recipes", [])
    ]
    payload["interface_blueprint"] = "hospitality"
    payload["modules"].update({
        "rules": {"experience_per_level": cook.get("experience_per_level", 100), "max_active_missions": cook.get("max_active_missions", 1)},
        "professions": [{"key": "cook", "name": cook.get("name", "Cuisinier")}],
        "products": data.get("products", []),
        "recipes": recipes,
        "activities": [], "deliveries": [], "repairs": {}, "upgrades": [],
        "stock": {"ingredients": cook.get("initial_ingredient_stock", {})},
        "categories": data.get("categories", {}),
        "rumors": {**data.get("rumors", {}), "catalogue": rumor_catalogue},
        "player_stats": {
            "energy": {"name": "Énergie", "default": 100, "minimum": 0, "maximum": 100, "change_per_hour": 10},
            "alcohol": {"name": "Alcoolémie", "default": 0, "minimum": 0, "maximum": 100, "change_per_hour": -4},
        },
        "games": {"dice": _dice_configuration(data.get("dice_game", {}))},
    })
    payload["interface_texts"] = {
        "welcome": "La chaleur du foyer, le parfum des plats et le fracas des chopes t'accueillent.",
        "shop_label": "Commander au comptoir", "consume_label": "Boire ou manger",
        "profession_label": "Travailler en cuisine", "stories_label": "Écouter Edgar",
        "games_label": "Jugement des Six Faces", "stories_description": "Edgar baisse la voix et jette un regard vers les tables voisines…",
    }
    return payload


def _dice_configuration(config: dict[str, Any]) -> dict[str, Any]:
    multipliers = config.get("multipliers", {})
    return {
        **config, "key": "dice", "name": "Jugement des Six Faces", "sides": 6, "stake_resource": "money",
        "bets": [
            *[{"key": f"crown_{face}", "name": f"Couronne {face}", "winning_faces": [face], "multiplier": multipliers.get("crown", 6)} for face in range(1, 7)],
            {"key": "judgement_even", "name": "Jugement pair", "winning_faces": [2, 4, 6], "multiplier": multipliers.get("judgement", 2)},
            {"key": "judgement_odd", "name": "Jugement impair", "winning_faces": [1, 3, 5], "multiplier": multipliers.get("judgement", 2)},
            {"key": "destiny_low", "name": "Destin 1 a 3", "winning_faces": [1, 2, 3], "multiplier": multipliers.get("destiny", 2)},
            {"key": "destiny_high", "name": "Destin 4 a 6", "winning_faces": [4, 5, 6], "multiplier": multipliers.get("destiny", 2)},
        ],
    }


def _project_payload(project: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": project["name"], "emoji": project.get("emoji", "🏗️"),
        "description": project.get("description", ""), "building_kind": "administration",
        "color": "7a1f1f", "npc_name": "", "source": "KingdomEngine V1",
        "modules": {
            "npc": {}, "rules": {}, "professions": [], "activities": [], "products": [], "recipes": [],
            "deliveries": [], "repairs": {}, "upgrades": [], "market_purchases": [], "construction": project,
        },
    }


def actions_from_modules(building_key: str, modules: dict[str, Any]) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    npc_phrases = modules.get("npc", {}).get("phrases", [])
    if npc_phrases:
        actions.append({"key": "talk_npc", "name": "Discuter", "emoji": "💬", "enabled": True,
                        "effects": [{"type": "random_message", "choices": [
                            {"key": f"phrase_{index}", "weight": 1, "text": phrase}
                            for index, phrase in enumerate(npc_phrases, 1)
                        ]}]})
    xp_per_level = int(modules.get("rules", {}).get("experience_per_level", 100))
    tool_maxima = {
        str(activity["tool"]): int(activity.get("tool_max_durability", 80))
        for activity in modules.get("activities", []) if activity.get("tool")
    }
    professions = {item["key"]: item for item in modules.get("professions", [])}
    for profession in professions.values():
        effects: list[dict[str, Any]] = [
            {"type": "profession", "operation": "join", "exclusive": True, "profession": profession["key"]},
            {"type": "message", "text": f"Vous exercez maintenant le metier : {profession.get('name', profession['key'])}."},
        ]
        required_item = profession.get("required_item")
        if required_item and profession.get("grant_required_item"):
            effects.insert(1, {"type": "reward", "resource": required_item, "amount": 1})
        if required_item:
            effects.insert(2 if profession.get("grant_required_item") else 1, {
                "type": "tool_grant", "tool": required_item,
                "durability": int(profession.get("initial_durability", profession.get("starter_tool", {}).get("durability", tool_maxima.get(required_item, 1)))),
                "max_durability": int(profession.get("max_durability", profession.get("starter_tool", {}).get("durability", tool_maxima.get(required_item, 1)))),
                "level": int(profession.get("tool_level", 1)),
            })
        join_requirements = dict(profession.get("requirements", {}))
        join_requirements["no_active_profession"] = True
        if required_item and not profession.get("grant_required_item"):
            join_requirements.setdefault("items", {})[required_item] = 1
        actions.append({
            "key": f"join_{profession['key']}", "name": f"Devenir {profession.get('name', profession['key'])}",
            "emoji": "📜", "enabled": True, "requirements": join_requirements, "effects": effects,
        })
        actions.append({
            "key": f"leave_{profession['key']}", "name": f"Quitter le métier {profession.get('name', profession['key'])}",
            "emoji": "🚪", "enabled": True, "requirements": {"profession": profession["key"], "min_level": 1},
            "effects": [{"type": "profession", "operation": "leave", "profession": profession["key"], "block_when_pending": True}],
        })
    for activity in modules.get("activities", []):
        profession = str(activity.get("profession", ""))
        requirements: dict[str, Any] = {"profession": profession, "min_level": int(activity.get("required_level", 1))}
        if activity.get("tool"):
            requirements["items"] = {activity["tool"]: 1}
        immediate_effects = []
        if activity.get("energy_cost"):
            immediate_effects.append({"type": "cost", "resource": "energy", "amount": int(activity["energy_cost"]), "modifier_property": "energy.cost", "activity_key": activity["key"]})
        if activity.get("durability_cost") and activity.get("tool"):
            immediate_effects.append({"type": "tool_modify", "tool": activity["tool"], "operation": "consume_durability", "amount": int(activity["durability_cost"])})
        if activity.get("outcomes") and all("effects" in outcome for outcome in activity["outcomes"]):
            deferred_effects = [{"type": "random_result", "outcomes": activity["outcomes"]}]
        else:
            deferred_effects = [{
                "type": "random_bundle", "outcomes": activity.get("outcomes", []) or [{"key": "empty", "weight": 1, "rewards": {}}],
                "loot_bonus_tool": activity.get("tool"),
            }]
            if profession:
                deferred_effects.append({"type": "profession", "profession": profession, "experience": int(activity.get("experience", 0)), "experience_per_level": xp_per_level})
            deferred_effects.append({"type": "emit", "event": "building.activity.completed", "payload": {"building": building_key, "activity": activity["key"]}})
        action = {
            "key": activity["key"], "name": activity.get("name", activity["key"]), "emoji": activity.get("emoji", "⚙️"),
            "description": activity.get("description", ""), "enabled": activity.get("active", True),
            "duration_seconds": int(activity.get("duration_seconds", 0)), "requirements": requirements,
            "cooldown_seconds": int(activity.get("cooldown_seconds", 0)),
            "global_cooldown_seconds": int(activity.get("global_cooldown_seconds", 0)),
            "modifier_context": {"activity_key": activity["key"], "profession_key": profession, "tags": activity.get("tags", [])},
            "activity_limit": activity.get("activity_limit", {"scope": "building", "max_active": 1, "category": profession}),
            "conditions": {"all": [condition for condition in [
                {"type": "profession_active", "profession": profession} if profession else None,
                {"type": "profession_level", "profession": profession, "operator": ">=", "value": int(activity.get("required_level", 1))} if profession else None,
                {"type": "tool_present", "tool": activity["tool"]} if activity.get("tool") else None,
                {"type": "tool_durability", "tool": activity["tool"], "operator": ">=", "value": int(activity.get("minimum_durability", activity.get("durability_cost", 0)))} if activity.get("tool") else None,
            ] if condition]},
            "hooks": activity.get("hooks", {}),
        }
        if not action["conditions"]["all"]:
            action.pop("conditions")
        _append_timed(actions, action, immediate_effects, deferred_effects)
    for product in modules.get("products", []):
        item = product["item_key"]
        product_effects = [
            {"type": "cost", "resource": "money", "amount": int(product.get("price", 0))},
            {"type": "stock_cost", "item": item, "amount": 1, "initial_stock": int(product.get("initial_stock", 0))},
            {"type": "reward", "resource": item, "amount": 1},
        ]
        repair_maximum = modules.get("repairs", {}).get("durability", {}).get(item)
        if repair_maximum:
            product_effects.append({"type": "durability", "tool": item, "amount": 0, "max_durability": int(repair_maximum)})
        label = str(product.get("name") or item.replace("_", " ").capitalize())
        actions.append({
            "key": f"buy_{item}", "name": f"Acheter {label}", "emoji": product.get("emoji", "🛒"), "enabled": product.get("active", True),
            "effects": product_effects,
        })
    for recipe in modules.get("recipes", []):
        profession = str(recipe.get("profession", ""))
        if recipe.get("ingredient_source") == "building_stock":
            initial = recipe.get("initial_ingredient_stock", {})
            immediate_effects = [
                {"type": "stock_cost", "item": item, "amount": int(amount), "initial_stock": int(initial.get(item, 0)), "modifier_property": "recipe.ingredient_quantity", "recipe_key": recipe["key"], "ingredient_key": item}
                for item, amount in recipe.get("ingredients", {}).items()
            ]
        else:
            immediate_effects = [{"type": "cost", "resource": item, "amount": int(amount), "modifier_property": "recipe.ingredient_quantity", "recipe_key": recipe["key"], "ingredient_key": item} for item, amount in recipe.get("ingredients", {}).items()]
        if recipe.get("energy_cost"):
            immediate_effects.append({"type": "cost", "resource": "energy", "amount": int(recipe["energy_cost"]), "modifier_property": "energy.cost", "recipe_key": recipe["key"]})
        deferred_effects = []
        output_effect = "stock_reward" if recipe.get("output_destination") == "building_stock" else "reward"
        if output_effect == "stock_reward":
            deferred_effects.append({"type": output_effect, "item": recipe["output_item_key"], "amount": int(recipe.get("output_quantity", 1)), "building": building_key})
        else:
            deferred_effects.append({"type": output_effect, "resource": recipe["output_item_key"], "amount": int(recipe.get("output_quantity", 1))})
        if recipe.get("reward"):
            deferred_effects.append({"type": "reward", "resource": "money", "amount": int(recipe["reward"])})
        if profession:
            deferred_effects.append({"type": "profession", "profession": profession, "experience": int(recipe.get("experience", 0)), "experience_per_level": xp_per_level})
        action = {
            "key": recipe["key"], "name": recipe.get("name", recipe.get("title", recipe["key"])), "emoji": "🛠️",
            "enabled": recipe.get("active", True), "duration_seconds": int(recipe.get("duration_seconds", 0)),
            "requirements": {"profession": profession, "min_level": int(recipe.get("required_level", 1))} if profession else {},
            "modifier_context": {"recipe_key": recipe["key"], "profession_key": profession, "tags": recipe.get("tags", [])},
        }
        _append_timed(actions, action, immediate_effects, deferred_effects)
    deliveries = modules.get("deliveries", [])
    if deliveries and modules.get("delivery_mode") == "all_available":
        actions.append({"key": "deliver_resources", "name": "Livrer mes ressources", "emoji": "📦", "enabled": True, "effects": [{"type": "deliver_inventory", "items": [{"item": delivery["item_key"], "building": delivery.get("target_building_key", building_key), "unit_price": int(delivery.get("unit_price", 0))} for delivery in deliveries], "message": "Wagner réceptionne {items} et te verse **{total} écus**."}]})
        deliveries = []
    for delivery in deliveries:
        item = delivery["item_key"]
        label = str(delivery.get("name") or item.replace("_", " ").capitalize())
        actions.append({
            "key": f"deliver_{item}", "name": f"Livrer {label}", "emoji": delivery.get("emoji", "📦"), "enabled": True,
            "effects": [
                {"type": "cost", "resource": item, "amount": 1},
                {"type": "stock_reward", "item": item, "amount": 1, "building": delivery.get("target_building_key", building_key)},
                {"type": "reward", "resource": "money", "amount": int(delivery.get("unit_price", 0))},
            ],
        })
    for purchase in modules.get("market_purchases", []):
        item = purchase["item_key"]
        label = str(purchase.get("name") or item.replace("_", " ").capitalize())
        actions.append({
            "key": f"supply_{item}", "name": f"Approvisionner en {label}", "emoji": purchase.get("emoji", "🚚"), "enabled": True,
            "effects": [
                {"type": "cost", "resource": item, "amount": 1},
                {"type": "stock_reward", "item": item, "amount": 1, "building": building_key},
                {"type": "reward", "resource": "money", "amount": int(purchase.get("unit_price", 0))},
            ],
        })
    construction = modules.get("construction", {})
    for stage in construction.get("stages", []):
        for requirement in stage.get("requirements", []):
            resources = requirement.get("accepted_items", []) or (["money"] if requirement.get("kind") == "currency" else [requirement["key"]])
            for resource in resources:
                actions.append({
                    "key": f"give_{stage['key']}_{resource}",
                    "name": f"Contribuer : {requirement.get('name', resource)}", "emoji": requirement.get("emoji", "📦"), "enabled": True,
                    "requirements": {"project_stage": stage["key"], "target_quantity": int(requirement.get("quantity", 0))},
                    "effects": [
                        {"type": "cost", "resource": resource, "amount": 1},
                        {"type": "stock_reward", "item": f"project_{stage['key']}_{requirement['key']}", "amount": 1, "building": building_key},
                        {"type": "contribution", "objective": stage["key"], "resource": requirement["key"], "amount": 1, "metadata": {"accepted_resource": resource}},
                    ],
                })
    rumors = modules.get("rumors", {})
    rumor_choices = [
        {"key": rumor["key"], "text": rumor.get("text", ""), "weight": rumor.get("weight", 1)}
        for rumor in rumors.get("catalogue", []) if rumor.get("enabled", True)
    ]
    if rumor_choices:
        actions.append({
            "key": "hear_rumor", "name": "Ecouter une rumeur", "emoji": "🗣️", "enabled": True,
            "cooldown_seconds": int(rumors.get("player_cooldown_seconds", 0)),
            "global_cooldown_seconds": int(rumors.get("global_cooldown_seconds", 0)),
            "effects": [{"type": "random_message", "choices": rumor_choices, "avoid_previous": True,
                         "memory_scope": "player", "memory_key": f"{building_key}:stories"}],
        })
    repair = modules.get("repairs", {})
    for tool, maximum in repair.get("durability", {}).items():
        rule = repair.get("rules", {}).get(tool, {})
        # Compatibilité V1 pilotée par les noms de paramètres présents dans les
        # données (ex. `<famille>_price_per_point`), sans liste d'outils codée.
        legacy_prices = {
            key.removesuffix("_price_per_point"): value
            for key, value in repair.items() if key.endswith("_price_per_point") and key != "equipment_price_per_point"
        }
        family_price = next((value for family, value in legacy_prices.items() if family in str(tool).split("_")), repair.get("equipment_price_per_point", 1))
        price_per_point = int(rule.get("price_per_point", repair.get("price_per_point_by_tool", {}).get(tool, family_price)))
        configured_maximum = int(rule.get("max_durability", maximum))
        tool_label = str(repair.get("item_names", {}).get(tool) or str(tool).replace("_", " ").capitalize())
        actions.append({
            "key": f"repair_{tool}", "name": f"Réparer {tool_label}", "emoji": "🔧", "enabled": True,
            "requirements": {"items": {tool: 1}},
            "effects": [{"type": "repair", "tool": tool, "max_durability": configured_maximum, "price_per_point": price_per_point}],
        })
    for upgrade in modules.get("upgrades", []):
        tool = upgrade.get("tool_key") or upgrade.get("tool") or upgrade.get("path")
        if not tool:
            # Une entrée partiellement éditée dans KingdomWeb ne doit pas faire
            # tomber toute la supervision ni les autres actions du bâtiment.
            continue
        effects = [{"type": "cost", "resource": "money", "amount": int(upgrade.get("price", 0))}]
        effects.extend({"type": "cost", "resource": item, "amount": int(amount)} for item, amount in upgrade.get("ingredients", {}).items())
        effects.append({
            "type": "upgrade", "tool": tool, "to_level": int(upgrade.get("to_level", 1)),
            "max_durability": int(upgrade.get("max_durability", 1)), "loot_bonus": int(upgrade.get("loot_bonus", 0)),
        })
        actions.append({
            "key": f"upgrade_{tool}_{upgrade.get('to_level', 1)}", "name": upgrade.get("name", f"Ameliorer {tool}"),
            "emoji": "⬆️", "enabled": True,
            "requirements": {"profession": "miner", "min_level": 1, "items": {tool: 1}, "tool": tool, "tool_level": int(upgrade.get("from_level", 1))},
            "effects": effects,
        })
    dice = modules.get("games", {}).get("dice", {})
    if dice:
        stake, sides = int(dice.get("stake", 0)), int(dice.get("sides", 6))
        for bet in dice.get("bets", []):
            winning = {int(face) for face in bet.get("winning_faces", [])}
            outcomes = [
                {"key": f"roll_{face}", "weight": 1, "rewards": {"money": stake * int(bet.get("multiplier", 1))} if face in winning else {}}
                for face in range(1, sides + 1)
            ]
            actions.append({"key": f"dice_{bet['key']}", "name": bet.get("name", bet["key"]), "emoji": "🎲", "enabled": True, "effects": [
                {"type": "cost", "resource": "money", "amount": stake}, {"type": "random_bundle", "outcomes": outcomes},
            ]})
    return actions


def _append_timed(actions: list[dict[str, Any]], action: dict[str, Any], immediate: list[dict[str, Any]], deferred: list[dict[str, Any]]) -> None:
    duration = int(action.get("duration_seconds", 0))
    if duration <= 0:
        actions.append({**action, "effects": [*immediate, *deferred]})
        return
    actions.append({
        **action,
        "effects": [*immediate, {
            "type": "schedule", "action": action["key"], "duration_seconds": duration, "effects": deferred,
            "limit_scope": action.get("activity_limit", {}).get("scope", "action"),
            "max_active": int(action.get("activity_limit", {}).get("max_active", 1)),
            "category": action.get("activity_limit", {}).get("category", ""),
            "hooks": action.get("hooks", {}),
        }],
    })
    actions.append({
        "key": f"claim_{action['key']}"[:64], "name": f"Recuperer : {action['name']}", "emoji": "✅",
        "enabled": action.get("enabled", True), "effects": [{"type": "claim_scheduled", "action": action["key"]}],
    })


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _building_key(label: str) -> str:
    if "tavern" in label: return "tavern"
    if "mine" in label: return "mine"
    if "forge" in label: return "forge"
    if "bucheron" in label or "foret" in label or "forêt" in label: return "forest"
    return "village_square"
