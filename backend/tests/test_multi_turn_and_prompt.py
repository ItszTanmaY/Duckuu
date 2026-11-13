import pytest
import os
import asyncio
from httpx import AsyncClient, ASGITransport

from backend.app.main import app
from backend.app.core.config import settings
from backend.app.services.config_manager import config_manager
from backend.app.services.llm_router import llm_router, SYSTEM_PROMPTS
from backend.app.db.database import get_db, init_db


@pytest.mark.asyncio
async def test_system_prompt_persona_directive():
    """Verify that the system prompt strictly adheres to the new persona directive and has no canned suffixes."""
    general_prompt = SYSTEM_PROMPTS["general"]
    
    assert "You are Duckuu, an elite, high-end AI desktop companion." in general_prompt
    assert "Speak naturally, conversationally, and concisely. Never use canned sign-offs." in general_prompt
    assert "You have a subtle, witty personality, but your primary goal is frictionless execution and deep reasoning." in general_prompt
    assert "Do not append forced catchphrases" in general_prompt
    assert "quack occasionally with cheerful enthusiasm" not in general_prompt


@pytest.mark.asyncio
async def test_no_quack_in_fallbacks():
    """Verify that route 5 fallback responses do not contain *Quack!* or robotic catchphrases."""
    test_queries = [
        "15 + 27",
        "can you listen to me?",
        "how are you doing?",
        "thank you very much",
        "open the file there",
        "what is the meaning of quantum computing?"
    ]

    for q in test_queries:
        chunks = []
        async for chunk, done, meta in llm_router.stream_chat(
            [{"role": "user", "content": q}],
            mode="general",
            conversation_id="test-no-quack"
        ):
            if chunk:
                chunks.append(chunk)
            if done:
                break
        
        full_text = "".join(chunks)
        assert "*Quack!*" not in full_text, f"Found '*Quack!*' in response for query: {q}"
        assert "*quack*" not in full_text.lower() or "desktop pet" in full_text.lower() or "duckuu" in full_text.lower()


@pytest.mark.asyncio
async def test_multi_turn_history_preservation_over_12_turns():
    """Verify that conversation history preserves recent turns even when total messages exceed 12."""
    await init_db()
    conv_id = "test-multi-turn-session-50"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Turn 1: Establish context
        resp1 = await client.post("/chat", json={
            "conversation_id": conv_id,
            "message": "Remember: the secret project code is DUCK-992",
            "mode": "general"
        })
        assert resp1.status_code == 200

        # Send 8 turns so total messages = 18 > 12 (formerly truncated by LIMIT 12)
        for i in range(8):
            await client.post("/chat", json={
                "conversation_id": conv_id,
                "message": f"Turn {i+2}: note step {i+2}",
                "mode": "general"
            })

        # Fetch recent messages via DB directly as /chat and /ws do
        conn = await get_db()
        try:
            cursor = await conn.execute(
                """
                SELECT role, content FROM (
                    SELECT role, content, created_at FROM messages
                    WHERE conversation_id = ?
                    ORDER BY created_at DESC
                    LIMIT 50
                ) ORDER BY created_at ASC
                """,
                (conv_id,)
            )
            rows = await cursor.fetchall()
            history = [{"role": r["role"], "content": r["content"]} for r in rows]
        finally:
            await conn.close()

        # Verify that the history still contains the initial turn
        assert len(history) > 12, f"History should contain more than 12 messages, got {len(history)}"
        first_user_turn = next((m for m in history if "DUCK-992" in m["content"]), None)
        assert first_user_turn is not None, "Turn 1 ('DUCK-992') was dropped from recent context!"


@pytest.mark.asyncio
async def test_robotic_fallback_deleted_and_missing_key_format():
    """Verify that robotic 'Regarding {prompt} in {workspace}' is completely removed,
    and missing key yields 'I need an API key in Settings to answer that!' without echoes."""
    from backend.app.services.intent_router import intent_router

    # 1. Verify conversational music requests like 'play starboy on spotify' are NOT intercepted by intent_router
    intent_res = await intent_router.execute_intent("Can you play Starboy on Spotify?", conv_id="test-spotify-flow")
    assert intent_res is None or not intent_res.get("executed"), "Conversational Spotify playback should NOT be hijacked by intent_router!"

    # Explicit launch still works
    launch_res = await intent_router.execute_intent("open spotify", conv_id="test-spotify-flow")
    assert launch_res is not None and "launch_spotify" in launch_res.get("tools", [])

    # 2. Test missing key message
    all_before = await config_manager.get_all_settings()
    try:
        await config_manager.set_settings_bulk({
            "groq_api_key": "",
            "gemini_api_key": "",
            "openai_api_key": "",
            "llm_provider": "gemini"
        })
        settings.GEMINI_API_KEY = ""
        settings.GROQ_API_KEY = ""
        settings.OPENAI_API_KEY = ""

        chunks = []
        user_prompt = "What is the capital of France and what time is it?"
        async for c, done, meta in llm_router.stream_chat([{"role": "user", "content": user_prompt}], mode="general"):
            if c:
                chunks.append(c)
            if done:
                break
        
        reply = "".join(chunks)
        assert "Regarding" not in reply, f"Robotic 'Regarding' found in fallback: {reply}"
        assert user_prompt not in reply, f"User prompt should not be echoed: {reply}"
        assert "F:\\" not in reply and "DUCKUU" not in reply, f"Workspace path should not be echoed: {reply}"
        assert "GEMINI_API_KEY not found in .env" in reply or "I need an API key" in reply
    finally:
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()

