@echo off
echo ==========================================
echo Starting Duckuu Python Agent Server...
echo ==========================================
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765 --no-access-log
pause
