import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Any
from backend.app.db.database import get_db
from backend.app.db.audit import log_audit_event
from backend.app.services.llm_router import llm_router


class StudentTriageService:
    """
    Autonomous Student Group Background Monitor & Triage Service.
    Parses class group chat exports, announcements, and clipboard updates,
    extracts homework and deadlines, and maintains a student triage feed.
    """

    def __init__(self) -> None:
        self.ws_broadcaster: Optional[Any] = None

    def register_broadcaster(self, broadcaster: Any) -> None:
        self.ws_broadcaster = broadcaster

    async def ingest_group_text(
        self,
        raw_text: str,
        source: str = "class_group"
    ) -> list[dict[str, Any]]:
        """
        Parses group chat text or announcements, detects assignments and deadlines,
        and saves entries to study_triage_feed.
        """
        parsed_items = await self._extract_tasks_from_text(raw_text)
        if not parsed_items:
            return []

        conn = await get_db()
        results = []
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            for item in parsed_items:
                feed_id = str(uuid.uuid4())
                await conn.execute(
                    """
                    INSERT INTO study_triage_feed (
                        id, raw_text, source, detected_subject, detected_title,
                        detected_due_date, category, urgency, status, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        feed_id,
                        item.get("raw_snippet", raw_text[:200]),
                        source,
                        item.get("subject", "General"),
                        item.get("title", "Untitled Task"),
                        item.get("due_date", now_iso),
                        item.get("category", "assignment"),
                        item.get("urgency", "normal"),
                        now_iso
                    )
                )

                created_item = {
                    "id": feed_id,
                    "title": item.get("title"),
                    "subject": item.get("subject"),
                    "due_date": item.get("due_date"),
                    "category": item.get("category"),
                    "urgency": item.get("urgency"),
                    "source": source
                }
                results.append(created_item)

                # Stealth Proactive Alert: emit subtle pet status and speech pill
                # Do NOT forcibly steal focus or pop up the giant chat window!
                if self.ws_broadcaster:
                    # 1. Subtle speech pill on desktop pet
                    is_urgent = item.get("urgency") == "urgent"
                    pill_text = (
                        f"🚨 Urgent: {item.get('title')} ({item.get('subject')})"
                        if is_urgent
                        else f"📚 New task detected: {item.get('title')}"
                    )
                    await self.ws_broadcaster.broadcast({
                        "type": "SPEECH_PILL",
                        "text": pill_text,
                        "level": "working" if is_urgent else "info",
                        "duration_ms": 3500
                    })
                    # 2. Quiet pet emotion change (thinking/vibing)
                    await self.ws_broadcaster.broadcast({
                        "type": "PET_STATE_CHANGE",
                        "emotion": "thinking" if is_urgent else "happy",
                        "reason": "triage_task_detected",
                        "duration_ms": 2500
                    })
                    # 3. WebSocket event for the Study Hub view
                    await self.ws_broadcaster.broadcast({
                        "type": "STUDENT_TRIAGE_ALERT",
                        "item": created_item
                    })

            await conn.commit()
            await log_audit_event(
                category="STUDY_TRIAGE",
                action="INGEST_GROUP_TEXT",
                status="SUCCESS",
                details={"items_detected": len(results), "source": source}
            )
            return results
        finally:
            await conn.close()

    async def _extract_tasks_from_text(self, text: str) -> list[dict[str, Any]]:
        """
        Extracts structured coursework from unstructured chat text.
        Combines fast local heuristic NLP with LLM router streaming if available.
        """
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        detected: list[dict[str, Any]] = []

        # Common BTech CSE AI/ML subjects
        known_subjects = [
            "Deep Learning", "Natural Language Processing", "NLP",
            "Distributed Systems", "Cloud & Edge AI", "Cloud Computing",
            "Reinforcement Learning", "Operating Systems", "Machine Learning"
        ]

        # Fast heuristic extraction for common patterns:
        # e.g. "Assignment 3: due Friday", "Lab 4 submission deadline 10th Nov"
        keywords = ["assignment", "homework", "lab", "project", "submission", "due", "deadline", "submit"]
        is_task_likely = any(kw in text.lower() for kw in keywords)

        if not is_task_likely and len(lines) < 3:
            return []

        # Try regex patterns
        title = "Class Coursework"
        matched_subject = "Deep Learning"
        for s in known_subjects:
            if s.lower() in text.lower():
                matched_subject = s
                break

        # Check for assignment / lab titles
        title_match = re.search(
            r"(lab\s*\d+|assignment\s*\d+|project\s*\w+|milestone\s*\d+|quiz\s*\d+[:\s\w\-]*)",
            text,
            re.IGNORECASE
        )
        if title_match:
            title = title_match.group(0).strip().capitalize()
        else:
            # Fallback title from first line
            title = lines[0][:40]

        # Check for due date / deadline
        now = datetime.now(timezone.utc)
        due_date = (now + timedelta(days=2)).isoformat()
        urgency = "normal"

        if "tomorrow" in text.lower() or "today" in text.lower() or "urgent" in text.lower() or "asap" in text.lower():
            due_date = (now + timedelta(hours=18)).isoformat()
            urgency = "urgent"
        elif "friday" in text.lower():
            due_date = (now + timedelta(days=3)).isoformat()
        elif "monday" in text.lower():
            due_date = (now + timedelta(days=5)).isoformat()

        category = "lab" if "lab" in text.lower() else "assignment"

        detected.append({
            "title": title,
            "subject": matched_subject,
            "due_date": due_date,
            "category": category,
            "urgency": urgency,
            "raw_snippet": text[:180]
        })

        return detected

    async def convert_triage_to_assignment(self, triage_id: str) -> dict[str, Any]:
        """Converts an ingested triage item into a persistent personal assignment."""
        conn = await get_db()
        try:
            cursor = await conn.execute("SELECT * FROM study_triage_feed WHERE id = ?", (triage_id,))
            item = await cursor.fetchone()
            if not item:
                return {"success": False, "error": "Triage item not found"}

            now = datetime.now(timezone.utc).isoformat()
            new_assign_id = str(uuid.uuid4())

            await conn.execute(
                """
                INSERT INTO assignments (
                    id, title, subject, description, course_batch, due_date,
                    priority, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
                """,
                (
                    new_assign_id,
                    item["detected_title"],
                    item["detected_subject"],
                    f"Imported from class group updates: {item['raw_text']}",
                    "BTech CSE AI/ML",
                    item["detected_due_date"],
                    "urgent" if item["urgency"] == "urgent" else "high",
                    now,
                    now
                )
            )

            # Update triage status
            await conn.execute(
                "UPDATE study_triage_feed SET status = 'converted' WHERE id = ?",
                (triage_id,)
            )
            await conn.commit()

            return {
                "success": True,
                "assignment_id": new_assign_id,
                "title": item["detected_title"],
                "subject": item["detected_subject"]
            }
        finally:
            await conn.close()


student_triage = StudentTriageService()
