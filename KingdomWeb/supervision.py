"""Supervision V2 generique : processus, contenus, joueurs, stocks et activite."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from KingdomData import ContentStore
from import_v1 import actions_from_modules
from KingdomWeb.item_catalog import ItemCatalogService


ROOT = Path(__file__).resolve().parents[1]
SERVICES_CONFIG = Path(__file__).with_name("services.json")
PID_REGISTRY = ROOT / "var" / "services.pid.json"
LOGS_DIR = ROOT / "var" / "logs"


class ServiceSupervisor:
    _control_lock = threading.RLock()

    def definitions(self) -> list[dict[str, Any]]:
        return json.loads(SERVICES_CONFIG.read_text(encoding="utf-8"))["services"]

    def statuses(self) -> list[dict[str, Any]]:
        registry = self._registry()
        statuses = []
        for definition in self.definitions():
            entry = next((item for item in registry if item.get("service") == definition["key"]), None)
            pid = os.getpid() if definition["key"] == "web" else self._runtime_pid(definition["key"], entry)
            statuses.append({**definition, "pid": pid or None, "running": self._alive(pid), "started_at": entry.get("StartTime") if entry else None})
        return statuses

    def control(self, service_key: str, operation: str) -> dict[str, Any]:
        definition = next((item for item in self.definitions() if item["key"] == service_key), None)
        if not definition or not definition.get("controllable"):
            raise ValueError("Ce service ne peut pas etre pilote depuis KingdomWeb.")
        if operation not in {"start", "stop", "restart"}:
            raise ValueError("Operation de service inconnue.")
        # Les routes FastAPI synchrones peuvent s'exécuter en parallèle. Deux clics
        # ne doivent jamais lancer ou arrêter simultanément la même identité Discord.
        with self._control_lock:
            if operation in {"stop", "restart"}:
                self._stop(service_key)
            if operation in {"start", "restart"}:
                self._start(definition)
            return next(item for item in self.statuses() if item["key"] == service_key)

    def logs(self, limit: int = 120) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for definition in self.definitions():
            output = self._tail(LOGS_DIR / f"{definition['key']}.out.log", limit)
            errors = self._tail(LOGS_DIR / f"{definition['key']}.err.log", limit)
            result[definition["key"]] = {"output": output, "errors": errors}
        return result

    def _start(self, definition: dict[str, Any]) -> None:
        status = next(item for item in self.statuses() if item["key"] == definition["key"])
        if status["running"]:
            if definition["key"] != "web":
                raise ValueError(f"{definition['name']} est deja demarre.")
            return
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        child_environment = os.environ.copy()
        child_environment.update({"PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
        with (LOGS_DIR / f"{definition['key']}.out.log").open("a", encoding="utf-8") as output, (LOGS_DIR / f"{definition['key']}.err.log").open("a", encoding="utf-8") as errors:
            process = subprocess.Popen(
                [sys.executable, str(ROOT / "run.py"), definition["module"]],
                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=errors,
                creationflags=flags, env=child_environment,
            )
        registry = [item for item in self._registry() if item.get("service") != definition["key"]]
        registry.append({"service": definition["key"], "Id": process.pid, "ProcessName": "python", "StartTime": datetime.now(timezone.utc).isoformat()})
        self._write_registry(registry)
        if not self._wait_for_process(process.pid, alive=True, timeout=5):
            self._remove_runtime_pid(definition["key"])
            self._write_registry([item for item in self._registry() if item.get("service") != definition["key"]])
            raise ValueError(f"{definition['name']} n'a pas réussi à démarrer. Consultez son journal d'erreurs.")

    def _stop(self, service_key: str) -> None:
        registry = self._registry()
        entry = next((item for item in registry if item.get("service") == service_key), None)
        pid = self._runtime_pid(service_key, entry)
        if not pid:
            self._remove_runtime_pid(service_key)
            self._write_registry([item for item in registry if item.get("service") != service_key])
            return
        self._terminate_process_tree(pid)
        if not self._wait_for_process(pid, alive=False, timeout=8):
            raise ValueError("Le service ne répond pas à l'arrêt. Consultez les journaux puis réessayez.")
        self._remove_runtime_pid(service_key)
        self._write_registry([item for item in registry if item.get("service") != service_key])

    def _terminate_process_tree(self, pid: int) -> None:
        """Arrête le runtime et ses éventuels enfants audio, sans toucher aux autres bots."""
        if sys.platform == "win32":
            result = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True, text=True, check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode and self._alive(pid):
                raise ValueError("Windows n'a pas pu arrêter le processus du service.")
            return
        try:
            os.kill(pid, 15)
        except ProcessLookupError:
            return

    def _wait_for_process(self, pid: int, *, alive: bool, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._alive(pid) is alive:
                return True
            time.sleep(0.1)
        return self._alive(pid) is alive

    @staticmethod
    def _remove_runtime_pid(service_key: str) -> None:
        try:
            (ROOT / "var" / f"{service_key}.pid").unlink(missing_ok=True)
        except OSError:
            pass

    def _runtime_pid(self, service_key: str, registry_entry: dict[str, Any] | None = None) -> int:
        """Retourne le PID réel publié par le service, puis le PID historique en secours."""
        pid_path = ROOT / "var" / f"{service_key}.pid"
        try:
            pid = int(pid_path.read_text(encoding="ascii").strip())
            if self._alive(pid):
                return pid
        except (OSError, ValueError):
            pass
        fallback = int(registry_entry.get("Id", 0)) if registry_entry else 0
        return fallback if self._alive(fallback) else 0

    def _registry(self) -> list[dict[str, Any]]:
        if not PID_REGISTRY.exists():
            return []
        try:
            data = json.loads(PID_REGISTRY.read_text(encoding="utf-8-sig"))
            entries = data if isinstance(data, list) else [data]
        except (json.JSONDecodeError, OSError):
            return []
        legacy_services = ["web", "core", "voice"]
        for index, entry in enumerate(entries):
            if "service" not in entry and index < len(legacy_services):
                entry["service"] = legacy_services[index]
        return entries

    @staticmethod
    def _alive(pid: int) -> bool:
        if not pid:
            return False
        if sys.platform == "win32":
            import ctypes
            process_query_limited_information = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, pid)
            if not handle:
                return False
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        try:
            os.kill(pid, 0)
            return True
        except (OSError, PermissionError):
            return False

    @staticmethod
    def _write_registry(entries: list[dict[str, Any]]) -> None:
        PID_REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        PID_REGISTRY.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def _tail(path: Path, limit: int) -> list[str]:
        if not path.exists():
            return []
        try:
            return path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]
        except OSError:
            return []


class AdministrationService:
    def __init__(self, store: ContentStore, supervisor: ServiceSupervisor | None = None) -> None:
        self.store, self.supervisor = store, supervisor or ServiceSupervisor()

    def overview(self) -> dict[str, Any]:
        item_catalog = ItemCatalogService(self.store).catalog()
        item_by_id = {item["id"]: item for item in item_catalog["items"]}
        with self.store.connection() as db:
            player_rows = db.execute("SELECT discord_id,display_name,avatar_url,money,energy,updated_at FROM players ORDER BY updated_at DESC").fetchall()
            inventories = db.execute("SELECT discord_id,item_key,quantity FROM inventory WHERE quantity>0 ORDER BY item_key").fetchall()
            professions = db.execute("SELECT discord_id,profession_key,level,experience FROM player_professions WHERE active=1 ORDER BY profession_key").fetchall()
            stocks = db.execute("SELECT building_key,item_key,quantity FROM building_stock WHERE quantity>0 ORDER BY building_key,item_key").fetchall()
            pending = db.execute("SELECT building_key,COUNT(*) count FROM scheduled_actions WHERE status='pending' GROUP BY building_key").fetchall()
            activity = db.execute("SELECT discord_id,building_key,action_key,created_at FROM action_log ORDER BY id DESC LIMIT 30").fetchall()
            contribution_rows = db.execute("SELECT objective_key,resource_key,SUM(amount) amount FROM collective_contributions GROUP BY objective_key,resource_key").fetchall()
        inventory_by_player: dict[str, dict[str, int]] = {}
        for row in inventories:
            inventory_by_player.setdefault(str(row[0]), {})[str(row[1])] = int(row[2])
        profession_by_player: dict[str, list[dict[str, Any]]] = {}
        for row in professions:
            profession_by_player.setdefault(str(row[0]), []).append({"key": row[1], "level": int(row[2]), "experience": int(row[3])})
        stock_by_building: dict[str, dict[str, int]] = {}
        for row in stocks:
            stock_by_building.setdefault(str(row[0]), {})[str(row[1])] = int(row[2])
        pending_by_building = {str(row[0]): int(row[1]) for row in pending}
        buildings = []
        building_names: dict[str, str] = {}
        action_names: dict[tuple[str, str], str] = {}
        projects: list[dict[str, Any]] = []
        contributions = {(str(row[0]), str(row[1])): int(row[2]) for row in contribution_rows}
        for entity in self.store.list("building"):
            payload = entity["payload"]
            actions = actions_from_modules(entity["entity_key"], payload.get("modules", {})) if payload.get("action_mode") == "generated" else payload.get("actions", [])
            building_names[entity["entity_key"]] = str(payload.get("name", entity["entity_key"]))
            for action in actions:
                action_names[(entity["entity_key"], str(action.get("key", "")))] = str(action.get("name") or action.get("key", "Action"))
            building_stock = stock_by_building.get(entity["entity_key"], {})
            stock_entries = [{"id": key, "quantity": quantity, **{field: item_by_id.get(key, {}).get(field, fallback) for field, fallback in (("name", "Objet inconnu"), ("emoji", "⚠️"), ("category", "missing"))}, "missing": key not in item_by_id} for key, quantity in building_stock.items()]
            buildings.append({
                "key": entity["entity_key"], "name": payload["name"], "emoji": payload.get("emoji", "🏰"),
                "status": entity["status"], "version": entity["version"], "actions": len(actions),
                "pages": self._interface_pages(payload), "pending": pending_by_building.get(entity["entity_key"], 0),
                "stock_total": sum(building_stock.values()), "stock": stock_entries,
            })
            construction = payload.get("modules", {}).get("construction", {})
            stages = []
            for stage in construction.get("stages", []):
                requirements = []
                for requirement in stage.get("requirements", []):
                    required = int(requirement.get("quantity", 0))
                    current = contributions.get((str(stage.get("key")), str(requirement.get("key"))), 0)
                    requirements.append({"key": requirement.get("key"), "name": requirement.get("name", str(requirement.get("key", "")).replace("_", " ").title()), "emoji": requirement.get("emoji", "📦"), "current": current, "required": required})
                stages.append({"key": stage.get("key"), "name": stage.get("name", stage.get("key", "Étape")), "requirements": requirements, "complete": bool(requirements) and all(item["current"] >= item["required"] for item in requirements)})
            if stages:
                total = sum(item["required"] for stage in stages for item in stage["requirements"])
                done = sum(min(item["current"], item["required"]) for stage in stages for item in stage["requirements"])
                projects.append({"key": entity["entity_key"], "name": payload.get("name", entity["entity_key"]), "emoji": payload.get("emoji", "🏗️"), "description": payload.get("description", ""), "progress": round(done * 100 / total) if total else 0, "stages": stages})
        players = [{
            "discord_id": str(row[0]), "display_name": row[1] or str(row[0]), "avatar_url": row[2] or "", "money": int(row[3]), "energy": int(row[4]), "updated_at": row[5],
            "inventory": inventory_by_player.get(str(row[0]), {}), "professions": profession_by_player.get(str(row[0]), []),
        } for row in player_rows]
        richest = sorted(players, key=lambda player: player["money"], reverse=True)[:5]
        experienced = sorted(players, key=lambda player: sum(job["experience"] for job in player["professions"]), reverse=True)[:5]
        readable_activity = []
        player_names = {player["discord_id"]: player["display_name"] for player in players}
        for row in activity:
            item = dict(row)
            item["player_name"] = player_names.get(str(item["discord_id"]), str(item["discord_id"]))
            item["building_name"] = building_names.get(str(item["building_key"]), str(item["building_key"]).replace("_", " ").title())
            action_key = str(item["action_key"])
            fallback = action_key.replace("_", " ").capitalize()
            if action_key == "delivery": fallback = "Livraison de ressources"
            elif action_key.startswith("deliver_"): fallback = f"Livraison de {action_key.removeprefix('deliver_').replace('_', ' ')}"
            elif action_key.startswith("claim_"): fallback = f"Récupération : {action_key.removeprefix('claim_').replace('_', ' ')}"
            item["action_name"] = action_names.get((str(item["building_key"]), action_key), fallback)
            readable_activity.append(item)
        events = [{
            "key": entity["entity_key"], "name": entity["payload"]["name"],
            "emoji": entity["payload"].get("emoji", "⚡"), "status": entity["status"],
            "enabled": entity["payload"].get("enabled", True),
            "trigger": entity["payload"].get("trigger", {}).get("type", "manual"),
            "starts_at": entity["payload"].get("starts_at"), "ends_at": entity["payload"].get("ends_at"),
        } for entity in self.store.list("event")]
        services = self.supervisor.statuses()
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "services": services, "buildings": buildings, "players": players, "events": events, "item_catalog": item_catalog,
            "activity": readable_activity,
            "rankings": {"wealth": richest, "experience": experienced},
            "projects": projects,
            "changes": self.store.changes(max(0, self._last_change_id() - 30), 30),
            "logs": self.supervisor.logs(),
            "metrics": {
                "players": len(players), "buildings": len(buildings),
                "published_buildings": sum(item["status"] == "published" for item in buildings),
                "pending_jobs": sum(item["pending"] for item in buildings),
                "running_services": sum(item["running"] for item in services),
                "active_events": sum(item["status"] == "published" and item["enabled"] for item in events),
            },
            "database": {"path": str(self.store.path), "size_bytes": self.store.path.stat().st_size if self.store.path.exists() else 0},
        }

    def _interface_pages(self, payload: dict[str, Any]) -> int:
        if payload.get("interface"):
            return len(payload["interface"].get("pages", []))
        interface_key = payload.get("interface_key")
        if not interface_key:
            return 0
        try:
            return len(self.store.get("interface", interface_key)["payload"].get("pages", []))
        except Exception:
            return 0

    def _last_change_id(self) -> int:
        with self.store.connection() as db:
            return int(db.execute("SELECT COALESCE(MAX(id),0) FROM outbox").fetchone()[0])
