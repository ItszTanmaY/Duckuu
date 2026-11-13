import asyncio
import json
import uuid
import time
from datetime import datetime, timezone
from typing import Optional, Any
from backend.app.db.database import get_db
from backend.app.db.audit import log_audit_event


class PendingApproval:
    def __init__(
        self,
        request_id: str,
        tool_name: str,
        parameters: dict[str, Any],
        risk_level: str,
        description: str,
        timeout_seconds: int = 30
    ) -> None:
        self.request_id = request_id
        self.tool_name = tool_name
        self.parameters = parameters
        self.risk_level = risk_level
        self.description = description
        self.timeout_seconds = timeout_seconds
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.event = asyncio.Event()
        self.decision: Optional[str] = None  # "once", "always", "deny"

    def to_dict(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "tool_name": self.tool_name,
            "parameters": self.parameters,
            "risk_level": self.risk_level,
            "description": self.description,
            "created_at": self.created_at,
            "timeout_seconds": self.timeout_seconds
        }


class ZeroTrustApprovalGate:
    def __init__(self) -> None:
        self.pending_requests: dict[str, PendingApproval] = {}
        self.ws_broadcaster: Optional[Any] = None

    def register_broadcaster(self, broadcaster) -> None:
        self.ws_broadcaster = broadcaster

    async def check_always_allowed(self, tool_name: str) -> bool:
        """Check if an Always Allow rule exists in SQLite for this tool."""
        conn = await get_db()
        try:
            cursor = await conn.execute(
                "SELECT id FROM approval_rules WHERE tool_name = ? AND allowed_always = 1",
                (tool_name,)
            )
            row = await cursor.fetchone()
            return row is not None
        finally:
            await conn.close()

    async def save_always_allow_rule(self, tool_name: str, pattern: Optional[str] = None) -> None:
        """Persist an Always Allow rule in SQLite."""
        conn = await get_db()
        try:
            now = datetime.now(timezone.utc).isoformat()
            await conn.execute(
                """
                INSERT INTO approval_rules (tool_name, pattern, allowed_always, created_at)
                VALUES (?, ?, 1, ?)
                """,
                (tool_name, pattern or "*", now)
            )
            await conn.commit()
        finally:
            await conn.close()

    async def request_approval(
        self,
        tool_name: str,
        parameters: dict[str, Any],
        risk_level: str = "HIGH",
        description: str = "",
        timeout_seconds: int = 30
    ) -> bool:
        """
        Intercept tool execution. If not already allowed, emit APPROVAL_REQUIRED over WebSocket
        and asynchronously block on asyncio.Event until decision or timeout.
        """
        # Step 1: Check persistent SQLite whitelist rule
        if await self.check_always_allowed(tool_name):
            await log_audit_event(
                category="APPROVAL_GATE",
                action=f"AUTO_APPROVED_{tool_name.upper()}",
                status="SUCCESS",
                details={"tool_name": tool_name, "parameters": parameters, "rule": "ALWAYS_ALLOW"}
            )
            return True

        # Step 2: Create pending approval instance
        req_id = str(uuid.uuid4())
        item = PendingApproval(
            request_id=req_id,
            tool_name=tool_name,
            parameters=parameters,
            risk_level=risk_level,
            description=description or f"Executing OS tool: {tool_name}",
            timeout_seconds=timeout_seconds
        )
        self.pending_requests[req_id] = item

        # Step 3: Broadcast APPROVAL_REQUIRED event to all connected UI clients
        if self.ws_broadcaster:
            await self.ws_broadcaster.broadcast({
                "type": "APPROVAL_REQUIRED",
                **item.to_dict()
            })

        await log_audit_event(
            category="APPROVAL_GATE",
            action=f"APPROVAL_REQUESTED_{tool_name.upper()}",
            status="BLOCKED",
            details=item.to_dict()
        )

        # Step 4: Block execution until user responds or timeout occurs
        try:
            await asyncio.wait_for(item.event.wait(), timeout=float(timeout_seconds))
            decision = item.decision

            if decision == "always":
                await self.save_always_allow_rule(tool_name)
                await log_audit_event(
                    category="APPROVAL_GATE",
                    action=f"APPROVED_ALWAYS_{tool_name.upper()}",
                    status="SUCCESS",
                    details={"request_id": req_id, "tool_name": tool_name, "parameters": parameters}
                )
                return True
            elif decision == "once":
                await log_audit_event(
                    category="APPROVAL_GATE",
                    action=f"APPROVED_ONCE_{tool_name.upper()}",
                    status="SUCCESS",
                    details={"request_id": req_id, "tool_name": tool_name, "parameters": parameters}
                )
                return True
            else:
                await log_audit_event(
                    category="APPROVAL_GATE",
                    action=f"DENIED_{tool_name.upper()}",
                    status="DENIED",
                    details={"request_id": req_id, "tool_name": tool_name, "parameters": parameters}
                )
                return False

        except asyncio.TimeoutError:
            await log_audit_event(
                category="APPROVAL_GATE",
                action=f"TIMEOUT_DENIED_{tool_name.upper()}",
                status="DENIED",
                details={"request_id": req_id, "tool_name": tool_name, "timeout_seconds": timeout_seconds}
            )
            return False
        finally:
            self.pending_requests.pop(req_id, None)

    async def submit_decision(self, request_id: str, decision: str) -> bool:
        """Process user decision (once, always, deny) and unblock the waiting coroutine."""
        item = self.pending_requests.get(request_id)
        if not item:
            return False

        item.decision = decision.lower()
        item.event.set()

        if self.ws_broadcaster:
            await self.ws_broadcaster.broadcast({
                "type": "APPROVAL_RESOLVED",
                "request_id": request_id,
                "decision": item.decision
            })

        return True

    def get_pending_list(self) -> list[dict[str, Any]]:
        return [p.to_dict() for p in self.pending_requests.values()]


approval_gate = ZeroTrustApprovalGate()
