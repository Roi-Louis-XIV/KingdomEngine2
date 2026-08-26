"""Comptes KingdomWeb et droits d'acces aux serveurs Discord geres."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROLES_SERVEUR: dict[str, set[str]] = {
    "lecture": {"contenu:voir", "joueurs:voir"},
    "editeur": {"contenu:voir", "contenu:modifier", "joueurs:voir"},
    "gestionnaire": {
        "contenu:voir", "contenu:modifier", "joueurs:voir", "joueurs:modifier",
        "serveur:parametrer", "serveur:superviser", "bots:installer",
    },
    "proprietaire": {"*"},
}


class ErreurAuthentification(RuntimeError):
    pass


class ErreurAutorisation(RuntimeError):
    pass


def _maintenant() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empreinte_mot_de_passe(mot_de_passe: str, sel: bytes | None = None) -> tuple[str, str]:
    if len(mot_de_passe) < 8:
        raise ValueError("Le mot de passe doit contenir au moins 8 caracteres.")
    sel = sel or secrets.token_bytes(16)
    empreinte = hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode("utf-8"), sel, 310_000)
    return sel.hex(), empreinte.hex()


def _slug_serveur(valeur: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", valeur.lower()).strip("-")
    if len(slug) < 3:
        slug = f"serveur-{slug or secrets.token_hex(3)}"
    return slug[:48]


class RegistreComptes:
    def __init__(self, chemin: str | Path) -> None:
        self.chemin = Path(chemin)

    def connexion(self) -> sqlite3.Connection:
        self.chemin.parent.mkdir(parents=True, exist_ok=True)
        connexion = sqlite3.connect(self.chemin, timeout=15)
        connexion.row_factory = sqlite3.Row
        connexion.execute("PRAGMA foreign_keys=ON")
        connexion.execute("PRAGMA journal_mode=WAL")
        return connexion

    def initialiser(self) -> None:
        with self.connexion() as base:
            base.executescript(SCHEMA_COMPTES)
        self._creer_administrateur_initial()
        self._creer_serveur_initial()

    def _creer_administrateur_initial(self) -> None:
        identifiant = os.getenv("KINGDOM_ADMIN_USERNAME", "admin").strip().lower()
        mot_de_passe = os.getenv("KINGDOM_ADMIN_PASSWORD") or os.getenv("KINGDOM_ADMIN_TOKEN", "change-me")
        with self.connexion() as base:
            existe = base.execute("SELECT 1 FROM web_accounts WHERE is_admin=1 LIMIT 1").fetchone()
        if not existe:
            self.creer_compte(identifiant, "Administrateur du Royaume", mot_de_passe, administrateur=True)

    def _creer_serveur_initial(self) -> None:
        with self.connexion() as base:
            existe = base.execute("SELECT id FROM managed_servers ORDER BY id LIMIT 1").fetchone()
            if existe:
                return
            identifiant_discord = os.getenv("KINGDOM_GUILD_ID", "").strip()
            curseur = base.execute(
                "INSERT INTO managed_servers(slug,name,guild_id,database_path,bot_installed,active,created_at) VALUES(?,?,?,?,?,?,?)",
                ("royaume-principal", os.getenv("KINGDOM_SERVER_NAME", "Royaume principal"), identifiant_discord,
                 str(self.chemin), 1 if identifiant_discord else 0, 1, _maintenant()),
            )
            administrateur = base.execute("SELECT id FROM web_accounts WHERE is_admin=1 ORDER BY id LIMIT 1").fetchone()
            if administrateur:
                base.execute(
                    "INSERT OR IGNORE INTO server_access(account_id,server_id,role,permissions_json,created_at) VALUES(?,?,?,?,?)",
                    (administrateur["id"], curseur.lastrowid, "proprietaire", "[]", _maintenant()),
                )

    def creer_compte(self, identifiant: str, nom: str, mot_de_passe: str, *, administrateur: bool = False, email: str = "") -> dict[str, Any]:
        identifiant = identifiant.strip().lower()
        if not re.fullmatch(r"[a-z0-9_.-]{3,50}", identifiant):
            raise ValueError("L'identifiant doit contenir 3 a 50 lettres, chiffres, points, tirets ou underscores.")
        nom = nom.strip()
        email = email.strip().lower()
        if not 2 <= len(nom) <= 80:
            raise ValueError("Le nom affiché doit contenir entre 2 et 80 caractères.")
        if email and (len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)):
            raise ValueError("L'adresse e-mail n'est pas valide.")
        sel, empreinte = _empreinte_mot_de_passe(mot_de_passe)
        try:
            with self.connexion() as base:
                curseur = base.execute(
                    "INSERT INTO web_accounts(username,display_name,email,password_salt,password_hash,is_admin,active,created_at) VALUES(?,?,?,?,?,?,1,?)",
                    (identifiant, nom, email, sel, empreinte, int(administrateur), _maintenant()),
                )
                compte_id = int(curseur.lastrowid)
        except sqlite3.IntegrityError as exc:
            raise ValueError("Cet identifiant existe deja.") from exc
        return self.compte(compte_id)

    def compte(self, compte_id: int) -> dict[str, Any]:
        with self.connexion() as base:
            ligne = base.execute(
                "SELECT id,username,display_name,email,is_admin,active,created_at FROM web_accounts WHERE id=?", (compte_id,)
            ).fetchone()
        if not ligne:
            raise ErreurAuthentification("Compte introuvable.")
        return dict(ligne)

    def authentifier(self, identifiant: str, mot_de_passe: str) -> dict[str, Any]:
        with self.connexion() as base:
            ligne = base.execute("SELECT * FROM web_accounts WHERE username=? AND active=1", (identifiant.strip().lower(),)).fetchone()
        if not ligne:
            raise ErreurAuthentification("Identifiant ou mot de passe incorrect.")
        _, empreinte = _empreinte_mot_de_passe(mot_de_passe, bytes.fromhex(ligne["password_salt"]))
        if not hmac.compare_digest(empreinte, ligne["password_hash"]):
            raise ErreurAuthentification("Identifiant ou mot de passe incorrect.")
        return self.compte(int(ligne["id"]))

    def ouvrir_session(self, compte_id: int, duree_jours: int = 7) -> str:
        jeton = secrets.token_urlsafe(32)
        empreinte = hashlib.sha256(jeton.encode()).hexdigest()
        expiration = (datetime.now(timezone.utc) + timedelta(days=duree_jours)).isoformat()
        with self.connexion() as base:
            base.execute("DELETE FROM web_sessions WHERE expires_at<=?", (_maintenant(),))
            base.execute(
                "INSERT INTO web_sessions(token_hash,account_id,created_at,expires_at) VALUES(?,?,?,?)",
                (empreinte, compte_id, _maintenant(), expiration),
            )
        return jeton

    def fermer_session(self, jeton: str) -> None:
        if not jeton:
            return
        with self.connexion() as base:
            base.execute("DELETE FROM web_sessions WHERE token_hash=?", (hashlib.sha256(jeton.encode()).hexdigest(),))

    def compte_session(self, jeton: str) -> dict[str, Any] | None:
        if not jeton:
            return None
        with self.connexion() as base:
            ligne = base.execute(
                "SELECT a.id,a.username,a.display_name,a.email,a.is_admin,a.active,a.created_at "
                "FROM web_sessions s JOIN web_accounts a ON a.id=s.account_id "
                "WHERE s.token_hash=? AND s.expires_at>? AND a.active=1",
                (hashlib.sha256(jeton.encode()).hexdigest(), _maintenant()),
            ).fetchone()
        return dict(ligne) if ligne else None

    def changer_mot_de_passe(self, compte_id: int, actuel: str, nouveau: str, *, administrateur: bool = False) -> None:
        if not administrateur:
            compte = self.compte(compte_id)
            self.authentifier(compte["username"], actuel)
        sel, empreinte = _empreinte_mot_de_passe(nouveau)
        with self.connexion() as base:
            base.execute("UPDATE web_accounts SET password_salt=?,password_hash=? WHERE id=?", (sel, empreinte, compte_id))
            base.execute("DELETE FROM web_sessions WHERE account_id=?", (compte_id,))

    def lister_comptes(self) -> list[dict[str, Any]]:
        with self.connexion() as base:
            lignes = base.execute(
                "SELECT id,username,display_name,email,is_admin,active,created_at FROM web_accounts ORDER BY display_name,username"
            ).fetchall()
            total_serveurs = int(base.execute("SELECT COUNT(*) FROM managed_servers WHERE active=1").fetchone()[0])
        resultats = []
        for ligne in lignes:
            compte = dict(ligne)
            acces = self.lister_acces(int(ligne["id"]))
            compte["access"] = acces
            compte["server_count"] = total_serveurs if compte["is_admin"] else len(acces)
            compte["administered_server_count"] = total_serveurs if compte["is_admin"] else sum(
                1 for droit in acces if droit["role"] in {"gestionnaire", "proprietaire"}
            )
            resultats.append(compte)
        return resultats

    def lister_acces(self, compte_id: int) -> list[dict[str, Any]]:
        with self.connexion() as base:
            lignes = base.execute(
                "SELECT s.slug,s.name,a.role,a.permissions_json FROM server_access a JOIN managed_servers s ON s.id=a.server_id "
                "WHERE a.account_id=? ORDER BY s.name", (compte_id,)
            ).fetchall()
        resultats = []
        for ligne in lignes:
            acces = dict(ligne)
            acces["permissions"] = json.loads(acces.pop("permissions_json") or "[]")
            resultats.append(acces)
        return resultats

    def lister_serveurs(self, compte_id: int, est_administrateur: bool = False) -> list[dict[str, Any]]:
        with self.connexion() as base:
            if est_administrateur:
                lignes = base.execute(
                    "SELECT s.*,COALESCE(a.role,'administrateur') role,COALESCE(a.permissions_json,'[]') permissions_json "
                    "FROM managed_servers s LEFT JOIN server_access a ON a.server_id=s.id AND a.account_id=? WHERE s.active=1 ORDER BY s.name",
                    (compte_id,),
                ).fetchall()
            else:
                lignes = base.execute(
                    "SELECT s.*,a.role,a.permissions_json FROM managed_servers s JOIN server_access a ON a.server_id=s.id "
                    "WHERE a.account_id=? AND s.active=1 ORDER BY s.name", (compte_id,)
                ).fetchall()
        return [self._serveur_dict(ligne) for ligne in lignes]

    def serveur_autorise(self, compte: dict[str, Any], slug: str | None) -> dict[str, Any]:
        serveurs = self.lister_serveurs(int(compte["id"]), bool(compte["is_admin"]))
        serveur = next((item for item in serveurs if item["slug"] == slug), None) if slug else (serveurs[0] if serveurs else None)
        if not serveur:
            raise ErreurAutorisation("Vous n'avez acces a aucun serveur Discord.")
        return serveur

    def autorise(self, compte: dict[str, Any], serveur: dict[str, Any], permission: str) -> bool:
        if compte.get("is_admin"):
            return True
        droits = set(ROLES_SERVEUR.get(str(serveur.get("role")), set())) | set(serveur.get("permissions", []))
        return "*" in droits or permission in droits

    def creer_serveur(self, nom: str, guild_id: str, proprietaire_id: int) -> dict[str, Any]:
        nom = nom.strip()
        if len(nom) < 3:
            raise ValueError("Le nom du serveur doit contenir au moins 3 caracteres.")
        guild_id = guild_id.strip()
        if guild_id and not guild_id.isdigit():
            raise ValueError("L'identifiant Discord du serveur doit etre numerique.")
        slug_base = _slug_serveur(nom)
        slug = slug_base
        with self.connexion() as base:
            suffixe = 2
            while base.execute("SELECT 1 FROM managed_servers WHERE slug=?", (slug,)).fetchone():
                slug, suffixe = f"{slug_base[:42]}-{suffixe}", suffixe + 1
            chemin = self.chemin.parent / "servers" / f"{slug}.db"
            curseur = base.execute(
                "INSERT INTO managed_servers(slug,name,guild_id,database_path,bot_installed,active,created_at) VALUES(?,?,?,?,0,1,?)",
                (slug, nom, guild_id, str(chemin), _maintenant()),
            )
            base.execute(
                "INSERT INTO server_access(account_id,server_id,role,permissions_json,created_at) VALUES(?,?,?,?,?)",
                (proprietaire_id, curseur.lastrowid, "proprietaire", "[]", _maintenant()),
            )
        return self.serveur(slug)

    def serveur(self, slug: str) -> dict[str, Any]:
        with self.connexion() as base:
            ligne = base.execute("SELECT *, 'administrateur' role, '[]' permissions_json FROM managed_servers WHERE slug=?", (slug,)).fetchone()
        if not ligne:
            raise ErreurAutorisation("Serveur introuvable.")
        return self._serveur_dict(ligne)

    def attribuer_acces(self, compte_id: int, slug: str, role: str, permissions: list[str] | None = None) -> None:
        if role not in ROLES_SERVEUR:
            raise ValueError("Role serveur invalide.")
        with self.connexion() as base:
            serveur = base.execute("SELECT id FROM managed_servers WHERE slug=?", (slug,)).fetchone()
            if not serveur:
                raise ValueError("Serveur introuvable.")
            base.execute(
                "INSERT INTO server_access(account_id,server_id,role,permissions_json,created_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(account_id,server_id) DO UPDATE SET role=excluded.role,permissions_json=excluded.permissions_json",
                (compte_id, serveur["id"], role, json.dumps(permissions or []), _maintenant()),
            )

    def retirer_acces(self, compte_id: int, slug: str) -> None:
        with self.connexion() as base:
            serveur = base.execute("SELECT id FROM managed_servers WHERE slug=?", (slug,)).fetchone()
            if not serveur:
                raise ValueError("Serveur introuvable.")
            base.execute("DELETE FROM server_access WHERE account_id=? AND server_id=?", (compte_id, serveur["id"]))

    def progression_tutoriels(self, compte_id: int, serveur_slug: str) -> dict[str, Any]:
        """Retourne la progression pédagogique sans la mélanger aux données du monde."""
        if compte_id <= 0:
            return {"tutorials": {}, "onboarding_seen": True}
        with self.connexion() as base:
            lignes = base.execute(
                "SELECT tutorial_id,completed_steps_json,completed,dismissed,updated_at "
                "FROM tutorial_progress WHERE account_id=? AND server_slug=?",
                (compte_id, serveur_slug),
            ).fetchall()
        tutoriels = {}
        for ligne in lignes:
            item = dict(ligne)
            tutoriels[item.pop("tutorial_id")] = {
                "completed_steps": json.loads(item.pop("completed_steps_json") or "[]"),
                "completed": bool(item["completed"]), "dismissed": bool(item["dismissed"]),
                "updated_at": item["updated_at"],
            }
        return {"tutorials": tutoriels, "onboarding_seen": "welcome" in tutoriels}

    def enregistrer_progression_tutoriel(
        self, compte_id: int, serveur_slug: str, tutorial_id: str,
        completed_steps: list[str], *, completed: bool = False, dismissed: bool = False,
    ) -> dict[str, Any]:
        if compte_id <= 0:
            return {"tutorial_id": tutorial_id, "completed_steps": completed_steps,
                    "completed": completed, "dismissed": dismissed, "updated_at": _maintenant()}
        tutorial_id = re.sub(r"[^a-z0-9_-]", "", tutorial_id.lower())[:64]
        if not tutorial_id:
            raise ValueError("Tutoriel invalide.")
        etapes = list(dict.fromkeys(str(step)[:80] for step in completed_steps if str(step).strip()))[:100]
        maintenant = _maintenant()
        with self.connexion() as base:
            base.execute(
                "INSERT INTO tutorial_progress(account_id,server_slug,tutorial_id,completed_steps_json,completed,dismissed,updated_at) "
                "VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,server_slug,tutorial_id) DO UPDATE SET "
                "completed_steps_json=excluded.completed_steps_json,completed=excluded.completed,"
                "dismissed=excluded.dismissed,updated_at=excluded.updated_at",
                (compte_id, serveur_slug, tutorial_id, json.dumps(etapes), int(completed), int(dismissed), maintenant),
            )
        return {"tutorial_id": tutorial_id, "completed_steps": etapes, "completed": completed,
                "dismissed": dismissed, "updated_at": maintenant}

    def reinitialiser_tutoriel(self, compte_id: int, serveur_slug: str, tutorial_id: str) -> None:
        if compte_id <= 0:
            return
        with self.connexion() as base:
            base.execute(
                "DELETE FROM tutorial_progress WHERE account_id=? AND server_slug=? AND tutorial_id=?",
                (compte_id, serveur_slug, tutorial_id),
            )

    @staticmethod
    def _serveur_dict(ligne: sqlite3.Row) -> dict[str, Any]:
        resultat = dict(ligne)
        resultat["bot_installed"] = bool(resultat["bot_installed"])
        resultat["active"] = bool(resultat["active"])
        resultat["permissions"] = json.loads(resultat.pop("permissions_json", "[]") or "[]")
        return resultat


SCHEMA_COMPTES = """
CREATE TABLE IF NOT EXISTS web_accounts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',
 password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,is_admin INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS web_sessions(
 token_hash TEXT PRIMARY KEY,account_id INTEGER NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,
 FOREIGN KEY(account_id) REFERENCES web_accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS managed_servers(
 id INTEGER PRIMARY KEY AUTOINCREMENT,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL,guild_id TEXT NOT NULL DEFAULT '',database_path TEXT NOT NULL UNIQUE,
 bot_installed INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS managed_servers_guild ON managed_servers(guild_id) WHERE guild_id<>'';
CREATE TABLE IF NOT EXISTS server_access(
 account_id INTEGER NOT NULL,server_id INTEGER NOT NULL,role TEXT NOT NULL,permissions_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,
 PRIMARY KEY(account_id,server_id),FOREIGN KEY(account_id) REFERENCES web_accounts(id) ON DELETE CASCADE,
 FOREIGN KEY(server_id) REFERENCES managed_servers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tutorial_progress(
 account_id INTEGER NOT NULL,server_slug TEXT NOT NULL,tutorial_id TEXT NOT NULL,
 completed_steps_json TEXT NOT NULL DEFAULT '[]',completed INTEGER NOT NULL DEFAULT 0,
 dismissed INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,
 PRIMARY KEY(account_id,server_slug,tutorial_id),
 FOREIGN KEY(account_id) REFERENCES web_accounts(id) ON DELETE CASCADE
);
"""
