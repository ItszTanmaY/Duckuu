import json
import time
import uuid
from datetime import datetime, timezone
from typing import Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.app.db.database import get_db
from backend.app.db.audit import log_audit_event
from backend.app.services.llm_router import llm_router
from backend.app.services.approval_gate import approval_gate
from backend.app.services.pc_agent import pc_agent
from backend.app.services.research_agent import research_agent
from backend.app.services.deadline_scheduler import deadline_scheduler
from backend.app.services.student_drafter import student_drafter
from backend.app.services.student_triage import student_triage
from backend.app.services.intent_router import intent_router
from backend.app.services.focus_timer import focus_timer
from backend.app.services.workspace_context import workspace_context
from backend.app.services.config_manager import config_manager

router = APIRouter(tags=["WebSocket"])


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.add(websocket)
        # Send current LLM status badge upon connecting
        status = await llm_router.get_router_status()
        await websocket.send_text(json.dumps({
            "type": "ONLINE_STATUS_BADGE",
            "is_online": status["is_online"],
            "provider": status["active_provider"],
            "model": status["model"]
        }))
        # Send current workspace context
        ctx = workspace_context.get_context()
        await websocket.send_text(json.dumps({
            "type": "WORKSPACE_CHANGED",
            "active_folder": ctx["active_folder"],
            "folder_name": ctx.get("folder_name", "Workspace"),
            "recent_workspaces": ctx.get("recent_workspaces", [ctx["active_folder"]]),
            "available_projects": workspace_context.get_available_projects()
        }))

    def disconnect(self, websocket: WebSocket) -> None:
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        payload = json.dumps(message)
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                dead.append(connection)
        for d in dead:
            self.active_connections.discard(d)


