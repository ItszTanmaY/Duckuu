import sys
import io
import base64
from pathlib import Path
import pymupdf

# Ensure project root is on sys.path
_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

import asyncio
from starlette.testclient import TestClient
from backend.app.main import app
from backend.app.db.database import init_db
from backend.app.services.llm_router import llm_router


async def run_live_connection_tests():
    await init_db()
    client = TestClient(app)

    print("\n=======================================================")
    print(">>> DUCKUU END-TO-END LIVE BACKEND & ROUTER VERIFICATION <<<")
    print("=======================================================\n")

    # [1] Health Endpoints (Root, /api, /api/v1)
    print("[1/6] Verifying Multi-Prefix Health Endpoints...")
    for path in ["/health", "/api/health", "/api/v1/health"]:
        res = client.get(path)
        assert res.status_code == 200, f"Failed GET {path}: {res.status_code}"
        data = res.json()
        assert data.get("status") in ("healthy", "degraded"), f"Unexpected status: {data}"
        print(f"      OK! {path} -> {data['status']}, router={data.get('llm_router', {}).get('active_provider')}")

    # [2] Settings Endpoints (/api/settings, /api/v1/settings)
    print("\n[2/6] Verifying Settings Endpoints...")
    for path in ["/api/settings", "/api/v1/settings"]:
        res = client.get(path)
        assert res.status_code == 200, f"Failed GET {path}: {res.status_code}"
        data = res.json()
        assert "llm_provider" in data
        assert "audio_enabled" in data
        print(f"      OK! {path} -> provider={data['llm_provider']}, audio={data['audio_enabled']}")

    # [3] Chat Query Verification - KILL THE CANNED DUMMY MESSAGE
    print("\n[3/6] Verifying Chat Orchestrator for Real Queries (e.g. 'Who is the founder of Google?')...")
    
    # Create conversation first
    conv_res = client.post("/api/v1/conversations", json={"title": "Founder Query Test", "mode": "general"})
    assert conv_res.status_code == 201
    conv_id = conv_res.json()["id"]

    # Send chat query via /api/v1/chat
    chat_res = client.post("/api/v1/chat", json={
        "conversation_id": conv_id,
        "message": "Who is the founder of Google?",
        "mode": "general"
    })
    assert chat_res.status_code == 200, f"Chat failed: {chat_res.text}"
    chat_data = chat_res.json()
    reply = chat_data.get("content", "")

    print(f"      Duckuu Reply:\n      {reply[:180]}...")

    # Strict Assertions: NO CANNED FALLBACK MSG
    assert "I am operating on the local companion fallback engine because Ollama is not currently detected" not in reply, \
        "ERROR: Duckuu returned the hardcoded dummy fallback error message!"
    assert "Larry Page" in reply or "Sergey Brin" in reply or "Google was founded" in reply, \
        f"ERROR: Expected founder knowledge in reply, got: {reply}"
    print("      SUCCESS! Live knowledge answered query accurately with zero canned message!")

    # [4] PDF Summarize Endpoint (/api/v1/pdf/summarize & /api/pdf/analyze)
    print("\n[4/6] Verifying PDF Summarize & PyMuPDF Extraction Endpoints...")
    # Create a test PDF in-memory
    doc = pymupdf.open()
    p1 = doc.new_page()
    p1.insert_text((50, 72), "Deep Learning Research Notes\n")
    p1.insert_text((50, 95), "Attention mechanisms allow models to focus on dynamic input representations.\n")
    p1.insert_text((50, 115), "Transformers revolutionized Natural Language Processing and Computer Vision.\n")
    pdf_bytes = doc.tobytes()
    doc.close()

    # Test /api/v1/pdf/summarize
    files = {"file": ("deep_learning.pdf", pdf_bytes, "application/pdf")}
    pdf_res = client.post("/api/v1/pdf/summarize", files=files, data={"filename": "deep_learning.pdf"})
    assert pdf_res.status_code == 200, f"PDF summarize failed: {pdf_res.text}"
    pdf_data = pdf_res.json()
    assert pdf_data.get("success") is True
    item = pdf_data.get("item", {})
    assert item.get("page_count") == 1
    assert "summary" in item
    assert len(item.get("citations", [])) > 0
    print(f"      OK! /api/v1/pdf/summarize -> ID: {item.get('id')}, Citations: {item.get('citations')}")
    print(f"      Summary: {item.get('summary')[:100]}...")

    # [5] Voice Dictation Endpoint (/api/v1/voice/dictate & /api/voice/dictate)
    print("\n[5/6] Verifying Voice Dictation Whisper Endpoints...")
    # Generate dummy PCM audio bytes (1 second of 16kHz silence/tone)
    dummy_audio = b"\x00\x00" * 8000
    b64_audio = base64.b64encode(dummy_audio).decode("utf-8")

    voice_res = client.post("/api/v1/voice/dictate", json={
        "audio_base64": b64_audio,
        "clean_with_llm": False
    })
    assert voice_res.status_code == 200, f"Voice dictate failed: {voice_res.text}"
    voice_data = voice_res.json()
    assert "duration_ms" in voice_data
    assert "clean_text" in voice_data
    print(f"      OK! /api/v1/voice/dictate -> duration={voice_data['duration_ms']}ms, clean_text='{voice_data['clean_text']}'")

    # [6] Subjects, Assignments & PC Agent Tools Endpoints
    print("\n[6/6] Verifying Subjects, Assignments & Tools Endpoints...")
    tools_res = client.get("/api/v1/agent/tools")
    assert tools_res.status_code == 200
    tools = tools_res.json()
    tool_names = [t["name"] for t in tools]
    assert "launch_vscode" in tool_names
    assert "open_chrome" in tool_names
    assert "launch_spotify" in tool_names
    print(f"      OK! /api/v1/agent/tools -> {len(tools)} tools verified: {tool_names[:4]}")

    sub_res = client.get("/api/v1/subjects")
    assert sub_res.status_code == 200
    subjects = sub_res.json().get("subjects", [])
    print(f"      OK! /api/v1/subjects -> {len(subjects)} subjects active")

    assign_res = client.get("/api/v1/assignments")
    assert assign_res.status_code == 200
    assignments = assign_res.json().get("assignments", [])
    print(f"      OK! /api/v1/assignments -> {len(assignments)} assignments active")

    print("\n=======================================================")
    print(">>> ALL LIVE CONNECTION AND API CONTRACTS PASSED 100%! <<<")
    print("=======================================================\n")


if __name__ == "__main__":
    asyncio.run(run_live_connection_tests())
