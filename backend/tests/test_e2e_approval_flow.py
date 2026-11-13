import base64
import json
import time
import threading
from starlette.testclient import TestClient
from backend.app.main import app
from backend.app.services.approval_gate import approval_gate


def test_e2e_approval_flow():
    client = TestClient(app)

    print("[E2E 1/6] Testing REST Health & System Endpoints...")
    health_resp = client.get("/health")
    assert health_resp.status_code == 200, f"Health check failed: {health_resp.text}"
    health_data = health_resp.json()
    assert health_data["status"] == "healthy"
    print(f"      Health OK: {health_data['status']}, Provider: {health_data['llm_router']['active_provider']}")

    print("[E2E 2/6] Testing Safe PC Agent Tool Execution via REST...")
    tool_resp = client.post("/api/agent/execute", json={
        "tool_name": "control_volume",
        "parameters": {"action": "get"}
    })
    assert tool_resp.status_code == 200, f"Tool execution failed: {tool_resp.text}"
    tool_data = tool_resp.json()
    assert tool_data.get("success") is True
    print(f"      Volume Tool OK: Volume={tool_data['volume_percent']}%, Muted={tool_data['is_muted']}")

    print("[E2E 3/6] Testing Voice Dictation & Wake Check Endpoints...")
    dummy_pcm = b"\x00\x00\x20\x00\x40\x00\x10\x00" * 200
    b64_audio = base64.b64encode(dummy_pcm).decode("ascii")

    dictate_resp = client.post("/api/voice/dictate", json={
        "audio_base64": b64_audio,
        "clean_with_llm": False
    })
    assert dictate_resp.status_code == 200, f"Voice dictation failed: {dictate_resp.text}"
    dictate_data = dictate_resp.json()
    assert "clean_text" in dictate_data
    print(f"      Voice Dictation REST OK: RMS={dictate_data['rms']}")

    wake_resp = client.post("/api/voice/wake-check", json={
        "audio_base64": b64_audio,
        "threshold_rms": 10.0
    })
    assert wake_resp.status_code == 200
    wake_data = wake_resp.json()
    assert wake_data["wake"] is True
    print(f"      VAD Wake Check OK: wake={wake_data['wake']} (RMS: {wake_data['rms']})")

    print("[E2E 4/6] Testing WebSocket Connection & Interactive Events...")
    with client.websocket_connect("/ws") as ws:
        # Step A: Check initial badge
        init_event = ws.receive_json()
        assert init_event["type"] == "ONLINE_STATUS_BADGE"
        print(f"      WebSocket Connected! Badge received: is_online={init_event['is_online']}")

        # Step B: Test PING / PONG
        ws.send_json({"type": "PING"})
        pong_event = ws.receive_json()
        assert pong_event["type"] == "PONG"
        print("      WebSocket PING/PONG OK!")

        # Step C: Test PET_INTERACTION (Scold)
        ws.send_json({"type": "PET_INTERACTION", "interaction": "scold_rapid_clicks", "intensity": 2.0})
        pet_event = ws.receive_json()
        assert pet_event["type"] == "PET_STATE_CHANGE"
        assert pet_event["emotion"] == "annoyed"
        print(f"      WebSocket Pet Interaction OK: Emotion={pet_event['emotion']}, Duration={pet_event['duration_ms']}ms")

    print("[E2E 5/6] Testing Zero-Trust Interception, WebSocket Broadcast & Resolution...")
    with client.websocket_connect("/ws") as ws:
        _ = ws.receive_json()  # Consume initial badge

        # Call sensitive agent tool in background thread
        exec_result = {}
        def run_sensitive_call():
            resp = client.post("/api/agent/execute", json={
                "tool_name": "open_app",
                "parameters": {"app_name": "notepad"}
            })
            exec_result["response"] = resp.json()

        worker_thread = threading.Thread(target=run_sensitive_call, daemon=True)
        worker_thread.start()

        # WebSocket receives APPROVAL_REQUIRED event broadcast
        approval_req_event = ws.receive_json()
        assert approval_req_event["type"] == "APPROVAL_REQUIRED", f"Unexpected WS event: {approval_req_event}"
        intercepted_id = approval_req_event["request_id"]
        assert approval_req_event["tool_name"] == "open_app"
        print(f"      WebSocket APPROVAL_REQUIRED broadcast received for ID: {intercepted_id} (tool: {approval_req_event['tool_name']})")

        # Verify it appears in GET /api/approval/pending
        pending_resp = client.get("/api/approval/pending")
        assert pending_resp.status_code == 200
        pending_items = pending_resp.json()
        assert any(item["request_id"] == intercepted_id for item in pending_items)
        print(f"      REST GET /api/approval/pending verified! {len(pending_items)} pending request(s).")

        # Submit decision "once" over WebSocket
        ws.send_json({
            "type": "APPROVAL_DECISION",
            "request_id": intercepted_id,
            "decision": "once"
        })

        # WebSocket receives APPROVAL_RESOLVED event
        resolved_event = ws.receive_json()
        assert resolved_event["type"] == "APPROVAL_RESOLVED"
        assert resolved_event["request_id"] == intercepted_id
        assert resolved_event["decision"] == "once"
        print(f"      WebSocket APPROVAL_RESOLVED broadcast received: decision={resolved_event['decision']}")

        # Join the thread
        worker_thread.join(timeout=5.0)
        assert not worker_thread.is_alive(), "Worker thread should have completed"
        assert exec_result.get("response", {}).get("success") is True, f"Execution failed: {exec_result}"
        print(f"      Background execution completed successfully: {exec_result['response']}")

    print("[E2E 6/6] Verifying SQLite Audit Logs & Always-Allow Rules...")
    audit_resp = client.get("/api/audit?limit=10")
    assert audit_resp.status_code == 200
    data = audit_resp.json()
    logs = data.get("logs", [])
    assert len(logs) > 0
    print(f"      Verified SQLite audit_logs contains {len(logs)} recent entries (total in DB: {data.get('total')}).")
    categories = {log["category"] for log in logs}
    print(f"      Categories recorded in audit: {categories}")

    rules_resp = client.get("/api/approval/rules")
    assert rules_resp.status_code == 200
    rules = rules_resp.json()
    print(f"      Approval Rules in SQLite: {len(rules)} persistent rules.")

    print("\n=======================================================")
    print(">>> ALL 6 END-TO-END REST + WEBSOCKET INTEGRATION TESTS PASSED 100%! <<<")
    print("=======================================================\n")


if __name__ == "__main__":
    test_e2e_approval_flow()
