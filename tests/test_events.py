import asyncio
from kingdomEvent import Event, EventBus


def test_bus_dispatches_typed_event():
    received=[];bus=EventBus()
    async def handler(event): received.append(event.type)
    bus.subscribe("forest.chopped",handler)
    asyncio.run(bus.publish(Event("forest.chopped","test")))
    assert received==["forest.chopped"]
