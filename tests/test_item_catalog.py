from KingdomData import ContentStore
from KingdomWeb.item_catalog import ItemCatalogService


def catalog_store(tmp_path):
    store=ContentStore(tmp_path/"catalog.db");store.initialize()
    definitions=[
        ("iron_ore",{"name":"Minerai de fer","emoji":"⛏️","description":"Minerai brut riche en fer.","category":"resources","type":"resource"}),
        ("iron_sword",{"name":"Épée en fer","emoji":"⚔️","description":"Une lame forgée.","category":"equipment","type":"equipment"}),
        ("simple_axe",{"name":"Hache simple","emoji":"🪓","description":"Outil de coupe.","category":"tools","type":"tool","building_relations":[{"building_key":"forest","relation":"used_by"}]}),
    ]
    for key,payload in definitions:
        draft=store.save("item",key,payload);store.publish("item",key,draft["version"])
    buildings={
        "mine":{"name":"Mine","actions":[{"key":"extract_iron","name":"Extraire","effects":[{"type":"reward","resource":"iron_ore","amount":1}]}]},
        "forge":{"name":"Forge","modules":{"professions":[],"activities":[],"products":[{"item_key":"iron_sword","price":10}],"recipes":[{"key":"sword_recipe","ingredients":{"iron_ore":2},"output_item_key":"iron_sword"}],"deliveries":[{"item_key":"iron_ore","target_building_key":"forge"}],"upgrades":[]},"actions":[]},
        "forest":{"name":"Forêt","actions":[]},
    }
    for key,payload in buildings.items():
        draft=store.save("building",key,payload);store.publish("building",key,draft["version"])
    return store


def test_resolution_and_missing_reference(tmp_path):
    service=ItemCatalogService(catalog_store(tmp_path))
    assert service.resolve("iron_ore")["name"] == "Minerai de fer"
    missing=service.resolve("old_iron")
    assert missing["name"] == "Objet inconnu" and missing["missing"] is True and missing["id"] == "old_iron"


def test_search_by_name_id_and_description(tmp_path):
    service=ItemCatalogService(catalog_store(tmp_path))
    assert {x["id"] for x in service.catalog(search="fer")["items"]} == {"iron_ore","iron_sword"}
    assert service.catalog(search="simple_axe")["items"][0]["name"] == "Hache simple"
    assert service.catalog(search="coupe")["items"][0]["id"] == "simple_axe"


def test_type_building_and_combined_filters(tmp_path):
    service=ItemCatalogService(catalog_store(tmp_path))
    assert [x["id"] for x in service.catalog(category="equipment")["items"]] == ["iron_sword"]
    assert {x["id"] for x in service.catalog(building="forge")["items"]} == {"iron_ore","iron_sword"}
    assert [x["id"] for x in service.catalog(search="minerai",category="resources",building="forge")["items"]] == ["iron_ore"]


def test_multiple_buildings_and_relation_roles(tmp_path):
    item=ItemCatalogService(catalog_store(tmp_path)).resolve("iron_ore")
    links={x["key"]:set(x["relations"]) for x in item["buildings"]}
    assert links["mine"] == {"produced_by"}
    assert links["forge"] == {"used_by","accepted_by"}


def test_alphabetical_sort(tmp_path):
    service=ItemCatalogService(catalog_store(tmp_path))
    names=[x["name"] for x in service.catalog(sort="name_asc")["items"]]
    assert names == sorted(names,key=str.casefold)
    assert service.catalog(sort="name_desc")["items"][0]["name"] == names[-1]


def test_reusable_selector_displays_name_but_keeps_id():
    source=(__import__("pathlib").Path(__file__).parents[1]/"KingdomWeb"/"static"/"app.js").read_text(encoding="utf-8")
    assert 'function itemSelector(' in source
    assert 'value="${escapeHtml(key)}"' in source
    assert "entity.payload.name" in source
    assert 'itemSelector("Outil"' in source
    assert "référence manquante" in source
