"""API FastAPI du Studio, indépendante du runtime Discord."""

from __future__ import annotations

import os
import mimetypes
import json
import logging
import secrets
import subprocess
import time
from contextlib import asynccontextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any

from fastapi import Cookie, Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from KingdomData import ConflictError, ContentStore, NotFoundError, ValidationError, SERVER_SETTINGS_KEY, get_server_settings
from KingdomData.audio_storage import audio_key, safe_audio_path, store_audio_file
from KingdomData.paths import persistent_data_root
from KingdomData.world_presets import PRESET_CATALOG, world_preset
from import_v1 import import_v1, seed_legacy_audio_catalog
from kingdomCore.provisioner import managed_bot_permissions, required_bot_permissions
from KingdomWeb.supervision import AdministrationService, ServiceSupervisor
from KingdomWeb.player_admin import PlayerAdministrationService
from KingdomWeb.item_catalog import ItemCatalogService
from KingdomWeb.discord_channels import DiscordChannelAdministrationService, DiscordChannelError
from KingdomWeb.world_creator import WorldCreatorService
from kingdomCore.world import WorldEngine, WorldError
from KingdomWeb.accounts import ErreurAuthentification, ErreurAutorisation, RegistreComptes
from seed import DEFINITIONS, REFERENCE_BUILDING
import discord

logger = logging.getLogger("KingdomWeb")
SESSION_COOKIE = "royaume_session_v2"

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
            # Une base créée depuis KingdomWeb possède déjà le modèle choisi.
            # Le seed historique ne sert qu'aux anciennes bases réellement vides.
            if not magasin.list():
                magasin.seed(DEFINITIONS)
            seed_legacy_audio_catalog(magasin)
            self._magasins[chemin] = magasin
        self._synchroniser_modeles_bots(magasin)
        self._selection.set(magasin)
        return magasin

    def _synchroniser_modeles_bots(self, magasin: ContentStore) -> None:
        """Ajoute aux royaumes secondaires les bots globaux qui leur manquent.

        Les applications Discord et leurs variables .env appartiennent à
        l'installation KingdomEngine. Chaque royaume conserve ensuite sa propre
        fiche afin de pouvoir changer bâtiment, salon et activation sans que les
        personnalisations locales soient écrasées.
        """
        if magasin.path.resolve() == self.principal.path.resolve():
            return
        batiments = {item["entity_key"] for item in magasin.list("building")}
        for modele in self.principal.list("bot", published=True):
            try:
                magasin.get("bot", modele["entity_key"])
                continue
            except NotFoundError:
                pass
            configuration = dict(modele["payload"])
            if configuration.get("bot_type") == "voice":
                # Les identifiants de salons appartiennent au serveur source.
                # Le nouveau royaume retrouvera son salon depuis le bâtiment
                # associé après provisionnement.
                configuration["voice_channel_id"] = "0"
                configuration["voice_channel_env"] = ""
                if str(configuration.get("building_key", "")) not in batiments:
                    configuration["building_key"] = ""
            brouillon = magasin.save(
                "bot", modele["entity_key"], configuration, "shared-bot-template"
            )
            magasin.publish("bot", modele["entity_key"], brouillon["version"], "shared-bot-template")

    def __getattr__(self, nom: str):
        return getattr(self._selection.get(), nom)


magasin_principal = ContentStore()
store = MagasinsServeurs(magasin_principal)
comptes = RegistreComptes(magasin_principal.path)
_inscriptions_recentes: dict[str, list[float]] = {}


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
KINGDOM_DATA_ROOT = persistent_data_root()
MAP_ASSETS = KINGDOM_DATA_ROOT / "assets" / "maps"
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
    expected = os.getenv("KINGDOM_ADMIN_TOKEN", "").strip()
    supplied = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    if expected and supplied and secrets.compare_digest(supplied, expected):
        compte = {"id": 0, "username": "legacy-admin", "display_name": "Administrateur", "is_admin": True}
        serveurs = comptes.lister_serveurs(0, True)
    else:
        compte = comptes.compte_session(royaume_session or "")
        if not compte:
            raise HTTPException(401, "Connectez-vous à KingdomWeb.")
        est_plateforme = comptes.role_plateforme(int(compte["id"])) == "platform_admin"
        serveurs = comptes.lister_serveurs(int(compte["id"]), est_plateforme)
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


