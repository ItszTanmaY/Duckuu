import uuid
from datetime import datetime, timezone
from typing import Optional, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from backend.app.db.database import get_db
from backend.app.db.audit import log_audit_event
from backend.app.services.deadline_scheduler import deadline_scheduler
from backend.app.services.student_triage import student_triage

router = APIRouter(tags=["Assignments & Study Hub"])
subjects_router = APIRouter(tags=["Subjects"])


class AssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, description="Assignment title")
    subject: Optional[str] = Field("Deep Learning", description="Subject / Course name (e.g. Deep Learning, NLP)")
    description: Optional[str] = Field(default="", description="Detailed instructions or prompt")
    course_batch: Optional[str] = Field(default="BTech CSE AI/ML", description="Batch or degree name")
    due_date: str = Field(..., description="ISO 8601 formatted due date")
    priority: str = Field(default="medium", description="low | medium | high | urgent")
    status: str = Field(default="pending", description="pending | in_progress | completed | overdue")
    attachment_id: Optional[str] = Field(None, description="Linked library item ID (e.g. PDF or notes)")
    notes: Optional[str] = Field(None, description="Personal student notes or summary")


class AssignmentUpdate(BaseModel):
    title: Optional[str] = None
    subject: Optional[str] = None
    description: Optional[str] = None
    course_batch: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    attachment_id: Optional[str] = None
    notes: Optional[str] = None


class SubjectCreate(BaseModel):
    name: str = Field(..., min_length=1, description="Course name (e.g. Natural Language Processing)")
    code: str = Field(..., min_length=1, description="Course code (e.g. CS402)")
    semester: Optional[str] = Field("Sem 6", description="Current semester")
    instructor: Optional[str] = Field(None, description="Professor name")
    color: Optional[str] = Field("amber", description="Color theme: purple | sky | emerald | amber | rose")


class TriageIngestRequest(BaseModel):
    raw_text: str = Field(..., min_length=3, description="Group chat text, email, or announcement export")
    source: Optional[str] = Field("class_group", description="Source of the updates (e.g. whatsapp_group, telegram, syllabus)")


class LinkAttachmentRequest(BaseModel):
    attachment_id: Optional[str] = Field(None, description="Library item ID or None to detach")


class SubmissionStatusUpdate(BaseModel):
    submission_status: str = Field(..., description="pending | submitted | graded | late")


# =============================================================================
# 1. PERSONAL ASSIGNMENTS & HOMEWORK CRUD
# =============================================================================

@router.get("")
async def list_assignments(
    subject: Optional[str] = Query(None, description="Filter by subject"),
    batch: Optional[str] = Query(None, description="Filter by course batch"),
    status: Optional[str] = Query(None, description="Filter by status"),
    priority: Optional[str] = Query(None, description="Filter by priority")
):
    """Lists user's personal assignments with linked attachments and subjects."""
    conn = await get_db()
    try:
        query = """
            SELECT a.id, a.title, a.subject, a.description, a.course_batch, a.due_date,
                   a.priority, a.status, a.attachment_id, a.notes, a.created_at,
                   l.title as attachment_title, l.source as attachment_filename,
                   l.summary as attachment_summary
            FROM assignments a
            LEFT JOIN library_items l ON a.attachment_id = l.id
            WHERE 1=1
        """
        params: list[Any] = []
        if subject and subject.lower() != "all":
            query += " AND (a.subject = ? OR a.course_batch = ?)"
            params.extend([subject, subject])
        elif batch and batch.lower() != "all":
            query += " AND a.course_batch = ?"
            params.append(batch)
        if status and status.lower() != "all":
            query += " AND a.status = ?"
            params.append(status)
        if priority and priority.lower() != "all":
            query += " AND a.priority = ?"
            params.append(priority)

        query += " ORDER BY a.due_date ASC"
        cursor = await conn.execute(query, tuple(params))
        rows = await cursor.fetchall()

        results = [dict(r) for r in rows]
        return {"assignments": results, "total": len(results)}
    finally:
        await conn.close()


