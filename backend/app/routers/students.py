import uuid
import json
import csv
import io
from datetime import datetime, timezone
from typing import Optional, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from backend.app.db.database import get_db
from backend.app.db.audit import log_audit_event
from backend.app.services.student_drafter import student_drafter
from backend.app.services.messaging_dispatcher import messaging_dispatcher

router = APIRouter(tags=["Students"])


class StudentCreate(BaseModel):
    name: str = Field(..., min_length=1, description="Full student name")
    phone: str = Field(..., min_length=7, description="Phone number with country code")
    email: Optional[str] = Field(None, description="Email address")
    course_batch: str = Field(..., min_length=1, description="Class / batch name (e.g. CS101-A)")
    tags: Optional[list[str]] = Field(default_factory=list, description="Tag labels")
    preferred_channel: str = Field("whatsapp_deeplink", description="whatsapp_deeplink | whatsapp_cloud | telegram | email")


class StudentUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    course_batch: Optional[str] = None
    tags: Optional[list[str]] = None
    preferred_channel: Optional[str] = None


class CsvImportRequest(BaseModel):
    csv_text: str = Field(..., min_length=3, description="Raw CSV content (headers or comma-separated rows)")
    default_batch: Optional[str] = "Batch-General"


class DraftRemindersRequest(BaseModel):
    course_batch: Optional[str] = None
    student_id: Optional[str] = None


class SendReminderRequest(BaseModel):
    student_id: str
    student_name: str
    phone: str
    message: str
    channel: Optional[str] = None
    assignment_ids: Optional[list[str]] = None
    bypass_approval: bool = False


class BatchSendRequest(BaseModel):
    reminders: list[SendReminderRequest]
    bypass_approval: bool = False


@router.get("")
async def list_students(
    batch: Optional[str] = Query(None, description="Filter by course batch"),
    search: Optional[str] = Query(None, description="Filter by name or phone")
):
    """Lists all students with pending assignment counts."""
    conn = await get_db()
    try:
        query = """
            SELECT s.id, s.name, s.phone, s.email, s.course_batch, s.tags, s.preferred_channel, s.created_at,
                   COUNT(CASE WHEN sa.submission_status = 'pending' THEN 1 END) as pending_assignments,
                   COUNT(sa.id) as total_assignments
            FROM students s
            LEFT JOIN student_assignments sa ON s.id = sa.student_id
            WHERE 1=1
        """
        params: list[Any] = []
        if batch and batch.lower() != "all":
            query += " AND s.course_batch = ?"
            params.append(batch)
        if search:
            query += " AND (s.name LIKE ? OR s.phone LIKE ? OR s.email LIKE ?)"
            term = f"%{search}%"
            params.extend([term, term, term])

        query += " GROUP BY s.id ORDER BY s.name ASC"
        cursor = await conn.execute(query, tuple(params))
        rows = await cursor.fetchall()

        results = []
        for r in rows:
            tags = []
            if r["tags"]:
                try:
                    tags = json.loads(r["tags"])
                except Exception:
                    tags = [t.strip() for t in r["tags"].split(",") if t.strip()]

            results.append({
                "id": r["id"],
                "name": r["name"],
                "phone": r["phone"],
                "email": r["email"],
                "course_batch": r["course_batch"],
                "tags": tags,
                "preferred_channel": r["preferred_channel"],
                "pending_assignments": r["pending_assignments"],
                "total_assignments": r["total_assignments"],
                "created_at": r["created_at"]
            })
        return {"students": results, "total": len(results)}
    finally:
        await conn.close()


