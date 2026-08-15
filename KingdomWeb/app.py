"""API FastAPI du Studio, indépendante du runtime Discord."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from KingdomData import ConflictError, ContentStore, NotFoundError, ValidationError, SERVER_SETTINGS_KEY, get_server_settings
from import_v1 import import_v1
from kingdomCore.provisioner import managed_bot_permissions, required_bot_permissions
from KingdomWeb.supervision import AdministrationService, ServiceSupervisor
from KingdomWeb.player_admin import PlayerAdministrationService
from KingdomWeb.item_catalog import ItemCatalogService
from seed import DEFINITIONS
import discord

store = ContentStore()


def _application_id_env(config: dict[str, Any]) -> str:
    configured = str(config.get("application_id_env", "")).strip()
    if configured:
        return configured
    token_env = str(config.get("token_env", "")).strip()
    if token_env == "KINGDOM_CORE_TOKEN":
        return "KINGDOM_APPLICATION_ID"
    if token_env.endswith("_BOT_TOKEN"):
        return token_env.removesuffix("_BOT_TOKEN") + "_APPLICATION_ID"
    return ""


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.initialize()
    store.seed(DEFINITIONS)
    import_v1(store)
    yield


app = FastAPI(title="Kingdom Studio", version="2.0.0", lifespan=lifespan)
STATIC = Path(__file__).with_name("static")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def disable_studio_cache(request, call_next):
    """Le Studio évolue vite : ne jamais conserver une ancienne interface JS."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


def authorize(authorization: str | None = Header(None)) -> None:
    expected = os.getenv("KINGDOM_ADMIN_TOKEN", "change-me")
    if authorization != f"Bearer {expected}": raise HTTPException(401, "Jeton administrateur invalide.")


# Deux dépendances distinctes préparent une future permission de consultation
# sans écriture, tout en conservant le jeton administrateur actuel.
def authorize_player_view(authorization: str | None = Header(None)) -> None:
    authorize(authorization)


def authorize_player_edit(authorization: str | None = Header(None)) -> None:
    authorize(authorization)


@app.get("/")
def index(): return FileResponse(STATIC / "index.html")


@app.get("/api/health")
def health(): return {"ok": True, "module": "KingdomWeb", "version": "2.0.0"}


@app.get("/api/content", dependencies=[Depends(authorize)])
def content(entity_type: str | None = None): return store.list(entity_type)


@app.get("/api/content/{entity_type}/{key}", dependencies=[Depends(authorize)])
def get_content(entity_type: str, key: str):
    try: return store.get(entity_type, key)
    except NotFoundError as exc: raise HTTPException(404, str(exc)) from exc


@app.post("/api/content/{entity_type}/{key}", dependencies=[Depends(authorize)])
def save_content(entity_type: str, key: str, body: dict[str, Any]):
    try: return store.save(entity_type, key, body["payload"], body.get("author", "studio"), body.get("expected_version"))
    except (ValidationError, KeyError) as exc: raise HTTPException(422, str(exc)) from exc
    except ConflictError as exc: raise HTTPException(409, str(exc)) from exc


@app.delete("/api/content/{entity_type}/{key}", dependencies=[Depends(authorize)])
def delete_content(entity_type: str, key: str):
    try: return store.delete(entity_type, key, "studio")
    except NotFoundError as exc: raise HTTPException(404, str(exc)) from exc
    except ValidationError as exc: raise HTTPException(422, str(exc)) from exc


@app.post("/api/content/{entity_type}/{key}/{version}/publish", dependencies=[Depends(authorize)])
def publish_content(entity_type: str, key: str, version: int, body: dict[str, Any] | None = None):
    try: return store.publish(entity_type, key, version, (body or {}).get("author", "studio"))
    except NotFoundError as exc: raise HTTPException(404, str(exc)) from exc
    except ConflictError as exc: raise HTTPException(409, str(exc)) from exc


@app.get("/api/changes", dependencies=[Depends(authorize)])
def changes(after: int = 0): return store.changes(after)


@app.get("/api/server/settings", dependencies=[Depends(authorize)])
def server_settings():
    entity = store.get("server_settings", SERVER_SETTINGS_KEY)
    return {**entity, "payload": get_server_settings(store)}


