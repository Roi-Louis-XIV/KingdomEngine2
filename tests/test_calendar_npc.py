import json
import time

from KingdomData.store import ContentStore
from kingdomCore.npc import NpcEngine
from kingdomEvent.calendar import CalendarEngine
from kingdomEvent.lifecycle import EventLifecycle
from kingdomEvent.runtime import WorldClock


def publish(store,kind,key,payload):
    draft=store.save(kind,key,payload,"test"); return store.publish(kind,key,draft["version"],"test")


CUSTOM={"name":"Alenor","start_year":124,"start_month_key":"primelune","start_day":1,"weekdays":["Aube","Flamme","Couronne","Lune","Repos"],"months":[{"key":"primelune","name":"Primelune","days":32},{"key":"brumes","name":"Hautes-Brumes","days":28}],"seasons":[{"key":"mists","name":"Brumes","emoji":"🌫️","start_month_key":"primelune","start_day":20},{"key":"sun","name":"Soleil","emoji":"☀️","start_month_key":"brumes","start_day":10}]}


def test_custom_calendar_five_day_week_month_and_year_rollovers():
    calendar=CalendarEngine(CUSTOM)
    assert calendar.days_per_year==60
    assert calendar.from_world_hours(31*24).dict()|{} == calendar.from_world_hours(calendar.to_world_hours(124,"primelune",32)).dict()|{}
    assert calendar.from_world_hours(32*24).month_key=="brumes"
    next_year=calendar.from_world_hours(60*24)
    assert (next_year.year,next_year.month_key,next_year.day,next_year.weekday)==(125,"primelune",1,"Aube")
    assert calendar.to_world_hours(125,"primelune",1)==60*24


def test_season_is_derived_from_world_date():
    calendar=CalendarEngine(CUSTOM); date=calendar.from_world_hours(calendar.to_world_hours(124,"primelune",25))
    assert calendar.season(date)["key"]=="mists" and calendar.season(date)["day"]==6


def test_world_clock_reconstructs_custom_date_after_restart(tmp_path):
    store=ContentStore(tmp_path/"calendar.db");store.initialize()
    publish(store,"environment","world",{"name":"Monde","clock_mode":"manual","day":33,"hour":7,"minute":30,"calendar":CUSTOM,"weather":{"key":"clear","name":"Beau"}})
    first=WorldClock(store).state(now=100); rebuilt=WorldClock(ContentStore(store.path)).state(now=999)
    assert first["date"]==rebuilt["date"] and first["date"]["month_key"]=="brumes" and first["date"]["hour"]==7


def test_event_can_be_scheduled_from_world_dates(tmp_path):
    store=ContentStore(tmp_path/"schedule.db");store.initialize()
    publish(store,"environment","world",{"name":"Monde","clock_mode":"accelerated","day":1,"hour":0,"speed":3600,"calendar":CUSTOM,"weather":{"key":"clear","name":"Beau"}})
    publish(store,"event","festival",{"name":"Festival","trigger":{"type":"manual"}})
    occurrence=EventLifecycle(store).schedule_world("festival",{"year":124,"month_key":"primelune","day":2,"hour":8},{"year":124,"month_key":"primelune","day":4,"hour":8},now=time.time())
    assert occurrence["status"]=="scheduled" and occurrence["metadata"]["world_start"]["day"]==2
    assert occurrence["remaining_seconds"]==48


def npc_store(tmp_path):
    store=ContentStore(tmp_path/"npc.db");store.initialize()
    publish(store,"location","tavern_place",{"name":"Quartier taverne","location_type":"place","connections":[]})
    publish(store,"location","village_place",{"name":"Place","location_type":"place","connections":[]})
    publish(store,"building","tavern",{"name":"Taverne","location_key":"tavern_place","modules":{"professions":[],"activities":[]},"actions":[]})
    publish(store,"building","village",{"name":"Place du village","location_key":"village_place","modules":{"professions":[],"activities":[]},"actions":[]})
    publish(store,"bot","voice_tavern",{"name":"Agent Taverne","bot_type":"voice","token_env":"TEST_TOKEN","enabled":True,"building_key":"tavern"})
    publish(store,"bot","voice_village",{"name":"Agent Place","bot_type":"voice","token_env":"TEST_TOKEN_2","enabled":True,"building_key":"village"})
    with store.connection() as db:
        db.execute("INSERT INTO building_discord_channels(building_key,voice_channel_id,updated_at) VALUES('tavern','10','now')")
        db.execute("INSERT INTO building_discord_channels(building_key,voice_channel_id,updated_at) VALUES('village','20','now')")
    reactions=[
        {"key":"normal","trigger":"talk","priority":0,"variant_mode":"sequential","variants":[{"key":"hello","text":"Bonjour."},{"key":"again","text":"Encore vous."}]},
        {"key":"rain","trigger":"talk","priority":40,"conditions":[{"type":"weather","value":"rain"}],"variants":[{"key":"dry","text":"Entrez vous sécher."}]},
        {"key":"night_rain_famine","trigger":"talk","priority":100,"conditions":[{"type":"period","value":"night"},{"type":"weather","value":"rain"},{"type":"event_active","value":"famine"}],"variants":[{"key":"hard_times","text":"Sale temps et les réserves diminuent."}]},
    ]
    publish(store,"npc","gared",{"name":"Gared","role":"Aubergiste","location_key":"tavern_place","building_key":"tavern","reactions":reactions,"dialogues":[]})
    return store


def test_npc_reaction_priority_keeps_text_and_audio_variant_together(tmp_path):
    engine=NpcEngine(npc_store(tmp_path)); result=engine.react("gared","42","talk",{"period":"night","weather":"rain","events":["famine"]})
    assert result["reaction_key"]=="night_rain_famine"
    assert result["variant"]=={"key":"hard_times","text":"Sale temps et les réserves diminuent."}


def test_npc_memory_first_and_return_are_persistent_and_isolated(tmp_path):
    store=npc_store(tmp_path); engine=NpcEngine(store)
    assert not engine.context("gared","42")["npc_met"]
    first=engine.react("gared","42"); second=NpcEngine(ContentStore(store.path)).react("gared","42")
    assert first["variant"]["key"]=="hello" and second["variant"]["key"]=="again"
    assert engine.context("gared","84")["npc_met"] is False


def test_npc_move_changes_voice_agent_without_changing_building_audio(tmp_path):
    store=npc_store(tmp_path); engine=NpcEngine(store); tavern_before=store.get("building","tavern",published=True)["payload"]
    assert engine.voice_agent(engine.get("gared"))["bot_key"]=="voice_tavern"
    engine.move("gared",location_key="village_place",building_key="village")
    assert engine.voice_agent(engine.get("gared"))["bot_key"]=="voice_village"
    assert store.get("building","tavern",published=True)["payload"]==tavern_before


def test_multiple_npcs_share_one_voice_agent(tmp_path):
    store=npc_store(tmp_path); publish(store,"npc","elise",{"name":"Elise","location_key":"tavern_place","building_key":"tavern","reactions":[{"key":"hello","variants":[{"key":"one","text":"Bonjour."}]}]})
    engine=NpcEngine(store)
    assert engine.voice_agent(engine.get("gared"))["bot_key"]==engine.voice_agent(engine.get("elise"))["bot_key"]
