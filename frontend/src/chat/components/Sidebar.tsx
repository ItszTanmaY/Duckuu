import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Search,
  Sparkles,
  BookOpen,
  GraduationCap,
  FolderCode,
  Trash2,
  Settings as SettingsIcon,
  Library,
  Timer
} from 'lucide-react';
import { ChatMode, Conversation, FocusStatus } from '@/types/api';
import { apiFetch } from '@/config/api';

interface SidebarProps {
  activeMode: ChatMode;
  onSelectMode: (mode: ChatMode) => void;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  currentView?: 'chat' | 'library' | 'study' | 'tasks' | 'students';
  onSelectView?: (view: 'chat' | 'library' | 'study' | 'tasks' | 'students') => void;
  focusStatus?: FocusStatus | null;
  onToggleFocus?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeMode,
  onSelectMode,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onOpenSettings,
  currentView = 'chat',
  onSelectView,
  focusStatus,
  onToggleFocus
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchConversations = useCallback(() => {
    apiFetch('/api/conversations')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then((data: Conversation[]) => setConversations(data))
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 8000);
    return () => clearInterval(interval);
  }, [fetchConversations, activeConversationId]);

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/conversations/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversationId === id) {
          onNewChat();
        }
      }
    } catch (err) {
      console.error('Failed to delete conversation', err);
    }
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const modes: { id: ChatMode; label: string; icon: React.ReactNode; color: string }[] = [
    { id: 'general', label: 'General', icon: <Sparkles className="w-3.5 h-3.5" />, color: 'text-amber-400' },
    { id: 'research', label: 'Research', icon: <BookOpen className="w-3.5 h-3.5" />, color: 'text-sky-400' },
    { id: 'student', label: 'Student', icon: <GraduationCap className="w-3.5 h-3.5" />, color: 'text-purple-400' },
    { id: 'files', label: 'Files', icon: <FolderCode className="w-3.5 h-3.5" />, color: 'text-emerald-400' }
  ];

  return (
    <aside className="w-52 bg-black/25 backdrop-blur-2xl border-r border-white/10 flex flex-col h-full text-xs select-none bg-gradient-to-b from-white/5 via-transparent to-black/20">
      {/* Top action: New Chat with Editorial Stamp */}
      <div className="p-3 border-b border-white/10">
        <button
          onClick={() => {
            onSelectView?.('chat');
            onNewChat();
          }}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/35 transition-all font-mono-telemetry font-bold text-xs spring-pill active:scale-[0.98] shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>NEW CHAT</span>
        </button>
      </div>

      {/* Mode Selector */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="text-[10px] font-mono-telemetry font-bold uppercase tracking-wider text-neutral-400 px-1 flex items-center justify-between">
          <span>[ MODES ]</span>
          <span className="text-amber-500 font-bold">04</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelectMode(m.id)}
              className={`spring-pill flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                activeMode === m.id
                  ? 'bg-amber-500/20 text-white shadow-md border border-amber-500/40'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              <span className={m.color}>{m.icon}</span>
              <span className="truncate">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search Input */}
      <div className="p-2.5 border-b border-white/10">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-neutral-500" />
          <input
            type="text"
            placeholder="Search recents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#181716] pl-8 pr-2.5 py-1.5 rounded-lg text-xs text-neutral-200 placeholder-neutral-500 border border-white/10 focus:outline-none focus:border-amber-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Recents History List */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
        <div className="text-[10px] font-mono-telemetry font-bold uppercase tracking-wider text-neutral-400 px-1 py-1">
          [ RECENTS ]
        </div>
        {filteredConversations.length === 0 ? (
          <div className="text-neutral-500 text-[11px] px-2 py-4 text-center italic font-mono-telemetry">
            no recents yet
          </div>
        ) : (
          filteredConversations.map((c) => (
            <div
              key={c.id}
              onClick={() => {
                onSelectView?.('chat');
                onSelectConversation(c.id);
              }}
              className={`group flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-all spring-pill ${
                activeConversationId === c.id
                  ? 'bg-amber-500/15 text-amber-200 border border-amber-500/25 shadow-sm'
                  : 'text-neutral-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <span className="truncate flex-1 text-xs">{c.title}</span>
              <button
                onClick={(e) => handleDeleteConversation(e, c.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-neutral-500 transition-opacity"
                title="Delete chat"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Bottom Hub Nav & Settings */}
      <div className="p-2 border-t border-white/10 space-y-0.5 bg-[#0E0D0C]/90 font-mono-telemetry">
        <button
          onClick={() => onSelectView?.(currentView === 'library' ? 'chat' : 'library')}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all text-[11px] spring-pill ${
            currentView === 'library'
              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/35 font-bold shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
          }`}
        >
          <Library className="w-3.5 h-3.5 text-sky-400" />
          <span>01 / Library</span>
        </button>
        <button
          onClick={() => onSelectView?.(currentView === 'study' ? 'chat' : 'study')}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all text-[11px] spring-pill ${
            currentView === 'study'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/35 font-bold shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5 text-purple-400" />
          <span>02 / Study & Tasks</span>
        </button>
        <button
          onClick={onToggleFocus}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all text-[11px] spring-pill ${
            focusStatus?.is_active
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/35 font-bold shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
          }`}
          title={focusStatus?.is_active ? 'Click to stop focus session' : 'Start 25m Pomodoro Focus Session'}
        >
          <div className="flex items-center gap-2">
            <Timer className={`w-3.5 h-3.5 ${focusStatus?.is_active ? 'text-rose-400 animate-pulse' : 'text-neutral-400'}`} />
            <span>03 / Pomodoro</span>
          </div>
          {focusStatus?.is_active && (
            <span className="text-[10px] text-rose-300 font-mono font-bold bg-rose-500/20 px-1.5 py-0.5 rounded">
              {focusStatus.minutes_left}m
            </span>
          )}
        </button>
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-neutral-400 hover:text-amber-300 hover:bg-white/5 transition-colors text-left text-[11px]"
        >
          <SettingsIcon className="w-3.5 h-3.5 text-neutral-400" />
          <span>04 / Settings</span>
        </button>
      </div>
    </aside>
  );
};
