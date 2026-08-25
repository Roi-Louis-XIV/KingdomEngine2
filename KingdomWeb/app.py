"""API FastAPI du Studio, indépendante du runtime Discord."""

from __future__ import annotations

import os
import mimetypes
from contextlib import asynccontextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any

from fastapi import Cookie, Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from KingdomData import ConflictError, ContentStore, NotFoundError, ValidationError, SERVER_SETTINGS_KEY, get_server_settings
from KingdomData.audio_storage import audio_key, safe_audio_path, store_audio_file
from import_v1 import import_v1, seed_legacy_audio_catalog
from kingdomCore.provisioner import managed_bot_permissions, required_bot_permissions
from KingdomWeb.supervision import AdministrationService, ServiceSupervisor
from KingdomWeb.player_admin import PlayerAdministrationService
from KingdomWeb.item_catalog import ItemCatalogService
from KingdomWeb.discord_channels import DiscordChannelAdministrationService, DiscordChannelError
from KingdomWeb.world_creator import WorldCreatorService
from kingdomCore.world import WorldEngine, WorldError
from KingdomWeb.accounts import ErreurAuthentification, ErreurAutorisation, RegistreComptes
from seed import DEFINITIONS
import discord

class MagasinsServeurs:
    """Selectionne une base KingdomData independante pour chaque serveur."""

    def __init__(self, principal: ContentStore) -> None:
        self.principal = principal
        self._selection: ContextVar[ContentStore] = ContextVar("kingdom_store", default=principal)
        self._magasins: dict[str, ContentStore] = {str(principal.path.resolve()): principal}

    def commencer_requete(self):
        return self._selection.set(self.principal)

    def finir_requete(self, jeton) -> None:
        self._selection.reset(jeton)

    def selectionner(self, serveur: dict[str, Any]) -> ContentStore:
        chemin = str(Path(serveur["database_path"]).resolve())
        magasin = self._magasins.get(chemin)
        if magasin is None:
            magasin = ContentStore(chemin)
            magasin.initialize()
            magasin.seed(DEFINITIONS)
            seed_legacy_audio_catalog(magasin)
            self._magasins[chemin] = magasin
        self._selection.set(magasin)
        return magasin

    def __getattr__(self, nom: str):
        return getattr(self._selection.get(), nom)


magasin_principal = ContentStore()
store = MagasinsServeurs(magasin_principal)
comptes = RegistreComptes(magasin_principal.path)


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
    comptes.initialiser()
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
    jeton_selection = store.commencer_requete() if isinstance(store, MagasinsServeurs) else None
    try:
        response = await call_next(request)
    finally:
        if jeton_selection is not None:
            store.finir_requete(jeton_selection)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


def _permission_requise(request: Request) -> str:
    chemin = request.url.path
    if request.method == "GET":
        return "joueurs:voir" if "/players" in chemin else "contenu:voir"
    if "/players" in chemin:
        return "joueurs:modifier"
    if "/server/settings" in chemin or "/discord/channels" in chemin:
        return "serveur:parametrer"
    if "/services/" in chemin or "/import/" in chemin:
        return "serveur:superviser"
    if "/bots/" in chemin and chemin.endswith("/invite"):
        return "bots:installer"
    return "contenu:modifier"


def _autoriser(request: Request, authorization: str | None, royaume_session: str | None, x_kingdom_server: str | None, permission: str | None = None) -> dict[str, Any]:
    expected = os.getenv("KINGDOM_ADMIN_TOKEN", "change-me")
    if authorization == f"Bearer {expected}":
        compte = {"id": 0, "username": "legacy-admin", "display_name": "Administrateur", "is_admin": True}
        serveurs = comptes.lister_serveurs(0, True)
    else:
        compte = comptes.compte_session(royaume_session or "")
        if not compte:
            raise HTTPException(401, "Connectez-vous à KingdomWeb.")
        serveurs = comptes.lister_serveurs(int(compte["id"]), bool(compte["is_admin"]))
    try:
        serveur = next((item for item in serveurs if item["slug"] == x_kingdom_server), None) if x_kingdom_server else (serveurs[0] if serveurs else None)
        if not serveur:
            raise ErreurAutorisation("Aucun serveur accessible.")
        droit = permission or _permission_requise(request)
        if not comptes.autorise(compte, serveur, droit):
            raise ErreurAutorisation(f"Permission manquante : {droit}.")
    except ErreurAutorisation as exc:
        raise HTTPException(403, str(exc)) from exc
    if isinstance(store, MagasinsServeurs):
        store.selectionner(serveur)
    request.state.compte, request.state.serveur = compte, serveur
    return compte


