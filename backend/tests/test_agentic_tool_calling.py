import pytest
import os
import json
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from backend.app.services.agent_tools import agent_tools
from backend.app.services.workspace_context import workspace_context
from backend.app.services.llm_router import llm_router
from backend.app.services.config_manager import config_manager
from backend.app.db.database import init_db


def test_tool_schemas_validity():
    """Verify that OpenAI and Gemini tool schemas are properly structured."""
    openai_tools = agent_tools.get_openai_tools()
    gemini_tools = agent_tools.get_gemini_tools()

    assert len(openai_tools) >= 10
    tool_names = [t["function"]["name"] for t in openai_tools]
    assert "open_app" in tool_names
    assert "launch_vscode" in tool_names
    assert "set_workspace" in tool_names
    assert "get_workspace" in tool_names
    assert "create_file" in tool_names
    assert "read_file" in tool_names
    assert "run_terminal_command" in tool_names
    assert "git_auto_commit" in tool_names
    assert "capture_screen" in tool_names
    assert "control_media" in tool_names
    assert "control_volume" in tool_names
    assert "start_focus_timer" in tool_names
    assert "type_into_active_window" in tool_names
    assert "read_pdf" in tool_names
    assert "create_pdf" in tool_names

    # Verify Gemini declarations match
    assert len(gemini_tools) == 1
    assert "function_declarations" in gemini_tools[0]
    gemini_names = [f["name"] for f in gemini_tools[0]["function_declarations"]]
    assert set(tool_names) == set(gemini_names)


@pytest.mark.asyncio
async def test_direct_tool_execution():
    """Verify direct tool execution through agent_tools.execute_tool."""
    await init_db()
    with tempfile.TemporaryDirectory() as tmpdir:
        conv_id = "test-direct-tool-session"

        # 1. Set workspace
        set_res = await agent_tools.execute_tool(
            "set_workspace",
            {"folder_path": tmpdir},
            conv_id=conv_id
        )
        assert set_res.get("success") is True
        assert set_res.get("active_folder") == str(Path(tmpdir).resolve())

        # 2. Get workspace
        get_res = await agent_tools.execute_tool("get_workspace", {}, conv_id=conv_id)
        assert get_res.get("active_folder") == str(Path(tmpdir).resolve())

        # 3. Create file
        create_res = await agent_tools.execute_tool(
            "create_file",
            {"file_path": "test_script.py", "content": "print('hello from duckuu')"},
            conv_id=conv_id
        )
        assert create_res.get("success") is True
        test_file = Path(tmpdir) / "test_script.py"
        assert test_file.exists()
        assert "hello from duckuu" in test_file.read_text(encoding="utf-8")

        # 4. Read file
        read_res = await agent_tools.execute_tool(
            "read_file",
            {"file_path": "test_script.py"},
            conv_id=conv_id
        )
        assert read_res.get("success") is True
        assert "print('hello from duckuu')" in read_res.get("content", "")

        # 5. Ghost Typing tool (Infina.so integration)
        with patch("pyautogui.write") as mock_write, patch("pyautogui.press") as mock_press:
            type_res = await agent_tools.execute_tool(
                "type_into_active_window",
                {"text": "console.log('typed via ghost typing')", "press_enter": True},
                conv_id=conv_id
            )
            assert type_res.get("success") is True
            assert type_res.get("typed_length") == len("console.log('typed via ghost typing')")
            mock_write.assert_called_once_with("console.log('typed via ghost typing')", interval=0.005)
            mock_press.assert_called_once_with("enter")

        # 6. Create PDF and Read PDF
        with patch("backend.app.services.approval_gate.approval_gate.request_approval", return_value=True):
            pdf_res = await agent_tools.execute_tool(
                "create_pdf",
                {"title": "Agentic Briefing", "content": "Autonomous desktop companion test document"},
                conv_id=conv_id
            )
            assert pdf_res.get("success") is True
            pdf_path = pdf_res.get("file_path")
            assert pdf_path and Path(pdf_path).exists()

            # Read PDF back
            read_pdf_res = await agent_tools.execute_tool(
                "read_pdf",
                {"file_path": pdf_path},
                conv_id=conv_id
            )
            assert read_pdf_res.get("success") is True
            assert read_pdf_res.get("total_pages") >= 1
            assert "Agentic Briefing" in read_pdf_res.get("content", "")

        # 7. Unknown tool
        unknown_res = await agent_tools.execute_tool("non_existent_tool", {}, conv_id=conv_id)
        assert unknown_res.get("success") is False
        assert "Unknown tool" in unknown_res.get("error", "")