async def authorize(request: Request, authorization: str | None = Header(None), royaume_session: str | None = Cookie(None, alias=SESSION_COOKIE), x_kingdom_server: str | None = Header(None)) -> dict[str, Any]:
    return _autoriser(request, authorization, royaume_session, x_kingdom_server)


async def authenticate_account(request: Request, authorization: str | None = Header(None), royaume_session: str | None = Cookie(None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    """Authentifie un compte même si aucun royaume ne lui est encore attribué."""
    expected = os.getenv("KINGDOM_ADMIN_TOKEN", "").strip()
    supplied = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    compte = ({"id": 0, "username": "legacy-admin", "display_name": "Administrateur", "email": "", "is_admin": True}
              if expected and supplied and secrets.compare_digest(supplied, expected) else comptes.compte_session(royaume_session or ""))
    if not compte:
        raise HTTPException(401, "Connectez-vous à KingdomWeb.")
    request.state.compte = compte
    return compte


# Deux dépendances distinctes préparent une future permission de consultation
# sans écriture, tout en conservant le jeton administrateur actuel.
async def authorize_player_view(request: Request, authorization: str | None = Header(None), royaume_session: str | None = Cookie(None, alias=SESSION_COOKIE), x_kingdom_server: str | None = Header(None)) -> dict[str, Any]:
    return _autoriser(request, authorization, royaume_session, x_kingdom_server, "joueurs:voir")


async def authorize_player_edit(request: Request, authorization: str | None = Header(None), royaume_session: str | None = Cookie(None, alias=SESSION_COOKIE), x_kingdom_server: str | None = Header(None)) -> dict[str, Any]:
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


@app.get("/api/world/audio-scene/{building_key}", dependencies=[Depends(authorize)])
def world_audio_scene(building_key: str):
    try: return WorldCreatorService(store).audio_scene(building_key)
    except NotFoundError as exc: raise HTTPException(404,str(exc)) from exc


@app.get("/api/world/calendar", dependencies=[Depends(authorize)])
def world_calendar(year: int | None = None, month_key: str | None = None):
    from kingdomEvent.calendar import CalendarEngine
    clock=__import__("kingdomEvent.runtime",fromlist=["WorldClock"]).WorldClock(store); config=clock._config(); state=clock.state(); calendar=CalendarEngine(config.get("calendar")); current=state["date"]
    selected_year=year or int(current["year"]); selected_month=month_key or str(current["month_key"])
    days=[day.dict() for day in calendar.month_days(selected_year,selected_month)]; forecast_by_day={int(item["day"]):item for item in state.get("forecasts",[])}
    occurrences=__import__("kingdomEvent.lifecycle",fromlist=["EventLifecycle"]).EventLifecycle(store).list()
    definitions={row["entity_key"]:row["payload"] for row in store.list("event",published=True)}
    return {"definition":calendar.definition,"current":current,"season":state.get("season"),"year":selected_year,"month_key":selected_month,"days":[{**day,"forecast":forecast_by_day.get(day["absolute_day"]),"events":[{"occurrence_id":occ["occurrence_id"],"key":occ["event_key"],"name":definitions.get(occ["event_key"],{}).get("name",occ["event_key"]),"status":occ["status"],"world_start":occ["metadata"].get("world_start"),"world_end":occ["metadata"].get("world_end")} for occ in occurrences if occ["metadata"].get("world_start_hours",10**18)//24<=day["absolute_day"]-1<=occ["metadata"].get("world_end_hours",-1)//24]} for day in days]}


@app.post("/api/events/{event_key}/schedule-world", dependencies=[Depends(authorize)])
def schedule_event_world(event_key: str, body: dict[str, Any]):
    from kingdomEvent.lifecycle import EventLifecycle
    try:return EventLifecycle(store).schedule_world(event_key,dict(body["start"]),dict(body["end"]),scope=body.get("scope"))
    except (NotFoundError,ValueError,KeyError) as exc:raise HTTPException(422,str(exc)) from exc


@app.get("/api/npcs/{npc_key}/context/{player_id}", dependencies=[Depends(authorize_player_view)])
def npc_context(npc_key:str,player_id:str):
    from kingdomCore.npc import NpcEngine
    try:return NpcEngine(store).context(npc_key,player_id)
    except (NotFoundError,ValueError) as exc:raise HTTPException(404,str(exc)) from exc


@app.post("/api/npcs/{npc_key}/react/{player_id}", dependencies=[Depends(authorize_player_edit)])
def npc_react(npc_key:str,player_id:str,body:dict[str,Any]):
    from kingdomCore.npc import NpcEngine,NpcError
    try:return NpcEngine(store).react(npc_key,player_id,str(body.get("trigger","talk")),dict(body.get("context") or {}))
    except (NotFoundError,NpcError,ValueError) as exc:raise HTTPException(422,str(exc)) from exc


@app.post("/api/npcs/{npc_key}/move", dependencies=[Depends(authorize)])
def npc_move(npc_key:str,body:dict[str,Any]):
    from kingdomCore.npc import NpcEngine
    try:return NpcEngine(store).move(npc_key,location_key=str(body.get("location_key","")),building_key=str(body.get("building_key","")))
    except (NotFoundError,ValueError) as exc:raise HTTPException(422,str(exc)) from exc


@app.get("/api/npcs/{npc_key}/dialogue/{player_id}", dependencies=[Depends(authorize_player_view)])
def npc_dialogue(npc_key:str,player_id:str,node_key:str=""):
    from kingdomCore.npc import NpcEngine,NpcError
    try:return NpcEngine(store).dialogue(npc_key,player_id,node_key)
    except (NotFoundError,NpcError) as exc:raise HTTPException(404,str(exc)) from exc


@app.post("/api/npcs/{npc_key}/dialogue/{player_id}/choose", dependencies=[Depends(authorize_player_edit)])
def npc_dialogue_choice(npc_key:str,player_id:str,body:dict[str,Any]):
    from kingdomCore.npc import NpcEngine,NpcError
    try:return NpcEngine(store).choose_dialogue(npc_key,player_id,str(body.get("node_key","")),str(body.get("choice_key","")))
    except (NotFoundError,NpcError) as exc:raise HTTPException(422,str(exc)) from exc


@app.get("/api/events/occurrences", dependencies=[Depends(authorize)])
def event_occurrences():
    from kingdomEvent.lifecycle import EventLifecycle
    return {"occurrences":EventLifecycle(store).list()}


@app.post("/api/events/{event_key}/activate", dependencies=[Depends(authorize)])
def activate_event(event_key: str, body: dict[str, Any]):
    from kingdomEvent.lifecycle import EventLifecycle
    try: return EventLifecycle(store).activate(event_key,body.get("duration_seconds"),scope=body.get("scope"))
    except (NotFoundError,ValueError) as exc: raise HTTPException(422,str(exc)) from exc


@app.post("/api/events/{event_key}/schedule", dependencies=[Depends(authorize)])
def schedule_event(event_key: str, body: dict[str, Any]):
    from kingdomEvent.lifecycle import EventLifecycle
    try: return EventLifecycle(store).schedule(event_key,float(body["scheduled_at"]),float(body["duration_seconds"]),scope=body.get("scope"))
    except (NotFoundError,ValueError,KeyError) as exc: raise HTTPException(422,str(exc)) from exc


@app.post("/api/events/occurrences/{occurrence_id}/{command}", dependencies=[Depends(authorize)])
def command_event_occurrence(occurrence_id: str, command: str, body: dict[str, Any] | None = None):
    from kingdomEvent.lifecycle import EventLifecycle
    lifecycle=EventLifecycle(store); commands={"pause":lambda:lifecycle.pause(occurrence_id),"resume":lambda:lifecycle.resume(occurrence_id),"stop":lambda:lifecycle.stop(occurrence_id),"extend":lambda:lifecycle.extend(occurrence_id,float((body or {}).get("seconds",0)))}
    if command not in commands: raise HTTPException(404,"Commande Event inconnue.")
    try: return commands[command]()
    except (LookupError,ValueError) as exc: raise HTTPException(422,str(exc)) from exc


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
    options: dict[str, Any] = {
        "httponly": True, "samesite": "strict",
        "secure": os.getenv("KINGDOM_SECURE_COOKIES", "0") == "1",
    }
    if bool(body.get("remember")):
        options["max_age"] = 7 * 24 * 3600
    response.set_cookie(SESSION_COOKIE, jeton, **options)
    return {"ok": True, "account": compte}


@app.post("/api/auth/register")
def inscription_compte(request: Request, response: Response, body: dict[str, Any]):
    if os.getenv("KINGDOM_ALLOW_REGISTRATION", "1") != "1":
        raise HTTPException(403, "La création publique de comptes est désactivée.")
    adresse = request.client.host if request.client else "unknown"
    maintenant = time.monotonic()
    tentatives = [instant for instant in _inscriptions_recentes.get(adresse, []) if maintenant - instant < 900]
    if len(tentatives) >= 5:
        raise HTTPException(429, "Trop de créations de comptes. Réessayez dans quelques minutes.")
    tentatives.append(maintenant)
    _inscriptions_recentes[adresse] = tentatives
    password = str(body.get("password", ""))
    if password != str(body.get("password_confirmation", "")):
        raise HTTPException(422, "Les deux mots de passe ne correspondent pas.")
    try:
        compte = comptes.creer_compte(
            str(body.get("username", "")), str(body.get("display_name", "")), password,
            email=str(body.get("email", "")),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    jeton = comptes.ouvrir_session(int(compte["id"]))
    response.set_cookie(
        SESSION_COOKIE, jeton, httponly=True, samesite="strict",
        secure=os.getenv("KINGDOM_SECURE_COOKIES", "0") == "1",
    )
    return {
        "ok": True,
        "account": compte,
        "message": "Compte créé et connecté. Un administrateur doit maintenant vous attribuer un serveur.",
    }


@app.post("/api/auth/logout")
def deconnexion_compte(response: Response, royaume_session: str | None = Cookie(None, alias=SESSION_COOKIE)):
    comptes.fermer_session(royaume_session or "")
    response.delete_cookie(SESSION_COOKIE)
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


@app.get("/api/profile", dependencies=[Depends(authenticate_account)])
def profil(request: Request, x_kingdom_server: str | None = Header(None)):
    compte = request.state.compte
    compte = {**compte, "platform_role": comptes.role_plateforme(int(compte["id"])) if int(compte["id"]) else ""}
    est_plateforme = bool(int(compte["id"]) and compte.get("platform_role") == "platform_admin")
    serveurs = comptes.lister_serveurs(int(compte["id"]), est_plateforme) if int(compte["id"]) else comptes.lister_serveurs(0, True)
    bots = _bots_disponibles()
    return {
        "account": compte,
        "current_server": (next((serveur["slug"] for serveur in serveurs if serveur["slug"] == x_kingdom_server), None)
                           or (serveurs[0]["slug"] if serveurs else "")),
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
    response.delete_cookie(SESSION_COOKIE)
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


async def _administrateur_plateforme(request: Request, compte: dict[str, Any] = Depends(authenticate_account)) -> dict[str, Any]:
    if int(compte.get("id", 0)) <= 0 or comptes.role_plateforme(int(compte["id"])) != "platform_admin":
        raise HTTPException(403, "Accès Payen Studio Admin requis.")
    return compte


@app.get("/platform-admin", dependencies=[Depends(_administrateur_plateforme)])
def platform_admin_page(): return FileResponse(STATIC / "platform-admin.html")


@app.get("/api/product/foundations", dependencies=[Depends(authenticate_account)])
def product_foundations(request: Request):
    return comptes.fondations_produit(int(request.state.compte["id"]))


@app.get("/api/support/grants", dependencies=[Depends(authenticate_account)])
def support_grants(request: Request):
    return {"grants": comptes.lister_assistances(int(request.state.compte["id"]))}


@app.post("/api/support/grants", dependencies=[Depends(authenticate_account)])
def create_support_grant(request: Request, body: dict[str, Any]):
    try:
        return comptes.demander_assistance(int(request.state.compte["id"]), str(body.get("world_slug", "")), list(body.get("scopes") or []), int(body.get("duration_minutes", 60)))
    except (ValueError, ErreurAutorisation) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/support/grants/{grant_id}", dependencies=[Depends(authenticate_account)])
def revoke_support_grant(grant_id: str, request: Request):
    try: return comptes.revoquer_assistance(grant_id, int(request.state.compte["id"]))
    except ErreurAutorisation as exc: raise HTTPException(404, str(exc)) from exc


@app.get("/api/platform/overview", dependencies=[Depends(_administrateur_plateforme)])
def platform_overview():
    accounts = comptes.lister_comptes()
    with comptes.connexion() as base:
        organizations = int(base.execute("SELECT COUNT(*) FROM organizations").fetchone()[0])
        worlds = int(base.execute("SELECT COUNT(*) FROM worlds WHERE status='active'").fetchone()[0])
        active_support = int(base.execute("SELECT COUNT(*) FROM support_grants WHERE status='active' AND expires_at>?", (_maintenant_for_platform(),)).fetchone()[0])
        audit = [dict(row) for row in base.execute("SELECT action,target_type,target_id,created_at FROM platform_audit ORDER BY id DESC LIMIT 30").fetchall()]
        support = [dict(row) for row in base.execute("SELECT g.grant_id,w.slug world_slug,g.scopes_json,g.expires_at,g.status,g.created_at FROM support_grants g JOIN worlds w ON w.id=g.world_id ORDER BY g.created_at DESC LIMIT 30").fetchall()]
        servers = [dict(row) for row in base.execute("SELECT slug,name,guild_id,database_path FROM managed_servers WHERE active=1 ORDER BY name").fetchall()]
    voice_worlds = []
    for server in servers:
        try:
            world_store = ContentStore(server["database_path"]); world_store.initialize()
            presences = world_store.list("voice_presence")
            voice_bots = [item for item in world_store.list("bot") if item["payload"].get("bot_type") == "voice" and item["payload"].get("enabled")]
            voice_worlds.append({"world_slug": server["slug"], "world_name": server["name"], "guild_id": server["guild_id"], "capacity": len(voice_bots), "active": sum(item["payload"].get("current_state") == "active" for item in presences), "presences": [{"key": item["entity_key"], "name": item["payload"].get("name", item["entity_key"]), "type": item["payload"].get("presence_type", "custom"), "state": item["payload"].get("current_state", "ready"), "location_key": item["payload"].get("location_key", "")} for item in presences]})
        except Exception as exc:
            voice_worlds.append({"world_slug": server["slug"], "world_name": server["name"], "guild_id": server["guild_id"], "capacity": 0, "active": 0, "presences": [], "error": type(exc).__name__})
    return {"accounts": accounts, "metrics": {"users": len(accounts), "organizations": organizations, "worlds": worlds, "active_support": active_support}, "services": ServiceSupervisor().statuses(), "voice_worlds": voice_worlds, "support": support, "audit": audit, "deployment": _deployment_summary()}


def _deployment_summary() -> dict[str, Any]:
    """Expose uniquement les métadonnées non sensibles utiles à l'exploitation."""
    root = Path(__file__).resolve().parents[1]
    result: dict[str, Any] = {"environment": os.getenv("KINGDOM_ENVIRONMENT", "Production"), "commit": "inconnu", "deployed_at": None, "status": "unknown", "message": "Aucun rapport d’auto-update disponible."}
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=root, capture_output=True, text=True, check=False, timeout=2)
        if commit.returncode == 0: result["commit"] = commit.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    report_path = root / "var" / "deployment-status.json"
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        for key in ("deployed_at", "status", "message", "version"):
            if key in report and isinstance(report[key], (str, int, float, type(None))): result[key] = report[key]
    except (OSError, json.JSONDecodeError):
        pass
    return result


def _maintenant_for_platform() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@app.get("/api/accounts", dependencies=[Depends(_administrateur_plateforme)])
def lister_comptes():
    return {"accounts": comptes.lister_comptes()}


@app.post("/api/accounts", dependencies=[Depends(_administrateur_plateforme)])
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


@app.post("/api/accounts/{account_id}/access", dependencies=[Depends(_administrateur_plateforme)])
def attribuer_acces_compte(account_id: int, body: dict[str, Any]):
    try:
        comptes.compte(account_id)
        comptes.attribuer_acces(account_id, str(body.get("server_slug", "")), str(body.get("role", "lecture")), body.get("permissions", []))
        return {"ok": True}
    except (ErreurAuthentification, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/accounts/{account_id}/access/{server_slug}", dependencies=[Depends(_administrateur_plateforme)])
def retirer_acces_compte(account_id: int, server_slug: str):
    try:
        comptes.retirer_acces(account_id, server_slug)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/world-presets", dependencies=[Depends(authenticate_account)])
def modeles_de_monde():
    return {"presets": PRESET_CATALOG}


@app.post("/api/servers", dependencies=[Depends(authenticate_account)])
def creer_serveur(request: Request, body: dict[str, Any]):
    serveur: dict[str, Any] | None = None
    try:
        compte = request.state.compte
        if int(compte["id"]) <= 0:
            raise ValueError("Le compte de compatibilité ne peut pas créer de serveur.")
        if not compte.get("is_admin"):
            limite = max(1, int(os.getenv("KINGDOM_MAX_SERVERS_PER_ACCOUNT", "10")))
            administres = sum(
                1 for serveur in comptes.lister_serveurs(int(compte["id"]))
                if serveur.get("role") in {"gestionnaire", "proprietaire"}
            )
            if administres >= limite:
                raise ValueError(f"Limite de {limite} serveurs administrés atteinte.")
        preset_key = str(body.get("preset", "blank")).strip() or "blank"
        definitions = world_preset(preset_key)
        serveur = comptes.creer_serveur(str(body.get("name", "")), str(body.get("guild_id", "")), int(request.state.compte["id"]))
        magasin = ContentStore(serveur["database_path"])
        magasin.initialize()
        magasin.seed(definitions)
        store._magasins[str(magasin.path.resolve())] = magasin
        return {**serveur, "preset": preset_key, "seeded_entities": len(definitions)}
    except (ValueError, ConflictError) as exc:
        if serveur:
            comptes.archiver_serveur(str(serveur["slug"]))
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/accounts/{account_id}", dependencies=[Depends(_administrateur_plateforme)])
def supprimer_compte_client(account_id: int, request: Request):
    try:
        return comptes.supprimer_compte(account_id, int(request.state.compte["id"]))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        if serveur:
            comptes.archiver_serveur(str(serveur["slug"]))
        logger.exception("Échec de création du monde KingdomEngine")
        raise HTTPException(
            500,
            f"Le monde n'a pas pu être initialisé ({type(exc).__name__}). Consultez les logs KingdomWeb.",
        ) from exc


@app.get("/api/content", dependencies=[Depends(authorize)])
def content(entity_type: str | None = None):
    rows = store.list(entity_type)
    # Compatibilité avec les bases créées avant que l'Atelier-école soit
    # déplacé dans l'Académie : il ne doit plus apparaître dans un royaume.
    if entity_type in (None, "building"):
        rows = [row for row in rows if not row.get("payload", {}).get("is_reference")]
    return rows


@app.get("/api/tutorials/reference-building", dependencies=[Depends(authenticate_account)])
def reference_building():
    """Retourne une copie pédagogique, indépendante du serveur sélectionné."""
    import copy
    return {
        "entity_type": "building", "entity_key": "nocode_academy",
        "version": 0, "status": "reference", "author": "KingdomEngine",
        "payload": copy.deepcopy(REFERENCE_BUILDING),
    }


@app.get("/api/content/{entity_type}/{key}", dependencies=[Depends(authorize)])
def get_content(entity_type: str, key: str):
    try: return store.get(entity_type, key)
    except NotFoundError as exc: raise HTTPException(404, str(exc)) from exc


@app.post("/api/content/{entity_type}/{key}", dependencies=[Depends(authorize)])
def save_content(entity_type: str, key: str, body: dict[str, Any]):
    payload = body.get("payload", {})
    if entity_type == "building" and (key == "nocode_academy" or payload.get("is_reference")):
        raise HTTPException(422, "Les démonstrations de l'Académie sont isolées et ne peuvent pas être enregistrées dans un royaume.")
    try: return store.save(entity_type, key, payload, body.get("author", "studio"), body.get("expected_version"))
    except (ValidationError, KeyError) as exc: raise HTTPException(422, str(exc)) from exc
    except ConflictError as exc: raise HTTPException(409, str(exc)) from exc


@app.delete("/api/content/{entity_type}/{key}", dependencies=[Depends(authorize)])
def delete_content(entity_type: str, key: str):
    try:
        result = store.delete(entity_type, key, "studio")
        if entity_type == "building":
            request_id = store.request_discord_provision("building", key, "building-deletion")
            result["discord_sync"] = {"requested": True, "request_id": request_id, "message": "Suppression Discord demandée automatiquement."}
        return result
    except NotFoundError as exc: raise HTTPException(404, str(exc)) from exc
    except ValidationError as exc: raise HTTPException(422, str(exc)) from exc


@app.post("/api/content/{entity_type}/{key}/{version}/publish", dependencies=[Depends(authorize)])
def publish_content(entity_type: str, key: str, version: int, body: dict[str, Any] | None = None):
    try:
        current = store.get(entity_type, key)
        if entity_type == "building" and (key == "nocode_academy" or current.get("payload", {}).get("is_reference")):
            raise HTTPException(422, "Une démonstration de l'Académie ne peut jamais être publiée sur Discord.")
        result = store.publish(entity_type, key, version, (body or {}).get("author", "studio"))
        if entity_type == "building":
            store.request_discord_provision("building", key, "building-publication")
            group_key = str(result["payload"].get("modules", {}).get("audio", {}).get("default_group_key", ""))
            if group_key:
                with store.connection() as db:
                    store.queue_audio(db, "set_group", key, group_key=group_key, context={"source": "KingdomWeb", "reason": "publication"})
        return result
    except NotFoundError as exc: raise HTTPException(404, str(exc)) from exc
    except ConflictError as exc: raise HTTPException(409, str(exc)) from exc


@app.get("/api/admin/discord/provision/status", dependencies=[Depends(authorize)])
def discord_provision_status():
    status = store.discord_provision_status()
    with store.connection() as db:
        channels = int(db.execute("SELECT COUNT(*) FROM building_discord_channels").fetchone()[0])
    return {**status, "installed": status.get("status") == "done", "managed_buildings": channels}


@app.post("/api/admin/discord/provision", dependencies=[Depends(authorize)])
def request_discord_provision(request: Request, body: dict[str, Any] | None = None):
    configuration = body or {}
    scope = str(configuration.get("scope", "server"))
    building_key = str(configuration.get("building_key", ""))
    if scope == "building" and not building_key:
        raise HTTPException(422, "Choisissez le bâtiment à synchroniser.")
    request_id = store.request_discord_provision(scope, building_key, f"KingdomWeb:{request.state.compte.get('username', 'admin')}")
    return {"ok": True, "request_id": request_id, "status": "pending", "scope": scope, "building_key": building_key}


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


def _publish_world_map(configuration: dict[str, Any]) -> dict[str, Any]:
    """Met à jour uniquement la carte dans les paramètres publiés du royaume."""
    current = store.get("server_settings", SERVER_SETTINGS_KEY)
    payload = get_server_settings(store)
    payload["world_map"] = {**payload.get("world_map", {}), **configuration}
    draft = store.save("server_settings", SERVER_SETTINGS_KEY, payload, "studio-world-map", current["version"])
    store.publish("server_settings", SERVER_SETTINGS_KEY, draft["version"], "studio-world-map")
    return payload["world_map"]


@app.post("/api/world/map/settings", dependencies=[Depends(authorize)])
def save_world_map(body: dict[str, Any]):
    try:
        return _publish_world_map({
            "background_path": str(body.get("background_path", "")),
            "width": int(body.get("width", 1600)),
            "height": int(body.get("height", 900)),
        })
    except (ConflictError, ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(409 if isinstance(exc, ConflictError) else 422, str(exc)) from exc


@app.post("/api/world/map/background", dependencies=[Depends(authorize)])
async def upload_world_map_background(request: Request, file: UploadFile = File(...)):
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".png", ".jpg", ".jpeg", ".webp"} or (file.content_type and not file.content_type.startswith("image/")):
        await file.close()
        raise HTTPException(422, "Choisissez une image PNG, JPG ou WEBP.")
    slug = str(getattr(request.state, "serveur", {}).get("slug") or "principal")
    target_dir = (MAP_ASSETS / slug).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"world_map{extension}"
    total = 0
    try:
        with target.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > 15 * 1024 * 1024:
                    output.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(413, "L’image de fond ne doit pas dépasser 15 Mo.")
                output.write(chunk)
        relative = target.relative_to(KINGDOM_DATA_ROOT).as_posix()
        configuration = _publish_world_map({"background_path": relative})
        return {**configuration, "background_url": "/api/world/map/background"}
    finally:
        await file.close()


@app.get("/api/world/map/background", dependencies=[Depends(authorize)])
def world_map_background():
    source = str(get_server_settings(store).get("world_map", {}).get("background_path", ""))
    root = KINGDOM_DATA_ROOT.resolve()
    path = (root / source).resolve()
    if not source or root not in path.parents or not path.is_file():
        raise HTTPException(404, "Aucune image de fond n’est configurée.")
    return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0] or "image/*", headers={"Cache-Control": "no-cache"})


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


def _serveur_administrable(compte: dict[str, Any], slug: str) -> dict[str, Any]:
    try:
        serveur = comptes.serveur_autorise(compte, slug)
    except ErreurAutorisation as exc:
        raise HTTPException(404, str(exc)) from exc
    if not comptes.autorise(compte, serveur, "bots:installer"):
        raise HTTPException(403, "Le rôle gestionnaire ou propriétaire est requis.")
    return serveur


def _magasin_serveur(serveur: dict[str, Any]) -> ContentStore:
    magasin = ContentStore(serveur["database_path"])
    magasin.initialize()
    magasin.seed(DEFINITIONS)
    if isinstance(store, MagasinsServeurs):
        store._synchroniser_modeles_bots(magasin)
    return magasin


@app.post("/api/servers/{slug}/install", dependencies=[Depends(authenticate_account)])
def installer_kingdomengine(slug: str, request: Request):
    serveur = _serveur_administrable(request.state.compte, slug)
    guild_id = str(serveur.get("guild_id", ""))
    if not guild_id.isdigit():
        raise HTTPException(422, "Renseignez d'abord l'identifiant Discord du serveur.")
    application_id = str(os.getenv("KINGDOM_APPLICATION_ID", "")).strip()
    if not application_id.isdigit():
        raise HTTPException(422, "Renseignez KINGDOM_APPLICATION_ID dans le fichier .env.")
    magasin = _magasin_serveur(serveur)
    request_id = magasin.request_discord_provision("server", requested_by=f"KingdomWeb:{request.state.compte['username']}")
    url = discord.utils.oauth_url(
        int(application_id), permissions=required_bot_permissions(), scopes=("bot",),
        guild=discord.Object(id=int(guild_id)), disable_guild_select=True,
    )
    return {"ok": True, "request_id": request_id, "status": "pending", "url": url}


@app.post("/api/servers/{slug}/uninstall", dependencies=[Depends(authenticate_account)])
def desinstaller_kingdomengine(slug: str, request: Request):
    serveur = _serveur_administrable(request.state.compte, slug)
    magasin = _magasin_serveur(serveur)
    if not serveur.get("bot_installed"):
        return {"ok": True, "status": "not_installed", "message": "KingdomCore n'est plus présent sur Discord."}
    request_id = magasin.request_discord_provision("uninstall", requested_by=f"KingdomWeb:{request.state.compte['username']}")
    return {"ok": True, "request_id": request_id, "status": "pending"}


@app.get("/api/servers/{slug}/operation", dependencies=[Depends(authenticate_account)])
def operation_serveur(slug: str, request: Request):
    serveur = _serveur_administrable(request.state.compte, slug)
    return _magasin_serveur(serveur).discord_provision_status()


@app.delete("/api/servers/{slug}", dependencies=[Depends(authenticate_account)])
def supprimer_serveur_supervise(slug: str, request: Request):
    serveur = _serveur_administrable(request.state.compte, slug)
    if serveur.get("bot_installed"):
        statut = _magasin_serveur(serveur).discord_provision_status()
        if statut.get("scope") != "uninstall" or statut.get("status") != "done":
            raise HTTPException(409, "Désinstallez d'abord KingdomEngine du serveur Discord.")
    comptes.archiver_serveur(slug)
    return {"ok": True, "message": "Le serveur n'est plus supervisé. Sa base KingdomData a été conservée."}


@app.post("/api/accounts/{account_id}/password", dependencies=[Depends(_administrateur_plateforme)])
def reinitialiser_mot_de_passe_compte(account_id: int, request: Request, body: dict[str, Any]):
    if account_id == int(request.state.compte["id"]):
        raise HTTPException(422, "Utilisez la section Sécurité du compte pour modifier votre propre mot de passe.")
    try:
        comptes.compte(account_id)
        comptes.changer_mot_de_passe(account_id, "", str(body.get("new_password", "")), administrateur=True)
        return {"ok": True, "message": "Mot de passe réinitialisé. Toutes les anciennes sessions ont été fermées."}
    except (ErreurAuthentification, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/admin/overview", dependencies=[Depends(authorize)])
def administration_overview():
    return AdministrationService(store).client_overview()


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


@app.post("/api/admin/services/{service_key}/{operation}", dependencies=[Depends(_administrateur_plateforme)])
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
    # La page Connexion Discord est aussi un outil de préparation : un bot en
    # brouillon doit donc signaler ses variables manquantes avant publication.
    for entity in store.list("bot"):
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
