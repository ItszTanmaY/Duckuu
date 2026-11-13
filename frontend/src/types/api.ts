/**
 * Duckuu Core Shared TypeScript Types (Phase 1 & Phase 2)
 * Generated and validated strictly against contracts/openapi.yaml and contracts/events.json
 */

export type PetEmotion =
  | 'idle'
  | 'blinking'
  | 'walking'
  | 'sitting'
  | 'roaming'
  | 'sleeping'
  | 'waking'
  | 'happy'
  | 'annoyed'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'done'
  | 'confused'
  | 'vibing'
  | 'speaking'
  | 'sad'
  | 'surprised';

export type ChatMode = 'general' | 'research' | 'student' | 'files';

export interface FocusStatus {
  is_active: boolean;
  is_paused: boolean;
  task_name: string;
  duration_seconds: number;
  remaining_seconds: number;
  minutes_left: number;
  status: 'idle' | 'running' | 'paused';
}

export interface WorkspaceProject {
  name: string;
  path: string;
  is_active: boolean;
}

export interface WorkspaceInfo {
  active_folder: string;
  folder_name: string;
  recent_workspaces: string[];
  available_projects?: WorkspaceProject[];
  active_app?: string;
  active_file?: string;
}

export interface RecentConversationResponse {
  conversation: Conversation | null;
  messages: Message[];
}

export interface WorkspaceChangedEvent {
  type: 'WORKSPACE_CHANGED';
  active_folder: string;
  folder_name: string;
  recent_workspaces: string[];
}

export type LLMProvider = 'auto' | 'ollama' | 'groq' | 'gemini' | 'openai' | 'fallback';

export interface LLMRouterStatus {
  active_provider: LLMProvider;
  model: string;
  is_online: boolean;
  available_local_models: string[];
}

export interface HealthResponse {
  status: string;
  database: string;
  llm_router: LLMRouterStatus;
  version: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  mode: ChatMode;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface CreateConversationRequest {
  title: string;
  mode?: ChatMode;
}

export interface ChatMessageRequest {
  conversation_id: string;
  message: string;
  mode?: ChatMode;
}

export interface ChatMessageResponse {
  conversation_id: string;
  message_id: string;
  role: 'assistant';
  content: string;
  provider: string;
  is_online: boolean;
}

export interface AppSettings {
  llm_provider: 'auto' | 'ollama' | 'groq' | 'gemini' | 'openai';
  ollama_model: string;
  cloud_provider: 'groq' | 'gemini' | 'openai';
  groq_api_key_configured: boolean;
  gemini_api_key_configured: boolean;
  openai_api_key_configured: boolean;
  elevenlabs_api_key_configured?: boolean;
  elevenlabs_voice_id?: string;
  audio_enabled: boolean;
  pet_speed: number;
  auto_dock: boolean;
  active_workspace?: string;
}

export interface UpdateSettingsRequest {
  llm_provider?: 'auto' | 'ollama' | 'groq' | 'gemini' | 'openai';
  ollama_model?: string;
  cloud_provider?: 'groq' | 'gemini' | 'openai';
  groq_api_key?: string;
  gemini_api_key?: string;
  openai_api_key?: string;
  elevenlabs_api_key?: string;
  elevenlabs_voice_id?: string;
  audio_enabled?: boolean;
  pet_speed?: number;
  auto_dock?: boolean;
}

export interface AuditLogItem {
  id: number;
  timestamp: string;
  category: string;
  action: string;
  status: 'SUCCESS' | 'WARNING' | 'DENIED' | 'FAILED' | 'BLOCKED';
  details: Record<string, unknown>;
}

export interface AuditLogsResponse {
  total: number;
  logs: AuditLogItem[];
}

export interface PetState {
  emotion: PetEmotion;
  activity: string;
  energy: number;
  is_grounded: boolean;
  x: number;
  y: number;
}

export interface SetPetStateRequest {
  emotion: PetEmotion;
  activity?: string;
  energy?: number;
}

export interface StandardResponse {
  success: boolean;
  message: string;
}

// Phase 2: Zero-Trust Approval Gate
export interface ApprovalRequest {
  request_id: string;
  tool_name: string;
  parameters: Record<string, unknown>;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  created_at: string;
  timeout_seconds: number;
}

export interface ApprovalDecisionRequest {
  request_id: string;
  decision: 'once' | 'always' | 'deny';
}

export interface ApprovalRule {
  id: number;
  tool_name: string;
  pattern: string;
  allowed_always: boolean;
  created_at: string;
}

// Phase 2: PC Agent Tools
export interface AgentToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requires_approval: boolean;
}

