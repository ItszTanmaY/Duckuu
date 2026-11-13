import React, { useState, useEffect } from 'react';
import { ShieldAlert, Check, ShieldCheck, Ban, Clock } from 'lucide-react';
import { ApprovalRequest } from '@/types/api';

interface ApprovalCardProps {
  request: ApprovalRequest;
  onDecide: (requestId: string, decision: 'once' | 'always' | 'deny') => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ request, onDecide }) => {
  const [timeLeft, setTimeLeft] = useState(request.timeout_seconds);
  const [resolvedDecision, setResolvedDecision] = useState<'once' | 'always' | 'deny' | null>(null);

  useEffect(() => {
    if (resolvedDecision) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onDecide(request.request_id, 'deny');
          setResolvedDecision('deny');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [request.request_id, onDecide, resolvedDecision]);

  const handleAction = (decision: 'once' | 'always' | 'deny') => {
    setResolvedDecision(decision);
    onDecide(request.request_id, decision);
  };

  const riskColors = {
    LOW: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    MEDIUM: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    HIGH: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    CRITICAL: 'border-red-600/60 bg-red-600/20 text-red-200'
  };

  return (
    <div className="w-full rounded-2xl bg-[#1A1816] border-2 border-amber-500/40 p-4 shadow-xl space-y-3 font-body-sm my-2 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/10 font-mono-telemetry">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="font-bold text-amber-300 uppercase tracking-wider">Zero-Trust Approval Required</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className={`px-2 py-0.5 rounded-full border font-bold ${riskColors[request.risk_level] || riskColors.HIGH}`}>
            {request.risk_level} RISK
          </span>
          {!resolvedDecision && (
            <span className="flex items-center gap-1 text-neutral-400">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>{timeLeft}s</span>
            </span>
          )}
        </div>
      </div>

      {/* Description & Target */}
      <div className="space-y-1">
        <p className="text-neutral-200 font-medium">{request.description}</p>
        <div className="p-2 rounded-lg bg-black/50 border border-white/5 font-mono-telemetry text-[11px] text-amber-200 break-all">
          <span className="text-neutral-500">tool:</span> {request.tool_name} (
          {Object.entries(request.parameters)
            .map(([k, v]) => `${k}="${v}"`)
            .join(', ')}
          )
        </div>
      </div>

      {/* Action Buttons */}
      {resolvedDecision ? (
        <div className="pt-1 text-center font-mono-telemetry text-xs font-bold">
          {resolvedDecision === 'deny' ? (
            <span className="text-rose-400 flex items-center justify-center gap-1.5">
              <Ban className="w-3.5 h-3.5" /> Action Blocked & Logged to SQLite
            </span>
          ) : (
            <span className="text-emerald-400 flex items-center justify-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Action Authorized ({resolvedDecision.toUpperCase()})
            </span>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 pt-1 font-mono-telemetry text-[11px]">
          <button
            onClick={() => handleAction('once')}
            className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold transition-all spring-pill"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Approve Once</span>
          </button>

          <button
            onClick={() => handleAction('always')}
            className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold transition-all spring-pill"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Always Allow</span>
          </button>

          <button
            onClick={() => handleAction('deny')}
            className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold transition-all spring-pill"
          >
            <Ban className="w-3.5 h-3.5" />
            <span>Deny</span>
          </button>
        </div>
      )}
    </div>
  );
};
