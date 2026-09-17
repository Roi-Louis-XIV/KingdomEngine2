"""Résolution explicable d'une scène audio sans dépendance Discord."""
from __future__ import annotations
from typing import Any


def resolve_building_presences(
    building_key: str,
    building: dict[str, Any],
    npcs: list[dict[str, Any]],
    presences: dict[str, dict[str, Any]],
    *,
    events: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Construit la scène vivante d'un bâtiment sans connaître Discord.

    Une scène ou un événement peut déplacer temporairement un personnage avec
    ``character_moves: [{npc_key, building_key}]``. Tous les personnages
    présents restent matérialisés, mais un seul porte l'ambiance. En leur
    absence, une présence de secours représentant le bâtiment est retournée.
    """
    moves: dict[str, str] = {}
    for event in sorted(events or [], key=lambda item: int(item.get("priority", 0))):
        configured = event.get("character_moves", [])
        if isinstance(configured, dict):
            configured = [
                {"npc_key": npc_key, "building_key": target}
                for npc_key, target in configured.items()
            ]
        for move in configured if isinstance(configured, list) else []:
            if move.get("npc_key") and move.get("building_key"):
                moves[str(move["npc_key"])] = str(move["building_key"])

    residents: list[tuple[str, dict[str, Any]]] = []
    for entity in npcs:
        npc_key = str(entity.get("entity_key") or entity.get("key") or "")
        payload = entity.get("payload", entity)
        effective_building = moves.get(
            npc_key,
            str(payload.get("current_building_key") or payload.get("building_key") or ""),
        )
        if npc_key and effective_building == building_key:
            residents.append((npc_key, payload))

    audio = building.get("modules", {}).get("audio", {})
    primary_key = str(audio.get("primary_npc_key") or building.get("primary_npc_key") or "")
    residents.sort(
        key=lambda row: (
            row[0] != primary_key,
            not bool(row[1].get("is_primary")),
            -int(row[1].get("voice_priority", 0)),
            str(row[1].get("name", row[0])).casefold(),
        )
    )
    result: list[dict[str, Any]] = []
    for index, (npc_key, npc) in enumerate(residents):
        presence_key = str(npc.get("voice_presence_key") or f"npc_{npc_key}")
        configured_presence = dict(presences.get(presence_key, {}))
        result.append(
            {
                **configured_presence,
                "key": presence_key,
                "name": str(npc.get("name") or configured_presence.get("name") or npc_key),
                "presence_type": "npc",
                "source_key": npc_key,
                "voice_profile_key": str(npc.get("voice_profile_key") or configured_presence.get("voice_profile_key") or ""),
                "scene_key": str(audio.get("default_group_key") or configured_presence.get("scene_key") or ""),
                "avatar_path": str(npc.get("avatar_path") or configured_presence.get("avatar_path") or ""),
                "avatar_url": str(npc.get("avatar_url") or configured_presence.get("avatar_url") or ""),
                "priority": 1000 - index,
                "building_key": building_key,
                "carries_ambience": index == 0,
            }
        )
    if result:
        return result

    return [
        {
            "key": f"building_{building_key}",
            "name": str(building.get("name") or building_key),
            "presence_type": "ambience",
            "scene_key": str(audio.get("default_group_key") or ""),
            "avatar_path": str(building.get("avatar_path") or building.get("image_path") or ""),
            "avatar_url": str(building.get("avatar_url") or building.get("image_url") or ""),
            "priority": 0,
            "building_key": building_key,
            "carries_ambience": True,
        }
    ]

def _matches(rule: dict[str, Any], value: str, context: set[str]) -> bool:
    expected=str(rule.get("when",rule.get("key","")))
    return (not expected or expected==value) and (not rule.get("contexts") or bool(context.intersection(rule["contexts"])))

def resolve_audio_scene(building: dict[str, Any], *, period: str="", weather: dict[str, Any] | None=None, season:dict[str,Any]|None=None, events: list[dict[str, Any]] | None=None) -> dict[str, Any]:
    audio=building.get("modules",{}).get("audio",{}); groups={str(g.get("key")):g for g in audio.get("groups",[])}
    context=set(building.get("context_tags",building.get("tags",[]))); weather=weather or {}; season=season or {}; events=events or []
    layers=[]; default=str(audio.get("default_group_key", "")); global_keys=set(map(str,audio.get("global_group_keys",[])))
    local_fallback=next((key for key in groups if key not in global_keys),"")
    if not default and local_fallback: default=local_fallback; provenance="fallback_historique"
    else: provenance="configuration_batiment"
    if default and default in groups: layers.append({"source":"base","source_label":"Ambiance du bâtiment","group_key":default,"group":groups[default],"provenance":provenance})
    for rule in audio.get("time_layers",[]):
        if _matches(rule,period,context) and rule.get("group_key") in groups: layers.append({"source":"time","source_label":period,"group_key":rule["group_key"],"group":groups[rule["group_key"]],"provenance":"règle temporelle"})
    for rule in audio.get("weather_layers",[]):
        if _matches(rule,str(weather.get("key","")),context) and rule.get("group_key") in groups: layers.append({"source":"weather","source_label":weather.get("name",weather.get("key","")),"group_key":rule["group_key"],"group":groups[rule["group_key"]],"provenance":"règle météo"})
    for rule in audio.get("season_layers",[]):
        if _matches(rule,str(season.get("key","")),context) and rule.get("group_key") in groups: layers.append({"source":"season","source_label":season.get("name",season.get("key","")),"group_key":rule["group_key"],"group":groups[rule["group_key"]],"provenance":"règle saisonnière"})
    for event in sorted(events,key=lambda e:(int(e.get("priority",0)),str(e.get("key","")))):
        for contribution in event.get("audio_layers",[]):
            targets=set(map(str,contribution.get("building_keys",[])))
            building_key=str(building.get("key",""))
            if contribution.get("group_key") in groups and (not targets or building_key in targets) and (not contribution.get("contexts") or context.intersection(contribution["contexts"])):
                layers.append({"source":"event","source_label":event.get("name",event.get("key","Event")),"group_key":contribution["group_key"],"group":groups[contribution["group_key"]],"provenance":"occurrence active"})
    return {"building_key":building.get("key",""),"period":period,"weather":weather,"season":season,"layers":layers,"effective_group_key":layers[-1]["group_key"] if layers else "","playback_strategy":"priority_overlay","track_keys":[track for layer in layers for channel in ("ambience","music") for track in layer["group"].get("tracks",{}).get(channel,[])],"explanation":[{"source":layer["source"],"label":layer["source_label"],"group_key":layer["group_key"],"provenance":layer["provenance"]} for layer in layers]}

def resolve_sfx(action: str, *, building_key: str="", item: dict[str, Any] | None=None, rules: list[dict[str, Any]] | None=None) -> dict[str, Any] | None:
    """Priorité: action+bâtiment > action > catégorie objet > fallback."""
    item=item or {}; ranked=[]
    for index,rule in enumerate(rules or []):
        score=0
        if rule.get("action"):
            if rule["action"]!=action: continue
            score+=20
        if rule.get("building_key"):
            if rule["building_key"]!=building_key: continue
            score+=10
        if rule.get("item_category"):
            if rule["item_category"]!=item.get("category"): continue
            score+=5
        if rule.get("fallback"): score+=1
        ranked.append((score,-index,rule))
    return max(ranked,key=lambda row:(row[0],row[1]))[2] if ranked else None