export interface ExecuteToolRequest {
  tool_name: string;
  parameters: Record<string, unknown>;
}

export interface ExecuteToolResponse {
  success: boolean;
  tool_name: string;
  result: Record<string, unknown>;
  error?: string;
}

export interface ActiveWindowInfo {
  title: string;
  process_name?: string;
  is_valid: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  titlebar_y: number;
}

// Phase 2: Voice Dictation
export interface DictationRequest {
  audio_base64: string;
  clean_with_llm?: boolean;
}

export interface DictationResponse {
  raw_text: string;
  clean_text: string;
  duration_ms: number;
}

// WebSocket Event Types
export interface ChatChunkEvent {
  type: 'CHAT_CHUNK';
  conversation_id: string;
  message_id: string;
  delta: string;
  index: number;
}

export interface ChatCompleteEvent {
  type: 'CHAT_COMPLETE';
  conversation_id: string;
  message_id: string;
  full_content: string;
  provider: string;
  is_online: boolean;
  duration_ms: number;
}

export interface PetStateChangeEvent {
  type: 'PET_STATE_CHANGE';
  emotion: PetEmotion;
  reason?: string;
  duration_ms?: number;
}

export interface OnlineStatusBadgeEvent {
  type: 'ONLINE_STATUS_BADGE';
  is_online: boolean;
  provider: string;
  model: string;
}

export interface ApprovalRequiredEvent {
  type: 'APPROVAL_REQUIRED';
  request_id: string;
  tool_name: string;
  parameters: Record<string, unknown>;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  timeout_seconds: number;
  created_at?: string;
}

export interface ToolExecutionEvent {
  type: 'TOOL_EXECUTION';
  tool_name: string;
  status: 'STARTING' | 'BLOCKED_ON_APPROVAL' | 'RUNNING' | 'COMPLETED' | 'DENIED' | 'FAILED';
  result?: Record<string, unknown>;
  error?: string;
}

export interface ClientChatMessageEvent {
  type: 'CHAT_MESSAGE';
  conversation_id: string;
  message: string;
  mode?: ChatMode;
}

export interface ClientPetInteractionEvent {
  type: 'PET_INTERACTION';
  interaction: 'click' | 'pet' | 'drag_start' | 'drag_end' | 'scold_rapid_clicks' | 'shake';
  intensity?: number;
}

export interface ClientApprovalDecisionEvent {
  type: 'APPROVAL_DECISION';
  request_id: string;
  decision: 'once' | 'always' | 'deny';
}

