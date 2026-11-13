import uuid
import json
import os
import subprocess
import pyautogui
import chromadb
from PIL import ImageGrab
from dotenv import load_dotenv
from google import genai
from google.genai import types
from datetime import datetime, timezone
from typing import Optional, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from backend.app.db.database import get_db
from backend.app.db.audit import log_audit_event
from backend.app.services.llm_router import llm_router
from backend.app.services.config_manager import config_manager
from backend.app.core.config import settings

load_dotenv()

# Persistent ChromaDB Vector Memory for RAG
chroma_client = chromadb.PersistentClient(path="./duckuu_memory")
chat_memory = chroma_client.get_or_create_collection(name="chat_history")


# ---------------------------------------------------------------------------
# The Artifact Engine: Autonomous File Creator Tool for Gemini 2.0 Flash
# ---------------------------------------------------------------------------
def create_local_file(filename: str, content: str, subfolder: str = "Duckuu_Workspace") -> str:
    """Ensure directory exists, write content to filename, and return absolute path."""
    target_dir = os.path.abspath(subfolder)
    file_path = os.path.abspath(os.path.join(target_dir, filename))
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    return file_path


create_local_file_func = types.FunctionDeclaration(
    name="create_local_file",
    description="Autonomously create and save code files, scripts, or documents directly to local disk in the Duckuu workspace.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "filename": types.Schema(
                type=types.Type.STRING,
                description="The name of the file to create (e.g. 'main.py', 'index.html', 'notes.md')."
            ),
            "content": types.Schema(
                type=types.Type.STRING,
                description="The full text or source code content to write into the file."
            ),
            "subfolder": types.Schema(
                type=types.Type.STRING,
                description="Optional directory or subfolder where the file will be saved. Defaults to 'Duckuu_Workspace'."
            ),
        },
        required=["filename", "content"]
    )
)

create_local_file_tool = types.Tool(function_declarations=[create_local_file_func])


# ---------------------------------------------------------------------------
# The Terminal Engine: Subprocess CLI Execution Tool for Gemini 2.0 Flash
# ---------------------------------------------------------------------------
def execute_terminal_command(command: str, working_dir: str = ".") -> dict[str, Any]:
    """Execute shell/CLI command and capture stdout, stderr, and exit return code."""
    try:
        proc = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            cwd=working_dir
        )
        return {
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "returncode": proc.returncode
        }
    except Exception as e:
        return {
            "stdout": "",
            "stderr": str(e),
            "returncode": -1
        }


execute_terminal_command_func = types.FunctionDeclaration(
    name="execute_terminal_command",
    description="Execute terminal or shell commands (e.g. 'npm install', 'python main.py', 'code .', 'dir', 'git status') on the local system.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "command": types.Schema(
                type=types.Type.STRING,
                description="The exact command string to execute in the terminal (e.g. 'npm install', 'python script.py', 'code .')."
            ),
            "working_dir": types.Schema(
                type=types.Type.STRING,
                description="Optional working directory to run the command in. Defaults to '.' (current directory)."
            ),
        },
        required=["command"]
    )
)

duckuu_tools = [
    types.Tool(function_declarations=[create_local_file_func, execute_terminal_command_func])
]


router = APIRouter(tags=["Chat & Conversations"])


class CreateConversationRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    mode: str = Field(default="general")


class ChatMessageRequest(BaseModel):
    conversation_id: str
    message: str = Field(..., min_length=1)
    mode: Optional[str] = "general"
    inspect_screen: bool = False