@pytest.mark.asyncio
async def test_missing_credentials_failsafe():
    """Verify that when no LLM credentials exist, stream_chat returns the exact natural error without echoing."""
    await init_db()
    all_before = await config_manager.get_all_settings()
    try:
        # Clear keys in DB
        await config_manager.set_settings_bulk({
            "gemini_api_key": "",
            "groq_api_key": "",
            "openai_api_key": "",
            "llm_provider": "gemini"
        })
        await config_manager.load_into_runtime()

        chunks = []
        async for chunk, done, meta in llm_router.stream_chat(
            [{"role": "user", "content": "Can you open Spotify and create a file in F:\\DUCKUU?"}],
            mode="general",
            conversation_id="test-no-keys"
        ):
            if chunk:
                chunks.append(chunk)
            if done:
                break

        full_response = "".join(chunks)
        assert "GEMINI_API_KEY not found in .env" in full_response or "I need an API key" in full_response
        # Absolutely NO echoed paths or prompt templates
        assert "Regarding" not in full_response
        assert "F:\\DUCKUU" not in full_response
    finally:
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()


@pytest.mark.asyncio
async def test_gemini_agentic_function_calling_flow():
    """Verify full 2-turn agentic function calling loop for Gemini."""
    await init_db()
    all_before = await config_manager.get_all_settings()
    try:
        await config_manager.set_settings_bulk({
            "gemini_api_key": "dummy-gemini-key",
            "llm_provider": "gemini",
            "gemini_model": "gemini-flash-latest"
        })
        await config_manager.load_into_runtime()

        # Turn 1 response: Gemini requests functionCall 'open_app'
        mock_tool_call_response = MagicMock()
        mock_tool_call_response.status_code = 200
        mock_tool_call_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "functionCall": {
                                    "name": "open_app",
                                    "args": {"app_name": "spotify"}
                                }
                            }
                        ]
                    }
                }
            ]
        }

        # Turn 2 response: Gemini answers conversationally after receiving tool result
        mock_final_response = MagicMock()
        mock_final_response.status_code = 200
        mock_final_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": "I've launched Spotify for you! Let me know what you'd like to play."
                            }
                        ]
                    }
                }
            ]
        }

        async def mock_post(*args, **kwargs):
            body = kwargs.get("json", {})
            contents = body.get("contents", [])
            has_func_resp = any(
                any("functionResponse" in p for p in c.get("parts", []))
                for c in contents
            )
            if has_func_resp:
                return mock_final_response
            return mock_tool_call_response

        with patch("httpx.AsyncClient.post", side_effect=mock_post), \
             patch("backend.app.services.agent_tools.pc_agent.launch_spotify", new_callable=AsyncMock) as mock_spotify:
            mock_spotify.return_value = {"success": True, "message": "Spotify launched"}

            chunks = []
            async for chunk, done, meta in llm_router.stream_chat(
                [{"role": "user", "content": "Play some tunes on spotify"}],
                mode="general",
                conversation_id="test-gemini-tool-flow"
            ):
                if chunk:
                    chunks.append(chunk)
                if done:
                    break

            full_text = "".join(chunks)
            # Assert tool was actually executed
            mock_spotify.assert_called_once()
            # Assert final response synthesized by LLM is streamed
            assert "I've launched Spotify for you!" in full_text
            assert "*Quack!*" not in full_text
    finally:
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()
