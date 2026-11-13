import json
from datetime import datetime, timezone
from typing import Optional, Any
from backend.app.db.database import get_db


async def log_audit_event(
    category: str,
    action: str,
    status: str,
    details: dict[str, Any]
) -> int:
    conn = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        details_json = json.dumps(details, ensure_ascii=False)
        cursor = await conn.execute(
            """
            INSERT INTO audit_logs (timestamp, category, action, status, details)
            VALUES (?, ?, ?, ?, ?)
            """,
            (now, category.upper(), action.upper(), status.upper(), details_json)
        )
        await conn.commit()
        return cursor.lastrowid or 0
    finally:
        await conn.close()


async def get_audit_logs(
    limit: int = 50,
    offset: int = 0,
    category: Optional[str] = None
) -> tuple[int, list[dict[str, Any]]]:
    conn = await get_db()
    try:
        if category:
            count_cursor = await conn.execute(
                "SELECT COUNT(*) FROM audit_logs WHERE category = ?",
                (category.upper(),)
            )
            data_cursor = await conn.execute(
                """
                SELECT id, timestamp, category, action, status, details
                FROM audit_logs
                WHERE category = ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                (category.upper(), limit, offset)
            )
        else:
            count_cursor = await conn.execute("SELECT COUNT(*) FROM audit_logs")
            data_cursor = await conn.execute(
                """
                SELECT id, timestamp, category, action, status, details
                FROM audit_logs
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset)
            )

        total_row = await count_cursor.fetchone()
        total = total_row[0] if total_row else 0

        rows = await data_cursor.fetchall()
        logs = []
        for r in rows:
            try:
                parsed_details = json.loads(r["details"])
            except Exception:
                parsed_details = {"raw": r["details"]}
            logs.append({
                "id": r["id"],
                "timestamp": r["timestamp"],
                "category": r["category"],
                "action": r["action"],
                "status": r["status"],
                "details": parsed_details
            })
        return total, logs
    finally:
        await conn.close()
