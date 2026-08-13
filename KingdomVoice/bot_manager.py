"""Supervise plusieurs identités Discord vocales décrites dans KingdomData."""

from __future__ import annotations

import asyncio
import os
import re
import unicodedata
from pathlib import Path
from typing import Any

import discord

from KingdomData import ContentStore


class ManagedVoiceBot(discord.Client):
    """Une identité Discord autonome, attachée à un salon et à une ambiance."""

    def __init__(self, key: str, config: dict[str, Any], assets_root: Path) -> None:
        intents = discord.Intents.default()
        intents.voice_states = True
        super().__init__(intents=intents)
        self.key, self.config, self.assets_root = key, config, assets_root
        self._audio_lock = asyncio.Lock()

    @property
    def channel_id(self) -> int:
        direct = int(self.config.get("voice_channel_id") or 0)
        env_name = str(self.config.get("voice_channel_env") or "")
        return direct or int(os.getenv(env_name, "0") or 0)

    def target_channel(self) -> discord.VoiceChannel | None:
        """Résout l’ID explicite, puis le nom du bâtiment provisionné."""
        if self.channel_id:
            channel = self.get_channel(self.channel_id)
            return channel if isinstance(channel, discord.VoiceChannel) else None
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
            voice = await channel.connect(self_deaf=True)
            self._start_welcome_then_ambience(voice)
        elif not humans and voice is not None:
            await asyncio.sleep(max(0, int(self.config.get("leave_delay", 10))))
            if not [member for member in channel.members if not member.bot]:
                await voice.disconnect(force=False)
        return voice

    def _tracks(self, folder: str | None) -> list[Path]:
        if not folder: return []
        target = self.assets_root / str(folder).removeprefix("assets/")
        return sorted(path for path in target.glob("*") if path.suffix.lower() in {".mp3", ".wav", ".ogg"}) if target.exists() else []

    def _source(self, track: Path, channel: str, loop: bool = False) -> discord.AudioSource:
        volume = float(self.config.get("volume", {}).get(channel, 0.5))
        options = "-stream_loop -1" if loop else None
        audio = discord.FFmpegPCMAudio(str(track), executable=os.getenv("FFMPEG_PATH", "ffmpeg"), before_options=options)
        return discord.PCMVolumeTransformer(audio, volume=volume)

    def _start_welcome_then_ambience(self, voice: discord.VoiceClient) -> None:
        welcomes = self._tracks(self.config.get("welcome_folder"))
        if not welcomes:
            self._start_ambience(voice)
            return
        loop = asyncio.get_running_loop()
        voice.play(self._source(welcomes[0], "voice"), after=lambda error: loop.call_soon_threadsafe(self._start_ambience, voice) if not error else print(f"[KingdomVoice] accueil interrompu : {error}"))

    def _start_ambience(self, voice: discord.VoiceClient) -> None:
        tracks = self._tracks(self.config.get("ambience_folder"))
        if tracks and voice.is_connected() and not voice.is_playing():
            voice.play(self._source(tracks[0], "ambience", loop=True))


class VoiceBotManager:
    """Charge et exécute tous les profils vocaux publiés et activés."""

    def __init__(self, store: ContentStore | None = None, assets_root: str | Path | None = None) -> None:
        self.store = store or ContentStore()
        local_assets = Path(__file__).resolve().parent / "assets"
        legacy_assets = Path(__file__).resolve().parents[2] / "KingdomEngine" / "KingdomVoice" / "assets"
        self.assets_root = Path(assets_root) if assets_root else (local_assets if local_assets.exists() else legacy_assets)
        self.clients: dict[str, ManagedVoiceBot] = {}

    def configured(self) -> list[dict[str, Any]]:
        return [entity for entity in self.store.list("bot", published=True) if entity["payload"].get("bot_type") == "voice"]

    async def run(self) -> None:
        tasks = []
        for entity in self.configured():
            config, key = dict(entity["payload"]), entity["entity_key"]
            building_key = config.get("building_key")
            if building_key:
                try:
                    config["voice_channel_name"] = self.store.get("building", str(building_key), published=True)["payload"]["name"]
                except Exception:
                    pass
            if not config.get("enabled", False):
                print(f"[KingdomVoice] {key} désactivé, ignoré.")
                continue
            token = os.getenv(str(config.get("token_env", "")))
            if not token:
                print(f"[KingdomVoice] {key} ignoré : variable {config.get('token_env')} absente.")
                continue
            client = ManagedVoiceBot(key, config, self.assets_root)
            self.clients[key] = client
            tasks.append(asyncio.create_task(client.start(token), name=key))
        if not tasks:
            print("[KingdomVoice] Aucun bot vocal activé avec un token configuré.")
            return
        try: await asyncio.gather(*tasks)
        finally: await asyncio.gather(*(client.close() for client in self.clients.values()), return_exceptions=True)


def _normalized_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    # Retire notamment l’emoji 🔊 ajouté par le provisionneur.
    return re.sub(r"[^a-z0-9]+", "", text)
