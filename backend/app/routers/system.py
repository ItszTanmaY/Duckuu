from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field
from backend.app.core.config import settings
from backend.app.db.database import get_db
from backend.app.db.audit import get_audit_logs, log_audit_event
from backend.app.services.llm_router import llm_router
from backend.app.services.config_manager import config_manager
from backend.app.services.workspace_context import workspace_context
from backend.app.routers.websocket import manager

router = APIRouter(tags=["System & Settings"])

# In-memory pet state tracker for instant REST querying
current_pet_state = {
    "emotion": "idle",
    "activity": "perching",
    "energy": 90,
    "is_grounded": True,
    "x": 300,
    "y": 600
}


class UpdateSettingsRequest(BaseModel):
    llm_provider: Optional[str] = None
    ollama_model: Optional[str] = None
    cloud_provider: Optional[str] = None
    groq_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    deepgram_api_key: Optional[str] = None
    elevenlabs_api_key: Optional[str] = None
    elevenlabs_voice_id: Optional[str] = None
    audio_enabled: Optional[bool] = None
    pet_speed: Optional[float] = None
    auto_dock: Optional[bool] = None


class SetPetStateRequest(BaseModel):
    emotion: str = Field(..., pattern="^(idle|roaming|sleeping|waking|happy|annoyed|listening|thinking|working|done|confused|vibing)$")
    activity: Optional[str] = "manual"
    energy: Optional[float] = 90.0


@router.get("/health")
@router.get("/api/health")
@router.get("/api/v1/health")
async def health_check():
    db_status = "connected"
    try:
        conn = await get_db()
        await conn.execute("SELECT 1")
        await conn.close()
    except Exception:
        db_status = "error"

    router_status = await llm_router.get_router_status()

    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "llm_router": router_status,
        "version": "1.0.0"
    }


@router.get("/api/settings")
@router.get("/api/v1/settings")
@router.get("/settings")
async def get_app_settings():
    db_settings = await config_manager.get_all_settings()

    return {
        "llm_provider": db_settings.get("llm_provider", "auto"),
        "ollama_model": db_settings.get("ollama_model", settings.OLLAMA_MODEL),
        "cloud_provider": db_settings.get("cloud_provider", settings.DEFAULT_CLOUD_PROVIDER),
        "groq_api_key_configured": bool(settings.GROQ_API_KEY or db_settings.get("groq_api_key")),
        "gemini_api_key_configured": bool(settings.GEMINI_API_KEY or db_settings.get("gemini_api_key")),
        "openai_api_key_configured": bool(settings.OPENAI_API_KEY or db_settings.get("openai_api_key")),
        "deepgram_api_key_configured": bool(settings.DEEPGRAM_API_KEY or db_settings.get("deepgram_api_key")),
        "elevenlabs_api_key_configured": bool(settings.ELEVENLABS_API_KEY or db_settings.get("elevenlabs_api_key")),
        "elevenlabs_voice_id": db_settings.get("elevenlabs_voice_id", settings.ELEVENLABS_VOICE_ID),
        "audio_enabled": db_settings.get("audio_enabled", "true") == "true",
        "pet_speed": float(db_settings.get("pet_speed", 1.0)),
        "auto_dock": db_settings.get("auto_dock", "true") == "true",
        "active_workspace": workspace_context.active_folder
    }


@router.post("/api/v1/settings")
@router.post("/settings")
@router.put("/api/settings")
@router.put("/api/v1/settings")
@router.put("/settings")
async def update_app_settings(req: UpdateSettingsRequest):
    updates = req.model_dump(exclude_unset=True)

    # 1. Update runtime settings
    if "groq_api_key" in updates and updates["groq_api_key"]:
        settings.GROQ_API_KEY = updates["groq_api_key"]
    if "gemini_api_key" in updates and updates["gemini_api_key"]:
        settings.GEMINI_API_KEY = updates["gemini_api_key"]
    if "openai_api_key" in updates and updates["openai_api_key"]:
        settings.OPENAI_API_KEY = updates["openai_api_key"]
    if "deepgram_api_key" in updates and updates["deepgram_api_key"]:
        settings.DEEPGRAM_API_KEY = updates["deepgram_api_key"]
    if "elevenlabs_api_key" in updates and updates["elevenlabs_api_key"]:
        settings.ELEVENLABS_API_KEY = updates["elevenlabs_api_key"]
    if "elevenlabs_voice_id" in updates and updates["elevenlabs_voice_id"]:
        settings.ELEVENLABS_VOICE_ID = updates["elevenlabs_voice_id"]
    if "ollama_model" in updates and updates["ollama_model"]:
        settings.OLLAMA_MODEL = updates["ollama_model"]
    if "audio_enabled" in updates and updates["audio_enabled"] is not None:
        settings.AUDIO_ENABLED = updates["audio_enabled"]
    if "pet_speed" in updates and updates["pet_speed"] is not None:
        settings.PET_SPEED = updates["pet_speed"]
    if "auto_dock" in updates and updates["auto_dock"] is not None:
        settings.AUTO_DOCK = updates["auto_dock"]

    # 2. Persist ALL updates to SQLite via ConfigManager
    await config_manager.set_settings_bulk(updates)

    # 3. Broadcast updated status badge to connected frontend windows
    router_status = await llm_router.get_router_status()
    await manager.broadcast({
        "type": "ONLINE_STATUS_BADGE",
        "is_online": router_status["is_online"],
        "provider": router_status["active_provider"],
        "model": router_status["model"]
    })

    return await get_app_settings()


@router.get("/api/audit")
@router.get("/api/v1/audit")
@router.get("/audit")
async def list_audit_logs(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    category: Optional[str] = None
):
    total, logs = await get_audit_logs(limit=limit, offset=offset, category=category)
    return {"total": total, "logs": logs}


@router.get("/api/pet/state")
@router.get("/api/v1/pet/state")
@router.get("/pet/state")
async def get_pet_state():
    return current_pet_state


@router.post("/api/pet/state")
@router.post("/api/v1/pet/state")
@router.post("/pet/state")
async def set_pet_state(req: SetPetStateRequest):
    current_pet_state["emotion"] = req.emotion
    if req.activity:
        current_pet_state["activity"] = req.activity
    if req.energy is not None:
        current_pet_state["energy"] = req.energy

    await manager.broadcast({
        "type": "PET_STATE_CHANGE",
        "emotion": req.emotion,
        "reason": "api_direct_set"
    })

    return current_pet_state
