"""Lance un module de KingdomEngine 2 depuis la racine du projet."""

import argparse
import atexit
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


class SingleInstance:
    """Verrou système : le fichier peut rester présent, seul le verrou compte."""

    def __init__(self, name: str):
        lock_dir = Path(__file__).resolve().parent / "var"
        lock_dir.mkdir(parents=True, exist_ok=True)
        self.path = lock_dir / f"{name}.lock"
        self.pid_path = lock_dir / f"{name}.pid"
        self.acquired = False
        # msvcrt ne peut verrouiller qu'un octet qui existe déjà. Sa création
        # doit donc avoir lieu avant l'ouverture du handle partagé.
        try:
            with self.path.open("xb") as lock_file:
                lock_file.write(b"0")
        except FileExistsError:
            if self.path.stat().st_size == 0:
                try:
                    with self.path.open("ab") as lock_file:
                        lock_file.write(b"0")
                except PermissionError:
                    # Un autre processus a pu verrouiller le fichier entre le
                    # stat et l'ouverture : acquire() le traitera comme occupé.
                    pass
        self.handle = self.path.open("r+b")

    def acquire(self) -> bool:
        self.handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            self.handle.close()
            return False
        self.acquired = True
        self.pid_path.write_text(str(os.getpid()), encoding="ascii")
        atexit.register(self.release)
        return True

    def release(self) -> None:
        """Libère le verrou et retire uniquement le PID de cette instance."""
        if not self.acquired:
            return
        self.acquired = False
        try:
            if self.pid_path.exists() and self.pid_path.read_text(encoding="ascii").strip() == str(os.getpid()):
                self.pid_path.unlink()
        except OSError:
            pass
        try:
            self.handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        finally:
            self.handle.close()


def require_single_instance(module: str) -> SingleInstance:
    lock = SingleInstance(module)
    if not lock.acquire():
        raise SystemExit(f"[KingdomEngine] {module} est déjà lancé. Utilisez KingdomWeb pour le redémarrer.")
    return lock

parser = argparse.ArgumentParser()
parser.add_argument("module", choices=["web", "core", "voice", "provision", "invite-url"])
args = parser.parse_args()

if args.module == "web":
    import uvicorn
    uvicorn.run("KingdomWeb.app:app", host=os.getenv("KINGDOM_WEB_HOST", "127.0.0.1"), port=int(os.getenv("KINGDOM_WEB_PORT", "8000")), reload=False)
elif args.module == "core":
    instance_lock = require_single_instance("core")
    from kingdomCore.discord_bot import create_bot
    create_bot().run(os.environ["KINGDOM_CORE_TOKEN"])
elif args.module == "voice":
    instance_lock = require_single_instance("voice")
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
