import base64
from typing import Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from backend.app.services.pc_agent import pc_agent
from backend.app.services.voice_engine import voice_engine

router = APIRouter(tags=["PC Agent & Voice"])


class ExecuteToolRequest(BaseModel):
    tool_name: str
    parameters: dict[str, Any] = Field(default_factory=dict)


class DictationRequest(BaseModel):
    audio_base64: str
    clean_with_llm: Optional[bool] = True


class WakeCheckRequest(BaseModel):
    audio_base64: str
    threshold_rms: Optional[float] = 15.0


class SpeakRequest(BaseModel):
    text: str


class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None


@router.get("/agent/tools")
async def list_agent_tools():
    return pc_agent.get_tool_definitions()


@router.post("/agent/execute")
async def execute_agent_tool(req: ExecuteToolRequest):
    tool_name = req.tool_name
    params = req.parameters

    if tool_name == "launch_vscode":
        folder_path = params.get("folder_path")
        return await pc_agent.launch_vscode(folder_path=folder_path)

    elif tool_name == "open_chrome":
        query_or_url = params.get("query_or_url", params.get("url", ""))
        is_youtube = params.get("is_youtube", False)
        return await pc_agent.open_chrome(query_or_url=query_or_url, is_youtube=is_youtube)

    elif tool_name == "launch_spotify":
        return await pc_agent.launch_spotify()

    elif tool_name == "open_app":
        app_name = params.get("app_name")
        if not app_name:
            raise HTTPException(status_code=400, detail="app_name parameter is required")
        return await pc_agent.open_app(app_name)

    elif tool_name == "open_url":
        url = params.get("url")
        if not url:
            raise HTTPException(status_code=400, detail="url parameter is required")
        return await pc_agent.open_url(url)

    elif tool_name == "open_folder":
        folder_path = params.get("folder_path")
        if not folder_path:
            raise HTTPException(status_code=400, detail="folder_path parameter is required")
        return await pc_agent.open_folder(folder_path)

    elif tool_name == "search_files":
        query = params.get("query")
        if not query:
            raise HTTPException(status_code=400, detail="query parameter is required")
        root_path = params.get("root_path")
        max_results = params.get("max_results", 15)
        return await pc_agent.search_files(query, root_path=root_path, max_results=max_results)

    elif tool_name == "control_volume":
        action = params.get("action", "get")
        level = params.get("level")
        return pc_agent.control_volume(action, level=level)

    elif tool_name == "control_media":
        action = params.get("action", "play_pause")
        return pc_agent.control_media(action)

    elif tool_name == "capture_screen":
        return pc_agent.capture_screen()

    elif tool_name == "capture_screen_context":
        query = params.get("query", "")
        monitor_index = params.get("monitor_index", 0)
        return await pc_agent.capture_screen_context(query=query, monitor_index=monitor_index)

    elif tool_name == "run_terminal_command":
        cmd = params.get("command", "")
        if not cmd:
            raise HTTPException(status_code=400, detail="command parameter is required")
        cwd = params.get("cwd")
        return await pc_agent.run_terminal_command(command=cmd, cwd=cwd)

    elif tool_name == "git_auto_commit":
        msg = params.get("message", "chore: automated commit via Duckuu")
        repo_path = params.get("repo_path")
        return await pc_agent.git_auto_commit(message=msg, repo_path=repo_path)

    elif tool_name == "organize_folder":
        folder_path = params.get("folder_path")
        if not folder_path:
            raise HTTPException(status_code=400, detail="folder_path parameter is required")
        preview_only = params.get("preview_only", True)
        return await pc_agent.organize_folder(folder_path=folder_path, preview_only=preview_only)

    elif tool_name == "create_file":
        file_path = params.get("file_path")
        if not file_path:
            raise HTTPException(status_code=400, detail="file_path parameter is required")
        content = params.get("content", "")
        return await pc_agent.create_file(file_path=file_path, content=content)

    elif tool_name == "write_file":
        file_path = params.get("file_path")
        if not file_path:
            raise HTTPException(status_code=400, detail="file_path parameter is required")
        content = params.get("content", "")
        append = params.get("append", False)
        return await pc_agent.write_file(file_path=file_path, content=content, append=append)

    elif tool_name == "delete_file":
        file_path = params.get("file_path")
        if not file_path:
            raise HTTPException(status_code=400, detail="file_path parameter is required")
        return await pc_agent.delete_file(file_path=file_path)

    elif tool_name == "create_pdf":
        title = params.get("title", "Duckuu Document")
        content = params.get("content", "")
        output_path = params.get("file_path", params.get("output_path"))
        return await pc_agent.create_pdf(title=title, content=content, output_path=output_path)

    elif tool_name == "send_whatsapp_message":
        recip = params.get("phone_or_name", params.get("recipient", ""))
        msg = params.get("message", "")
        channel = params.get("channel", "whatsapp_cloud")
        return await pc_agent.send_whatsapp_message(phone_or_name=recip, message=msg, channel=channel)

    elif tool_name == "get_active_window":
        return pc_agent.get_active_window()

    else:
        raise HTTPException(status_code=404, detail=f"Tool not found: {tool_name}")


@router.get("/agent/active-window")
async def get_active_window():
    return pc_agent.get_active_window()


@router.post("/voice/dictate")
async def transcribe_dictation(req: DictationRequest):
    return await voice_engine.transcribe_audio_base64(
        audio_base64=req.audio_base64,
        clean_with_llm=req.clean_with_llm if req.clean_with_llm is not None else True
    )


@router.post("/voice/speak")
async def voice_speak(req: SpeakRequest):
    return voice_engine.speak_text(req.text)


@router.post("/voice/tts")
async def voice_tts(req: TTSRequest):
    audio_bytes = await voice_engine.generate_tts_audio(req.text, req.voice_id)
    if audio_bytes:
        from fastapi.responses import Response
        return Response(content=audio_bytes, media_type="audio/mpeg")
    raise HTTPException(status_code=400, detail="ElevenLabs TTS not configured or failed")


@router.post("/voice/tts/stream")
async def voice_tts_stream(req: TTSRequest):
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        voice_engine.stream_tts_audio(req.text, req.voice_id),
        media_type="audio/mpeg"
    )


@router.post("/voice/wake-check")
async def check_voice_wake(req: WakeCheckRequest):
    try:
        raw_pcm = base64.b64decode(req.audio_base64)
        rms = voice_engine.calculate_audio_rms(raw_pcm)
        threshold = req.threshold_rms if req.threshold_rms is not None else 15.0
        wake = rms >= threshold
        return {
            "wake": wake,
            "rms": round(rms, 2),
            "threshold": threshold
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process audio for wake check: {e}")
