import React, { useEffect, useRef, useState } from 'react';
import { Message, TaskProgressEvent, PdfSummaryCardEvent } from '@/types/api';
import { Bot, User, Cpu, Globe, Volume2, VolumeX, Copy, Check, Settings, Activity, BookOpen, Calendar, Sparkles } from 'lucide-react';
import { PdfSummaryCard } from './PdfSummaryCard';
import { TaskProgressCard } from './TaskProgressCard';
import { speechService } from '@/services/speechService';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  onQuickAction: (text: string) => void;
  onOpenLibrary?: (libraryId: string) => void;
  onOpenSettings?: () => void;
  activeTasks?: Record<string, TaskProgressEvent>;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isStreaming,
  onQuickAction,
  onOpenLibrary,
  onOpenSettings,
  activeTasks = {}
}) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const toggleSpeech = (id: string, text: string) => {
    if (speakingMessageId === id) {
      speechService.stop();
      setSpeakingMessageId(null);
    } else {
      speechService.speak(text, () => setSpeakingMessageId(null));
      setSpeakingMessageId(id);
    }
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-neutral-300 space-y-4 select-none">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shadow-xl shadow-amber-500/10 backdrop-blur-xl">
          <img src="/assets/duck-avatar.svg" alt="Duckuu" className="w-10 h-10 object-contain drop-shadow" />
        </div>
        <div className="space-y-1">
          <div className="font-mono-telemetry text-[10px] text-amber-400 font-bold uppercase tracking-widest">
            [RUNTIME READY // LOCAL SILICON & CLOUD]
          </div>
          <h2 className="font-sans text-2xl font-bold text-amber-300 tracking-tight">Duckuu OS Companion</h2>
          <p className="font-sans text-xs text-neutral-400 max-w-xs leading-relaxed">
            Your ambient desktop companion. Control apps, summarize research, or chat with voice synthesis.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 w-full max-w-sm pt-2">
          {[
            { icon: <Bot className="w-3.5 h-3.5 text-amber-400 shrink-0" />, label: 'System capabilities', prompt: 'What can you do on my PC?' },
            { icon: <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />, label: 'Run health check', prompt: 'Check system health and LLM provider' },
            { icon: <BookOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />, label: 'Research topic', prompt: 'Explain quantum computing in simple bullet points' },
            { icon: <Calendar className="w-3.5 h-3.5 text-purple-400 shrink-0" />, label: 'Plan daily focus', prompt: 'Help me prioritize my daily tasks' }
          ].map((item, idx) => (
            <button
              key={idx}
              onClick={() => onQuickAction(item.prompt)}
              className="flex items-center gap-2 text-left p-3 rounded-2xl bg-black/25 backdrop-blur-2xl hover:bg-amber-500/15 border border-white/10 hover:border-amber-400/40 text-xs text-neutral-200 hover:text-amber-200 transition-all font-sans shadow-xl bg-gradient-to-br from-white/5 to-transparent spring-pill"
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        const provider = (msg.metadata?.provider as string) || '';
        const isOnline = Boolean(msg.metadata?.is_online);
        const isCurrentlySpeaking = speakingMessageId === msg.id;

        return (
          <div
            key={msg.id}
            className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border-2 ${
                isUser
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-[#1E1C1A] text-amber-400 border-amber-500/30'
              }`}
            >
              {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5 text-amber-400" />}
            </div>

            {/* Bubble with Deep Glassmorphism & Pill Curves */}
            <div
              className={`max-w-[82%] rounded-3xl px-5 py-3.5 text-xs leading-relaxed space-y-2.5 shadow-2xl transition-all duration-200 ${
                isUser
                  ? 'bg-gradient-to-br from-amber-500/85 to-amber-600/75 backdrop-blur-2xl text-white border border-amber-300/30 shadow-amber-950/25 rounded-tr-md font-medium'
                  : 'bg-black/30 backdrop-blur-2xl text-neutral-100 border border-white/10 shadow-black/40 bg-gradient-to-br from-white/5 to-transparent rounded-tl-md font-normal'
              }`}
            >
              {/* Header: Provider badge & Voice speaker button */}
              {!isUser && (
                <div className="flex items-center justify-between text-[10px] pb-1.5 border-b border-white/10 font-mono-telemetry text-neutral-400">
                  <div className="flex items-center gap-1.5">
                    {isOnline ? (
                      <Globe className="w-3 h-3 text-purple-400" />
                    ) : (
                      <Cpu className="w-3 h-3 text-emerald-400" />
                    )}
                    <span className="font-bold uppercase text-neutral-300">{provider || 'DUCKUU'}</span>
                    <span className="text-neutral-500">•</span>
                    <span>{isOnline ? 'CLOUD' : 'LOCAL'}</span>
                  </div>

                  {/* Read Aloud / Stop Button */}
                  <button
                    onClick={() => toggleSpeech(msg.id, msg.content)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                      isCurrentlySpeaking
                        ? 'bg-amber-500/25 text-amber-300 animate-pulse'
                        : 'hover:text-amber-300 text-neutral-400'
                    }`}
                    title={isCurrentlySpeaking ? 'Stop speaking' : 'Speak aloud'}
                  >
                    {isCurrentlySpeaking ? (
                      <>
                        <VolumeX className="w-3 h-3 text-amber-400" />
                        <span className="text-[9px]">Talking...</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3 h-3" />
                        <span className="text-[9px]">Listen</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Message text with rich markdown formatting */}
              <div className="break-words font-body-sm leading-relaxed space-y-2">
                {renderFormattedContent(msg.content)}
              </div>

              {/* Failsafe Settings Shortcut for Missing Credentials */}
              {!isUser && onOpenSettings && (msg.content.includes("need an API key in Settings") || msg.content.includes("need my core systems connected") || msg.content.includes("Please lock in your API key")) && (
                <div className="pt-2">
                  <button
                    onClick={onOpenSettings}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/50 text-amber-300 font-mono-telemetry font-bold text-xs transition-all spring-pill cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5 text-amber-400" />
                    <span>Open Settings & Configure API Key</span>
                  </button>
                </div>
              )}

              {/* Rich PDF Intelligence Summary Card */}
              {msg.metadata?.type === 'pdf_summary' && Boolean(msg.metadata.pdfData) && (
                <PdfSummaryCard
                  card={msg.metadata.pdfData as PdfSummaryCardEvent}
                  onOpenLibrary={onOpenLibrary}
                  onAskDuckuu={onQuickAction}
                />
              )}
            </div>
          </div>
        );
      })}

      {/* Active Live Research Task Cards */}
      {Object.values(activeTasks).map((task) => (
        <div key={task.task_id} className="pl-10 max-w-[88%]">
          <TaskProgressCard progress={task} />
        </div>
      ))}

      {/* Streaming pulse indicator */}
      {isStreaming && (
        <div className="flex items-center gap-2 text-neutral-400 text-xs pl-10 font-mono-telemetry">
          <div className="flex gap-1 items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse [animation-delay:200ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse [animation-delay:400ms]" />
          </div>
          <span className="text-[10px] text-amber-300/90 font-bold uppercase tracking-wider">Duckuu is synthesizing...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

// Formatted markdown renderer supporting code blocks, headers, quotes, lists, bold
function renderFormattedContent(content: string): React.ReactElement {
  // Check for code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, pIdx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const firstNewline = part.indexOf('\n');
          const lang = firstNewline !== -1 ? part.slice(3, firstNewline).trim() : '';
          const code = firstNewline !== -1 ? part.slice(firstNewline + 1, -3) : part.slice(3, -3);

          return <CodeBlock key={pIdx} code={code} language={lang} />;
        }

        const lines = part.split('\n');
        return (
          <div key={pIdx} className="space-y-1">
            {lines.map((line, lIdx) => {
              if (line.startsWith('### ')) {
                return (
                  <h4 key={lIdx} className="font-headline-md text-sm font-bold text-amber-300 pt-1.5 pb-0.5">
                    {renderInlineMarkdown(line.slice(4))}
                  </h4>
                );
              }
              if (line.startsWith('## ')) {
                return (
                  <h3 key={lIdx} className="font-headline-md text-base font-bold text-amber-300 pt-2 pb-0.5 border-b border-white/10">
                    {renderInlineMarkdown(line.slice(3))}
                  </h3>
                );
              }
              if (line.startsWith('# ')) {
                return (
                  <h2 key={lIdx} className="font-display text-lg font-bold text-amber-200 pt-2.5 pb-1">
                    {renderInlineMarkdown(line.slice(2))}
                  </h2>
                );
              }
              if (line.startsWith('> ')) {
                return (
                  <blockquote key={lIdx} className="border-l-2 border-amber-500/60 pl-3 py-1 my-1 italic text-neutral-300 bg-white/5 rounded-r">
                    {renderInlineMarkdown(line.slice(2))}
                  </blockquote>
                );
              }
              if (line.startsWith('- ') || line.startsWith('* ')) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-1 my-0.5">
                    <span className="text-amber-400 font-bold select-none">•</span>
                    <span className="flex-1">{renderInlineMarkdown(line.slice(2))}</span>
                  </div>
                );
              }
              if (/^\d+\.\s/.test(line)) {
                const dotIdx = line.indexOf('.');
                const num = line.slice(0, dotIdx + 1);
                const text = line.slice(dotIdx + 1).trim();
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-1 my-0.5">
                    <span className="text-amber-400 font-mono text-[11px] font-bold select-none">{num}</span>
                    <span className="flex-1">{renderInlineMarkdown(text)}</span>
                  </div>
                );
              }
              if (line.trim() === '') {
                return <div key={lIdx} className="h-1.5" />;
              }
              return (
                <p key={lIdx} className="leading-relaxed">
                  {renderInlineMarkdown(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-white/15 bg-[#0D0C0B] shadow-inner">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#171615] border-b border-white/10 text-[10px] font-mono-telemetry text-neutral-400">
        <span className="uppercase text-amber-400/90 font-bold">{language || 'CODE'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-amber-300 transition-colors"
          title="Copy code"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[11px] font-mono-telemetry leading-relaxed text-amber-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-amber-200">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="px-1.5 py-0.5 rounded bg-black/60 text-amber-300 font-mono-telemetry text-[11px] border border-white/10">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
