import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Search,
  Trash2,
  MessageSquare,
  Sparkles,
  CheckCircle2,
  Calendar,
  X,
  BookOpen
} from 'lucide-react';
import { LibraryItem } from '@/types/api';
import { apiFetch } from '@/config/api';

interface LibraryViewProps {
  onBackToChat: () => void;
  onAskAboutItem: (prompt: string) => void;
  initialSelectedId?: string | null;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  onBackToChat,
  onAskAboutItem,
  initialSelectedId
}) => {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      let path = '/api/library';
      const params = new URLSearchParams();
      if (filterType !== 'all') params.append('item_type', filterType);
      if (searchQuery.trim()) params.append('query', searchQuery.trim());
      if (params.toString()) path += `?${params.toString()}`;

      const res = await apiFetch(path);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        if (initialSelectedId) {
          const matched = (data.items || []).find((i: LibraryItem) => i.id === initialSelectedId);
          if (matched) setSelectedItem(matched);
        }
      }
    } catch (err) {
      console.error('Failed to fetch library items:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filterType, searchQuery, initialSelectedId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/library/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (selectedItem?.id === id) {
          setSelectedItem(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete item:', err);
    }
  };

  const handleConsult = (item: LibraryItem) => {
    onAskAboutItem(`I want to ask questions about "${item.title}". Summary: ${item.summary}`);
    onBackToChat();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#121110]/90 text-neutral-100 overflow-hidden font-body-sm">
      {/* Top Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-[#0E0D0C]/80">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-headline-md font-bold text-sky-400 uppercase tracking-wider font-mono-telemetry">
              [ KNOWLEDGE LIBRARY & RESEARCH DOSSIERS ]
            </h2>
          </div>
          <p className="text-[11px] text-neutral-400 mt-0.5 font-mono-telemetry">
            Indexed PDFs, research summaries, and verified citations
          </p>
        </div>

        <button
          onClick={onBackToChat}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 font-mono-telemetry text-xs font-bold transition-all spring-pill"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Back to Chat</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0 bg-[#161412]/50">
        {/* Type pills */}
        <div className="flex items-center gap-1 text-[11px] font-mono-telemetry">
          {[
            { id: 'all', label: 'All Items' },
            { id: 'pdf', label: 'PDFs' },
            { id: 'research_report', label: 'Research' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                filterType === tab.id
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex items-center w-60">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-neutral-500" />
          <input
            type="text"
            placeholder="Search dossier library..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1A1816] pl-8 pr-2.5 py-1 rounded-lg text-xs text-neutral-200 placeholder-neutral-500 border border-white/10 focus:outline-none focus:border-sky-500/50 transition-colors font-body-sm"
          />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Items List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {isLoading && (
            <div className="text-center py-10 text-neutral-500 text-xs font-mono-telemetry">
              Loading library items...
            </div>
          )}

          {!isLoading && items.length === 0 && (
            <div className="text-center py-16 text-neutral-500 space-y-2 font-mono-telemetry">
              <FileText className="w-8 h-8 mx-auto text-neutral-600" />
              <div className="text-xs">No indexed items found in library</div>
              <p className="text-[11px] text-neutral-600 max-w-xs mx-auto">
                Drag and drop a PDF into the chat or ask Duckuu to research a topic to compile dossiers here.
              </p>
            </div>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              className={`group p-3.5 rounded-2xl border transition-all cursor-pointer ${
                selectedItem?.id === item.id
                  ? 'bg-sky-500/15 border-sky-500/40 shadow-lg'
                  : 'bg-[#181615]/80 hover:bg-[#1f1d1a] border-white/10 hover:border-white/20'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`p-2 rounded-xl shrink-0 border ${
                      item.item_type === 'pdf'
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                    }`}
                  >
                    {item.item_type === 'pdf' ? (
                      <FileText className="w-4 h-4" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono-telemetry uppercase font-bold text-neutral-400">
                        {item.item_type === 'pdf' ? 'PDF Document' : 'Deep Research Dossier'}
                      </span>
                      {item.metadata?.page_count && (
                        <span className="text-[10px] font-mono-telemetry bg-white/10 px-1.5 py-0.2 rounded text-neutral-300">
                          {item.metadata.page_count} Pages
                        </span>
                      )}
                      {item.metadata?.sources && (
                        <span className="text-[10px] font-mono-telemetry bg-sky-500/15 text-sky-300 px-1.5 py-0.2 rounded">
                          {item.metadata.sources.length} Sources
                        </span>
                      )}
                    </div>
                    <h4 className="text-xs font-headline-md font-bold text-neutral-100 truncate mt-0.5">
                      {item.title}
                    </h4>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => handleDelete(e, item.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-500/20 text-neutral-500 hover:text-rose-400 transition-all"
                    title="Delete item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Summary Snippet */}
              <p className="text-[11px] text-neutral-400 mt-2 line-clamp-2 leading-relaxed">
                {item.summary}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-white/5 text-[10px] font-mono-telemetry text-neutral-500">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(item.created_at).toLocaleDateString()}
                </span>
                <span className="text-sky-400 font-bold group-hover:underline flex items-center gap-1">
                  Read dossier & citations →
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Selected Item Detail Drawer */}
        {selectedItem && (
          <div className="w-1/2 border-l border-white/10 bg-[#0E0D0C]/95 p-4 flex flex-col h-full overflow-hidden">
            <div className="flex items-start justify-between pb-3 border-b border-white/10 shrink-0">
              <div>
                <span className="text-[10px] font-mono-telemetry uppercase text-sky-400 font-bold">
                  [ DOSSIER INSPECTOR ]
                </span>
                <h3 className="text-sm font-headline-md font-bold text-white mt-0.5 leading-snug">
                  {selectedItem.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto py-3 space-y-4 pr-1 text-xs">
              {/* Executive Summary */}
              <div className="space-y-1 bg-[#161412] p-3 rounded-xl border border-white/10">
                <div className="text-[10px] font-mono-telemetry font-bold text-neutral-400 uppercase">
                  Executive Summary
                </div>
                <p className="text-neutral-300 leading-relaxed">
                  {selectedItem.summary}
                </p>
              </div>

              {/* Key Takeaways */}
              {selectedItem.key_takeaways && selectedItem.key_takeaways.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono-telemetry font-bold text-amber-300 uppercase">
                    Verified Key Takeaways
                  </div>
                  <ul className="space-y-1.5">
                    {selectedItem.key_takeaways.map((bullet, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-neutral-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Full Content Preview / Markdown */}
              {selectedItem.content && (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono-telemetry font-bold text-sky-400 uppercase">
                    Full Content & Verified Citations
                  </div>
                  <div className="bg-[#121110] p-3 rounded-xl border border-white/10 font-mono-telemetry text-[11px] text-neutral-300 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                    {selectedItem.content}
                  </div>
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div className="pt-3 border-t border-white/10 flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleConsult(selectedItem)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-mono-telemetry text-xs font-bold transition-all spring-pill"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Consult Duckuu on This</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
