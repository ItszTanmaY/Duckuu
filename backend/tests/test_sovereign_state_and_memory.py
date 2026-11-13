import pytest
import os
import asyncio
import json
from httpx import AsyncClient, ASGITransport

from backend.app.main import app
from backend.app.core.config import settings
from backend.app.services.config_manager import config_manager
from backend.app.services.workspace_context import workspace_context
from backend.app.services.llm_router import llm_router
from backend.app.db.database import get_db, init_db


@pytest.mark.asyncio
async def test_persistent_config_manager_lifecycle():
    """Verify that settings are saved to SQLite and survive runtime reload."""
    await init_db()
    all_before = await config_manager.get_all_settings()

    try:
        # Save test settings into SQLite persistent store
        test_key = "test_gemini_key_persistent_998877"
        await config_manager.set_setting("gemini_api_key", test_key)
        await config_manager.set_setting("llm_provider", "gemini")

        # Read back from database directly
        db_val = await config_manager.get_setting("gemini_api_key")
        assert db_val == test_key, f"Expected {test_key}, got {db_val}"

        # Verify load_into_runtime updates core settings object
        await config_manager.load_into_runtime()
        assert settings.GEMINI_API_KEY == test_key
        assert settings.DEFAULT_CLOUD_PROVIDER == "gemini"
    finally:
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()


@pytest.mark.asyncio
async def test_workspace_context_resolution_and_persistence():
    """Verify sibling project discovery, resolution, and SQLite persistence."""
    # Sibling project discovery
    projects = workspace_context.get_available_projects()
    assert isinstance(projects, list)
    project_names = [p["name"].lower() for p in projects]

    # Resolve folder path by name (case-insensitive fuzzy match)
    duckuu_path = workspace_context.resolve_folder_path("duckuu")
    assert duckuu_path is not None
    assert os.path.isdir(str(duckuu_path))

    # If CyberPredator exists in F:\PROJECTSS, resolve it
    if "cyberpredator" in project_names:
        resolved_cp = workspace_context.resolve_folder_path("CyberPredator")
        assert resolved_cp is not None
        assert "cyberpredator" in str(resolved_cp).lower()

    # Test setting workspace and persisting to SQLite
    res = await workspace_context.set_workspace(folder_path=str(duckuu_path))
    assert res["success"] is True
    assert res["active_folder"] == str(duckuu_path)

    # Check persistence in SQLite
    persisted_folder = await config_manager.get_setting("active_workspace")
    assert persisted_folder == str(duckuu_path)


@pytest.mark.asyncio
async def test_smart_llm_router_failsafe_message():
    """Verify that unconfigured LLM yields the exact structured failsafe message without hanging."""
    # Temporarily unset keys in DB and runtime to simulate unconfigured state
    all_before = await config_manager.get_all_settings()

    try:
        await config_manager.set_settings_bulk({
            "groq_api_key": "",
            "gemini_api_key": "",
            "openai_api_key": "",
            "llm_provider": "groq"
        })
        settings.DEFAULT_CLOUD_PROVIDER = "groq"
        settings.GROQ_API_KEY = ""
        settings.GEMINI_API_KEY = ""
        settings.OPENAI_API_KEY = ""

        status = await llm_router.get_router_status()
        assert status.get("missing_credentials") is True
        assert status["is_online"] is False

        chunks = []
        async for chunk, done, meta in llm_router.stream_chat([{"role": "user", "content": "Hello"}], mode="general"):
            if chunk:
                chunks.append(chunk)
            if done:
                break

        full_reply = "".join(chunks)
        assert "GEMINI_API_KEY not found in .env" in full_reply or "I need an API key" in full_reply

    finally:
        # Restore original settings
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()


@pytest.mark.asyncio
async def test_rest_api_endpoints_end_to_end():
    """Test REST endpoints for workspace, settings persistence, and recent conversation hydration."""
    all_before = await config_manager.get_all_settings()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Test GET /workspace
            resp = await client.get("/workspace")
            assert resp.status_code == 200
            data = resp.json()
            assert "active_folder" in data
            assert "available_projects" in data
            assert isinstance(data["available_projects"], list)

            # 2. Test PUT /settings saves to SQLite
            update_payload = {
                "gemini_api_key": "AIzaSyTestKeyPersistent123456",
                "llm_provider": "gemini",
                "audio_enabled": True
            }
            resp = await client.put("/settings", json=update_payload)
            assert resp.status_code == 200

            # Verify persisted in DB
            db_key = await config_manager.get_setting("gemini_api_key")
            assert db_key == "AIzaSyTestKeyPersistent123456"

            # 3. Test POST /chat and GET /conversations/recent hydration
            chat_req = {
                "conversation_id": "test-sovereign-session-id",
                "message": "Who is the founder of Google?",
                "mode": "general"
            }
            chat_resp = await client.post("/chat", json=chat_req)
            assert chat_resp.status_code == 200
            chat_data = chat_resp.json()
            assert "content" in chat_data
            assert len(chat_data["content"]) > 0

            # Test GET /conversations/recent hydrates session
            recent_resp = await client.get("/conversations/recent")
            assert recent_resp.status_code == 200
            recent_data = recent_resp.json()
            assert recent_data["conversation"] is not None
            assert recent_data["conversation"]["id"] == "test-sovereign-session-id"
            assert len(recent_data["messages"]) >= 2
    finally:
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()