@router.get("/conversations")
async def list_conversations():
    conn = await get_db()
    try:
        cursor = await conn.execute(
            """
            SELECT id, title, mode, created_at, updated_at
            FROM conversations
            ORDER BY updated_at DESC
            """
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await conn.close()


@router.post("/conversations", status_code=201)
async def create_conversation(req: CreateConversationRequest):
    conn = await get_db()
    try:
        conv_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        await conn.execute(
            """
            INSERT INTO conversations (id, title, mode, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (conv_id, req.title, req.mode, now, now)
        )
        await conn.commit()

        await log_audit_event(
            category="CHAT",
            action="CREATE_CONVERSATION",
            status="SUCCESS",
            details={"conversation_id": conv_id, "title": req.title, "mode": req.mode}
        )
        await config_manager.set_setting("last_active_conversation_id", conv_id)

        return {
            "id": conv_id,
            "title": req.title,
            "mode": req.mode,
            "created_at": now,
            "updated_at": now
        }
    finally:
        await conn.close()


@router.get("/conversations/recent")
@router.get("/api/conversations/recent")
@router.get("/api/v1/conversations/recent")
async def get_recent_conversation():
    """
    Hydrates startup session with the most recent persistent session data from SQLite,
    matching ChatGPT's instant conversational continuity.
    """
    conn = await get_db()
    try:
        # 1. Check if last_active_conversation_id exists
        last_id = await config_manager.get_setting("last_active_conversation_id")
        conv = None
        if last_id:
            cursor = await conn.execute(
                "SELECT id, title, mode, created_at, updated_at FROM conversations WHERE id = ?",
                (last_id,)
            )
            conv = await cursor.fetchone()

        # 2. Fallback to conversation with most recent updated_at
        if not conv:
            cursor = await conn.execute(
                "SELECT id, title, mode, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 1"
            )
            conv = await cursor.fetchone()

        if not conv:
            return {"conversation": None, "messages": []}

        conv_dict = dict(conv)
        msg_cursor = await conn.execute(
            """
            SELECT id, conversation_id, role, content, metadata, created_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
            """,
            (conv_dict["id"],)
        )
        messages = [dict(r) for r in await msg_cursor.fetchall()]

        # Parse JSON metadata if string
        for m in messages:
            if m.get("metadata") and isinstance(m["metadata"], str):
                try:
                    import json
                    m["metadata"] = json.loads(m["metadata"])
                except Exception:
                    pass

        return {
            "conversation": conv_dict,
            "messages": messages
        }
    finally:
        await conn.close()


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    conn = await get_db()
    try:
        conv_cursor = await conn.execute(
            "SELECT id, title, mode, created_at, updated_at FROM conversations WHERE id = ?",
            (conversation_id,)
        )
        conv = await conv_cursor.fetchone()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")

        msg_cursor = await conn.execute(
            """
            SELECT id, conversation_id, role, content, metadata, created_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
            """,
            (conversation_id,)
        )
        messages = [dict(r) for r in await msg_cursor.fetchall()]

        data = dict(conv)
        data["messages"] = messages
        await config_manager.set_setting("last_active_conversation_id", conversation_id)
        return data
    finally:
        await conn.close()


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    conn = await get_db()
    try:
        cursor = await conn.execute(
            "DELETE FROM conversations WHERE id = ?",
            (conversation_id,)
        )
        await conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Conversation not found")

        await log_audit_event(
            category="CHAT",
            action="DELETE_CONVERSATION",
            status="SUCCESS",
            details={"conversation_id": conversation_id}
        )

        return {"success": True, "message": "Conversation deleted"}
    finally:
        await conn.close()


@router.post("/chat")
async def send_chat_message(req: ChatMessageRequest):
    conn = await get_db()
    try:
        conv_cursor = await conn.execute(
            "SELECT id, mode FROM conversations WHERE id = ?",
            (req.conversation_id,)
        )
        conv = await conv_cursor.fetchone()
        now = datetime.now(timezone.utc).isoformat()
        if not conv:
            # Auto-create conversation on the fly so chat never fails with 404
            short_title = req.message[:30] + ("..." if len(req.message) > 30 else "")
            await conn.execute(
                "INSERT INTO conversations (id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (req.conversation_id, short_title, req.mode or "general", now, now)
            )
            await conn.commit()
            active_mode = req.mode or "general"
        else:
            active_mode = req.mode or conv["mode"]
        user_msg_id = str(uuid.uuid4())

        # Store user message
        await conn.execute(
            """
            INSERT INTO messages (id, conversation_id, role, content, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_msg_id, req.conversation_id, "user", req.message, None, now)
        )
        await conn.commit()

        # 1. Retrieve Top 2 Relevant Historical Interactions via ChromaDB (RAG)
        context_str = ""
        try:
            query_res = chat_memory.query(query_texts=[req.message], n_results=2)
            docs = query_res.get("documents", [[]])[0]
            metas = query_res.get("metadatas", [[]])[0]
            if docs and metas:
                recalled = [
                    f"User: {d}\nDuckuu: {m.get('response', '')}"
                    for d, m in zip(docs, metas) if d and m
                ]
                if recalled:
                    context_str = "[Relevant Past Memory]:\n" + "\n---\n".join(recalled) + "\n\n"
        except Exception as chroma_err:
            print(f"[ChromaDB] Retrieval notice: {chroma_err}")

        # 2. Inject Context: Prepend retrieved RAG context directly to user prompt
        enriched_user_prompt = f"{context_str}{req.message}" if context_str else req.message
        history = [{"role": "user", "content": enriched_user_prompt}]

        # 3. Generate response using Gemini 2.0 Flash (Multimodal Vision + Artifact Engine)
        load_dotenv(override=True)
        api_key = os.getenv("GEMINI_API_KEY") or settings.GEMINI_API_KEY
        full_content_parts = []
        last_meta = {"provider": "gemini", "model": "gemini-2.0-flash", "is_online": bool(api_key)}

        # Multimodal Screen Awareness
        contents_list = []
        if req.inspect_screen:
            try:
                screenshot = ImageGrab.grab()
                contents_list.append(screenshot)
            except Exception as grab_err:
                print(f"[Vision] Screen grab notice: {grab_err}")

        contents_list.append(enriched_user_prompt)

        if api_key:
            client = genai.Client(api_key=api_key)
            for gem_model in ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.5-flash", "gemini-flash-latest"]:
                try:
                    response = client.models.generate_content(
                        model=gem_model,
                        contents=contents_list,
                        config=types.GenerateContentConfig(
                            system_instruction="You are Duckuu, an elite AI developer companion. When asked to build web projects, write complete, production-ready code without truncation. Do not use placeholders like '// rest of code here'. If the project is large, execute multiple tool calls (e.g., generate index.html, then style.css, then script.js separately) rather than stuffing everything into one massive inline file.",
                            max_output_tokens=8192,
                            tools=duckuu_tools,
                            temperature=0.7
                        )
                    )

                    # Intercept and execute Gemini function calls
                    if response.function_calls:
                        for call in response.function_calls:
                            args = call.args or {}
                            if call.name == "create_local_file":
                                tool_result = create_local_file(
                                    filename=args.get("filename", "output.txt"),
                                    content=args.get("content", ""),
                                    subfolder=args.get("subfolder", "Duckuu_Workspace")
                                )
                                result_payload = {"result": f"File successfully created: {tool_result}"}
                            elif call.name == "execute_terminal_command":
                                tool_result = execute_terminal_command(
                                    command=args.get("command", ""),
                                    working_dir=args.get("working_dir", ".")
                                )
                                result_payload = tool_result
                            else:
                                continue

                            followup = client.models.generate_content(
                                model=gem_model,
                                contents=[
                                    types.Content(role="model", parts=[types.Part.from_function_call(name=call.name, args=args)]),
                                    types.Content(role="user", parts=[types.Part.from_function_response(name=call.name, response=result_payload)])
                                ],
                                config=types.GenerateContentConfig(max_output_tokens=8192)
                            )
                            full_content_parts.append(followup.text or f"Executed {call.name}")
                    elif response.text:
                        full_content_parts.append(response.text)
                    break
                except Exception as e:
                    err_msg = str(e)
                    if "404" in err_msg and gem_model != "gemini-flash-latest":
                        continue
                    if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg:
                        full_content_parts.append("Google API Rate Limit Exceeded")
                    else:
                        full_content_parts.append(f"Google API Error: {err_msg}")
                    break
        else:
            full_content_parts.append("GEMINI_API_KEY not found in .env file.")
            last_meta = {"provider": "gemini", "model": "gemini-2.0-flash", "is_online": False}

        full_reply = "".join(full_content_parts)

        # 4. Store New Memory in ChromaDB
        if full_reply and not full_reply.startswith("Google API Rate Limit"):
            try:
                chat_memory.add(
                    documents=[req.message],
                    metadatas=[{"response": full_reply}],
                    ids=[str(uuid.uuid4())]
                )
            except Exception as chroma_add_err:
                print(f"[ChromaDB] Storage error: {chroma_add_err}")
        assistant_msg_id = str(uuid.uuid4())
        assistant_now = datetime.now(timezone.utc).isoformat()

        # Store assistant message
        await conn.execute(
            """
            INSERT INTO messages (id, conversation_id, role, content, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (assistant_msg_id, req.conversation_id, "assistant", full_reply, json.dumps(last_meta), assistant_now)
        )

        # Update conversation updated_at
        await conn.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (assistant_now, req.conversation_id)
        )
        await conn.commit()
        await config_manager.set_setting("last_active_conversation_id", req.conversation_id)

        await log_audit_event(
            category="CHAT",
            action="CHAT_COMPLETION",
            status="SUCCESS",
            details={
                "conversation_id": req.conversation_id,
                "provider": last_meta.get("provider"),
                "is_online": last_meta.get("is_online")
            }
        )

        return {
            "conversation_id": req.conversation_id,
            "message_id": assistant_msg_id,
            "role": "assistant",
            "content": full_reply,
            "provider": last_meta.get("provider"),
            "is_online": last_meta.get("is_online", False)
        }
    finally:
        await conn.close()
