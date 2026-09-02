"""Calcul déterministe des valeurs effectives sans modifier les définitions de base."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Iterable

@dataclass(frozen=True, slots=True)
class AppliedModifier:
    source: str; operator: str; value: float; before: float; after: float

class ModifierEngine:
    def effective(self, base: float, property_name: str, context: dict[str, Any], environment: Iterable[dict[str, Any]] = (), events: Iterable[dict[str, Any]] = ()):
        current, trace = float(base), []
        sources = [("environment", item) for item in environment] + [("event", item) for item in events if item.get("active") or item.get("status") == "active"]
        sources.sort(key=lambda pair: (0 if pair[0] == "environment" else 1, int(pair[1].get("priority", 0)), str(pair[1].get("key", pair[1].get("name", "")))))
        for source_type, source in sources:
            for modifier in source.get("modifiers", []):
                if modifier.get("property") != property_name or not self._matches(modifier.get("target", {}), context): continue
                before, operator, value = current, modifier.get("operator", "multiply"), float(modifier.get("value", 1))
                current = {"set": lambda: value, "add": lambda: current + value, "multiply": lambda: current * value, "min": lambda: min(current, value), "max": lambda: max(current, value)}[operator]()
                trace.append(AppliedModifier(f"{source_type}:{source.get('key', source.get('name', 'source'))}", operator, value, before, current))
        return current, trace

    @staticmethod
    def _matches(target, context):
        if not target: return True
        aliases = {"building": "building_key", "profession": "profession_key", "activity": "activity_key", "recipe": "recipe_key", "item": "item_key", "action": "action_key", "location": "location_key"}
        kind = target.get("type") or target.get("scope")
        if not kind or kind == "kingdom": return True
        if target.get("tags") and not set(target["tags"]).intersection(context.get("tags", [])): return False
        return not target.get("key") or context.get(aliases.get(kind, f"{kind}_key")) == target.get("key")

def explain(base, effective, trace):
    return {"base": base, "effective": effective, "modifiers": [{name: getattr(item, name) for name in item.__slots__} for item in trace]}
