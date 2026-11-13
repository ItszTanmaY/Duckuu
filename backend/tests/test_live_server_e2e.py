import asyncio
import base64
import json
import subprocess
import sys
import time
import io
import pymupdf
import httpx
import websockets
from pathlib import Path


BASE_URL = "http://127.0.0.1:8770"
WS_URL = "ws://127.0.0.1:8770/ws"


def log(msg: str):
    print(msg, flush=True)


async def run_live_e2e():
    proc = None
    try:
        log("[SETUP] Launching live Duckuu FastAPI test server on port 8770...")
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8770", "--log-level", "warning"],
            cwd="F:/DUCKUU"
        )

        async with httpx.AsyncClient(base_url=BASE_URL, timeout=12.0) as http:
            # Wait for server to come up
            started = False
            for attempt in range(25):
                await asyncio.sleep(0.4)
                try:
                    r = await http.get("/health")
                    if r.status_code == 200:
                        started = True
                        break
                except Exception:
                    pass

            assert started, "Server failed to start within 10 seconds"
            log("      Live server running and listening on 127.0.0.1:8770!")

            # 1. Health check
            log("\n[TEST 1/8] Live Health & System Endpoint Check...")
            r = await http.get("/health")
            assert r.status_code == 200
            data = r.json()
            assert data["status"] == "healthy"
            log(f"      Passed! Status: {data['status']}, DB: {data['database']}, Provider: {data['llm_router']['active_provider']}")

            # 2. PC Agent Tool Execution (safe tool)
            log("\n[TEST 2/8] Live PC Agent Tool Execution via REST...")
            r = await http.post("/api/agent/execute", json={
                "tool_name": "control_volume",
                "parameters": {"action": "get"}
            })
            assert r.status_code == 200
            res = r.json()
            assert res.get("success") is True, f"Failed: {res}"
            log(f"      Passed! Volume: {res.get('volume_percent')}%, Muted: {res.get('is_muted')}")

            # 3. Voice Dictation & Wake Check
            log("\n[TEST 3/8] Live Voice Dictation & VAD Wake-Check via REST...")
            dummy_pcm = b"\x00\x00\x20\x00\x40\x00\x10\x00" * 300
            b64_audio = base64.b64encode(dummy_pcm).decode("ascii")

            r = await http.post("/api/voice/dictate", json={
                "audio_base64": b64_audio,
                "clean_with_llm": False
            })
            assert r.status_code == 200
            dict_res = r.json()
            assert "clean_text" in dict_res
            log(f"      Passed! Voice Dictation processed: RMS={dict_res['rms']}, Duration={dict_res['duration_ms']}ms")

            r = await http.post("/api/voice/wake-check", json={
                "audio_base64": b64_audio,
                "threshold_rms": 10.0
            })
            assert r.status_code == 200
            wake_res = r.json()
            assert wake_res.get("wake") is True
            log(f"      Passed! VAD Wake-Check: wake={wake_res['wake']}, RMS={wake_res['rms']}")

            # 4. Live WebSocket Connection & Interactions
            log("\n[TEST 4/8] Live WebSocket Events & Pet State Machine...")
            async with websockets.connect(WS_URL) as ws:
                init_msg = json.loads(await ws.recv())
                assert init_msg["type"] == "ONLINE_STATUS_BADGE"
                log(f"      Passed! Badge received over WS: is_online={init_msg['is_online']}")

                # Test PING
                await ws.send(json.dumps({"type": "PING"}))
                pong = json.loads(await ws.recv())
                assert pong["type"] == "PONG"
                log("      Passed! WS PING/PONG validated")

                # Test Pet Interaction (scold rapid clicks)
                await ws.send(json.dumps({
                    "type": "PET_INTERACTION",
                    "interaction": "scold_rapid_clicks",
                    "intensity": 2.5
                }))
                state_change = json.loads(await ws.recv())
                assert state_change["type"] == "PET_STATE_CHANGE"
                assert state_change["emotion"] == "annoyed"
                log(f"      Passed! Pet scolding reaction: emotion={state_change['emotion']}, duration={state_change['duration_ms']}ms")

            # 5. Live Zero-Trust Interception & WebSocket Approval Flow
            log("\n[TEST 5/8] Live Zero-Trust Interception, WebSocket Broadcast & Resolution...")
            async with websockets.connect(WS_URL) as ws:
                badge = json.loads(await ws.recv())  # Consume initial badge

                # Launch sensitive action in background async task
                async def trigger_sensitive():
                    return await http.post("/api/agent/execute", json={
                        "tool_name": "open_app",
                        "parameters": {"app_name": "notepad"}
                    })

                exec_task = asyncio.create_task(trigger_sensitive())

                # UI client receives APPROVAL_REQUIRED event
                raw_approval_event = await asyncio.wait_for(ws.recv(), timeout=5.0)
                approval_event = json.loads(raw_approval_event)
                assert approval_event["type"] == "APPROVAL_REQUIRED", f"Unexpected WS event: {approval_event}"
                req_id = approval_event["request_id"]
                assert approval_event["tool_name"] == "open_app"
                log(f"      Passed! APPROVAL_REQUIRED received: ID={req_id}, Tool={approval_event['tool_name']}")

                # Submit decision "once" over WebSocket
                await ws.send(json.dumps({
                    "type": "APPROVAL_DECISION",
                    "request_id": req_id,
                    "decision": "once"
                }))

                # Client receives APPROVAL_RESOLVED
                raw_resolved = await asyncio.wait_for(ws.recv(), timeout=5.0)
                resolved = json.loads(raw_resolved)
                assert resolved["type"] == "APPROVAL_RESOLVED"
                assert resolved["request_id"] == req_id
                log(f"      Passed! APPROVAL_RESOLVED confirmed on WS: decision={resolved['decision']}")

                # Await sensitive tool execution response
                exec_resp = await asyncio.wait_for(exec_task, timeout=5.0)
                assert exec_resp.status_code == 200
                exec_data = exec_resp.json()
                assert exec_data.get("success") is True, f"Execution failed: {exec_data}"
                log(f"      Passed! Sensitive tool executed and unblocked: {exec_data.get('message')}")

            # 6. Live Phase 3 PDF Upload & WebSocket PDF_SUMMARY_CARD Broadcast
            log("\n[TEST 6/8] Live PDF Upload & PDF_SUMMARY_CARD Broadcast over WebSocket...")
            async with websockets.connect(WS_URL) as ws:
                _ = await ws.recv()  # Consume initial badge

                # Generate in-memory PDF
                pdf_doc = pymupdf.open()
                p = pdf_doc.new_page()
                p.insert_text((50, 72), "Duckuu OS Live Architecture Blueprint\n")
                p.insert_text((50, 95), "Section 1: Local-first offline reasoning and memory persistence.\n")
                pdf_bytes = pdf_doc.tobytes()

                # Upload PDF via multipart REST
                upload_task = asyncio.create_task(
                    http.post(
                        "/api/pdf/analyze",
                        files={"file": ("blueprint.pdf", pdf_bytes, "application/pdf")},
                        data={"filename": "blueprint.pdf"}
                    )
                )

                # WebSocket should receive PDF_SUMMARY_CARD broadcast
                raw_card = await asyncio.wait_for(ws.recv(), timeout=5.0)
                card_data = json.loads(raw_card)
                assert card_data["type"] == "PDF_SUMMARY_CARD"
                assert card_data["page_count"] == 1
                assert len(card_data["key_takeaways"]) > 0
                log(f"      Passed! PDF_SUMMARY_CARD broadcast received: '{card_data['title']}' ({card_data['page_count']} pages)")

                upload_resp = await upload_task
                assert upload_resp.status_code == 200
                assert upload_resp.json()["success"] is True

            # 7. Live Deep Research Agent & TASK_PROGRESS Streaming into Library
            log("\n[TEST 7/8] Live Deep Research & TASK_PROGRESS Streaming over WebSocket...")
            async with websockets.connect(WS_URL) as ws:
                _ = await ws.recv()  # Consume initial badge

                # Trigger research via REST
                research_task = asyncio.create_task(
                    http.post("/api/research", json={"query": "Neural Audio Synthesis", "max_sources": 3})
                )

                # Collect at least one TASK_PROGRESS event from WebSocket
                progress_event = None
                for _ in range(5):
                    raw_event = await asyncio.wait_for(ws.recv(), timeout=5.0)
                    evt = json.loads(raw_event)
                    if evt.get("type") == "TASK_PROGRESS":
                        progress_event = evt
                        log(f"      WS Received TASK_PROGRESS: step='{evt['step']}', progress={evt['progress_percent']}%")
                        if evt.get("progress_percent", 0) >= 100:
                            break

                assert progress_event is not None
                r_resp = await research_task
                assert r_resp.status_code == 200
                r_data = r_resp.json()
                assert r_data["success"] is True
                log(f"      Passed! Research dossier compiled: '{r_data['report']['title']}'")

            # 8. Library Listing & Search Verification
            log("\n[TEST 8/8] Live SQLite Library Retrieval & Search...")
            lib_res = await http.get("/api/library")
            assert lib_res.status_code == 200
            lib_items = lib_res.json()["items"]
            assert len(lib_items) >= 2
            log(f"      Passed! Found {len(lib_items)} items indexed in SQLite Library.")
            log(f"      Item 1: [{lib_items[0]['item_type']}] {lib_items[0]['title']}")
            log(f"      Item 2: [{lib_items[1]['item_type']}] {lib_items[1]['title']}")

            log("\n" + "="*70)
            log(">>> 100% OF ALL 8 LIVE END-TO-END SUITE TESTS PASSED SUCCESSFULLY! <<<")
            log("="*70 + "\n")

    finally:
        if proc:
            log("[CLEANUP] Terminating live test server subprocess...")
            proc.terminate()
            try:
                proc.wait(timeout=2.0)
            except Exception:
                proc.kill()
            log("[CLEANUP] Live test server subprocess terminated cleanly.")


if __name__ == "__main__":
    asyncio.run(run_live_e2e())
