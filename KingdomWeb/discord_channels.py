"""Audit et nettoyage prudent des salons Discord gérés par KingdomEngine."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from KingdomData import get_server_settings
from kingdomCore.provisioner import channel_slug


class DiscordChannelError(RuntimeError):
    pass


class DiscordRestClient:
    """Client REST minimal : KingdomWeb n'ouvre pas une seconde connexion Gateway."""

    def __init__(self, token: str, guild_id: str) -> None:
        self.token, self.guild_id = token.strip(), guild_id.strip()

    def _request(self, path: str, method: str = "GET", reason: str = "") -> Any:
        headers = {"Authorization": f"Bot {self.token}", "User-Agent": "KingdomEngine2/2.0"}
        if reason:
            headers["X-Audit-Log-Reason"] = quote(reason[:512])
        request = Request(f"https://discord.com/api/v10{path}", headers=headers, method=method)
        try:
            with urlopen(request, timeout=15) as response:
                content = response.read()
                return json.loads(content) if content else None
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise DiscordChannelError(f"Discord a refusé l'opération ({exc.code}) : {detail[:300]}") from exc
        except (URLError, TimeoutError) as exc:
            raise DiscordChannelError(f"Discord est injoignable : {exc}") from exc

    def channels(self) -> list[dict[str, Any]]:
        return self._request(f"/guilds/{self.guild_id}/channels")

    def delete_channel(self, channel_id: str) -> None:
        self._request(f"/channels/{channel_id}", "DELETE", "Doublon validé depuis KingdomWeb")


