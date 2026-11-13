from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field
from backend.app.services.focus_timer import focus_timer

router = APIRouter(tags=["Focus & Pomodoro"])


class StartFocusRequest(BaseModel):
    duration_minutes: Optional[int] = Field(default=25, ge=1, le=180)
    task_name: Optional[str] = Field(default="Deep Focus")


@router.get("/focus/status")
async def get_focus_status():
    return focus_timer.get_status()


@router.post("/focus/start")
async def start_focus(req: StartFocusRequest):
    return await focus_timer.start(
        duration_minutes=req.duration_minutes or 25,
        task_name=req.task_name or "Deep Focus"
    )


@router.post("/focus/pause")
async def pause_focus():
    return await focus_timer.pause()


@router.post("/focus/resume")
async def resume_focus():
    return await focus_timer.resume()


@router.post("/focus/stop")
async def stop_focus():
    return await focus_timer.stop()
