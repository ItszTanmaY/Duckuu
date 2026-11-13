PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    pattern TEXT,
    allowed_always INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    item_type TEXT NOT NULL, -- 'pdf', 'research_report', 'document', 'note'
    source TEXT,
    summary TEXT NOT NULL,
    key_takeaways TEXT, -- JSON array of bullet strings
    content TEXT NOT NULL,
    metadata TEXT, -- JSON object: page_count, word_count, tables, citations
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_tasks (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    status TEXT NOT NULL, -- 'PENDING', 'SEARCHING', 'EXTRACTING', 'SYNTHESIZING', 'COMPLETED', 'FAILED'
    progress_percent INTEGER DEFAULT 0,
    current_step TEXT,
    sources TEXT, -- JSON array of {title, url, snippet}
    report_id TEXT REFERENCES library_items(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Phase 4: Student Roster, Assignment Tracker & Multi-Channel Messaging
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL, -- E.164 international format (+1234567890)
    email TEXT,
    course_batch TEXT NOT NULL,
    tags TEXT, -- JSON array of strings
    preferred_channel TEXT NOT NULL DEFAULT 'whatsapp_deeplink', -- 'whatsapp_cloud', 'whatsapp_deeplink', 'telegram', 'email'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    semester TEXT DEFAULT 'Sem 6',
    instructor TEXT,
    color TEXT DEFAULT 'amber',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subject TEXT, -- e.g. 'Deep Learning', 'NLP', 'Operating Systems'
    description TEXT NOT NULL,
    course_batch TEXT NOT NULL DEFAULT 'BTech CSE AI/ML',
    due_date TEXT NOT NULL, -- ISO 8601 timestamp
    priority TEXT NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'overdue'
    attachment_id TEXT, -- references library_items(id)
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_triage_feed (
    id TEXT PRIMARY KEY,
    raw_text TEXT NOT NULL,
    source TEXT DEFAULT 'group_chat',
    detected_subject TEXT,
    detected_title TEXT,
    detected_due_date TEXT,
    category TEXT DEFAULT 'assignment', -- 'assignment', 'exam', 'lab', 'announcement'
    urgency TEXT DEFAULT 'normal', -- 'normal', 'urgent'
    status TEXT DEFAULT 'pending', -- 'pending', 'converted', 'dismissed'
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_assignments (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    submission_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'submitted', 'graded', 'late'
    last_reminded_at TEXT,
    reminder_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(student_id, assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_approval_rules_tool ON approval_rules(tool_name);
CREATE INDEX IF NOT EXISTS idx_library_items_type ON library_items(item_type);
CREATE INDEX IF NOT EXISTS idx_library_items_created_at ON library_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_tasks_created_at ON research_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_students_batch ON students(course_batch);
CREATE INDEX IF NOT EXISTS idx_students_phone ON students(phone);
CREATE INDEX IF NOT EXISTS idx_assignments_batch ON assignments(course_batch);
CREATE INDEX IF NOT EXISTS idx_assignments_due_date ON assignments(due_date);
CREATE INDEX IF NOT EXISTS idx_student_assignments_status ON student_assignments(submission_status);
