"""Supervise plusieurs identités Discord vocales décrites dans KingdomData."""

from __future__ import annotations

import asyncio
import os
import random
import re
import unicodedata
from pathlib import Path
from typing import Any

import discord

from KingdomData import ContentStore
from KingdomData.paths import PACKAGE_DATA_ROOT, persistent_data_root
from KingdomVoice.resolver import resolve_audio_scene
from KingdomVoice.pool import VoicePresence, VoiceWorkerPool, VoiceWorkerState
from kingdomEvent.lifecycle import EventLifecycle
from kingdomEvent.runtime import WorldClock


class ManagedVoiceBot(discord.Client):
    """Une identité Discord autonome, attachée à un salon et à une ambiance."""

    def __init__(self, key: str, config: dict[str, Any], assets_root: Path, store: ContentStore) -> None:
        intents = discord.Intents.default()
        intents.voice_states = True
        super().__init__(intents=intents)
        self.key, self.config, self.assets_root, self.store = key, config, assets_root, store
        self._audio_lock = asyncio.Lock()
        self.current_group_key = str(config.get("default_group_key", ""))
        self._last_scene_check = 0.0
        self._applied_identity = ""

    @property
    def channel_id(self) -> int:
        direct = int(self.config.get("voice_channel_id") or 0)
        env_name = str(self.config.get("voice_channel_env") or "")
        return direct or int(os.getenv(env_name, "0") or 0)

    def target_channel(self) -> discord.VoiceChannel | None:
        """Résout l’ID explicite, puis le nom si cet ID est devenu obsolète."""
        if self.channel_id:
            channel = self.get_channel(self.channel_id)
            if isinstance(channel, discord.VoiceChannel):
                return channel
            print(f"[KingdomVoice] {self.key} : salon {self.channel_id} obsolète, recherche par nom.")
        expected = _normalized_name(self.config.get("voice_channel_name") or self.config.get("building_key") or "")
        if not expected:
            return None
        for guild in self.guilds:
            for channel in guild.voice_channels:
                candidate = _normalized_name(channel.name)
                if candidate == expected or expected in candidate or candidate in expected:
                    return channel
        return None

    async def on_ready(self) -> None:
        presence = self.config.get("presence") or f"dans {self.config.get('building', 'le Royaume')}"
        await self.change_presence(activity=discord.Game(str(presence)))
        print(f"[KingdomVoice] {self.key} connecté : {self.user}")
        if self.config.get("auto_join", True):
            await self.ensure_connected()

    async def apply_presence_identity(self, presence: VoicePresence) -> None:
        """Applique au plus une fois le surnom de serveur d'une présence.

        Le username global n'est jamais modifié. L'avatar serveur reste une
        capacité future car il dépend des droits et capacités Discord du bot.
        """
        identity = f"{presence.key}:{presence.name}"
        if identity == self._applied_identity:
            return
        for guild in self.guilds:
            member = guild.me
            if member and member.nick != presence.name:
                try: await member.edit(nick=presence.name[:32], reason="Affectation Voice Presence KingdomEngine")
                except (discord.Forbidden, discord.HTTPException) as exc:
                    print(f"[KingdomVoice] identité de présence non appliquée pour {self.key} : {exc}")
        self._applied_identity = identity

    async def on_voice_state_update(self, _member, before, after) -> None:
        target = self.target_channel()
        if target and (getattr(before.channel, "id", None) == target.id or getattr(after.channel, "id", None) == target.id):
            await self.ensure_connected()

    async def ensure_connected(self) -> discord.VoiceClient | None:
        channel = self.target_channel()
        if channel is None:
            print(f"[KingdomVoice] {self.key} : salon vocal introuvable pour {self.config.get('building_key')}.")
            return None
        voice = channel.guild.voice_client
        humans = [member for member in channel.members if not member.bot]
        if humans and voice is None:
            # Un bot d'ambiance n'a pas besoin d'être assourdi. Discord affiche
            # self_deaf=True comme une sourdine, ce qui prête à confusion lors
            # des tests et masque parfois un mute serveur réel.
            print(f"[KingdomVoice] {self.key} rejoint #{channel.name} ({channel.id}) pour {len(humans)} joueur(s).")
            voice = await channel.connect(self_deaf=False)
            if self.current_group_key:
                self._start_group_background(voice, self.current_group_key)
            else:
                self._start_welcome_then_ambience(voice)
        elif not humans and voice is not None:
            await asyncio.sleep(max(0, int(self.config.get("leave_delay", 10))))
            if not [member for member in channel.members if not member.bot]:
                await voice.disconnect(force=False)
        elif not humans:
            print(f"[KingdomVoice] {self.key} attend un joueur dans #{channel.name} ({channel.id}).")
        return voice

    def _tracks(self, folder: str | None) -> list[Path]:
        if not folder: return []
        relative = str(folder).replace("\\", "/").strip("/")
        roots = tuple(dict.fromkeys((self.assets_root, PACKAGE_DATA_ROOT)))
        candidates = []
        for root in roots:
            candidates.extend((root / relative.removeprefix("assets/"), root / relative))
        # Les profils V1 n'étaient pas homogènes : certains stockaient
        # ``assets/forest`` et d'autres simplement ``village``.
        candidates.extend(root / "assets" / relative.removeprefix("assets/") for root in roots)
        for target in dict.fromkeys(candidates):
            if target.exists():
                tracks = sorted(path for path in target.glob("*") if path.suffix.lower() in {".mp3", ".wav", ".ogg"})
                if tracks:
                    return tracks
        return []

    def _source(self, track: Path, channel: str, loop: bool = False) -> discord.AudioSource:
        volume = float(self.config.get("volume", {}).get(channel, 0.5))
        options = "-stream_loop -1" if loop else None
        audio = discord.FFmpegPCMAudio(str(track), executable=os.getenv("FFMPEG_PATH", "ffmpeg"), before_options=options)
        return discord.PCMVolumeTransformer(audio, volume=volume)

    def _entity_track(self, audio_key: str) -> tuple[Path, dict[str, Any]]:
        entity = self.store.get("audio", audio_key, published=True)
        payload = entity["payload"]
        relative = str(payload.get("storage_path", payload.get("source", ""))).replace("\\", "/")
        for root in dict.fromkeys((self.assets_root.resolve(), PACKAGE_DATA_ROOT.resolve())):
            path = (root / relative).resolve()
            if root in path.parents and path.is_file():
                return path, payload
        raise FileNotFoundError(f"Fichier audio introuvable pour {audio_key}.")

    def _building_audio(self) -> dict[str, Any]:
        building_key = str(self.config.get("building_key", ""))
        if not building_key:
            return {}
        return self.store.get("building", building_key, published=True)["payload"].get("modules", {}).get("audio", {})

    async def sync_effective_scene(self) -> None:
        """Applique sans restart la couche de plus haute priorité disponible.

        Le mixage simultané reste volontairement distinct : ce runtime joue
        une couche prioritaire et conserve toute la trace dans le résolveur.
        """
        building_key=str(self.config.get("building_key", ""))
        if not building_key: return
        try:
            payload=self.store.get("building",building_key,published=True)["payload"]
            world=WorldClock(self.store).state()
            # Les groupes autonomes sont ajoutés au registre de résolution sans
            # écraser les groupes locaux historiques du bâtiment.
            prepared = dict(payload)
            prepared["modules"] = dict(payload.get("modules", {}))
            audio_module = dict(prepared["modules"].get("audio", {}))
            local_groups = list(audio_module.get("groups", []))
            local_keys = {str(group.get("key", "")) for group in local_groups}
            global_group_keys = []
            for entity in self.store.list("audio_group", published=True):
                if entity["entity_key"] in local_keys:
                    continue
                group_payload = entity["payload"]
                tracks = {channel: [] for channel in ("music", "ambience", "sfx", "voice")}
                for layer in group_payload.get("layers", []):
                    tracks.setdefault(str(layer.get("role", "ambience")), []).append(str(layer.get("audio_key", "")))
                local_groups.append({"key": entity["entity_key"], "name": group_payload.get("name"), "volume": group_payload.get("volume", 1), "tracks": tracks})
                global_group_keys.append(entity["entity_key"])
            audio_module["groups"] = local_groups
            audio_module["global_group_keys"] = global_group_keys
            prepared["modules"]["audio"] = audio_module
            scene=resolve_audio_scene({"key":building_key,**prepared},period=world["time_of_day"],weather=world["weather"],season=world.get("season"),events=EventLifecycle(self.store).active_definitions())
            desired=scene["effective_group_key"]
            if desired and desired!=self.current_group_key:
                print(f"[KingdomVoice] {self.key} scène effective : " + " + ".join(f"{x['source']}={x['group_key']}" for x in scene["explanation"]))
                await self.set_group(desired)
        except Exception as exc:
            print(f"[KingdomVoice] {self.key} : résolution de scène conservée sur {self.current_group_key or 'fallback'} ({exc}).")

    def _group(self, group_key: str) -> dict[str, Any] | None:
        local = next((group for group in self._building_audio().get("groups", []) if group.get("key") == group_key), None)
        if local:
            return local
        try:
            payload = self.store.get("audio_group", group_key, published=True)["payload"]
        except Exception:
            return None
        # Le lecteur historique consomme quatre pistes par canal. La fiche
        # autonome conserve davantage de réglages, mais expose ce contrat pour
        # que les bots existants puissent la jouer sans migration destructive.
        tracks = {channel: [] for channel in ("music", "ambience", "sfx", "voice")}
        for layer in payload.get("layers", []):
            tracks.setdefault(str(layer.get("role", "ambience")), []).append(str(layer.get("audio_key", "")))
        return {"key": group_key, "name": payload.get("name", group_key), "volume": payload.get("volume", 1), "tracks": tracks}

    async def play_audio(self, audio_key: str) -> None:
        async with self._audio_lock:
            voice = await self.ensure_connected()
            if voice is None or not voice.is_connected():
                raise RuntimeError("Le bot audio n’est pas connecté au bâtiment.")
            track, payload = self._entity_track(audio_key)
            channel = str(payload.get("audio_type", payload.get("channel", "sfx")))
            if voice.is_playing():
                voice.stop()
            loop = asyncio.get_running_loop()
            source = self._source(track, channel, bool(payload.get("loop", False)))
            source.volume = float(payload.get("volume", source.volume))
            voice.play(source, after=lambda error: loop.call_soon_threadsafe(self._resume_background, voice, error))

    async def set_group(self, group_key: str) -> None:
        group = self._group(group_key)
        if not group:
            raise RuntimeError(f"Groupe sonore inconnu : {group_key}.")
        self.current_group_key = group_key
        voice = await self.ensure_connected()
        if voice is None or not voice.is_connected():
            return
        tracks = group.get("tracks", {})
        transition = list(tracks.get("voice", [])) or list(tracks.get("sfx", []))
        if transition:
            await self.play_audio(random.choice(transition))
            return
        if voice and voice.is_connected():
            if voice.is_playing():
                voice.stop()
            self._start_group_background(voice, group_key)

    def _resume_background(self, voice: discord.VoiceClient, error: Exception | None = None) -> None:
        if error:
            print(f"[KingdomVoice] lecture interrompue pour {self.key} : {error}")
        if self.current_group_key and voice.is_connected() and not voice.is_playing():
            self._start_group_background(voice, self.current_group_key)

    def _start_group_background(self, voice: discord.VoiceClient, group_key: str) -> None:
        group = self._group(group_key)
        if not group:
            return
        tracks = group.get("tracks", {})
        candidates = list(tracks.get("ambience", [])) or list(tracks.get("music", []))
        if not candidates or not voice.is_connected() or voice.is_playing():
            return
        track, payload = self._entity_track(random.choice(candidates))
        channel = str(payload.get("audio_type", payload.get("channel", "ambience")))
        source = self._source(track, channel, True)
        source.volume = float(payload.get("volume", source.volume)) * float(group.get("volume", 1))
        voice.play(source)
        print(f"[KingdomVoice] {self.key} joue {track.name} en boucle (groupe {group_key}).")

    def _start_welcome_then_ambience(self, voice: discord.VoiceClient) -> None:
        welcomes = self._tracks(self.config.get("welcome_folder"))
        if not welcomes:
            print(f"[KingdomVoice] {self.key} : aucun accueil dans {self.config.get('welcome_folder') or '(non configuré)'}, lancement de l’ambiance.")
            self._start_ambience(voice)
            return
        loop = asyncio.get_running_loop()
        voice.play(self._source(welcomes[0], "voice"), after=lambda error: loop.call_soon_threadsafe(self._start_ambience, voice) if not error else print(f"[KingdomVoice] accueil interrompu : {error}"))

    def _start_ambience(self, voice: discord.VoiceClient) -> None:
        tracks = self._tracks(self.config.get("ambience_folder"))
        if tracks and voice.is_connected() and not voice.is_playing():
            voice.play(self._source(tracks[0], "ambience", loop=True))
            print(f"[KingdomVoice] {self.key} joue {tracks[0].name} en boucle.")
        elif not tracks:
            print(f"[KingdomVoice] {self.key} : aucune ambiance trouvée dans {self.config.get('ambience_folder') or '(non configuré)' }.")


