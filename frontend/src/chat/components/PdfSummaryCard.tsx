import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, Table, BookOpen, MessageSquare, CheckCircle2 } from 'lucide-react';
import { PdfSummaryCardEvent } from '@/types/api';

interface PdfSummaryCardProps {
  card: PdfSummaryCardEvent;
  onOpenLibrary?: (libraryId: string) => void;
  onAskDuckuu?: (prompt: string) => void;
}

export const PdfSummaryCard: React.FC<PdfSummaryCardProps> = ({
  card,
  onOpenLibrary,
  onAskDuckuu
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showTables, setShowTables] = useState(false);

  return (
    <div className="my-3 rounded-2xl bg-gradient-to-br from-[#1c1a17]/95 to-[#141312]/95 border border-amber-500/30 p-4 shadow-xl backdrop-blur-md transition-all text-neutral-100 font-body-sm space-y-3">
      {/* Header Bar */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono-telemetry font-bold text-amber-400 uppercase tracking-wider">
                [ PDF INTELLIGENCE ]
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono-telemetry bg-white/10 text-neutral-300 border border-white/10">
                {card.page_count} {card.page_count === 1 ? 'Page' : 'Pages'}
              </span>
              {card.detected_tables_count && card.detected_tables_count > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono-telemetry bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {card.detected_tables_count} Tables
                </span>
              )}
            </div>
            <h3 className="text-sm font-headline-md font-bold text-white truncate mt-0.5">
              {card.title}
            </h3>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors spring-pill"
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Executive Summary */}
      <div className="text-xs leading-relaxed text-neutral-300 bg-[#0E0D0C]/60 p-3 rounded-xl border border-white/5 space-y-1">
        <div className="text-[10px] font-mono-telemetry font-bold text-neutral-400 uppercase tracking-wider">
          Executive Summary
        </div>
        <p className="line-clamp-3 hover:line-clamp-none transition-all">
          {card.summary}
        </p>
      </div>

      {/* Key Takeaways with [Page X] Badges */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-mono-telemetry font-bold text-amber-300 uppercase tracking-wider flex items-center justify-between">
          <span>Key Takeaways & Citations</span>
          <span className="text-[10px] text-neutral-500">Verified</span>
        </div>
        <ul className="space-y-1.5">
          {card.key_takeaways.slice(0, isExpanded ? undefined : 3).map((bullet, idx) => {
            // Highlight [Page X] citations
            const parts = bullet.split(/(\[Page\s*\d+\])/gi);
            return (
              <li key={idx} className="flex items-start gap-2 text-xs text-neutral-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span className="flex-1">
                  {parts.map((p, pIdx) => {
                    if (/\[Page\s*\d+\]/i.test(p)) {
                      return (
                        <span
                          key={pIdx}
                          className="inline-block mx-1 px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/35 font-mono-telemetry text-[10px] font-bold"
                        >
                          {p}
                        </span>
                      );
                    }
                    return p;
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Table Preview Drawer (if expanded) */}
      {isExpanded && card.tables && card.tables.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-white/10">
          <button
            onClick={() => setShowTables(!showTables)}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-mono-telemetry"
          >
            <Table className="w-3.5 h-3.5" />
            <span>
              {showTables ? 'Hide Extracted Tables' : `View ${card.tables.length} Extracted Tables`}
            </span>
          </button>

          {showTables && (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {card.tables.map((t, idx) => (
                <div key={idx} className="p-2.5 rounded-lg bg-[#0e0d0c] border border-white/10 text-[11px] font-mono-telemetry">
                  <div className="text-neutral-400 text-[10px] mb-1 font-bold">
                    Table on Page {t.page} ({t.rows_count} data rows)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-white/20 text-amber-300">
                          {t.headers.map((h, hIdx) => (
                            <th key={hIdx} className="text-left py-1 px-1.5 font-bold truncate max-w-[120px]">
                              {String(h || `Col ${hIdx+1}`)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {t.sample_rows.map((row, rIdx) => (
                          <tr key={rIdx} className="border-b border-white/5 text-neutral-300 hover:bg-white/5">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="py-0.5 px-1.5 truncate max-w-[120px]">
                                {String(cell || '-')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center gap-2 pt-1 border-t border-white/10">
        {onOpenLibrary && (
          <button
            onClick={() => onOpenLibrary(card.library_id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 font-mono-telemetry text-xs font-bold transition-all spring-pill"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Open in Library</span>
          </button>
        )}
        {onAskDuckuu && (
          <button
            onClick={() => onAskDuckuu(`Summarize key technical points from "${card.title}" and explain page citations.`)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 font-mono-telemetry text-xs font-bold transition-all spring-pill"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Consult Duckuu</span>
          </button>
        )}
      </div>
    </div>
  );
};
