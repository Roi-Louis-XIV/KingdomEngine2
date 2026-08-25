import json

import KingdomWeb.supervision as supervision
from KingdomWeb.supervision import ServiceSupervisor


def test_restart_waits_for_stop_before_start(monkeypatch):
    supervisor = ServiceSupervisor()
    calls = []
    monkeypatch.setattr(supervisor, "definitions", lambda: [{"key": "core", "name": "KingdomCore", "controllable": True}])
    monkeypatch.setattr(supervisor, "_stop", lambda key: calls.append(("stop", key)))
    monkeypatch.setattr(supervisor, "_start", lambda definition: calls.append(("start", definition["key"])))
    monkeypatch.setattr(supervisor, "statuses", lambda: [{"key": "core", "running": True}])

    result = supervisor.control("core", "restart")

    assert calls == [("stop", "core"), ("start", "core")]
    assert result["running"] is True


def test_stop_removes_registry_and_runtime_pid_after_process_is_dead(tmp_path, monkeypatch):
    root = tmp_path
    registry_path = root / "var" / "services.pid.json"
    registry_path.parent.mkdir(parents=True)
    registry_path.write_text(json.dumps([{"service": "core", "Id": 4321}]), encoding="utf-8")
    runtime_pid = root / "var" / "core.pid"
    runtime_pid.write_text("4321", encoding="ascii")
    running = {4321: True}

    monkeypatch.setattr(supervision, "ROOT", root)
    monkeypatch.setattr(supervision, "PID_REGISTRY", registry_path)
    monkeypatch.setattr(ServiceSupervisor, "_alive", staticmethod(lambda pid: running.get(pid, False)))
    monkeypatch.setattr(ServiceSupervisor, "_terminate_process_tree", lambda self, pid: running.__setitem__(pid, False))

    ServiceSupervisor()._stop("core")

    assert json.loads(registry_path.read_text(encoding="utf-8")) == []
    assert not runtime_pid.exists()


def test_stopping_an_already_stopped_service_cleans_stale_entries(tmp_path, monkeypatch):
    registry_path = tmp_path / "var" / "services.pid.json"
    registry_path.parent.mkdir(parents=True)
    registry_path.write_text(json.dumps([{"service": "voice", "Id": 9999}]), encoding="utf-8")
    monkeypatch.setattr(supervision, "ROOT", tmp_path)
    monkeypatch.setattr(supervision, "PID_REGISTRY", registry_path)
    monkeypatch.setattr(ServiceSupervisor, "_alive", staticmethod(lambda _pid: False))

    ServiceSupervisor()._stop("voice")

    assert json.loads(registry_path.read_text(encoding="utf-8")) == []
