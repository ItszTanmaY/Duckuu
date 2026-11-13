import asyncio
import os
import sys
from pathlib import Path

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.app.core.config import settings
from backend.app.db.database import init_db, get_db
from backend.app.db.audit import log_audit_event, get_audit_logs
from backend.app.services.llm_router import llm_router


async def test_backend():
    print("[1/5] Testing SQLite DB Initialization...")
    await init_db()
    conn = await get_db()
    cursor = await conn.execute("SELECT COUNT(*) FROM app_settings")
    count = (await cursor.fetchone())[0]
    await conn.close()
    assert count >= 6, f"Expected at least 6 initial settings, got {count}"
    print(f"      OK! Settings count: {count}")

    print("[2/5] Testing Audit Logger...")
    log_id = await log_audit_event(
        category="SYSTEM_TEST",
        action="VERIFY_PHASE_1",
        status="SUCCESS",
        details={"test_key": "test_value"}
    )
    assert log_id > 0, f"Expected positive log_id, got {log_id}"
    total, logs = await get_audit_logs(limit=5, category="SYSTEM_TEST")
    assert total >= 1, f"Expected at least 1 log, got {total}"
    assert logs[0]["action"] == "VERIFY_PHASE_1"
    print(f"      OK! Recorded audit log #{log_id}")

    print("[3/5] Testing LLM Router Status...")
    status = await llm_router.get_router_status()
    print(f"      LLM Router Status: provider={status['active_provider']}, model={status['model']}, is_online={status['is_online']}")
    assert "active_provider" in status
    assert "model" in status

    print("[4/5] Testing Streaming LLM Response...")
    test_messages = [{"role": "user", "content": "Hello Duckuu!"}]
    chunks = []
    async for chunk, done, meta in llm_router.stream_chat(test_messages, mode="general"):
        if chunk:
            chunks.append(chunk)
        if done:
            break
    full_text = "".join(chunks)
    assert len(full_text) > 0, "Expected non-empty LLM response"
    print(f"      Response received: {full_text[:80]}...")

    print("[5/5] Backend Phase 1 Verification Passed 100%!")


if __name__ == "__main__":
    asyncio.run(test_backend())
