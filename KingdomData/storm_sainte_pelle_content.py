"""Contenu déclaratif de la bêta « La Tempête de la Sainte Pelle ».

Le Royaume publié reste intact : ce module transforme uniquement une copie du
pack jouable lors de la création de ce nouveau modèle officiel.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .interfaces import interface_from_building


BALANCE = "BALANCE_DRAFT / À VALIDER"


def _row(rows: list[dict[str, Any]], kind: str, key: str) -> dict[str, Any]:
    return next(row for row in rows if row["type"] == kind and row["key"] == key)["payload"]


def _add(rows: list[dict[str, Any]], kind: str, key: str, payload: dict[str, Any]) -> None:
    rows.append({"type": kind, "key": key, "payload": payload})


def _minute(value: int, operator: str = ">=") -> dict[str, Any]:
    return {"type": "scenario_elapsed_minutes", "operator": operator, "value": value}


def _progress(key: str, resource: str, value: int, operator: str = ">=") -> dict[str, Any]:
    return {"type": "collective_progress", "objective": key, "resource": resource,
            "operator": operator, "value": value}


def _button(building: str, action: str, label: str, slot: int, *, emoji: str = "⚙️",
            conditions: dict[str, Any] | None = None) -> dict[str, Any]:
    component = {"id": f"storm_{building}_{action}"[:64], "type": "button", "slot": slot,
                 "props": {"label": label, "emoji": emoji, "style": "primary"},
                 "interaction": {"type": "action", "building": building, "action": action}}
    if conditions:
        component["visibility_conditions"] = conditions
    if action.startswith("claim_"):
        component["visible_when"] = {"ready_action": action.removeprefix("claim_")}
    return component


def _page(building: dict[str, Any], key: str, name: str, title: str,
          subtitle: str, components: list[dict[str, Any]]) -> None:
    interface = building["interface"]
    pages = interface["pages"]
    pages[:] = [page for page in pages if page.get("key") != key]
    pages.append({"key": key, "name": name, "components": [
        {"id": f"storm_hero_{key}", "type": "hero", "props": {"title": title, "subtitle": subtitle, "emoji": "⛪"}},
        *components,
        {"id": f"storm_back_{key}", "type": "button", "slot": 24,
         "props": {"label": "Retour", "emoji": "↩️", "style": "secondary"},
         "interaction": {"type": "navigate", "page": "home"}},
    ]})
    home = next(page for page in pages if page["key"] == "home")["components"]
    used = {int(component["slot"]) for component in home if component.get("slot") is not None}
    slot = next(index for index in range(25) if index not in used)
    home.append({"id": f"storm_nav_{key}", "type": "button", "slot": slot,
                 "props": {"label": name, "emoji": "⛪", "style": "secondary"},
                 "interaction": {"type": "navigate", "page": key}})


def _deposit(building: dict[str, Any], item: str, objective: str, target: int,
             *, minute: int, amount: int = 1, label: str | None = None) -> dict[str, Any]:
    key = f"deposit_{objective}_{amount}"
    condition = {"all": [_minute(minute), _progress(objective, item, target - amount, "<=")]}
    action = {"key": key, "name": label or f"Déposer {amount} {item}", "emoji": "📦",
              "enabled": True, "conditions": condition,
              "effects": [{"type": "cost", "resource": item, "amount": amount},
                          {"type": "contribution", "objective": objective, "resource": item, "amount": amount}],
              "balance_status": BALANCE}
    building["actions"].append(action)
    return action


def _timed_contribution(building: dict[str, Any], objective: str, target: int,
                        duration: int, minute: int, *, prerequisites: list[dict[str, Any]] | None = None,
                        name: str) -> tuple[dict[str, Any], dict[str, Any]]:
    start_key, claim_key = f"start_{objective}", f"claim_{objective}"
    ready = {"all": [_minute(minute), _progress(objective, "progress", target - 1, "<=")]
             + list(prerequisites or [])}
    start = {"key": start_key, "name": name, "emoji": "🛠️", "enabled": True,
             "conditions": ready, "effects": [
                 {"type": "schedule", "action": objective, "duration_seconds": duration,
                  "limit_scope": "shared_action", "max_active": 1,
                  "effects": [{"type": "contribution", "objective": objective,
                               "resource": "progress", "amount": 1}]}
             ], "balance_status": BALANCE}
    claim = {"key": claim_key, "name": f"Terminer : {name}", "emoji": "✅", "enabled": True,
             "effects": [{"type": "claim_scheduled", "action": objective}],
             "balance_status": BALANCE}
    building["actions"].extend([start, claim])
    return start, claim


def _event(key: str, name: str, minute: int, description: str, *, duration: int = 60,
           modifiers: list[dict[str, Any]] | None = None, weather: str | None = None,
           completion: dict[str, Any] | None = None,
           collective: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"name": name, "emoji": "⛈️" if weather == "storm" else "📜",
                              "description": description, "trigger": {"type": "scheduled", "minute": minute},
                              "enabled": True, "duration_seconds": duration,
                              "modifiers": modifiers or [], "balance_status": BALANCE}
    if weather:
        payload["weather_key"] = weather
    if completion:
        payload["completion_objective"] = completion
    if collective:
        payload["activation_conditions"] = {"collective": collective}
    return {"type": "event", "key": key, "payload": payload}


def _quest(key: str, name: str, xp: int, objectives: list[dict[str, Any]],
           *, from_minute: int = 0, description: str = "") -> dict[str, Any]:
    return {"type": "quest", "key": key, "payload": {
        "name": name, "description": description or name, "emoji": "📜", "reward_xp": xp,
        "available_from_minute": from_minute, "repeatable": False,
        "objectives": objectives, "balance_status": BALANCE,
    }}


def _visit(key: str, building: str) -> dict[str, Any]:
    return {"key": key, "type": "visit", "building_key": building}


def _delivery(key: str, item: str, building: str, quantity: int) -> dict[str, Any]:
    return {"key": key, "type": "delivery", "item_key": item,
            "destination_building_key": building, "quantity": quantity}


def _action_goal(key: str, building: str, action: str, quantity: int = 1) -> dict[str, Any]:
    return {"key": key, "type": "action", "building_key": building,
            "action_key": action, "quantity": quantity}


def build_storm_template(source: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Construit un pack indépendant avec toutes ses valeurs éditables dans KingdomWeb."""
    rows = deepcopy(source)
    # L'ancien scénario d'esplanade et ses anciens événements ne sont jamais
    # instanciés dans la nouvelle bêta. Les recettes/objets V1 restent jouables.
    rows[:] = [row for row in rows if not (
        row["type"] == "event" or
        (row["type"] == "building" and row["key"] == "festival_esplanade") or
        (row["type"] == "voice_presence" and row["key"] == "presence_festival_esplanade") or
        (row["type"] == "audio_group" and row["key"] == "preset_festival_scene") or
        (row["type"] == "audio" and row["key"] == "preset_festival_ambience")
    )]
    buildings = {row["key"]: row["payload"] for row in rows if row["type"] == "building"}
    for building in buildings.values():
        building.setdefault("modules", {}).setdefault("audio", {}).pop("event_routes", None)
        for action in building.get("actions", []):
            action.pop("hooks", None)
        for activity in building.get("modules", {}).get("activities", []):
            activity.pop("hooks", None)
        for delivery in building.get("modules", {}).get("deliveries", []):
            delivery.pop("events", None)
    for row in rows:
        if row["type"] == "item":
            row["payload"]["building_relations"] = [relation for relation in row["payload"].get("building_relations", [])
                                                     if relation.get("building_key") != "festival_esplanade"]

    settings = _row(rows, "server_settings", "kingdom_server")
    settings.update(name="La Tempête de la Sainte Pelle",
                    description="Bêta coopérative de trois heures, depuis le vieux pont jusqu'à l'église.",
                    template_revision=2, balance_status=BALANCE)
    settings["onboarding"].update(
        starting_money=100,
        currency_label="écus",
        currency_label_singular="écu",
        currency_label_plural="écus",
    )
    settings["roles"].update(game_master="Roi", player="Habitants du Royaume")

    # Bibliothèque vocale réellement fournie avec la mission. Les numéros de
    # scène sont conservés tels quels : ils restent filtrables et éditables
    # dans KingdomWeb sans inventer une transcription absente des fichiers.
    supplied_voices = {"edgar": (13, 4), "roland": (13, 2), "wagner": (13, 2)}
    for npc_key, (scene_count, first_scene_variants) in supplied_voices.items():
        profile = _row(rows, "voice_profile", f"voice_{npc_key}")
        clips = []
        for scene in range(scene_count):
            variants = first_scene_variants if npc_key == "edgar" and scene == 0 else 2
            for variant in range(1, variants + 1):
                stem = f"{npc_key}_{scene:02d}_{variant:02d}"
                audio_key = f"storm_voice_{stem}"
                path = f"assets/storm_sainte_pelle/voices/{npc_key}/{stem}.mp3"
                _add(rows, "audio", audio_key, {
                    "name": f"{profile['name']} · scène {scene:02d} · variante {variant:02d}",
                    "emoji": "🗣️", "description": "Enregistrement fourni avec la mission bêta.",
                    "storage_path": path, "file_name": f"{stem}.mp3", "audio_type": "voice",
                    "volume": 1, "loop": False,
                    "tags": ["storm_sainte_pelle", npc_key, f"scene_{scene:02d}", "provided"],
                })
                clips.append({
                    "key": f"scene_{scene:02d}_{variant:02d}",
                    "name": f"Scène {scene:02d} · variante {variant:02d}",
                    "trigger": "manual", "audio_key": audio_key,
                    "text": "Information importante également disponible dans les textes du scénario.",
                    "metadata": {"provided_file": f"{stem}.mp3", "scene_index": scene},
                })
        profile["clips"] = clips
        profile["tags"] = ["storm_sainte_pelle", "provided"]
        profile["missing_assets_status"] = "Voix fournie — scènes événementielles exactes listées dans le rapport audio"
    settings["live_ops"] = {
        "scenario_duration_minutes": 180, "status": "preparation",
        "objectives": [
            {"key": key, "name": name, "target": target, "unit": unit,
             "action_keys": actions, "increment": 1, "state": "locked" if unlock else "active",
             "available_from_minute": unlock, "balance_status": BALANCE}
            for key, name, target, unit, actions, unlock in [
                ("mine_wood", "Bois pour la galerie", 8, "bois", ["deposit_mine_wood_1", "deposit_mine_wood_8"], 105),
                ("mine_stone", "Pierre pour la galerie", 8, "pierres", ["deposit_mine_stone_1", "deposit_mine_stone_8"], 105),
                ("storm_mine_repaired", "Galerie sécurisée", 1, "réparation", ["claim_storm_mine_repaired"], 105),
                ("church_tree_cleared", "Arbre dégagé", 3, "actions", ["claim_church_tree_cleared"], 120),
                ("church_wood", "Bois de charpente", 40, "bois", ["deposit_church_wood_1", "deposit_church_wood_8"], 120),
                ("church_stone", "Pierre de maçonnerie", 28, "pierres", ["deposit_church_stone_1", "deposit_church_stone_8"], 120),
                ("church_brackets", "Ferrures", 4, "ferrures", ["deposit_church_brackets_1"], 120),
                ("church_provisions", "Provisions", 8, "portions", ["deposit_church_provisions_1", "deposit_church_provisions_2"], 120),
                ("church_assembly", "Premiers assemblages", 2, "assemblages", ["claim_church_assembly"], 120),
            ]],
        "timeline": [], "progress_display": "per_resource_and_overall",
        "balance_status": BALANCE,
    }
    environment = _row(rows, "environment", "realm_climate")
    environment.update(name="Ciel de la Sainte Pelle", mode="manual", weather_key="clear",
                       weather={"key": "clear", "name": "Ciel clair", "emoji": "☀️"},
                       conditions=[
                           {"key": "clear", "name": "Ciel clair", "emoji": "☀️", "weight": 1},
                           {"key": "cloudy", "name": "Nuages lourds", "emoji": "☁️", "weight": 0},
                           {"key": "storm", "name": "Tempête", "emoji": "⛈️", "weight": 0},
                       ], weather_options=[
                           {"key": "clear", "name": "Ciel clair", "emoji": "☀️"},
                           {"key": "cloudy", "name": "Nuages lourds", "emoji": "☁️"},
                           {"key": "storm", "name": "Tempête", "emoji": "⛈️"},
                       ], gameplay_links=[], scenario_schedule=[], balance_status=BALANCE)

    # Le vieux pont est déjà ouvert. L'église, visible dès T+0, se dégrade
    # pendant l'événement sans modifier rétroactivement les mondes V1.
    river = _row(rows, "location", "riverhold")
    river["connections"].append({"target": "old_bridge", "name": "Vieux pont de Valbrume",
                                 "direction": "bidirectional", "visibility": "visible", "duration_seconds": 15})
    _add(rows, "location", "old_bridge", {"name": "Vieux pont de Valbrume", "emoji": "🌉",
          "description": "Le passage vers l'autre rive est réparé et toujours praticable.",
          "location_type": "road", "parent_key": "green_realm", "connections": [
              {"target": "riverhold", "name": "Vers la place", "direction": "bidirectional", "visibility": "visible", "duration_seconds": 15},
              {"target": "church_bank", "name": "Vers l'église", "direction": "bidirectional", "visibility": "visible", "duration_seconds": 15},
          ]})
    _add(rows, "location", "church_bank", {"name": "Rive de la Sainte Pelle", "emoji": "⛪",
          "description": "La petite église et son parvis sûr, de l'autre côté du pont.",
          "location_type": "place", "parent_key": "green_realm", "connections": [
              {"target": "old_bridge", "name": "Vers le pont", "direction": "bidirectional", "visibility": "visible", "duration_seconds": 15},
          ]})

    for key, name, place, emoji, description in [
        ("old_bridge", "Vieux pont", "old_bridge", "🌉", "Le passage vers l'église reste ouvert, même sous l'orage."),
        ("saint_shovel_church", "Église de la Sainte Pelle", "church_bank", "⛪", "Une petite église vétuste, encore accessible depuis le pont."),
    ]:
        building = {"name": name, "emoji": emoji, "description": description,
                    "location_key": place, "entity_kind": "place", "color": "247d57",
                    "relations": {}, "modules": {"products": [], "recipes": [], "activities": [],
                    "deliveries": [], "professions": [], "upgrades": [], "audio": {}}, "actions": []}
        building["interface"] = interface_from_building(key, building, building["actions"])
        _add(rows, "building", key, building)
        buildings[key] = building

    # Même asset villageois déjà fourni, mais scènes distinctes, pour que le
    # PNJ de l'église et le lieu puissent être configurés séparément dans Web.
    for key, name in [("old_bridge", "Pont de Valbrume"), ("saint_shovel_church", "Parvis de l'église")]:
        scene = f"storm_{key}_scene"
        _add(rows, "audio_group", scene, {"name": name, "emoji": "🎧",
             "description": "Fond villageois temporaire ; ambiance spécifique à fournir.",
             "building_keys": [key], "volume": 0.55,
             "layers": [{"audio_key": "preset_village_ambience", "role": "ambience", "volume": 0.7}],
             "transitions": {"fade_in_seconds": 2, "fade_out_seconds": 2, "crossfade_seconds": 2}})
        buildings[key]["modules"]["audio"] = {"default_group_key": scene, "groups": [
            {"key": scene, "name": name, "volume": 0.55,
             "tracks": {"music": [], "ambience": ["preset_village_ambience"], "sfx": [], "voice": []}}]}
    _add(rows, "voice_presence", "presence_old_bridge", {"name": "Ambiance du pont", "emoji": "🌉",
         "description": "Présence du lieu, sans PNJ.", "presence_type": "ambience", "scene_key": "storm_old_bridge_scene",
         "location_key": "old_bridge", "assignment_mode": "automatic", "release_timeout_seconds": 8,
         "metadata": {"building_key": "old_bridge", "missing_audio": "Ambiance spécifique à fournir"}})
    _add(rows, "voice_profile", "voice_church_priest", {"name": "Voix du prêtre", "emoji": "🗣️",
         "description": "Les textes sont prêts ; voix enregistrée à fournir.", "clips": [], "volume": 1,
         "tags": ["storm_sainte_pelle", "audio_a_fournir"], "missing_assets_status": "À fournir"})
    _add(rows, "voice_presence", "presence_church_priest", {"name": "Prêtre de la Sainte Pelle", "emoji": "⛪",
         "description": "Présence locale du prêtre ; textes utilisables sans clip vocal.",
         "presence_type": "npc", "voice_profile_key": "voice_church_priest", "scene_key": "storm_saint_shovel_church_scene",
         "location_key": "church_bank", "assignment_mode": "automatic", "release_timeout_seconds": 8,
         "metadata": {"building_key": "saint_shovel_church", "source_npc_key": "church_priest", "missing_audio": "À fournir"}})
    _add(rows, "npc", "church_priest", {"name": "Prêtre de la Sainte Pelle", "emoji": "⛪",
         "description": "Gardien de la petite église ; nom propre et voix à valider.",
         "location_key": "church_bank", "building_key": "saint_shovel_church",
         "voice_profile_key": "voice_church_priest", "voice_presence_key": "presence_church_priest",
         "reactions": [{"key": "welcome", "trigger": "talk", "variants": [{"key": "worn_church",
             "text": "Entrez, mes enfants. Prenez garde aux tuiles près du mur nord : notre petite église tient debout, mais la Sainte Pelle mérite mieux qu'une charpente qui gémit à chaque rafale."}]}],
         "metadata": {"template": "storm_sainte_pelle", "audio_assets": "À fournir", "balance_status": BALANCE}})
    buildings["saint_shovel_church"]["modules"]["npc"] = {"key": "church_priest", "name": "Prêtre de la Sainte Pelle"}
    for row in rows:
        if row["type"] == "npc" and row["key"] in {"edgar", "roland", "wagner", "sylvain", "agathe", "maelis"}:
            row["payload"].setdefault("metadata", {})["template"] = "storm_sainte_pelle"

    return _finish_template(rows, buildings, settings)


