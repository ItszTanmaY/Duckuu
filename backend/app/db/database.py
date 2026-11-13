import aiosqlite
import sqlite3
import json
from datetime import datetime, timezone
from pathlib import Path
from backend.app.core.config import settings

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


async def get_db() -> aiosqlite.Connection:
    conn = await aiosqlite.connect(settings.DATABASE_PATH)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys = ON;")
    return conn


async def init_db() -> None:
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn = await get_db()
    try:
        await conn.executescript(schema_sql)
        await conn.commit()

        # Automatic column migration on assignments if needed
        cursor = await conn.execute("PRAGMA table_info(assignments)")
        cols = [r["name"] for r in await cursor.fetchall()]
        if "subject" not in cols:
            await conn.execute("ALTER TABLE assignments ADD COLUMN subject TEXT")
        if "attachment_id" not in cols:
            await conn.execute("ALTER TABLE assignments ADD COLUMN attachment_id TEXT")
        if "notes" not in cols:
            await conn.execute("ALTER TABLE assignments ADD COLUMN notes TEXT")
        await conn.commit()

        # Seed default BTech CSE AI/ML subjects if empty
        async with conn.execute("SELECT COUNT(*) FROM subjects") as sub_cursor:
            sub_count = (await sub_cursor.fetchone())[0]
            if sub_count == 0:
                now = datetime.now(timezone.utc).isoformat()
                default_subjects = [
                    ("sub-1", "Deep Learning", "CS401", "Sem 6", "Dr. Rao", "purple"),
                    ("sub-2", "Natural Language Processing", "CS402", "Sem 6", "Dr. Sharma", "sky"),
                    ("sub-3", "Distributed Systems", "CS403", "Sem 6", "Prof. Verma", "emerald"),
                    ("sub-4", "Cloud & Edge AI", "CS404", "Sem 6", "Dr. Gupta", "amber"),
                    ("sub-5", "Reinforcement Learning", "CS405", "Sem 6", "Prof. Nair", "rose"),
                ]
                for s_id, s_name, s_code, s_sem, s_inst, s_col in default_subjects:
                    await conn.execute(
                        """
                        INSERT OR IGNORE INTO subjects (id, name, code, semester, instructor, color, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (s_id, s_name, s_code, s_sem, s_inst, s_col, now, now)
                    )
                await conn.commit()

        # Seed initial default settings if empty
        async with conn.execute("SELECT COUNT(*) FROM app_settings") as cursor:
            count = (await cursor.fetchone())[0]
            if count == 0:
                now = datetime.now(timezone.utc).isoformat()
                defaults = {
                    "llm_provider": "auto",
                    "ollama_model": settings.OLLAMA_MODEL,
                    "cloud_provider": settings.DEFAULT_CLOUD_PROVIDER,
                    "audio_enabled": "true" if settings.AUDIO_ENABLED else "false",
                    "pet_speed": str(settings.PET_SPEED),
                    "auto_dock": "true" if settings.AUTO_DOCK else "false"
                }
                for k, v in defaults.items():
                    await conn.execute(
                        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
                        (k, v, now)
                    )
                await conn.commit()
    finally:
        await conn.close()