manager = ConnectionManager()
approval_gate.register_broadcaster(manager)
research_agent.register_broadcaster(manager)
deadline_scheduler.register_broadcaster(manager)
student_triage.register_broadcaster(manager)
focus_timer.register_broadcaster(manager)
workspace_context.register_broadcaster(manager)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                data = json.loads(raw_text)
            except Exception:
                await websocket.send_text(json.dumps({
                    "type": "ERROR",
                    "code": "INVALID_JSON",
                    "message": "Payload must be valid JSON"
                }))
                continue

            event_type = data.get("type")

            if event_type == "PING":
                await websocket.send_text(json.dumps({
                    "type": "PONG",
                    "timestamp": time.time()
                }))

            elif event_type == "APPROVAL_DECISION":
                req_id = data.get("request_id")
                decision = data.get("decision")
                if req_id and decision:
                    await approval_gate.submit_decision(req_id, decision)

            elif event_type == "PET_STATE_SET":
                emotion = data.get("emotion")
                duration = data.get("duration_ms", 3000)
                reason = data.get("reason", "manual_state_set")
                if emotion:
                    await manager.broadcast({
                        "type": "PET_STATE_CHANGE",
                        "emotion": emotion,
                        "reason": reason,
                        "duration_ms": duration
                    })

            elif event_type == "PET_INTERACTION":
                interaction = data.get("interaction")
                intensity = data.get("intensity", 1.0)

                target_emotion = "happy"
                duration = 2000
                if interaction in ("scold_rapid_clicks", "shake"):
                    target_emotion = "annoyed"
                    duration = 3500
                elif interaction in ("click", "pet"):
                    target_emotion = "happy"
                    duration = 2500

                await manager.broadcast({
                    "type": "PET_STATE_CHANGE",
                    "emotion": target_emotion,
                    "reason": f"interaction_{interaction}",
                    "duration_ms": duration
                })

                await log_audit_event(
                    category="PET",
                    action=f"INTERACTION_{interaction.upper()}",
                    status="SUCCESS",
                    details={"intensity": intensity, "emotion": target_emotion}
                )

            elif event_type == "VOICE_TRANSCRIBE":
                audio_b64 = data.get("audio_base64", "")
                from backend.app.services.voice_engine import voice_engine
                transcribe_res = await voice_engine.transcribe_audio_base64(audio_b64)
                await websocket.send_text(json.dumps({
                    "type": "VOICE_TRANSCRIBE_RESULT",
                    "raw_text": transcribe_res.get("raw_text", ""),
                    "clean_text": transcribe_res.get("clean_text", ""),
                    "duration_ms": transcribe_res.get("duration_ms", 0)
                }))

            elif event_type == "CHAT_MESSAGE":
                conv_id = data.get("conversation_id")
                user_text = data.get("message", "").strip()
                mode = data.get("mode", "general")

                if not conv_id or not user_text:
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "code": "BAD_REQUEST",
                        "message": "conversation_id and message are required"
                    }))
                    continue

                # Notify that duck is thinking
                await manager.broadcast({
                    "type": "PET_STATE_CHANGE",
                    "emotion": "thinking",
                    "reason": "processing_user_prompt"
                })

                conn = await get_db()
                try:
                    now = datetime.now(timezone.utc).isoformat()
                    user_msg_id = str(uuid.uuid4())
                    # Ensure conversation exists or create on the fly
                    conv_cursor = await conn.execute(
                        "SELECT id FROM conversations WHERE id = ?",
                        (conv_id,)
                    )
                    if not await conv_cursor.fetchone():
                        short_title = user_text[:30] + ("..." if len(user_text) > 30 else "")
                        await conn.execute(
                            "INSERT INTO conversations (id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                            (conv_id, short_title, mode, now, now)
                        )

                    # Save user message
                    await conn.execute(
                        "INSERT INTO messages (id, conversation_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (user_msg_id, conv_id, "user", user_text, None, now)
                    )
                    await conn.commit()

                    # Fetch complete multi-turn conversation history for active session (Native Agentic Tool Router)
                    history_cursor = await conn.execute(
                        """
                        SELECT role, content FROM (
                            SELECT role, content, created_at FROM messages
                            WHERE conversation_id = ?
                            ORDER BY created_at DESC
                            LIMIT 50
                        ) ORDER BY created_at ASC
                        """,
                        (conv_id,)
                    )
                    history = [{"role": r["role"], "content": r["content"]} for r in await history_cursor.fetchall()]

                    # Begin streaming response
                    assistant_msg_id = str(uuid.uuid4())
                    start_time = time.time()
                    full_chunks = []
                    idx = 0
                    last_meta = {"provider": "unknown", "is_online": False, "model": "unknown"}

                    # Transition pet to working during generation
                    await manager.broadcast({
                        "type": "PET_STATE_CHANGE",
                        "emotion": "working",
                        "reason": "generating_tokens"
                    })

                    try:
                        async for delta, is_done, meta in llm_router.stream_chat(history, mode=mode, conversation_id=conv_id):
                            last_meta = meta
                            if delta:
                                full_chunks.append(delta)
                                await websocket.send_text(json.dumps({
                                    "type": "CHAT_CHUNK",
                                    "conversation_id": conv_id,
                                    "message_id": assistant_msg_id,
                                    "delta": delta,
                                    "index": idx
                                }))
                                idx += 1
                            if is_done:
                                break
                    except Exception as stream_err:
                        print(f"[WebSocket] Caught orchestrator stream exception: {stream_err}")

                    # Prohibit silent failures or infinite hangs: deliver natural failsafe if no tokens yielded
                    if not full_chunks:
                        fallback_msg = "I need an API key in Settings to answer that!"
                        full_chunks.append(fallback_msg)
                        last_meta = {"provider": "unconfigured", "is_online": False, "model": "none"}
                        await websocket.send_text(json.dumps({
                            "type": "CHAT_CHUNK",
                            "conversation_id": conv_id,
                            "message_id": assistant_msg_id,
                            "delta": fallback_msg,
                            "index": 0
                        }))

                    duration_ms = int((time.time() - start_time) * 1000)
                    complete_text = "".join(full_chunks)
                    assistant_now = datetime.now(timezone.utc).isoformat()

                    # Store assistant message with persistent metadata
                    await conn.execute(
                        "INSERT INTO messages (id, conversation_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (assistant_msg_id, conv_id, "assistant", complete_text, json.dumps(last_meta), assistant_now)
                    )
                    await conn.execute(
                        "UPDATE conversations SET updated_at = ? WHERE id = ?",
                        (assistant_now, conv_id)
                    )
                    await conn.commit()
                    await config_manager.set_setting("last_active_conversation_id", conv_id)

                    # Send completion frame
                    await websocket.send_text(json.dumps({
                        "type": "CHAT_COMPLETE",
                        "conversation_id": conv_id,
                        "message_id": assistant_msg_id,
                        "full_content": complete_text,
                        "provider": last_meta.get("provider", "fallback"),
                        "is_online": last_meta.get("is_online", False),
                        "duration_ms": duration_ms
                    }))

                    # Duck finished! Return to 'done' then 'idle'
                    await manager.broadcast({
                        "type": "PET_STATE_CHANGE",
                        "emotion": "done",
                        "duration_ms": 2000
                    })

                    await log_audit_event(
                        category="CHAT",
                        action="STREAM_COMPLETE",
                        status="SUCCESS",
                        details={
                            "conversation_id": conv_id,
                            "tokens_estimated": len(complete_text.split()),
                            "duration_ms": duration_ms,
                            "provider": last_meta.get("provider")
                        }
                    )
                finally:
                    await conn.close()

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
