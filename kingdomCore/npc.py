"""PNJ du monde, réactions contextuelles et mémoire explicable."""
from __future__ import annotations
import json, random, time
from datetime import datetime,timezone
from typing import Any
from kingdomCore.world import WorldEngine
from kingdomEvent.lifecycle import EventLifecycle
from kingdomEvent.runtime import WorldClock

def _now(): return datetime.now(timezone.utc).isoformat()

class NpcError(ValueError): pass

class NpcEngine:
    def __init__(self,store): self.store=store
    def get(self,key):
        row=self.store.get("npc",key,published=True); return {"key":key,**row["payload"]}
    def move(self,key,*,location_key:str="",building_key:str=""):
        current=self.store.get("npc",key); payload={**current["payload"],"location_key":location_key,"building_key":building_key}
        draft=self.store.save("npc",key,payload,"npc-move",current["version"]); return self.store.publish("npc",key,draft["version"],"npc-move")
    def context(self,npc_key,player_id,extra=None):
        npc=self.get(npc_key); world=WorldClock(self.store).state(); player=WorldEngine(self.store).player_state(player_id); memory=self.memory(npc_key,player_id)
        return {"period":world["time_of_day"],"hour":world["hour"],"weather":world["weather"].get("key"),"season":(world.get("season") or {}).get("key"),"events":[e["key"] for e in world["active_events"]],"location_key":npc.get("location_key") or player.get("location_key"),"building_key":npc.get("building_key") or player.get("active_building_key"),"npc_met":bool(memory.get("npc_met")),"memory":memory,"player":player,**(extra or {})}
    def react(self,npc_key,player_id,trigger="talk",extra=None):
        npc=self.get(npc_key); context=self.context(npc_key,player_id,extra); candidates=[]
        for index,reaction in enumerate(npc.get("reactions",[])):
            if reaction.get("trigger","talk")!=trigger or not self._conditions(reaction.get("conditions",[]),context,player_id):continue
            candidates.append((int(reaction.get("priority",0)),str(reaction.get("key",index)),reaction))
        if not candidates: raise NpcError("Aucune réaction ne correspond à ce contexte.")
        reaction=max(candidates,key=lambda row:(row[0],row[1]))[2]; variants=list(reaction.get("variants") or [])
        if not variants: raise NpcError("Cette réaction ne contient aucune variante.")
        memory=self.memory(npc_key,player_id); previous=memory.get(f"last_variant:{reaction.get('key','reaction')}"); available=[v for v in variants if str(v.get("key"))!=previous] or variants
        if reaction.get("variant_mode")=="sequential":
            previous_index=next((i for i,v in enumerate(variants) if str(v.get("key"))==previous),-1); variant=variants[(previous_index+1)%len(variants)]
        else: variant=random.Random(f"{npc_key}:{player_id}:{reaction.get('key')}:{int(time.time())}").choice(available)
        self.set_memory(npc_key,player_id,"npc_met",True); self.set_memory(npc_key,player_id,f"last_variant:{reaction.get('key','reaction')}",str(variant.get("key","")))
        voice=self.voice_agent(npc); audio_key=str(variant.get("audio_key", ""))
        if audio_key and voice.get("bot_key") and voice.get("building_key"):
            with self.store.connection() as db:self.store.queue_audio(db,"play",voice["building_key"],audio_key=audio_key,bot_key=voice["bot_key"],context={"source":"npc","npc_key":npc_key,"reaction_key":reaction.get("key"),"text":variant.get("text","")})
        return {"npc":{"key":npc_key,"name":npc.get("name")},"reaction_key":reaction.get("key"),"variant":variant,"context":context,"voice_agent":voice}
    def _conditions(self,conditions,context,player_id):
        for c in conditions or []:
            kind,value=c.get("type"),c.get("value",c.get("key")); invert=bool(c.get("not")); actual=False
            if kind in {"period","weather","season","location","building"}:actual=context.get({"location":"location_key","building":"building_key"}.get(kind,kind))==value
            elif kind=="event_active":actual=value in context["events"]
            elif kind in {"first_meeting","npc_met"}:actual=bool(context["npc_met"])==(kind=="npc_met")
            elif kind=="memory":actual=context["memory"].get(str(c.get("key")))==c.get("value")
            elif kind=="tag":actual=value in context.get("tags",[])
            elif kind=="item":
                with self.store.connection() as db:actual=bool(db.execute("SELECT 1 FROM inventory WHERE discord_id=? AND item_key=? AND quantity>=?",(str(player_id),str(value),int(c.get("quantity",1)))).fetchone())
            elif kind=="profession":
                with self.store.connection() as db:actual=bool(db.execute("SELECT 1 FROM player_professions WHERE discord_id=? AND profession_key=? AND active=1",(str(player_id),str(value))).fetchone())
            elif kind=="location_discovered":actual=value in context["player"].get("discovered_locations",[])
            elif kind=="route_discovered":actual=value in context["player"].get("discovered_routes",[])
            if actual==invert:return False
        return True
    def memory(self,npc_key,player_id):
        with self.store.connection() as db:rows=db.execute("SELECT memory_key,value_json FROM npc_player_memory WHERE npc_key=? AND discord_id=?",(npc_key,str(player_id))).fetchall()
        return {row["memory_key"]:json.loads(row["value_json"]) for row in rows}
    def set_memory(self,npc_key,player_id,key,value):
        with self.store.connection() as db:
            if not db.execute("SELECT 1 FROM players WHERE discord_id=?",(str(player_id),)).fetchone():db.execute("INSERT INTO players(discord_id,updated_at,created_at) VALUES(?,?,?)",(str(player_id),_now(),_now()))
            db.execute("INSERT INTO npc_player_memory(npc_key,discord_id,memory_key,value_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(npc_key,discord_id,memory_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",(npc_key,str(player_id),key,json.dumps(value,ensure_ascii=False),_now()))
    def voice_agent(self,npc):
        building_key=str(npc.get("building_key", "")); location_key=str(npc.get("location_key", ""))
        if not building_key and location_key:
            matches=[row for row in self.store.list("building",published=True) if row["payload"].get("location_key")==location_key]
            if len(matches)==1:building_key=matches[0]["entity_key"]
        bots=[row for row in self.store.list("bot",published=True) if row["payload"].get("bot_type")=="voice" and row["payload"].get("building_key")==building_key and row["payload"].get("enabled")]
        channels=self.store.building_channels(building_key) if building_key else {}; bot=bots[0] if bots else None
        return {"bot_key":bot["entity_key"] if bot else None,"bot_name":bot["payload"].get("name") if bot else None,"building_key":building_key or None,"voice_channel_id":channels.get("voice_channel_id"),"configured":bool(bot),"consistent":bool(bot and channels.get("voice_channel_id"))}

    def dialogue(self,npc_key,player_id,node_key=""):
        npc=self.get(npc_key); dialogues=list(npc.get("dialogues") or [])
        if not dialogues: raise NpcError("Ce PNJ ne possède aucun dialogue.")
        node=next((item for item in dialogues if item.get("key")==node_key),None) if node_key else dialogues[0]
        if not node: raise NpcError("Branche de dialogue introuvable.")
        context=self.context(npc_key,player_id); choices=[]
        for choice in node.get("choices",[]):
            if self._conditions(choice.get("conditions",[]),context,player_id): choices.append({key:choice.get(key) for key in ("key","label","next_node","action_key") if choice.get(key) is not None})
        return {"npc":{"key":npc_key,"name":npc.get("name")},"node_key":node.get("key"),"text":node.get("text",""),"audio_key":node.get("audio_key",""),"choices":choices}

    def choose_dialogue(self,npc_key,player_id,node_key,choice_key):
        npc=self.get(npc_key); node=next((item for item in npc.get("dialogues",[]) if item.get("key")==node_key),None)
        choice=next((item for item in (node or {}).get("choices",[]) if item.get("key")==choice_key),None)
        if not choice or not self._conditions(choice.get("conditions",[]),self.context(npc_key,player_id),player_id): raise NpcError("Cette réponse n’est pas disponible.")
        for effect in choice.get("effects",[]):
            if effect.get("type")=="state": self.set_memory(npc_key,player_id,str(effect.get("key")),effect.get("value",True))
        result={"response_text":choice.get("response_text",""),"audio_key":choice.get("audio_key",""),"action_key":choice.get("action_key")}
        if choice.get("next_node"): result["next"]=self.dialogue(npc_key,player_id,str(choice["next_node"]))
        return result
