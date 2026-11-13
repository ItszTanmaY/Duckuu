"""
Duckuu Agent Tools Registry & Native Function Calling Engine.
Provides standardized JSON schemas and asynchronous dispatch for all OS tools.
Compatible with OpenAI, Google Gemini, Groq, and Ollama function calling formats.
"""

import os
import json
from pathlib import Path
from typing import Any, Optional, Dict, List
from backend.app.services.pc_agent import pc_agent
from backend.app.services.workspace_context import workspace_context
from backend.app.services.focus_timer import focus_timer


# ---------------------------------------------------------------------------
# Tool Specifications (JSON Schema)
# ---------------------------------------------------------------------------

OPENAI_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "open_app",
            "description": "Launch or open a desktop application on Windows (e.g. 'spotify', 'chrome', 'vscode', 'notepad', 'calculator', 'discord').",
            "parameters": {
                "type": "object",
                "properties": {
                    "app_name": {
                        "type": "string",
                        "description": "The name or executable of the application to launch (e.g. 'spotify', 'notepad', 'chrome', 'calculator')."
                    }
                },
                "required": ["app_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "launch_vscode",
            "description": "Open Visual Studio Code targeting the active workspace folder or a specified directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "folder_path": {
                        "type": "string",
                        "description": "Optional folder path to open in VS Code. If omitted, opens the current active workspace."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "set_workspace",
            "description": "Switch the active workspace folder or project directory. All subsequent file creations and terminal commands target this path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "folder_path": {
                        "type": "string",
                        "description": "The folder path or project name to switch into."
                    }
                },
                "required": ["folder_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_workspace",
            "description": "Get details about the active workspace, including the current directory, project name, and available projects.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_local_file",
            "description": "Autonomously create and save code files, scripts, or documents directly to local disk.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "The name of the file to create (e.g. 'main.py', 'index.html', 'notes.md')."
                    },
                    "content": {
                        "type": "string",
                        "description": "The full text or source code content to write into the file."
                    },
                    "path": {
                        "type": "string",
                        "description": "Optional directory path to store the file. Defaults to './Duckuu_Artifacts'."
                    }
                },
                "required": ["filename", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_file",
            "description": "Create a new file in the active workspace with optional initial code or text content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Relative filename (e.g. 'test.py', 'src/app.ts') or absolute path to create."
                    },
                    "content": {
                        "type": "string",
                        "description": "Initial text or source code content for the new file."
                    }
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the text contents of a file in the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to read."
                    }
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_terminal_command",
            "description": "Execute a shell or PowerShell command inside the active workspace after Zero-Trust user approval.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to run (e.g. 'npm test', 'pytest', 'git status', 'dir')."
                    }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_auto_commit",
            "description": "Stage all modified files and make a git commit in the active workspace repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "The git commit message describing the changes."
                    }
                },
                "required": ["message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "capture_screen",
            "description": "Take a screenshot of the user's desktop or analyze onscreen content with multimodal vision.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Question or analysis prompt about what is visible on the screen."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "control_media",
            "description": "Control system media playback (play/pause, next track, previous track, stop).",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["play_pause", "next", "prev", "stop"],
                        "description": "The media control action to perform."
                    }
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "control_volume",
            "description": "Adjust or check Windows master system volume.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["set", "mute", "unmute", "get"],
                        "description": "Volume action to perform."
                    },
                    "level": {
                        "type": "integer",
                        "description": "Volume level from 0 to 100 (only required when action is 'set')."
                    }
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "start_focus_timer",
            "description": "Start a Pomodoro focus timer session on Duckuu desktop pet.",
            "parameters": {
                "type": "object",
                "properties": {
                    "minutes": {
                        "type": "integer",
                        "description": "Duration in minutes (e.g. 25, 45, 60)."
                    },
                    "task": {
                        "type": "string",
                        "description": "Optional label or description of the study/work task."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "type_into_active_window",
            "description": "Ghost typing tool (Infina.so integration): physically type text or source code into the user's currently focused window (Word, VS Code, Chrome, Terminal, etc.) via simulated keystrokes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The exact text or code string to physically type into the active window."
                    },
                    "press_enter": {
                        "type": "boolean",
                        "description": "Whether to press the Enter key after typing the text (default: false)."
                    }
                },
                "required": ["text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_pdf",
            "description": "Extract and read text from a PDF document in the workspace or at a specified path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Relative filename or absolute path to the PDF document to read."
                    },
                    "max_pages": {
                        "type": "integer",
                        "description": "Maximum number of pages to read (default: 15)."
                    }
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_pdf",
            "description": "Create and compile a beautifully styled PDF document with a title and content in the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "The title of the PDF document."
                    },
                    "content": {
                        "type": "string",
                        "description": "The text content or summary to compile into the PDF."
                    },
                    "output_path": {
                        "type": "string",
                        "description": "Optional specific output filename or path."
                    }
                },
                "required": ["title", "content"]
            }
        }
    }
]


# Gemini format: {"function_declarations": [...]}
GEMINI_FUNCTION_DECLARATIONS = [
    {
        "name": t["function"]["name"],
        "description": t["function"]["description"],
        "parameters": {
            "type": "OBJECT",
            "properties": {
                k: {
                    "type": v.get("type", "STRING").upper(),
                    "description": v.get("description", "")
                }
                for k, v in t["function"]["parameters"].get("properties", {}).items()
            },
            "required": t["function"]["parameters"].get("required", [])
        }
    }
    for t in OPENAI_TOOL_DEFINITIONS
]


