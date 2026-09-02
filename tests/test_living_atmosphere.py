from KingdomData.store import ContentStore
from KingdomVoice.resolver import resolve_audio_scene, resolve_sfx
from kingdomEvent.lifecycle import EventLifecycle
from kingdomEvent.modifiers import ModifierEngine
from kingdomEvent.runtime import WorldClock
from KingdomWeb.world_creator import WorldCreatorService


def publish(store, kind, key, payload):
    draft=store.save(kind,key,payload,"test")
    return store.publish(kind,key,draft["version"],"test")


def fresh_store(tmp_path):
    store=ContentStore(tmp_path/"atmosphere.db"); store.initialize(); return store


def test_forecasts_are_persistent_and_slide_without_reroll(tmp_path):
    store=fresh_store(tmp_path)
    publish(store,"environment","world",{"name":"Monde","mode":"automatic","clock_mode":"manual","day":12,"hour":9,"weather":{"key":"clear","name":"Beau"},"forecast_days":5})
    first=WorldClock(store).state(now=1000)["forecasts"]
    assert len(first)==5 and first[0]["day"]==12
    assert WorldClock(ContentStore(store.path)).state(now=9000)["forecasts"]==first
    current=store.get("environment","world")
    draft=store.save("environment","world",{**current["payload"],"day":13},"test",current["version"]); store.publish("environment","world",draft["version"],"test")
    shifted=WorldClock(store).state(now=10000)["forecasts"]
    assert shifted[0]["day"]==13 and shifted[-1]["day"]==17


def test_event_occurrence_pause_resume_extend_expire_and_modifier(tmp_path):
    store=fresh_store(tmp_path)
    publish(store,"event","wolf_pack",{"name":"Meute de loups","enabled":True,"trigger":{"type":"manual"},"modifiers":[{"property":"production.quantity","operator":"multiply","value":.8}]})
    lifecycle=EventLifecycle(store); occurrence=lifecycle.activate("wolf_pack",600,now=100)
    event=lifecycle.active_definitions(now=110)[0]
    assert ModifierEngine().effective(10,"production.quantity",{},[],[event])[0]==8
    paused=lifecycle.pause(occurrence["occurrence_id"],now=200)
    assert paused["remaining_seconds"]==500 and lifecycle.active_definitions(now=300)==[]
    assert WorldCreatorService(store).effective(10,"production.quantity",{})["effective"]==10
    resumed=lifecycle.resume(occurrence["occurrence_id"],now=400)
    assert resumed["ends_at"]==900
    assert lifecycle.extend(occurrence["occurrence_id"],60,now=450)["ends_at"]==960
    assert lifecycle.get(occurrence["occurrence_id"],now=961)["status"]=="finished"
    assert lifecycle.active_definitions(now=961)==[]


def test_scheduled_occurrence_survives_service_reconstruction(tmp_path):
    store=fresh_store(tmp_path); publish(store,"event","market_day",{"name":"Marché","trigger":{"type":"manual"}})
    occurrence=EventLifecycle(store).schedule("market_day",5_000_000_000,120)
    assert EventLifecycle(ContentStore(store.path)).get(occurrence["occurrence_id"],4_999_999_999)["status"]=="scheduled"
    active=EventLifecycle(ContentStore(store.path)).get(occurrence["occurrence_id"],5_000_000_000)
    assert active["status"]=="active" and active["ends_at"]==5_000_000_120


def test_audio_scene_is_layered_explainable_and_event_layer_disappears():
    groups=[{"key":key,"name":key,"tracks":{"ambience":[track],"music":[],"sfx":[],"voice":[]}} for key,track in (("forest","forest.ogg"),("owls","owls.ogg"),("rain","rain.ogg"),("wolves","wolves.ogg"))]
    building={"key":"woodcamp","context_tags":["outdoor"],"modules":{"audio":{"default_group_key":"forest","groups":groups,"time_layers":[{"when":"night","group_key":"owls"}],"weather_layers":[{"when":"rain","contexts":["outdoor"],"group_key":"rain"}]}}}
    event={"key":"wolf_pack","name":"Meute de loups","audio_layers":[{"group_key":"wolves","contexts":["outdoor"]}]}
    active=resolve_audio_scene(building,period="night",weather={"key":"rain","name":"Pluie"},events=[event])
    ended=resolve_audio_scene(building,period="night",weather={"key":"rain"},events=[])
    assert [layer["source"] for layer in active["layers"]]==["base","time","weather","event"]
    assert "wolves.ogg" in active["track_keys"] and "wolves.ogg" not in ended["track_keys"]


def test_event_audio_layer_can_target_selected_buildings():
    groups=[{"key":"festival","tracks":{"music":["fanfare"]}}]
    event={"key":"festival_event","audio_layers":[{"group_key":"festival","building_keys":["tavern"]}]}
    tavern=resolve_audio_scene({"key":"tavern","modules":{"audio":{"groups":groups}}},events=[event])
    forge=resolve_audio_scene({"key":"forge","modules":{"audio":{"groups":groups,"global_group_keys":["festival"]}}},events=[event])
    assert tavern["effective_group_key"] == "festival"
    assert forge["effective_group_key"] == ""


def test_legacy_audio_fallback_and_generic_sfx_priority():
    scene=resolve_audio_scene({"modules":{"audio":{"groups":[{"key":"legacy","tracks":{"ambience":["old.ogg"]}}]}}})
    assert scene["explanation"][0]["provenance"]=="fallback_historique"
    rules=[{"fallback":True,"audio_key":"generic"},{"action":"eat","audio_key":"eat"},{"action":"eat","building_key":"tavern","audio_key":"tavern_eat"},{"item_category":"food","audio_key":"food"}]
    assert resolve_sfx("eat",building_key="tavern",item={"category":"food"},rules=rules)["audio_key"]=="tavern_eat"
