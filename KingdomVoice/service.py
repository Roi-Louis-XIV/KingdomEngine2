"""Résout les événements en pistes audio; le transport Discord reste un adaptateur."""

from __future__ import annotations

from typing import Awaitable, Callable

from KingdomData import ContentStore
from kingdomEvent import Event, EventBus


class VoiceService:
    def __init__(self, store: ContentStore, bus: EventBus, play: Callable[[str, dict], Awaitable[None]]) -> None:
        self.store, self.bus, self.play = store, bus, play
        self.unsubscribe = bus.subscribe("*", self.on_event)

    async def on_event(self, event: Event) -> None:
        for entity in self.store.list("audio", published=True):
            audio = entity["payload"]
            if event.type in audio.get("triggers", []):
                await self.play(audio["source"], {**audio, "event": event.payload})

    def close(self) -> None: self.unsubscribe()
