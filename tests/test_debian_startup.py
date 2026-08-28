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
    assert '"/etc/systemd/system/kingdom-$service.service"' in script
    assert "systemctl enable --now kingdom-web kingdom-core kingdom-voice" in script
    assert "Restart=on-failure" in script
    assert "KINGDOM_WEB_HOST=0.0.0.0" in script
    assert "KINGDOM_ADMIN_PASSWORD=change-me" in script
    assert "--data-dir" in script
    assert "KINGDOM_DATA_DIR=$DATA_DIR" in script
    assert 'mkdir -p "$DATA_DIR/assets/audio" "$DATA_DIR/assets/maps" "$DATA_DIR/servers"' in script
    assert "--domain" in script
    assert "reverse_proxy 127.0.0.1" in script
    assert "KINGDOM_SECURE_COOKIES=1" in script
    assert "kingdomengine-update.timer" in script


def test_backup_script_includes_the_configured_external_data_directory():
    script = (ROOT / "backup-server.sh").read_text(encoding="utf-8")
    assert "KINGDOM_DATA_DIR=" in script
    assert 'TARGETS+=("$DATA_DIR")' in script
    assert 'tar -czf "$BACKUP"' in script


def test_github_updater_is_safe_and_restarts_services_only_after_fast_forward():
    script = (ROOT / "update-server.sh").read_text(encoding="utf-8")
    assert "git status --porcelain --untracked-files=no" in script
    assert "git branch --show-current" in script
    assert "git merge-base --is-ancestor" in script
    assert "git merge --ff-only" in script
    assert "backup-server.sh" in script
    assert "systemctl restart kingdom-web kingdom-core kingdom-voice" in script
    assert "kingdomengine-web" not in script
