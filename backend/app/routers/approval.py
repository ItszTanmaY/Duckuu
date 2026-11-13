from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from backend.app.services.approval_gate import approval_gate
from backend.app.db.database import get_db

router = APIRouter(tags=["Zero-Trust Approval Gate"])


class DecisionRequest(BaseModel):
    request_id: str
    decision: str = Field(..., pattern="^(once|always|deny)$")


@router.get("/pending")
async def get_pending_approvals():
    return approval_gate.get_pending_list()


@router.post("/decide")
async def decide_approval(req: DecisionRequest):
    success = await approval_gate.submit_decision(req.request_id, req.decision)
    if not success:
        raise HTTPException(status_code=404, detail="Approval request ID not found or already processed")
    return {"success": True, "message": f"Processed decision: {req.decision}"}


@router.get("/rules")
async def list_approval_rules():
    conn = await get_db()
    try:
        cursor = await conn.execute(
            """
            SELECT id, tool_name, pattern, allowed_always, created_at
            FROM approval_rules
            ORDER BY id DESC
            """
        )
        rows = await cursor.fetchall()
        return [
            {
                "id": r["id"],
                "tool_name": r["tool_name"],
                "pattern": r["pattern"],
                "allowed_always": bool(r["allowed_always"]),
                "created_at": r["created_at"]
            }
            for r in rows
        ]
    finally:
        await conn.close()
