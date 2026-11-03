"""Isolated browser fixture. Never opens a user database or starts Discord bots."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
_sandbox = tempfile.TemporaryDirectory(prefix="kingdom-v3-browser-")
os.environ["KINGDOM_DATA_DIR"] = _sandbox.name
os.environ["KINGDOM_DATABASE"] = str(Path(_sandbox.name) / "test.db")
os.environ["KINGDOM_ADMIN_USERNAME"] = "creator"
os.environ["KINGDOM_ADMIN_PASSWORD"] = "creator-browser-test"
os.environ["KINGDOM_SECURE_COOKIES"] = "0"
os.environ.pop("KINGDOM_ADMIN_TOKEN", None)
os.environ.pop("KINGDOM_GUILD_ID", None)

import uvicorn
import KingdomWeb.app as web
from KingdomData import ContentStore

# Only the fixture's authored content: no production seed or audio import.
web.DEFINITIONS = []
web.import_v1 = lambda _: 0
web.seed_legacy_audio_catalog = lambda _: 0
web.OfficialContentStore.migrate_legacy_presets = lambda _: None
web.magasin_principal.initialize()
web.comptes.initialiser()
creator = web.comptes.authentifier("creator", "creator-browser-test")
second = web.comptes.creer_serveur("Monde secondaire", "", creator["id"])
other = ContentStore(second["database_path"])
other.initialize()
row = other.save("building", "second_atelier", {"name": "Atelier du second monde", "actions": []})
other.publish("building", "second_atelier", row["version"])
row = web.magasin_principal.save("building", "existing_atelier", {
    "name": "Atelier existant", "description": "Un bâtiment historique", "actions": [],
    "future_extension": {"preserved": True}, "modules": {"products": []},
})
web.magasin_principal.publish("building", "existing_atelier", row["version"])
reader = web.comptes.creer_compte("reader", "Lecteur", "reader-browser-test")
web.comptes.attribuer_acces(reader["id"], "royaume-principal", "lecture")

if __name__ == "__main__":
    uvicorn.run(web.app, host="127.0.0.1", port=8765)
