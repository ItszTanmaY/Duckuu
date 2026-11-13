import asyncio
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

# Ensure project root is on sys.path
_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

sys.stdout.reconfigure(encoding="utf-8")

from backend.app.main import app
from backend.app.db.database import init_db, get_db
from backend.app.services.pc_agent import pc_agent
from backend.app.services.student_triage import student_triage
from backend.app.services.deadline_scheduler import deadline_scheduler
from backend.app.services.approval_gate import approval_gate

client = TestClient(app)


async def run_study_and_os_agent_tests():
    print("=== [DUCKUU EXPANSION: STUDY HUB & UNIVERSAL OS AGENT TEST] ===")

    # 1. Initialize Database & Seed
    await init_db()
    print("[OK] Step 1: SQLite schema initialized with subjects & study_triage_feed")

    # 2. Test Subjects API
    sub_res = client.get("/api/subjects")
    assert sub_res.status_code == 200, sub_res.text
    subjects = sub_res.json().get("subjects", [])
    assert len(subjects) >= 4, f"Expected at least 4 seeded subjects, got {len(subjects)}"
    sub_names = [s["name"] for s in subjects]
    assert "Deep Learning" in sub_names
    assert "Natural Language Processing" in sub_names
    print(f"[OK] Step 2: GET /api/subjects -> Found {len(subjects)} BTech CSE subjects: {sub_names[:3]}")

    # Add a new custom subject
    new_sub = client.post("/api/subjects", json={
        "name": "Computer Vision & GANs",
        "code": "CS408",
        "semester": "Sem 6",
        "instructor": "Dr. Roy",
        "color": "rose"
    })
    assert new_sub.status_code == 200
    print("[OK] Step 2b: POST /api/subjects -> Added CS408: Computer Vision & GANs")

    # 3. Test Personal Assignments CRUD & /api/v1/assignments compatibility
    due_16h = (datetime.now(timezone.utc) + timedelta(hours=16)).isoformat()
    assign_payload = {
        "title": "Lab 3: Backpropagation & CNNs from Scratch",
        "subject": "Deep Learning",
        "description": "Implement forward and backward pass for 2-layer CNN",
        "due_date": due_16h,
        "priority": "urgent",
        "status": "pending",
        "notes": "Remember to visualize kernel weights"
    }

    # Test create on /api/assignments
    res_assign = client.post("/api/assignments", json=assign_payload)
    assert res_assign.status_code == 200, res_assign.text
    assign_data = res_assign.json()
    assign_id = assign_data["assignment"]["id"]
    print(f"[OK] Step 3a: POST /api/assignments -> Created assignment '{assign_data['assignment']['title']}' (ID: {assign_id})")

    # Test /api/v1/assignments compatibility alias
    res_v1 = client.get("/api/v1/assignments")
    assert res_v1.status_code == 200, res_v1.text
    v1_items = res_v1.json().get("assignments", [])
    assert any(a["id"] == assign_id for a in v1_items), "Assignment must be retrievable from /api/v1/assignments"
    print(f"[OK] Step 3b: GET /api/v1/assignments -> Verified V1 endpoint compatibility ({len(v1_items)} assignments)")

    # Test status update
    update_res = client.put(f"/api/assignments/{assign_id}", json={"status": "in_progress"})
    assert update_res.status_code == 200
    get_res = client.get(f"/api/assignments/{assign_id}")
    assert get_res.status_code == 200
    assert get_res.json()["assignment"]["status"] == "in_progress"
    print(f"[OK] Step 3c: PUT /api/assignments/{assign_id} -> Status updated to 'in_progress'")

    # 4. Test Class Group Ingestion & Triage
    chat_sample = (
        "Prof. Sharma [Class Rep Group]:\n"
        "Important announcement for Natural Language Processing!\n"
        "Assignment 4 on Word2Vec and Attention is due tomorrow at 11:59 PM.\n"
        "Please submit your notebooks on Moodle."
    )
    triage_res = client.post("/api/assignments/triage/ingest", json={
        "raw_text": chat_sample,
        "source": "telegram_rep_group"
    })
    assert triage_res.status_code == 200, triage_res.text
    triage_data = triage_res.json()
    assert triage_data["items_detected"] >= 1
    detected_item = triage_data["items"][0]
    print(f"[OK] Step 4a: POST /api/assignments/triage/ingest -> Extracted: '{detected_item['title']}' for '{detected_item['subject']}' ({detected_item['urgency']})")

    # Verify feed retrieval
    feed_res = client.get("/api/assignments/triage/feed?status=pending")
    assert feed_res.status_code == 200
    feed_items = feed_res.json().get("feed", [])
    assert len(feed_items) >= 1
    triage_id = feed_items[0]["id"]
    print(f"[OK] Step 4b: GET /api/assignments/triage/feed -> Found {len(feed_items)} triage items in SQLite feed")

    # Convert triage item directly into a personal assignment
    conv_res = client.post(f"/api/assignments/triage/{triage_id}/convert")
    assert conv_res.status_code == 200, conv_res.text
    conv_data = conv_res.json()
    assert conv_data["success"] is True
    print(f"[OK] Step 4c: POST /api/assignments/triage/{triage_id}/convert -> Converted into task (ID: {conv_data['assignment_id']})")

    # 5. Test Deadline Urgency Scheduler
    alerts = await deadline_scheduler.check_deadlines_now()
    assert len(alerts) >= 1, f"Expected at least 1 deadline alert, got {len(alerts)}"
    urgent_titles = [al["title"] for al in alerts]
    print(f"[OK] Step 5: APScheduler detected {len(alerts)} urgent deadlines (<24h): {urgent_titles}")

    # 6. Test Universal OS & Media Control Tools
    print("\n--- Testing Universal PC Agent OS & Media Tools ---")

    # 6a. Media control keystrokes
    media_play = pc_agent.control_media("play_pause")
    assert media_play["success"] is True
    media_next = pc_agent.control_media("next")
    assert media_next["success"] is True
    media_prev = pc_agent.control_media("prev")
    assert media_prev["success"] is True
    media_pause = pc_agent.control_media("pause")
    assert media_pause["success"] is True
    print(f"[OK] Step 6a: Virtual Media keystrokes tested: play_pause, next, prev, pause (all success)")

    # 6b. Volume control
    vol_res = pc_agent.control_volume("get")
    assert "volume_percent" in vol_res
    print(f"[OK] Step 6b: pycaw master volume control -> Current level: {vol_res['volume_percent']}%, Muted: {vol_res['is_muted']}")

    # 6c. Screen capture
    cap_res = pc_agent.capture_screen()
    assert cap_res["success"] is True
    print(f"[OK] Step 6c: Screen capture verified -> Path: {cap_res['file_path']} ({cap_res['width']}x{cap_res['height']})")

    # 6d. Tool definitions listing
    tools = pc_agent.get_tool_definitions()
    tool_names = [t["name"] for t in tools]
    assert "launch_vscode" in tool_names
    assert "open_chrome" in tool_names
    assert "launch_spotify" in tool_names
    assert "control_media" in tool_names
    assert "control_volume" in tool_names
    print(f"[OK] Step 6d: Tool definitions verified ({len(tools)} tools registered: {tool_names})")

    # 7. Clean up test records
    client.delete(f"/api/assignments/{assign_id}")
    client.delete(f"/api/assignments/{conv_data['assignment_id']}")
    print("[OK] Step 7: Test assignments cleaned up")

    print("\nALL EXPANSION & CORRECTION TESTS PASSED WITH 100% SUCCESS!")


if __name__ == "__main__":
    asyncio.run(run_study_and_os_agent_tests())
