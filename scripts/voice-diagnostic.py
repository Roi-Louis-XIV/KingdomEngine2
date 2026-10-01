"""Diagnostic contrôlé d'un Voice Worker : connexion, lecture et réallocation."""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

import discord
from dotenv import load_dotenv


async def run(token_env: str, channel_ids: list[int], audio_path: Path) -> None:
    intents = discord.Intents.default()
    intents.voice_states = True
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready() -> None:
        try:
            print(f"[VoiceDiagnostic] worker connecté : {client.user}")
            for index, channel_id in enumerate(channel_ids, start=1):
                channel = client.get_channel(channel_id)
                if not isinstance(channel, discord.VoiceChannel):
                    raise RuntimeError(f"Salon vocal introuvable : {channel_id}")
                permissions = channel.permissions_for(channel.guild.me)
                missing = [name for name in ("connect", "speak") if not getattr(permissions, name)]
                if missing:
                    raise PermissionError(
                        f"Permissions manquantes dans #{channel.name} : {', '.join(missing)}"
                    )
                voice = await channel.connect(self_deaf=False)
                print(f"[VoiceDiagnostic] allocation {index}/{len(channel_ids)} : #{channel.name}")
                voice.play(
                    discord.FFmpegPCMAudio(
                        str(audio_path), executable=os.getenv("FFMPEG_PATH", "ffmpeg")
                    )
                )
                while voice.is_playing():
                    await asyncio.sleep(0.2)
                print(f"[VoiceDiagnostic] lecture terminée dans #{channel.name}")
                await voice.disconnect(force=True)
                print(f"[VoiceDiagnostic] worker libéré après #{channel.name}")
        finally:
            await client.close()

    token = os.getenv(token_env, "")
    if not token:
        raise RuntimeError(f"Variable de token absente : {token_env}")
    await client.start(token)


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--token-env", required=True)
    parser.add_argument("--channel", action="append", required=True, type=int)
    parser.add_argument("--audio", required=True, type=Path)
    args = parser.parse_args()
    audio = args.audio.resolve()
    if not audio.is_file():
        raise SystemExit(f"Fichier audio introuvable : {audio}")
    asyncio.run(run(args.token_env, args.channel, audio))


if __name__ == "__main__":
    main()
