import sys
from pathlib import Path
from contextlib import asynccontextmanager

# Ensure the project root (parent of 'backend') is on sys.path regardless of working directory
_ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from dotenv import load_dotenv
load_dotenv(_ROOT_DIR / ".env")
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.core.config import settings
from backend.app.db.database import init_db
from backend.app.db.audit import log_audit_event
from backend.app.routers.chat import router as chat_router
from backend.app.routers.system import router as system_router
from backend.app.routers.websocket import router as ws_router
from backend.app.routers.approval import router as approval_router
from backend.app.routers.agent import router as agent_router
from backend.app.routers.library import router as library_router
from backend.app.routers.students import router as students_router
from backend.app.routers.assignments import router as assignments_router, subjects_router
from backend.app.routers.focus import router as focus_router
from backend.app.routers.workspace import router as workspace_router
from backend.app.routers.voice import router as voice_router
from backend.app.services.deadline_scheduler import deadline_scheduler
from backend.app.services.config_manager import config_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize database and seed defaults
    await init_db()
    # Hydrate sovereign state & persistent configuration from SQLite into runtime
    await config_manager.load_into_runtime()
    deadline_scheduler.start()
    await log_audit_event(
        category="SYSTEM",
        action="SERVER_STARTUP",
        status="SUCCESS",
        details={"host": settings.HOST, "port": settings.PORT}
    )
    yield
    # Shutdown: cleanly stop background scheduler and record audit log
    deadline_scheduler.shutdown()
    await log_audit_event(
        category="SYSTEM",
        action="SERVER_SHUTDOWN",
        status="SUCCESS",
        details={"status": "clean_exit"}
    )


app = FastAPI(
    title="Duckuu OS Agent API",
    version="2.0.0",
    description="Local-first desktop AI companion and OS agent backend",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system_router)

# Mount all business and agent routers under root, /api, and /api/v1
for pfx in ("", "/api", "/api/v1"):
    app.include_router(voice_router, prefix=pfx)
    app.include_router(chat_router, prefix=pfx)
    app.include_router(approval_router, prefix=f"{pfx}/approval" if pfx else "/approval")
    app.include_router(agent_router, prefix=pfx)
    app.include_router(library_router, prefix=pfx)
    app.include_router(students_router, prefix=f"{pfx}/students" if pfx else "/students")
    app.include_router(assignments_router, prefix=f"{pfx}/assignments" if pfx else "/assignments")
    app.include_router(subjects_router, prefix=f"{pfx}/subjects" if pfx else "/subjects")
    app.include_router(focus_router, prefix=pfx)
    app.include_router(workspace_router, prefix=pfx)

app.include_router(ws_router)


@app.get("/")
@app.get("/health")
async def root():
    return {
        "status": "ok",
        "name": "Duckuu OS Agent API",
        "version": "2.0.0",
        "docs_url": "/docs",
        "health_url": "/health",
        "ws_url": "/ws"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=settings.PORT, reload=False)
