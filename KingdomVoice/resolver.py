"""Résolution explicable d'une scène audio sans dépendance Discord."""
from __future__ import annotations
from typing import Any

def _matches(rule: dict[str, Any], value: str, context: set[str]) -> bool:
    expected=str(rule.get("when",rule.get("key","")))
    return (not expected or expected==value) and (not rule.get("contexts") or bool(context.intersection(rule["contexts"])))

def resolve_audio_scene(building: dict[str, Any], *, period: str="", weather: dict[str, Any] | None=None, season:dict[str,Any]|None=None, events: list[dict[str, Any]] | None=None) -> dict[str, Any]:
    audio=building.get("modules",{}).get("audio",{}); groups={str(g.get("key")):g for g in audio.get("groups",[])}
    context=set(building.get("context_tags",building.get("tags",[]))); weather=weather or {}; season=season or {}; events=events or []
    layers=[]; default=str(audio.get("default_group_key", ""))
    if not default and groups: default=next(iter(groups)); provenance="fallback_historique"
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
            if contribution.get("group_key") in groups and (not contribution.get("contexts") or context.intersection(contribution["contexts"])):
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
