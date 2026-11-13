import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Message,
  ChatMode,
  WebSocketServerEvent,
  OnlineStatusBadgeEvent,
  ApprovalRequest,
  ApprovalRequiredEvent,
  TaskProgressEvent,
  PdfSummaryCardEvent,
  FocusStatus,
  WorkspaceInfo,
  RecentConversationResponse
} from '@/types/api';
import { apiFetch, getWsUrl, detectApiPort } from '@/config/api';
import { speechService } from '@/services/speechService';

export interface UseWebSocketChatReturn {
  messages: Message[];
  isStreaming: boolean;
  onlineStatus: {
    isOnline: boolean;
    provider: string;
    model: string;
  };
  pendingApprovals: ApprovalRequest[];
  activeTasks: Record<string, TaskProgressEvent>;
  submitApprovalDecision: (requestId: string, decision: 'once' | 'always' | 'deny') => void;
  sendMessage: (text: string) => void;
  uploadAndAnalyzePdf: (file: File) => Promise<{ success: boolean; item?: any; error?: string }>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  activeMode: ChatMode;
  setActiveMode: (mode: ChatMode) => void;
  focusStatus: FocusStatus | null;
  startFocus: (durationMinutes?: number, taskName?: string) => Promise<void>;
  stopFocus: () => Promise<void>;
  workspaceInfo: WorkspaceInfo | null;
  switchWorkspace: (path: string) => Promise<boolean>;
}

