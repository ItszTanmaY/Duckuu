import asyncio
import os
import sys
import base64
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.app.core.config import settings
from backend.app.db.database import init_db, get_db
from backend.app.db.audit import get_audit_logs
from backend.app.services.approval_gate import approval_gate
from backend.app.services.pc_agent import pc_agent
from backend.app.services.voice_engine import voice_engine


async def test_phase2_deliverables():
    print("[1/5] Initializing SQLite and Zero-Trust Schema...")
    await init_db()
    conn = await get_db()
    cursor = await conn.execute("SELECT COUNT(*) FROM approval_rules")
    count = (await cursor.fetchone())[0]
    await conn.close()
    print(f"      OK! approval_rules table verified (count: {count})")

    print("[2/5] Testing Zero-Trust Approval Gate Blocking & Decision...")
    # Test Approve Once
    async def simulate_user_approval(req_id: str):
        await asyncio.sleep(0.15)
        success = await approval_gate.submit_decision(req_id, "once")
        assert success, "Failed to submit approval decision"

    # Launch approval request in background
    pending_task = asyncio.create_task(
        approval_gate.request_approval(
            tool_name="test_sensitive_tool",
            parameters={"target": "demo.txt"},
            risk_level="HIGH",
            description="Testing approval blocker",
            timeout_seconds=5
        )
    )

    # Allow event to be registered
    await asyncio.sleep(0.05)
    pending_list = approval_gate.get_pending_list()
    assert len(pending_list) == 1, f"Expected 1 pending request, got {len(pending_list)}"
    req_id = pending_list[0]["request_id"]
    print(f"      Intercepted sensitive execution -> Pending Request ID: {req_id}")

    # Submit decision
    await simulate_user_approval(req_id)
    approved = await pending_task
    assert approved is True, "Expected approval to return True"
    print("      OK! User decision 'once' unblocked coroutine successfully!")

    # Test Always Allow Rule
    await approval_gate.save_always_allow_rule("test_whitelisted_tool")
    auto_approved = await approval_gate.request_approval(
        tool_name="test_whitelisted_tool",
        parameters={},
        risk_level="LOW"
    )
    assert auto_approved is True, "Expected whitelisted tool to auto-approve"
    print("      OK! Persistent SQLite Always Allow rule verified!")

    # Verify audit log recorded decisions
    total, logs = await get_audit_logs(limit=10, category="APPROVAL_GATE")
    assert total >= 2, f"Expected at least 2 approval audit logs, got {total}"
    print(f"      OK! Verified {total} audit logs recorded for Approval Gate.")

    print("[3/5] Testing PC Agent Tools (Windows-native)...")
    tools = pc_agent.get_tool_definitions()
    assert len(tools) >= 7, f"Expected at least 7 PC agent tools, got {len(tools)}"
    print(f"      Verified {len(tools)} PC agent tools available.")

    # Test file search
    search_res = await pc_agent.search_files(query="duckuu", root_path=str(Path.cwd()), max_results=5)
    assert search_res["success"] is True
    print(f"      Search Files OK! Found {search_res['count']} matches for 'duckuu'.")

    # Test volume control
    vol_res = pc_agent.control_volume("get")
    print(f"      Volume Control: {vol_res}")

    # Test screen capture
    screen_res = pc_agent.capture_screen()
    assert screen_res["success"] is True, f"Screen capture failed: {screen_res}"
    assert Path(screen_res["file_path"]).exists(), "Screen capture file does not exist on disk"
    print(f"      Screen Capture OK! Captured {screen_res['width']}x{screen_res['height']} -> {screen_res['file_path']}")

    # Test active window info
    win_info = pc_agent.get_active_window()
    print(f"      Active Foreground Window: title='{win_info.get('title')}', valid={win_info.get('is_valid')}")

    print("[4/5] Testing Voice & Wispr Filler Word Stripping...")
    dirty_text = "um basically uh I want to refactor the audio streamer you know"
    clean_text = voice_engine.strip_filler_words(dirty_text)
    assert "um" not in clean_text.lower()
    assert "uh" not in clean_text.lower()
    assert "basically" not in clean_text.lower()
    print(f"      Raw text:   '{dirty_text}'")
    print(f"      Clean text: '{clean_text}'")

    # Test base64 dictation handler
    dummy_pcm = b"\x00\x00\x20\x00\x40\x00\x10\x00" * 400
    b64_audio = base64.b64encode(dummy_pcm).decode("ascii")
    dictate_res = await voice_engine.transcribe_audio_base64(b64_audio, clean_with_llm=False)
    assert "raw_text" in dictate_res
    print(f"      Dictation pipeline test completed in {dictate_res['duration_ms']}ms (RMS: {dictate_res['rms']})")

    print("[5/5] >>> ALL PHASE 2 ENGINE TESTS PASSED 100%! <<<")


if __name__ == "__main__":
    asyncio.run(test_phase2_deliverables())
