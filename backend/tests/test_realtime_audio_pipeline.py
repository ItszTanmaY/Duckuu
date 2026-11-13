import pytest
import base64
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport

from backend.app.main import app
from backend.app.core.config import settings
from backend.app.services.voice_engine import voice_engine
from backend.app.services.config_manager import config_manager
from backend.app.db.database import init_db


@pytest.mark.asyncio
async def test_deepgram_stt_transcription_pipeline():
    """Verify Deepgram Nova-2 SDK transcription and Wispr-flow filler word removal."""
    await init_db()
    all_before = await config_manager.get_all_settings()
    try:
        await config_manager.set_settings_bulk({
            "deepgram_api_key": "dg_test_key_12345"
        })
        await config_manager.load_into_runtime()

        # Mock Deepgram response structure
        mock_response = MagicMock()
        mock_alternative = MagicMock()
        mock_alternative.transcript = "um, uh, you know, could you please open VS Code and check the files"
        mock_channel = MagicMock()
        mock_channel.alternatives = [mock_alternative]
        mock_response.results.channels = [mock_channel]

        mock_deepgram_client = MagicMock()
        mock_deepgram_client.listen.v1.media.transcribe_file = AsyncMock(return_value=mock_response)

        fake_audio_bytes = b"RIFF" + b"\x00" * 500  # Valid dummy PCM / WAV bytes (>300 bytes)
        fake_b64 = base64.b64encode(fake_audio_bytes).decode("utf-8")

        with patch("deepgram.AsyncDeepgramClient", return_value=mock_deepgram_client):
            res = await voice_engine.transcribe_audio_base64(fake_b64, clean_with_llm=False)

            assert res["raw_text"] == "um, uh, you know, could you please open VS Code and check the files"
            # Verify deterministic Wispr filler word removal
            clean = res["clean_text"]
            assert "um" not in clean.lower()
            assert "uh" not in clean.lower()
            assert "you know" not in clean.lower()
            assert "open VS Code" in clean
    finally:
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()


@pytest.mark.asyncio
async def test_elevenlabs_tts_generation_and_streaming():
    """Verify ElevenLabs SDK TTS convert and real-time streaming."""
    await init_db()
    all_before = await config_manager.get_all_settings()
    try:
        await config_manager.set_settings_bulk({
            "elevenlabs_api_key": "xi_test_key_99999",
            "elevenlabs_voice_id": "test_voice_id"
        })
        await config_manager.load_into_runtime()

        expected_audio = b"\xff\xfb\x90\x44" + b"AUDIO_STREAM_DATA" * 10

        async def mock_async_stream(*args, **kwargs):
            yield expected_audio[:20]
            yield expected_audio[20:]

        mock_eleven_client = MagicMock()
        mock_eleven_client.text_to_speech.convert = AsyncMock(side_effect=mock_async_stream)

        with patch("elevenlabs.client.AsyncElevenLabs", return_value=mock_eleven_client):
            # 1. Full audio generation
            full_audio = await voice_engine.generate_tts_audio("Hello, I am Duckuu OS agent.")
            assert full_audio is not None
            assert full_audio == expected_audio

            # 2. Real-time streaming chunks
            chunks = []
            async for chunk in voice_engine.stream_tts_audio("Streaming test chunk."):
                chunks.append(chunk)

            assert len(chunks) == 2
            assert b"".join(chunks) == expected_audio
    finally:
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()


@pytest.mark.asyncio
async def test_voice_rest_endpoints_end_to_end():
    """Verify /voice/dictate, /voice/tts, and /voice/tts/stream REST endpoints."""
    await init_db()
    all_before = await config_manager.get_all_settings()
    try:
        await config_manager.set_settings_bulk({
            "deepgram_api_key": "dg_test_key_endpoint",
            "elevenlabs_api_key": "xi_test_key_endpoint"
        })
        await config_manager.load_into_runtime()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Dictate endpoint
            with patch.object(voice_engine, "transcribe_audio_base64", new_callable=AsyncMock) as mock_trans:
                mock_trans.return_value = {
                    "raw_text": "hello duckuu",
                    "clean_text": "Hello Duckuu",
                    "duration_ms": 120
                }
                resp = await client.post("/voice/dictate", json={
                    "audio_base64": base64.b64encode(b"dummy_audio_bytes_12345").decode("utf-8"),
                    "clean_with_llm": False
                })
                assert resp.status_code == 200
                data = resp.json()
                assert data["clean_text"] == "Hello Duckuu"

            # 2. TTS endpoint
            with patch.object(voice_engine, "generate_tts_audio", new_callable=AsyncMock) as mock_gen_tts:
                mock_gen_tts.return_value = b"\xff\xfb\x90\x44MPEG_DUMMY_AUDIO"
                resp_tts = await client.post("/voice/tts", json={
                    "text": "Hello world"
                })
                assert resp_tts.status_code == 200
                assert resp_tts.headers["content-type"] == "audio/mpeg"
                assert resp_tts.content == b"\xff\xfb\x90\x44MPEG_DUMMY_AUDIO"

            # 3. TTS Stream endpoint
            async def mock_stream_gen(*args, **kwargs):
                yield b"CHUNK_1"
                yield b"CHUNK_2"

            with patch.object(voice_engine, "stream_tts_audio", side_effect=mock_stream_gen):
                resp_stream = await client.post("/voice/tts/stream", json={
                    "text": "Streaming voice endpoint"
                })
                assert resp_stream.status_code == 200
                assert "audio/mpeg" in resp_stream.headers["content-type"]
                assert resp_stream.content == b"CHUNK_1CHUNK_2"
    finally:
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()


@pytest.mark.asyncio
async def test_deepgram_and_elevenlabs_settings_lifecycle():
    """Verify deepgram_api_key and elevenlabs settings survive save and reload."""
    await init_db()
    all_before = await config_manager.get_all_settings()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Update settings via REST
            put_resp = await client.put("/api/settings", json={
                "deepgram_api_key": "dg_lifecycle_key_111",
                "elevenlabs_api_key": "xi_lifecycle_key_222",
                "elevenlabs_voice_id": "voice_amber"
            })
            assert put_resp.status_code == 200

            # Get settings back
            get_resp = await client.get("/api/settings")
            assert get_resp.status_code == 200
            data = get_resp.json()
            assert data.get("deepgram_api_key_configured") is True
            assert data.get("elevenlabs_api_key_configured") is True
            assert data.get("elevenlabs_voice_id") == "voice_amber"

            # Verify in runtime settings
            assert settings.DEEPGRAM_API_KEY == "dg_lifecycle_key_111"
            assert settings.ELEVENLABS_API_KEY == "xi_lifecycle_key_222"
            assert settings.ELEVENLABS_VOICE_ID == "voice_amber"
    finally:
        await config_manager.set_settings_bulk(all_before)
        await config_manager.load_into_runtime()