def _finish_template(rows: list[dict[str, Any]], buildings: dict[str, dict[str, Any]],
                     settings: dict[str, Any]) -> list[dict[str, Any]]:
    market, forest, mine = (buildings[key] for key in ("market_square", "forester_lodge", "deep_mine"))
    forge, tavern, farm = (buildings[key] for key in ("royal_forge", "edgar_tavern", "festival_farm"))
    church, bridge = buildings["saint_shovel_church"], buildings["old_bridge"]
    market["name"] = "Place du village"
    market["description"] = "Arrivée, annonces et récompenses des quêtes personnelles."
    forest["description"] = "Bois, chasse et garde de Sylvain, avant et après la tempête."
    mine["description"] = "Pierre et minerai ; la galerie basse doit être réparée après l'orage."
    forge["description"] = "Wagner fond le minerai, forge les ferrures et entretient les outils."
    tavern["description"] = "Edgar sert des repas, même quand la pluie frappe les volets."
    farm["description"] = "Approvisionnement ordinaire de la cuisine du village."

    _add(rows, "item", "river_fish", {"name": "Poisson de rivière", "emoji": "🐟",
         "description": "Poisson pêché depuis le vieux pont et apprécié par Edgar.",
         "category": "food", "stack_limit": 100,
         "building_relations": [{"building_key": "old_bridge", "relation": "produced_by"},
                                {"building_key": "edgar_tavern", "relation": "accepted_by"}]})

    # Les productions de la bêta sont ouvertes à tous avec l'outil requis :
    # rejoindre un métier reste utile, jamais imposé pour une quête personnelle.
    def harvest(building_key: str, key: str, name: str, item: str, quantity: int,
                tool: str | None, duration: int, energy: int) -> tuple[str, str]:
        building = buildings[building_key]
        effects: list[dict[str, Any]] = [{"type": "cost", "resource": "energy", "amount": energy}]
        if tool:
            effects.append({"type": "tool_modify", "tool": tool, "operation": "consume_durability", "amount": 1})
        effects.append({"type": "schedule", "action": key, "duration_seconds": duration,
                        "limit_scope": "player_building", "max_active": 1,
                        "effects": [{"type": "reward", "resource": item, "amount": quantity}]})
        condition = {"type": "tool_present", "tool": tool} if tool else None
        start = {"key": key, "name": name, "emoji": "🪵" if item == "oak_timber" else "⚒️",
                 "enabled": True, "effects": effects, "duration_seconds": duration,
                 "balance_status": BALANCE}
        if condition:
            start["conditions"] = condition
        claim = {"key": f"claim_{key}", "name": f"Récupérer : {name}", "emoji": "📦",
                 "enabled": True, "effects": [{"type": "claim_scheduled", "action": key}]}
        building["actions"].extend([start, claim])
        return key, claim["key"]

    harvest("forester_lodge", "cut_storm_wood", "Couper 4 bois", "oak_timber", 4, "simple_axe", 120, 5)
    harvest("deep_mine", "quarry_storm_stone", "Extraire 4 pierres", "stone_block", 4, "iron_pickaxe", 120, 5)
    harvest("deep_mine", "extract_storm_iron", "Extraire 2 minerais", "iron_ore", 2, "iron_pickaxe", 120, 6)
    harvest("festival_farm", "gather_storm_ingredients", "Ramasser 2 ingrédients", "egg", 2, None, 180, 4)
    harvest("old_bridge", "fish_old_bridge", "Pêcher", "river_fish", 1, None, 90, 3)
    for building_key, page_key, label, actions in [
        ("forester_lodge", "storm_resources", "Bois du chantier", ["cut_storm_wood", "claim_cut_storm_wood"]),
        ("deep_mine", "storm_resources", "Pierre et minerai", ["quarry_storm_stone", "claim_quarry_storm_stone", "extract_storm_iron", "claim_extract_storm_iron"]),
        ("festival_farm", "storm_resources", "Ingrédients accessibles", ["gather_storm_ingredients", "claim_gather_storm_ingredients"]),
    ]:
        _page(buildings[building_key], page_key, label, label,
              "Production individuelle chronométrée. Récupérez le résultat avant une nouvelle activité.",
              [_button(building_key, action, next(a["name"] for a in buildings[building_key]["actions"] if a["key"] == action), index,
                       emoji="📦" if action.startswith("claim_") else "⚒️")
               for index, action in enumerate(actions)])

    # Les anciens outils, stocks et achats restent utilisables. Seules les
    # recettes nécessaires à la bêta reçoivent des durées et sorties adaptées.
    _add(rows, "item", "church_bracket", {"name": "Ferrure de chantier", "emoji": "🔩",
         "description": "Pièce forgée par Wagner pour la charpente de l'église.", "category": "material",
         "stack_limit": 100, "balance_status": BALANCE,
         "building_relations": [{"building_key": "royal_forge", "relation": "produced_by"},
                                {"building_key": "saint_shovel_church", "relation": "accepted_by"}]})
    _add(rows, "item", "storm_ration", {"name": "Provision de chantier", "emoji": "🥣",
         "description": "Deux portions préparées par Edgar à partir d'ingrédients livrés.",
         "category": "consumable", "stack_limit": 100,
         "consumption": {"effects": [{"type": "reward", "resource": "energy", "amount": 12}]},
         "building_relations": [{"building_key": "edgar_tavern", "relation": "produced_by"},
                                {"building_key": "saint_shovel_church", "relation": "accepted_by"}],
         "balance_status": BALANCE})

    def recipe(building: dict[str, Any], building_key: str, key: str, name: str,
               ingredients: dict[str, int], output: str, quantity: int, seconds: int,
               energy: int, xp: int) -> None:
        entry = {"key": key, "name": name, "ingredients": ingredients,
                 "output_item_key": output, "output_quantity": quantity,
                 "duration_seconds": seconds, "energy_cost": energy, "experience": xp,
                 "ingredient_source": "building_stock", "output_destination": "building_stock",
                 "balance_status": BALANCE}
        building["modules"]["recipes"].append(entry)
        effect_list = [{"type": "stock_cost", "item": item, "amount": count, "initial_stock": 0,
                        "modifier_property": "recipe.ingredient_quantity", "recipe_key": key,
                        "ingredient_key": item} for item, count in ingredients.items()]
        effect_list.extend([{"type": "cost", "resource": "energy", "amount": energy},
                            {"type": "schedule", "action": key, "duration_seconds": seconds,
                             "limit_scope": "player_action", "max_active": 1,
                             "effects": [{"type": "stock_reward", "item": output,
                                          "amount": quantity, "building": building_key}]}])
        building["actions"].extend([
            {"key": key, "name": name, "emoji": "🔥", "enabled": True,
             "duration_seconds": seconds, "effects": effect_list, "balance_status": BALANCE},
            {"key": f"claim_{key}", "name": f"Récupérer : {name}", "emoji": "📦",
             "enabled": True, "effects": [{"type": "claim_scheduled", "action": key}]},
        ])

    recipe(forge, "royal_forge", "smelt_storm_iron", "Fondre deux minerais",
           {"iron_ore": 2}, "iron_ingot", 1, 180, 5, 12)
    recipe(forge, "royal_forge", "forge_church_bracket", "Forger une ferrure",
           {"iron_ingot": 2}, "church_bracket", 1, 240, 5, 16)
    recipe(tavern, "edgar_tavern", "cook_storm_ration", "Préparer deux provisions",
           {"egg": 1}, "storm_ration", 2, 180, 4, 12)
    for building, building_key, item, name, stock in [
        (forge, "royal_forge", "church_bracket", "Ferrure de chantier", 1),
        (tavern, "edgar_tavern", "storm_ration", "Provision de chantier", 2),
    ]:
        building["modules"]["products"].append({"item_key": item, "name": name,
                                                 "price": 8, "initial_stock": stock, "maximum_per_purchase": 8})
        workshop_actions = (["smelt_storm_iron", "claim_smelt_storm_iron", "forge_church_bracket", "claim_forge_church_bracket"]
                            if building_key == "royal_forge" else ["cook_storm_ration", "claim_cook_storm_ration"])
        _page(building, "storm_workshop", "Chantier de l'église", "Préparations du chantier",
              "Livrez les ingrédients au stock, préparez, puis récupérez et transportez le produit.", [
                  *[_button(building_key, action, next(a["name"] for a in building["actions"] if a["key"] == action),
                            slot, emoji="📦" if action.startswith("claim_") else "🔥")
                    for slot, action in enumerate(workshop_actions)],
                  {"id": f"storm_stock_{building_key}", "type": "building_inventory",
                   "props": {"title": "Stock commun du bâtiment", "building": building_key}},
              ])

    def delivery_action(building_key: str, item: str, count: int, label: str) -> str:
        building = buildings[building_key]
        key = f"deliver_storm_{item}_{count}"
        building["actions"].append({"key": key, "name": label, "emoji": "📦", "enabled": True,
            "effects": [{"type": "cost", "resource": item, "amount": count,
                         "modifier_property": "inventory.cost"},
                        {"type": "stock_reward", "item": item, "amount": count, "building": building_key}],
            "balance_status": BALANCE})
        return key

    deliveries = {
        "deep_mine": [("stone_block", 1, "Livrer une pierre à Roland")],
        "forester_lodge": [("oak_timber", 1, "Livrer un bois à Sylvain")],
        "royal_forge": [("oak_timber", 1, "Livrer un bois à Wagner"), ("iron_ore", 1, "Livrer un minerai à Wagner")],
        "edgar_tavern": [("egg", 1, "Livrer un ingrédient à Edgar"), ("storm_ration", 1, "Livrer une portion à Edgar"),
                         ("river_fish", 2, "Apporter deux poissons à Edgar")],
    }
    for building_key, entries in deliveries.items():
        actions = [delivery_action(building_key, item, count, label) for item, count, label in entries]
        _page(buildings[building_key], "storm_delivery", "Livraisons de la bêta", "Livrer au stock du lieu",
              "Seuls les objets effectivement retirés de votre sac comptent pour la quête.",
              [_button(building_key, action, next(a["name"] for a in buildings[building_key]["actions"] if a["key"] == action), slot,
                       emoji="📦") for slot, action in enumerate(actions)])

    # Le compteur collectif est tenu au bâtiment destinataire : chaque
    # transaction retire la ressource une seule fois, avec plafond vérifié.
    for item, objective, target, emoji in [
        ("oak_timber", "mine_wood", 8, "🪵"), ("stone_block", "mine_stone", 8, "🪨")
    ]:
        for count in (1, 8):
            _deposit(mine, item, objective, target, minute=105, amount=count,
                     label=f"Déposer {count} {'bois' if item == 'oak_timber' else 'pierres'} pour la mine")
    _timed_contribution(mine, "storm_mine_repaired", 1, 180, 105,
                        prerequisites=[_progress("mine_wood", "oak_timber", 8),
                                       _progress("mine_stone", "stone_block", 8)],
                        name="Sécuriser la galerie (3 min)")
    _page(mine, "storm_incident", "Incident de Roland", "Galerie basse",
          "À partir de T+105 : 8 bois, 8 pierres, puis une réparation de 3 minutes. Le rendement revient après validation.", [
              *[{"id": f"mine_progress_{objective}", "type": "collective_objective",
                 "props": {"objective_key": objective, "title": title, "target": 8, "unit": unit}}
                for objective, title, unit in [("mine_wood", "Bois", "bois"), ("mine_stone", "Pierre", "pierres")]],
              *[_button("deep_mine", action["key"], action["name"], slot, emoji=action["emoji"])
                for slot, action in enumerate(a for a in mine["actions"] if a["key"].startswith(("deposit_mine_", "start_storm_mine_", "claim_storm_mine_")))],
          ])

    _timed_contribution(church, "church_tree_cleared", 3, 180, 120,
                        name="Dégager l'arbre (3 min)")
    for item, objective, target, counts, label in [
        ("oak_timber", "church_wood", 40, (1, 8), "bois de charpente"),
        ("stone_block", "church_stone", 28, (1, 8), "pierres"),
        ("church_bracket", "church_brackets", 4, (1,), "ferrures"),
        ("storm_ration", "church_provisions", 8, (1, 2), "provisions"),
    ]:
        for count in counts:
            _deposit(church, item, objective, target, minute=120, amount=count,
                     label=f"Déposer {count} {label} à l'église")
    _timed_contribution(church, "church_assembly", 2, 240, 120,
                        prerequisites=[_progress("church_tree_cleared", "progress", 3),
                                       _progress("church_wood", "oak_timber", 40),
                                       _progress("church_brackets", "church_bracket", 4)],
                        name="Assembler la charpente (4 min)")
    _page(church, "church_worksite", "Chantier collectif", "Relever l'église",
          "Dégagez l'arbre, livrez au chantier, puis assemblez. Pierre et provisions comptent pour la messe sans bloquer l'assemblage.", [
              *[{"id": f"church_progress_{objective}", "type": "collective_objective",
                 "props": {"objective_key": objective, "title": title, "target": target, "unit": unit},
                 "visibility_conditions": _minute(120)}
                for objective, title, target, unit in [
                    ("church_tree_cleared", "Arbre dégagé", 3, "actions"),
                    ("church_wood", "Bois", 40, "bois"), ("church_stone", "Pierre", 28, "pierres"),
                    ("church_brackets", "Ferrures", 4, "ferrures"),
                    ("church_provisions", "Provisions", 8, "portions"),
                    ("church_assembly", "Assemblages", 2, "actions"),
                ]],
              *[_button("saint_shovel_church", action["key"], action["name"], slot,
                        emoji=action["emoji"])
                for slot, action in enumerate(church["actions"])],
          ])
    church_nav = next(component for component in church["interface"]["pages"][0]["components"]
                      if component.get("id") == "storm_nav_church_worksite")
    church_nav["visibility_conditions"] = _minute(120)
    church["actions"].append({"key": "pray_saint_shovel", "name": "Prier", "emoji": "🙏",
                              "enabled": True, "cooldown_seconds": 60,
                              "effects": [{"type": "emit", "event": "church_prayer"}]})
    church_home = church["interface"]["pages"][0]["components"]
    church_used = {int(component["slot"]) for component in church_home if component.get("slot") is not None}
    prayer_slot = next(slot for slot in range(25) if slot not in church_used)
    church_home.extend([
        _button("saint_shovel_church", "pray_saint_shovel", "Prier", prayer_slot, emoji="🙏"),
        {"id": "church_state_worn", "type": "text", "props": {"text": "L'église est vétuste, mais ouverte. Le prêtre évoque les tuiles et la charpente."},
         "visibility_conditions": _minute(110, "<")},
        {"id": "church_state_damaged", "type": "text", "props": {"text": "Un arbre est tombé sur la toiture. Restez sur le parvis sûr ; le chantier collectif ouvre à T+120."},
         "visibility_conditions": {"all": [_minute(110), _progress("church_tree_cleared", "progress", 2, "<=")]}},
        {"id": "church_state_cleared", "type": "text", "props": {"text": "L'arbre est dégagé. Les matériaux sont à apporter au chantier pour les premiers assemblages."},
         "visibility_conditions": {"all": [_progress("church_tree_cleared", "progress", 3),
                                           _progress("church_assembly", "progress", 1, "<=")]}},
    ])
    bridge_home = bridge["interface"]["pages"][0]["components"]
    bridge_used = {int(component["slot"]) for component in bridge_home if component.get("slot") is not None}
    fish_slots = [slot for slot in range(25) if slot not in bridge_used][:2]
    bridge_home.extend([
        {"id": "bridge_open_notice", "type": "text",
         "props": {"text": "Le vieux pont reste praticable. La rivière permet de pêcher pour approvisionner Edgar."}},
        _button("old_bridge", "fish_old_bridge", "Pêcher", fish_slots[0], emoji="🎣"),
        _button("old_bridge", "claim_fish_old_bridge", "Récupérer le poisson", fish_slots[1], emoji="🐟"),
    ])
    _page(bridge, "bridge_route", "Traverser", "Vers l'église",
          "La rive de la Sainte Pelle se rejoint par la carte du monde et par son salon Discord.", [])

    quest_page = {"key": "storm_quests", "name": "Panneau des quêtes", "components": [
        {"id": "storm_quest_hero", "type": "hero", "props": {"title": "Quêtes du village",
         "subtitle": "Une quête personnelle à la fois. Revenez réclamer votre XP ici avant d'en choisir une autre.", "emoji": "📜"}},
        {"id": "storm_open_quest_board", "type": "button", "slot": 0,
         "props": {"label": "Voir mes quêtes", "emoji": "📜", "style": "primary"},
         "interaction": {"type": "quest_board"}},
        {"id": "storm_quest_back", "type": "button", "slot": 1,
         "props": {"label": "Retour", "emoji": "↩️", "style": "secondary"},
         "interaction": {"type": "navigate", "page": "home"}},
    ]}
    market["interface"]["pages"].append(quest_page)
    market["interface"]["pages"][0]["components"].append({
        "id": "storm_quest_nav", "type": "button", "slot": 6,
        "props": {"label": "Panneau des quêtes", "emoji": "📜", "style": "primary"},
        "interaction": {"type": "navigate", "page": "storm_quests"}})
    market["interface"]["pages"][0]["components"].extend([
        {"id": "storm_kingdom_summary", "type": "text",
         "props": {"text": "Le Royaume en direct : météo, calendrier, annonces et quêtes du village."}},
        {"id": "storm_home_weather", "type": "world_weather", "props": {"title": "Météo du Royaume"}},
        {"id": "storm_home_calendar", "type": "world_calendar", "props": {"title": "Calendrier du Royaume"}},
    ])
    _page(market, "storm_collective", "Royaume en direct", "Relever l'église de la Sainte Pelle",
          "La quête commune débute à T+120. Les dépôts sont comptés seulement à l'église ; vos quêtes personnelles restent indépendantes.", [
              *[{"id": f"market_progress_{objective}", "type": "collective_objective",
                 "props": {"objective_key": objective, "title": title, "target": target, "unit": unit},
                 "visibility_conditions": _minute(120)}
                for objective, title, target, unit in [
                    ("church_tree_cleared", "Arbre dégagé", 3, "actions"),
                    ("church_wood", "Bois", 40, "bois"), ("church_stone", "Pierre", 28, "pierres"),
                    ("church_brackets", "Ferrures", 4, "ferrures"),
                    ("church_provisions", "Provisions", 8, "portions"),
                    ("church_assembly", "Assemblages", 2, "actions"),
                ]],
          ])
    collective_nav = next(component for component in market["interface"]["pages"][0]["components"]
                          if component.get("id") == "storm_nav_storm_collective")
    collective_nav["visibility_conditions"] = _minute(120)
    return _finish_events_and_quests(rows, settings)


