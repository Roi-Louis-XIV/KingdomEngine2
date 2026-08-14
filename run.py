"""Lance un module de KingdomEngine 2 depuis la racine du projet."""

import argparse
import os

from dotenv import load_dotenv

load_dotenv()

parser = argparse.ArgumentParser()
parser.add_argument("module", choices=["web", "core", "voice", "provision", "invite-url"])
args = parser.parse_args()

if args.module == "web":
    import uvicorn
    uvicorn.run("KingdomWeb.app:app", host=os.getenv("KINGDOM_WEB_HOST", "127.0.0.1"), port=int(os.getenv("KINGDOM_WEB_PORT", "8000")), reload=False)
elif args.module == "core":
    from kingdomCore.discord_bot import create_bot
    create_bot().run(os.environ["KINGDOM_CORE_TOKEN"])
elif args.module == "voice":
    import asyncio
    from KingdomData import ContentStore
    from KingdomVoice import VoiceBotManager
    from import_v1 import import_v1
    from seed import DEFINITIONS
    voice_store = ContentStore(); voice_store.initialize(); voice_store.seed(DEFINITIONS); import_v1(voice_store)
    asyncio.run(VoiceBotManager(voice_store).run())
elif args.module == "provision":
    from KingdomData import ContentStore
    from kingdomCore.provisioner import run_provisioning
    from import_v1 import import_v1
    from seed import DEFINITIONS
    provision_store = ContentStore(); provision_store.initialize(); provision_store.seed(DEFINITIONS); import_v1(provision_store)
    run_provisioning(provision_store)
else:
    import discord
    from kingdomCore.provisioner import required_bot_permissions
    application_id = int(os.getenv("KINGDOM_APPLICATION_ID", "0") or 0)
    if not application_id:
        raise RuntimeError("Renseignez KINGDOM_APPLICATION_ID dans .env (identifiant de l’application Discord).")
    print(discord.utils.oauth_url(application_id, permissions=required_bot_permissions(), scopes=("bot",)))