class AgentToolsRegistry:
    """Dispatches tool calls to the appropriate underlying OS services."""

    def get_openai_tools(self) -> List[Dict[str, Any]]:
        return OPENAI_TOOL_DEFINITIONS

    def get_gemini_tools(self) -> List[Dict[str, Any]]:
        return [{"function_declarations": GEMINI_FUNCTION_DECLARATIONS}]

    async def execute_tool(self, name: str, args: Dict[str, Any], conv_id: Optional[str] = None) -> Dict[str, Any]:
        """Executes a tool by name with arguments, returning a structured execution result dict."""
        print(f"[AgentTools] Executing tool '{name}' with args {args}")
        try:
            if name == "open_app":
                app_name = str(args.get("app_name", "")).strip().lower()
                if "spotify" in app_name:
                    return await pc_agent.launch_spotify()
                return await pc_agent.open_app(app_name=args.get("app_name", ""))

            elif name == "launch_vscode":
                folder_path = args.get("folder_path")
                if not folder_path:
                    ctx = workspace_context.get_context(conv_id)
                    folder_path = ctx.get("active_folder") or workspace_context.active_folder
                return await pc_agent.launch_vscode(folder_path=folder_path, conv_id=conv_id)

            elif name == "set_workspace":
                folder = args.get("folder_path", "")
                res = await workspace_context.set_workspace(folder_path=folder, conv_id=conv_id, create_if_missing=True)
                return res

            elif name == "get_workspace":
                ctx = workspace_context.get_context(conv_id)
                projects = workspace_context.get_available_projects()
                return {
                    "active_folder": ctx.get("active_folder", workspace_context.active_folder),
                    "active_app": ctx.get("active_app", "VS Code"),
                    "available_projects": [p["name"] for p in projects[:10]]
                }

            elif name == "create_local_file":
                filename = args.get("filename", "artifact.txt")
                content = args.get("content", "")
                subfolder = args.get("subfolder") or args.get("path") or "Duckuu_Workspace"
                from backend.app.routers.chat import create_local_file
                created_path = create_local_file(filename=filename, content=content, subfolder=subfolder)
                return {"success": True, "message": f"File created: {created_path}", "path": created_path}

            elif name == "create_file":
                file_path = args.get("file_path", "")
                content = args.get("content", "")
                # If relative path, join with active workspace
                if not os.path.isabs(file_path):
                    ctx = workspace_context.get_context(conv_id)
                    active_folder = ctx.get("active_folder", workspace_context.active_folder)
                    full_path = str(Path(active_folder) / file_path)
                else:
                    full_path = file_path
                return await pc_agent.create_file(file_path=full_path, content=content, conv_id=conv_id)

            elif name == "read_file":
                file_path = args.get("file_path", "")
                if not os.path.isabs(file_path):
                    ctx = workspace_context.get_context(conv_id)
                    active_folder = ctx.get("active_folder", workspace_context.active_folder)
                    full_path = str(Path(active_folder) / file_path)
                else:
                    full_path = file_path

                p = Path(full_path)
                if not p.exists():
                    return {"success": False, "error": f"File '{file_path}' does not exist."}
                if not p.is_file():
                    return {"success": False, "error": f"'{file_path}' is a directory, not a file."}

                text = p.read_text(encoding="utf-8", errors="replace")
                truncated = len(text) > 8000
                return {
                    "success": True,
                    "file_path": str(p),
                    "size_bytes": p.stat().st_size,
                    "content": text[:8000],
                    "truncated": truncated
                }

            elif name == "run_terminal_command":
                cmd = args.get("command", "")
                return await pc_agent.run_terminal_command(command=cmd, conv_id=conv_id)

            elif name == "git_auto_commit":
                msg = args.get("message", "chore: automated update via Duckuu agent")
                return await pc_agent.git_auto_commit(message=msg, conv_id=conv_id)

            elif name == "capture_screen":
                query = args.get("query", "Analyze screen content")
                return await pc_agent.capture_screen_context(query=query, conv_id=conv_id)

            elif name == "control_media":
                action = args.get("action", "play_pause")
                return pc_agent.control_media(action=action)

            elif name == "control_volume":
                action = args.get("action", "get")
                level = args.get("level")
                return pc_agent.control_volume(action=action, level=level)

            elif name == "start_focus_timer":
                minutes = args.get("minutes", 25)
                task = args.get("task", "Focus Session")
                return await focus_timer.start_timer(minutes=minutes, label=task)

            elif name == "type_into_active_window":
                text = str(args.get("text", ""))
                press_enter = bool(args.get("press_enter", False))
                return await pc_agent.type_into_active_window(text=text, press_enter=press_enter)

            elif name == "read_pdf":
                file_path = args.get("file_path", "")
                max_pages = int(args.get("max_pages", 15))
                return await pc_agent.read_pdf(file_path=file_path, max_pages=max_pages, conv_id=conv_id)

            elif name == "create_pdf":
                title = args.get("title", "Duckuu Document")
                content = args.get("content", "")
                output_path = args.get("output_path")
                return await pc_agent.create_pdf(title=title, content=content, output_path=output_path, conv_id=conv_id)

            else:
                return {"success": False, "error": f"Unknown tool: '{name}'"}

        except Exception as e:
            print(f"[AgentTools] Exception executing tool '{name}': {e}")
            return {"success": False, "error": str(e)}


agent_tools = AgentToolsRegistry()