@app.post("/api/server/settings", dependencies=[Depends(authorize)])
def save_server_settings(body: dict[str, Any]):
    try:
        draft = store.save(
            "server_settings", SERVER_SETTINGS_KEY, body["payload"],
            body.get("author", "studio-settings"), body.get("expected_version"),
        )
        return store.publish("server_settings", SERVER_SETTINGS_KEY, draft["version"], body.get("author", "studio-settings"))
    except (ValidationError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/admin/overview", dependencies=[Depends(authorize)])
def administration_overview():
    return AdministrationService(store).overview()


@app.get("/api/admin/items", dependencies=[Depends(authorize_player_view)])
def admin_item_catalog(search: str = "", category: str = "", building: str = "", sort: str = "name_asc"):
    return ItemCatalogService(store).catalog(search, category, building, sort)


def _player_error(exc: Exception) -> HTTPException:
    return HTTPException(404 if isinstance(exc, NotFoundError) else 422, str(exc))


@app.get("/api/admin/players", dependencies=[Depends(authorize_player_view)])
def list_admin_players(search: str = "", profession: str = "", status: str = "", sort: str = "recent", page: int = 1, page_size: int = 25):
    return PlayerAdministrationService(store).list_players(search, profession, status, sort, page, page_size)


@app.get("/api/admin/players/{player_id}", dependencies=[Depends(authorize_player_view)])
def get_admin_player(player_id: str):
    try: return PlayerAdministrationService(store).player(player_id)
    except (NotFoundError, ValidationError) as exc: raise _player_error(exc) from exc


def _admin_id(value: str | None) -> str:
    return (value or "kingdomweb-admin").strip()[:100]


@app.post("/api/admin/players/{player_id}/resources", dependencies=[Depends(authorize_player_edit)])
def mutate_player_resource(player_id: str, body: dict[str, Any], x_kingdom_admin: str | None = Header(None)):
    try: return PlayerAdministrationService(store).resource(player_id, body, _admin_id(x_kingdom_admin))
    except (NotFoundError, ValidationError, ValueError, TypeError) as exc: raise _player_error(exc) from exc


@app.post("/api/admin/players/{player_id}/inventory", dependencies=[Depends(authorize_player_edit)])
def mutate_player_inventory(player_id: str, body: dict[str, Any], x_kingdom_admin: str | None = Header(None)):
    try: return PlayerAdministrationService(store).inventory(player_id, body, _admin_id(x_kingdom_admin))
    except (NotFoundError, ValidationError, ValueError, TypeError) as exc: raise _player_error(exc) from exc


@app.post("/api/admin/players/{player_id}/professions", dependencies=[Depends(authorize_player_edit)])
def mutate_player_profession(player_id: str, body: dict[str, Any], x_kingdom_admin: str | None = Header(None)):
    try: return PlayerAdministrationService(store).profession(player_id, body, _admin_id(x_kingdom_admin))
    except (NotFoundError, ValidationError, ValueError, TypeError) as exc: raise _player_error(exc) from exc


@app.post("/api/admin/players/{player_id}/tools", dependencies=[Depends(authorize_player_edit)])
def mutate_player_tool(player_id: str, body: dict[str, Any], x_kingdom_admin: str | None = Header(None)):
    try: return PlayerAdministrationService(store).tool(player_id, body, _admin_id(x_kingdom_admin))
    except (NotFoundError, ValidationError, ValueError, TypeError) as exc: raise _player_error(exc) from exc


@app.post("/api/admin/players/{player_id}/activities/{activity_id}", dependencies=[Depends(authorize_player_edit)])
def mutate_player_activity(player_id: str, activity_id: int, body: dict[str, Any], x_kingdom_admin: str | None = Header(None)):
    try: return PlayerAdministrationService(store).activity(player_id, activity_id, body, _admin_id(x_kingdom_admin))
    except (NotFoundError, ValidationError, ValueError, TypeError) as exc: raise _player_error(exc) from exc


@app.post("/api/admin/players/{player_id}/cooldowns/reset", dependencies=[Depends(authorize_player_edit)])
def reset_player_cooldown(player_id: str, body: dict[str, Any], x_kingdom_admin: str | None = Header(None)):
    try: return PlayerAdministrationService(store).reset_cooldown(player_id, body, _admin_id(x_kingdom_admin))
    except (NotFoundError, ValidationError, ValueError, TypeError) as exc: raise _player_error(exc) from exc


@app.post("/api/admin/services/{service_key}/{operation}", dependencies=[Depends(authorize)])
def control_service(service_key: str, operation: str):
    try:
        return ServiceSupervisor().control(service_key, operation)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/import/v1", dependencies=[Depends(authorize)])
def import_legacy_content():
    return {"ok": True, "imported": import_v1(store), "message": "Import V1 terminé sans écraser les définitions existantes."}


@app.get("/api/bots/status", dependencies=[Depends(authorize)])
def bot_statuses():
    statuses = []
    for entity in store.list("bot", published=True):
        config = entity["payload"]
        token_env = str(config.get("token_env", ""))
        statuses.append({
            "key": entity["entity_key"],
            "name": config["name"],
            "type": config.get("bot_type", "text"),
            "application_id_env": _application_id_env(config),
            "application_id_configured": bool(
                _application_id_env(config) and os.getenv(_application_id_env(config))
            ),
            "enabled": bool(config.get("enabled")),
            "token_env": token_env,
            "token_configured": bool(token_env and os.getenv(token_env)),
            "channel_configured": bool(config.get("voice_channel_id") or (config.get("voice_channel_env") and os.getenv(str(config["voice_channel_env"])))),
        })
    return statuses


@app.get("/api/bots/{key}/invite", dependencies=[Depends(authorize)])
def bot_invite(key: str):
    try:
        entity = store.get("bot", key)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    config = entity["payload"]
    application_id_env = _application_id_env(config)
    application_id = str(os.getenv(application_id_env, "")).strip()
    # Compatibilité avec les fiches créées avant le passage aux variables .env.
    if not application_id:
        application_id = str(config.get("application_id", "")).strip()
    if not application_id.isdigit():
        label = application_id_env or "la variable APPLICATION_ID du bot"
        raise HTTPException(422, f"Renseignez {label} dans le fichier .env, puis redémarrez KingdomWeb.")
    permissions = managed_bot_permissions() if config.get("bot_type") == "voice" else required_bot_permissions()
    url = discord.utils.oauth_url(int(application_id), permissions=permissions, scopes=("bot",))
    return {"key": key, "name": config["name"], "url": url}
