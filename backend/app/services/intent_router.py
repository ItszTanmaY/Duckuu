import re
import os
from pathlib import Path
from typing import Optional, Any
from backend.app.services.pc_agent import pc_agent
from backend.app.services.workspace_context import workspace_context
from backend.app.services.deadline_scheduler import deadline_scheduler
from backend.app.services.student_drafter import student_drafter
from backend.app.services.research_agent import research_agent
from backend.app.services.focus_timer import focus_timer


class IntentRouter:
    """
    Parses and executes compound OS intents, tool chains, and context-dependent actions.
    """

    def extract_windows_path(self, text: str) -> Optional[str]:
        r"""Extracts Windows drive path (e.g. F:\DUCKUU or C:/Users/...) from text."""
        # Match standard Windows paths with drive letter
        match = re.search(r"([a-zA-Z]:[\\/][^\s\"\'\<\>\|\?\*]+)", text)
        if match:
            clean = match.group(1).rstrip(".,;:")
            return clean

        # Match folder keyword e.g. "folder F:\DUCKUU" or "folder my_project"
        folder_match = re.search(r"\bfolder\s+([^\s\"\'\<\>\|\?\*]+)", text, re.IGNORECASE)
        if folder_match:
            return folder_match.group(1).rstrip(".,;:")

        return None

    def extract_filename(self, text: str) -> Optional[str]:
        """Extracts filename with extension (e.g. test.py, notes.txt, index.html)."""
        match = re.search(r"\b([a-zA-Z0-9_\-]+\.[a-zA-Z0-9_]{1,6})\b", text)
        if match:
            return match.group(1)
        return None

    async def execute_intent(
        self,
        raw_user_text: str,
        conv_id: Optional[str] = None,
        mode: str = "general"
    ) -> Optional[dict[str, Any]]:
        """
        Processes user text. If matching one or more tool intents, executes them and
        returns a consolidated result dict: {"executed": True, "reply": str, "tools": list}.
        If not a tool action, returns None so it flows into the conversational LLM.
        """
        # Step 1: Pronoun and Workspace Reference Resolution
        resolved_text, ctx = workspace_context.resolve_references(raw_user_text, conv_id)
        lower_text = resolved_text.lower().strip()
        active_folder = ctx.get("active_folder") or workspace_context.default_folder

        executed_tools: list[str] = []
        reply_lines: list[str] = []

        # Check for multi-clause tool chaining e.g. "X and Y"
        # Only split if " and " separates distinct action commands (e.g. "open VS Code and launch Spotify")
        is_compound = " and " in lower_text or " then " in lower_text
        clauses = [resolved_text]
        if is_compound:
            # Check if this is a single compound VS Code command e.g. "open vs code and open folder X"
            if ("vs code" in lower_text or "vscode" in lower_text) and ("folder" in lower_text or ":" in lower_text) and not any(k in lower_text for k in ["spotify", "chrome", "volume", "research"]):
                clauses = [resolved_text]
            else:
                raw_clauses = re.split(r"\s+(?:and|then)\s+", resolved_text, flags=re.IGNORECASE)
                # Verify each clause looks like an actionable request
                action_keywords = ["open", "launch", "create", "make", "play", "pause", "skip", "set", "check", "remind", "search"]
                if all(any(k in c.lower() for k in action_keywords) for c in raw_clauses if c.strip()):
                    clauses = [c.strip() for c in raw_clauses if c.strip()]

        for clause in clauses:
            c_lower = clause.lower().strip()

            # 0. Dynamic Workspace Switching & Inquiry Intent
            workspace_triggers = [
                "change workspace", "switch workspace", "set workspace", "use workspace",
                "change directory", "switch directory", "set folder", "switch folder",
                "change folder", "switch project", "change project", "work on project",
                "work in ", "cd "
            ]
            if any(k in c_lower for k in workspace_triggers) or (("workspace" in c_lower or "project" in c_lower) and any(w in c_lower for w in ["change", "switch", "open", "set", "use", "go to"])):
                extracted = self.extract_windows_path(clause)
                if not extracted:
                    p_match = re.search(r"(?:workspace|directory|folder|cd|project|work on|work in|go to)\s+(?:to\s+)?['\"]?([^'\"\n]+)['\"]?", clause, re.IGNORECASE)
                    if p_match:
                        cand = p_match.group(1).strip()
                        if cand and not any(cand.lower().startswith(s) for s in ["and", "then", "please"]):
                            extracted = cand

                # Check if user mentioned an available project name directly
                if not extracted or extracted.lower() in ["to", "a", "the", "my"]:
                    for proj in workspace_context.get_available_projects():
                        if proj["name"].lower() in c_lower:
                            extracted = proj["path"]
                            break

                if extracted:
                    res = await workspace_context.set_workspace(folder_path=extracted, conv_id=conv_id, create_if_missing=True)
                    executed_tools.append("set_workspace")
                    if res.get("success"):
                        active_folder = res["active_folder"]
                        reply_lines.append(f"📁 **Active Workspace Switched:**\nNow working in **`{res['active_folder']}`**.\n\nAll subsequent terminal commands, file creations, and VS Code launches will target this directory!")
                    else:
                        reply_lines.append(f"⚠️ Could not switch workspace: {res.get('error')}")
                else:
                    ctx = workspace_context.get_context(conv_id)
                    projs = [f"`{p['name']}`" for p in workspace_context.get_available_projects()[:5]]
                    reply_lines.append(
                        f"📁 Current active workspace is **`{ctx['active_folder']}`**.\n\n"
                        f"Available projects: {', '.join(projs) if projs else 'none found'}\n\n"
                        f"Tell me which project to switch to (e.g. `switch to CyberPredator`) or click the workspace selector in the top bar!"
                    )

            elif any(k in c_lower for k in ["what is my workspace", "what workspace am i in", "current workspace", "which workspace", "show workspace", "where are we working"]):
                ctx = workspace_context.get_context(conv_id)
                p = Path(ctx["active_folder"])
                item_count = len(list(p.iterdir())) if p.exists() and p.is_dir() else 0
                executed_tools.append("get_workspace")
                reply_lines.append(
                    f"📁 **Active Workspace:** **`{ctx['active_folder']}`** ({item_count} items)\n\n"
                    f"- **Folder Name**: `{ctx.get('folder_name', p.name)}`\n"
                    f"- **Recent Workspaces**: {', '.join([f'`{r}`' for r in ctx.get('recent_workspaces', [])[:3]])}\n\n"
                    f"*Say `change workspace to <path>` or use the workspace selector in the top bar to switch!*"
                )

            # 1. VS Code Launcher with Folder Chaining
            elif "vs code" in c_lower or "vscode" in c_lower or c_lower.startswith("code ") or c_lower == "code":
                # Check for explicit folder in the clause or in whole prompt
                extracted_folder = self.extract_windows_path(clause) or self.extract_windows_path(resolved_text)
                target_folder = extracted_folder or active_folder

                res = await pc_agent.launch_vscode(folder_path=target_folder, conv_id=conv_id)
                executed_tools.append("launch_vscode")
                if res.get("success"):
                    reply_lines.append(f"💻 {res.get('message')}")
                else:
                    reply_lines.append(f"💻 VS Code: {res.get('error', 'Execution failed')}")

            # 2. File Creation Intent ("create a new file in there", "make file test.py")
            elif any(c_lower.startswith(prefix) for prefix in ["create file", "create a file", "create new file", "create a new file", "make file", "make a file", "make a new file", "touch ", "new file "]):
                # Extract filename
                filename = self.extract_filename(clause) or self.extract_filename(resolved_text) or "untitled.txt"
                extracted_path = self.extract_windows_path(clause) or self.extract_windows_path(resolved_text)

                if extracted_path and ("\\" in extracted_path or "/" in extracted_path):
                    # Check if extracted_path is already the full file path or directory
                    if "." in Path(extracted_path).name:
                        full_file_path = extracted_path
                    else:
                        full_file_path = str(Path(extracted_path) / filename)
                else:
                    full_file_path = str(Path(active_folder) / filename)

                res = await pc_agent.create_file(file_path=full_file_path, conv_id=conv_id)
                executed_tools.append("create_file")
                if res.get("success"):
                    reply_lines.append(f"📄 {res.get('message')}")
                else:
                    reply_lines.append(f"📄 File creation: {res.get('error', 'Failed')}")

            # 3. Chrome & YouTube Intent
            elif ("youtube" in c_lower or "lo-fi" in c_lower or "chrome" in c_lower) and ("open" in c_lower or "play" in c_lower or "search" in c_lower):
                is_yt = "youtube" in c_lower or "lo-fi" in c_lower or "play" in c_lower
                res = await pc_agent.open_chrome(clause, is_youtube=is_yt)
                executed_tools.append("open_chrome")
                reply_lines.append(f"🌐 {res.get('message', res.get('error'))}")

            # 4. Spotify Launcher Intent (Explicit open/launch only; conversational song/playback requests flow to LLM)
            elif (c_lower.startswith(("open spotify", "launch spotify", "start spotify")) or
                  c_lower == "spotify" or
                  (("open" in c_lower or "launch" in c_lower) and "spotify" in c_lower and not any(k in c_lower for k in ["play", "song", "track", "artist", "playlist", "album", "music"]))):
                res = await pc_agent.launch_spotify()
                executed_tools.append("launch_spotify")
                reply_lines.append(f"🎵 {res.get('message', res.get('error'))}")

            # 5. Media Control
            elif any(k in c_lower for k in ["skip track", "skip song", "next track", "next song"]):
                res = pc_agent.control_media("next")
                executed_tools.append("control_media")
                reply_lines.append("⏭️ Skipped to next track.")

            elif any(k in c_lower for k in ["previous track", "previous song", "prev track"]):
                res = pc_agent.control_media("prev")
                executed_tools.append("control_media")
                reply_lines.append("⏮️ Returned to previous track.")

            elif any(k in c_lower for k in ["pause music", "pause track", "stop playback", "stop music"]):
                res = pc_agent.control_media("pause")
                executed_tools.append("control_media")
                reply_lines.append("⏸️ Media playback paused.")

            elif any(k in c_lower for k in ["resume music", "play music", "unpause music", "toggle music"]):
                res = pc_agent.control_media("play_pause")
                executed_tools.append("control_media")
                reply_lines.append("▶️ Media playback toggled.")

            # 6. Volume Control
            elif "volume" in c_lower and any(k in c_lower for k in ["set", "get", "mute", "unmute", "turn", "adjust", "%"]):
                if "mute" in c_lower and "unmute" not in c_lower:
                    res = pc_agent.control_volume("mute")
                    reply_lines.append("🔇 System volume muted.")
                elif "unmute" in c_lower:
                    res = pc_agent.control_volume("unmute")
                    reply_lines.append("🔊 System volume unmuted.")
                elif any(ch.isdigit() for ch in c_lower):
                    vol_num = re.search(r"\b(\d{1,3})\b", c_lower)
                    if vol_num:
                        level = max(0, min(100, int(vol_num.group(1))))
                        res = pc_agent.control_volume("set", level=level)
                        reply_lines.append(f"🔊 System volume set to **{level}%**.")
                    else:
                        res = pc_agent.control_volume("get")
                        reply_lines.append(f"🔊 System master volume is **{res.get('volume_percent')}%**.")
                else:
                    res = pc_agent.control_volume("get")
                    reply_lines.append(f"🔊 System master volume is **{res.get('volume_percent')}%** (Muted: {res.get('is_muted')}).")
                executed_tools.append("control_volume")

            # 7. Screen Snapshot & Multimodal Vision Analysis Intent
            elif any(k in c_lower for k in ["analyze screen", "look at screen", "read screen", "what's on my screen", "what is on my screen", "explain screen", "debug screen", "screen vision"]):
                res = await pc_agent.capture_screen_context(query=clause, conv_id=conv_id)
                executed_tools.append("capture_screen_context")
                if res.get("success"):
                    reply_lines.append(res.get("analysis", "Screen snapshot captured."))
                else:
                    reply_lines.append(f"Screen vision error: {res.get('error')}")

            elif "take a screenshot" in c_lower or "capture screen" in c_lower or "screenshot" in c_lower:
                res = pc_agent.capture_screen()
                executed_tools.append("capture_screen")
                if res.get("success"):
                    reply_lines.append(f"📸 Screen captured: `{res.get('file_path')}` ({res.get('width')}x{res.get('height')})")
                else:
                    reply_lines.append(f"Failed to capture screen: {res.get('error')}")

            # 8. Terminal Command Execution ("run command pytest", "terminal npm test")
            elif any(c_lower.startswith(pfx) for pfx in ["run command ", "run terminal ", "terminal ", "exec ", "execute command "]):
                pfx_len = next(len(pfx) for pfx in ["run command ", "run terminal ", "terminal ", "exec ", "execute command "] if c_lower.startswith(pfx))
                cmd_to_run = clause[pfx_len:].strip()
                res = await pc_agent.run_terminal_command(command=cmd_to_run, conv_id=conv_id)
                executed_tools.append("run_terminal_command")
                reply_lines.append(f"💻 **Terminal Output (`{cmd_to_run}`):**\n```\n{res.get('stdout') or res.get('stderr') or res.get('message')}\n```")

            # 9. Git Auto Commit ("git commit -m 'fix: ...'", "commit changes with '...'")
            elif c_lower.startswith("git commit") or "commit changes" in c_lower or "auto commit" in c_lower:
                msg_match = re.search(r"['\"]([^'\"]+)['\"]", clause)
                commit_msg = msg_match.group(1) if msg_match else "chore: updates via Duckuu autonomous agent"
                res = await pc_agent.git_auto_commit(message=commit_msg, conv_id=conv_id)
                executed_tools.append("git_auto_commit")
                reply_lines.append(f"🌿 **Git Autopilot:** {res.get('message')}")

            # 10. Delete File Intent ("delete file test.py", "remove file test.py")
            elif c_lower.startswith("delete file ") or c_lower.startswith("remove file "):
                target_f = clause.split("file", 1)[1].strip()
                res = await pc_agent.delete_file(file_path=target_f, conv_id=conv_id)
                executed_tools.append("delete_file")
                reply_lines.append(f"🗑️ {res.get('message', res.get('error'))}")

            # 11. Smart File Janitor ("clean up downloads", "organize folder", "clean up desktop")
            elif any(k in c_lower for k in ["clean up folder", "organize folder", "clean up downloads", "clean up desktop", "smart janitor", "file janitor"]):
                is_execute = "confirm" in c_lower or "execute" in c_lower or "now" in c_lower
                f_target = self.extract_windows_path(clause)
                if not f_target and "desktop" in c_lower:
                    f_target = str(Path.home() / "Desktop")
                elif not f_target:
                    f_target = str(Path.home() / "Downloads")

                res = await pc_agent.organize_folder(folder_path=f_target, preview_only=not is_execute, conv_id=conv_id)
                executed_tools.append("organize_folder")
                if res.get("preview_only"):
                    reply_lines.append(f"🧹 **Smart File Janitor Preview for `{res.get('target_folder')}`:**\n{res.get('preview')}\n\n*Say `clean up folder {res.get('target_folder')} now` to execute!*")
                else:
                    reply_lines.append(res.get("message", "Folder organized."))

            # 12. Create PDF Intent ("create pdf Report with ...", "generate pdf Notes ...")
            elif (c_lower.startswith("create pdf") or c_lower.startswith("generate pdf") or c_lower.startswith("make pdf")):
                raw_rest = clause[10:].strip()
                title_part = "Document"
                body_part = "Created by Duckuu Agent."
                if " with " in raw_rest:
                    parts = raw_rest.split(" with ", 1)
                    title_part = parts[0].strip()
                    body_part = parts[1].strip()
                elif ":" in raw_rest:
                    parts = raw_rest.split(":", 1)
                    title_part = parts[0].strip()
                    body_part = parts[1].strip()
                else:
                    title_part = raw_rest or "Document"

                res = await pc_agent.create_pdf(title=title_part, content=body_part, conv_id=conv_id)
                executed_tools.append("create_pdf")
                reply_lines.append(f"📄 {res.get('message', res.get('error'))}")

            # 13. Send WhatsApp Intent ("send whatsapp to ...", "msg whatsapp to ...")
            elif "whatsapp" in c_lower and any(k in c_lower for k in ["send", "msg", "message"]):
                # Extract recipient and message
                parts = re.split(r"whatsapp\s+(?:to\s+)?", clause, flags=re.IGNORECASE)
                if len(parts) > 1:
                    rest = parts[1].strip()
                    words = rest.split()
                    recip = words[0] if words else ""
                    msg_text = " ".join(words[1:]) if len(words) > 1 else "Hello from Duckuu!"
                    res = await pc_agent.send_whatsapp_message(phone_or_name=recip, message=msg_text, conv_id=conv_id)
                    executed_tools.append("send_whatsapp_message")
                    reply_lines.append(f"📱 {res.get('message', 'WhatsApp dispatched')}")

            # 8. Open Specific Folder Intent
            elif (c_lower.startswith("open folder") or c_lower.startswith("open directory")) and not ("vs code" in c_lower or "chrome" in c_lower):
                target_folder = self.extract_windows_path(clause) or active_folder
                res = await pc_agent.open_folder(target_folder)
                executed_tools.append("open_folder")
                reply_lines.append(f"📁 {res.get('message', res.get('error'))}")

            # 9. Generic App Launcher
            elif c_lower.startswith("open ") and not c_lower.startswith("open http") and not any(k in c_lower for k in ["folder", "file", "vs code", "chrome", "spotify"]):
                target_app = clause[5:].strip()
                if target_app:
                    res = await pc_agent.open_app(target_app)
                    executed_tools.append("open_app")
                    reply_lines.append(f"🚀 {res.get('message', res.get('error'))}")

            # Focus & Pomodoro Mode Intent
            elif any(k in c_lower for k in ["start focus", "focus mode", "start pomodoro", "pomodoro mode", "focus session"]) or (("focus" in c_lower or "pomodoro" in c_lower) and any(w in c_lower for w in ["timer", "start", "set", "lock in"])):
                num_match = re.search(r"\b(\d{1,3})\s*(?:min|minute|m)?\b", c_lower)
                duration = 25
                if num_match:
                    parsed = int(num_match.group(1))
                    if 1 <= parsed <= 180:
                        duration = parsed

                task = "Deep Focus"
                for kw in [" on ", " for "]:
                    if kw in clause:
                        candidate = clause.split(kw, 1)[1].strip()
                        if not any(candidate.lower().startswith(s) for s in ["25", "30", "45", "10", "15", "20", "50", "60", "min"]):
                            task = candidate
                            break

                status = await focus_timer.start(duration_minutes=duration, task_name=task)
                executed_tools.append("start_focus_timer")
                reply_lines.append(f"🎧 **Focus Mode Activated:** {status['task_name']} for **{duration} minutes**. Duckuu is vibing quietly to help you lock in!")

            elif any(k in c_lower for k in ["stop focus", "cancel focus", "end focus", "stop pomodoro", "cancel pomodoro"]):
                status = await focus_timer.stop()
                executed_tools.append("stop_focus_timer")
                reply_lines.append("🛑 **Focus Session Stopped:** Back to standard desk companion mode.")

            elif any(k in c_lower for k in ["pause focus", "pause pomodoro"]):
                status = await focus_timer.pause()
                executed_tools.append("pause_focus_timer")
                reply_lines.append(f"⏸️ **Focus Session Paused:** {status['minutes_left']}m remaining.")

            elif any(k in c_lower for k in ["resume focus", "resume pomodoro"]):
                status = await focus_timer.resume()
                executed_tools.append("resume_focus_timer")
                reply_lines.append(f"▶️ **Focus Session Resumed:** {status['minutes_left']}m remaining.")

            # 10. Check Deadlines
            elif any(k in c_lower for k in ["check deadline", "check deadlines", "any deadlines", "what assignments"]):
                alerts = await deadline_scheduler.check_deadlines_now()
                executed_tools.append("check_deadlines")
                if alerts:
                    lines = [f"- **{a['title']}** ({a['course_batch']}): {'⚠️ OVERDUE' if a['is_overdue'] else f'{a['hours_remaining']}h left'} ({a['pending_student_count']} pending)" for a in alerts]
                    reply_lines.append(
                        f"⏰ **Duckuu Deadline Monitor Found {len(alerts)} Urgent Assignment{'s' if len(alerts) > 1 else ''}:**\n\n"
                        + "\n".join(lines)
                        + "\n\n*Head to the **Tasks** tab or ask me to 'remind students' to dispatch WhatsApp updates!*"
                    )
                else:
                    reply_lines.append("✅ All clear! No assignments are overdue or due within the next 24 hours.")

            # 11. Remind Students
            elif any(k in c_lower for k in ["remind student", "remind students", "draft reminder", "draft reminders"]):
                drafts = await student_drafter.draft_reminders_for_batch()
                executed_tools.append("draft_reminders")
                if drafts:
                    sample = drafts[0]
                    reply_lines.append(
                        f"📝 **Drafted {len(drafts)} WhatsApp Reminders for Pending Coursework:**\n\n"
                        f"**Preview for {sample['student_name']} ({sample['course_batch']}):**\n"
                        f"> \"{sample['draft_message']}\"\n\n"
                        f"👉 *Check the **Students** tab in the sidebar to review and dispatch them with Zero-Trust protection.*"
                    )
                else:
                    reply_lines.append("🎉 Great news! All students are currently caught up on their submissions—no reminders needed.")

            # 12. Deep Research Intent
            elif c_lower.startswith("research ") or c_lower.startswith("/research ") or mode == "research":
                raw_q = clause
                if c_lower.startswith("/research "):
                    raw_q = clause[10:].strip()
                elif c_lower.startswith("research "):
                    raw_q = clause[9:].strip()

                report = await research_agent.run_research(raw_q)
                executed_tools.append("deep_research")
                bullets = "\n".join([f"- {t}" for t in report["key_takeaways"]])
                reply_lines.append(
                    f"📑 **{report['title']}** has been compiled and saved to your **Library**!\n\n"
                    f"> **Summary:** {report['summary']}\n\n"
                    f"**Key Findings & Evidence:**\n{bullets}\n\n"
                    f"*Open the **Library** tab in the sidebar to review the full verified dossier.*"
                )

        if executed_tools:
            return {
                "executed": True,
                "tools": executed_tools,
                "reply": "\n\n".join(reply_lines),
                "resolved_text": resolved_text
            }

        return None


intent_router = IntentRouter()