class VoiceBotManager:
    """Charge et exécute tous les profils vocaux publiés et activés."""

    def __init__(self, store: ContentStore | None = None, assets_root: str | Path | None = None) -> None:
        self.store = store or ContentStore()
        self.assets_root = Path(assets_root) if assets_root else persistent_data_root()
        self.clients: dict[str, ManagedVoiceBot] = {}
        self._last_scene_check = 0.0
        self.pool = VoiceWorkerPool([], max_concurrent_voice_presences=0)

    def configured(self) -> list[dict[str, Any]]:
        return [entity for entity in self.store.list("bot", published=True) if entity["payload"].get("bot_type") == "voice"]

    async def run(self) -> None:
        recovered = self.store.recover_audio()
        if recovered:
            print(f"[KingdomVoice] {recovered} commande(s) audio récupérée(s) après interruption.")
        tasks = []
        for entity in self.configured():
            config, key = dict(entity["payload"]), entity["entity_key"]
            building_key = config.get("building_key")
            if building_key:
                try:
                    building = self.store.get("building", str(building_key), published=True)["payload"]
                    config["voice_channel_name"] = building["name"]
                    audio_module = building.get("modules", {}).get("audio", {})
                    groups = audio_module.get("groups", [])
                    # Une fiche créée avant le sélecteur d'ambiance peut avoir
                    # un groupe valide mais aucune clé par défaut. Le premier
                    # groupe devient alors le choix naturel et déterministe.
                    config["default_group_key"] = audio_module.get("default_group_key") or (str(groups[0].get("key", "")) if groups else "")
                    provisioned = self.store.building_channels(str(building_key))
                    if provisioned.get("voice_channel_id"):
                        config["voice_channel_id"] = provisioned["voice_channel_id"]
                except Exception:
                    pass
            if not config.get("enabled", False):
                print(f"[KingdomVoice] {key} désactivé, ignoré.")
                continue
            token = os.getenv(str(config.get("token_env", "")))
            if not token:
                print(f"[KingdomVoice] {key} ignoré : variable {config.get('token_env')} absente.")
                continue
            client = ManagedVoiceBot(key, config, self.assets_root, self.store)
            self.clients[key] = client
            tasks.append(asyncio.create_task(client.start(token), name=key))
        configured_quota = int(os.getenv("KINGDOM_MAX_CONCURRENT_VOICE_PRESENCES", str(len(self.clients))) or len(self.clients))
        self.pool = VoiceWorkerPool(
            [VoiceWorkerState(key=key, guild_id=str(client.config.get("guild_id", ""))) for key, client in self.clients.items()],
            max_concurrent_voice_presences=configured_quota,
        )
        if not tasks:
            print("[KingdomVoice] Aucun bot vocal activé avec un token configuré.")
            return
        dispatcher = asyncio.create_task(self._dispatch_audio(), name="audio-dispatcher")
        try: await asyncio.gather(*tasks)
        finally:
            dispatcher.cancel()
            await asyncio.gather(dispatcher, return_exceptions=True)
            await asyncio.gather(*(client.close() for client in self.clients.values()), return_exceptions=True)

    async def assign_presence(self, presence: VoicePresence, *, guild_id: str = "", channel_id: str = "", building_key: str = "") -> ManagedVoiceBot | None:
        """Affecte une présence sans rendre le gameplay dépendant de l'audio."""
        worker = self.pool.allocate(presence, guild_id=guild_id, channel_id=channel_id)
        if worker is None:
            print(f"[KingdomVoice] aucune capacité disponible pour la présence {presence.key}; le monde reste jouable sans audio.")
            return None
        client = self.clients.get(worker.key)
        if client is None:
            self.pool.fail(worker.key, "Client Discord indisponible")
            return None
        client.config.update({"guild_id": guild_id or client.config.get("guild_id", ""), "voice_channel_id": channel_id or 0, "building_key": building_key, "presence_key": presence.key})
        client.current_group_key = presence.scene_key or client.current_group_key
        await client.apply_presence_identity(presence)
        await client.ensure_connected()
        return client

    async def release_presence(self, presence_key: str) -> None:
        worker = next((item for item in self.pool.workers.values() if item.presence_key == presence_key), None)
        if not worker: return
        client = self.clients.get(worker.key)
        if client:
            await asyncio.gather(*(voice.disconnect(force=False) for voice in client.voice_clients), return_exceptions=True)
        self.pool.release(presence_key=presence_key)

    def _client_for(self, command: dict[str, Any], audio: dict[str, Any] | None = None) -> ManagedVoiceBot | None:
        building_key = str(command.get("building_key", ""))
        explicit = str(command.get("bot_key") or "")
        speaker = str((audio or {}).get("speaker_bot_key") or "")
        if explicit and explicit in self.clients:
            return self.clients[explicit]
        if speaker in self.clients and str(self.clients[speaker].config.get("building_key", "")) == building_key:
            return self.clients[speaker]
        assigned = next((client for client in self.clients.values() if str(client.config.get("building_key", "")) == building_key), None)
        return assigned

    async def _dispatch_audio(self) -> None:
        await asyncio.sleep(2)
        while not self.is_closed():
            now=asyncio.get_running_loop().time()
            if now-self._last_scene_check>=5:
                self._last_scene_check=now
                await asyncio.gather(*(client.sync_effective_scene() for client in self.clients.values()),return_exceptions=True)
            for command in self.store.pending_audio():
                error = ""
                try:
                    audio = self.store.get("audio", command["audio_key"], published=True)["payload"] if command["audio_key"] else None
                    client = self._client_for(command, audio)
                    if client is None:
                        raise RuntimeError("Aucun bot vocal n’est attribué à ce bâtiment.")
                    if command["command"] == "play":
                        await client.play_audio(command["audio_key"])
                    elif command["command"] == "set_group":
                        await client.set_group(command["group_key"])
                    else:
                        raise RuntimeError(f"Commande audio inconnue : {command['command']}")
                except Exception as exc:
                    error = str(exc)
                    print(f"[KingdomVoice] commande #{command['id']} refusée : {error}")
                self.store.finish_audio(int(command["id"]), error)
            await asyncio.sleep(0.75)

    def is_closed(self) -> bool:
        return bool(self.clients) and all(client.is_closed() for client in self.clients.values())


def _normalized_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    # Retire notamment l’emoji 🔊 ajouté par le provisionneur.
    return re.sub(r"[^a-z0-9]+", "", text)
