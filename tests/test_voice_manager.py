from types import SimpleNamespace

from KingdomVoice.bot_manager import ManagedVoiceBot, _normalized_name


def test_provisioned_voice_channel_matches_building_name():
    assert _normalized_name("🔊 Place du village") == _normalized_name("Place du village")
    assert _normalized_name("🔊 Forêt Royale") == _normalized_name("Forêt Royale")


def test_stale_voice_channel_id_falls_back_to_configured_name():
    target = SimpleNamespace(name="🔊 Forêt Royale")

    class FakeBot:
        key = "voice_sylvain"
        channel_id = 999
        config = {"voice_channel_name": "Forêt Royale", "building_key": "forest"}
        guilds = [SimpleNamespace(voice_channels=[target])]

        @staticmethod
        def get_channel(_channel_id):
            return None

    assert ManagedVoiceBot.target_channel(FakeBot()) is target


def test_legacy_audio_folder_is_resolved_with_or_without_assets_prefix(tmp_path):
    folder = tmp_path / "assets" / "village" / "ambience"
    folder.mkdir(parents=True)
    track = folder / "village.mp3"
    track.write_bytes(b"audio-test")
    fake = SimpleNamespace(assets_root=tmp_path)
    assert ManagedVoiceBot._tracks(fake, "village/ambience") == [track]
    assert ManagedVoiceBot._tracks(fake, "assets/village/ambience") == [track]