def _finish_events_and_quests(rows: list[dict[str, Any]], settings: dict[str, Any]) -> list[dict[str, Any]]:
    forest_slow = [{"property": "production.quantity", "operator": "multiply", "value": 0.75,
                    "target": {"type": "building", "key": "forester_lodge"}}]
    mine_slow = [{"property": "production.quantity", "operator": "multiply", "value": 0.5,
                  "target": {"type": "building", "key": "deep_mine"}}]
    material_targets = [{"key": key, "target": target} for key, target in [
        ("church_wood", 40), ("church_stone", 28),
        ("church_brackets", 4), ("church_provisions", 8),
    ]]
    completed = {"all": [{"key": key, "target": target} for key, target in [
        ("church_tree_cleared", 3), ("church_wood", 40), ("church_stone", 28),
        ("church_brackets", 4), ("church_provisions", 8), ("church_assembly", 2),
    ]]}
    partial_base = {"all": [
        {"key": "church_tree_cleared", "target": 3},
        {"any": [{"key": "church_assembly", "target": 1},
                 {"progress": {"objectives": material_targets, "minimum_ratio": 0.7}}]},
    ]}
    partial = {"all": [partial_base, {"not": completed}]}
    deferred = {"not": {"any": [completed, partial_base]}}
    event_specs = [
        _event("storm_arrival", "Bienvenue au village", 0,
               "Le pont de Valbrume est ouvert. Consultez le panneau des quêtes sur la place, puis revenez y réclamer votre récompense.", duration=20 * 60),
        _event("storm_church_reminder", "La vieille toiture", 20,
               "Le prêtre rappelle que les tuiles de l'église sont usées, sans annoncer de catastrophe.", duration=15 * 60),
        _event("storm_village_life", "La vie du village", 20,
               "Roland, Sylvain et Wagner suivent les livraisons réelles du village.", duration=25 * 60),
        _event("storm_first_wind", "Le vent tourne", 45,
               "Sylvain voit les premières branches s'agiter ; aucune pénalité de production.", duration=25 * 60, weather="cloudy"),
        _event("storm_warning", "Nuages sur la vallée", 70,
               "Des nuages lourds gagnent la vallée. Les activités et quêtes restent libres.", duration=20 * 60, weather="cloudy"),
        _event("storm_active", "La tempête éclate", 90,
               "Pluie, vent et cloches dans la vallée. Les lieux restent accessibles ; la forêt produit 75 % de son rendement habituel.",
               duration=15 * 60, weather="storm", modifiers=forest_slow),
        _event("storm_tavern", "Rafales à la taverne", 93,
               "Edgar : Fermez cette porte ! Le feu tient bon et il reste de quoi manger.", duration=10 * 60),
        _event("storm_mine_incident", "Galerie inondée", 96,
               "Roland : De l'eau et des pierres sont tombées dans la galerie basse. Personne n'est blessé.",
               duration=9 * 60, modifiers=mine_slow),
        _event("storm_forest_crack", "Craquement dans la forêt", 99,
               "Sylvain entend un arbre céder vers l'autre rive, sans savoir encore où il est tombé.", duration=6 * 60),
        _event("storm_bridge_thunder", "Tonnerre sur le pont", 102,
               "Le tonnerre couvre la vallée ; le vieux pont vibre mais demeure praticable.", duration=3 * 60),
        _event("storm_cleared", "Le vent faiblit", 105,
               "La tempête s'éloigne. Il est temps de constater les dégâts ; la forêt retrouve son rendement normal.",
               duration=5 * 60, weather="clear"),
        _event("storm_mine_damage", "Galerie à sécuriser", 105,
               "La mine reste à 50 % jusqu'à la livraison de 8 bois, 8 pierres et une réparation de 3 minutes.",
               duration=7 * 24 * 3600, modifiers=mine_slow,
               completion={"key": "storm_mine_repaired", "target": 1, "resource_key": "progress", "building_key": "deep_mine"}),
        _event("storm_church_damage", "Un arbre sur l'église", 110,
               "Sylvain confirme l'arbre tombé sur la petite église. Le prêtre accueille les habitants sur le parvis sûr.",
               duration=7 * 24 * 3600),
        _event("storm_church_call", "Relever l'église de la Sainte Pelle", 120,
               "Le prêtre ouvre le chantier commun : dégager l'arbre, livrer au chantier et assembler les premiers éléments.",
               duration=7 * 24 * 3600),
        _event("storm_checkpoint_132", "Point d'étape de Sylvain", 132,
               "Sylvain invite les habitants à consulter les vrais compteurs de dégagement et de matériaux.", duration=8 * 60),
        _event("storm_checkpoint_148", "Point d'étape de Wagner", 148,
               "Wagner indique de vérifier les matériaux encore manquants sur le panneau collectif, sans inventer de ressources.",
               duration=8 * 60),
        _event("storm_mass_call", "Appel à la messe", 165,
               "Le prêtre appelle au rassemblement pour T+170 ; les travaux restent possibles jusqu'à la messe.", duration=5 * 60),
        _event("storm_mass_full", "Messe : première pierre bénite", 170,
               "Le prêtre bénit la première pierre. L'arbre est dégagé, les matériaux réunis et les premiers assemblages terminés : le chantier est ouvert.",
               duration=7 * 24 * 3600, collective=completed),
        _event("storm_mass_partial", "Messe : chantier à poursuivre", 170,
               "Le prêtre remercie ceux qui ont sécurisé l'église et appelle à compléter les matériaux. La toiture n'est pas encore reconstruite.",
               duration=7 * 24 * 3600, collective=partial),
        _event("storm_mass_deferred", "Messe : chantier différé", 170,
               "Le prêtre prie depuis le côté sûr du pont : l'église n'est pas sécurisée et le chantier doit continuer après la session.",
               duration=7 * 24 * 3600, collective=deferred),
        _event("storm_session_end", "Fin de la séance bêta", 180,
               "La session officielle se termine ; le monde, les quêtes et le chantier restent persistants.", duration=7 * 24 * 3600),
    ]
    rows.extend(event_specs)
    settings["live_ops"]["timeline"] = [
        {"minute": event["payload"]["trigger"]["minute"], "label": event["payload"]["name"],
         "event_key": event["key"]} for event in event_specs
    ]
    settings["live_ops"]["final_tiers"] = [
        {"key": "full", "name": "Chantier ouvert", "event_key": "storm_mass_full"},
        {"key": "partial", "name": "Église dégagée, chantier à poursuivre", "event_key": "storm_mass_partial"},
        {"key": "deferred", "name": "Chantier différé", "event_key": "storm_mass_deferred"},
    ]

    quest_specs = [
        ("p01_first_steps", "Premier pas", 40, [_visit("tavern", "edgar_tavern"), _visit("mine", "deep_mine"), _visit("forest", "forester_lodge")], 0),
        ("p02_old_bridge", "Le vieux pont", 35, [_visit("bridge", "old_bridge"), _visit("church", "saint_shovel_church")], 0),
        ("p03_roland_stone", "Rapport de Roland", 40, [_action_goal("quarry", "deep_mine", "claim_quarry_storm_stone", 2), _delivery("stone", "stone_block", "deep_mine", 8)], 0),
        ("p04_wagner_ore", "Fer pour Wagner", 45, [_action_goal("extract", "deep_mine", "claim_extract_storm_iron", 2), _delivery("ore", "iron_ore", "royal_forge", 4)], 0),
        ("p05_sylvain_wood", "Bois pour Sylvain", 40, [_action_goal("cut", "forester_lodge", "claim_cut_storm_wood", 2), _delivery("wood", "oak_timber", "forester_lodge", 8)], 0),
        ("p06_tool_handle", "Manche d'outil", 40, [_delivery("wood", "oak_timber", "royal_forge", 4)], 0),
        ("p07_edgar_batch", "La fournée d'Edgar", 40, [_delivery("ingredients", "egg", "edgar_tavern", 4)], 0),
        ("p08_first_meal", "Premier repas", 50, [_action_goal("cook", "edgar_tavern", "claim_cook_storm_ration")], 0),
        ("p09_useful_metal", "Métal utile", 60, [_action_goal("smelt", "royal_forge", "claim_smelt_storm_iron")], 0),
        ("p10_new_bracket", "Ferrure neuve", 75, [_action_goal("forge", "royal_forge", "claim_forge_church_bracket")], 0),
        ("p11_tired_tool", "Outil fatigué", 50, [_action_goal("repair", "royal_forge", "repair_iron_pickaxe")], 0),
        ("p12_neighbors", "Tournée des voisins", 70, [_delivery("forge", "oak_timber", "royal_forge", 1), _delivery("tavern", "egg", "edgar_tavern", 1)], 0),
        ("p13_workers_meal", "Le repas du travailleur", 35, [_action_goal("work", "forester_lodge", "claim_cut_storm_wood"), _action_goal("eat", "edgar_tavern", "consume_storm_ration")], 0),
        ("p14_bridge_fishing", "Les poissons d'Edgar", 55,
         [_action_goal("fish", "old_bridge", "claim_fish_old_bridge", 2),
          _delivery("fish_delivery", "river_fish", "edgar_tavern", 2)], 0),
        ("s01_clear_branches", "Débarrasser les branches", 50, [_action_goal("clear", "saint_shovel_church", "claim_church_tree_cleared")], 120),
        ("s02_timber", "Bois de charpente", 55, [_delivery("wood", "oak_timber", "saint_shovel_church", 8)], 120),
        ("s03_stone", "Pierres pour les murs", 55, [_delivery("stone", "stone_block", "saint_shovel_church", 8)], 120),
        ("s04_brackets", "Ferrures de Wagner", 75, [_delivery("bracket", "church_bracket", "saint_shovel_church", 1)], 120),
        ("s05_feed_workers", "Nourrir les ouvriers", 55, [_delivery("ration", "storm_ration", "saint_shovel_church", 2)], 120),
        ("s06_mine_wood", "Secourir Roland : bois", 50, [_delivery("wood", "oak_timber", "deep_mine", 8)], 120),
        ("s06_mine_stone", "Secourir Roland : pierre", 50, [_delivery("stone", "stone_block", "deep_mine", 8)], 120),
        ("s07_frame", "Charpente", 65, [_action_goal("assemble", "saint_shovel_church", "claim_church_assembly")], 120),
        ("s08_before_mass", "Avant la messe", 45, [_delivery("wood", "oak_timber", "saint_shovel_church", 1), _visit("return", "market_square")], 120),
    ]
    for key, name, xp, objectives, minute in quest_specs:
        item = _quest(key, name, xp, objectives, from_minute=minute)
        item["payload"]["priority"] = 100 if minute == 120 else 10
        if key in {"p01_first_steps", "p02_old_bridge"}:
            item["payload"]["priority"] = 50
        names = {row["key"]: row["payload"].get("name", row["key"])
                 for row in rows if row["type"] in {"building", "item"}}
        action_names = {(row["key"], action["key"]): action.get("name", action["key"])
                        for row in rows if row["type"] == "building"
                        for action in row["payload"].get("actions", [])}
        for goal in objectives:
            target = goal.get("destination_building_key") or goal.get("building_key")
            if goal["type"] == "delivery":
                goal["description"] = f"Livrer {goal['quantity']} × {names.get(goal['item_key'], goal['item_key'])} à {names.get(target, target)}"
            elif goal["type"] == "visit":
                goal["description"] = f"Visiter {names.get(target, target)}"
            else:
                goal["description"] = f"{action_names.get((target, goal['action_key']), 'Terminer l’activité')} · {names.get(target, target)}"
        rows.append(item)

    obsolete_market_pages = {"preparations", "contribution", "announcements"}
    market = next(row["payload"] for row in rows if row["type"] == "building" and row["key"] == "market_square")
    market_interface = market.get("interface", {})
    market_interface["pages"] = [page for page in market_interface.get("pages", [])
                                 if page.get("key") not in obsolete_market_pages]
    for page in market_interface.get("pages", []):
        page["components"] = [component for component in page.get("components", [])
                              if component.get("interaction", {}).get("page") not in obsolete_market_pages]

    def clean_visible_content(value: Any) -> Any:
        if isinstance(value, dict):
            value.pop("balance_status", None)
            for key, child in list(value.items()):
                value[key] = clean_visible_content(child)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                value[index] = clean_visible_content(child)
        elif isinstance(value, str):
            return (value.replace("La Fête du Royaume", "Le Royaume")
                    .replace("la Fête du Royaume", "le Royaume")
                    .replace("Fête du Royaume", "Royaume")
                    .replace("BALANCE_DRAFT / À VALIDER", "")
                    .replace("Préparatifs", "Vie du Royaume")
                    .replace("préparatifs", "activités du Royaume")
                    .replace("  ", " ").strip(" ·"))
        return value

    for row in rows:
        clean_visible_content(row["payload"])

    # Les packs officiels sont importés par type dans l'ordre de dépendance.
    # Aucune entité du pack « Le Royaume » n'est modifiée en place.
    rank = {"location": 0, "item": 0, "server_settings": 0, "environment": 0,
            "audio": 0, "audio_group": 1, "voice_profile": 1, "voice_presence": 2,
            "building": 3, "npc": 4, "event": 4, "quest": 5}
    return sorted(rows, key=lambda row: rank.get(row["type"], 0))
