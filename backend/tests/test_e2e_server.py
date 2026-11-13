import asyncio
import json
import httpx
import websockets

BASE_URL = "http://127.0.0.1:8765"
WS_URL = "ws://127.0.0.1:8765/ws"


async def main():
    print("[E2E 1/6] Checking /health endpoint...")
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{BASE_URL}/health")
        assert res.status_code == 200, f"Health check failed: {res.status_code}"
        data = res.json()
        print(f"         Health: {data['status']}, Database: {data['database']}")

    print("[E2E 2/6] Testing POST /api/conversations...")
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{BASE_URL}/api/conversations",
            json={"title": "Test Duckuu Session", "mode": "general"}
        )
        assert res.status_code == 201, f"Create conversation failed: {res.status_code}"
        conv = res.json()
        conv_id = conv["id"]
        print(f"         Created Conversation ID: {conv_id}")

    print("[E2E 3/6] Testing POST /api/chat (REST)...")
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{BASE_URL}/api/chat",
            json={"conversation_id": conv_id, "message": "Quack hello!", "mode": "general"}
        )
        assert res.status_code == 200, f"Chat message failed: {res.status_code}"
        chat_res = res.json()
        print(f"         Chat Reply ({chat_res['provider']}): {chat_res['content'][:60]}...")

    print("[E2E 4/6] Testing WebSocket Live Streaming...")
    async with websockets.connect(WS_URL) as ws:
        # First frame should be ONLINE_STATUS_BADGE
        first_frame = await ws.recv()
        badge_data = json.loads(first_frame)
        assert badge_data.get("type") == "ONLINE_STATUS_BADGE", f"Unexpected frame: {badge_data}"
        print(f"         WS Received: ONLINE_STATUS_BADGE (provider={badge_data.get('provider')})")

        # Test pet interaction event
        await ws.send(json.dumps({
            "type": "PET_INTERACTION",
            "interaction": "click",
            "intensity": 1.0
        }))
        interact_frame = await ws.recv()
        pet_state = json.loads(interact_frame)
        assert pet_state.get("type") == "PET_STATE_CHANGE", f"Unexpected frame: {pet_state}"
        assert pet_state.get("emotion") == "happy"
        print("         WS Verified: Interaction -> 'happy' state")

        # Test live streaming chat over WebSocket
        await ws.send(json.dumps({
            "type": "CHAT_MESSAGE",
            "conversation_id": conv_id,
            "message": "Who are you?",
            "mode": "general"
        }))

        chunks_received = 0
        is_completed = False
        while not is_completed:
            frame_raw = await ws.recv()
            msg = json.loads(frame_raw)
            msg_type = msg.get("type")
            if msg_type == "CHAT_CHUNK":
                chunks_received += 1
            elif msg_type == "CHAT_COMPLETE":
                is_completed = True
                print(f"         WS Chat Stream Completed! Received {chunks_received} chunks. Length: {len(msg.get('full_content', ''))}")
            elif msg_type == "PET_STATE_CHANGE":
                print(f"         WS Pet State changed to: {msg.get('emotion')}")

    print("[E2E 5/6] Checking /api/settings...")
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{BASE_URL}/api/settings")
        assert res.status_code == 200
        settings = res.json()
        print(f"         Settings: Provider={settings['llm_provider']}, Audio={settings['audio_enabled']}")

    print("[E2E 6/6] Checking /api/audit...")
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{BASE_URL}/api/audit?limit=10")
        assert res.status_code == 200
        audit = res.json()
        print(f"         Audit Log Total Entries: {audit['total']}")
        assert audit['total'] >= 3

    print("\n>>> ALL PHASE 1 BACKEND & WEBSOCKET END-TO-END TESTS PASSED 100%! <<<\n")


if __name__ == "__main__":
    asyncio.run(main())
