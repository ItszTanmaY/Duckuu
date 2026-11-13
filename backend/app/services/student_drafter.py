import json
from datetime import datetime, timezone
from typing import Optional, Any
from backend.app.db.database import get_db
from backend.app.services.llm_router import llm_router


class StudentMessageDrafter:
    """
    AI message drafter for student assignments and deadline reminders.
    Analyzes student pending submissions and drafts personalized WhatsApp/SMS updates.
    """

    async def draft_reminders_for_batch(
        self,
        course_batch: Optional[str] = None,
        student_id: Optional[str] = None
    ) -> list[dict[str, Any]]:
        """
        Gathers unsubmitted assignments for students and crafts personalized reminder drafts.
        """
        conn = await get_db()
        try:
            # Query students
            query = "SELECT id, name, phone, email, course_batch, preferred_channel FROM students WHERE 1=1"
            params: list[Any] = []
            if student_id:
                query += " AND id = ?"
                params.append(student_id)
            elif course_batch and course_batch.lower() != "all":
                query += " AND course_batch = ?"
                params.append(course_batch)

            query += " ORDER BY name ASC"
            cursor = await conn.execute(query, tuple(params))
            students = await cursor.fetchall()

            drafts = []
            now_iso = datetime.now(timezone.utc).isoformat()

            for s in students:
                s_id = s["id"]
                # Query pending assignments for this student
                a_cursor = await conn.execute(
                    """
                    SELECT a.id, a.title, a.description, a.due_date, a.priority, sa.submission_status, sa.last_reminded_at, sa.reminder_count
                    FROM student_assignments sa
                    JOIN assignments a ON sa.assignment_id = a.id
                    WHERE sa.student_id = ? AND sa.submission_status = 'pending'
                    ORDER BY a.due_date ASC
                    """,
                    (s_id,)
                )
                pending_assignments = await a_cursor.fetchall()

                if not pending_assignments:
                    continue

                pending_list = [
                    {
                        "id": p["id"],
                        "title": p["title"],
                        "due_date": p["due_date"],
                        "priority": p["priority"],
                        "reminder_count": p["reminder_count"]
                    }
                    for p in pending_assignments
                ]

                # Craft message draft
                message_text = await self._generate_personalized_message(
                    student_name=s["name"],
                    course_batch=s["course_batch"],
                    pending_list=pending_list
                )

                drafts.append({
                    "student_id": s_id,
                    "student_name": s["name"],
                    "phone": s["phone"],
                    "course_batch": s["course_batch"],
                    "preferred_channel": s["preferred_channel"],
                    "pending_count": len(pending_list),
                    "pending_assignments": pending_list,
                    "draft_message": message_text,
                    "status": "ready_to_send"
                })

            return drafts
        finally:
            await conn.close()

    async def _generate_personalized_message(
        self,
        student_name: str,
        course_batch: str,
        pending_list: list[dict[str, Any]]
    ) -> str:
        """Uses local LLM router to draft an encouraging personalized reminder."""
        task_bullets = []
        for p in pending_list:
            due_str = p["due_date"].split("T")[0] if "T" in p["due_date"] else p["due_date"]
            task_bullets.append(f"• {p['title']} (Due: {due_str}, Priority: {p['priority']})")
        bullet_text = "\n".join(task_bullets)

        prompt = (
            f"You are Duckuu, a friendly and encouraging academic AI duck companion.\n"
            f"Draft a short, warm, professional WhatsApp reminder message for student '{student_name}' enrolled in '{course_batch}'.\n"
            f"Pending assignments:\n{bullet_text}\n\n"
            "Rules:\n"
            "- Start with a friendly greeting with student's first name\n"
            "- Mention their pending coursework clearly with due dates\n"
            "- Add an encouraging closing sentence\n"
            "- Keep total length under 60 words\n"
            "- Return ONLY the message text without commentary or quotes."
        )

        parts = []
        is_real_llm = False
        try:
            async for chunk, done, meta in llm_router.stream_chat(
                [{"role": "user", "content": prompt}],
                mode="student"
            ):
                if meta.get("provider") not in ("fallback", "unknown") and meta.get("is_online"):
                    is_real_llm = True
                if chunk:
                    parts.append(chunk)
                if done:
                    break
        except Exception:
            pass

        generated = "".join(parts).strip().strip('"')
        if is_real_llm and generated and len(generated) > 20:
            return generated

        # Deterministic high-quality fallback
        first_name = student_name.split()[0]
        count = len(pending_list)
        return (
            f"Hi {first_name}! 🦆 Quick Duckuu reminder for your {course_batch} coursework. "
            f"You have {count} pending assignment{'s' if count > 1 else ''}:\n"
            f"{bullet_text}\n"
            f"Please submit before the deadline! Let me know if you need any study assistance."
        )


student_drafter = StudentMessageDrafter()
