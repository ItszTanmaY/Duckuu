import asyncio
import time
from typing import Optional, Any


class FocusTimerService:
    def __init__(self):
        self.is_active: bool = False
        self.is_paused: bool = False
        self.task_name: str = "Deep Focus"
        self.duration_seconds: int = 25 * 60
        self.remaining_seconds: int = 25 * 60
        self.started_at: Optional[float] = None
        self._timer_task: Optional[asyncio.Task] = None
        self._broadcaster: Optional[Any] = None

    def register_broadcaster(self, broadcaster: Any):
        self._broadcaster = broadcaster

    async def _broadcast(self, message: dict):
        if self._broadcaster:
            try:
                await self._broadcaster.broadcast(message)
            except Exception as e:
                print(f"[FocusTimer] Broadcast error: {e}")

    def get_status(self) -> dict:
        return {
            "is_active": self.is_active,
            "is_paused": self.is_paused,
            "task_name": self.task_name,
            "duration_seconds": self.duration_seconds,
            "remaining_seconds": self.remaining_seconds,
            "minutes_left": round(self.remaining_seconds / 60, 1),
            "status": "paused" if self.is_paused else ("running" if self.is_active else "idle")
        }

    async def start(self, duration_minutes: int = 25, task_name: str = "Deep Focus") -> dict:
        if self._timer_task and not self._timer_task.done():
            self._timer_task.cancel()

        self.duration_seconds = max(1, duration_minutes) * 60
        self.remaining_seconds = self.duration_seconds
        self.task_name = task_name.strip() or "Deep Focus"
        self.is_active = True
        self.is_paused = False
        self.started_at = time.time()

        # Set pet to vibing during focus
        await self._broadcast({
            "type": "PET_STATE_CHANGE",
            "emotion": "vibing",
            "duration_ms": self.duration_seconds * 1000
        })
        await self._broadcast({
            "type": "SPEECH_PILL",
            "text": f"🎧 Focus mode started: {self.task_name} ({duration_minutes}m)",
            "level": "info",
            "duration_ms": 3000
        })
        await self._broadcast({
            "type": "FOCUS_STATUS_UPDATE",
            "data": self.get_status()
        })

        self._timer_task = asyncio.create_task(self._run_loop())
        return self.get_status()

    async def pause(self) -> dict:
        if self.is_active and not self.is_paused:
            self.is_paused = True
            await self._broadcast({
                "type": "SPEECH_PILL",
                "text": "⏸️ Focus session paused",
                "level": "info",
                "duration_ms": 2000
            })
            await self._broadcast({
                "type": "FOCUS_STATUS_UPDATE",
                "data": self.get_status()
            })
        return self.get_status()

    async def resume(self) -> dict:
        if self.is_active and self.is_paused:
            self.is_paused = False
            await self._broadcast({
                "type": "SPEECH_PILL",
                "text": "▶️ Focus session resumed",
                "level": "info",
                "duration_ms": 2000
            })
            await self._broadcast({
                "type": "FOCUS_STATUS_UPDATE",
                "data": self.get_status()
            })
        return self.get_status()

    async def stop(self) -> dict:
        if self._timer_task and not self._timer_task.done():
            self._timer_task.cancel()
        self.is_active = False
        self.is_paused = False
        self.remaining_seconds = self.duration_seconds

        await self._broadcast({
            "type": "PET_STATE_CHANGE",
            "emotion": "idle",
            "duration_ms": 1000
        })
        await self._broadcast({
            "type": "SPEECH_PILL",
            "text": "🛑 Focus session stopped",
            "level": "info",
            "duration_ms": 2000
        })
        await self._broadcast({
            "type": "FOCUS_STATUS_UPDATE",
            "data": self.get_status()
        })
        return self.get_status()

    async def _run_loop(self):
        try:
            while self.remaining_seconds > 0:
                await asyncio.sleep(1)
                if not self.is_paused:
                    self.remaining_seconds -= 1
                    if self.remaining_seconds % 30 == 0:
                        await self._broadcast({
                            "type": "FOCUS_STATUS_UPDATE",
                            "data": self.get_status()
                        })

            self.is_active = False
            self.is_paused = False
            await self._broadcast({
                "type": "PET_STATE_CHANGE",
                "emotion": "happy",
                "duration_ms": 5000
            })
            await self._broadcast({
                "type": "SPEECH_PILL",
                "text": f"🎉 Great job! Focus session for '{self.task_name}' completed!",
                "level": "success",
                "duration_ms": 5000
            })
            await self._broadcast({
                "type": "FOCUS_STATUS_UPDATE",
                "data": self.get_status()
            })
        except asyncio.CancelledError:
            pass


focus_timer = FocusTimerService()