@router.post("")
async def create_assignment(payload: AssignmentCreate):
    """Creates a personal assignment / homework item in the user's Study Hub."""
    conn = await get_db()
    try:
        a_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        clean_subject = payload.subject or payload.course_batch or "General"

        await conn.execute(
            """
            INSERT INTO assignments (
                id, title, subject, description, course_batch, due_date,
                priority, status, attachment_id, notes, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                a_id,
                payload.title.strip(),
                clean_subject,
                payload.description.strip() if payload.description else "",
                payload.course_batch or "BTech CSE AI/ML",
                payload.due_date,
                payload.priority,
                payload.status,
                payload.attachment_id,
                payload.notes,
                now,
                now
            )
        )

        # Auto-map to students in this batch or 'all' if any enrolled
        target_batch = payload.course_batch or clean_subject
        s_cursor = await conn.execute(
            "SELECT id FROM students WHERE course_batch = ? OR course_batch = 'all'",
            (target_batch,)
        )
        students = await s_cursor.fetchall()
        for s in students:
            mapping_id = str(uuid.uuid4())
            await conn.execute(
                """
                INSERT OR IGNORE INTO student_assignments (id, student_id, assignment_id, submission_status, created_at, updated_at)
                VALUES (?, ?, ?, 'pending', ?, ?)
                """,
                (mapping_id, s["id"], a_id, now, now)
            )

        await conn.commit()
        await log_audit_event(
            category="ASSIGNMENTS",
            action="CREATE_ASSIGNMENT",
            status="SUCCESS",
            details={"assignment_id": a_id, "title": payload.title, "subject": clean_subject}
        )

        return {
            "success": True,
            "assignment": {
                "id": a_id,
                "title": payload.title,
                "subject": clean_subject,
                "course_batch": target_batch,
                "due_date": payload.due_date,
                "priority": payload.priority,
                "status": payload.status,
                "attachment_id": payload.attachment_id,
                "assigned_students": len(students)
            }
        }
    finally:
        await conn.close()


@router.get("/{assignment_id}")
async def get_assignment(assignment_id: str):
    """Gets assignment details with linked PDF/notes and summary."""
    conn = await get_db()
    try:
        cursor = await conn.execute(
            """
            SELECT a.*, l.title as attachment_title, l.source as attachment_filename,
                   l.summary as attachment_summary, l.metadata as attachment_meta
            FROM assignments a
            LEFT JOIN library_items l ON a.attachment_id = l.id
            WHERE a.id = ?
            """,
            (assignment_id,)
        )
        assignment = await cursor.fetchone()
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")

        # Also fetch student mappings if present
        sa_cursor = await conn.execute(
            """
            SELECT s.id as student_id, s.name as student_name, s.phone, s.email, s.course_batch,
                   sa.id as mapping_id, sa.submission_status, sa.last_reminded_at, sa.reminder_count
            FROM student_assignments sa
            JOIN students s ON sa.student_id = s.id
            WHERE sa.assignment_id = ?
            ORDER BY s.name ASC
            """,
            (assignment_id,)
        )
        student_rows = await sa_cursor.fetchall()
        total_assigned = len(student_rows)
        pending_count = sum(1 for r in student_rows if r["submission_status"] == "pending")

        return {
            "assignment": dict(assignment),
            "students": [dict(r) for r in student_rows],
            "total_assigned": total_assigned,
            "pending_count": pending_count
        }
    finally:
        await conn.close()


@router.put("/{assignment_id}")
async def update_assignment(assignment_id: str, payload: AssignmentUpdate):
    """Updates assignment status, due date, notes, or priority."""
    conn = await get_db()
    try:
        cursor = await conn.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,))
        existing = await cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Assignment not found")

        updates: list[str] = []
        params: list[Any] = []
        now = datetime.now(timezone.utc).isoformat()

        if payload.title is not None:
            updates.append("title = ?")
            params.append(payload.title.strip())
        if payload.subject is not None:
            updates.append("subject = ?")
            params.append(payload.subject.strip())
        if payload.description is not None:
            updates.append("description = ?")
            params.append(payload.description.strip())
        if payload.course_batch is not None:
            updates.append("course_batch = ?")
            params.append(payload.course_batch.strip())
        if payload.due_date is not None:
            updates.append("due_date = ?")
            params.append(payload.due_date)
        if payload.priority is not None:
            updates.append("priority = ?")
            params.append(payload.priority)
        if payload.status is not None:
            updates.append("status = ?")
            params.append(payload.status)
        if payload.attachment_id is not None:
            updates.append("attachment_id = ?")
            params.append(payload.attachment_id)
        if payload.notes is not None:
            updates.append("notes = ?")
            params.append(payload.notes)

        updates.append("updated_at = ?")
        params.append(now)
        params.append(assignment_id)

        sql = f"UPDATE assignments SET {', '.join(updates)} WHERE id = ?"
        await conn.execute(sql, tuple(params))
        await conn.commit()

        return {"success": True, "message": "Assignment updated"}
    finally:
        await conn.close()


@router.delete("/{assignment_id}")
async def delete_assignment(assignment_id: str):
    """Deletes an assignment from Study Hub."""
    conn = await get_db()
    try:
        cursor = await conn.execute("DELETE FROM assignments WHERE id = ?", (assignment_id,))
        await conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Assignment not found")

        await log_audit_event(
            category="ASSIGNMENTS",
            action="DELETE_ASSIGNMENT",
            status="SUCCESS",
            details={"assignment_id": assignment_id}
        )
        return {"success": True, "message": "Assignment deleted"}
    finally:
        await conn.close()


@router.put("/{assignment_id}/attachment")
async def link_assignment_attachment(assignment_id: str, payload: LinkAttachmentRequest):
    """Links or unlinks a PDF/document from the Library to an assignment."""
    conn = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await conn.execute(
            "UPDATE assignments SET attachment_id = ?, updated_at = ? WHERE id = ?",
            (payload.attachment_id, now, assignment_id)
        )
        await conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Assignment not found")

        return {
            "success": True,
            "assignment_id": assignment_id,
            "attachment_id": payload.attachment_id
        }
    finally:
        await conn.close()


# Compatibility endpoint for previous student mapping if called
@router.put("/{assignment_id}/students/{student_id}")
async def update_student_submission_status(
    assignment_id: str,
    student_id: str,
    payload: SubmissionStatusUpdate
):
    conn = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        await conn.execute(
            """
            UPDATE student_assignments
            SET submission_status = ?, updated_at = ?
            WHERE assignment_id = ? AND student_id = ?
            """,
            (payload.submission_status, now, assignment_id, student_id)
        )
        await conn.commit()
        return {
            "success": True,
            "assignment_id": assignment_id,
            "student_id": student_id,
            "submission_status": payload.submission_status
        }
    finally:
        await conn.close()


# =============================================================================
# 2. SUBJECTS & COURSES MANAGER
# =============================================================================

@router.get("/subjects/list")
async def list_subjects():
    """Lists student's semester courses/subjects."""
    conn = await get_db()
    try:
        cursor = await conn.execute("SELECT * FROM subjects ORDER BY code ASC")
        rows = await cursor.fetchall()
        return {"subjects": [dict(r) for r in rows]}
    finally:
        await conn.close()


@router.post("/subjects")
async def create_subject(payload: SubjectCreate):
    """Adds a new subject to the student's semester roster."""
    conn = await get_db()
    try:
        s_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        await conn.execute(
            """
            INSERT INTO subjects (id, name, code, semester, instructor, color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (s_id, payload.name.strip(), payload.code.strip(), payload.semester, payload.instructor, payload.color, now, now)
        )
        await conn.commit()
        return {"success": True, "subject": {"id": s_id, "name": payload.name, "code": payload.code, "color": payload.color}}
    finally:
        await conn.close()


@router.delete("/subjects/{subject_id}")
async def delete_subject(subject_id: str):
    """Deletes a subject."""
    conn = await get_db()
    try:
        cursor = await conn.execute("DELETE FROM subjects WHERE id = ?", (subject_id,))
        await conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Subject not found")
        return {"success": True, "message": "Subject deleted"}
    finally:
        await conn.close()


@subjects_router.get("")
async def get_subjects_api():
    return await list_subjects()


@subjects_router.post("")
async def post_subjects_api(payload: SubjectCreate):
    return await create_subject(payload)


@subjects_router.delete("/{subject_id}")
async def delete_subjects_api(subject_id: str):
    return await delete_subject(subject_id)


# =============================================================================
# 3. AUTONOMOUS CLASS GROUP INGESTION & TRIAGE FEED
# =============================================================================

@router.post("/triage/ingest")
async def ingest_group_updates(payload: TriageIngestRequest):
    """
    Ingests class group chat text, announcements, or clipboard dump.
    AI extracts tasks and deadlines into the triage feed.
    """
    items = await student_triage.ingest_group_text(payload.raw_text, source=payload.source)
    return {
        "success": True,
        "items_detected": len(items),
        "items": items
    }


@router.get("/triage/feed")
async def list_triage_feed(status: Optional[str] = Query("pending")):
    """Lists items in the student triage feed."""
    conn = await get_db()
    try:
        query = "SELECT * FROM study_triage_feed"
        params = []
        if status and status.lower() != "all":
            query += " WHERE status = ?"
            params.append(status)
        query += " ORDER BY created_at DESC LIMIT 50"

        cursor = await conn.execute(query, tuple(params))
        rows = await cursor.fetchall()
        return {"feed": [dict(r) for r in rows]}
    finally:
        await conn.close()


@router.post("/triage/{triage_id}/convert")
async def convert_triage_item(triage_id: str):
    """Converts a triage item directly into a personal assignment in Study Hub."""
    res = await student_triage.convert_triage_to_assignment(triage_id)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to convert"))
    return res


@router.delete("/triage/{triage_id}")
async def dismiss_triage_item(triage_id: str):
    """Dismisses an item from the triage feed."""
    conn = await get_db()
    try:
        await conn.execute("UPDATE study_triage_feed SET status = 'dismissed' WHERE id = ?", (triage_id,))
        await conn.commit()
        return {"success": True, "message": "Triage item dismissed"}
    finally:
        await conn.close()


# =============================================================================
# 4. DEADLINE URGENCY SCANNER TRIGGER
# =============================================================================

@router.post("/check-deadlines")
async def trigger_deadline_check():
    """Manually scans assignments for deadlines <24h and broadcasts alerts."""
    alerts = await deadline_scheduler.check_deadlines_now()
    return {
        "success": True,
        "alerts_found": len(alerts),
        "alerts": alerts
    }
