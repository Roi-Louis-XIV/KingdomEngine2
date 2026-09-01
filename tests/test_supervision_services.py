import json
from types import SimpleNamespace

import KingdomWeb.supervision as supervision
from KingdomWeb.supervision import AdministrationService, ServiceSupervisor


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


def test_client_overview_never_exposes_process_logs_or_database_path(monkeypatch):
    service = object.__new__(AdministrationService)
    monkeypatch.setattr(service, "overview", lambda: {
        "services": [
            {"key": "core", "name": "KingdomCore", "running": True, "pid": 1234},
            {"key": "voice", "name": "KingdomVoice", "running": False, "pid": 5678},
        ],
        "logs": {"core": "secret runtime output"},
        "database": {"path": "/private/customer.db", "size_bytes": 42},
        "metrics": {"running_services": 1},
    })

    result = service.client_overview()

    assert result["client_safe"] is True
    assert result["logs"] == {}
    assert result["database"] == {"size_bytes": 42}
    assert all("pid" not in item for item in result["services"])
    assert {item["key"] for item in result["services"]} == {"world", "audio", "studio"}


def test_systemd_is_the_source_of_truth_on_debian(monkeypatch):
    monkeypatch.setattr(supervision.sys, "platform", "linux")
    monkeypatch.setattr(supervision.Path, "exists", lambda self: self.as_posix() == "/run/systemd/system")
    output = "ActiveState=active\nSubState=running\nMainPID=1916\nActiveEnterTimestamp=Tue 2026-09-01 10:00:00 CEST\nExecMainStatus=0\nNRestarts=2\n"
    monkeypatch.setattr(supervision.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=output, stderr=""))
    supervisor = ServiceSupervisor()
    monkeypatch.setattr(supervisor, "definitions", lambda: [{"key": "core", "name": "KingdomCore", "controllable": True}])

    status = supervisor.statuses()[0]

    assert status["provider"] == "systemd"
    assert status["unit"] == "kingdom-core.service"
    assert status["status"] == "running"
    assert status["running"] is True
    assert status["restart_count"] == 2
    assert status["controllable"] is True


def test_systemd_control_is_limited_to_the_declared_kingdom_unit(monkeypatch):
    calls = []
    supervisor = ServiceSupervisor()
    monkeypatch.setattr(supervision.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(
        supervision.subprocess, "run",
        lambda command, **kwargs: calls.append(command) or SimpleNamespace(returncode=0, stdout="", stderr=""),
    )
    monkeypatch.setattr(supervision.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(supervisor, "statuses", lambda: [{
        "key": "core", "name": "KingdomCore", "provider": "systemd", "running": True,
    }])

    result = supervisor._control_systemd("core", "restart", supervisor.statuses()[0])

    assert calls == [["/usr/bin/systemctl", "restart", "kingdom-core.service"]]
    assert result["accepted"] is True


def test_systemd_states_are_not_reduced_to_a_boolean():
    normalise = ServiceSupervisor._normalise_systemd_state
    assert normalise("activating", "start") == "starting"
    assert normalise("activating", "auto-restart") == "restarting"
    assert normalise("failed", "failed") == "degraded"
    assert normalise("inactive", "dead") == "stopped"
    assert normalise("mystery", "mystery") == "unknown"
