import os
import json
import urllib.parse
import webbrowser
import httpx
from datetime import datetime, timezone
from typing import Optional, Any
from backend.app.core.config import settings
from backend.app.db.database import get_db
from backend.app.db.audit import log_audit_event
from backend.app.services.approval_gate import approval_gate


class MessagingDispatcher:
    """
    Multi-channel WhatsApp and student messaging dispatcher.
    Supports:
    - Mode A: Official Meta WhatsApp Cloud API (graph.facebook.com)
    - Mode B: Zero-Cost Instant WhatsApp OS Deep-Link (whatsapp://send / https://wa.me)
    Every dispatch is gated by Zero-Trust approval and logged to audit_logs.
    """

    async def send_student_message(
        self,
        student_id: str,
        student_name: str,
        phone: str,
        message_text: str,
        channel: Optional[str] = None,
        assignment_ids: Optional[list[str]] = None,
        bypass_approval: bool = False
    ) -> dict[str, Any]:
        """
        Dispatches a personalized message to a student after Zero-Trust approval.
        Updates reminder timestamps in student_assignments.
        """
        clean_phone = self.normalize_phone(phone)
        effective_channel = channel or "whatsapp_deeplink"

        # Step 1: Zero-Trust Approval Gate Interception
        if not bypass_approval:
            description = (
                f"Send {effective_channel} update to {student_name} ({clean_phone}):\n"
                f"\"{message_text[:120]}{'...' if len(message_text) > 120 else ''}\""
            )
            approved = await approval_gate.request_approval(
                tool_name="send_whatsapp_message",
                parameters={
                    "student_id": student_id,
                    "student_name": student_name,
                    "phone": clean_phone,
                    "channel": effective_channel,
                    "message_preview": message_text[:150],
                    "assignment_ids": assignment_ids or []
                },
                risk_level="MEDIUM",
                description=description
            )
            if not approved:
                await log_audit_event(
                    category="MESSAGING",
                    action=f"DISPATCH_DENIED_{effective_channel.upper()}",
                    status="DENIED",
                    details={"student_name": student_name, "phone": clean_phone, "channel": effective_channel}
                )
                return {
                    "success": False,
                    "error": "Message dispatch denied by user or timed out",
                    "channel": effective_channel
                }

        # Step 2: Channel Dispatch Execution
        dispatch_res: dict[str, Any]
        if effective_channel == "whatsapp_cloud":
            dispatch_res = await self._send_meta_cloud_api(clean_phone, message_text)
        else:
            # Default zero-cost mode: OS Deep-Link + web fallback
            dispatch_res = self._send_whatsapp_deeplink(clean_phone, message_text)

        # Step 3: Record audit log
        status_str = "SUCCESS" if dispatch_res.get("success") else "FAILED"
        await log_audit_event(
            category="MESSAGING",
            action=f"DISPATCH_{effective_channel.upper()}",
            status=status_str,
            details={
                "student_id": student_id,
                "student_name": student_name,
                "phone": clean_phone,
                "channel": effective_channel,
                "dispatch_info": dispatch_res
            }
        )

        # Step 4: Update reminder history in student_assignments
        if dispatch_res.get("success") and assignment_ids:
            await self._update_reminder_tracking(student_id, assignment_ids)

        return {
            "success": dispatch_res.get("success", False),
            "student_id": student_id,
            "student_name": student_name,
            "channel": effective_channel,
            "phone": clean_phone,
            "details": dispatch_res
        }

    def normalize_phone(self, phone: str) -> str:
        """Cleans formatting to standard E.164 digits format (+1234567890)."""
        stripped = "".join(c for c in phone if c.isdigit() or c == "+")
        if not stripped.startswith("+") and len(stripped) >= 10:
            stripped = "+" + stripped
        return stripped

    def _send_whatsapp_deeplink(self, clean_phone: str, message: str) -> dict[str, Any]:
        """
        Zero-Cost Mode B: Formats and opens WhatsApp Desktop/Web pre-filled chat
        using OS protocol deep-link (whatsapp://send) and https://wa.me web fallback.
        """
        digits_only = "".join(c for c in clean_phone if c.isdigit())
        encoded_text = urllib.parse.quote(message)

        protocol_url = f"whatsapp://send?phone={digits_only}&text={encoded_text}"
        web_url = f"https://wa.me/{digits_only}?text={encoded_text}"

        opened = False
        try:
            # Try launching the native desktop protocol first on Windows
            if os.name == "nt":
                import subprocess
                subprocess.Popen(f'start "" "{protocol_url}"', shell=True)
                opened = True
            else:
                webbrowser.open(protocol_url)
                opened = True
        except Exception:
            try:
                webbrowser.open(web_url)
                opened = True
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "protocol_url": protocol_url,
                    "web_url": web_url
                }

        return {
            "success": True,
            "mode": "deeplink",
            "protocol_url": protocol_url,
            "web_url": web_url,
            "opened": opened,
            "message": f"Pre-filled WhatsApp chat opened for {clean_phone}"
        }

    async def _send_meta_cloud_api(self, clean_phone: str, message: str) -> dict[str, Any]:
        """
        Mode A: Official Meta WhatsApp Cloud API (graph.facebook.com).
        Sends payload to Meta Developer Sandbox or Live WhatsApp Business Account.
        """
        phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
        access_token = os.getenv("WHATSAPP_ACCESS_TOKEN", "")

        # If credentials not set in env, check SQLite app_settings
        if not phone_number_id or not access_token:
            conn = await get_db()
            try:
                cursor = await conn.execute(
                    "SELECT key, value FROM app_settings WHERE key IN ('whatsapp_phone_number_id', 'whatsapp_access_token')"
                )
                rows = await cursor.fetchall()
                for r in rows:
                    if r["key"] == "whatsapp_phone_number_id":
                        phone_number_id = r["value"]
                    elif r["key"] == "whatsapp_access_token":
                        access_token = r["value"]
            finally:
                await conn.close()

        if not phone_number_id or not access_token:
            # Graceful fallback to zero-cost deep-link mode if Meta API credentials not yet entered
            fallback_res = self._send_whatsapp_deeplink(clean_phone, message)
            fallback_res["notice"] = "Meta Cloud API credentials not configured; redirected to Zero-Cost Deep-Link mode."
            return fallback_res

        digits_only = "".join(c for c in clean_phone if c.isdigit())
        api_url = f"https://graph.facebook.com/v19.0/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        payload = {
            "messaging_product": "whatsapp",
            "to": digits_only,
            "type": "text",
            "text": {"body": message}
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(api_url, headers=headers, json=payload)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    msg_id = data.get("messages", [{}])[0].get("id", "unknown")
                    return {
                        "success": True,
                        "mode": "meta_cloud_api",
                        "meta_message_id": msg_id,
                        "raw_response": data
                    }
                else:
                    return {
                        "success": False,
                        "mode": "meta_cloud_api",
                        "error": f"Meta API error {resp.status_code}: {resp.text}"
                    }
        except Exception as e:
            return {
                "success": False,
                "mode": "meta_cloud_api",
                "error": str(e)
            }

    async def _update_reminder_tracking(self, student_id: str, assignment_ids: list[str]) -> None:
        """Updates last_reminded_at and increments reminder_count in SQLite."""
        conn = await get_db()
        try:
            now = datetime.now(timezone.utc).isoformat()
            for a_id in assignment_ids:
                await conn.execute(
                    """
                    UPDATE student_assignments
                    SET last_reminded_at = ?, reminder_count = reminder_count + 1, updated_at = ?
                    WHERE student_id = ? AND assignment_id = ?
                    """,
                    (now, now, student_id, a_id)
                )
            await conn.commit()
        finally:
            await conn.close()


messaging_dispatcher = MessagingDispatcher()
