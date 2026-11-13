import asyncio
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Ensure project root is on sys.path
_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# Safe console output for Windows cp1252
sys.stdout.reconfigure(encoding="utf-8")

from backend.app.db.database import init_db, get_db
from backend.app.services.student_drafter import student_drafter
from backend.app.services.messaging_dispatcher import messaging_dispatcher
from backend.app.services.deadline_scheduler import deadline_scheduler
from backend.app.services.approval_gate import approval_gate


async def run_phase4_tests():
    print("=== [PHASE 4 E2E VERIFICATION TEST] ===")

    # 1. Initialize Database
    await init_db()
    conn = await get_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    due_12h = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()

    try:
        # Clean previous test entries
        await conn.execute("DELETE FROM student_assignments")
        await conn.execute("DELETE FROM assignments")
        await conn.execute("DELETE FROM students")
        await conn.commit()
        print("✓ Step 1: Clean test sandbox initialized")

        # 2. Test Student Creation
        s_id = "test-student-alex"
        await conn.execute(
            """
            INSERT INTO students (id, name, phone, email, course_batch, tags, preferred_channel, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (s_id, "Alex Rivera", "+14155552671", "alex@example.com", "CS101-A", '["honors"]', "whatsapp_deeplink", now_iso, now_iso)
        )
        await conn.commit()
        print("✓ Step 2: Student 'Alex Rivera' created in SQLite")

        # 3. Test Assignment Creation & Auto-Mapping
        a_id = "test-assign-raytracer"
        await conn.execute(
            """
            INSERT INTO assignments (id, title, description, course_batch, due_date, priority, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (a_id, "Project 1: Raytracer", "Implement sphere ray-casting", "CS101-A", due_12h, "high", "pending", now_iso, now_iso)
        )
        # Map student
        await conn.execute(
            """
            INSERT INTO student_assignments (id, student_id, assignment_id, submission_status, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', ?, ?)
            """,
            ("map-1", s_id, a_id, now_iso, now_iso)
        )
        await conn.commit()
        print("✓ Step 3: Assignment 'Project 1: Raytracer' created with due date <12h and mapped to Alex")

        # 4. Test AI Reminder Drafter
        drafts = await student_drafter.draft_reminders_for_batch("CS101-A")
        assert len(drafts) >= 1, f"Expected at least 1 draft, got {len(drafts)}"
        alex_draft = next((d for d in drafts if d["student_id"] == s_id), None)
        assert alex_draft is not None, "Alex's draft should exist"
        assert "Alex" in alex_draft["draft_message"], f"Message should address Alex: {alex_draft['draft_message']}"
        assert "Raytracer" in alex_draft["draft_message"], f"Message should mention Raytracer: {alex_draft['draft_message']}"
        print(f"✓ Step 4: AI Reminder Drafter produced: '{alex_draft['draft_message']}'")

        # 5. Test Zero-Trust Approval Gate for WhatsApp Dispatch
        # Dispatch in background task since it waits for approval
        dispatch_task = asyncio.create_task(
            messaging_dispatcher.send_student_message(
                student_id=s_id,
                student_name="Alex Rivera",
                phone="+14155552671",
                message_text=alex_draft["draft_message"],
                channel="whatsapp_deeplink",
                assignment_ids=[a_id],
                bypass_approval=False
            )
        )

        # Allow loop to register approval request
        await asyncio.sleep(0.1)
        pending = list(approval_gate.pending_requests.values())
        assert len(pending) >= 1, "Approval request must be pending in Approval Gate"
        req = pending[0]
        assert req.tool_name == "send_whatsapp_message"
        assert req.risk_level == "MEDIUM"
        print(f"✓ Step 5a: Zero-Trust Approval Gate intercepted tool='{req.tool_name}', risk='{req.risk_level}'")

        # User submits decision: 'once'
        resolved = await approval_gate.submit_decision(req.request_id, "once")
        assert resolved is True, "Decision should be accepted"

        result = await dispatch_task
        assert result["success"] is True, f"Dispatch failed: {result}"
        assert result["channel"] == "whatsapp_deeplink"
        assert "protocol_url" in result["details"]
        print(f"✓ Step 5b: Zero-Cost WhatsApp dispatch verified (URL: {result['details']['protocol_url'][:40]}...)")

        # Check reminder count incremented in student_assignments
        cursor = await conn.execute(
            "SELECT reminder_count, last_reminded_at FROM student_assignments WHERE student_id = ? AND assignment_id = ?",
            (s_id, a_id)
        )
        row = await cursor.fetchone()
        assert row["reminder_count"] == 1, f"Expected reminder_count=1, got {row['reminder_count']}"
        assert row["last_reminded_at"] is not None
        print(f"✓ Step 5c: Reminder count incremented to {row['reminder_count']}, timestamp recorded")

        # 6. Test APScheduler Deadline Urgency Checker
        alerts = await deadline_scheduler.check_deadlines_now()
        assert len(alerts) >= 1, f"Expected at least 1 deadline alert, got {len(alerts)}"
        raytracer_alert = next((al for al in alerts if al["assignment_id"] == a_id), None)
        assert raytracer_alert is not None, "Raytracer assignment should be flagged as urgent"
        assert raytracer_alert["pending_student_count"] == 1
        assert raytracer_alert["hours_remaining"] <= 12.5
        print(f"✓ Step 6: APScheduler detected urgent deadline ({raytracer_alert['hours_remaining']}h remaining, {raytracer_alert['pending_student_count']} pending student)")

        # 7. Test Student Submission Toggle
        await conn.execute(
            "UPDATE student_assignments SET submission_status = 'submitted' WHERE student_id = ? AND assignment_id = ?",
            (s_id, a_id)
        )
        await conn.commit()

        # Re-check alerts: now that submission is done, no alerts should be pending
        alerts_after = await deadline_scheduler.check_deadlines_now()
        raytracer_alert_after = next((al for al in alerts_after if al["assignment_id"] == a_id), None)
        assert raytracer_alert_after is None, "Once submitted, assignment should no longer alert as pending"
        print("✓ Step 7: Submission toggled to 'submitted'; verified deadline alert cleared")

        print("\n🎉 ALL PHASE 4 TESTS PASSED WITH 100% SUCCESS!")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_phase4_tests())