@router.post("")
async def create_student(payload: StudentCreate):
    """Creates a student and maps them to existing assignments in their course batch."""
    conn = await get_db()
    try:
        student_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        tags_json = json.dumps(payload.tags) if payload.tags else "[]"

        await conn.execute(
            """
            INSERT INTO students (id, name, phone, email, course_batch, tags, preferred_channel, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                student_id,
                payload.name.strip(),
                payload.phone.strip(),
                payload.email.strip() if payload.email else None,
                payload.course_batch.strip(),
                tags_json,
                payload.preferred_channel,
                now,
                now
            )
        )

        # Automatically associate student with any existing assignments in this batch (or 'all' batch)
        a_cursor = await conn.execute(
            "SELECT id FROM assignments WHERE course_batch = ? OR course_batch = 'all'",
            (payload.course_batch.strip(),)
        )
        batch_assignments = await a_cursor.fetchall()
        for a in batch_assignments:
            mapping_id = str(uuid.uuid4())
            await conn.execute(
                """
                INSERT OR IGNORE INTO student_assignments (id, student_id, assignment_id, submission_status, created_at, updated_at)
                VALUES (?, ?, ?, 'pending', ?, ?)
                """,
                (mapping_id, student_id, a["id"], now, now)
            )

        await conn.commit()
        await log_audit_event(
            category="STUDENTS",
            action="CREATE_STUDENT",
            status="SUCCESS",
            details={"student_id": student_id, "name": payload.name, "course_batch": payload.course_batch}
        )

        return {
            "success": True,
            "student": {
                "id": student_id,
                "name": payload.name,
                "phone": payload.phone,
                "course_batch": payload.course_batch,
                "preferred_channel": payload.preferred_channel
            }
        }
    finally:
        await conn.close()


@router.get("/{student_id}")
async def get_student(student_id: str):
    """Gets student details along with their full assignment submission list."""
    conn = await get_db()
    try:
        s_cursor = await conn.execute("SELECT * FROM students WHERE id = ?", (student_id,))
        student = await s_cursor.fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        # Fetch assigned coursework
        a_cursor = await conn.execute(
            """
            SELECT a.id, a.title, a.description, a.due_date, a.priority, a.course_batch,
                   sa.submission_status, sa.last_reminded_at, sa.reminder_count
            FROM student_assignments sa
            JOIN assignments a ON sa.assignment_id = a.id
            WHERE sa.student_id = ?
            ORDER BY a.due_date ASC
            """,
            (student_id,)
        )
        assignments = await a_cursor.fetchall()

        tags = []
        if student["tags"]:
            try:
                tags = json.loads(student["tags"])
            except Exception:
                tags = [student["tags"]]

        return {
            "student": {
                "id": student["id"],
                "name": student["name"],
                "phone": student["phone"],
                "email": student["email"],
                "course_batch": student["course_batch"],
                "tags": tags,
                "preferred_channel": student["preferred_channel"],
                "created_at": student["created_at"]
            },
            "assignments": [dict(a) for a in assignments]
        }
    finally:
        await conn.close()


@router.put("/{student_id}")
async def update_student(student_id: str, payload: StudentUpdate):
    """Updates student fields."""
    conn = await get_db()
    try:
        s_cursor = await conn.execute("SELECT * FROM students WHERE id = ?", (student_id,))
        existing = await s_cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Student not found")

        updates: list[str] = []
        params: list[Any] = []
        now = datetime.now(timezone.utc).isoformat()

        if payload.name is not None:
            updates.append("name = ?")
            params.append(payload.name.strip())
        if payload.phone is not None:
            updates.append("phone = ?")
            params.append(payload.phone.strip())
        if payload.email is not None:
            updates.append("email = ?")
            params.append(payload.email.strip() if payload.email else None)
        if payload.course_batch is not None:
            updates.append("course_batch = ?")
            params.append(payload.course_batch.strip())
        if payload.tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(payload.tags))
        if payload.preferred_channel is not None:
            updates.append("preferred_channel = ?")
            params.append(payload.preferred_channel)

        updates.append("updated_at = ?")
        params.append(now)
        params.append(student_id)

        sql = f"UPDATE students SET {', '.join(updates)} WHERE id = ?"
        await conn.execute(sql, tuple(params))
        await conn.commit()

        return {"success": True, "message": "Student updated successfully"}
    finally:
        await conn.close()


@router.delete("/{student_id}")
async def delete_student(student_id: str):
    """Deletes a student and cascades to their student_assignments records."""
    conn = await get_db()
    try:
        await conn.execute("DELETE FROM student_assignments WHERE student_id = ?", (student_id,))
        cursor = await conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
        await conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Student not found")

        await log_audit_event(
            category="STUDENTS",
            action="DELETE_STUDENT",
            status="SUCCESS",
            details={"student_id": student_id}
        )
        return {"success": True, "message": "Student deleted"}
    finally:
        await conn.close()


@router.post("/import-csv")
async def import_students_csv(payload: CsvImportRequest):
    """
    Parses CSV content or comma-delimited lines and creates student records.
    Format support:
    - Header line (Name, Phone, Email, Batch, Channel) or auto-detect
    - Plain rows: John Doe, +1234567890, john@example.com, Batch-A, whatsapp_deeplink
    """
    conn = await get_db()
    try:
        reader = csv.reader(io.StringIO(payload.csv_text.strip()))
        imported = []
        errors = []
        now = datetime.now(timezone.utc).isoformat()

        # Cache existing assignments by batch for instant auto-mapping
        a_cursor = await conn.execute("SELECT id, course_batch FROM assignments")
        all_assignments = await a_cursor.fetchall()

        for idx, row in enumerate(reader):
            if not row or not any(row):
                continue
            # Skip header if present
            if idx == 0 and any(col.lower() in ("name", "student", "fullname") for col in row):
                continue

            name = row[0].strip() if len(row) > 0 else ""
            if not name:
                continue

            phone = row[1].strip() if len(row) > 1 else ""
            email = row[2].strip() if len(row) > 2 and row[2].strip() else None
            batch = row[3].strip() if len(row) > 3 and row[3].strip() else (payload.default_batch or "General")
            channel = row[4].strip() if len(row) > 4 and row[4].strip() else "whatsapp_deeplink"

            s_id = str(uuid.uuid4())
            try:
                await conn.execute(
                    """
                    INSERT INTO students (id, name, phone, email, course_batch, tags, preferred_channel, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (s_id, name, phone, email, batch, json.dumps(["imported"]), channel, now, now)
                )

                # Associate with matching assignments
                for a in all_assignments:
                    if a["course_batch"] == batch or a["course_batch"] == "all":
                        mapping_id = str(uuid.uuid4())
                        await conn.execute(
                            """
                            INSERT OR IGNORE INTO student_assignments (id, student_id, assignment_id, submission_status, created_at, updated_at)
                            VALUES (?, ?, ?, 'pending', ?, ?)
                            """,
                            (mapping_id, s_id, a["id"], now, now)
                        )

                imported.append({"id": s_id, "name": name, "phone": phone, "batch": batch})
            except Exception as e:
                errors.append(f"Row {idx + 1} ({name}): {str(e)}")

        await conn.commit()
        await log_audit_event(
            category="STUDENTS",
            action="IMPORT_CSV",
            status="SUCCESS",
            details={"imported_count": len(imported), "error_count": len(errors)}
        )

        return {
            "success": True,
            "imported_count": len(imported),
            "imported_students": imported,
            "errors": errors
        }
    finally:
        await conn.close()


@router.post("/draft-reminders")
async def draft_reminders(payload: DraftRemindersRequest):
    """
    Generates personalized reminder message drafts for students with pending assignments.
    Uses AI router with deterministic fallback templates.
    """
    drafts = await student_drafter.draft_reminders_for_batch(
        course_batch=payload.course_batch,
        student_id=payload.student_id
    )
    return {
        "success": True,
        "batch": payload.course_batch or "all",
        "drafts": drafts,
        "total_drafts": len(drafts)
    }


@router.post("/send-reminder")
async def send_single_reminder(payload: SendReminderRequest):
    """
    Dispatches a single reminder to a student via WhatsApp (Cloud API or Zero-Cost Deep-Link).
    Intercepts via Zero-Trust Approval Gate unless bypass_approval is granted.
    """
    result = await messaging_dispatcher.send_student_message(
        student_id=payload.student_id,
        student_name=payload.student_name,
        phone=payload.phone,
        message_text=payload.message,
        channel=payload.channel,
        assignment_ids=payload.assignment_ids,
        bypass_approval=payload.bypass_approval
    )
    return result


@router.post("/batch-send")
async def batch_send_reminders(payload: BatchSendRequest):
    """
    Iterates and dispatches a batch of student reminders with approval gate interception.
    """
    results = []
    for item in payload.reminders:
        res = await messaging_dispatcher.send_student_message(
            student_id=item.student_id,
            student_name=item.student_name,
            phone=item.phone,
            message_text=item.message,
            channel=item.channel,
            assignment_ids=item.assignment_ids,
            bypass_approval=payload.bypass_approval
        )
        results.append(res)

    success_count = sum(1 for r in results if r.get("success"))
    return {
        "success": True,
        "total_dispatched": len(results),
        "success_count": success_count,
        "results": results
    }
