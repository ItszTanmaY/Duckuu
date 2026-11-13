import os
import json
import asyncio
import re
import urllib.parse
from typing import AsyncGenerator, Any, Optional
from dotenv import load_dotenv
import httpx
from backend.app.core.config import settings
from backend.app.db.audit import log_audit_event
from backend.app.services.workspace_context import workspace_context
from backend.app.services.agent_tools import agent_tools

load_dotenv()


SYSTEM_PROMPTS = {
    "general": (
        "You are Duckuu, an elite, high-end AI desktop companion. "
        "Speak naturally, conversationally, and concisely. Never use canned sign-offs. "
        "You have a subtle, witty personality, but your primary goal is frictionless execution and deep reasoning. "
        "Do not append forced catchphrases, 'quack', or robotic sign-offs to your responses. "
        "You have native desktop capabilities on Windows to launch applications (such as VS Code, Chrome, and Spotify), create project files, inspect active folders, and run terminal commands. "
        "If the user asks for a capability you don't possess directly (such as playing specific songs or tracks on Spotify, or hardware control), respond naturally and conversationally like a real AI (e.g. explain that you don't have the ability to play Spotify right now, but offer to open the app for them). "
        "When explaining concepts, answering questions, or providing code, deliver deeply insightful, beautifully structured responses. "
        "Use GitHub-flavored markdown with bold highlights, bullet points, headers, and code snippets where appropriate."
    ),
    "student": (
        "You are Duckuu, an elite, high-end AI desktop companion in Student & Academic Mentor Mode "
        "(specialized for BTech CSE AI/ML and software engineering coursework). "
        "Speak naturally, conversationally, and concisely. Never use canned sign-offs or forced catchphrases. "
        "If asked for capabilities you don't possess directly, explain naturally and offer practical alternatives. "
        "Explain complex technical topics step-by-step with intuitive analogies, mathematical formulas, and practical production-grade Python/C++ code implementations. "
        "Break down homework problems with pedagogical clarity, verify edge cases, and guide the student to mastery."
    ),
    "research": (
        "You are Duckuu, an elite, high-end AI desktop companion in Deep Research Mode. "
        "Speak naturally, conversationally, and concisely. Never use canned sign-offs or forced catchphrases. "
        "If asked for capabilities you don't possess directly, explain naturally and offer practical alternatives. "
        "Analyze questions with rigorous, publication-grade precision, "
        "break down empirical facts, compare alternative methodologies and architectures, provide structured takeaways, and cite mechanisms clearly."
    ),
    "files": (
        "You are Duckuu, an elite, high-end AI desktop companion in File & OS System Mode. "
        "Speak naturally, conversationally, and concisely. Never use canned sign-offs or forced catchphrases. "
        "If asked for capabilities you don't possess directly, explain naturally and offer practical alternatives. "
        "Focus on analyzing files, paths, directory structures, "
        "and executing productive OS workflows cleanly and accurately with PowerShell commands."
    )
}


