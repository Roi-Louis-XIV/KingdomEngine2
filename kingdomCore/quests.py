"""Quêtes personnelles : définitions publiées et progression transactionnelle."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any, Callable

from KingdomData import ContentStore, ValidationError
from KingdomData.store import ConflictError
from KingdomData.schemas import validate_key


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class QuestRuntime:
    def __init__(self, store: ContentStore,
                 condition_evaluator: Callable[[Any, str, dict[str, Any]], bool] | None = None) -> None:
        self.store = store
        self.condition_evaluator = condition_evaluator

    @staticmethod
    def _active(db, discord_id: str):
        return db.execute(
            "SELECT * FROM player_quests WHERE discord_id=? AND status IN ('accepted','ready') ORDER BY id DESC LIMIT 1",
            (str(discord_id),),
        ).fetchone()

    @staticmethod
    def _view(row) -> dict[str, Any]:
        definition = json.loads(row["definition_json"])
        progress = json.loads(row["progress_json"])
        return {
            "id": int(row["id"]), "key": str(row["quest_key"]),
            "version": int(row["quest_version"]), "name": definition["name"],
            "description": definition.get("description", ""),
            "reward_xp": int(definition.get("reward_xp", 0)),
            "status": str(row["status"]), "accepted_at": row["accepted_at"],
            "ready_at": row["ready_at"], "closed_at": row["closed_at"],
            "objectives": [
                {**objective, "progress": int(progress.get(objective["key"], 0)),
                 "required": int(objective.get("quantity", 1))}
                for objective in definition["objectives"]
            ],
        }

    @staticmethod
    def _scenario_minute(db, now: float) -> float | None:
        row = db.execute(
            "SELECT value_json FROM world_runtime WHERE runtime_key='live_ops_scenario'"
        ).fetchone()
        if not row:
            return None
        try:
            started_at = float(json.loads(row[0])["started_at"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            return None
        return max(0.0, (now - started_at) / 60.0)

    @staticmethod
    def _available(payload: dict[str, Any], minute: float | None) -> bool:
        start, end = payload.get("available_from_minute"), payload.get("available_until_minute")
        if start is None and end is None:
            return True
        if minute is None:
            return False
        return (start is None or minute >= int(start)) and (end is None or minute < int(end))

    def _available_for_player(self, db, discord_id: str, payload: dict[str, Any], minute: float | None) -> bool:
        if not self._available(payload, minute):
            return False
        condition = payload.get("available_conditions")
        if not condition:
            return True
        # Le moteur injecte ici le même évaluateur que pour les actions et
        # composants Discord. Un consommateur autonome sans moteur échoue fermé.
        return self.condition_evaluator is not None and self.condition_evaluator(db, str(discord_id), condition)

    def board(self, discord_id: str, *, limit: int = 5, now: float | None = None) -> dict[str, Any]:
        """Propositions visibles, quête active et historique récent du joueur."""
        with self.store.connection() as db:
            active = self._active(db, discord_id)
            history = [self._view(row) for row in db.execute(
                "SELECT * FROM player_quests WHERE discord_id=? AND status IN ('claimed','abandoned') ORDER BY id DESC LIMIT 10",
                (str(discord_id),),
            )]
            xp = db.execute("SELECT quest_experience FROM players WHERE discord_id=?", (str(discord_id),)).fetchone()
            minute = self._scenario_minute(db, time.time() if now is None else float(now))
            if active:
                offers: list[dict[str, Any]] = []
            else:
                claimed = {str(row[0]) for row in db.execute(
                    "SELECT DISTINCT quest_key FROM player_quests WHERE discord_id=? AND status='claimed'",
                    (str(discord_id),),
                )}
                offers = []
                definitions = sorted(
                    self.store.list("quest", published=True),
                    key=lambda row: (-int(row["payload"].get("priority", 0) or 0),
                                     -int(row["payload"].get("available_from_minute", 0) or 0),
                                     row["entity_key"]),
                )
                for row in definitions:
                    payload = row["payload"]
                    if not self._available_for_player(db, discord_id, payload, minute):
                        continue
                    if row["entity_key"] in claimed and not payload.get("repeatable", False):
                        continue
                    offers.append({"key": row["entity_key"], "version": row["version"],
                                   "name": payload["name"], "description": payload.get("description", ""),
                                   "reward_xp": int(payload.get("reward_xp", 0)),
                                   "objectives": [{**objective, "required": int(objective.get("quantity", 1))}
                                                  for objective in payload["objectives"]]})
                    if len(offers) >= max(1, min(5, int(limit))):
                        break
        return {"active": self._view(active) if active else None, "offers": offers,
                "quest_experience": int(xp[0]) if xp else 0, "history": history,
                "scenario_minute": minute}

    @staticmethod
    def _previous(db, interaction_id: str, discord_id: str, operation: str) -> dict[str, Any] | None:
        row = db.execute("SELECT * FROM quest_interactions WHERE interaction_id=?", (str(interaction_id),)).fetchone()
        if not row:
            return None
        if row["discord_id"] != str(discord_id) or row["operation"] != operation:
            raise ConflictError("Cet identifiant d'interaction appartient à une autre opération.")
        return json.loads(row["result_json"])

    @staticmethod
    def _remember(db, interaction_id: str, discord_id: str, operation: str, result: dict[str, Any]) -> None:
        db.execute(
            "INSERT INTO quest_interactions(interaction_id,discord_id,operation,result_json,created_at) VALUES(?,?,?,?,?)",
            (str(interaction_id), str(discord_id), operation, json.dumps(result, ensure_ascii=False), _now()),
        )

    def accept(self, discord_id: str, quest_key: str, interaction_id: str) -> dict[str, Any]:
        quest_key = validate_key(quest_key)
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = self._previous(db, interaction_id, discord_id, "accept")
            if previous is not None:
                return previous
            if self._active(db, discord_id):
                raise ValidationError("Réclame ou abandonne ta quête active avant d'en choisir une autre.")
            row = db.execute(
                "SELECT version,payload_json FROM content WHERE entity_type='quest' AND entity_key=? AND status='published'",
                (quest_key,),
            ).fetchone()
            if not row:
                raise ValidationError("Cette quête n'est pas disponible.")
            definition = json.loads(row["payload_json"])
            minute = self._scenario_minute(db, time.time())
            if not self._available_for_player(db, discord_id, definition, minute):
                raise ValidationError("Cette quête n'est pas disponible pour le moment.")
            if not definition.get("repeatable", False) and db.execute(
                "SELECT 1 FROM player_quests WHERE discord_id=? AND quest_key=? AND status='claimed'",
                (str(discord_id), quest_key),
            ).fetchone():
                raise ValidationError("Cette quête a déjà été accomplie.")
            stamp = _now()
            db.execute("INSERT OR IGNORE INTO players(discord_id,updated_at,created_at) VALUES(?,?,?)",
                       (str(discord_id), stamp, stamp))
            cursor = db.execute(
                "INSERT INTO player_quests(discord_id,quest_key,quest_version,definition_json,progress_json,status,accepted_at) VALUES(?,?,?,?,?,'accepted',?)",
                (str(discord_id), quest_key, int(row["version"]), json.dumps(definition, ensure_ascii=False), "{}", stamp),
            )
            result = {"ok": True, "quest": self._view(db.execute("SELECT * FROM player_quests WHERE id=?", (cursor.lastrowid,)).fetchone())}
            self._remember(db, interaction_id, discord_id, "accept", result)
            return result

    def claim(self, discord_id: str, quest_key: str, interaction_id: str) -> dict[str, Any]:
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = self._previous(db, interaction_id, discord_id, "claim")
            if previous is not None:
                return previous
            row = self._active(db, discord_id)
            if not row or row["quest_key"] != quest_key or row["status"] != "ready":
                raise ValidationError("Cette quête n'est pas prête à rendre.")
            amount = int(json.loads(row["definition_json"]).get("reward_xp", 0))
            stamp = _now()
            db.execute("UPDATE player_quests SET status='claimed',closed_at=? WHERE id=? AND status='ready'", (stamp, row["id"]))
            db.execute("UPDATE players SET quest_experience=quest_experience+?,updated_at=? WHERE discord_id=?",
                       (amount, stamp, str(discord_id)))
            total = db.execute("SELECT quest_experience FROM players WHERE discord_id=?", (str(discord_id),)).fetchone()[0]
            result = {"ok": True, "quest_key": quest_key, "reward_xp": amount, "quest_experience": int(total)}
            self._remember(db, interaction_id, discord_id, "claim", result)
            return result

    def abandon(self, discord_id: str, quest_key: str, interaction_id: str, *, confirmed: bool = False) -> dict[str, Any]:
        if not confirmed:
            raise ValidationError("Confirme l'abandon de cette quête.")
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = self._previous(db, interaction_id, discord_id, "abandon")
            if previous is not None:
                return previous
            row = self._active(db, discord_id)
            if not row or row["quest_key"] != quest_key:
                raise ValidationError("Cette quête n'est plus active.")
            db.execute("UPDATE player_quests SET status='abandoned',closed_at=? WHERE id=?", (_now(), row["id"]))
            result = {"ok": True, "quest_key": quest_key, "reward_xp": 0}
            self._remember(db, interaction_id, discord_id, "abandon", result)
            return result

    @staticmethod
    def _matches(objective: dict[str, Any], event: dict[str, Any]) -> int:
        kind = objective["type"]
        if event.get("type") != kind:
            return 0
        if kind == "action":
            return int(objective["building_key"] == event.get("building_key") and
                       objective["action_key"] == event.get("action_key"))
        if kind == "delivery":
            return int(event.get("quantity", 0)) if (
                objective["item_key"] == event.get("item_key") and
                objective["destination_building_key"] == event.get("destination_building_key")
            ) else 0
        if objective.get("location_key"):
            return int(objective["location_key"] == event.get("location_key"))
        return int(objective["building_key"] == event.get("building_key"))

    def advance_event(self, db, discord_id: str, source_kind: str, source_id: str,
                      events: list[dict[str, Any]]) -> dict[str, Any] | None:
        """À appeler dans la transaction qui a effectivement créé l'événement."""
        row = self._active(db, discord_id)
        if not row or row["status"] != "accepted":
            return None
        if db.execute(
            "SELECT 1 FROM quest_progress_events WHERE source_kind=? AND source_id=?",
            (source_kind, str(source_id)),
        ).fetchone():
            return self._view(row)
        definition = json.loads(row["definition_json"])
        progress = json.loads(row["progress_json"])
        changed = False
        for objective in definition["objectives"]:
            key, required = objective["key"], int(objective.get("quantity", 1))
            amount = sum(self._matches(objective, event) for event in events)
            if amount > 0 and int(progress.get(key, 0)) < required:
                progress[key] = min(required, int(progress.get(key, 0)) + amount)
                changed = True
        if not changed:
            return self._view(row)
        db.execute(
            "INSERT INTO quest_progress_events(player_quest_id,source_kind,source_id,created_at) VALUES(?,?,?,?)",
            (row["id"], source_kind, str(source_id), _now()),
        )
        ready = all(int(progress.get(objective["key"], 0)) >= int(objective.get("quantity", 1))
                    for objective in definition["objectives"])
        db.execute(
            "UPDATE player_quests SET progress_json=?,status=?,ready_at=? WHERE id=?",
            (json.dumps(progress, ensure_ascii=False), "ready" if ready else "accepted", _now() if ready else None, row["id"]),
        )
        return self._view(db.execute("SELECT * FROM player_quests WHERE id=?", (row["id"],)).fetchone())

    def record_visit(self, discord_id: str, interaction_id: str, *, location_key: str = "",
                     building_key: str = "") -> dict[str, Any] | None:
        if bool(location_key) == bool(building_key):
            raise ValidationError("Indique un lieu ou un bâtiment à visiter.")
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            return self.advance_event(db, discord_id, "visit", interaction_id,
                                      [{"type": "visit", "location_key": location_key, "building_key": building_key}])
