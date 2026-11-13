from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from backend.app.services.workspace_context import workspace_context

router = APIRouter(tags=["Workspace"])


class SwitchWorkspaceRequest(BaseModel):
    folder_path: str = Field(..., description="Target directory path or project name to set as active workspace")
    create_if_missing: Optional[bool] = Field(default=False, description="Whether to create the folder if it does not exist")
    conversation_id: Optional[str] = None


@router.get("/workspace")
async def get_workspace_info(conversation_id: Optional[str] = None):
    ctx = workspace_context.get_context(conversation_id)
    available = workspace_context.get_available_projects()
    return {
        "active_folder": ctx["active_folder"],
        "folder_name": ctx.get("folder_name", "Workspace"),
        "recent_workspaces": ctx.get("recent_workspaces", [ctx["active_folder"]]),
        "available_projects": available,
        "active_app": ctx.get("active_app"),
        "active_file": ctx.get("active_file")
    }


@router.get("/workspace/available")
async def get_available_workspaces():
    return {
        "active_folder": workspace_context.active_folder,
        "available_projects": workspace_context.get_available_projects(),
        "recent_workspaces": workspace_context.recent_workspaces
    }


@router.post("/workspace")
async def switch_workspace(req: SwitchWorkspaceRequest):
    res = await workspace_context.set_workspace(
        folder_path=req.folder_path,
        conv_id=req.conversation_id,
        create_if_missing=bool(req.create_if_missing)
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to switch workspace"))
    return res