export function useWebSocketChat(initialConversationId?: string): UseWebSocketChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [activeTasks, setActiveTasks] = useState<Record<string, TaskProgressEvent>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(initialConversationId || null);
  const [activeMode, setActiveMode] = useState<ChatMode>('general');
  const [onlineStatus, setOnlineStatus] = useState<{ isOnline: boolean; provider: string; model: string }>({
    isOnline: false,
    provider: 'ollama',
    model: 'qwen2.5:3b'
  });
  const [focusStatus, setFocusStatus] = useState<FocusStatus | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const sentenceBufferRef = useRef<string>('');
  const streamingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedConversationIdRef = useRef<string | null>(null);

  const clearWatchdog = useCallback(() => {
    if (streamingWatchdogRef.current) {
      clearTimeout(streamingWatchdogRef.current);
      streamingWatchdogRef.current = null;
    }
  }, []);

  const startWatchdog = useCallback((timeoutMs = 18000) => {
    clearWatchdog();
    streamingWatchdogRef.current = setTimeout(() => {
      setIsStreaming((currentStreaming) => {
        if (currentStreaming) {
          // Watchdog timed out without receiving CHAT_COMPLETE. Inject failsafe fallback message to prevent hanging in Synthesizing state.
          const fallbackText = "I need an API key in Settings to answer that!";
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role === 'user') {
              return [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  conversation_id: 'default',
                  role: 'assistant',
                  content: fallbackText,
                  metadata: { provider: 'fallback', is_online: false },
                  created_at: new Date().toISOString()
                }
              ];
            } else if (last.role === 'assistant' && !last.content.trim()) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: fallbackText,
                metadata: { provider: 'fallback', is_online: false }
              };
              return updated;
            }
            return prev;
          });
          return false;
        }
        return false;
      });
    }, timeoutMs);
  }, [clearWatchdog]);

  // Fetch initial focus timer status, workspace info, and hydrate recent conversation
  useEffect(() => {
    // Instant Electron local config store pre-hydration
    if (window.duckuuApi?.getStoredConfig) {
      window.duckuuApi.getStoredConfig().then((cfg: Record<string, any>) => {
        if (cfg) {
          if (cfg.active_workspace) {
            setWorkspaceInfo((prev) => prev ? { ...prev, active_folder: cfg.active_workspace } : {
              active_folder: cfg.active_workspace,
              folder_name: cfg.active_workspace.split(/[\\/]/).pop() || 'DUCKUU',
              recent_workspaces: [cfg.active_workspace]
            });
          }
          if (cfg.llm_provider) {
            setOnlineStatus((prev) => ({
              ...prev,
              provider: cfg.llm_provider,
              model: cfg.ollama_model || prev.model
            }));
          }
        }
      }).catch(() => {});
    }

    apiFetch('/api/focus/status')
      .then((res) => {
        if (!res.ok) throw new Error('Status not ok');
        return res.json();
      })
      .then((data: FocusStatus) => setFocusStatus(data))
      .catch(() => {});

    apiFetch('/api/workspace')
      .then((res) => {
        if (!res.ok) throw new Error('Workspace not ok');
        return res.json();
      })
      .then((data: WorkspaceInfo) => setWorkspaceInfo(data))
      .catch(() => {});

    // Sovereign Context Hydration: Load most recent session from persistent SQLite store
    apiFetch('/api/conversations/recent')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RecentConversationResponse | null) => {
        if (data?.conversation) {
          loadedConversationIdRef.current = data.conversation.id;
          setActiveConversationId(data.conversation.id);
          if (data.conversation.mode) {
            setActiveMode(data.conversation.mode);
          }
          if (data.messages && data.messages.length > 0) {
            setMessages(data.messages);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Subscribe to speech synthesis events to synchronize pet animations
  useEffect(() => {
    const unsubStart = speechService.subscribeSpeechStart(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'PET_STATE_SET',
            emotion: 'happy',
            reason: 'speaking_reply',
            duration_ms: 10000
          })
        );
      }
    });

    const unsubEnd = speechService.subscribeSpeechEnd(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'PET_STATE_SET',
            emotion: 'listening',
            reason: 'finished_speech',
            duration_ms: 4000
          })
        );
      }
    });

    return () => {
      unsubStart();
      unsubEnd();
    };
  }, []);

  const connect = useCallback(async () => {
    try {
      await detectApiPort();
      const wsUrl = getWsUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Connected to Duckuu server
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketServerEvent = JSON.parse(event.data);

          if (data.type === 'ONLINE_STATUS_BADGE') {
            const badge = data as OnlineStatusBadgeEvent;
            setOnlineStatus({
              isOnline: badge.is_online,
              provider: badge.provider,
              model: badge.model
            });
          } else if (data.type === 'APPROVAL_REQUIRED') {
            const reqEvent = data as ApprovalRequiredEvent;
            const req: ApprovalRequest = {
              request_id: reqEvent.request_id,
              tool_name: reqEvent.tool_name,
              parameters: reqEvent.parameters,
              risk_level: reqEvent.risk_level,
              description: reqEvent.description,
              created_at: reqEvent.created_at || new Date().toISOString(),
              timeout_seconds: reqEvent.timeout_seconds
            };
            setPendingApprovals((prev) => {
              if (prev.some((p) => p.request_id === req.request_id)) return prev;
              return [...prev, req];
            });
          } else if (data.type === 'APPROVAL_RESOLVED') {
            const resolved = data as unknown as { request_id: string; decision: string };
            setPendingApprovals((prev) => prev.filter((p) => p.request_id !== resolved.request_id));
          } else if ((data as any).type === 'FOCUS_STATUS_UPDATE') {
            setFocusStatus((data as any).data as FocusStatus);
          } else if ((data as any).type === 'WORKSPACE_CHANGED') {
            const wsData = data as any;
            setWorkspaceInfo({
              active_folder: wsData.active_folder,
              folder_name: wsData.folder_name,
              recent_workspaces: wsData.recent_workspaces || [],
              available_projects: wsData.available_projects || []
            });
          } else if (data.type === 'TASK_PROGRESS') {
            const progress = data as TaskProgressEvent;
            setActiveTasks((prev) => ({ ...prev, [progress.task_id]: progress }));
            if (progress.progress_percent >= 100 || progress.step === 'COMPLETED') {
              setTimeout(() => {
                setActiveTasks((prev) => {
                  const copy = { ...prev };
                  delete copy[progress.task_id];
                  return copy;
                });
              }, 4000);
            }
          } else if (data.type === 'PDF_SUMMARY_CARD') {
            const pdfCard = data as PdfSummaryCardEvent;
            setMessages((prev) => {
              if (prev.some((m) => m.metadata?.type === 'pdf_summary' && (m.metadata.pdfData as any)?.library_id === pdfCard.library_id)) {
                return prev;
              }
              return [
                ...prev,
                {
                  id: 'pdf-' + pdfCard.library_id,
                  conversation_id: 'default',
                  role: 'assistant',
                  content: `📄 **${pdfCard.title}** indexed into your Library!`,
                  metadata: {
                    type: 'pdf_summary',
                    pdfData: pdfCard
                  },
                  created_at: new Date().toISOString()
                }
              ];
            });
          } else if (data.type === 'DEADLINE_ALERT') {
            const alert = data as any;
            const timeDesc = alert.is_overdue ? '⚠️ OVERDUE' : `due in ${alert.hours_remaining} hours`;
            setMessages((prev) => [
              ...prev,
              {
                id: 'deadline-' + alert.assignment_id + '-' + Date.now(),
                conversation_id: 'default',
                role: 'assistant',
                content: `⏰ **Deadline Alert:** **${alert.title}** (${alert.course_batch}) is ${timeDesc}! There ${
                  alert.pending_student_count === 1 ? 'is 1 student' : `are ${alert.pending_student_count} students`
                } with pending coursework. Ask me to "remind students" or check the **Tasks** tab to send updates.`,
                created_at: new Date().toISOString()
              }
            ]);
          } else if (data.type === 'CHAT_CHUNK') {
            setIsStreaming(true);
            startWatchdog(15000);
            if (data.delta) {
              sentenceBufferRef.current += data.delta;
              const delimiterRegex = /^([\s\S]*?[.!?\n]+(?:\s+|$))([\s\S]*)$/;
              let match = sentenceBufferRef.current.match(delimiterRegex);
              while (match) {
                const sentence = match[1].trim();
                sentenceBufferRef.current = match[2] || '';
                if (sentence.length >= 8) {
                  speechService.queueSentence(sentence);
                }
                match = sentenceBufferRef.current.match(delimiterRegex);
              }
            }
            setMessages((prev) => {
              const existingIdx = prev.findIndex((m) => m.id === data.message_id);
              if (existingIdx !== -1) {
                const updated = [...prev];
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  content: updated[existingIdx].content + data.delta
                };
                return updated;
              } else {
                return [
                  ...prev,
                  {
                    id: data.message_id,
                    conversation_id: data.conversation_id,
                    role: 'assistant',
                    content: data.delta,
                    created_at: new Date().toISOString()
                  }
                ];
              }
            });
          } else if (data.type === 'CHAT_COMPLETE') {
            setIsStreaming(false);
            clearWatchdog();
            if (sentenceBufferRef.current.trim()) {
              speechService.queueSentence(sentenceBufferRef.current.trim());
              sentenceBufferRef.current = '';
            }
            setMessages((prev) => {
              const existingIdx = prev.findIndex((m) => m.id === data.message_id);
              if (existingIdx !== -1) {
                const updated = [...prev];
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  content: data.full_content,
                  metadata: {
                    provider: data.provider,
                    is_online: data.is_online,
                    duration_ms: data.duration_ms
                  }
                };
                return updated;
              }
              return prev;
            });
          }
        } catch (err) {
          console.error('Error handling WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearWatchdog();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect, clearWatchdog]);

  // Load message history when activeConversationId changes
  useEffect(() => {
    if (!activeConversationId) return;
    if (loadedConversationIdRef.current === activeConversationId) return;
    loadedConversationIdRef.current = activeConversationId;

    apiFetch(`/api/conversations/${activeConversationId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load conversation');
        return res.json();
      })
      .then((data) => {
        if (data.messages) {
          setMessages(data.messages);
          if (data.mode) setActiveMode(data.mode);
        }
      })
      .catch((err) => console.error(err));
  }, [activeConversationId]);

  const submitApprovalDecision = useCallback(
    (requestId: string, decision: 'once' | 'always' | 'deny') => {
      // Send over WebSocket for lowest latency
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'APPROVAL_DECISION',
            request_id: requestId,
            decision
          })
        );
      }

      // Also call REST endpoint to ensure delivery
      apiFetch('/api/approval/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, decision })
      }).catch(() => {});

      // Remove from pending list after 1s
      setTimeout(() => {
        setPendingApprovals((prev) => prev.filter((p) => p.request_id !== requestId));
      }, 1000);
    },
    []
  );

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      speechService.stop();
      sentenceBufferRef.current = '';

      const convId = activeConversationId || crypto.randomUUID();
      if (!activeConversationId) {
        setActiveConversationId(convId);
      }

      const userMessage: Message = {
        id: crypto.randomUUID(),
        conversation_id: convId,
        role: 'user',
        content: trimmed,
        created_at: new Date().toISOString()
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      startWatchdog(18000);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'CHAT_MESSAGE',
            conversation_id: convId,
            message: trimmed,
            mode: activeMode
          })
        );
      } else {
        // Fallback to REST endpoint
        apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: convId,
            message: trimmed,
            mode: activeMode
          })
        })
          .then((res) => res.json())
          .then((data) => {
            clearWatchdog();
            setIsStreaming(false);
            const reply = data.content || data.full_content;
            if (reply) {
              speechService.speak(reply);
            }
            setMessages((prev) => [
              ...prev,
              {
                id: data.message_id || crypto.randomUUID(),
                conversation_id: convId,
                role: 'assistant',
                content: data.content || data.full_content || 'No response generated.',
                metadata: {
                  provider: data.provider,
                  is_online: data.is_online
                },
                created_at: new Date().toISOString()
              }
            ]);
          })
          .catch(() => {
            clearWatchdog();
            setIsStreaming(false);
          });
      }
    },
    [activeConversationId, activeMode, startWatchdog, clearWatchdog]
  );

  const uploadAndAnalyzePdf = useCallback(
    async (file: File) => {
      setIsStreaming(true);
      const convId = activeConversationId || crypto.randomUUID();
      if (!activeConversationId) {
        setActiveConversationId(convId);
      }

      // Add user message to chat stream
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          conversation_id: convId,
          role: 'user',
          content: `📄 Uploaded file for analysis: **${file.name}** (${(file.size / 1024).toFixed(1)} KB)`,
          created_at: new Date().toISOString()
        }
      ]);

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('filename', file.name);

        // Try primary /api/v1/pdf/summarize with automatic fallback to /api/pdf/analyze
        let res = await apiFetch('/api/v1/pdf/summarize', {
          method: 'POST',
          body: formData
        }).catch(() => null);

        if (!res || !res.ok) {
          res = await apiFetch('/api/pdf/analyze', {
            method: 'POST',
            body: formData
          });
        }

        if (!res.ok) {
          throw new Error(`PDF analysis failed: ${res.statusText}`);
        }

        const data = await res.json();
        if (data.item) {
          setMessages((prev) => [
            ...prev,
            {
              id: 'pdf-res-' + data.item.id,
              conversation_id: convId,
              role: 'assistant',
              content: `📄 **${data.item.title}** has been processed and indexed into your Library!`,
              metadata: {
                type: 'pdf_summary',
                pdfData: data.item
              },
              created_at: new Date().toISOString()
            }
          ]);
          return { success: true, item: data.item };
        }
        return { success: true };
      } catch (err: unknown) {
        console.error('Upload failed:', err);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            conversation_id: convId,
            role: 'assistant',
            content: `⚠️ Failed to analyze PDF: ${err instanceof Error ? err.message : String(err)}`,
            created_at: new Date().toISOString()
          }
        ]);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        setIsStreaming(false);
      }
    },
    [activeConversationId]
  );

  const startFocus = useCallback(async (durationMinutes: number = 25, taskName: string = 'Deep Focus') => {
    try {
      const res = await apiFetch('/api/focus/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_minutes: durationMinutes, task_name: taskName })
      });
      if (res.ok) {
        const data = await res.json();
        setFocusStatus(data);
      }
    } catch (err) {
      console.error('Failed to start focus session:', err);
    }
  }, []);

  const stopFocus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/focus/stop', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setFocusStatus(data);
      }
    } catch (err) {
      console.error('Failed to stop focus session:', err);
    }
  }, []);

  const switchWorkspace = useCallback(async (newPath: string): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: newPath, create_if_missing: true })
      });
      if (res.ok) {
        const data = await res.json();
        setWorkspaceInfo({
          active_folder: data.active_folder,
          folder_name: data.folder_name,
          recent_workspaces: data.recent_workspaces || [],
          available_projects: data.available_projects || []
        });
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to switch workspace:', err);
      return false;
    }
  }, []);

  return {
    messages,
    isStreaming,
    onlineStatus,
    pendingApprovals,
    activeTasks,
    submitApprovalDecision,
    sendMessage,
    uploadAndAnalyzePdf,
    setMessages,
    activeConversationId,
    setActiveConversationId,
    activeMode,
    setActiveMode,
    focusStatus,
    startFocus,
    stopFocus,
    workspaceInfo,
    switchWorkspace
  };
}
