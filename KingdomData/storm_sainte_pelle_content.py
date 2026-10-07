"""Contenu déclaratif de la bêta « La Tempête de la Sainte Pelle ».

Le Royaume publié reste intact : ce module transforme uniquement une copie du
pack jouable lors de la création de ce nouveau modèle officiel.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
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
                    template_revision=8, balance_status=BALANCE)
    settings["onboarding"].update(
        starting_money=100,
        currency_label="écus",
        currency_label_singular="écu",
        currency_label_plural="écus",
    )
    settings["roles"].update(game_master="Roi", player="Habitants du Royaume")

    # Banque vocale vérifiée : le sens vient du manifeste utilisateur, jamais
    # du numéro de scène. Les politiques restent lisibles par le no-code.
    voice_manifest = {
        "edgar": ("edgar_tavern", [
            ("00", (1, 2), "edgar_welcome_general", "Ah, te voilà, camarade ! Entre donc ! Ici, les soucis restent à la porte… enfin, sauf les dettes, évidemment. Allez, installe-toi. Qu'est-ce que je te sers ?", "AUTO_CONTEXTUEL", "presence_join"),
            ("00", (3, 4), "edgar_rumor_roland_long", "Ah, camarade, approche donc, j'ai quelque chose à te raconter. Tu connais Roland, le mineur ? Eh bien, paraît qu'il aurait découvert quelque chose d'étrange dans les profondeurs de la mine. Quelque chose qui n'aurait jamais dû remonter à la surface. Enfin, c'est ce qu'il raconte. Avec tout ce qu'il boit ici, il a peut-être simplement déterré une vieille casserole. Sacré Roland.", "MANUEL_DESACTIVE_BETA", "manual"),
            ("01", (1, 2), "edgar_first_visit", "Ah ! Bien le bonjour, camarade ! Entre donc, entre donc ! Ici, on sert de quoi se réchauffer le cœur… et parfois de quoi le faire tourner.", "AUTO_CONTEXTUEL", "first_visit"),
            ("02", (1, 2), "edgar_returning_player", "Ah, toi revoilà ! Je commençais à croire que tu m'avais oublié. Allez, viens donc t'installer.", "AUTO_CONTEXTUEL", "returning_player"),
            ("03", (1, 2), "edgar_self_intro", "Edgar Brassebarbe, pour te servir. Tant que tu as soif, faim, ou une bonne histoire à raconter, tu es chez toi ici.", "AUTO_CONTEXTUEL", "npc_self_intro"),
            ("04", (1, 2), "edgar_tavern_intro", "Bienvenue dans ma taverne. On y mange, on y boit, on y travaille, et on y raconte quelques mensonges… mais des beaux, hein.", "AUTO_CONTEXTUEL", "building_intro"),
            ("05", (1, 2), "edgar_work_offer", "Tu cherches à gagner quelques écus ? J'ai peut-être du travail pour toi. Et promis, je ne te demanderai pas de laver toute la taverne… enfin, pas aujourd'hui.", "AUTO_CONTEXTUEL", "work_offer"),
            ("06", (1, 2), "edgar_activity_start", "Allez, camarade, retrousse tes manches. Une bonne journée de travail mérite toujours une bonne chope à la fin.", "AUTO_CONTEXTUEL", "activity_start"),
            ("07", (1, 2), "edgar_activity_success", "Ah, voilà du beau travail ! Si tout le monde travaillait comme toi, je pourrais enfin prendre des vacances.", "AUTO_CONTEXTUEL", "activity_success"),
            ("08", (1, 2), "edgar_low_stock", "Ah, ça, c'est embêtant. Les réserves sont presque vides. À ce rythme-là, je vais devoir servir des assiettes imaginaires.", "AUTO_CONTEXTUEL", "low_stock"),
            ("09", (1, 2), "edgar_order_served", "Voilà pour toi, une belle commande servie avec le sourire. Le sourire est gratuit, lui.", "AUTO_CONTEXTUEL", "order_served"),
            ("10", (1, 2), "edgar_rumor_mine_short", "Approche un peu. J'ai entendu des choses étranges au sujet de la mine. Mais garde ça pour toi, hein… enfin, au moins jusqu'à la prochaine tournée.", "MANUEL_DESACTIVE_BETA", "manual"),
            ("11", (1, 2), "edgar_farewell", "Déjà sur le départ ? Prends soin de toi, camarade, et reviens vite. J'ai encore des histoires à te raconter.", "AUTO_CONTEXTUEL", "presence_leave"),
            ("12", (1, 2), "edgar_closing", "Bon, mes amis, il est temps de fermer boutique. Les chopes sont vides, le feu s'éteint, et moi, j'ai grand besoin de dormir.", "CONDITIONNEL_FERMETURE", "building_closed"),
        ]),
        "roland": ("deep_mine", [
            ("00", (1, 2), "roland_welcome_general", "Ah, encore un nouveau ! Bienvenue à la mine, camarade ! Ici, on travaille dur. La roche ne se casse pas toute seule, crois-moi. Et si tu trouves de l'or, n'oublie pas qui t'a prêté la pioche.", "AUTO_CONTEXTUEL", "presence_join"),
            ("01", (1, 2), "roland_first_visit", "Ah, un nouveau visage ! Bienvenue à la mine, camarade. Fais attention où tu mets les pieds : ici, les cailloux ne pardonnent pas.", "AUTO_CONTEXTUEL", "first_visit"),
            ("02", (1, 2), "roland_returning_player", "Tiens, te voilà ! Je me demandais si la montagne t'avait fait peur. Allez, approche donc.", "AUTO_CONTEXTUEL", "returning_player"),
            ("03", (1, 2), "roland_self_intro", "Roland, mineur depuis assez longtemps pour savoir qu'une bonne pioche vaut mieux qu'un long discours.", "AUTO_CONTEXTUEL", "npc_self_intro"),
            ("04", (1, 2), "roland_mine_intro", "Ici, c'est la mine : de la roche, de la poussière et du travail. Mais avec un peu de chance, tu repartiras les poches pleines.", "AUTO_CONTEXTUEL", "building_intro"),
            ("05", (1, 2), "roland_work_offer", "Tu veux travailler ? Parfait. J'ai besoin de bras solides et de gens qui n'ont pas peur de se salir les mains.", "AUTO_CONTEXTUEL", "work_offer"),
            ("06", (1, 2), "roland_activity_start", "Allez, prends ta pioche et souviens-toi : c'est la roche qu'il faut frapper, pas ton voisin.", "AUTO_CONTEXTUEL", "activity_start"),
            ("07", (1, 2), "roland_activity_success", "Eh ben, pas mal du tout ! T'as peut-être finalement quelque chose dans les bras.", "AUTO_CONTEXTUEL", "activity_success"),
            ("08", (1, 2), "roland_equipment_shortage", "Bon sang, on manque de matériel. Même le meilleur mineur du Royaume ne peut pas travailler avec une pioche imaginaire.", "AUTO_CONTEXTUEL", "equipment_shortage"),
            ("09", (1, 2), "roland_rare_find", "Ah, voilà une belle trouvaille ! Garde les yeux ouverts. Il y en a peut-être encore dans cette veine.", "AUTO_CONTEXTUEL", "rare_result"),
            ("10", (1, 2), "roland_rumor_deep_mine", "Il y a des bruits étranges dans les galeries profondes ces derniers temps. Bah, probablement encore Edgar qui raconte des histoires.", "MANUEL_DESACTIVE_BETA", "manual"),
            ("11", (1, 2), "roland_farewell", "Bon, file donc et fais attention sur le chemin. J'ai pas envie de devoir venir te chercher sous un éboulement.", "AUTO_CONTEXTUEL", "presence_leave"),
            ("12", (1, 2), "roland_closing", "C'est terminé pour aujourd'hui. Range les outils et va te reposer. La montagne sera encore là demain.", "CONDITIONNEL_FERMETURE", "building_closed"),
        ]),
        "wagner": ("royal_forge", [
            ("00", (1, 2), "wagner_welcome_general", "Bienvenue à la Forge Dorée. Moi, c'est Wagner. Ici, chaque lame, chaque outil, chaque pièce de métal passe entre mes mains. Et si tu comptes me faire réparer une pioche avec du fromage, tu t'es trompé de boutique, camarade.", "AUTO_CONTEXTUEL", "presence_join"),
            ("01", (1, 2), "wagner_first_visit", "Bienvenue à la Forge Dorée. Approche donc. Fais seulement attention aux braises : elles n'ont pas l'habitude de prévenir avant de brûler.", "AUTO_CONTEXTUEL", "first_visit"),
            ("02", (1, 2), "wagner_returning_player", "Ah ! Te revoilà ! J'espère que tu as pris soin de ton équipement depuis notre dernière rencontre.", "AUTO_CONTEXTUEL", "returning_player"),
            ("03", (1, 2), "wagner_self_intro", "Wagner, maître forgeron. Ici, le métal prend forme sous le marteau, et chaque pièce doit mériter sa place dans mon atelier.", "AUTO_CONTEXTUEL", "npc_self_intro"),
            ("04", (1, 2), "wagner_forge_intro", "Regarde autour de toi. Le feu, l'enclume, les outils. C'est ici qu'on transforme la matière brute en quelque chose d'utile.", "AUTO_CONTEXTUEL", "building_intro"),
            ("05", (1, 2), "wagner_work_offer", "Tu veux apprendre le métier ? Alors ouvre grand les yeux. À la forge, la précision compte autant que la force.", "AUTO_CONTEXTUEL", "work_offer"),
            ("06", (1, 2), "wagner_activity_start", "Allez, au travail ! Le feu est prêt, le métal attend. Fais-moi voir ce que tu sais faire.", "AUTO_CONTEXTUEL", "activity_start"),
            ("07", (1, 2), "wagner_activity_success", "Voilà, un travail propre et solide. Tu commences à comprendre ce que signifie être forgeron.", "AUTO_CONTEXTUEL", "activity_success"),
            ("08", (1, 2), "wagner_low_materials", "Impossible de continuer sans matériaux. Le talent ne suffit pas quand les réserves sont vides.", "AUTO_CONTEXTUEL", "low_materials"),
            ("09", (1, 2), "wagner_process_heat", "La température est bonne. Maintenant, il faut travailler le métal avec précision. Pas de gestes inutiles.", "AUTO_CONTEXTUEL", "process_step"),
            ("10", (1, 2), "wagner_rumor_strange_ore", "Roland m'a parlé d'un minerai étrange trouvé dans les profondeurs. Si tu en découvres un morceau, apporte-le-moi. J'aimerais examiner ça.", "MANUEL_DESACTIVE_BETA", "manual"),
            ("11", (1, 2), "wagner_farewell", "À la prochaine, camarade. Et souviens-toi : un bon outil, ça s'entretient. Ne viens pas pleurer quand le tien sera en morceaux.", "AUTO_CONTEXTUEL", "presence_leave"),
            ("12", (1, 2), "wagner_closing", "Le feu baisse. Les outils sont rangés. Une bonne journée de travail. Demain, on remet ça.", "CONDITIONNEL_FERMETURE", "building_closed"),
        ]),
    }
    for npc_key, (building_key, groups) in voice_manifest.items():
        profile = _row(rows, "voice_profile", f"voice_{npc_key}")
        clips = []
        for scene, variants, semantic_key, text, policy, intent in groups:
            for variant in variants:
                stem = f"{npc_key}_{scene}_{variant:02d}"
                audio_key = f"storm_voice_{stem}"
                path = f"assets/storm_sainte_pelle/voices/{npc_key}/{stem}.mp3"
                _add(rows, "audio", audio_key, {
                    "name": f"{profile['name']} · {semantic_key} · variante {variant}",
                    "emoji": "🗣️", "description": text,
                    "storage_path": path, "file_name": f"{stem}.mp3", "audio_type": "voice",
                    "volume": 1, "loop": False,
                    "tags": ["storm_sainte_pelle", npc_key, semantic_key, policy.lower(), "provided"],
                    "semantic_key": semantic_key, "speaker": npc_key, "building_key": building_key,
                    "variant_group": semantic_key, "variant_index": variant,
                    "storm_beta_policy": policy, "semantic_intent": intent,
                })
                clips.append({
                    "key": f"{semantic_key}_{variant}", "name": f"{semantic_key} · variante {variant}",
                    "trigger": intent if policy != "MANUEL_DESACTIVE_BETA" else "manual",
                    "audio_key": audio_key, "text": text,
                    "metadata": {"provided_file": f"{stem}.mp3", "scene_index": int(scene),
                                 "semantic_key": semantic_key, "speaker": npc_key,
                                 "building_key": building_key, "variant_group": semantic_key,
                                 "variant_index": variant, "storm_beta_policy": policy,
                                 "semantic_intent": intent, "priority": "building_interaction"},
                })
        profile["clips"] = clips
        profile["tags"] = ["storm_sainte_pelle", "provided"]
        profile["metadata"] = {"speaker": npc_key, "building_key": building_key,
                               "semantic_routing": True, "scenario_key": "storm_sainte_pelle"}
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
        if building.get("action_mode") == "generated":
            deliveries = building.setdefault("modules", {}).setdefault("deliveries", [])
            existing = next((entry for entry in deliveries if entry.get("item_key") == item), None)
            if existing is None:
                deliveries.append({"item_key": item, "name": label.removeprefix("Livrer ").removeprefix("Apporter "),
                                   "target_building_key": building_key, "unit_price": 0,
                                   "minimum_quantity": count})
            elif count > 1:
                existing["minimum_quantity"] = count
            return f"deliver_{item}"
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
        actions = [(delivery_action(building_key, item, count, label), label)
                   for item, count, label in entries]
        _page(buildings[building_key], "storm_delivery", "Livraisons de la bêta", "Livrer au stock du lieu",
              "Seuls les objets effectivement retirés de votre sac comptent pour la quête.",
              [_button(building_key, action, label, slot, emoji="📦")
               for slot, (action, label) in enumerate(actions)])

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
    mine_incident_nav = next(component for component in mine["interface"]["pages"][0]["components"]
                             if component.get("id") == "storm_nav_storm_incident")
    mine_incident_nav["visibility_conditions"] = _minute(105)

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


def _rebuild_discord_building_ux(rows: list[dict[str, Any]]) -> None:
    """Compose les sept scènes Discord de la bêta sans modifier leur gameplay."""
    buildings = {row["key"]: row["payload"] for row in rows if row["type"] == "building"}

    def cond(component: dict[str, Any], value: dict[str, Any]) -> dict[str, Any]:
        component["visibility_conditions"] = value
        return component

    def hero(key: str, title: str, text: str, emoji: str,
             visible: dict[str, Any] | None = None) -> dict[str, Any]:
        item = {"id": f"ux_hero_{key}", "type": "hero",
                "props": {"title": title, "subtitle": text, "emoji": emoji}}
        return cond(item, visible) if visible else item

    def text(key: str, value: str, visible: dict[str, Any] | None = None) -> dict[str, Any]:
        item = {"id": f"ux_text_{key}", "type": "text", "props": {"text": value}}
        return cond(item, visible) if visible else item

    def nav(key: str, label: str, page: str, slot: int, emoji: str = "🧭",
            visible: dict[str, Any] | None = None, style: str = "secondary") -> dict[str, Any]:
        item = {"id": f"ux_nav_{key}", "type": "button", "slot": slot,
                "props": {"label": label, "emoji": emoji, "style": style},
                "interaction": {"type": "navigate", "page": page}}
        return cond(item, visible) if visible else item

    def action(building: str, key: str, label: str, slot: int, emoji: str = "⚙️",
               visible: dict[str, Any] | None = None) -> dict[str, Any]:
        item = _button(building, key, label, slot, emoji=emoji, conditions=visible)
        item["id"] = f"ux_{building}_{key}_{slot}"[:64]
        return item

    def back(key: str, slot: int = 24) -> dict[str, Any]:
        return nav(f"back_{key}", "Retour", "home", slot, "↩️")

    def page(key: str, name: str, components: list[dict[str, Any]]) -> dict[str, Any]:
        return {"key": key, "name": name, "components": components}

    def apply(building_key: str, home: list[dict[str, Any]], added: list[dict[str, Any]]) -> None:
        interface = buildings[building_key]["interface"]
        retained = [item for item in interface.get("pages", [])
                    if item.get("key") not in {"home", "storm_services", *(item["key"] for item in added)}]
        interface["pages"] = [page("home", "Accueil", home), *added, *retained]
        interface["start_page"] = interface["entry_page"] = "home"

    # Une vraie action conserve le même pipeline moteur que les autres boutons.
    church = buildings["saint_shovel_church"]
    if not any(item.get("key") == "talk_priest" for item in church["actions"]):
        church["actions"].append({
            "key": "talk_priest", "name": "Parler au prêtre", "emoji": "💬", "enabled": True,
            "effects": [{"type": "random_message", "choices": [
                {"key": "before", "weight": 1, "text": "Le prêtre vous accueille dans la vieille église et vous invite à garder courage."},
                {"key": "work", "weight": 1, "text": "Le prêtre remercie les habitants : chaque geste compte pour relever la Sainte Pelle."},
            ]}],
        })

    # Place du village : quatre destinations lisibles, le collectif n'apparaît qu'à T+120.
    apply("market_square", [
        hero("place", "Place du village", "Le cœur vivant du Royaume : annonces, météo et habitants s'y croisent.", "⛲"),
        {"id": "ux_place_weather", "type": "world_weather", "props": {"title": "Météo actuelle"}},
        {"id": "ux_place_calendar", "type": "world_calendar", "props": {"title": "Calendrier du Royaume"}},
        nav("place_quests", "Panneau des quêtes", "ux_quests", 0, "📜", style="primary"),
        nav("place_kingdom", "Informations du Royaume", "ux_kingdom", 1, "👑"),
        nav("place_locations", "Lieux du Royaume", "ux_locations", 2, "🗺️"),
        nav("place_collective", "Chantier de l'église", "storm_collective", 3, "⛪", _minute(120)),
    ], [
        page("ux_quests", "Quêtes", [hero("quests", "Panneau des quêtes", "Choisissez, suivez et réclamez votre quête personnelle.", "📜"),
             {"id": "ux_open_quests", "type": "button", "slot": 0, "props": {"label": "Voir mes quêtes", "emoji": "📜", "style": "primary"}, "interaction": {"type": "quest_board"}}, back("quests", 1)]),
        page("ux_kingdom", "Royaume", [hero("kingdom", "Le Royaume en direct", "Les informations utiles, sans quitter la place.", "👑"),
             {"id": "ux_kingdom_weather", "type": "world_weather", "props": {"title": "Météo"}},
             {"id": "ux_kingdom_calendar", "type": "world_calendar", "props": {"title": "Calendrier"}}, back("kingdom", 0)]),
        page("ux_locations", "Lieux", [hero("locations", "Lieux du Royaume", "Taverne, mine, forge, forêt, vieux pont et église sont ouverts aux voyageurs.", "🗺️"),
             text("locations_list", "🍺 À la Gueuse Cocu · ⛏️ Mine de Roland · 🔥 Forge du Dragon Noir\n🌲 Forêt de Sylvain · 🌉 Vieux pont · ⛪ Église de la Sainte Pelle"), back("locations", 0)]),
    ])

    # Taverne : parcours immersif, achats réels et cuisine sur postes partagés.
    tavern = buildings["edgar_tavern"]
    tavern_modules = tavern.setdefault("modules", {})
    tavern_modules["workstations"] = [{
        "key": "tavern_cauldrons", "name": "Marmite", "emoji": "🍲", "slots": 3,
        "idle_text": "🟢 **Libre** · Edgar a laissé le feu prêt : cette marmite peut accueillir une nouvelle recette.",
        "busy_text": "« Laisse mijoter, voyageur. Une bonne cuisine ne se brusque pas. »",
        "ready_text": "✅ **Terminé** · {quantity}× {output} prêts\n« C’est prêt ! Qui vient chercher la marmite ? »",
    }]
    for recipe in tavern_modules.get("recipes", []):
        total = max(0, int(recipe.get("duration_seconds", 0)))
        preparation = max(1, total // 5) if total else 0
        recipe.update(
            workstation_key="tavern_cauldrons",
            preparation_seconds=preparation,
            transformation_seconds=max(0, total - preparation),
            active_transformation=False,
            preparer_xp_percent=int(recipe.get("preparer_xp_percent", 80)),
            ingredient_source="building_stock",
            output_destination="building_stock",
        )
        recipe.pop("shared_mission", None)

    edgar = next((row["payload"] for row in rows if row["type"] == "npc" and row["key"] == "edgar"), None)
    if edgar is not None:
        edgar["dialogues"] = [
            {"key": "accueil", "name": "Accueil", "text": "Edgar essuie une chope et vous observe par-dessus sa moustache. « Alors, voyageur ? Vous cherchez un repas, du travail ou les dernières nouvelles du Royaume ? »", "choices": [
                {"key": "royaume", "label": "🏰 Nouvelles du Royaume", "next_node": "royaume", "response_text": "Edgar se penche au-dessus du comptoir."},
                {"key": "rumeurs", "label": "🗣️ Rumeurs", "next_node": "rumeurs", "response_text": "Edgar baisse la voix."},
                {"key": "travail", "label": "👨‍🍳 Travail et métier", "next_node": "travail", "response_text": "Edgar désigne les marmites derrière lui."},
                {"key": "quetes", "label": "📜 Quêtes disponibles", "next_node": "quetes", "response_text": "Edgar sort quelques notes de sous le comptoir."},
            ]},
            {"key": "royaume", "name": "Nouvelles du Royaume", "text": "La tempête inquiète le village. La mine, le vieux pont et l'église auront besoin de toutes les bonnes volontés.", "choices": [{"key": "retour", "label": "↩ Parler d'autre chose", "next_node": "accueil"}]},
            {"key": "rumeurs", "name": "Rumeurs", "parent_node": "accueil", "text": "Edgar se penche légèrement au-dessus du comptoir.", "variants": [
                {"priority": 30, "text": "« On vient de m’apprendre pour l’église… Un arbre lui est tombé dessus. Le père Alain doit être dans un état… »", "conditions": [{"type": "scenario_elapsed_minutes", "operator": ">=", "value": 105}]},
                {"priority": 20, "text": "« Tu entends ça ? Même les murs commencent à trembler. J’espère que les gars de la mine sont déjà remontés. »", "conditions": [{"type": "scenario_elapsed_minutes", "operator": ">=", "value": 90}]},
                {"priority": 10, "text": "« Roland raconte encore que sa mine fait des bruits étranges. Il devrait peut-être simplement dormir un peu plus. »", "conditions": [{"type": "scenario_elapsed_minutes", "operator": "<", "value": 90}]},
            ], "choices": [
                {"key": "mine", "label": "⛏️ La mine ?", "next_node": "rumeur_mine"},
                {"key": "foret", "label": "🌲 Et du côté de la forêt ?", "next_node": "rumeur_foret"},
                {"key": "autre", "label": "👀 Une autre rumeur", "next_node": "rumeur_autre"},
                {"key": "retour", "label": "↩ Changer de sujet", "back": True},
            ]},
            {"key": "rumeur_mine", "name": "La mine", "parent_node": "rumeurs", "text": "« Roland a entendu des grondements sous la galerie basse. Il n’est pas du genre à avoir peur d’un courant d’air. »", "choices": [{"key": "retour", "label": "↩ Revenir aux rumeurs", "back": True}]},
            {"key": "rumeur_foret", "name": "La forêt", "parent_node": "rumeurs", "text": "« Sylvain connaît chaque arbre par son nom. S’il tarde à rentrer, c’est que le vent prépare quelque chose de mauvais. »", "choices": [{"key": "retour", "label": "↩ Revenir aux rumeurs", "back": True}]},
            {"key": "rumeur_autre", "name": "Une autre rumeur", "parent_node": "rumeurs", "text": "Edgar sourit. « Certaines histoires gagnent à attendre la prochaine tournée. »", "choices": [{"key": "retour", "label": "↩ Revenir aux rumeurs", "back": True}]},
            {"key": "travail", "name": "Travail", "text": "Une bonne cuisine nourrit tout le Royaume. Devenez cuisinier, utilisez une marmite libre et laissez les préparations rejoindre le stock commun.", "choices": [{"key": "retour", "label": "↩ Parler d'autre chose", "next_node": "accueil"}]},
            {"key": "quetes", "name": "Quêtes", "parent_node": "accueil", "text": "Edgar consulte son carnet de commandes.", "variants": [
                {"priority": 40, "text": "« Parfait, les œufs sont là. Ta fournée est terminée ; tu peux réclamer ton expérience. »", "conditions": [{"type": "quest_status", "quest": "p07_edgar_batch", "value": "ready"}]},
                {"priority": 30, "text": "« La commande est en cours. Rapporte-moi quatre œufs quand tu les auras. »", "conditions": [{"type": "quest_status", "quest": "p07_edgar_batch", "value": "accepted"}]},
                {"priority": 20, "text": "« J’ai besoin de quatre œufs frais pour la prochaine fournée. Ça t’intéresse ? »\n\n**Objectif :** 4× Œuf\n**Récompense :** 40 XP", "conditions": [{"type": "quest_status", "quest": "p07_edgar_batch", "value": "available"}]},
                {"priority": 10, "text": "« Beau travail pour la fournée. Je n’ai rien de plus urgent pour l’instant. »", "conditions": [{"type": "quest_status", "quest": "p07_edgar_batch", "value": "completed"}]},
            ], "choices": [
                {"key": "accepter_fournee", "label": "📜 Accepter la fournée d’Edgar", "quest_key": "p07_edgar_batch", "quest_operation": "accept", "conditions": [{"type": "quest_status", "quest": "p07_edgar_batch", "value": "available"}]},
                {"key": "suivre_fournee", "label": "🥚 Rappeler l’objectif", "next_node": "quetes_active", "conditions": [{"type": "quest_status", "quest": "p07_edgar_batch", "value": "accepted"}]},
                {"key": "reclamer_fournee", "label": "✨ Terminer la quête", "quest_key": "p07_edgar_batch", "quest_operation": "claim", "conditions": [{"type": "quest_status", "quest": "p07_edgar_batch", "value": "ready"}]},
                {"key": "retour", "label": "↩ Parler d'autre chose", "back": True},
            ]},
            {"key": "quetes_active", "name": "La fournée d’Edgar", "parent_node": "quetes", "text": "Objectif : apporter 4 œufs à Edgar. La livraison et la progression restent gérées par le système de quêtes existant. Récompense : 40 XP.", "choices": [{"key": "retour", "label": "↩ Retour aux quêtes", "back": True}]},
        ]

    item_names = {row["key"]: row["payload"].get("name", row["key"])
                  for row in rows if row["type"] == "item"}
    products = list(tavern_modules.get("products", []))
    product_groups = {
        "beer": ("🍻 Bières", {"beer", "bieres", "mead"}),
        "wine": ("🍷 Vins", {"wine", "vins"}),
        "spirits": ("🥃 Spiritueux", {"spiritueux"}),
        "soft": ("🥤 Sans alcool", {"soft"}),
        "hot_meals": ("🍲 Plats chauds", {"meals", "nourriture"}),
        "pies": ("🥧 Tourtes et pâtés", {"pies"}),
        "bread": ("🍞 Pains et accompagnements", {"bread"}),
        "meat": ("🥩 Viandes et provisions", {"meats"}),
    }

    def product_page(group_key: str, return_page: str) -> dict[str, Any]:
        label, categories = product_groups[group_key]
        keys = [str(product["item_key"]) for product in products if product.get("category") in categories]
        return page(f"ux_tavern_{group_key}", label, [
            hero(f"tavern_{group_key}", label, "Prix et disponibilités proviennent du stock réel de la Taverne.", label.split()[0]),
            {"id": f"ux_tavern_shop_voice_{group_key}", "type": "contextual_content", "props": {
                "fallback": {"title": "Edgar", "emoji": "🧔", "text": "« Choisis tranquillement, les prix et les réserves sont à jour. »"},
                "variants": ([{"key": "low_stock", "priority": 10, "title": "Edgar", "emoji": "🧔", "text": "« Les réserves baissent. Il faudra bientôt ravitailler la Taverne. »", "condition": {"type": "building_stock", "building": "edgar_tavern", "item": keys[0], "operator": "<", "value": 4}}] if keys else []),
            }},
            {"id": f"ux_tavern_products_{group_key}", "type": "dynamic_product_selector", "slot": 0,
             "props": {"placeholder": "Choisir un produit…", "item_keys": keys}},
            nav(f"tavern_{group_key}_back", "Catégories", return_page, 5, "↩️"),
            nav(f"tavern_{group_key}_home", "Accueil", "home", 6, "🏠"),
        ])

    recipe_pages: list[dict[str, Any]] = []
    recipe_options: list[dict[str, Any]] = []
    for index, recipe in enumerate(tavern_modules.get("recipes", [])):
        recipe_key = str(recipe["key"])
        page_key = f"ux_recipe_{recipe_key}"[:64]
        recipe_options.append({
            "key": recipe_key, "label": str(recipe.get("name") or recipe.get("title") or recipe_key)[:100],
            "description": f"{int(recipe.get('preparation_seconds', 0)) + int(recipe.get('transformation_seconds', 0))} s · produit {int(recipe.get('output_quantity', 1))}"[:100],
            "interaction": {"type": "navigate", "page": page_key},
        })
        ingredients = "\n".join(f"• {amount}× {item_names.get(item, item)}" for item, amount in recipe.get("ingredients", {}).items()) or "Aucun ingrédient"
        output_name = item_names.get(str(recipe.get("output_item_key", "")), str(recipe.get("output_item_key", "")))
        start = action("edgar_tavern", recipe_key, "Cuisiner", 0, "👨‍🍳")
        claim = action("edgar_tavern", f"claim_{recipe_key}"[:64], "Récupérer", 1, "📦")
        claim.pop("visible_when", None)
        recipe_pages.append(page(page_key, str(recipe.get("name") or recipe_key), [
            hero(f"recipe_{index}", str(recipe.get("name") or recipe.get("title") or recipe_key),
                 f"Marmites partagées · durée totale {int(recipe.get('preparation_seconds', 0)) + int(recipe.get('transformation_seconds', 0))} secondes", "🍲"),
            {"id": f"ux_recipe_card_{index}", "type": "card", "props": {
                "title": "Ingrédients et production",
                "text": f"{ingredients}\n\nProduction : {int(recipe.get('output_quantity', 1))}× {output_name}",
            }},
            {"id": f"ux_recipe_status_{index}", "type": "workstation_status",
             "props": {"title": "État des marmites", "building": "edgar_tavern"}},
            start, claim,
            nav(f"recipe_{index}_back", "Voir les marmites", "ux_tavern_kitchen", 4, "↩️"),
        ]))

    drink_options = [{"key": key, "label": label, "interaction": {"type": "navigate", "page": f"ux_tavern_{key}"}}
                     for key, (label, _) in product_groups.items() if key in {"beer", "wine", "spirits", "soft"}]
    food_options = [{"key": key, "label": label, "interaction": {"type": "navigate", "page": f"ux_tavern_{key}"}}
                    for key, (label, _) in product_groups.items() if key in {"hot_meals", "pies", "bread", "meat"}]

    apply("edgar_tavern", [
        hero("tavern", "À la Gueuse Cocu", "Edgar accueille les voyageurs derrière son comptoir.", "🍺"),
        text("tavern_status", "👤 **Tavernier :** Edgar Brassebarbe\n🟢 **Établissement ouvert**\n🍲 **Cuisine partagée :** consultez les marmites en temps réel."),
        {"id": "tavern_ambiance", "type": "contextual_content", "props": {"replace_page_title": True,
            "fallback": {"title": "À la Gueuse Cocu", "emoji": "🍺", "text": "Une soirée presque ordinaire s’installe dans la Taverne. Le feu crépite dans l’âtre tandis qu’Edgar sert les habitués. Les conversations couvrent le bruit des chopes reposées sur les tables."},
            "variants": [
                {"key": "after_storm", "priority": 30, "title": "À la Gueuse Cocu", "emoji": "🌧️", "text": "Le vent s’est enfin calmé. Les conversations ont changé de ton. Des habitants entrent régulièrement pour annoncer de nouveaux dégâts dans le Royaume. Edgar écoute chaque témoignage avec inquiétude.", "condition": _minute(105)},
                {"key": "during_storm", "priority": 20, "title": "À la Gueuse Cocu", "emoji": "🌩️", "text": "Les volets tremblent sous les rafales. Le vent hurle dehors et plusieurs habitants se sont réfugiés près du foyer. Edgar continue de servir, mais jette régulièrement un regard inquiet vers les fenêtres.", "condition": _minute(90)},
            ],
        }},
        nav("tavern_drinks", "Commander à boire", "ux_tavern_drinks", 0, "🍺", style="primary"),
        nav("tavern_meals", "Commander à manger", "ux_tavern_meals", 1, "🍗"),
        nav("tavern_edgar", "Parler à Edgar", "ux_tavern_edgar", 2, "💬"),
        nav("tavern_kitchen", "Cuisiner", "ux_tavern_kitchen", 3, "👨‍🍳"),
        nav("tavern_counter", "Stocks & livraisons", "ux_tavern_counter", 4, "🎒"),
    ], [
        page("ux_tavern_drinks", "Boissons", [hero("drinks", "Boissons de la Gueuse Cocu", "Choisissez une catégorie. Les prix et disponibilités proviennent du stock réel.", "🍺"),
             {"id": "ux_tavern_drink_categories", "type": "select", "slot": 0, "props": {"placeholder": "Choisir une catégorie"}, "options": drink_options}, back("drinks", 5)]),
        page("ux_tavern_meals", "Repas", [hero("meals", "Repas et provisions", "Les plats disponibles dépendent réellement des productions du stock commun.", "🍗"),
             {"id": "ux_tavern_food_categories", "type": "select", "slot": 0, "props": {"placeholder": "Choisir une catégorie de repas"}, "options": food_options}, back("meals", 5)]),
        *[product_page(key, "ux_tavern_drinks" if key in {"beer", "wine", "spirits", "soft"} else "ux_tavern_meals") for key in product_groups],
        page("ux_tavern_edgar", "Edgar", [hero("edgar", "Edgar Brassebarbe", "L'aubergiste connaît les nouvelles, les besoins et les rumeurs du village.", "🧔"),
             {"id": "ux_tavern_edgar_dialogue", "type": "npc_dialogue", "slot": 0,
              "props": {"npc_key": "edgar", "placeholder": "Parler à Edgar…"}},
             nav("edgar_work", "Travail et métier", "profession", 5, "👨‍🍳"),
             {"id": "ux_edgar_quests", "type": "button", "slot": 6, "props": {"label": "Voir mes quêtes", "emoji": "📜", "style": "secondary"}, "interaction": {"type": "quest_board"}},
             back("edgar", 9)]),
        page("ux_tavern_kitchen", "Cuisine", [hero("kitchen", "Cuisine de la Gueuse Cocu", "Les marmites sont partagées. Choisissez une recette libre ou consultez une préparation en cours.", "🍲"),
             {"id": "ux_tavern_workstations", "type": "workstation_status", "props": {"title": "État des marmites", "building": "edgar_tavern"}},
             {"id": "ux_tavern_recipes", "type": "select", "slot": 0, "props": {"placeholder": "Choisir une recette ou voir sa préparation…"}, "options": recipe_options},
             {"id": "ux_tavern_refresh", "type": "button", "slot": 5, "props": {"label": "Actualiser", "emoji": "🔄", "style": "secondary"}, "interaction": {"type": "refresh"}},
             back("kitchen", 9)]),
        *recipe_pages,
        page("ux_tavern_counter", "Stocks & livraisons", [hero("counter", "Stocks et livraisons", "Consultez les réserves ou apportez les ressources demandées par Edgar.", "🎒"),
             {"id": "ux_tavern_stock_status", "type": "stock_status", "props": {"title": "État des réserves", "building": "edgar_tavern", "groups": [
                 {"key": key, "label": label, "emoji": label.split()[0], "item_keys": [str(product["item_key"]) for product in products if product.get("category") in categories], "critical_min": 1, "low_min": 4, "comfortable_min": 10}
                 for key, (label, categories) in product_groups.items()
             ]}},
             nav("counter_stock", "Voir les stocks", "ux_tavern_stock", 0, "📦"), nav("counter_delivery", "Effectuer une livraison", "ux_tavern_delivery", 1, "🚚"), back("counter", 4)]),
        page("ux_tavern_stock", "Stocks", [hero("stock", "Stock de la Taverne", "Les quantités sont actualisées en temps réel.", "📦"),
             {"id": "ux_tavern_stock_content", "type": "building_inventory", "props": {"title": "Réserves", "building": "edgar_tavern"}}, nav("stock_back", "Stocks & livraisons", "ux_tavern_counter", 0, "↩️"), nav("stock_home", "Accueil", "home", 1, "🏠")]),
        page("ux_tavern_delivery", "Livrer à Edgar", [hero("delivery", "Livrer à Edgar", "Seuls les objets présents dans votre inventaire et acceptés par la Taverne sont proposés.", "🚚"),
             {"id": "ux_tavern_delivery_selector", "type": "dynamic_inventory_selector", "slot": 0, "props": {"placeholder": "Choisir un objet à livrer…"}},
             nav("delivery_back", "Stocks & livraisons", "ux_tavern_counter", 5, "↩️"), nav("delivery_home", "Accueil", "home", 6, "🏠")]),
    ])
    tavern["interface"]["pages"] = [
        item for item in tavern["interface"]["pages"]
        if item["key"] in {"home", "profession"}
        or item["key"].startswith(("ux_tavern_", "ux_recipe_"))
    ]

    mine_normal = {"any": [_minute(96, "<"), _progress("storm_mine_repaired", "progress", 1)]}
    mine_incident = {"all": [_minute(96), _progress("storm_mine_repaired", "progress", 1, "<")]}
    mine_repair = {"all": [_minute(105), _progress("storm_mine_repaired", "progress", 1, "<")]}
    apply("deep_mine", [
        hero("mine_normal", "Mine de Roland", "Les galeries résonnent sous les coups de pioche. Roland surveille chaque étai.", "⛏️", mine_normal),
        hero("mine_incident", "Galerie inondée", "La galerie basse est endommagée. Roland organise sa sécurisation.", "🚨", mine_incident),
        text("mine_secured", "✅ Galerie basse sécurisée. La production a repris normalement.", _progress("storm_mine_repaired", "progress", 1)),
        cond({"id": "ux_mine_wood", "type": "collective_objective", "props": {"objective_key": "mine_wood", "title": "Bois", "target": 8, "unit": "bois"}}, mine_repair),
        cond({"id": "ux_mine_stone", "type": "collective_objective", "props": {"objective_key": "mine_stone", "title": "Pierre", "target": 8, "unit": "pierres"}}, mine_repair),
        nav("mine_roland", "Parler à Roland", "ux_mine_roland", 0, "💬", style="primary"),
        nav("mine_work", "Travailler à la mine", "ux_mine_work", 1, "⛏️", mine_normal),
        nav("mine_stock", "Stock et livraisons", "ux_mine_stock", 2, "📦", mine_normal),
        nav("mine_explore", "Explorer les galeries", "galleries", 3, "🕯️", mine_normal),
        nav("mine_incident", "Constater les dégâts", "ux_mine_incident", 4, "🔎", mine_incident),
        nav("mine_repair", "Sécuriser la galerie", "storm_incident", 5, "🛠️", mine_repair, "primary"),
        nav("mine_supplies", "Apporter des matériaux", "storm_incident", 6, "📦", mine_repair),
    ], [
        page("ux_mine_roland", "Roland", [hero("roland", "Roland DuPoivron", "Le contremaître connaît l'état des galeries et les besoins des mineurs.", "⛏️"), action("deep_mine", "talk_npc", "Parler à Roland", 0, "💬"), back("roland", 1)]),
        page("ux_mine_work", "Extraction", [hero("mine_work", "Travailler à la mine", "Choisissez une production ; sa récupération reste individuelle.", "⛏️"), nav("mine_storm_resources", "Pierre et minerai", "storm_resources", 0, "🪨"), nav("mine_galleries", "Galeries", "galleries", 1, "🕯️"), back("mine_work", 2)]),
        page("ux_mine_stock", "Stock", [hero("mine_stock", "Stock et livraisons", "Consultez les réserves ou livrez vos ressources.", "📦"), nav("mine_stock_page", "Consulter le stock", "stock_delivery", 0, "📊"), nav("mine_delivery_page", "Livrer", "storm_delivery", 1, "📦"), back("mine_stock", 2)]),
        page("ux_mine_incident", "Incident", [hero("mine_damage", "La galerie basse", "L'eau et les pierres ont endommagé les étais. Le chantier de sécurisation ouvre après la tempête.", "🚨"),
             text("mine_wait", "Roland attend l'accalmie avant d'engager les habitants.", {"all": [_minute(96), _minute(105, "<")]}),
             nav("mine_damage_repair", "Ouvrir le chantier", "storm_incident", 0, "🛠️", mine_repair, "primary"), back("mine_damage", 1)]),
    ])

    apply("royal_forge", [
        hero("forge", "Forge Dorée", "Wagner travaille le métal au rythme du soufflet et des étincelles.", "⚒️"),
        nav("forge_wagner", "Parler à Wagner", "ux_forge_wagner", 0, "💬", style="primary"),
        nav("forge_work", "Forger", "ux_forge_work", 1, "🔨"),
        nav("forge_repair_home", "Réparer un équipement", "repairs", 2, "🛠️"),
        nav("forge_stock", "Matériaux et commandes", "ux_forge_stock", 3, "📦"),
    ], [
        page("ux_forge_wagner", "Wagner", [hero("wagner", "Wagner", "Le forgeron sait ce qui peut être fondu, forgé ou réparé.", "🔨"), action("royal_forge", "talk_npc", "Parler à Wagner", 0, "💬"), back("wagner", 1)]),
        page("ux_forge_work", "Atelier", [hero("forge_work", "Fourneaux et enclumes", "Choisissez un atelier ; les productions prêtes restent récupérables une seule fois.", "🔥"), nav("forge_smelt", "Fondre", "smelt", 0, "🔥"), nav("forge_craft", "Fabriquer", "craft", 1, "🔨"), nav("forge_repair", "Réparer", "repairs", 2, "🧰"), nav("forge_church", "Ferrures de l'église", "storm_workshop", 3, "⛪"), back("forge_work", 4)]),
        page("ux_forge_stock", "Matériaux", [hero("forge_stock", "Matériaux et commandes", "Suivez les réserves de l'atelier et les commandes en cours.", "📦"), nav("forge_stock_page", "Consulter le stock", "stock", 0, "📊"), nav("forge_delivery", "Livrer", "storm_delivery", 1, "📦"), nav("forge_shop", "Boutique", "shop", 2, "🛒"), back("forge_stock", 3)]),
    ])

    forest_storm = {"all": [_minute(90), _minute(105, "<")]}
    forest_normal = {"any": [_minute(90, "<"), _minute(105)]}
    apply("forester_lodge", [
        hero("forest", "Forêt de Sylvain", "Sous les grands chênes, Sylvain lit les traces et écoute le vent.", "🌲", forest_normal),
        hero("forest_storm", "Tempête en forêt", "Le vent rend la coupe dangereuse : le rendement est temporairement réduit à 75 %.", "⛈️", forest_storm),
        nav("forest_sylvain", "Parler à Sylvain", "ux_forest_sylvain", 0, "💬", style="primary"),
        nav("forest_work", "Travailler en forêt", "ux_forest_work", 1, "🪓"),
        nav("forest_zones", "Explorer les zones", "zones_forester", 2, "🗺️"),
        nav("forest_stock", "Stock et livraisons", "ux_forest_stock", 3, "📦"),
    ], [
        page("ux_forest_sylvain", "Sylvain", [hero("sylvain", "Sylvain", "Le garde forestier connaît les zones sûres et les besoins du village.", "🌲"), action("forester_lodge", "talk_npc", "Parler à Sylvain", 0, "💬"), back("sylvain", 1)]),
        page("ux_forest_work", "Travail", [hero("forest_work", "Travail en forêt", "Coupez le bois utile ou partez chasser dans les zones autorisées.", "🪓"), nav("forest_resources", "Couper du bois", "storm_resources", 0, "🪵"), nav("forest_hunt", "Chasser", "zones_hunter", 1, "🏹"), back("forest_work", 2)]),
        page("ux_forest_stock", "Stock", [hero("forest_stock", "Stock et livraisons", "Consultez les réserves ou livrez le bois demandé.", "📦"), nav("forest_inventory", "Stock", "inventories", 0, "📊"), nav("forest_delivery", "Livrer", "storm_delivery", 1, "📦"), back("forest_stock", 2)]),
    ])

    apply("old_bridge", [
        hero("bridge", "Vieux pont", "Le vieux pont franchit la rivière sombre qui longe la vallée.", "🌉"),
        text("bridge_storm", "⛈️ Le pont vibre sous les rafales mais reste praticable.", {"all": [_minute(90), _minute(105, "<")]}),
        action("old_bridge", "fish_old_bridge", "Pêcher", 0, "🎣"),
        action("old_bridge", "claim_fish_old_bridge", "Récupérer les poissons", 1, "✅"),
        nav("bridge_cross", "Traverser", "bridge_route", 2, "🥾"),
    ], [])

    church_before = _minute(110, "<")
    church_damage = {"all": [_minute(110), _minute(120, "<")]}
    church_open = _minute(120)
    counters = [
        ("church_tree_cleared", "Arbre dégagé", 3, "actions"), ("church_wood", "Bois", 40, "bois"),
        ("church_stone", "Pierre", 28, "pierres"), ("church_brackets", "Ferrures", 4, "ferrures"),
        ("church_provisions", "Provisions", 8, "portions"), ("church_assembly", "Assemblages", 2, "actions"),
    ]
    counter_components = [{"id": f"ux_counter_{key}", "type": "collective_objective",
                           "props": {"objective_key": key, "title": title, "target": target, "unit": unit}}
                          for key, title, target, unit in counters]
    apply("saint_shovel_church", [
        hero("church_before", "Église de la Sainte Pelle", "Une petite église vétuste. Le prêtre entretient les lieux malgré les tuiles fatiguées.", "⛪", church_before),
        hero("church_damage", "L'arbre est tombé", "La toiture est endommagée. Le parvis reste sûr, mais le chantier n'est pas encore ouvert.", "🌳", church_damage),
        hero("church_open", "Chantier de la Sainte Pelle", "Les habitants peuvent désormais dégager, livrer et assembler ensemble.", "🛠️", church_open),
        *[cond(deepcopy(item), church_open) for item in counter_components],
        action("saint_shovel_church", "pray_saint_shovel", "Prier", 0, "🙏", church_before),
        nav("church_priest_before", "Parler au prêtre", "ux_church_priest", 1, "💬", church_before),
        nav("church_examine", "Examiner les dégâts", "ux_church_damage", 2, "🔎", church_damage, "primary"),
        nav("church_priest_damage", "Parler au prêtre", "ux_church_priest", 3, "💬", church_damage),
        nav("church_clear", "Dégager l'arbre", "ux_church_clear", 4, "🪓", church_open, "primary"),
        nav("church_materials", "Apporter des matériaux", "ux_church_materials", 5, "📦", church_open),
        nav("church_participate", "Participer au chantier", "ux_church_participate", 6, "🛠️", church_open),
        nav("church_collective", "Voir l'effort collectif", "ux_church_collective", 7, "📜", church_open),
    ], [
        page("ux_church_priest", "Le prêtre", [hero("priest", "Le prêtre de la Sainte Pelle", "Il accueille les voyageurs et veille sur la communauté.", "🙏"), action("saint_shovel_church", "talk_priest", "Parler au prêtre", 0, "💬"), back("priest", 1)]),
        page("ux_church_damage", "Dégâts", [hero("church_damage_page", "La toiture endommagée", "Un arbre a traversé une partie de la toiture. Le chantier ouvrira à T+120.", "🌳"), back("church_damage", 0)]),
        page("ux_church_clear", "Dégager", [hero("church_clear", "Dégager l'arbre", "Lancez l'activité, puis revenez récupérer votre contribution lorsqu'elle est prête.", "🪓"), action("saint_shovel_church", "start_church_tree_cleared", "Dégager l'arbre", 0, "🪓"), action("saint_shovel_church", "claim_church_tree_cleared", "Terminer le dégagement", 1, "✅"), back("church_clear", 2)]),
        page("ux_church_materials", "Matériaux", [hero("church_materials", "Matériaux du chantier", "Les dépôts sont effectués ici, à l'église.", "📦"),
             action("saint_shovel_church", "deposit_church_wood_1", "Déposer 1 bois", 0, "🪵"), action("saint_shovel_church", "deposit_church_wood_8", "Déposer 8 bois", 1, "🪵"),
             action("saint_shovel_church", "deposit_church_stone_1", "Déposer 1 pierre", 2, "🪨"), action("saint_shovel_church", "deposit_church_stone_8", "Déposer 8 pierres", 3, "🪨"),
             action("saint_shovel_church", "deposit_church_brackets_1", "Déposer 1 ferrure", 4, "🔩"), action("saint_shovel_church", "deposit_church_provisions_2", "Déposer 2 provisions", 5, "🍲"), back("church_materials", 6)]),
        page("ux_church_participate", "Participer", [hero("church_participate", "Assembler la charpente", "Lorsque les prérequis sont réunis, assemblez les premiers éléments.", "🛠️"), action("saint_shovel_church", "start_church_assembly", "Assembler la charpente", 0, "🛠️"), action("saint_shovel_church", "claim_church_assembly", "Terminer l'assemblage", 1, "✅"), back("church_participate", 2)]),
        page("ux_church_collective", "Effort collectif", [hero("church_collective", "Effort collectif", "La progression réelle du chantier, partagée par tout le Royaume.", "📜"),
             *[{**deepcopy(item), "id": item["id"].replace("ux_counter_", "ux_collective_")} for item in counter_components],
             back("church_collective", 0)]),
    ])


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
         [_action_goal("fish", "old_bridge", "fish_old_bridge", 2),
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

    _rebuild_discord_building_ux(rows)

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


def audit_storm_voice_mapping(rows: list[dict[str, Any]]) -> dict[str, int]:
    """Audit machine-readable du pack vocal officiel publié."""
    audio = {row["key"]: row["payload"] for row in rows if row["type"] == "audio"}
    clips = [clip for row in rows if row["type"] == "voice_profile"
             and row["key"] in {"voice_edgar", "voice_roland", "voice_wagner"}
             for clip in row["payload"].get("clips", [])]
    mapped = [clip for clip in clips if clip.get("metadata", {}).get("semantic_key")]
    root = Path(__file__).parent
    found = sum((root / audio[clip["audio_key"]]["storage_path"]).is_file()
                for clip in clips if clip.get("audio_key") in audio)
    return {
        "expected": 80, "found": found, "mapped": len(mapped),
        "missing": 80 - found,
        "auto_routable": sum(c["metadata"].get("storm_beta_policy") == "AUTO_CONTEXTUEL" for c in mapped),
        "scenario_disabled_rumours": sum(c["metadata"].get("storm_beta_policy") == "MANUEL_DESACTIVE_BETA" for c in mapped),
        "conditional_closing": sum(c["metadata"].get("storm_beta_policy") == "CONDITIONNEL_FERMETURE" for c in mapped),
    }
