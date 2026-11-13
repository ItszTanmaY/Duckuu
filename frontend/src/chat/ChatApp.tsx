import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { InputBar } from './components/InputBar';
import { SettingsModal } from './components/SettingsModal';
import { ApprovalCard } from './components/ApprovalCard';
import { LibraryView } from './components/LibraryView';
import { StudyHubView } from './components/StudyHubView';
import { StudentsView } from './components/StudentsView';
import { TasksView } from './components/TasksView';
import { useWebSocketChat } from './hooks/useWebSocketChat';
import {
  Minus,
  X,
  Maximize2,
  Minimize2,
  Cpu,
  Globe,
  UploadCloud,
  ClipboardCopy,
  FolderCode,
  FolderOpen,
  Check,
  ChevronRight,
  AlertCircle,
  Shield,
  LayoutDashboard,
  Lightbulb,
  Sparkles,
  FileText
} from 'lucide-react';

export const ChatApp: React.FC = () => {
  const {
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
  } = useWebSocketChat();

  const [currentView, setCurrentView] = useState<'chat' | 'library' | 'study' | 'tasks' | 'students'>('chat');
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [clipboardSnippet, setClipboardSnippet] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [interactionMode, setInteractionMode] = useState<'dashboard' | 'stealth'>('dashboard');

  useEffect(() => {
    window.duckuuApi?.isChatMaximized?.().then((max) => setIsMaximized(Boolean(max)));
    const unsubMax = window.duckuuApi?.onMaximizeChange?.((max) => setIsMaximized(Boolean(max)));

    window.duckuuApi?.getInteractionMode?.().then((mode) => {
      if (mode) setInteractionMode(mode);
    });
    const unsubMode = window.duckuuApi?.onInteractionModeChange?.((mode) => {
      if (mode) setInteractionMode(mode);
    });

    return () => {
      unsubMax?.();
      unsubMode?.();
    };
  }, []);

  const handleMinimize = () => {
    window.duckuuApi?.minimizeChat?.();
  };

  const handleToggleMaximize = () => {
    window.duckuuApi?.maximizeChat?.();
  };

  const handleClose = () => {
    window.duckuuApi?.closeChat?.();
  };

  const toggleInteractionMode = () => {
    const next = interactionMode === 'dashboard' ? 'stealth' : 'dashboard';
    setInteractionMode(next);
    window.duckuuApi?.setInteractionMode?.(next);
  };

  // Dynamic Workspace Switcher State
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);

  const handleOpenWorkspaceModal = () => {
    setWorkspaceInput(workspaceInfo?.active_folder || '');
    setWorkspaceError(null);
    setIsWorkspaceModalOpen(true);
  };

  const handleSwitchWorkspaceSubmit = async (targetPath: string) => {
    if (!targetPath.trim()) return;
    setIsSwitchingWorkspace(true);
    setWorkspaceError(null);
    try {
      const ok = await switchWorkspace(targetPath.trim());
      if (ok) {
        setIsWorkspaceModalOpen(false);
      } else {
        setWorkspaceError('Directory does not exist or cannot be accessed.');
      }
    } catch {
      setWorkspaceError('Failed to switch workspace.');
    } finally {
      setIsSwitchingWorkspace(false);
    }
  };

  // Listen for global clipboard action (Alt+Shift+C / Ctrl+Shift+C)
  useEffect(() => {
    const unsub = window.duckuuApi?.onClipboardAction?.((data) => {
      if (data?.text) {
        setClipboardSnippet(data.text);
        setCurrentView('chat');
      }
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Global drag-and-drop interception to prevent default OS/browser navigation
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDraggingFile) {
        setIsDraggingFile(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        setIsDraggingFile(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        uploadAndAnalyzePdf(file);
        setCurrentView('chat');
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [isDraggingFile, uploadAndAnalyzePdf]);

  const handleNewChat = () => {
    setCurrentView('chat');
    setActiveConversationId(null);
    setMessages([]);
  };

  const handleOpenLibraryItem = (id: string) => {
    setSelectedLibraryId(id);
    setCurrentView('library');
  };

  return (
    <div className={`relative flex flex-col h-screen w-screen overflow-hidden acrylic-window ${isMaximized ? 'rounded-none' : 'rounded-3xl'} select-none text-neutral-100 font-sans bg-black/30 backdrop-blur-3xl border border-white/10 shadow-2xl bg-gradient-to-br from-white/5 via-transparent to-black/30`}>
      {/* Draggable Title Bar with Tactile Telemetry */}
      <header
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        className="h-10 bg-black/20 backdrop-blur-xl border-b border-white/10 px-4 flex items-center justify-between shrink-0 z-20 bg-gradient-to-r from-white/5 to-transparent"
      >
        <div className="flex items-center gap-2.5">
          <img src="/assets/duck-avatar.svg" alt="Duckuu" className="w-5 h-5 object-contain" />
          <span className="font-sans text-xs font-bold text-amber-300 tracking-wider font-mono-telemetry">
            DUCKUU
          </span>

          {/* Telemetry badge */}
          <div
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono-telemetry font-bold border ${
              onlineStatus.isOnline
                ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            }`}
          >
            {onlineStatus.isOnline ? (
              <Globe className="w-2.5 h-2.5" />
            ) : (
              <Cpu className="w-2.5 h-2.5" />
            )}
            <span className="uppercase">{onlineStatus.provider}</span>
            <span className="text-white/40">({onlineStatus.model})</span>
          </div>

          {/* Antigravity-style Dynamic Workspace Pill */}
          <button
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={handleOpenWorkspaceModal}
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono-telemetry font-bold border bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/35 transition-all spring-pill max-w-[130px] cursor-pointer"
            title={`Active Workspace: ${workspaceInfo?.active_folder || 'F:\\DUCKUU'}\nClick to switch workspace`}
          >
            <FolderCode className="w-2.5 h-2.5 text-amber-400 shrink-0" />
            <span className="truncate">{workspaceInfo?.folder_name || 'DUCKUU'}</span>
          </button>
        </div>

        {/* Window action buttons (Mode Toggle, Minimize, Maximize/Restore, Close) */}
        <div
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1"
        >
          {/* Mode Switcher Pill */}
          <button
            onClick={toggleInteractionMode}
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono-telemetry font-bold border transition-all spring-pill cursor-pointer mr-1 ${
              interactionMode === 'stealth'
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30'
                : 'bg-white/5 text-neutral-300 border-white/10 hover:bg-white/15'
            }`}
            title={interactionMode === 'stealth' ? 'Stealth Mode Active (Click to switch to Dashboard)' : 'Dashboard Mode Active (Click to switch to Stealth Notch)'}
          >
            {interactionMode === 'stealth' ? (
              <Shield className="w-3 h-3 text-purple-300" />
            ) : (
              <LayoutDashboard className="w-3 h-3 text-amber-400" />
            )}
            <span>{interactionMode === 'stealth' ? 'STEALTH' : 'DASHBOARD'}</span>
          </button>

          {/* Minimize */}
          <button
            onClick={handleMinimize}
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-colors spring-pill cursor-pointer"
            title="Minimize Dashboard"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          {/* Maximize / Restore */}
          <button
            onClick={handleToggleMaximize}
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-colors spring-pill cursor-pointer"
            title={isMaximized ? "Restore Window" : "Maximize to Full Screen"}
          >
            {isMaximized ? (
              <Minimize2 className="w-3.5 h-3.5 text-amber-300" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Close */}
          <button
            onClick={handleClose}
            className="p-1.5 rounded-md text-neutral-400 hover:text-rose-400 hover:bg-rose-500/15 transition-colors spring-pill cursor-pointer"
            title="Close Dashboard"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar */}
        <Sidebar
          activeMode={activeMode}
          onSelectMode={(mode) => {
            setActiveMode(mode);
            setCurrentView('chat');
          }}
          activeConversationId={activeConversationId}
          onSelectConversation={(id) => {
            setActiveConversationId(id);
            setCurrentView('chat');
          }}
          onNewChat={handleNewChat}
          onOpenSettings={() => setIsSettingsOpen(true)}
          currentView={currentView}
          onSelectView={setCurrentView}
          focusStatus={focusStatus}
          onToggleFocus={() => {
            if (focusStatus?.is_active) {
              stopFocus();
            } else {
              startFocus(25, 'Deep Work');
            }
          }}
        />

        {/* Main View Area: Chat, Library, Study Hub, Students, or Tasks */}
        {currentView === 'library' ? (
          <LibraryView
            onBackToChat={() => setCurrentView('chat')}
            onAskAboutItem={sendMessage}
            initialSelectedId={selectedLibraryId}
          />
        ) : currentView === 'study' ? (
          <StudyHubView
            onBackToChat={() => setCurrentView('chat')}
            onAskAboutAssignment={sendMessage}
            onUploadFile={uploadAndAnalyzePdf}
          />
        ) : currentView === 'students' ? (
          <StudentsView
            onBackToChat={() => setCurrentView('chat')}
            onSendChatMessage={sendMessage}
          />
        ) : currentView === 'tasks' ? (
          <TasksView
            onBackToChat={() => setCurrentView('chat')}
            onSendChatMessage={sendMessage}
          />
        ) : (
          <main className="flex-1 flex flex-col overflow-hidden bg-[#121110]/50">
            {/* Active Zero-Trust Approval Cards (if any pending) */}
            {pendingApprovals.length > 0 && (
              <div className="p-3 bg-amber-500/10 border-b border-amber-500/30 space-y-2 max-h-48 overflow-y-auto shrink-0">
                {pendingApprovals.map((req) => (
                  <ApprovalCard
                    key={req.request_id}
                    request={req}
                    onDecide={submitApprovalDecision}
                  />
                ))}
              </div>
            )}

            {/* Smart Clipboard Quick-Action Card */}
            {clipboardSnippet && (
              <div className="mx-3 mt-2 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 backdrop-blur-md shadow-lg shrink-0">
                <div className="flex items-center justify-between text-[11px] text-amber-300 font-mono-telemetry mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <ClipboardCopy className="w-3.5 h-3.5 text-amber-400" />
                    <span>SMART CLIPBOARD CAPTURED</span>
                  </div>
                  <button
                    onClick={() => setClipboardSnippet(null)}
                    className="p-1 text-neutral-400 hover:text-white rounded hover:bg-white/10"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[11px] text-neutral-200 line-clamp-2 font-mono bg-black/50 p-2 rounded-lg border border-white/5 mb-2 select-text">
                  "{clipboardSnippet}"
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      sendMessage(`Explain this clearly:\n\n${clipboardSnippet}`);
                      setClipboardSnippet(null);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 text-amber-300 border border-amber-500/50 text-[11px] font-medium spring-pill transition-all"
                  >
                    <Lightbulb className="w-3 h-3 text-amber-400" />
                    <span>Explain</span>
                  </button>
                  <button
                    onClick={() => {
                      sendMessage(`Refactor and improve this code/text:\n\n${clipboardSnippet}`);
                      setClipboardSnippet(null);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/25 hover:bg-purple-500/40 text-purple-300 border border-purple-500/50 text-[11px] font-medium spring-pill transition-all"
                  >
                    <Sparkles className="w-3 h-3 text-purple-400" />
                    <span>Refactor</span>
                  </button>
                  <button
                    onClick={() => {
                      sendMessage(`Summarize this into key bullet points:\n\n${clipboardSnippet}`);
                      setClipboardSnippet(null);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/25 hover:bg-sky-500/40 text-sky-300 border border-sky-500/50 text-[11px] font-medium spring-pill transition-all"
                  >
                    <FileText className="w-3 h-3 text-sky-400" />
                    <span>Summarize</span>
                  </button>
                </div>
              </div>
            )}

            <MessageList
              messages={messages}
              isStreaming={isStreaming}
              onQuickAction={sendMessage}
              onOpenLibrary={handleOpenLibraryItem}
              onOpenSettings={() => setIsSettingsOpen(true)}
              activeTasks={activeTasks}
            />

            <InputBar
              onSendMessage={sendMessage}
              onUploadFile={uploadAndAnalyzePdf}
              disabled={isStreaming}
            />
          </main>
        )}
      </div>

      {/* Full-Screen Glassmorphic Drag-and-Drop Overlay */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-xl border-4 border-dashed border-amber-400/80 rounded-3xl pointer-events-none p-6 text-center animate-in fade-in zoom-in-95 duration-200">
          <div className="w-20 h-20 rounded-3xl bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center shadow-2xl shadow-amber-500/30">
            <img src="/assets/duck-avatar.svg" alt="Duckuu" className="w-12 h-12 object-contain" />
          </div>
          <h3 className="text-base font-headline-md font-bold text-amber-300 mt-4 flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-amber-400" />
            <span>Drop to Summarize & Index into Library</span>
          </h3>
          <p className="text-xs font-mono-telemetry text-neutral-300 max-w-sm mt-1 leading-relaxed">
            Local PyMuPDF extracts executive summary, tables, and exact [Page X] citations directly into Duckuu Library.
          </p>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Antigravity-Style Dynamic Workspace Modal */}
      {isWorkspaceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-[#141210]/95 border border-white/15 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-amber-400" />
                <h3 className="font-headline-md text-sm font-bold text-white tracking-wide">
                  Active Workspace
                </h3>
              </div>
              <button
                onClick={() => setIsWorkspaceModalOpen(false)}
                className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-neutral-300 font-body-sm leading-relaxed">
              Duckuu targets this folder for all file creation, terminal execution, and VS Code commands.
            </p>

            {/* Current Active Path Display */}
            <div className="p-2.5 rounded-xl bg-black/50 border border-white/10 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-mono-telemetry uppercase text-neutral-500 font-semibold">
                  CURRENT FOLDER
                </div>
                <div className="text-xs font-mono text-amber-300 truncate" title={workspaceInfo?.active_folder}>
                  {workspaceInfo?.active_folder || 'F:\\DUCKUU'}
                </div>
              </div>
              <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                ACTIVE
              </span>
            </div>

            {/* Switch Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSwitchWorkspaceSubmit(workspaceInput);
              }}
              className="space-y-2"
            >
              <label className="text-[11px] font-mono-telemetry font-bold text-neutral-400 uppercase tracking-wider block">
                Switch or Set Directory Path:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workspaceInput}
                  onChange={(e) => setWorkspaceInput(e.target.value)}
                  placeholder="e.g. C:\Users\admin\Projects\MyProject"
                  className="flex-1 bg-[#1A1816] px-3 py-2 rounded-xl text-xs text-neutral-200 placeholder-neutral-500 border border-white/15 focus:outline-none focus:border-amber-500/60 font-mono"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isSwitchingWorkspace || !workspaceInput.trim()}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-mono-telemetry font-bold text-xs spring-pill transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
                >
                  {isSwitchingWorkspace ? 'Switching...' : 'Switch'}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>

            {workspaceError && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-mono">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{workspaceError}</span>
              </div>
            )}

            {/* Antigravity-Style Available Projects (1-Click Workspace Switch) */}
            {workspaceInfo?.available_projects && workspaceInfo.available_projects.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[10px] font-mono-telemetry uppercase text-neutral-400 font-bold tracking-wider flex items-center justify-between">
                  <span>DETECTED WORKSPACE PROJECTS ({workspaceInfo.available_projects.length}):</span>
                  <span className="text-[9px] text-amber-400">1-CLICK SWITCH</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {workspaceInfo.available_projects.map((proj) => {
                    const isActive = proj.is_active || workspaceInfo.active_folder === proj.path;
                    return (
                      <button
                        key={proj.path}
                        type="button"
                        onClick={() => handleSwitchWorkspaceSubmit(proj.path)}
                        className={`flex items-center gap-2 p-2 rounded-xl text-left text-xs font-mono transition-all spring-pill ${
                          isActive
                            ? 'bg-amber-500/20 text-amber-200 border border-amber-500/50 shadow-sm'
                            : 'bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/5 hover:border-amber-500/30'
                        }`}
                        title={proj.path}
                      >
                        <FolderCode className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-amber-400' : 'text-neutral-400'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-bold text-[11px]">{proj.name}</div>
                          <div className="truncate text-[9px] text-neutral-500">{proj.path}</div>
                        </div>
                        {isActive && (
                          <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 ml-1" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recent Workspaces List */}
            {workspaceInfo?.recent_workspaces && workspaceInfo.recent_workspaces.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[10px] font-mono-telemetry uppercase text-neutral-500 font-semibold tracking-wider">
                  RECENT WORKSPACES:
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {workspaceInfo.recent_workspaces.map((path) => (
                    <button
                      key={path}
                      onClick={() => handleSwitchWorkspaceSubmit(path)}
                      className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs font-mono transition-all spring-pill ${
                        workspaceInfo.active_folder === path
                          ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                          : 'bg-white/5 hover:bg-white/10 text-neutral-300 border border-transparent'
                      }`}
                    >
                      <span className="truncate flex-1">{path}</span>
                      {workspaceInfo.active_folder === path && (
                        <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-white/10 flex justify-end">
              <button
                type="button"
                onClick={() => setIsWorkspaceModalOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 text-xs font-mono-telemetry transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
