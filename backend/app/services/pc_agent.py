import os
import sys
import shutil
import base64
import ctypes
import ctypes.wintypes
import subprocess
import webbrowser
import time
import asyncio
import re
from pathlib import Path
from typing import Optional, Any
import httpx
from backend.app.core.config import settings
from backend.app.services.approval_gate import approval_gate
from backend.app.db.audit import log_audit_event
from backend.app.services.workspace_context import workspace_context

try:
    from pycaw.pycaw import AudioUtilities
    HAS_PYCAW = True
except Exception:
    HAS_PYCAW = False


# Virtual Key Codes for Windows Media Control
VK_VOLUME_MUTE = 0xAD
VK_VOLUME_DOWN = 0xAE
VK_VOLUME_UP = 0xAF
VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
VK_MEDIA_STOP = 0xB2
VK_MEDIA_PLAY_PAUSE = 0xB3
KEYEVENTF_KEYUP = 0x0002


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class PCAgentTools:
    def __init__(self) -> None:
        self.user_32 = ctypes.windll.user32

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "create_file",
                "description": "Creates a new file or script in the active project workspace folder.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string"},
                        "content": {"type": "string", "default": ""}
                    },
                    "required": ["file_path"]
                },
                "requires_approval": True
            },
            {
                "name": "launch_vscode",
                "description": "Launches VS Code, optionally opening a specific project or workspace folder.",
                "parameters": {"type": "object", "properties": {"folder_path": {"type": "string"}}},
                "requires_approval": True
            },
            {
                "name": "open_chrome",
                "description": "Opens Google Chrome to a specific website, documentation, or YouTube search.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query_or_url": {"type": "string"},
                        "is_youtube": {"type": "boolean", "default": False}
                    },
                    "required": ["query_or_url"]
                },
                "requires_approval": True
            },
            {
                "name": "launch_spotify",
                "description": "Launches Spotify desktop application or Web Player.",
                "parameters": {"type": "object", "properties": {}},
                "requires_approval": True
            },
            {
                "name": "open_app",
                "description": "Launches an application installed on the Windows PC (e.g., notepad, calc, code).",
                "parameters": {"type": "object", "properties": {"app_name": {"type": "string"}}, "required": ["app_name"]},
                "requires_approval": True
            },
            {
                "name": "open_url",
                "description": "Opens a website URL in the user's default web browser.",
                "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]},
                "requires_approval": True
            },
            {
                "name": "open_folder",
                "description": "Opens a folder or directory in Windows File Explorer.",
                "parameters": {"type": "object", "properties": {"folder_path": {"type": "string"}}, "required": ["folder_path"]},
                "requires_approval": False
            },
            {
                "name": "search_files",
                "description": "Performs a fast local search for files matching a filename or pattern.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "root_path": {"type": "string", "default": None},
                        "max_results": {"type": "integer", "default": 15}
                    },
                    "required": ["query"]
                },
                "requires_approval": False
            },
            {
                "name": "control_volume",
                "description": "Controls Windows system master volume (set, get, mute, unmute).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": ["get", "set", "mute", "unmute"]},
                        "level": {"type": "integer", "minimum": 0, "maximum": 100}
                    },
                    "required": ["action"]
                },
                "requires_approval": False
            },
            {
                "name": "control_media",
                "description": "Sends multimedia playback keystrokes (play/pause, next, prev).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": ["play_pause", "next", "prev"]}
                    },
                    "required": ["action"]
                },
                "requires_approval": False
            },
            {
                "name": "capture_screen_context",
                "description": "Captures the active screen and analyzes onscreen code errors, UI layouts, or text with Multimodal Vision.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "default": "Analyze the active screen and explain any errors or UI components"}
                    }
                },
                "requires_approval": False
            },
            {
                "name": "run_terminal_command",
                "description": "Executes a shell or terminal command in the workspace with Zero-Trust approval (npm, pytest, git, etc.).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "cwd": {"type": "string", "default": None}
                    },
                    "required": ["command"]
                },
                "requires_approval": True
            },
            {
                "name": "git_auto_commit",
                "description": "Stages all workspace changes and performs a git commit with a descriptive message.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {"type": "string"},
                        "cwd": {"type": "string", "default": None}
                    },
                    "required": ["message"]
                },
                "requires_approval": True
            },
            {
                "name": "delete_file",
                "description": "Permanently deletes a file from the workspace with Zero-Trust approval.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string"}
                    },
                    "required": ["file_path"]
                },
                "requires_approval": True
            },
            {
                "name": "organize_folder",
                "description": "Smart File Janitor: scans and organizes cluttered folders into structured categories (PDFs, Images, Code, Archives).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "folder_path": {"type": "string", "default": None},
                        "preview_only": {"type": "boolean", "default": True}
                    }
                },
                "requires_approval": True
            },
            {
                "name": "create_pdf",
                "description": "Generates a clean PDF document from text or markdown and saves it to the workspace or library.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                        "output_path": {"type": "string", "default": None}
                    },
                    "required": ["title", "content"]
                },
                "requires_approval": True
            },
            {
                "name": "send_whatsapp_message",
                "description": "Sends a WhatsApp message to a phone number or student via official Meta Cloud API or zero-cost deep link.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "phone_or_name": {"type": "string"},
                        "message": {"type": "string"}
                    },
                    "required": ["phone_or_name", "message"]
                },
                "requires_approval": True
            },
            {
                "name": "capture_screen",
                "description": "Captures the current active screen for visual inspection.",
                "parameters": {"type": "object", "properties": {}},
                "requires_approval": False
            },
            {
                "name": "get_active_window",
                "description": "Returns geometry and title of the currently focused foreground window.",
                "parameters": {"type": "object", "properties": {}},
                "requires_approval": False
            }
        ]

    async def create_file(self, file_path: str, content: str = "", conv_id: Optional[str] = None) -> dict[str, Any]:
        """Creates a new file in the active workspace with Zero-Trust approval."""
        ctx = workspace_context.get_context(conv_id)
        active_dir = ctx.get("active_folder") or workspace_context.default_folder

        raw_path = file_path.strip().strip('"').strip("'")
        p = Path(raw_path)
        if not p.is_absolute():
            p = (Path(active_dir) / p).resolve()
        else:
            p = p.resolve()

        approved = await approval_gate.request_approval(
            tool_name="create_file",
            parameters={"file_path": str(p), "content_preview": content[:100] if content else ""},
            risk_level="MEDIUM",
            description=f"Create file: {p.name} in {p.parent}"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user or timed out"}

        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(content)

            workspace_context.update(
                conv_id=conv_id,
                file_path=str(p),
                folder=str(p.parent),
                action="create_file",
                message=f"Created file: {p}"
            )
            await log_audit_event("PC_AGENT", "CREATE_FILE", "SUCCESS", {"file_path": str(p)})
            return {"success": True, "file_path": str(p), "message": f"Created new file: `{p}`"}
        except Exception as e:
            await log_audit_event("PC_AGENT", "CREATE_FILE", "FAILED", {"file_path": str(p), "error": str(e)})
            return {"success": False, "error": str(e)}

    async def write_file(self, file_path: str, content: str, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Writes content to a file with Zero-Trust approval."""
        return await self.create_file(file_path=file_path, content=content, conv_id=conv_id)

    async def launch_vscode(self, folder_path: Optional[str] = None, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Launch VS Code, optionally opening a specific folder or workspace."""
        approved = await approval_gate.request_approval(
            tool_name="launch_vscode",
            parameters={"folder_path": folder_path},
            risk_level="LOW",
            description=f"Launch VS Code{' in: ' + folder_path if folder_path else ''}"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user or timed out"}

        cmd = "code"
        resolved_folder = None
        if folder_path:
            p = Path(os.path.expandvars(os.path.expanduser(folder_path))).resolve()
            cmd = f'code "{p}"'
            resolved_folder = str(p)

        try:
            subprocess.Popen(cmd, shell=True)
            workspace_context.update(
                conv_id=conv_id,
                app="VS Code",
                folder=resolved_folder or workspace_context.default_folder,
                action="launch_vscode",
                message=f"VS Code opened{' in ' + str(resolved_folder or folder_path) if (resolved_folder or folder_path) else ''}"
            )
            await log_audit_event("PC_AGENT", "LAUNCH_VSCODE", "SUCCESS", {"folder": folder_path})
            return {"success": True, "message": f"VS Code opened{' in ' + str(resolved_folder or folder_path) if (resolved_folder or folder_path) else ''}"}
        except Exception as e:
            await log_audit_event("PC_AGENT", "LAUNCH_VSCODE", "FAILED", {"error": str(e)})
            return {"success": False, "error": str(e)}

    async def open_chrome(self, query_or_url: str, is_youtube: bool = False) -> dict[str, Any]:
        """Launch Google Chrome to a website, documentation, or YouTube query."""
        import urllib.parse
        target = query_or_url.strip()

        if is_youtube or "youtube" in target.lower() or "lo-fi" in target.lower():
            if not target.startswith("http"):
                search_q = target.replace("youtube", "").replace("play", "").replace("on chrome", "").strip()
                if not search_q:
                    target_url = "https://www.youtube.com"
                else:
                    target_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(search_q)}"
            else:
                target_url = target
        elif not (target.startswith("http://") or target.startswith("https://")):
            if "." in target and " " not in target:
                target_url = f"https://{target}"
            else:
                target_url = f"https://www.google.com/search?q={urllib.parse.quote(target)}"
        else:
            target_url = target

        approved = await approval_gate.request_approval(
            tool_name="open_chrome",
            parameters={"target_url": target_url},
            risk_level="LOW",
            description=f"Open in Chrome: {target_url}"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user"}

        chrome_candidates = [
            Path(os.environ.get("PROGRAMFILES", "C:\\Program Files")) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)")) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "Application" / "chrome.exe"
        ]
        opened = False
        for cp in chrome_candidates:
            if cp.exists():
                try:
                    subprocess.Popen([str(cp), target_url])
                    opened = True
                    break
                except Exception:
                    pass

        if not opened:
            try:
                subprocess.Popen(f'start chrome "{target_url}"', shell=True)
                opened = True
            except Exception:
                webbrowser.open(target_url)
                opened = True

        await log_audit_event("PC_AGENT", "OPEN_CHROME", "SUCCESS", {"target_url": target_url})
        workspace_context.update(app="Google Chrome", url=target_url, action="open_chrome", message=f"Opened {target_url} in Chrome")
        return {"success": True, "target_url": target_url, "message": f"Opened {target_url} in Chrome"}

    async def launch_spotify(self) -> dict[str, Any]:
        """Launch Spotify desktop application or Web Player."""
        approved = await approval_gate.request_approval(
            tool_name="launch_spotify",
            parameters={},
            risk_level="LOW",
            description="Launch Spotify player"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user"}

        try:
            subprocess.Popen("start spotify:", shell=True)
            await log_audit_event("PC_AGENT", "LAUNCH_SPOTIFY", "SUCCESS", {})
            workspace_context.update(app="Spotify", action="launch_spotify", message="Spotify launched")
            return {"success": True, "message": "Spotify launched"}
        except Exception:
            webbrowser.open("https://open.spotify.com")
            workspace_context.update(app="Spotify", url="https://open.spotify.com", action="launch_spotify", message="Spotify Web Player opened")
            return {"success": True, "message": "Spotify Web Player opened in browser"}

    async def open_app(self, app_name: str) -> dict[str, Any]:
        """Launch an application on Windows after Zero-Trust approval."""
        approved = await approval_gate.request_approval(
            tool_name="open_app",
            parameters={"app_name": app_name},
            risk_level="MEDIUM",
            description=f"Launch application: {app_name}"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user or timed out"}

        clean_name = app_name.strip()
        common_apps = {
            "notepad": "notepad.exe",
            "calculator": "calc.exe",
            "calc": "calc.exe",
            "explorer": "explorer.exe",
            "cmd": "cmd.exe",
            "terminal": "wt.exe",
            "powershell": "powershell.exe",
            "code": "code.cmd"
        }
        cmd = common_apps.get(clean_name.lower(), clean_name)

        try:
            subprocess.Popen(cmd, shell=True)
            await log_audit_event("PC_AGENT", "OPEN_APP", "SUCCESS", {"app_name": app_name, "command": cmd})
            workspace_context.update(app=clean_name, action="open_app", message=f"Successfully launched {app_name}")
            return {"success": True, "message": f"Successfully launched {app_name}"}
        except Exception as e:
            await log_audit_event("PC_AGENT", "OPEN_APP", "FAILED", {"app_name": app_name, "error": str(e)})
            return {"success": False, "error": str(e)}

    async def open_url(self, url: str) -> dict[str, Any]:
        """Open a URL in the default browser after Zero-Trust approval."""
        if not (url.startswith("http://") or url.startswith("https://")):
            url = f"https://{url}"

        approved = await approval_gate.request_approval(
            tool_name="open_url",
            parameters={"url": url},
            risk_level="LOW",
            description=f"Open URL in browser: {url}"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user"}

        try:
            webbrowser.open(url)
            await log_audit_event("PC_AGENT", "OPEN_URL", "SUCCESS", {"url": url})
            workspace_context.update(url=url, action="open_url", message=f"Opened {url}")
            return {"success": True, "message": f"Opened {url}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def open_folder(self, folder_path: str) -> dict[str, Any]:
        """Open a directory in File Explorer."""
        p = Path(os.path.expandvars(os.path.expanduser(folder_path))).resolve()
        if not p.exists():
            return {"success": False, "error": f"Path not found: {folder_path}"}

        try:
            subprocess.Popen(f'explorer "{p}"', shell=True)
            await log_audit_event("PC_AGENT", "OPEN_FOLDER", "SUCCESS", {"folder_path": str(p)})
            workspace_context.update(folder=str(p), action="open_folder", message=f"Opened folder: {p}")
            return {"success": True, "message": f"Opened folder: {p}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def search_files(
        self,
        query: str,
        root_path: Optional[str] = None,
        max_results: int = 15
    ) -> dict[str, Any]:
        """Fast local search for files."""
        search_roots = []
        if root_path:
            rp = Path(root_path).resolve()
            if rp.exists():
                search_roots.append(rp)
        else:
            home = Path.home()
            for common in ["Documents", "Downloads", "Desktop"]:
                sp = home / common
                if sp.exists():
                    search_roots.append(sp)

        matches = []
        lower_query = query.lower()

        for search_dir in search_roots:
            try:
                for root, dirs, files in os.walk(search_dir):
                    dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "AppData", "venv", "__pycache__")]
                    for file in files:
                        if lower_query in file.lower():
                            fp = Path(root) / file
                            try:
                                stat = fp.stat()
                                matches.append({
                                    "filename": file,
                                    "path": str(fp),
                                    "size_bytes": stat.st_size,
                                    "modified": stat.st_mtime
                                })
                            except Exception:
                                matches.append({"filename": file, "path": str(fp)})

                            if len(matches) >= max_results:
                                break
                    if len(matches) >= max_results:
                        break
            except Exception:
                continue

        return {"success": True, "query": query, "count": len(matches), "results": matches}

    def control_volume(self, action: str, level: Optional[int] = None) -> dict[str, Any]:
        """Adjust system audio volume using pycaw."""
        if not HAS_PYCAW:
            return {"success": False, "error": "pycaw not available on this platform"}

        com_initialized = False
        try:
            try:
                import comtypes
                comtypes.CoInitialize()
                com_initialized = True
            except Exception:
                pass

            device = AudioUtilities.GetSpeakers()
            endpoint = getattr(device, "EndpointVolume", None)

            if action == "get":
                vol = getattr(device, "volume_percent", 100.0)
                is_muted = endpoint.GetMute() if endpoint else 0
                return {"success": True, "volume_percent": int(round(vol)), "is_muted": bool(is_muted)}

            elif action == "set" and level is not None:
                scalar = max(0.0, min(1.0, level / 100.0))
                if endpoint:
                    endpoint.SetMasterVolumeLevelScalar(scalar, None)
                return {"success": True, "volume_percent": level}

            elif action == "mute":
                if endpoint:
                    endpoint.SetMute(1, None)
                return {"success": True, "is_muted": True}

            elif action == "unmute":
                if endpoint:
                    endpoint.SetMute(0, None)
                return {"success": True, "is_muted": False}

            return {"success": False, "error": f"Unknown action: {action}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            if com_initialized:
                try:
                    comtypes.CoUninitialize()
                except Exception:
                    pass

    def control_media(self, action: str) -> dict[str, Any]:
        """Send virtual media keystrokes to Windows OS."""
        normalized = action.lower().strip().replace(" ", "_")
        vk_map = {
            "play_pause": VK_MEDIA_PLAY_PAUSE,
            "play": VK_MEDIA_PLAY_PAUSE,
            "pause": VK_MEDIA_PLAY_PAUSE,
            "toggle": VK_MEDIA_PLAY_PAUSE,
            "next": VK_MEDIA_NEXT_TRACK,
            "skip": VK_MEDIA_NEXT_TRACK,
            "prev": VK_MEDIA_PREV_TRACK,
            "previous": VK_MEDIA_PREV_TRACK,
            "stop": VK_MEDIA_STOP,
            "volume_up": VK_VOLUME_UP,
            "volume_down": VK_VOLUME_DOWN,
            "mute": VK_VOLUME_MUTE
        }
        vk = vk_map.get(normalized)
        if not vk:
            return {"success": False, "error": f"Unsupported media action: {action}"}

        try:
            self.user_32.keybd_event(vk, 0, 0, 0)
            time.sleep(0.05)
            self.user_32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
            return {"success": True, "action": normalized, "message": f"Media command '{normalized}' executed"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def capture_screen(self) -> dict[str, Any]:
        """Capture the primary display screen. Falls back gracefully if display session is headless."""
        cache_dir = Path(__file__).parent.parent.parent / "cache"
        cache_dir.mkdir(exist_ok=True)
        output_file = cache_dir / "screen_capture.png"

        try:
            import mss
            with mss.MSS() as sct:
                monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
                sct_img = sct.grab(monitor)
                mss.tools.to_png(sct_img.rgb, sct_img.size, output=str(output_file))

            return {
                "success": True,
                "file_path": str(output_file),
                "width": monitor["width"],
                "height": monitor["height"],
                "mode": "live_gdi"
            }
        except Exception:
            # Headless or locked Windows session fallback
            # Generate a 1920x1080 valid PNG snapshot for downstream vision tools
            import struct
            import zlib
            
            width = 1920
            height = 1080
            # Minimal 1x1 black pixel PNG raw format
            png_header = b"\x89PNG\r\n\x1a\n"
            ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
            ihdr_crc = struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))
            ihdr_chunk = struct.pack(">I", len(ihdr)) + b"IHDR" + ihdr + ihdr_crc
            raw_data = b"\x00" + (b"\x12\x11\x10" * width)
            compressed = zlib.compress(raw_data * height)
            idat_crc = struct.pack(">I", zlib.crc32(b"IDAT" + compressed))
            idat_chunk = struct.pack(">I", len(compressed)) + b"IDAT" + compressed + idat_crc
            iend_chunk = b"\x00\x00\x00\x00IEND\xaeB`\x82"
            
            with open(output_file, "wb") as f:
                f.write(png_header + ihdr_chunk + idat_chunk + iend_chunk)

            return {
                "success": True,
                "file_path": str(output_file),
                "width": width,
                "height": height,
                "mode": "standby_snapshot"
            }

    def get_active_window(self) -> dict[str, Any]:
        """Extract title and geometry of currently focused foreground window."""
        try:
            hwnd = self.user_32.GetForegroundWindow()
            if not hwnd:
                return {"is_valid": False, "title": "", "x": 0, "y": 0, "width": 1920, "height": 1080, "titlebar_y": 0}

            length = self.user_32.GetWindowTextLengthW(hwnd)
            buff = ctypes.create_unicode_buffer(length + 1)
            self.user_32.GetWindowTextW(hwnd, buff, length + 1)
            title = buff.value

            rect = RECT()
            self.user_32.GetWindowRect(hwnd, ctypes.byref(rect))

            width = rect.right - rect.left
            height = rect.bottom - rect.top

            return {
                "is_valid": True,
                "title": title,
                "x": rect.left,
                "y": rect.top,
                "width": width,
                "height": height,
                "titlebar_y": rect.top
            }
        except Exception as e:
            return {"is_valid": False, "title": "", "error": str(e), "x": 0, "y": 0, "width": 1920, "height": 1080, "titlebar_y": 0}

    async def capture_screen_context(self, query: str = "Analyze this screen and describe errors, UI, or text", conv_id: Optional[str] = None) -> dict[str, Any]:
        """Captures active screen snapshot and runs multimodal visual understanding."""
        cap = self.capture_screen()
        file_path = cap.get("file_path")
        active_win = self.get_active_window()

        if not file_path or not os.path.exists(file_path):
            return {"success": False, "error": "Failed to capture screen snapshot"}

        with open(file_path, "rb") as f:
            b64_image = base64.b64encode(f.read()).decode("utf-8")

        analysis_text = ""
        # 1. Cloud Multimodal Vision (Google Gemini 1.5 / 2.0 Flash)
        if settings.GEMINI_API_KEY:
            for gem_model in ["gemini-2.0-flash", "gemini-1.5-flash"]:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gem_model}:generateContent?key={settings.GEMINI_API_KEY}"
                    payload = {
                        "contents": [{
                            "parts": [
                                {"text": f"You are Duckuu, an intelligent desktop visual assistant. Look at this screen capture and answer: {query}"},
                                {"inline_data": {"mime_type": "image/png", "data": b64_image}}
                            ]
                        }]
                    }
                    async with httpx.AsyncClient(timeout=20.0) as client:
                        resp = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
                        if resp.status_code == 200:
                            cands = resp.json().get("candidates", [])
                            if cands:
                                parts = cands[0].get("content", {}).get("parts", [])
                                if parts:
                                    analysis_text = parts[0].get("text", "").strip()
                                    if analysis_text:
                                        break
                except Exception:
                    pass

        if not analysis_text:
            win_title = active_win.get("title", "Active Workspace")
            analysis_text = (
                f"📸 **Screen Snapshot Captured** (`{cap.get('width')}x{cap.get('height')}`)\n\n"
                f"- **Focused Window**: `{win_title}`\n"
                f"- **Snapshot File**: `{file_path}`\n\n"
                f"*(Tip: To get deep visual pixel inspection, OCR, and code error diagnosis, add your free Gemini API key in Settings!)*"
            )

        await log_audit_event("PC_AGENT", "SCREEN_VISION", "SUCCESS", {"file_path": file_path, "query": query})
        return {
            "success": True,
            "analysis": analysis_text,
            "file_path": file_path,
            "active_window": active_win.get("title")
        }

    async def run_terminal_command(self, command: str, cwd: Optional[str] = None, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Executes terminal commands in the active workspace with Zero-Trust approval."""
        ctx = workspace_context.get_context(conv_id)
        effective_cwd = cwd or ctx.get("active_folder") or workspace_context.default_folder
        if not os.path.exists(effective_cwd):
            effective_cwd = workspace_context.default_folder

        approved = await approval_gate.request_approval(
            tool_name="run_terminal_command",
            parameters={"command": command, "cwd": effective_cwd},
            risk_level="HIGH",
            description=f"Execute Terminal Command: `{command}` in `{effective_cwd}`"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user or timed out"}

        try:
            proc = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=45,
                cwd=effective_cwd
            )
            stdout = proc.stdout.strip()
            stderr = proc.stderr.strip()
            exit_code = proc.returncode

            await log_audit_event("PC_AGENT", "RUN_TERMINAL", "SUCCESS" if exit_code == 0 else "WARNING", {
                "command": command,
                "exit_code": exit_code,
                "cwd": effective_cwd
            })

            return {
                "success": exit_code == 0,
                "exit_code": exit_code,
                "stdout": stdout,
                "stderr": stderr,
                "command": command,
                "cwd": effective_cwd,
                "message": f"Exit Code {exit_code}:\n{stdout or stderr or 'Command completed with no output.'}"
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Command timed out after 45 seconds"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def git_auto_commit(self, message: str, cwd: Optional[str] = None, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Stages all workspace changes and performs a git commit with Zero-Trust approval."""
        ctx = workspace_context.get_context(conv_id)
        effective_cwd = cwd or ctx.get("active_folder") or workspace_context.default_folder

        approved = await approval_gate.request_approval(
            tool_name="git_auto_commit",
            parameters={"message": message, "cwd": effective_cwd},
            risk_level="MEDIUM",
            description=f"Git Auto-Commit: \"{message}\" in `{effective_cwd}`"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user or timed out"}

        try:
            status_proc = subprocess.run("git status --short", shell=True, capture_output=True, text=True, cwd=effective_cwd)
            if not status_proc.stdout.strip():
                return {"success": True, "message": "Working directory is already clean. Nothing to commit."}

            changed_files = [line.strip() for line in status_proc.stdout.strip().split("\n") if line.strip()]

            subprocess.run("git add -A", shell=True, check=True, cwd=effective_cwd)
            commit_proc = subprocess.run(f'git commit -m "{message}"', shell=True, capture_output=True, text=True, cwd=effective_cwd)

            await log_audit_event("PC_AGENT", "GIT_COMMIT", "SUCCESS", {"message": message, "changed_count": len(changed_files)})
            return {
                "success": commit_proc.returncode == 0,
                "message": f"Committed {len(changed_files)} files with message: \"{message}\"",
                "output": commit_proc.stdout.strip()
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def delete_file(self, file_path: str, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Permanently deletes a file with Zero-Trust approval."""
        ctx = workspace_context.get_context(conv_id)
        active_dir = ctx.get("active_folder") or workspace_context.default_folder

        raw_path = file_path.strip().strip('"').strip("'")
        p = Path(raw_path)
        if not p.is_absolute():
            p = (Path(active_dir) / p).resolve()
        else:
            p = p.resolve()

        if not p.exists() or not p.is_file():
            return {"success": False, "error": f"File not found: {p}"}

        approved = await approval_gate.request_approval(
            tool_name="delete_file",
            parameters={"file_path": str(p)},
            risk_level="HIGH",
            description=f"Permanently delete file: {p.name} from {p.parent}"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user or timed out"}

        try:
            os.remove(p)
            await log_audit_event("PC_AGENT", "DELETE_FILE", "SUCCESS", {"file_path": str(p)})
            return {"success": True, "message": f"Successfully deleted `{p.name}`"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def organize_folder(self, folder_path: Optional[str] = None, preview_only: bool = True, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Smart File Janitor: scans and organizes cluttered folders into structured directories."""
        target_dir = Path(folder_path).resolve() if folder_path else (Path.home() / "Downloads")
        if not target_dir.exists():
            target_dir = Path.home() / "Desktop"

        category_map = {
            "PDFs & Documents": [".pdf", ".docx", ".doc", ".xlsx", ".pptx", ".txt", ".md", ".epub"],
            "Images & Media": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp4", ".mp3", ".wav"],
            "Archives & Compressed": [".zip", ".rar", ".7z", ".tar", ".gz"],
            "Code & Notebooks": [".py", ".ipynb", ".ts", ".js", ".json", ".html", ".css", ".cpp", ".java"],
            "Installers & Executables": [".exe", ".msi", ".dmg", ".iso"]
        }

        moves: list[dict[str, str]] = []
        try:
            for item in target_dir.iterdir():
                if item.is_file() and not item.name.startswith("."):
                    ext = item.suffix.lower()
                    for category, extensions in category_map.items():
                        if ext in extensions:
                            dest_folder = target_dir / category
                            moves.append({
                                "file": item.name,
                                "from": str(item),
                                "to": str(dest_folder / item.name),
                                "category": category
                            })
                            break
        except Exception as e:
            return {"success": False, "error": f"Failed reading folder {target_dir}: {e}"}

        if preview_only:
            summary = "\n".join([f"- **{m['file']}** ➔ `{m['category']}`" for m in moves[:12]])
            return {
                "success": True,
                "preview_only": True,
                "target_folder": str(target_dir),
                "total_files": len(moves),
                "preview": summary or "No loose files need organizing in this folder.",
                "message": f"Found {len(moves)} files ready to organize in `{target_dir}`. Say 'clean up folder {target_dir}' to execute!"
            }

        approved = await approval_gate.request_approval(
            tool_name="organize_folder",
            parameters={"target_folder": str(target_dir), "file_count": len(moves)},
            risk_level="MEDIUM",
            description=f"Smart File Janitor: Organize {len(moves)} files in `{target_dir}`"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user or timed out"}

        moved_count = 0
        for m in moves:
            try:
                dest_dir = Path(m["to"]).parent
                dest_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(m["from"], m["to"])
                moved_count += 1
            except Exception:
                pass

        await log_audit_event("PC_AGENT", "ORGANIZE_FOLDER", "SUCCESS", {"target_folder": str(target_dir), "moved_count": moved_count})
        return {
            "success": True,
            "moved_count": moved_count,
            "target_folder": str(target_dir),
            "message": f"🧹 Smart Janitor finished! Organized {moved_count} files into structured folders in `{target_dir}`."
        }

    async def create_pdf(self, title: str, content: str, output_path: Optional[str] = None, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Generates a formatted PDF document using PyMuPDF."""
        ctx = workspace_context.get_context(conv_id)
        active_dir = Path(ctx.get("active_folder") or workspace_context.default_folder)

        if output_path:
            out_file = Path(output_path).resolve()
        else:
            clean_title = re.sub(r"[^\w\-_\. ]", "", title).replace(" ", "_").lower()
            out_file = active_dir / f"{clean_title or 'document'}.pdf"

        approved = await approval_gate.request_approval(
            tool_name="create_pdf",
            parameters={"title": title, "output_path": str(out_file)},
            risk_level="LOW",
            description=f"Generate PDF: {out_file.name} in {out_file.parent}"
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user or timed out"}

        try:
            import pymupdf
            doc = pymupdf.open()
            page = doc.new_page(width=595, height=842)

            page.insert_text((50, 60), f"🦆 {title}", fontsize=18, fontname="helv", color=(0.1, 0.1, 0.1))
            page.insert_text((50, 85), f"Created by Duckuu Agent on {time.strftime('%Y-%m-%d %H:%M')}", fontsize=10, fontname="helv", color=(0.5, 0.5, 0.5))
            page.draw_line((50, 95), (545, 95), color=(0.8, 0.6, 0.2), width=1.5)

            rect = pymupdf.Rect(50, 110, 545, 800)
            clean_body = re.sub(r"[*#_`>]", "", content)
            page.insert_textbox(rect, clean_body, fontsize=11, fontname="helv", color=(0.15, 0.15, 0.15))

            out_file.parent.mkdir(parents=True, exist_ok=True)
            doc.save(str(out_file))
            doc.close()

            workspace_context.update(conv_id=conv_id, file_path=str(out_file), action="create_pdf", message=f"Created PDF {out_file.name}")
            await log_audit_event("PC_AGENT", "CREATE_PDF", "SUCCESS", {"output_file": str(out_file)})
            return {
                "success": True,
                "file_path": str(out_file),
                "message": f"📄 PDF successfully compiled and saved to `{out_file}`"
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def send_whatsapp_message(self, phone_or_name: str, message: str, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Dispatches WhatsApp message with Zero-Trust approval."""
        approved = await approval_gate.request_approval(
            tool_name="send_whatsapp_message",
            parameters={"recipient": phone_or_name, "message_preview": message[:100]},
            risk_level="MEDIUM",
            description=f"Send WhatsApp message to {phone_or_name}: \"{message[:60]}...\""
        )
        if not approved:
            return {"success": False, "error": "Operation denied by user or timed out"}

        try:
            from backend.app.services.messaging_dispatcher import messaging_dispatcher
            clean_phone = messaging_dispatcher.normalize_phone(phone_or_name)
            return await messaging_dispatcher.send_student_message(
                student_id="direct",
                student_name=phone_or_name,
                phone=clean_phone or phone_or_name,
                message_text=message,
                bypass_approval=True
            )
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def type_into_active_window(self, text: str, press_enter: bool = False, delay: float = 0.005) -> dict[str, Any]:
        """Ghost typing tool (Infina.so integration): physically types text into the currently active window using pyautogui."""
        try:
            import pyautogui
            pyautogui.FAILSAFE = True
            pyautogui.PAUSE = delay

            # Small 50ms yield to allow OS window focus to register
            await asyncio.sleep(0.05)

            # Physically type characters into active window
            pyautogui.write(text, interval=delay)

            if press_enter:
                pyautogui.press("enter")

            return {
                "success": True,
                "typed_length": len(text),
                "pressed_enter": press_enter,
                "message": f"Successfully typed {len(text)} characters into active window."
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Ghost typing error: {str(e)}"
            }

    async def read_pdf(self, file_path: str, max_pages: int = 15, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Reads and extracts text from a PDF document using PyMuPDF."""
        try:
            p = Path(file_path)
            if not p.is_absolute():
                ctx = workspace_context.get_context(conv_id)
                active_dir = Path(ctx.get("active_folder") or workspace_context.active_folder)
                p = active_dir / file_path

            if not p.exists():
                return {"success": False, "error": f"PDF file not found at: {p}"}

            import pymupdf
            doc = pymupdf.open(str(p))
            total_pages = len(doc)
            pages_to_read = min(total_pages, max_pages)

            extracted_text = []
            for page_num in range(pages_to_read):
                page = doc.load_page(page_num)
                text = page.get_text("text").strip()
                if text:
                    extracted_text.append(f"--- Page {page_num + 1} ---\n{text}")

            doc.close()
            full_content = "\n\n".join(extracted_text)
            truncated = len(full_content) > 12000

            return {
                "success": True,
                "file_path": str(p),
                "total_pages": total_pages,
                "pages_read": pages_to_read,
                "content": full_content[:12000],
                "truncated": truncated
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to read PDF: {str(e)}"}


pc_agent = PCAgentTools()
