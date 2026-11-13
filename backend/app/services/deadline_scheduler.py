import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional, Any
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from backend.app.db.database import get_db
from backend.app.db.audit import log_audit_event


class DeadlineSchedulerService:
    """
    Background deadline and assignment urgency scheduler using APScheduler.
    Monitors upcoming deadlines (within 24 hours) and overdue submissions,
    emits real-time DEADLINE_ALERT events to Electron windows, and triggers
    Duckuu emotion transitions.
    """

    def __init__(self) -> None:
        self.scheduler = AsyncIOScheduler()
        self.ws_broadcaster: Optional[Any] = None
        self._is_running = False

    def register_broadcaster(self, broadcaster: Any) -> None:
        self.ws_broadcaster = broadcaster

    def start(self, interval_minutes: int = 15) -> None:
        """Starts the background scheduler loop if not already running."""
        if not self._is_running:
            try:
                self.scheduler.add_job(
                    self.check_deadlines_now,
                    trigger=IntervalTrigger(minutes=interval_minutes),
                    id="deadline_urgency_monitor",
                    replace_existing=True
                )
                self.scheduler.start()
                self._is_running = True
            except Exception as e:
                # Scheduler might already be initialized or loop bound
                self._is_running = True

    def shutdown(self) -> None:
        """Shuts down the background scheduler cleanly."""
        if self._is_running:
            try:
                self.scheduler.shutdown(wait=False)
            except Exception:
                pass
            self._is_running = False

    async def check_deadlines_now(self) -> list[dict[str, Any]]:
        """
        Scans all assignments in SQLite for upcoming deadlines (<24h) or overdue status.
        Emits WebSocket DEADLINE_ALERT events for any unsubmitted assignments.
        """
        conn = await get_db()
        alerts = []
        try:
            now_dt = datetime.now(timezone.utc)
            now_iso = now_dt.isoformat()
            threshold_24h = (now_dt + timedelta(hours=24)).isoformat()

            # Query assignments with pending status due within 24 hours or overdue
            cursor = await conn.execute(
                """
                SELECT id, title, subject, description, course_batch, due_date, priority, status
                FROM assignments
                WHERE status != 'completed'
                ORDER BY due_date ASC
                """
            )
            assignments = await cursor.fetchall()

            for a in assignments:
                a_id = a["id"]
                due_str = a["due_date"]
                subject = a["subject"] or a["course_batch"] or "Study"
                try:
                    # Normalize ISO format
                    if "T" in due_str:
                        clean_due = due_str.replace("Z", "+00:00")
                        due_dt = datetime.fromisoformat(clean_due)
                    else:
                        due_dt = datetime.fromisoformat(due_str).replace(tzinfo=timezone.utc)
                except Exception:
                    due_dt = now_dt

                diff_seconds = (due_dt - now_dt).total_seconds()
                hours_remaining = diff_seconds / 3600.0
                is_overdue = diff_seconds < 0
                is_within_24h = 0 <= diff_seconds <= 86400

                if not (is_overdue or is_within_24h):
                    continue

                # Query assigned students if any exist in mapping table
                sa_cursor = await conn.execute(
                    """
                    SELECT s.id, s.name, s.phone, sa.submission_status, sa.reminder_count, sa.last_reminded_at
                    FROM student_assignments sa
                    JOIN students s ON sa.student_id = s.id
                    WHERE sa.assignment_id = ?
                    ORDER BY s.name ASC
                    """,
                    (a_id,)
                )
                all_assigned = await sa_cursor.fetchall()
                if all_assigned:
                    pending_students = [s for s in all_assigned if s["submission_status"] == "pending"]
                    if not pending_students:
                        # All assigned students have submitted
                        continue
                    pending_count = len(pending_students)
                else:
                    pending_students = []
                    pending_count = 1

                student_previews = [
                    {"id": s["id"], "name": s["name"], "phone": s["phone"], "reminders": s["reminder_count"]}
                    for s in pending_students
                ]

                alert_data = {
                    "assignment_id": a_id,
                    "title": a["title"],
                    "subject": subject,
                    "course_batch": a["course_batch"],
                    "due_date": a["due_date"],
                    "priority": a["priority"],
                    "is_overdue": is_overdue,
                    "hours_remaining": round(hours_remaining, 1),
                    "pending_student_count": pending_count,
                    "pending_students": student_previews,
                    "timestamp": now_iso
                }
                alerts.append(alert_data)

                # Stealth Proactive Alert: Emit subtle pet state & speech pill without popping up large chat window!
                if self.ws_broadcaster:
                    # 1. Subtle speech pill on desktop pet
                    time_label = "⚠️ OVERDUE" if is_overdue else f"due in {round(hours_remaining, 1)}h"
                    await self.ws_broadcaster.broadcast({
                        "type": "SPEECH_PILL",
                        "text": f"⏰ {a['title']} ({subject}) is {time_label}!",
                        "level": "working" if is_overdue else "info",
                        "duration_ms": 4000
                    })
                    # 2. Quiet pet emotion change
                    await self.ws_broadcaster.broadcast({
                        "type": "PET_STATE_CHANGE",
                        "emotion": "surprised" if is_overdue else "working",
                        "reason": "deadline_urgency_alert",
                        "duration_ms": 3000
                    })
                    # 3. Alert event for Study Hub tab
                    await self.ws_broadcaster.broadcast({
                        "type": "DEADLINE_ALERT",
                        **alert_data
                    })

            # Record audit log
            if alerts:
                await log_audit_event(
                    category="SCHEDULER",
                    action="DEADLINE_CHECK",
                    status="ALERTED",
                    details={"total_alerts": len(alerts), "assignments": [al["title"] for al in alerts]}
                )

            return alerts
        finally:
            await conn.close()


deadline_scheduler = DeadlineSchedulerService()