async def authorize(request: Request, authorization: str | None = Header(None), royaume_session: str | None = Cookie(None), x_kingdom_server: str | None = Header(None)) -> dict[str, Any]:
    return _autoriser(request, authorization, royaume_session, x_kingdom_server)


# Deux dépendances distinctes préparent une future permission de consultation
# sans écriture, tout en conservant le jeton administrateur actuel.
async def authorize_player_view(request: Request, authorization: str | None = Header(None), royaume_session: str | None = Cookie(None), x_kingdom_server: str | None = Header(None)) -> dict[str, Any]:
    return _autoriser(request, authorization, royaume_session, x_kingdom_server, "joueurs:voir")


async def authorize_player_edit(request: Request, authorization: str | None = Header(None), royaume_session: str | None = Cookie(None), x_kingdom_server: str | None = Header(None)) -> dict[str, Any]:
    return _autoriser(request, authorization, royaume_session, x_kingdom_server, "joueurs:modifier")


@app.get("/")
def index(): return FileResponse(STATIC / "index.html")


@app.get("/api/health")
def health(): return {"ok": True, "module": "KingdomWeb", "version": "2.0.0"}


@app.get("/api/world/professions", dependencies=[Depends(authorize)])
def world_professions(): return WorldCreatorService(store).professions()


@app.get("/api/world/items/{item_key}/usage", dependencies=[Depends(authorize)])
def world_item_usage(item_key: str): return WorldCreatorService(store).item_usage(item_key)


@app.post("/api/world/effective", dependencies=[Depends(authorize)])
def world_effective(body: dict[str, Any]):
    return WorldCreatorService(store).effective(float(body.get("base", 0)), str(body.get("property", "")), dict(body.get("context", {})))


@app.get("/api/world/state", dependencies=[Depends(authorize)])
def world_state(): return WorldCreatorService(store).world_state()


@app.get("/api/world/impacts", dependencies=[Depends(authorize)])
def world_impacts(): return WorldCreatorService(store).impacts()


@app.get("/api/world/locations", dependencies=[Depends(authorize)])
def world_locations(): return WorldCreatorService(store).locations()


@app.get("/api/world/geography", dependencies=[Depends(authorize)])
def world_geography(): return WorldCreatorService(store).geography()


@app.get("/api/world/players/{player_id}", dependencies=[Depends(authorize_player_view)])
def player_world_state(player_id: str):
    engine = WorldEngine(store)
    return {"state": engine.player_state(player_id), "travel": engine.get_travel_state(player_id), "routes": engine.available_routes(player_id), "activities": engine.local_activities(player_id), "buildings": engine.local_buildings(player_id), "known_destinations": engine.known_destinations(player_id)}


@app.post("/api/world/players/{player_id}/place", dependencies=[Depends(authorize_player_edit)])
def place_player(player_id: str, body: dict[str, Any]):
    try: return WorldEngine(store).place(player_id, str(body.get("location_key", "")), realm_key=str(body.get("realm_key", "")))
    except WorldError as exc: raise HTTPException(422, str(exc)) from exc


@app.post("/api/world/players/{player_id}/travel", dependencies=[Depends(authorize_player_edit)])
def travel_player(player_id: str, body: dict[str, Any]):
    try: return WorldEngine(store).travel(player_id, str(body.get("destination", "")))
    except WorldError as exc: raise HTTPException(422, str(exc)) from exc


@app.post("/api/world/players/{player_id}/discover", dependencies=[Depends(authorize_player_edit)])
def discover_route(player_id: str, body: dict[str, Any]):
    try: return WorldEngine(store).discover_route(player_id, str(body.get("route_key", "")))
    except WorldError as exc: raise HTTPException(422, str(exc)) from exc


@app.post("/api/auth/login")
def connexion_compte(body: dict[str, Any], response: Response):
    try:
        compte = comptes.authentifier(str(body.get("username", "")), str(body.get("password", "")))
    except (ErreurAuthentification, ValueError) as exc:
        raise HTTPException(401, str(exc)) from exc
    jeton = comptes.ouvrir_session(int(compte["id"]))
    response.set_cookie(
        "royaume_session", jeton, httponly=True, samesite="strict", max_age=7 * 24 * 3600,
        secure=os.getenv("KINGDOM_SECURE_COOKIES", "0") == "1",
    )
    return {"ok": True, "account": compte}


@app.post("/api/auth/logout")
def deconnexion_compte(response: Response, royaume_session: str | None = Cookie(None)):
    comptes.fermer_session(royaume_session or "")
    response.delete_cookie("royaume_session")
    return {"ok": True}


