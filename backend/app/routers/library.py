import json
from typing import Optional, Any
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from pydantic import BaseModel, Field
from backend.app.db.database import get_db
from backend.app.services.pdf_engine import pdf_engine
from backend.app.services.research_agent import research_agent
from backend.app.routers.websocket import manager

router = APIRouter(tags=["PDF, Research & Library"])


class AnalyzePdfPathRequest(BaseModel):
    file_path: Optional[str] = None
    pdf_base64: Optional[str] = None
    filename: Optional[str] = "document.pdf"


class StartResearchRequest(BaseModel):
    query: str = Field(..., min_length=2)
    max_sources: Optional[int] = 5


@router.post("/pdf/analyze")
@router.post("/pdf/summarize")
async def analyze_pdf_endpoint(
    file: Optional[UploadFile] = File(None),
    file_path: Optional[str] = Form(None),
    filename: Optional[str] = Form(None)
):
    """
    Analyzes an uploaded PDF or local file path using PyMuPDF.
    Extracts text, metadata, tables, executive summary with [Page X] citations,
    and indexes the result in the Library.
    """
    try:
        if file is not None:
            pdf_bytes = await file.read()
            doc_name = filename or file.filename or "document.pdf"
            result = await pdf_engine.analyze_pdf(pdf_bytes, filename=doc_name)
        elif file_path:
            result = await pdf_engine.analyze_pdf(file_path, filename=filename)
        else:
            raise HTTPException(status_code=400, detail="Either 'file' or 'file_path' must be provided")

        # Broadcast PDF_SUMMARY_CARD event to all connected UI clients
        await manager.broadcast({
            "type": "PDF_SUMMARY_CARD",
            "library_id": result["id"],
            "title": result["title"],
            "filename": result["filename"],
            "page_count": result["page_count"],
            "word_count": result["word_count"],
            "detected_tables_count": result["detected_tables_count"],
            "summary": result["summary"],
            "key_takeaways": result["key_takeaways"],
            "citations": result["citations"],
            "tables": result["tables"]
        })

        return {"success": True, "item": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF analysis failed: {str(e)}")


@router.get("/library")
async def list_library_items(
    query: Optional[str] = None,
    item_type: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0)
):
    """Lists saved library items (PDFs, research reports, documents) with search & type filtering."""
    conn = await get_db()
    try:
        sql = "SELECT id, title, item_type, source, summary, key_takeaways, metadata, created_at, updated_at FROM library_items WHERE 1=1"
        params: list[Any] = []

        if item_type:
            sql += " AND item_type = ?"
            params.append(item_type)

        if query:
            sql += " AND (title LIKE ? OR summary LIKE ? OR source LIKE ?)"
            wildcard = f"%{query}%"
            params.extend([wildcard, wildcard, wildcard])

        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await conn.execute(sql, tuple(params))
        rows = await cursor.fetchall()

        items = []
        for r in rows:
            items.append({
                "id": r["id"],
                "title": r["title"],
                "item_type": r["item_type"],
                "source": r["source"],
                "summary": r["summary"],
                "key_takeaways": json.loads(r["key_takeaways"]) if r["key_takeaways"] else [],
                "metadata": json.loads(r["metadata"]) if r["metadata"] else {},
                "created_at": r["created_at"],
                "updated_at": r["updated_at"]
            })

        count_cursor = await conn.execute("SELECT COUNT(*) FROM library_items")
        total = (await count_cursor.fetchone())[0]

        return {"total": total, "items": items}
    finally:
        await conn.close()


@router.get("/library/{item_id}")
async def get_library_item(item_id: str):
    """Retrieves full content and metadata for a specific library item."""
    conn = await get_db()
    try:
        cursor = await conn.execute(
            """
            SELECT id, title, item_type, source, summary, key_takeaways, content, metadata, created_at, updated_at
            FROM library_items
            WHERE id = ?
            """,
            (item_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Library item not found")

        return {
            "id": row["id"],
            "title": row["title"],
            "item_type": row["item_type"],
            "source": row["source"],
            "summary": row["summary"],
            "key_takeaways": json.loads(row["key_takeaways"]) if row["key_takeaways"] else [],
            "content": row["content"],
            "metadata": json.loads(row["metadata"]) if row["metadata"] else {},
            "created_at": row["created_at"],
            "updated_at": row["updated_at"]
        }
    finally:
        await conn.close()


@router.delete("/library/{item_id}")
async def delete_library_item(item_id: str):
    """Deletes an item from the library."""
    conn = await get_db()
    try:
        cursor = await conn.execute("DELETE FROM library_items WHERE id = ?", (item_id,))
        await conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Item not found")
        return {"success": True, "message": "Library item deleted"}
    finally:
        await conn.close()


@router.post("/research")
async def start_research_task(req: StartResearchRequest):
    """Initiates an autonomous multi-source deep research workflow with live progress streaming."""
    try:
        report = await research_agent.run_research(req.query, max_sources=req.max_sources or 5)
        return {"success": True, "report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Research task failed: {str(e)}")


@router.get("/research/{task_id}")
async def get_research_status(task_id: str):
    """Returns status and progress of a research task."""
    conn = await get_db()
    try:
        cursor = await conn.execute(
            """
            SELECT id, query, status, progress_percent, current_step, sources, report_id, created_at, updated_at
            FROM research_tasks
            WHERE id = ?
            """,
            (task_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Research task not found")

        return {
            "id": row["id"],
            "query": row["query"],
            "status": row["status"],
            "progress_percent": row["progress_percent"],
            "current_step": row["current_step"],
            "sources": json.loads(row["sources"]) if row["sources"] else [],
            "report_id": row["report_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"]
        }
    finally:
        await conn.close()
