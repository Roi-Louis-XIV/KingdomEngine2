"""Pool générique de ressources Discord vocales.

Ce module ne dépend pas de discord.py afin que l'allocation, les quotas et la
libération restent testables sans connexion réelle. Le bot manager constitue
l'adaptateur Discord et applique ensuite le résultat de l'allocation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class VoiceProfile:
    key: str
    provider: str = "files"
    language: str = ""
    volume: float = 1.0
    categories: dict[str, list[str]] = field(default_factory=dict)
    fallback_profile_key: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class VoicePresence:
    key: str
    name: str
    presence_type: str = "custom"
    source_key: str = ""
    avatar_url: str = ""
    voice_profile_key: str = ""
    scene_key: str = ""
    priority: int = 0
    location_key: str = ""
    assignment_mode: str = "on_demand"
    release_timeout_seconds: int = 30
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.presence_type not in {"npc", "ambience", "custom"}:
            raise ValueError("Type de présence vocale invalide.")


@dataclass(slots=True)
class VoiceWorkerState:
    key: str
    guild_id: str = ""
    state: str = "free"
    channel_id: str = ""
    presence_key: str = ""
    scene_key: str = ""
    last_activity: str = field(default_factory=_now)
    error: str = ""

    @property
    def free(self) -> bool:
        return self.state == "free" and not self.presence_key


class VoiceWorkerPool:
    """Alloue au plus ``max_concurrent_voice_presences`` workers à la fois."""

    def __init__(self, workers: list[VoiceWorkerState] | None = None, *, max_concurrent_voice_presences: int | None = None) -> None:
        self.workers = {worker.key: worker for worker in (workers or [])}
        physical_capacity = len(self.workers)
        requested = physical_capacity if max_concurrent_voice_presences is None else max(0, int(max_concurrent_voice_presences))
        self.max_concurrent_voice_presences = min(physical_capacity, requested)

    def register(self, worker: VoiceWorkerState) -> None:
        self.workers[worker.key] = worker
        if self.max_concurrent_voice_presences == 0:
            self.max_concurrent_voice_presences = len(self.workers)

    def allocate(self, presence: VoicePresence, *, guild_id: str = "", channel_id: str = "") -> VoiceWorkerState | None:
        existing = next((worker for worker in self.workers.values() if worker.presence_key == presence.key), None)
        if existing:
            existing.guild_id = guild_id or existing.guild_id; existing.channel_id = channel_id or existing.channel_id; existing.last_activity = _now()
            return existing
        active = sum(not worker.free for worker in self.workers.values())
        if active >= self.max_concurrent_voice_presences:
            return None
        worker = next((candidate for candidate in self.workers.values() if candidate.free), None)
        if worker is None:
            return None
        worker.state = "assigned"; worker.presence_key = presence.key; worker.guild_id = guild_id
        worker.channel_id = channel_id; worker.scene_key = presence.scene_key; worker.last_activity = _now(); worker.error = ""
        return worker

    def release(self, *, presence_key: str = "", worker_key: str = "") -> VoiceWorkerState | None:
        worker = self.workers.get(worker_key) if worker_key else next((item for item in self.workers.values() if item.presence_key == presence_key), None)
        if not worker: return None
        worker.state = "free"; worker.channel_id = ""; worker.presence_key = ""; worker.scene_key = ""; worker.last_activity = _now(); worker.error = ""
        return worker

    def fail(self, worker_key: str, error: Exception | str) -> None:
        worker = self.workers[worker_key]; worker.state = "error"; worker.error = str(error)[:500]; worker.last_activity = _now()

    def snapshot(self) -> dict[str, Any]:
        active = sum(not worker.free for worker in self.workers.values())
        return {"capacity": len(self.workers), "quota": self.max_concurrent_voice_presences, "active": active, "available": max(0, self.max_concurrent_voice_presences - active), "workers": [
            {"key": worker.key, "state": worker.state, "guild_id": worker.guild_id, "channel_id": worker.channel_id, "presence_key": worker.presence_key, "scene_key": worker.scene_key, "last_activity": worker.last_activity, "error": worker.error}
            for worker in self.workers.values()
        ]}
