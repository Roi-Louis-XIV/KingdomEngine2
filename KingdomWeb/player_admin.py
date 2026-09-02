"""Service transactionnel de supervision des joueurs, indépendant de Discord."""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from typing import Any

from kingdomCore.engine import GameEngine
from KingdomData import ContentStore, NotFoundError, ValidationError


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PlayerAdministrationService:
    """Centralise les lectures et corrections administratives auditables."""

    def __init__(self, store: ContentStore) -> None:
        self.store = store

    def catalogs(self) -> dict[str, Any]:
        items = []
        for entity in self.store.list("item"):
            payload = entity["payload"]
            items.append({"key": entity["entity_key"], "name": payload.get("name", entity["entity_key"]), "emoji": payload.get("emoji", "📦"), "category": payload.get("category", payload.get("type", "other")), "type": payload.get("type", payload.get("category", "other")), "consumable": bool(payload.get("consumable")), "description": payload.get("description", "")})
        professions: dict[str, dict[str, Any]] = {}
        for entity in self.store.list("building"):
            for profession in entity["payload"].get("modules", {}).get("professions", []):
                key = str(profession.get("key", ""))
                if key:
                    professions[key] = {"key": key, "name": profession.get("name", key.replace("_", " ").title()), "emoji": profession.get("emoji", "🛠️"), "experience_per_level": max(1, int(profession.get("experience_per_level", 100)))}
        return {"items": sorted(items, key=lambda x: x["name"].casefold()), "professions": sorted(professions.values(), key=lambda x: x["name"].casefold())}

    def list_players(self, search: str = "", profession: str = "", status: str = "", sort: str = "recent", page: int = 1, page_size: int = 25) -> dict[str, Any]:
        page, page_size = max(1, page), min(100, max(1, page_size))
        clauses, args = ["1=1"], []
        if search.strip():
            clauses.append("(LOWER(p.display_name) LIKE ? OR p.discord_id LIKE ?)"); value = f"%{search.strip().lower()}%"; args += [value, value]
        if profession:
            clauses.append("EXISTS(SELECT 1 FROM player_professions pp WHERE pp.discord_id=p.discord_id AND pp.active=1 AND pp.profession_key=?)"); args.append(profession)
        if status == "without_profession": clauses.append("NOT EXISTS(SELECT 1 FROM player_professions pp WHERE pp.discord_id=p.discord_id AND pp.active=1)")
        if status == "active_activity": clauses.append("EXISTS(SELECT 1 FROM scheduled_actions sa WHERE sa.discord_id=p.discord_id AND sa.status='pending')")
        if status == "damaged_tool": clauses.append("EXISTS(SELECT 1 FROM player_tools pt WHERE pt.discord_id=p.discord_id AND pt.durability<pt.max_durability)")
        if status == "recent": clauses.append("p.updated_at>=datetime('now','-1 day')")
        if status == "online": clauses.append("EXISTS(SELECT 1 FROM player_presence pr WHERE pr.discord_id=p.discord_id AND pr.online=1)")
        if status == "offline": clauses.append("NOT EXISTS(SELECT 1 FROM player_presence pr WHERE pr.discord_id=p.discord_id AND pr.online=1)")
        order = {"name": "p.display_name COLLATE NOCASE,p.discord_id", "money": "p.money DESC", "energy": "p.energy DESC", "recent": "p.updated_at DESC"}.get(sort, "p.updated_at DESC")
        where = " AND ".join(clauses)
        with self.store.connection() as db:
            total = int(db.execute(f"SELECT COUNT(*) FROM players p WHERE {where}", args).fetchone()[0])
            rows = db.execute(f"""SELECT p.*,pp.profession_key,pp.level,pp.experience,
                EXISTS(SELECT 1 FROM scheduled_actions sa WHERE sa.discord_id=p.discord_id AND sa.status='pending') has_activity,
                EXISTS(SELECT 1 FROM player_tools pt WHERE pt.discord_id=p.discord_id AND pt.durability<pt.max_durability) damaged_tool
                FROM players p LEFT JOIN player_professions pp ON pp.discord_id=p.discord_id AND pp.active=1
                WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?""", [*args, page_size, (page-1)*page_size]).fetchall()
            metrics = {
                "players": int(db.execute("SELECT COUNT(*) FROM players").fetchone()[0]),
                "with_profession": int(db.execute("SELECT COUNT(DISTINCT discord_id) FROM player_professions WHERE active=1").fetchone()[0]),
                "active_activities": int(db.execute("SELECT COUNT(*) FROM scheduled_actions WHERE status='pending'").fetchone()[0]),
                "recent": int(db.execute("SELECT COUNT(*) FROM players WHERE updated_at>=datetime('now','-1 day')").fetchone()[0]),
            }
            player_ids = [str(row["discord_id"]) for row in rows]
            snapshot = self._snapshot_rows(db, player_ids)
        return {"players": [{**dict(row), **snapshot.get(str(row["discord_id"]), {})} for row in rows], "total": total, "page": page, "pages": max(1, math.ceil(total/page_size)), "metrics": metrics, "catalogs": self.catalogs(), "generated_at": _now()}

    def _snapshot_rows(self, db, player_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not player_ids: return {}
        placeholders = ",".join("?" for _ in player_ids)
        catalogs = self.catalogs(); item_map = {item["key"]: item for item in catalogs["items"]}; profession_map = {job["key"]: job for job in catalogs["professions"]}
        buildings = {entity["entity_key"]: entity["payload"] for entity in self.store.list("building")}
        result = {player_id: {"online": False, "location": "Aucun salon vocal", "building_key": "", "current_activity": None, "professions": [], "inventory": [], "inventory_total": 0, "condition": "Normal"} for player_id in player_ids}
        for row in db.execute(f"SELECT * FROM player_presence WHERE discord_id IN ({placeholders})", player_ids):
            target=result[str(row["discord_id"])];target.update({"online":bool(row["online"]),"location":row["voice_channel_name"] or "Aucun salon vocal","building_key":row["building_key"],"presence_updated_at":row["updated_at"]})
        for row in db.execute(f"SELECT discord_id,profession_key,level,experience,active FROM player_professions WHERE discord_id IN ({placeholders}) ORDER BY active DESC,profession_key", player_ids):
            job={**dict(row),**profession_map.get(str(row["profession_key"]),{"name":str(row["profession_key"]).replace("_"," ").title(),"emoji":"🛠️","experience_per_level":100})};result[str(row["discord_id"])]["professions"].append(job)
        tool_rows={}
        for row in db.execute(f"SELECT discord_id,tool_key,durability,max_durability,level,loot_bonus FROM player_tools WHERE discord_id IN ({placeholders})", player_ids): tool_rows[(str(row["discord_id"]),str(row["tool_key"]))]=dict(row)
        inventory_keys=set()
        for row in db.execute(f"SELECT discord_id,item_key,quantity FROM inventory WHERE discord_id IN ({placeholders}) AND quantity>0", player_ids):
            player_id,key=str(row["discord_id"]),str(row["item_key"]);inventory_keys.add((player_id,key));item=item_map.get(key,{"key":key,"name":"Objet inconnu","emoji":"⚠️","category":"missing","type":"missing","missing":True});tool=tool_rows.get((player_id,key));entry={**item,"item_key":key,"quantity":int(row["quantity"]),"tool_state":tool};result[player_id]["inventory"].append(entry);result[player_id]["inventory_total"]+=int(row["quantity"])
        # Tolérance avant migration : un ancien état d'outil reste affiché une
        # seule fois dans l'inventaire unifié.
        for (player_id,key),tool in tool_rows.items():
            if (player_id,key) in inventory_keys: continue
            item=item_map.get(key,{"key":key,"name":"Objet inconnu","emoji":"⚠️","category":"missing","type":"missing","missing":True});result[player_id]["inventory"].append({**item,"item_key":key,"quantity":1,"tool_state":tool});result[player_id]["inventory_total"]+=1
        def rank(entry):
            if entry.get("tool_state"): return (0,entry["name"].casefold())
            if entry.get("consumable"): return (1,entry["name"].casefold())
            value=f"{entry.get('category','')} {entry.get('type','')}".casefold()
            return (2 if any(word in value for word in ("resource","ressource","ingredient")) else 3,entry["name"].casefold())
        for target in result.values(): target["inventory"].sort(key=rank)
        now=time.time()
        for row in db.execute(f"SELECT id,discord_id,building_key,action_key,category,ready_at,created_at,status FROM scheduled_actions WHERE discord_id IN ({placeholders}) AND status='pending' ORDER BY id DESC", player_ids):
            target=result[str(row["discord_id"])]
            if target["current_activity"] is None:
                building=buildings.get(str(row["building_key"]),{});action=next((x for x in building.get("actions",[]) if x.get("key")==row["action_key"]),{})
                target["current_activity"]={**dict(row),"building_name":building.get("name",row["building_key"]),"action_name":action.get("name",row["action_key"]),"remaining_seconds":max(0,int(float(row["ready_at"])-now))}
        return result

    def player(self, player_id: str) -> dict[str, Any]:
        catalogs = self.catalogs(); items = {x["key"]: x for x in catalogs["items"]}; professions = {x["key"]: x for x in catalogs["professions"]}
        with self.store.connection() as db:
            player = db.execute("SELECT * FROM players WHERE discord_id=?", (player_id,)).fetchone()
            if not player: raise NotFoundError("Joueur introuvable.")
            inventory = [{**dict(row), **items.get(str(row["item_key"]), {"name": "Objet inconnu", "emoji": "⚠️", "category": "missing", "missing": True})} for row in db.execute("SELECT item_key,quantity FROM inventory WHERE discord_id=? AND quantity>0 ORDER BY item_key", (player_id,))]
            jobs = [{**dict(row), **professions.get(str(row["profession_key"]), {"name": row["profession_key"], "experience_per_level": 100})} for row in db.execute("SELECT profession_key,level,experience,active FROM player_professions WHERE discord_id=? ORDER BY active DESC,profession_key", (player_id,))]
            tools = [{**dict(row), **items.get(str(row["tool_key"]), {"name": "Objet inconnu", "emoji": "⚠️", "missing": True})} for row in db.execute("SELECT * FROM player_tools WHERE discord_id=? ORDER BY tool_key", (player_id,))]
            activities = [dict(row) for row in db.execute("SELECT id,building_key,action_key,category,ready_at,status,created_at,completed_at,result_json FROM scheduled_actions WHERE discord_id=? ORDER BY id DESC", (player_id,))]
            cooldowns = [dict(row) for row in db.execute("SELECT * FROM action_cooldowns WHERE scope=? OR scope LIKE ? ORDER BY ready_at DESC", (player_id, f"{player_id}:%"))]
            actions = [dict(row) for row in db.execute("SELECT building_key,action_key,result_json,created_at FROM action_log WHERE discord_id=? ORDER BY id DESC LIMIT 100", (player_id,))]
            deliveries = [dict(row) for row in db.execute("SELECT source_building building_key,'delivery' action_key,total_payment,resource_key,quantity,created_at FROM delivery_log WHERE discord_id=? ORDER BY id DESC LIMIT 100", (player_id,))]
            audits = [dict(row) for row in db.execute("SELECT * FROM admin_audit_log WHERE player_id=? ORDER BY id DESC LIMIT 100", (player_id,))]
            states = [{"key": row[0], "value": json.loads(row[1])} for row in db.execute("SELECT state_key,value_json FROM player_state WHERE discord_id=? ORDER BY state_key", (player_id,))]
        return {"player": dict(player), "inventory": inventory, "professions": jobs, "tools": tools, "activities": activities, "cooldowns": cooldowns, "states": states, "history": {"actions": actions, "deliveries": deliveries, "administration": audits}, "catalogs": catalogs}

    @staticmethod
    def _reason(body: dict[str, Any]) -> str:
        reason = str(body.get("reason", "")).strip()
        if len(reason) < 3: raise ValidationError("Un motif administratif d’au moins 3 caractères est obligatoire.")
        return reason

    @staticmethod
    def _apply(current: int, operation: str, amount: int) -> int:
        if amount < 0: raise ValidationError("La valeur doit être positive.")
        if operation == "add": return current + amount
        if operation == "remove": return current - amount
        if operation == "set": return amount
        raise ValidationError("Opération inconnue.")

    def _transaction(self, player_id: str, admin_id: str, action: str, target: str, reason: str, callback) -> dict[str, Any]:
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM players WHERE discord_id=?", (player_id,)).fetchone(): raise NotFoundError("Joueur introuvable.")
            old, new = callback(db)
            db.execute("UPDATE players SET updated_at=? WHERE discord_id=?", (_now(), player_id))
            db.execute("INSERT INTO admin_audit_log(admin_id,player_id,action,target,old_value_json,new_value_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?)", (admin_id, player_id, action, target, json.dumps(old, ensure_ascii=False), json.dumps(new, ensure_ascii=False), reason, _now()))
        return {"ok": True, "old_value": old, "new_value": new}

    def resource(self, player_id: str, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        target, operation, amount, reason = str(body.get("resource")), str(body.get("operation")), int(body.get("amount", 0)), self._reason(body)
        if target not in {"money", "energy"}: raise ValidationError("Jauge joueur inconnue.")
        def change(db):
            current = int(db.execute(f"SELECT {target} FROM players WHERE discord_id=?", (player_id,)).fetchone()[0]); new = self._apply(current, operation, amount)
            if new < 0: raise ValidationError("Cette valeur ne peut pas devenir négative.")
            db.execute(f"UPDATE players SET {target}=? WHERE discord_id=?", (new, player_id)); return current, new
        return self._transaction(player_id, admin_id, f"resource.{operation}", target, reason, change)

    def inventory(self, player_id: str, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        item, operation, amount, reason = str(body.get("item_key")), str(body.get("operation")), int(body.get("amount", 0)), self._reason(body)
        known_item = item in {x["key"] for x in self.catalogs()["items"]}
        if not known_item and operation == "add": raise ValidationError("Impossible d’ajouter un objet inconnu.")
        def change(db):
            row=db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?",(player_id,item)).fetchone(); current=int(row[0]) if row else 0; new=0 if not known_item and operation=="remove" else self._apply(current,operation,amount)
            if not known_item and not row: raise ValidationError("Cette référence manquante n’existe pas dans l’inventaire du joueur.")
            if not known_item and new != 0: raise ValidationError("Une référence manquante doit être retirée entièrement ou définie à zéro.")
            if new<0: raise ValidationError("La quantité ne peut pas devenir négative.")
            if new: db.execute("INSERT INTO inventory VALUES(?,?,?) ON CONFLICT(discord_id,item_key) DO UPDATE SET quantity=excluded.quantity",(player_id,item,new))
            else:
                db.execute("DELETE FROM inventory WHERE discord_id=? AND item_key=?",(player_id,item))
                db.execute("DELETE FROM player_tools WHERE discord_id=? AND tool_key=?",(player_id,item))
            return current,new
        return self._transaction(player_id,admin_id,f"inventory.{operation}",item,reason,change)

    def profession(self, player_id: str, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        key, operation, reason = str(body.get("profession_key")), str(body.get("operation")), self._reason(body)
        catalog = next((x for x in self.catalogs()["professions"] if x["key"]==key), None)
        if not catalog: raise ValidationError("Métier inconnu.")
        def change(db):
            row=db.execute("SELECT level,experience,active FROM player_professions WHERE discord_id=? AND profession_key=?",(player_id,key)).fetchone(); old=dict(row) if row else None
            if operation=="join": GameEngine._join_profession(db,player_id,key,True)
            elif operation=="leave": GameEngine._leave_profession(db,player_id,key,False)
            elif operation in {"set_xp","add_xp"}:
                xp=int(body.get("experience",0)); current=int(row["experience"]) if row else 0; total=xp if operation=="set_xp" else current+xp
                if total<0: raise ValidationError("L’expérience ne peut pas être négative.")
                db.execute("INSERT INTO player_professions(discord_id,profession_key,level,experience,active) VALUES(?,?,?,?,1) ON CONFLICT(discord_id,profession_key) DO UPDATE SET level=excluded.level,experience=excluded.experience",(player_id,key,max(1,total//catalog["experience_per_level"]+1),total))
            else: raise ValidationError("Opération de métier inconnue.")
            new=db.execute("SELECT level,experience,active FROM player_professions WHERE discord_id=? AND profession_key=?",(player_id,key)).fetchone(); return old,dict(new)
        return self._transaction(player_id,admin_id,f"profession.{operation}",key,reason,change)

    def tool(self, player_id: str, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        key, operation, reason = str(body.get("tool_key")), str(body.get("operation")), self._reason(body)
        if key not in {x["key"] for x in self.catalogs()["items"]}: raise ValidationError("Outil inconnu.")
        def change(db):
            row=db.execute("SELECT durability,max_durability,level,loot_bonus FROM player_tools WHERE discord_id=? AND tool_key=?",(player_id,key)).fetchone(); old=dict(row) if row else None
            if operation=="grant":
                maximum=max(1,int(body.get("max_durability",100))); db.execute("INSERT INTO player_tools VALUES(?,?,?,?,?,?) ON CONFLICT(discord_id,tool_key) DO UPDATE SET durability=excluded.durability,max_durability=excluded.max_durability,level=excluded.level,loot_bonus=excluded.loot_bonus",(player_id,key,maximum,maximum,max(1,int(body.get("level",1))),int(body.get("loot_bonus",0))));db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES(?,?,1) ON CONFLICT(discord_id,item_key) DO UPDATE SET quantity=MAX(quantity,1)",(player_id,key))
            elif not row: raise ValidationError("Le joueur ne possède pas cet outil.")
            elif operation=="remove": db.execute("DELETE FROM player_tools WHERE discord_id=? AND tool_key=?",(player_id,key));db.execute("DELETE FROM inventory WHERE discord_id=? AND item_key=?",(player_id,key))
            elif operation=="repair": db.execute("UPDATE player_tools SET durability=max_durability WHERE discord_id=? AND tool_key=?",(player_id,key))
            elif operation=="update":
                maximum=max(1,int(body.get("max_durability",row["max_durability"]))); durability=int(body.get("durability",row["durability"]))
                if not 0<=durability<=maximum: raise ValidationError("La durabilité doit rester entre 0 et son maximum.")
                db.execute("UPDATE player_tools SET durability=?,max_durability=?,level=?,loot_bonus=? WHERE discord_id=? AND tool_key=?",(durability,maximum,max(1,int(body.get("level",row["level"]))),int(body.get("loot_bonus",row["loot_bonus"])),player_id,key))
            else: raise ValidationError("Opération d’outil inconnue.")
            new=db.execute("SELECT durability,max_durability,level,loot_bonus FROM player_tools WHERE discord_id=? AND tool_key=?",(player_id,key)).fetchone(); return old,dict(new) if new else None
        return self._transaction(player_id,admin_id,f"tool.{operation}",key,reason,change)

    def activity(self, player_id: str, activity_id: int, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        operation, reason = str(body.get("operation")), self._reason(body)
        def change(db):
            row=db.execute("SELECT id,status,ready_at,building_key,action_key FROM scheduled_actions WHERE id=? AND discord_id=?",(activity_id,player_id)).fetchone()
            if not row: raise NotFoundError("Activité introuvable.")
            old=dict(row)
            if operation=="cancel": db.execute("UPDATE scheduled_actions SET status='cancelled',completed_at=? WHERE id=?",(_now(),activity_id))
            elif operation=="finish": db.execute("UPDATE scheduled_actions SET ready_at=? WHERE id=?",(time.time()-1,activity_id))
            else: raise ValidationError("Opération d’activité inconnue.")
            new=dict(db.execute("SELECT id,status,ready_at,building_key,action_key FROM scheduled_actions WHERE id=?",(activity_id,)).fetchone()); return old,new
        return self._transaction(player_id,admin_id,f"activity.{operation}",str(activity_id),reason,change)

    def reset_cooldown(self, player_id: str, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        building, action, reason = str(body.get("building_key")), str(body.get("action_key")), self._reason(body)
        def change(db):
            rows=[dict(x) for x in db.execute("SELECT * FROM action_cooldowns WHERE (scope=? OR scope LIKE ?) AND building_key=? AND action_key=?",(player_id,f"{player_id}:%",building,action))]
            db.execute("DELETE FROM action_cooldowns WHERE (scope=? OR scope LIKE ?) AND building_key=? AND action_key=?",(player_id,f"{player_id}:%",building,action)); return rows,[]
        return self._transaction(player_id,admin_id,"cooldown.reset",f"{building}/{action}",reason,change)
