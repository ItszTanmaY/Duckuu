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

client = TestClient(app)


def test_phase4_api_suite():
    print("=== [PHASE 4 REST API VERIFICATION SUITE] ===")

    # 1. Create a student
    student_payload = {
        "name": "Maria Gonzales",
        "phone": "+14155557788",
        "email": "maria@cs.edu",
        "course_batch": "ENG-202",
        "tags": ["embedded", "robotics"],
        "preferred_channel": "whatsapp_deeplink"
    }
    res = client.post("/api/students", json=student_payload)
    assert res.status_code == 200, res.text
    student_data = res.json()
    assert student_data["success"] is True
    maria_id = student_data["student"]["id"]
    print(f"✓ Step 1: POST /api/students -> Created student ID {maria_id}")

    # 2. List students
    res = client.get("/api/students?batch=ENG-202")
    assert res.status_code == 200
    list_data = res.json()
    assert any(s["id"] == maria_id for s in list_data["students"])
    print(f"✓ Step 2: GET /api/students?batch=ENG-202 -> Found Maria in student list")

    # 3. CSV Batch Import
    csv_text = "Dave Miller, +14155553344, dave@cs.edu, ENG-202, whatsapp_deeplink\nElena Rostova, +14155554455, elena@cs.edu, ENG-202, whatsapp_cloud"
    res = client.post("/api/students/import-csv", json={"csv_text": csv_text, "default_batch": "ENG-202"})
    assert res.status_code == 200
    import_data = res.json()
    assert import_data["imported_count"] == 2
    print(f"✓ Step 3: POST /api/students/import-csv -> Imported {import_data['imported_count']} students")

    # 4. Create Assignment
    due_tomorrow = (datetime.now(timezone.utc) + timedelta(hours=18)).isoformat()
    assign_payload = {
        "title": "Robotics Lab 2: Inverse Kinematics",
        "description": "Calculate 3-DOF robotic arm angles",
        "course_batch": "ENG-202",
        "due_date": due_tomorrow,
        "priority": "high",
        "status": "pending"
    }
    res = client.post("/api/assignments", json=assign_payload)
    assert res.status_code == 200
    assign_data = res.json()
    assert assign_data["success"] is True
    a_id = assign_data["assignment"]["id"]
    assert assign_data["assignment"]["assigned_students"] >= 3
    print(f"✓ Step 4: POST /api/assignments -> Created assignment, auto-assigned to {assign_data['assignment']['assigned_students']} students")

    # 5. Get Assignment Details & Students
    res = client.get(f"/api/assignments/{a_id}")
    assert res.status_code == 200
    details = res.json()
    assert details["total_assigned"] >= 3
    assert details["pending_count"] >= 3
    print(f"✓ Step 5: GET /api/assignments/{a_id} -> {details['total_assigned']} assigned, {details['pending_count']} pending")

    # 6. Draft Reminders via REST
    res = client.post("/api/students/draft-reminders", json={"course_batch": "ENG-202"})
    assert res.status_code == 200
    drafts_data = res.json()
    assert drafts_data["total_drafts"] >= 3
    print(f"✓ Step 6: POST /api/students/draft-reminders -> Drafted {drafts_data['total_drafts']} personalized reminders")

    # 7. Check Deadlines via REST
    res = client.post("/api/assignments/check-deadlines")
    assert res.status_code == 200
    alerts_data = res.json()
    assert alerts_data["alerts_found"] >= 1
    print(f"✓ Step 7: POST /api/assignments/check-deadlines -> Found {alerts_data['alerts_found']} urgent deadline alerts")

    # 8. Update Student Submission
    res = client.put(
        f"/api/assignments/{a_id}/students/{maria_id}",
        json={"submission_status": "submitted"}
    )
    assert res.status_code == 200
    sub_data = res.json()
    assert sub_data["submission_status"] == "submitted"
    print(f"✓ Step 8: PUT /api/assignments/.../students/{maria_id} -> Submission marked 'submitted'")

    # 9. Clean up test assignment and student
    res = client.delete(f"/api/assignments/{a_id}")
    assert res.status_code == 200
    res = client.delete(f"/api/students/{maria_id}")
    assert res.status_code == 200
    print("✓ Step 9: Cleaned up test records")

    print("\n🎉 ALL PHASE 4 REST API TESTS PASSED WITH 100% SUCCESS!")


if __name__ == "__main__":
    test_phase4_api_suite()
