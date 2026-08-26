from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_debian_launcher_exposes_web_and_runs_all_modules():
    script = (ROOT / "start-server.sh").read_text(encoding="utf-8")
    assert 'KINGDOM_WEB_HOST="${KINGDOM_WEB_HOST:-0.0.0.0}"' in script
    assert "start_service web" in script
    assert "start_service core" in script
    assert "start_service voice" in script


def test_debian_installer_creates_autostart_services_and_secures_password():
    script = (ROOT / "install-debian.sh").read_text(encoding="utf-8")
    assert "systemctl enable --now kingdomengine-web kingdomengine-core kingdomengine-voice" in script
    assert "Restart=on-failure" in script
    assert "KINGDOM_WEB_HOST=0.0.0.0" in script
    assert "KINGDOM_ADMIN_PASSWORD=change-me" in script