export interface ErrorEvent {
  type: 'ERROR';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PingEvent {
  type: 'PING';
  timestamp: number;
}

export interface PongEvent {
  type: 'PONG';
  timestamp: number;
}

// Phase 3: PDF Intelligence, Library & Deep Research
export interface LibraryItem {
  id: string;
  title: string;
  item_type: 'pdf' | 'research_report' | 'document' | 'note';
  source?: string;
  summary: string;
  key_takeaways: string[];
  content?: string;
  metadata?: {
    page_count?: number;
    word_count?: number;
    detected_tables_count?: number;
    tables?: Array<{ page: number; table_index: number; headers: string[]; rows_count: number; sample_rows: string[][] }>;
    citations?: string[];
    filename?: string;
    sources?: Array<{ title: string; url: string; snippet?: string }>;
    task_id?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface TaskProgressEvent {
  type: 'TASK_PROGRESS';
  task_id: string;
  step: string;
  progress_percent: number;
  details: string;
  sources?: Array<{ title: string; url: string; snippet?: string }>;
}

export interface PdfSummaryCardEvent {
  type: 'PDF_SUMMARY_CARD';
  library_id: string;
  title: string;
  filename?: string;
  page_count: number;
  word_count?: number;
  detected_tables_count?: number;
  summary: string;
  key_takeaways: string[];
  citations: string[];
  tables?: Array<{ page: number; table_index: number; headers: string[]; rows_count: number; sample_rows: string[][] }>;
}

export interface SpeechPillEvent {
  type: 'SPEECH_PILL';
  text: string;
  duration_ms?: number;
  level?: 'info' | 'success' | 'working' | 'dictating';
}

export interface Student {
  id: string;
  name: string;
  phone: string;
  email?: string;
  course_batch: string;
  tags: string[];
  preferred_channel: string;
  pending_assignments?: number;
  total_assignments?: number;
  created_at: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  semester?: string;
  instructor?: string;
  color: string;
}

export interface Assignment {
  id: string;
  title: string;
  subject?: string;
  description: string;
  course_batch?: string;
  due_date: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  attachment_id?: string;
  attachment_title?: string;
  attachment_filename?: string;
  attachment_summary?: string;
  notes?: string;
  total_students?: number;
  pending_count?: number;
  submitted_count?: number;
  created_at: string;
}

export interface TriageItem {
  id: string;
  raw_text: string;
  source: string;
  detected_subject?: string;
  detected_title?: string;
  detected_due_date?: string;
  category: string;
  urgency: 'normal' | 'urgent';
  status: 'pending' | 'converted' | 'dismissed';
  created_at: string;
}

export interface StudentTriageAlertEvent {
  type: 'STUDENT_TRIAGE_ALERT';
  item: TriageItem;
}

export interface StudentAssignment {
  student_id: string;
  student_name: string;
  phone: string;
  email?: string;
  course_batch: string;
  mapping_id: string;
  submission_status: 'pending' | 'submitted' | 'graded' | 'late';
  last_reminded_at?: string;
  reminder_count: number;
}

export interface DraftReminderItem {
  student_id: string;
  student_name: string;
  phone: string;
  course_batch: string;
  preferred_channel: string;
  pending_count: number;
  pending_assignments: Array<{
    id: string;
    title: string;
    due_date: string;
    priority: string;
    reminder_count: number;
  }>;
  draft_message: string;
  status: 'ready_to_send' | 'sending' | 'sent' | 'failed';
}

export interface DeadlineAlertEvent {
  type: 'DEADLINE_ALERT';
  assignment_id: string;
  title: string;
  course_batch: string;
  due_date: string;
  priority?: string;
  is_overdue: boolean;
  hours_remaining: number;
  pending_student_count: number;
  pending_students: Array<{ id: string; name: string; phone: string; reminders: number }>;
  timestamp: string;
}

export interface ApprovalResolvedEvent {
  type: 'APPROVAL_RESOLVED';
  request_id: string;
  decision: string;
}

export type WebSocketServerEvent =
  | ChatChunkEvent
  | ChatCompleteEvent
  | PetStateChangeEvent
  | OnlineStatusBadgeEvent
  | ApprovalRequiredEvent
  | ApprovalResolvedEvent
  | ToolExecutionEvent
  | TaskProgressEvent
  | PdfSummaryCardEvent
  | SpeechPillEvent
  | DeadlineAlertEvent
  | StudentTriageAlertEvent
  | ErrorEvent
  | PongEvent;

export type WebSocketClientEvent =
  | ClientChatMessageEvent
  | ClientPetInteractionEvent
  | ClientApprovalDecisionEvent
  | PingEvent;