class DiscordChannelAdministrationService:
    def __init__(self, store: Any, client: Any | None = None, guild_id: str = "") -> None:
        self.store = store
        token = os.getenv("KINGDOM_CORE_TOKEN", "")
        resolved_guild_id = guild_id.strip() or os.getenv("KINGDOM_GUILD_ID", "").strip()
        self.guild_id = resolved_guild_id
        self.client = client or (DiscordRestClient(token, resolved_guild_id) if token.strip() and resolved_guild_id else None)

    @staticmethod
    def _oldest(channels: list[dict[str, Any]]) -> dict[str, Any] | None:
        return min(channels, key=lambda item: int(item["id"])) if channels else None

    def audit(self) -> dict[str, Any]:
        if self.client is None:
            return {"configured": False, "guild_id": self.guild_id, "duplicate_count": 0,
                    "stale_mapping_count": 0, "buildings": [],
                    "message": "KINGDOM_CORE_TOKEN et KINGDOM_GUILD_ID doivent être renseignés."}
        channels = self.client.channels()
        by_id = {str(item["id"]): item for item in channels}
        categories = [item for item in channels if int(item.get("type", -1)) == 4]
        settings = get_server_settings(self.store)["discord"]
        results: list[dict[str, Any]] = []
        safe_ids: set[str] = set()

        for entity in self.store.list("building", published=True):
            key, payload = entity["entity_key"], entity["payload"]
            if payload.get("is_reference"):
                continue
            name = str(payload.get("name") or key)
            category_name = str(settings["building_category_template"]).format(name=name)[:100]
            text_name = channel_slug(str(settings["building_text_channel"]).format(name=name))
            voice_name = str(settings["building_voice_channel_template"]).format(name=name)[:100]
            # Discord accepte librement les emojis dans les noms. Le moteur
            # compare donc leur forme lisible (accents, emojis et séparateurs
            # ignorés), tout en affichant le nom réel à l'administrateur.
            matching_categories = [item for item in categories if channel_slug(str(item.get("name", ""))) == channel_slug(category_name)]
            mapping = self.store.building_channels(key)
            mapped_category = by_id.get(str(mapping.get("category_id", "")))
            canonical_category = mapped_category if mapped_category in matching_categories else self._oldest(matching_categories)
            canonical_category_id = str(canonical_category["id"]) if canonical_category else ""

            def matching(kind: int, expected_name: str) -> list[dict[str, Any]]:
                return [item for item in channels if int(item.get("type", -1)) == kind and channel_slug(str(item.get("name", ""))) == channel_slug(expected_name)
                        and str(item.get("parent_id") or "") in {str(cat["id"]) for cat in matching_categories}]

            texts, voices = matching(0, text_name), matching(2, voice_name)
            mapped_text = by_id.get(str(mapping.get("text_channel_id", "")))
            mapped_voice = by_id.get(str(mapping.get("voice_channel_id", "")))
            canonical_text = mapped_text if mapped_text in texts and str(mapped_text.get("parent_id")) == canonical_category_id else self._oldest([x for x in texts if str(x.get("parent_id")) == canonical_category_id])
            canonical_voice = mapped_voice if mapped_voice in voices and str(mapped_voice.get("parent_id")) == canonical_category_id else self._oldest([x for x in voices if str(x.get("parent_id")) == canonical_category_id])
            kept_ids = {str(x["id"]) for x in (canonical_text, canonical_voice) if x}
            duplicates: list[dict[str, Any]] = []
            for item in texts + voices:
                if str(item["id"]) not in kept_ids:
                    duplicate = self._view(item, True, "Même nom et même type que le salon géré")
                    duplicates.append(duplicate); safe_ids.add(duplicate["id"])

            protected: list[dict[str, Any]] = []
            duplicate_categories = [cat for cat in matching_categories if str(cat["id"]) != canonical_category_id]
            exact_duplicate_ids = {item["id"] for item in duplicates}
            for category in duplicate_categories:
                children = [item for item in channels if str(item.get("parent_id") or "") == str(category["id"])]
                manual = [item for item in children if str(item["id"]) not in exact_duplicate_ids]
                if manual:
                    protected.extend(self._view(item, False, "Salon non reconnu, conservé par sécurité") for item in manual)
                    duplicates.append(self._view(category, False, "Catégorie conservée car elle contient des salons non gérés"))
                else:
                    duplicate = self._view(category, True, "Catégorie en double, vide après nettoyage")
                    duplicates.append(duplicate); safe_ids.add(duplicate["id"])

            canonical = {"category_id": canonical_category_id,
                         "text_channel_id": str(canonical_text["id"]) if canonical_text else "",
                         "voice_channel_id": str(canonical_voice["id"]) if canonical_voice else ""}
            stale = any(str(mapping.get(field, "")) != value for field, value in canonical.items())
            results.append({"key": key, "name": name,
                            "expected": {"category": category_name, "text": text_name, "voice": voice_name},
                            "canonical": canonical, "duplicates": duplicates, "protected": protected,
                            "stale_mapping": stale})
        return {"configured": True, "guild_id": self.guild_id, "duplicate_count": len(safe_ids),
                "stale_mapping_count": sum(bool(item["stale_mapping"]) for item in results),
                "safe_channel_ids": sorted(safe_ids, key=int), "buildings": results}

    @staticmethod
    def _view(channel: dict[str, Any], safe: bool, reason: str) -> dict[str, Any]:
        labels = {0: "texte", 2: "vocal", 4: "catégorie"}
        return {"id": str(channel["id"]), "name": str(channel.get("name", "")),
                "type": labels.get(int(channel.get("type", -1)), "autre"),
                "parent_id": str(channel.get("parent_id") or ""), "safe": safe, "reason": reason}

    def cleanup(self, channel_ids: list[str], confirmed: bool) -> dict[str, Any]:
        if not confirmed:
            raise DiscordChannelError("La confirmation administrateur est obligatoire.")
        audit = self.audit()
        if not audit["configured"]:
            raise DiscordChannelError(audit["message"])
        requested = {str(value) for value in channel_ids}
        safe = set(audit["safe_channel_ids"])
        forbidden = requested - safe
        if forbidden:
            raise DiscordChannelError("Salons refusés car ils ne sont pas des doublons sûrs : " + ", ".join(sorted(forbidden)))
        types = {item["id"]: item["type"] for building in audit["buildings"] for item in building["duplicates"]}
        ordered = sorted(requested, key=lambda cid: (types.get(cid) == "catégorie", int(cid)))
        for channel_id in ordered:
            self.client.delete_channel(channel_id)
        now = datetime.now(timezone.utc).isoformat()
        with self.store.connection() as db:
            for building in audit["buildings"]:
                canonical = building["canonical"]
                db.execute(
                    "INSERT INTO building_discord_channels(building_key,category_id,text_channel_id,voice_channel_id,updated_at) VALUES(?,?,?,?,?) "
                    "ON CONFLICT(building_key) DO UPDATE SET category_id=excluded.category_id,text_channel_id=excluded.text_channel_id,voice_channel_id=excluded.voice_channel_id,updated_at=excluded.updated_at",
                    (building["key"], canonical["category_id"], canonical["text_channel_id"], canonical["voice_channel_id"], now),
                )
        return {"ok": True, "deleted": ordered, "deleted_count": len(ordered),
                "message": "Redémarrez KingdomVoice pour appliquer immédiatement les associations corrigées."}
