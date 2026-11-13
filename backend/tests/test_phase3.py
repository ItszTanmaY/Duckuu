import asyncio
import io
import json
import pymupdf
from starlette.testclient import TestClient
from backend.app.main import app
from backend.app.db.database import init_db, get_db
from backend.app.services.pdf_engine import pdf_engine
from backend.app.services.research_agent import research_agent


async def test_phase3_suite():
    await init_db()
    print("\n=======================================================")
    print(">>> RUNNING PHASE 3 SUITE: PDF, RESEARCH & LIBRARY <<<")
    print("=======================================================\n")

    # [1/4] Test PDF Intelligence Engine directly
    print("[1/4] Testing PyMuPDF Intelligence Engine & [Page X] Citations...")
    doc = pymupdf.open()

    # Page 1: Overview
    p1 = doc.new_page()
    p1.insert_text((50, 72), "Duckuu Operating System Architecture Guide\n")
    p1.insert_text((50, 95), "Duckuu is a Windows-first local AI pet companion operating with zero-cloud latency.\n")
    p1.insert_text((50, 115), "It uses PyMuPDF for on-device PDF parsing and local faster-whisper dictation.\n")

    # Page 2: Zero-Trust Security & Table
    p2 = doc.new_page()
    p2.insert_text((50, 72), "Zero-Trust Security Protocols & Approval Architecture\n")
    p2.insert_text((50, 95), "Every sensitive OS execution triggers an approval gate event before unblocking.\n")
    p2.insert_text((50, 115), "Tool Name | Risk Level | Auto Allow\n")
    p2.insert_text((50, 130), "open_app  | MEDIUM     | Yes via Rule\n")
    p2.insert_text((50, 145), "delete_file| CRITICAL   | Never\n")

    pdf_bytes = doc.tobytes()

    pdf_res = await pdf_engine.analyze_pdf(pdf_bytes, filename="duckuu_spec.pdf")
    assert pdf_res["page_count"] == 2
    assert pdf_res["word_count"] > 20
    assert len(pdf_res["key_takeaways"]) > 0
    assert any("[Page" in t for t in pdf_res["key_takeaways"])
    assert len(pdf_res["citations"]) > 0
    print(f"      PDF Analyzed OK! ID: {pdf_res['id']}, Pages: {pdf_res['page_count']}, Words: {pdf_res['word_count']}")
    print(f"      Executive Summary: {pdf_res['summary'][:100]}...")
    print(f"      Takeaways: {pdf_res['key_takeaways']}")
    print(f"      Citations: {pdf_res['citations']}")

    # [2/4] Test Deep Research Agent & Progress Streaming
    print("\n[2/4] Testing Deep Research Agent & Multi-Source Synthesis...")
    emitted_steps = []
    class MockBroadcaster:
        async def broadcast(self, message: dict):
            if message.get("type") == "TASK_PROGRESS":
                emitted_steps.append(message.get("step"))

    mock_bc = MockBroadcaster()
    research_agent.register_broadcaster(mock_bc)

    report_res = await research_agent.run_research("Local AI Desktop Companions", max_sources=3)
    assert report_res["task_id"]
    assert report_res["report_id"]
    assert len(report_res["sources"]) > 0
    assert len(report_res["content"]) > 100
    assert len(emitted_steps) >= 4, f"Expected at least 4 progress steps, got {emitted_steps}"
    print(f"      Research Agent OK! Title: '{report_res['title']}'")
    print(f"      Progress steps emitted: {emitted_steps}")
    print(f"      Sources consulted: {len(report_res['sources'])}")

    # [3/4] Test REST Endpoints via TestClient
    print("\n[3/4] Testing REST Endpoints (/api/pdf/analyze, /api/library, /api/research)...")
    client = TestClient(app)

    # Test PDF Upload
    upload_file = io.BytesIO(pdf_bytes)
    resp = client.post(
        "/api/pdf/analyze",
        files={"file": ("test_doc.pdf", upload_file, "application/pdf")},
        data={"filename": "test_doc.pdf"}
    )
    assert resp.status_code == 200, f"Upload failed: {resp.text}"
    upload_data = resp.json()
    assert upload_data["success"] is True
    uploaded_item_id = upload_data["item"]["id"]
    print(f"      POST /api/pdf/analyze OK! Created item ID: {uploaded_item_id}")

    # Test Library Listing
    lib_resp = client.get("/api/library")
    assert lib_resp.status_code == 200
    lib_data = lib_resp.json()
    assert lib_data["total"] >= 2
    assert len(lib_data["items"]) >= 2
    print(f"      GET /api/library OK! Total items: {lib_data['total']}")

    # Test Library Item Detail
    detail_resp = client.get(f"/api/library/{uploaded_item_id}")
    assert detail_resp.status_code == 200
    detail_data = detail_resp.json()
    assert detail_data["id"] == uploaded_item_id
    assert "content" in detail_data
    print(f"      GET /api/library/{uploaded_item_id} OK! Title: '{detail_data['title']}'")

    # Test Research Endpoint
    r_resp = client.post("/api/research", json={"query": "Quantum Computing Basics", "max_sources": 3})
    assert r_resp.status_code == 200
    r_data = r_resp.json()
    assert r_data["success"] is True
    print(f"      POST /api/research OK! Created report: '{r_data['report']['title']}'")

    # Test Library Search Filter
    search_resp = client.get("/api/library?query=Duckuu")
    assert search_resp.status_code == 200
    search_data = search_resp.json()
    assert len(search_data["items"]) > 0
    print(f"      GET /api/library?query=Duckuu OK! Found {len(search_data['items'])} match(es)")

    # Test Delete from Library
    del_resp = client.delete(f"/api/library/{uploaded_item_id}")
    assert del_resp.status_code == 200
    print(f"      DELETE /api/library/{uploaded_item_id} OK!")

    # [4/4] Verify Database Indices and Audit Logs
    print("\n[4/4] Verifying SQLite Audit Trail for Phase 3 Actions...")
    audit_resp = client.get("/api/audit?category=PDF_ENGINE")
    assert audit_resp.status_code == 200
    pdf_audits = audit_resp.json().get("logs", [])
    assert len(pdf_audits) > 0
    print(f"      Verified {len(pdf_audits)} PDF_ENGINE audit logs recorded.")

    res_audit_resp = client.get("/api/audit?category=RESEARCH_AGENT")
    assert res_audit_resp.status_code == 200
    res_audits = res_audit_resp.json().get("logs", [])
    assert len(res_audits) > 0
    print(f"      Verified {len(res_audits)} RESEARCH_AGENT audit logs recorded.")

    print("\n=======================================================")
    print(">>> ALL PHASE 3 SUITE TESTS PASSED 100% SUCCESSFULLY! <<<")
    print("=======================================================\n")


if __name__ == "__main__":
    asyncio.run(test_phase3_suite())
