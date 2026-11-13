import React from 'react';
import { Loader2, Globe, CheckCircle, Search } from 'lucide-react';
import { TaskProgressEvent } from '@/types/api';

interface TaskProgressCardProps {
  progress: TaskProgressEvent;
}

export const TaskProgressCard: React.FC<TaskProgressCardProps> = ({ progress }) => {
  const isDone = progress.progress_percent >= 100 || progress.step === 'COMPLETED';

  return (
    <div className="my-2.5 rounded-2xl bg-[#161412]/90 border border-sky-500/30 p-3.5 shadow-lg backdrop-blur-md text-neutral-100 font-body-sm space-y-2.5">
      {/* Title & Step */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isDone ? (
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          ) : (
            <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
          )}
          <span className="text-xs font-mono-telemetry font-bold text-sky-400 uppercase tracking-wider">
            [ DEEP RESEARCH AGENT ]
          </span>
        </div>
        <span className="font-mono-telemetry text-xs font-bold text-neutral-300">
          {progress.progress_percent}%
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 transition-all duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(5, progress.progress_percent))}%` }}
        />
      </div>

      {/* Step details message */}
      <div className="flex items-start gap-2 text-xs text-neutral-300 bg-[#0E0D0C]/60 p-2.5 rounded-xl border border-white/5">
        <Search className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
        <span className="flex-1 font-mono-telemetry text-[11px] leading-relaxed">
          {progress.details}
        </span>
      </div>

      {/* Verified sources chips */}
      {progress.sources && progress.sources.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono-telemetry uppercase text-neutral-400">
            Active Sources ({progress.sources.length})
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {progress.sources.map((s, idx) => (
              <a
                key={idx}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-[#201e1b] hover:bg-white/10 border border-white/10 text-[10px] font-mono-telemetry text-neutral-300 hover:text-sky-300 transition-colors"
                title={s.title}
              >
                <Globe className="w-2.5 h-2.5 text-sky-400" />
                <span className="max-w-[130px] truncate">{s.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
