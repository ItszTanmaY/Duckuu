import base64
import io
import time
import re
import inspect
from typing import Optional, Any
import httpx
from backend.app.core.config import settings
from backend.app.db.audit import log_audit_event
from backend.app.services.llm_router import llm_router


class VoiceEngine:
    def __init__(self) -> None:
        self.model = None
        self._is_loading = False

    async def _ensure_settings(self) -> None:
        """Loads API keys from SQLite app_settings if not already set in settings."""
        try:
            from backend.app.db.database import get_db
            conn = await get_db()
            try:
                cursor = await conn.execute(
                    "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'groq_api_key', 'openai_api_key', 'deepgram_api_key', 'elevenlabs_api_key', 'elevenlabs_voice_id')"
                )
                for r in await cursor.fetchall():
                    k, v = r["key"], r["value"]
                    if k == "gemini_api_key" and v:
                        settings.GEMINI_API_KEY = v
                    elif k == "groq_api_key" and v:
                        settings.GROQ_API_KEY = v
                    elif k == "openai_api_key" and v:
                        settings.OPENAI_API_KEY = v
                    elif k == "deepgram_api_key" and v:
                        settings.DEEPGRAM_API_KEY = v
                    elif k == "elevenlabs_api_key" and v:
                        settings.ELEVENLABS_API_KEY = v
                    elif k == "elevenlabs_voice_id" and v:
                        settings.ELEVENLABS_VOICE_ID = v
            finally:
                await conn.close()
        except Exception:
            pass

    async def transcribe_audio_base64(
        self,
        audio_base64: str,
        clean_with_llm: bool = True
    ) -> dict[str, Any]:
        """
        Transcribes base64-encoded audio (WebM, WAV, MP3).
        Prioritizes Gemini multimodal STT (sub-second verbatim transcription),
        then Groq Whisper, OpenAI Whisper, and local speech engines.
        """
        await self._ensure_settings()
        start_time = time.time()
        raw_text = ""

        try:
            audio_bytes = base64.b64decode(audio_base64)
        except Exception as e:
            return {"raw_text": "", "clean_text": "", "duration_ms": 0, "error": f"Invalid base64: {e}"}

        if len(audio_bytes) < 300:
            return {"raw_text": "", "clean_text": "", "duration_ms": 0, "error": "Audio too short"}

        # 1. Primary Enterprise Route: Deepgram SDK Nova-2
        if settings.DEEPGRAM_API_KEY:
            try:
                from deepgram import AsyncDeepgramClient
                client = AsyncDeepgramClient(api_key=settings.DEEPGRAM_API_KEY)
                res = await client.listen.v1.media.transcribe_file(
                    request=audio_bytes,
                    model="nova-2",
                    smart_format=True,
                    punctuate=True
                )
                if res and res.results and res.results.channels:
                    alts = res.results.channels[0].alternatives
                    if alts and alts[0].transcript:
                        raw_text = alts[0].transcript.strip()
            except Exception as dg_err:
                print(f"[VoiceEngine] Deepgram transcription error: {dg_err}")

        # 2. Secondary Enterprise Route: Gemini Native Multimodal Audio Transcription
        if not raw_text and settings.GEMINI_API_KEY:
            for gem_model in ["gemini-2.0-flash", "gemini-flash-latest", "gemini-2.5-flash", "gemini-1.5-flash"]:
                try:
                    prompt_text = (
                        "Transcribe the spoken English speech in this audio exactly. "
                        "Output ONLY the verbatim text with natural punctuation. "
                        "Do NOT add any quotation marks, intro, markdown tags, or notes. "
                        "If the audio contains only silence or background static, output an empty string."
                    )
                    url = (
                        f"https://generativelanguage.googleapis.com/v1beta/models/{gem_model}:generateContent"
                        f"?key={settings.GEMINI_API_KEY}"
                    )
                    payload = {
                        "contents": [{
                            "parts": [
                                {"text": prompt_text},
                                {"inline_data": {"mime_type": "audio/webm", "data": audio_base64}}
                            ]
                        }],
                        "generationConfig": {
                            "temperature": 0.1,
                            "maxOutputTokens": 1024
                        }
                    }
                    async with httpx.AsyncClient(timeout=15.0) as client:
                        resp = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
                        if resp.status_code == 200:
                            cand = resp.json().get("candidates", [])
                            if cand:
                                parts = cand[0].get("content", {}).get("parts", [])
                                if parts:
                                    raw_text = parts[0].get("text", "").strip()
                                    if raw_text:
                                        break
                except Exception:
                    pass

        # 3. Tertiary Route: Groq Whisper Cloud API
        if not raw_text and settings.GROQ_API_KEY:
            try:
                files = {"file": ("audio.webm", audio_bytes, "audio/webm")}
                data = {"model": "whisper-large-v3"}
                headers = {"Authorization": f"Bearer {settings.GROQ_API_KEY}"}
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.post(
                        "https://api.groq.com/openai/v1/audio/transcriptions",
                        files=files,
                        data=data,
                        headers=headers
                    )
                    if resp.status_code == 200:
                        raw_text = resp.json().get("text", "").strip()
            except Exception:
                pass

        # 3. Tertiary Route: OpenAI Whisper API
        if not raw_text and settings.OPENAI_API_KEY:
            try:
                files = {"file": ("audio.webm", audio_bytes, "audio/webm")}
                data = {"model": "whisper-1"}
                headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}"}
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.post(
                        "https://api.openai.com/v1/audio/transcriptions",
                        files=files,
                        data=data,
                        headers=headers
                    )
                    if resp.status_code == 200:
                        raw_text = resp.json().get("text", "").strip()
            except Exception:
                pass

        # 4. Quaternary Route: Local Python SpeechRecognition (if WAV format)
        if not raw_text and len(audio_bytes) > 2000:
            try:
                import speech_recognition as sr
                recognizer = sr.Recognizer()
                with sr.AudioFile(io.BytesIO(audio_bytes)) as source:
                    audio_data = recognizer.record(source)
                    raw_text = recognizer.recognize_google(audio_data)
            except Exception:
                pass

        # If audio energy is present but external transcription didn't return text, keep empty to prevent ghost messages
        if not raw_text:
            return {"raw_text": "", "clean_text": "", "duration_ms": int((time.time() - start_time) * 1000)}

        # Step 2: Wispr-Flow Filler Word Cleaning
        clean_text = self.strip_filler_words(raw_text)

        if clean_with_llm and len(clean_text.split()) > 5:
            clean_text = await self.polish_with_llm(clean_text)

        duration_ms = int((time.time() - start_time) * 1000)

        await log_audit_event(
            category="VOICE",
            action="WISPR_DICTATION",
            status="SUCCESS",
            details={
                "raw_text": raw_text,
                "clean_text": clean_text,
                "duration_ms": duration_ms
            }
        )

        return {
            "raw_text": raw_text,
            "clean_text": clean_text,
            "duration_ms": duration_ms
        }

    def strip_filler_words(self, text: str) -> str:
        """Deterministic heuristic removal of verbal hesitations."""
        if not text:
            return ""

        result = text
        for phrase in ["you know", "i mean", "sort of", "kind of"]:
            pattern = re.compile(rf"\b{re.escape(phrase)}\b", re.IGNORECASE)
            result = pattern.sub("", result)

        words = result.split()
        single_fillers = {"um", "uh", "ah", "erm", "like", "basically", "so"}
        cleaned_words = [
            w for w in words
            if w.strip(" ,.!?").lower() not in single_fillers
        ]
        result = " ".join(cleaned_words).strip()

        result = re.sub(r'\s+', ' ', result)
        result = result.replace(" ,", ",").replace(" .", ".")
        if result and result[0].islower():
            result = result[0].upper() + result[1:]
        return result

    async def polish_with_llm(self, text: str) -> str:
        """Use local LLM router for subtle grammar, punctuation, and formatting polish."""
        prompt = (
            "You are a Wispr speech cleaning engine. "
            "Remove all filler words, fix punctuation and capitalization, and preserve the original meaning. "
            "Return ONLY the clean text with no commentary or quotes.\n\n"
            f"Input: {text}"
        )
        parts = []
        try:
            async for chunk, done, _ in llm_router.stream_chat([{"role": "user", "content": prompt}], mode="general"):
                if chunk:
                    parts.append(chunk)
                if done:
                    break
            polished = "".join(parts).strip().strip('"')
            return polished if polished else text
        except Exception:
            return text

    def calculate_audio_rms(self, raw_bytes: bytes) -> float:
        """Calculates RMS energy from raw audio bytes (PCM or audio chunk)."""
        if not raw_bytes:
            return 0.0
        try:
            import audioop
            return float(audioop.rms(raw_bytes, 2))
        except Exception:
            try:
                import math
                count = min(len(raw_bytes), 4000)
                if count == 0:
                    return 0.0
                sum_sq = sum(b * b for b in raw_bytes[:count])
                return math.sqrt(sum_sq / count)
            except Exception:
                return 0.0

    async def generate_tts_audio(self, text: str, voice_id: Optional[str] = None) -> Optional[bytes]:
        """Generates natural studio speech audio using ElevenLabs SDK with REST fallback."""
        await self._ensure_settings()
        if not settings.ELEVENLABS_API_KEY:
            return None

        clean_text = re.sub(r"[\*#_`>\[\]\(\)]", " ", text).strip()
        clean_text = re.sub(r"https?://\S+", "", clean_text)
        clean_text = re.sub(r"\s+", " ", clean_text)
        if not clean_text:
            return None

        v_id = voice_id or settings.ELEVENLABS_VOICE_ID or "21m00Tcm4TlvDq8ikWAM"

        # 1. Try ElevenLabs Official SDK
        try:
            from elevenlabs.client import AsyncElevenLabs
            client = AsyncElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
            generator = client.text_to_speech.convert(
                voice_id=v_id,
                text=clean_text[:600],
                model_id="eleven_turbo_v2_5"
            )
            if inspect.isawaitable(generator):
                generator = await generator
            chunks = []
            async for chunk in generator:
                if chunk:
                    chunks.append(chunk)
            if chunks:
                return b"".join(chunks)
        except Exception as sdk_err:
            print(f"[VoiceEngine] ElevenLabs SDK error: {sdk_err}")

        # 2. Direct HTTP REST fallback
        try:
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{v_id}"
            headers = {
                "xi-api-key": settings.ELEVENLABS_API_KEY,
                "Content-Type": "application/json"
            }
            payload = {
                "text": clean_text[:600],
                "model_id": "eleven_turbo_v2_5",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75
                }
            }
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    return resp.content
        except Exception:
            return None
        return None

    async def stream_tts_audio(self, text: str, voice_id: Optional[str] = None):
        """Asynchronously streams audio bytes chunk by chunk from ElevenLabs for real-time playback."""
        await self._ensure_settings()
        if not settings.ELEVENLABS_API_KEY:
            return

        clean_text = re.sub(r"[\*#_`>\[\]\(\)]", " ", text).strip()
        clean_text = re.sub(r"https?://\S+", "", clean_text)
        clean_text = re.sub(r"\s+", " ", clean_text)
        if not clean_text:
            return

        v_id = voice_id or settings.ELEVENLABS_VOICE_ID or "21m00Tcm4TlvDq8ikWAM"
        try:
            from elevenlabs.client import AsyncElevenLabs
            client = AsyncElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
            generator = client.text_to_speech.convert(
                voice_id=v_id,
                text=clean_text[:600],
                model_id="eleven_turbo_v2_5"
            )
            if inspect.isawaitable(generator):
                generator = await generator
            async for chunk in generator:
                if chunk:
                    yield chunk
        except Exception as e:
            print(f"[VoiceEngine] ElevenLabs stream error: {e}")

    def speak_text(self, text: str) -> dict[str, Any]:
        """Speaks text aloud using Windows native SAPI."""
        clean_text = re.sub(r"[\*#_`>\[\]\(\)]", " ", text).strip()
        clean_text = re.sub(r"https?://\S+", "", clean_text)
        clean_text = re.sub(r"\s+", " ", clean_text)
        if len(clean_text) > 300:
            clean_text = clean_text[:300] + "..."
        try:
            import win32com.client
            speaker = win32com.client.Dispatch("SAPI.SpVoice")
            # Flag 1 is SVSFlagsAsync (asynchronous, non-blocking)
            speaker.Speak(clean_text, 1)
            return {"success": True, "spoken_text": clean_text}
        except Exception as e:
            return {"success": False, "error": str(e)}


voice_engine = VoiceEngine()
