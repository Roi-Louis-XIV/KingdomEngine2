from datetime import datetime, timedelta, timezone
import json

from KingdomVoice.runtime_status import read_voice_status, status_path, write_voice_status


def test_voice_runtime_status_round_trip_without_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("KINGDOM_DATA_DIR", str(tmp_path))
    write_voice_status(
        {
            "active": 1,
            "workers": [
                {
                    "key": "voice_worker_01",
                    "guild_id": "123",
                    "channel_id": "456",
                    "presence_key": "mine",
                    "connected": True,
                }
            ],
        }
    )
    result = read_voice_status()
    assert result["active"] == 1
    assert result["workers"][0]["connected"] is True
    assert "token" not in status_path().read_text(encoding="utf-8").lower()


def test_voice_runtime_status_discards_stale_connections(tmp_path, monkeypatch):
    monkeypatch.setenv("KINGDOM_DATA_DIR", str(tmp_path))
    target = status_path()
    target.parent.mkdir(parents=True)
    target.write_text(
        json.dumps(
            {
                "active": 1,
                "workers": [{"key": "voice_worker_01", "connected": True}],
                "updated_at": (
                    datetime.now(timezone.utc) - timedelta(minutes=2)
                ).isoformat(),
            }
        ),
        encoding="utf-8",
    )
    assert read_voice_status() == {"active": 0, "workers": [], "stale": True}