class LLMRouter:
    def __init__(self) -> None:
        self.ollama_base_url = settings.OLLAMA_BASE_URL
        self.default_model = settings.OLLAMA_MODEL
        self.fallback_model = settings.FALLBACK_MODEL

    async def _load_keys_from_db(self) -> None:
        """Loads API keys prioritizing .env environment variables with database fallback."""
        load_dotenv(override=True)
        if os.getenv("GEMINI_API_KEY"):
            settings.GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
        if os.getenv("GROQ_API_KEY"):
            settings.GROQ_API_KEY = os.getenv("GROQ_API_KEY")
        if os.getenv("OPENAI_API_KEY"):
            settings.OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
        if os.getenv("ELEVENLABS_API_KEY"):
            settings.ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
        if os.getenv("DEEPGRAM_API_KEY"):
            settings.DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

        try:
            from backend.app.db.database import get_db
            conn = await get_db()
            try:
                cursor = await conn.execute(
                    "SELECT key, value FROM app_settings WHERE key IN ('groq_api_key', 'gemini_api_key', 'openai_api_key', 'elevenlabs_api_key', 'elevenlabs_voice_id', 'ollama_model', 'llm_provider', 'cloud_provider')"
                )
                rows = await cursor.fetchall()
                for r in rows:
                    k, v = r["key"], r["value"]
                    if k == "groq_api_key" and v and not settings.GROQ_API_KEY:
                        settings.GROQ_API_KEY = v
                    elif k == "gemini_api_key" and v and not settings.GEMINI_API_KEY:
                        settings.GEMINI_API_KEY = v
                    elif k == "openai_api_key" and v and not settings.OPENAI_API_KEY:
                        settings.OPENAI_API_KEY = v
                    elif k == "elevenlabs_api_key" and v and not settings.ELEVENLABS_API_KEY:
                        settings.ELEVENLABS_API_KEY = v
                    elif k == "elevenlabs_voice_id" and v:
                        settings.ELEVENLABS_VOICE_ID = v
            finally:
                await conn.close()
        except Exception:
            pass

    async def get_router_status(self) -> dict[str, Any]:
        """Detect local Ollama availability, stored API keys, and active router mode."""
        await self._load_keys_from_db()

        available_local_models: list[str] = []
        ollama_online = False

        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                res = await client.get(f"{self.ollama_base_url}/api/tags")
                if res.status_code == 200:
                    data = res.json()
                    available_local_models = [m.get("name", "") for m in data.get("models", [])]
                    ollama_online = True
        except Exception:
            ollama_online = False

        # Check configured user preference from SQLite
        from backend.app.services.config_manager import config_manager
        preferred_provider = (await config_manager.get_setting("llm_provider")) or "auto"

        if preferred_provider == "gemini":
            if settings.GEMINI_API_KEY:
                return {"active_provider": "gemini", "model": "gemini-2.0-flash", "is_online": True, "available_local_models": available_local_models}
            return {"active_provider": "gemini", "model": "missing-key", "is_online": False, "missing_credentials": True, "available_local_models": available_local_models}

        if preferred_provider == "groq":
            if settings.GROQ_API_KEY:
                return {"active_provider": "groq", "model": "llama-3.1-8b-instant", "is_online": True, "available_local_models": available_local_models}
            return {"active_provider": "groq", "model": "missing-key", "is_online": False, "missing_credentials": True, "available_local_models": available_local_models}

        if preferred_provider == "openai":
            if settings.OPENAI_API_KEY:
                return {"active_provider": "openai", "model": "gpt-4o-mini", "is_online": True, "available_local_models": available_local_models}
            return {"active_provider": "openai", "model": "missing-key", "is_online": False, "missing_credentials": True, "available_local_models": available_local_models}

        if preferred_provider == "ollama":
            if ollama_online and len(available_local_models) > 0:
                active_model = self.default_model if self.default_model in available_local_models else available_local_models[0]
                return {"active_provider": "ollama", "model": active_model, "is_online": True, "available_local_models": available_local_models}
            return {"active_provider": "ollama", "model": "offline", "is_online": False, "missing_credentials": True, "available_local_models": available_local_models}

        # Auto-Adaptive: priority order is Ollama (local private) -> Gemini -> Groq -> OpenAI
        if ollama_online and len(available_local_models) > 0:
            active_model = self.default_model if self.default_model in available_local_models else available_local_models[0]
            return {
                "active_provider": "ollama",
                "model": active_model,
                "is_online": True,
                "available_local_models": available_local_models
            }

        if settings.GEMINI_API_KEY:
            return {
                "active_provider": "gemini",
                "model": "gemini-2.0-flash",
                "is_online": True,
                "available_local_models": available_local_models
            }

        if settings.GROQ_API_KEY:
            return {
                "active_provider": "groq",
                "model": "llama-3.1-8b-instant",
                "is_online": True,
                "available_local_models": available_local_models
            }

        if settings.OPENAI_API_KEY:
            return {
                "active_provider": "openai",
                "model": "gpt-4o-mini",
                "is_online": True,
                "available_local_models": available_local_models
            }

        # No LLM provider or API key is active
        return {
            "active_provider": "unconfigured",
            "model": "offline",
            "is_online": False,
            "missing_credentials": True,
            "available_local_models": available_local_models
        }

    def _sanitize_gemini_contents(self, messages: list[dict[str, str]]) -> list[dict[str, Any]]:
        """
        Sanitizes conversation turns for Google Gemini v1beta API:
        1. Ensures roles strictly alternate between 'user' and 'model'.
        2. Merges adjacent turns with the same role into a single message.
        3. Ensures the conversation begins with a 'user' turn.
        4. Strips empty text turns to prevent 400 Bad Request errors.
        """
        contents: list[dict[str, Any]] = []
        for m in messages:
            raw_text = (m.get("content") or "").strip()
            if not raw_text:
                continue
            role = "model" if m.get("role") in ("assistant", "model") else "user"
            if contents and contents[-1]["role"] == role:
                prev_text = contents[-1]["parts"][0]["text"]
                contents[-1]["parts"][0]["text"] = f"{prev_text}\n\n{raw_text}"
            else:
                contents.append({"role": role, "parts": [{"text": raw_text}]})

        # Ensure first turn is from user
        while contents and contents[0]["role"] != "user":
            contents.pop(0)

        # Fallback if empty
        if not contents and messages:
            last = messages[-1].get("content", "").strip() or "Hello"
            contents = [{"role": "user", "parts": [{"text": last}]}]

        return contents

    async def _stream_text(self, text: str, meta: dict[str, Any]) -> AsyncGenerator[tuple[str, bool, dict[str, Any]], None]:
        """Streams text word by word with fluid typing cadence."""
        words = text.split(" ")
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            is_last = (i == len(words) - 1)
            yield chunk, is_last, meta
            if i % 3 == 0:
                await asyncio.sleep(0.012)

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        mode: str = "general",
        conversation_id: Optional[str] = None
    ) -> AsyncGenerator[tuple[str, bool, dict[str, Any]], None]:
        """
        Agentic execution router with native LLM function calling.
        User prompts pass directly to the active LLM alongside tool schemas.
        """
        if isinstance(messages, str):
            messages = [{"role": "user", "content": messages}]

        status = await self.get_router_status()
        provider = status["active_provider"]
        model = status["model"]
        is_online = status["is_online"]

        # Missing key handling: clean conversational error without echoing prompt or paths
        if status.get("missing_credentials") or provider == "unconfigured" or not is_online:
            fallback_text = "GEMINI_API_KEY not found in .env."
            yield fallback_text, True, {
                "provider": "gemini",
                "model": "gemini-2.0-flash",
                "is_online": False,
                "missing_credentials": True
            }
            return

        base_instruction = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["general"])
        ws_snippet = workspace_context.get_system_prompt_snippet(conversation_id)
        system_instruction = f"{base_instruction}\n\n{ws_snippet}"
        full_messages = [{"role": "system", "content": system_instruction}] + messages

        meta = {
            "provider": provider,
            "model": model,
            "is_online": is_online
        }

        # Execution chain prioritizing the active configured provider
        active_chain: list[str] = []
        if provider and provider != "unconfigured":
            active_chain.append(provider)
        for p in ["gemini", "groq", "ollama", "openai"]:
            if p not in active_chain:
                active_chain.append(p)

        for current_provider in active_chain:
            # 1. Google Gemini Native Agentic Tool Calling
            if current_provider == "gemini" and settings.GEMINI_API_KEY:
                try:
                    gemini_contents = self._sanitize_gemini_contents(messages)
                    if not gemini_contents:
                        continue

                    gemini_payload = {
                        "systemInstruction": {
                            "parts": [{"text": system_instruction}]
                        },
                        "contents": gemini_contents,
                        "tools": agent_tools.get_gemini_tools(),
                        "generationConfig": {
                            "temperature": 0.7,
                            "maxOutputTokens": 4096
                        }
                    }

                    gemini_models = ["gemini-2.0-flash", "gemini-3.5-flash", "gemini-flash-lite-latest"]
                    api_key = os.getenv("GEMINI_API_KEY") or settings.GEMINI_API_KEY
                    for gem_model in gemini_models:
                        gem_meta = {"provider": "gemini", "model": gem_model, "is_online": True}
                        direct_url = f"https://generativelanguage.googleapis.com/v1beta/models/{gem_model}:generateContent?key={api_key}"
                        try:
                            async with httpx.AsyncClient(timeout=35.0) as client:
                                res = await client.post(direct_url, json=gemini_payload)
                                if res.status_code == 200:
                                    data = res.json()
                                    candidates = data.get("candidates", [])
                                    if not candidates:
                                        continue
                                    parts = candidates[0].get("content", {}).get("parts", [])

                                    # Check if Gemini decided to invoke a native tool
                                    func_call_part = next((p for p in parts if "functionCall" in p), None)
                                    if func_call_part:
                                        fn_info = func_call_part["functionCall"]
                                        fn_name = fn_info.get("name")
                                        fn_args = fn_info.get("args", {})

                                        yield f"*[Executing {fn_name}...]*\n\n", False, gem_meta

                                        # Execute the OS tool asynchronously
                                        tool_result = await agent_tools.execute_tool(fn_name, fn_args, conv_id=conversation_id)

                                        # Feed function execution result back into Gemini loop
                                        followup_contents = list(gemini_contents)
                                        followup_contents.append({"role": "model", "parts": [func_call_part]})
                                        followup_contents.append({
                                            "role": "user",
                                            "parts": [{
                                                "functionResponse": {
                                                    "name": fn_name,
                                                    "response": {"output": tool_result}
                                                }
                                            }]
                                        })

                                        followup_payload = {
                                            "systemInstruction": {"parts": [{"text": system_instruction}]},
                                            "contents": followup_contents,
                                            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 4096}
                                        }

                                        f_res = await client.post(direct_url, json=followup_payload)
                                        if f_res.status_code == 200:
                                            f_data = f_res.json()
                                            f_cands = f_data.get("candidates", [])
                                            if f_cands:
                                                f_parts = f_cands[0].get("content", {}).get("parts", [])
                                                f_text = f_parts[0].get("text", "") if f_parts else ""
                                                if f_text:
                                                    async for c, done, m in self._stream_text(f_text, gem_meta):
                                                        yield c, done, m
                                                    return
                                        else:
                                            fallback_msg = f"Done! `{fn_name}` completed: {tool_result.get('message', 'Success')}"
                                            async for c, done, m in self._stream_text(fallback_msg, gem_meta):
                                                yield c, done, m
                                            return
                                    else:
                                        # Pure conversational response
                                        text_part = next((p.get("text", "") for p in parts if "text" in p), "")
                                        if text_part:
                                            async for c, done, m in self._stream_text(text_part, gem_meta):
                                                yield c, done, m
                                            return
                                elif res.status_code == 404:
                                    continue
                                elif res.status_code == 429:
                                    if settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY"):
                                        break
                                    yield "Google API Rate Limit Exceeded (429).", True, gem_meta
                                    return
                                elif res.status_code == 400:
                                    yield f"Google API Error: {res.text}", True, gem_meta
                                    return
                        except Exception as gem_err:
                            err_str = str(gem_err)
                            if "429" in err_str:
                                yield "Google API Rate Limit Exceeded (429).", True, gem_meta
                            else:
                                yield f"Google API Error: {err_str}", True, gem_meta
                            return
                except Exception as e:
                    print(f"[LLMRouter] Gemini route exception: {e}")

            # 2. Groq Cloud API with Native Tool Calling
            elif current_provider == "groq" and (settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY")):
                groq_key = os.getenv("GROQ_API_KEY") or settings.GROQ_API_KEY
                try:
                    groq_meta = {"provider": "groq", "model": "qwen/qwen3.8-27b", "is_online": True}
                    headers = {
                        "Authorization": f"Bearer {groq_key}",
                        "Content-Type": "application/json"
                    }
                    groq_payload = {
                        "model": "qwen/qwen3.8-27b",
                        "messages": full_messages,
                        "tools": agent_tools.get_openai_tools(),
                        "tool_choice": "auto"
                    }
                    async with httpx.AsyncClient(timeout=35.0) as client:
                        res = await client.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=groq_payload)
                        if res.status_code == 200:
                            data = res.json()
                            msg = data["choices"][0]["message"]
                            tool_calls = msg.get("tool_calls")
                            if tool_calls:
                                full_messages.append(msg)
                                for tc in tool_calls:
                                    fn_name = tc["function"]["name"]
                                    try:
                                        fn_args = json.loads(tc["function"].get("arguments", "{}"))
                                    except Exception:
                                        fn_args = {}

                                    yield f"*[Executing {fn_name}...]*\n\n", False, groq_meta
                                    tool_res = await agent_tools.execute_tool(fn_name, fn_args, conv_id=conversation_id)
                                    full_messages.append({
                                        "role": "tool",
                                        "tool_call_id": tc["id"],
                                        "name": fn_name,
                                        "content": json.dumps(tool_res)
                                    })

                                followup_payload = {
                                    "model": "qwen/qwen3.8-27b",
                                    "messages": full_messages
                                }
                                followup_res = await client.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=followup_payload)
                                if followup_res.status_code == 200:
                                    final_text = followup_res.json()["choices"][0]["message"].get("content", "")
                                    if final_text:
                                        async for c, done, m in self._stream_text(final_text, groq_meta):
                                            yield c, done, m
                                        return
                                fallback_msg = f"Done! `{fn_name}` completed: {tool_res.get('message', 'Success')}"
                                async for c, done, m in self._stream_text(fallback_msg, groq_meta):
                                    yield c, done, m
                                return
                            else:
                                content = msg.get("content", "")
                                if content:
                                    async for c, done, m in self._stream_text(content, groq_meta):
                                        yield c, done, m
                                    return
                        elif res.status_code == 401:
                            yield "Your Groq API key is invalid. Please check your key in Settings.", True, groq_meta
                            return
                        elif res.status_code == 429:
                            yield "Groq rate limit exceeded (429). Please wait a moment or try again.", True, groq_meta
                            return
                except Exception as e:
                    print(f"[LLMRouter] Groq route exception: {e}")

            # 3. Local Ollama with Native Tool Calling
            elif current_provider == "ollama":
                try:
                    ollama_meta = {"provider": "ollama", "model": model, "is_online": True}
                    ollama_payload = {
                        "model": model,
                        "messages": full_messages,
                        "tools": agent_tools.get_openai_tools(),
                        "stream": False
                    }
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        res = await client.post(f"{self.ollama_base_url}/api/chat", json=ollama_payload)
                        if res.status_code == 200:
                            data = res.json()
                            msg = data.get("message", {})
                            tool_calls = msg.get("tool_calls")
                            if tool_calls:
                                full_messages.append(msg)
                                for tc in tool_calls:
                                    fn = tc.get("function", {})
                                    fn_name = fn.get("name")
                                    fn_args = fn.get("arguments", {})
                                    if isinstance(fn_args, str):
                                        try:
                                            fn_args = json.loads(fn_args)
                                        except Exception:
                                            fn_args = {}

                                    yield f"*[Executing {fn_name}...]*\n\n", False, ollama_meta
                                    tool_res = await agent_tools.execute_tool(fn_name, fn_args, conv_id=conversation_id)
                                    full_messages.append({
                                        "role": "tool",
                                        "content": json.dumps(tool_res)
                                    })

                                followup_payload = {
                                    "model": model,
                                    "messages": full_messages,
                                    "stream": False
                                }
                                followup = await client.post(f"{self.ollama_base_url}/api/chat", json=followup_payload)
                                if followup.status_code == 200:
                                    final_txt = followup.json().get("message", {}).get("content", "")
                                    async for c, done, m in self._stream_text(final_txt, ollama_meta):
                                        yield c, done, m
                                    return
                            else:
                                content = msg.get("content", "")
                                if content:
                                    async for c, done, m in self._stream_text(content, ollama_meta):
                                        yield c, done, m
                                    return
                except Exception as e:
                    print(f"[LLMRouter] Ollama route exception: {e}")

            # 4. OpenAI API with Native Tool Calling
            elif current_provider == "openai" and settings.OPENAI_API_KEY:
                try:
                    openai_meta = {"provider": "openai", "model": "gpt-4o-mini", "is_online": True}
                    headers = {
                        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                        "Content-Type": "application/json"
                    }
                    openai_payload = {
                        "model": "gpt-4o-mini",
                        "messages": full_messages,
                        "tools": agent_tools.get_openai_tools(),
                        "tool_choice": "auto"
                    }
                    async with httpx.AsyncClient(timeout=35.0) as client:
                        res = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=openai_payload)
                        if res.status_code == 200:
                            data = res.json()
                            msg = data["choices"][0]["message"]
                            tool_calls = msg.get("tool_calls")
                            if tool_calls:
                                full_messages.append(msg)
                                for tc in tool_calls:
                                    fn_name = tc["function"]["name"]
                                    try:
                                        fn_args = json.loads(tc["function"].get("arguments", "{}"))
                                    except Exception:
                                        fn_args = {}
                                    yield f"*[Executing {fn_name}...]*\n\n", False, openai_meta
                                    tool_res = await agent_tools.execute_tool(fn_name, fn_args, conv_id=conversation_id)
                                    full_messages.append({
                                        "role": "tool",
                                        "tool_call_id": tc["id"],
                                        "name": fn_name,
                                        "content": json.dumps(tool_res)
                                    })
                                followup_payload = {
                                    "model": "gpt-4o-mini",
                                    "messages": full_messages
                                }
                                followup_res = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=followup_payload)
                                if followup_res.status_code == 200:
                                    final_text = followup_res.json()["choices"][0]["message"].get("content", "")
                                    async for c, done, m in self._stream_text(final_text, openai_meta):
                                        yield c, done, m
                                    return
                            else:
                                content = msg.get("content", "")
                                if content:
                                    async for c, done, m in self._stream_text(content, openai_meta):
                                        yield c, done, m
                                    return
                except Exception as e:
                    print(f"[LLMRouter] OpenAI route exception: {e}")

        # Final Handler: explain real provider failure without misleading key error
        if settings.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY"):
            yield "All configured LLM providers returned rate limit or error. Please check your API quota.", True, {"provider": "gemini", "model": "gemini-2.0-flash", "is_online": True}
        else:
            yield "GEMINI_API_KEY not found in .env.", True, {"provider": "gemini", "model": "gemini-2.0-flash", "is_online": False}



llm_router = LLMRouter()
