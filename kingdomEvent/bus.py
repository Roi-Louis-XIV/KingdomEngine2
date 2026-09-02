"""Bus asynchrone typé en mémoire; remplaçable par Redis sans toucher aux consommateurs."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from uuid import uuid4


@dataclass(frozen=True, slots=True)
class Event:
    type: str
    source: str
    payload: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid4()))
    occurred_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    schema_version: int = 1


Handler = Callable[[Event], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = {}
        self._all: list[Handler] = []

    def subscribe(self, event_type: str, handler: Handler) -> Callable[[], None]:
        handlers = self._all if event_type == "*" else self._handlers.setdefault(event_type, [])
        handlers.append(handler)
        return lambda: handlers.remove(handler)

    async def publish(self, event: Event) -> None:
        handlers = [*self._all, *self._handlers.get(event.type, [])]
        if handlers:
            await asyncio.gather(*(handler(event) for handler in handlers))

