import os
import re
import json
from pathlib import Path
from typing import Optional, Any


class WorkspaceContextManager:
    def __init__(self) -> None:
        # Default workspace root is the Duckuu project directory
        default_root = str(Path(__file__).resolve().parent.parent.parent.parent)
        self.default_folder = default_root if os.path.exists(default_root) else "F:\\DUCKUU"

        # Global desktop state
        self.active_app: Optional[str] = None
        self.active_folder: str = self.default_folder
        self.active_file: Optional[str] = None
        self.last_url: Optional[str] = None
        self.last_action: Optional[str] = None
        self.last_action_message: Optional[str] = None
        self.recent_workspaces: list[str] = [self.default_folder]

        # Per-conversation context tracking
        self._conversations: dict[str, dict[str, Any]] = {}
        self._broadcaster: Optional[Any] = None

    def register_broadcaster(self, broadcaster: Any) -> None:
        self._broadcaster = broadcaster

    async def _broadcast(self, message: dict) -> None:
        if self._broadcaster:
            try:
                await self._broadcaster.broadcast(message)
            except Exception as e:
                print(f"[WorkspaceContext] Broadcast error: {e}")

    def get_context(self, conv_id: Optional[str] = None) -> dict[str, Any]:
        """Returns the active context for a conversation merged with global state."""
        conv_state = self._conversations.get(conv_id, {}) if conv_id else {}
        active_f = conv_state.get("active_folder") or self.active_folder or self.default_folder
        folder_path = Path(active_f)
        return {
            "active_app": conv_state.get("active_app") or self.active_app,
            "active_folder": active_f,
            "folder_name": folder_path.name or str(folder_path),
            "active_file": conv_state.get("active_file") or self.active_file,
            "last_url": conv_state.get("last_url") or self.last_url,
            "last_action": conv_state.get("last_action") or self.last_action,
            "last_action_message": conv_state.get("last_action_message") or self.last_action_message,
            "recent_workspaces": self.recent_workspaces
        }

    def resolve_folder_path(self, folder_input: str) -> Optional[Path]:
        r"""
        Intelligently resolves any folder input (exact path, relative path, or project name).
        Searches sibling project directories (e.g. F:\PROJECTSS\*) with case-insensitive matching.
        """
        clean = folder_input.strip().strip('"').strip("'")
        if not clean:
            return None

        # 1. Direct path resolution
        try:
            direct_p = Path(os.path.expandvars(os.path.expanduser(clean))).resolve()
            if direct_p.exists() and direct_p.is_dir():
                return direct_p
        except Exception:
            pass

        # Candidate roots to search for project names
        cur_p = Path(self.active_folder).resolve()
        candidate_roots = [
            cur_p.parent,                     # Sibling directories
            cur_p,                            # Child directories
            Path("F:/PROJECTSS").resolve(),   # Common projects root
            Path("F:/CODES").resolve(),
            Path("F:/").resolve(),
            Path.home() / "Projects",
            Path.home() / "Desktop"
        ]

        clean_lower = clean.lower().replace("-", " ").replace("_", " ").strip()

        for root in candidate_roots:
            if not root.exists() or not root.is_dir():
                continue

            # Exact join match
            target = (root / clean).resolve()
            if target.exists() and target.is_dir():
                return target

            # Case-insensitive or normalized folder scan
            try:
                for item in root.iterdir():
                    if item.is_dir() and not item.name.startswith("."):
                        item_lower = item.name.lower().replace("-", " ").replace("_", " ").strip()
                        if item_lower == clean_lower or clean_lower in item_lower:
                            return item.resolve()
            except Exception:
                continue

        return None

    def get_available_projects(self) -> list[dict[str, Any]]:
        """
        Returns list of sibling and accessible project directories for instant 1-click workspace switching,
        matching Antigravity's workspace discovery interface.
        """
        projects = []
        seen_paths = set()

        cur_path = Path(self.active_folder).resolve()
        parent_dir = cur_path.parent

        scan_dirs = [parent_dir]
        if Path("F:/PROJECTSS").exists():
            scan_dirs.append(Path("F:/PROJECTSS").resolve())

        for s_dir in scan_dirs:
            if not s_dir.exists() or not s_dir.is_dir():
                continue
            try:
                for item in s_dir.iterdir():
                    if item.is_dir() and not item.name.startswith(".") and not item.name.startswith("$"):
                        res_p = str(item.resolve())
                        if res_p not in seen_paths:
                            seen_paths.add(res_p)
                            projects.append({
                                "name": item.name,
                                "path": res_p,
                                "is_active": res_p.lower() == str(cur_path).lower()
                            })
            except Exception:
                continue

        # Sort with current active project first, then alphabetically
        projects.sort(key=lambda x: (not x["is_active"], x["name"].lower()))
        return projects[:20]

    async def set_workspace(
        self,
        folder_path: str,
        conv_id: Optional[str] = None,
        create_if_missing: bool = False
    ) -> dict[str, Any]:
        """Dynamically switches active workspace directory, updates recent list, persists to SQLite, and broadcasts change."""
        resolved = self.resolve_folder_path(folder_path)

        if not resolved:
            clean_path = folder_path.strip().strip('"').strip("'")
            p = Path(os.path.expandvars(os.path.expanduser(clean_path))).resolve()
            if not p.exists():
                if create_if_missing:
                    try:
                        p.mkdir(parents=True, exist_ok=True)
                        resolved = p
                    except Exception as e:
                        return {"success": False, "error": f"Failed creating directory {p}: {e}"}
                else:
                    return {"success": False, "error": f"Directory not found: '{folder_path}'. Please check the path or select from available projects."}
            elif p.is_dir():
                resolved = p
            else:
                return {"success": False, "error": f"Path is not a directory: '{p}'"}

        str_path = str(resolved)
        self.active_folder = str_path
        self.last_action_message = f"Active workspace switched to {str_path}"

        # Maintain recent list
        if str_path in self.recent_workspaces:
            self.recent_workspaces.remove(str_path)
        self.recent_workspaces.insert(0, str_path)
        self.recent_workspaces = self.recent_workspaces[:10]

        # Persist to SQLite app_settings so it survives reboots
        try:
            from backend.app.services.config_manager import config_manager
            await config_manager.set_setting("active_workspace", str_path)
            await config_manager.set_setting("recent_workspaces", json.dumps(self.recent_workspaces))
        except Exception as e:
            print(f"[WorkspaceContext] Warning: Failed saving to DB: {e}")

        if conv_id:
            if conv_id not in self._conversations:
                self._conversations[conv_id] = {
                    "active_app": None,
                    "active_folder": str_path,
                    "active_file": None,
                    "last_url": None,
                    "last_action": "set_workspace",
                    "last_action_message": f"Active workspace switched to {str_path}"
                }
            else:
                self._conversations[conv_id]["active_folder"] = str_path
                self._conversations[conv_id]["last_action_message"] = f"Active workspace switched to {str_path}"

        event = {
            "type": "WORKSPACE_CHANGED",
            "active_folder": str_path,
            "folder_name": resolved.name or str_path,
            "recent_workspaces": self.recent_workspaces,
            "available_projects": self.get_available_projects()
        }
        await self._broadcast(event)
        await self._broadcast({
            "type": "SPEECH_PILL",
            "text": f"📁 Switched workspace to {resolved.name or str_path}",
            "level": "info",
            "duration_ms": 2500
        })

        return {
            "success": True,
            "active_folder": str_path,
            "folder_name": resolved.name or str_path,
            "recent_workspaces": self.recent_workspaces,
            "message": f"Successfully switched active workspace to `{str_path}`"
        }

    def update(
        self,
        conv_id: Optional[str] = None,
        app: Optional[str] = None,
        folder: Optional[str] = None,
        file_path: Optional[str] = None,
        url: Optional[str] = None,
        action: Optional[str] = None,
        message: Optional[str] = None
    ) -> dict[str, Any]:
        """Updates workspace state both globally and for a specific conversation."""
        if app:
            self.active_app = app
        if folder:
            self.active_folder = folder
            if folder not in self.recent_workspaces:
                self.recent_workspaces.insert(0, folder)
                self.recent_workspaces = self.recent_workspaces[:10]
        if file_path:
            self.active_file = file_path
        if url:
            self.last_url = url
        if action:
            self.last_action = action
        if message:
            self.last_action_message = message

        if conv_id:
            if conv_id not in self._conversations:
                self._conversations[conv_id] = {
                    "active_app": None,
                    "active_folder": self.active_folder,
                    "active_file": None,
                    "last_url": None,
                    "last_action": None,
                    "last_action_message": None
                }
            c = self._conversations[conv_id]
            if app:
                c["active_app"] = app
            if folder:
                c["active_folder"] = folder
            if file_path:
                c["active_file"] = file_path
            if url:
                c["last_url"] = url
            if action:
                c["last_action"] = action
            if message:
                c["last_action_message"] = message

        return self.get_context(conv_id)

    def resolve_references(self, text: str, conv_id: Optional[str] = None) -> tuple[str, dict[str, Any]]:
        """
        Resolves pronouns like 'there', 'in there', 'in that folder', 'it'
        using the active workspace context.
        """
        ctx = self.get_context(conv_id)
        resolved_text = text
        active_folder = ctx.get("active_folder") or self.default_folder
        active_app = ctx.get("active_app") or "VS Code"

        # Resolve folder pronouns: "in there", "inside there", "in that folder", "in that directory", "there"
        folder_pronouns = [
            r"\bin there\b",
            r"\binside there\b",
            r"\bin that folder\b",
            r"\bin that directory\b",
            r"\bto that folder\b",
            r"\binto that folder\b",
            r"\binside it\b"
        ]
        for p in folder_pronouns:
            resolved_text = re.sub(p, lambda _m: f"in {active_folder}", resolved_text, flags=re.IGNORECASE)

        # "create a new file in there" -> "create a new file in F:\DUCKUU"
        if re.search(r"\b(create|make|write|touch)\b.*\bthere\b", text, re.IGNORECASE):
            resolved_text = re.sub(r"\bthere\b", lambda _m: active_folder, resolved_text, flags=re.IGNORECASE)

        # Resolve app pronouns: "in it", "in that app"
        if "in it" in resolved_text.lower() and active_app:
            resolved_text = re.sub(r"\bin it\b", lambda _m: f"in {active_app}", resolved_text, flags=re.IGNORECASE)

        return resolved_text, ctx

    def get_system_prompt_snippet(self, conv_id: Optional[str] = None) -> str:
        """Returns formatted string to inject into LLM system instruction."""
        ctx = self.get_context(conv_id)
        parts = []
        if ctx.get("active_folder"):
            parts.append(f"Active Workspace Folder: {ctx['active_folder']} ({ctx.get('folder_name', 'Workspace')})")
        if ctx.get("active_app"):
            parts.append(f"Active Focused App: {ctx['active_app']}")
        if ctx.get("active_file"):
            parts.append(f"Last File Accessed: {ctx['active_file']}")
        if ctx.get("last_action_message"):
            parts.append(f"Last OS Tool Executed: {ctx['last_action_message']}")

        if not parts:
            parts.append(f"Active Workspace Folder: {self.default_folder}")

        return "\n".join([
            "[CURRENT WORKSPACE STATE]:",
            *[f"- {p}" for p in parts],
            "IMPORTANT: All file creations, scripts, terminal executions, and code edits must happen inside the Active Workspace Folder above."
        ])


workspace_context = WorkspaceContextManager()
