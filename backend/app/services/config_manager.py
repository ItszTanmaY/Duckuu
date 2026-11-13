import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any
from backend.app.core.config import settings
from backend.app.db.database import get_db
from backend.app.db.audit import log_audit_event


class PersistentConfigManager:
    """
    Sovereign State & Persistent Configuration Manager.
    Persists LLM credentials, active workspace, voice preferences, and system paths
    into SQLite app_settings and synchronizes runtime state across reboots.
    """

    def __init__(self) -> None:
        self._cached_settings: dict[str, str] = {}
        self.state_file = Path(__file__).resolve().parent.parent.parent / "cache" / "duckuu_state.json"

    async def get_all_settings(self) -> dict[str, str]:
        """Fetch all persistent key-value configuration rows from SQLite."""
        conn = await get_db()
        try:
            cursor = await conn.execute("SELECT key, value FROM app_settings")
            rows = await cursor.fetchall()
            self._cached_settings = {r["key"]: r["value"] for r in rows}
            return self._cached_settings
        except Exception as e:
            print(f"[ConfigManager] Error reading app_settings: {e}")
            return self._cached_settings
        finally:
            await conn.close()

    async def get_setting(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Fetch a specific persistent setting value from SQLite."""
        conn = await get_db()
        try:
            cursor = await conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
            row = await cursor.fetchone()
            if row:
                return row["value"]
            return default
        except Exception as e:
            print(f"[ConfigManager] Error reading setting '{key}': {e}")
            return default
        finally:
            await conn.close()

    async def set_setting(self, key: str, value: Any) -> None:
        """Upsert a single persistent setting into SQLite."""
        conn = await get_db()
        try:
            now = datetime.now(timezone.utc).isoformat()
            val_str = str(value).lower() if isinstance(value, bool) else str(value)
            await conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, val_str, now)
            )
            await conn.commit()
            self._cached_settings[key] = val_str
            self._save_state_cache()
        except Exception as e:
            print(f"[ConfigManager] Error setting '{key}': {e}")
        finally:
            await conn.close()

    async def set_settings_bulk(self, updates: dict[str, Any]) -> None:
        """Upsert multiple persistent settings in a single atomic transaction."""
        conn = await get_db()
        try:
            now = datetime.now(timezone.utc).isoformat()
            for k, v in updates.items():
                if v is None:
                    continue
                val_str = str(v).lower() if isinstance(v, bool) else str(v)
                await conn.execute(
                    """
                    INSERT INTO app_settings (key, value, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                    """,
                    (k, val_str, now)
                )
                self._cached_settings[k] = val_str
            await conn.commit()
            self._save_state_cache()
            await log_audit_event(
                category="CONFIG",
                action="BULK_UPDATE",
                status="SUCCESS",
                details={"updated_keys": list(updates.keys())}
            )
        except Exception as e:
            print(f"[ConfigManager] Error updating bulk settings: {e}")
        finally:
            await conn.close()

    def _save_state_cache(self) -> None:
        """Writes current config cache to disk as an immediate synchronous backup."""
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            # Do not write raw sensitive API keys to plain cache file, only state flags and paths
            safe_dump = {}
            for k, v in self._cached_settings.items():
                if "api_key" in k:
                    safe_dump[f"{k}_configured"] = bool(v)
                else:
                    safe_dump[k] = v
            self.state_file.write_text(json.dumps(safe_dump, indent=2), encoding="utf-8")
        except Exception:
            pass

    async def load_into_runtime(self) -> dict[str, Any]:
        """
        Hydrates all runtime singletons from SQLite on application startup:
        - settings (API keys, LLM models, provider selection, audio options)
        - workspace_context (active folder, recent workspaces)
        """
        db_settings = await self.get_all_settings()

        # 1. Hydrate LLM API Keys & Provider Settings
        settings.GROQ_API_KEY = db_settings.get("groq_api_key") or None
        settings.GEMINI_API_KEY = db_settings.get("gemini_api_key") or None
        settings.OPENAI_API_KEY = db_settings.get("openai_api_key") or None
        settings.DEEPGRAM_API_KEY = db_settings.get("deepgram_api_key") or None
        settings.ELEVENLABS_API_KEY = db_settings.get("elevenlabs_api_key") or None
        if db_settings.get("elevenlabs_voice_id"):
            settings.ELEVENLABS_VOICE_ID = db_settings["elevenlabs_voice_id"]
        if db_settings.get("ollama_model"):
            settings.OLLAMA_MODEL = db_settings["ollama_model"]
        if db_settings.get("cloud_provider"):
            settings.DEFAULT_CLOUD_PROVIDER = db_settings["cloud_provider"]
        if db_settings.get("llm_provider"):
            settings.DEFAULT_CLOUD_PROVIDER = db_settings["llm_provider"]
        if "audio_enabled" in db_settings:
            settings.AUDIO_ENABLED = db_settings["audio_enabled"].lower() == "true"
        if "pet_speed" in db_settings:
            try:
                settings.PET_SPEED = float(db_settings["pet_speed"])
            except ValueError:
                pass
        if "auto_dock" in db_settings:
            settings.AUTO_DOCK = db_settings["auto_dock"].lower() == "true"

        # 2. Hydrate Workspace Context
        from backend.app.services.workspace_context import workspace_context
        active_ws = db_settings.get("active_workspace")
        if active_ws and Path(active_ws).exists() and Path(active_ws).is_dir():
            workspace_context.active_folder = str(Path(active_ws).resolve())
        else:
            # Check if current directory or F:\PROJECTSS\DUCKUU exists
            cur_root = Path(__file__).resolve().parent.parent.parent.parent
            workspace_context.active_folder = str(cur_root.resolve())

        recent_ws_raw = db_settings.get("recent_workspaces")
        if recent_ws_raw:
            try:
                parsed_recent = json.loads(recent_ws_raw)
                if isinstance(parsed_recent, list):
                    valid_recent = [p for p in parsed_recent if isinstance(p, str) and Path(p).exists()]
                    if workspace_context.active_folder not in valid_recent:
                        valid_recent.insert(0, workspace_context.active_folder)
                    workspace_context.recent_workspaces = valid_recent[:10]
            except Exception:
                pass

        if workspace_context.active_folder not in workspace_context.recent_workspaces:
            workspace_context.recent_workspaces.insert(0, workspace_context.active_folder)

        print(f"[ConfigManager] Hydrated sovereign state into runtime:")
        print(f"  - Active Workspace: {workspace_context.active_folder}")
        print(f"  - Gemini Configured: {bool(settings.GEMINI_API_KEY)}")
        print(f"  - Groq Configured: {bool(settings.GROQ_API_KEY)}")
        print(f"  - OpenAI Configured: {bool(settings.OPENAI_API_KEY)}")

        return {
            "active_workspace": workspace_context.active_folder,
            "gemini_configured": bool(settings.GEMINI_API_KEY),
            "groq_configured": bool(settings.GROQ_API_KEY),
            "openai_configured": bool(settings.OPENAI_API_KEY),
            "ollama_model": settings.OLLAMA_MODEL
        }


config_manager = PersistentConfigManager()