def _bots_disponibles() -> list[dict[str, Any]]:
    resultats = []
    for entity in magasin_principal.list("bot", published=True):
        configuration = entity["payload"]
        application_env = _application_id_env(configuration)
        resultats.append({
            "key": entity["entity_key"], "name": configuration.get("name", entity["entity_key"]),
            "type": configuration.get("bot_type", "text"), "enabled": bool(configuration.get("enabled")),
            "available": bool(application_env and os.getenv(application_env)),
        })
    return resultats


@app.get("/api/profile", dependencies=[Depends(authorize)])
def profil(request: Request):
    compte = request.state.compte
    serveurs = comptes.lister_serveurs(int(compte["id"]), bool(compte["is_admin"])) if int(compte["id"]) else comptes.lister_serveurs(0, True)
    bots = _bots_disponibles()
    return {
        "account": compte,
        "current_server": request.state.serveur["slug"],
        "servers": [{**serveur, "bots": [{**bot, "installed": bool(serveur["bot_installed"])} for bot in bots]} for serveur in serveurs],
    }


@app.post("/api/profile/password", dependencies=[Depends(authorize)])
def modifier_mot_de_passe(request: Request, body: dict[str, Any], response: Response):
    compte = request.state.compte
    if int(compte["id"]) == 0:
        raise HTTPException(422, "Le compte de compatibilité par jeton n'a pas de mot de passe.")
    try:
        comptes.changer_mot_de_passe(int(compte["id"]), str(body.get("current_password", "")), str(body.get("new_password", "")))
    except (ErreurAuthentification, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    response.delete_cookie("royaume_session")
    return {"ok": True, "message": "Mot de passe modifié. Reconnectez-vous."}


@app.get("/api/tutorials/progress", dependencies=[Depends(authorize)])
def tutorial_progress(request: Request):
    return comptes.progression_tutoriels(int(request.state.compte["id"]), request.state.serveur["slug"])


@app.put("/api/tutorials/progress/{tutorial_id}", dependencies=[Depends(authorize)])
def save_tutorial_progress(tutorial_id: str, request: Request, body: dict[str, Any]):
    try:
        return comptes.enregistrer_progression_tutoriel(
            int(request.state.compte["id"]), request.state.serveur["slug"], tutorial_id,
            list(body.get("completed_steps") or []), completed=bool(body.get("completed")),
            dismissed=bool(body.get("dismissed")),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/tutorials/progress/{tutorial_id}", dependencies=[Depends(authorize)])
def reset_tutorial_progress(tutorial_id: str, request: Request):
    comptes.reinitialiser_tutoriel(int(request.state.compte["id"]), request.state.serveur["slug"], tutorial_id)
    return {"ok": True}


async def _administrateur_global(request: Request, compte: dict[str, Any] = Depends(authorize)) -> dict[str, Any]:
    if not compte.get("is_admin"):
        raise HTTPException(403, "Compte administrateur requis.")
    return compte


@app.get("/api/accounts", dependencies=[Depends(_administrateur_global)])
def lister_comptes():
    return {"accounts": comptes.lister_comptes()}


@app.post("/api/accounts", dependencies=[Depends(_administrateur_global)])
def creer_compte(body: dict[str, Any]):
    try:
        compte = comptes.creer_compte(
            str(body.get("username", "")), str(body.get("display_name", "")), str(body.get("password", "")),
            administrateur=bool(body.get("is_admin", False)), email=str(body.get("email", "")),
        )
        for acces in body.get("access", []):
            comptes.attribuer_acces(int(compte["id"]), str(acces.get("server_slug", "")), str(acces.get("role", "lecture")), acces.get("permissions", []))
        return compte
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/accounts/{account_id}/access", dependencies=[Depends(_administrateur_global)])
def attribuer_acces_compte(account_id: int, body: dict[str, Any]):
    try:
        comptes.compte(account_id)
        comptes.attribuer_acces(account_id, str(body.get("server_slug", "")), str(body.get("role", "lecture")), body.get("permissions", []))
        return {"ok": True}
    except (ErreurAuthentification, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/accounts/{account_id}/access/{server_slug}", dependencies=[Depends(_administrateur_global)])
def retirer_acces_compte(account_id: int, server_slug: str):
    try:
        comptes.retirer_acces(account_id, server_slug)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/servers", dependencies=[Depends(_administrateur_global)])
def creer_serveur(request: Request, body: dict[str, Any]):
    try:
        serveur = comptes.creer_serveur(str(body.get("name", "")), str(body.get("guild_id", "")), int(request.state.compte["id"]))
        magasin = ContentStore(serveur["database_path"])
        magasin.initialize()
        magasin.seed(DEFINITIONS)
        return serveur
    except (ValueError, ConflictError) as exc:
        raise HTTPException(422, str(exc)) from exc


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
    try:
        result = store.publish(entity_type, key, version, (body or {}).get("author", "studio"))
        if entity_type == "building":
            group_key = str(result["payload"].get("modules", {}).get("audio", {}).get("default_group_key", ""))
            if group_key:
                with store.connection() as db:
                    store.queue_audio(db, "set_group", key, group_key=group_key, context={"source": "KingdomWeb", "reason": "publication"})
        return result
    except NotFoundError as exc: raise HTTPException(404, str(exc)) from exc
    except ConflictError as exc: raise HTTPException(409, str(exc)) from exc


@app.get("/api/changes", dependencies=[Depends(authorize)])
def changes(after: int = 0): return store.changes(after)


@app.post("/api/audio/upload", dependencies=[Depends(authorize)])
async def upload_audio(
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(...),
    audio_type: str = Form("sfx"),
    speaker_bot_key: str = Form(""),
    description: str = Form(""),
    tags: str = Form(""),
    volume: float = Form(0.5),
    loop: bool = Form(False),
):
    """Importe le binaire dans KingdomData et publie sa fiche dans la banque sonore."""
    base = audio_key(name or file.filename or "audio")
    key, suffix = base, 2
    while True:
        try:
            store.get("audio", key)
        except NotFoundError:
            break
        key, suffix = f"{base[:58]}_{suffix}", suffix + 1
    try:
        serveur_slug = str(getattr(request.state, "serveur", {}).get("slug", ""))
        metadata = store_audio_file(file.file, key, file.filename or f"{key}.mp3", serveur_slug)
        payload = {
            "name": name.strip(), "description": description.strip(), "emoji": "🔊",
            "audio_type": audio_type, "channel": audio_type, "speaker_bot_key": speaker_bot_key.strip(),
            "tags": [tag.strip() for tag in tags.split(",") if tag.strip()],
            "volume": volume, "loop": loop, "triggers": [], **metadata,
        }
        draft = store.save("audio", key, payload, "studio-audio")
        return store.publish("audio", key, draft["version"], "studio-audio")
    except (ValidationError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        await file.close()


@app.get("/api/audio/{key}/file", dependencies=[Depends(authorize)])
def audio_file(key: str):
    try:
        entity = store.get("audio", key)
        source = str(entity["payload"].get("storage_path", entity["payload"].get("source", "")))
        path = safe_audio_path(source)
    except (NotFoundError, ValidationError) as exc:
        raise HTTPException(404, str(exc)) from exc
    if not path.is_file():
        raise HTTPException(404, "Le fichier audio est absent de KingdomData.")
    # Sans ``filename``, Starlette sert le média en ligne au lieu de forcer un
    # téléchargement. Le lecteur HTML peut alors le parcourir et le lire.
    media_type = mimetypes.guess_type(str(entity["payload"].get("file_name") or path.name))[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, headers={"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300"})


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


@app.get("/api/admin/discord/channels/audit", dependencies=[Depends(authorize)])
def audit_discord_channels(request: Request):
    """Inventorie les doublons sans jamais modifier Discord."""
    try:
        return DiscordChannelAdministrationService(store, guild_id=str(request.state.serveur.get("guild_id", ""))).audit()
    except DiscordChannelError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/admin/discord/channels/cleanup", dependencies=[Depends(authorize)])
def cleanup_discord_channels(body: dict[str, Any], request: Request):
    """Supprime seulement les doublons revalidés après accord explicite."""
    try:
        return DiscordChannelAdministrationService(store, guild_id=str(request.state.serveur.get("guild_id", ""))).cleanup(
            [str(value) for value in body.get("channel_ids", [])], bool(body.get("confirmed", False))
        )
    except DiscordChannelError as exc:
        raise HTTPException(422, str(exc)) from exc


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
            "channel_configured": bool(config.get("building_key") or config.get("voice_channel_id") or (config.get("voice_channel_env") and os.getenv(str(config["voice_channel_env"])))),
        })
    return statuses


@app.get("/api/bots/{key}/invite", dependencies=[Depends(authorize)])
def bot_invite(key: str, request: Request):
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
    guild_id = str(getattr(request.state, "serveur", {}).get("guild_id", ""))
    options_guilde = {"guild": discord.Object(id=int(guild_id)), "disable_guild_select": True} if guild_id.isdigit() else {}
    url = discord.utils.oauth_url(int(application_id), permissions=permissions, scopes=("bot",), **options_guilde)
    return {"key": key, "name": config["name"], "url": url}
