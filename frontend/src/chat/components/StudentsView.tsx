import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Plus,
  FileSpreadsheet,
  Send,
  Search,
  MessageSquare,
  Sparkles,
  CheckCircle2,
  Clock,
  Trash2,
  X,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { Student, DraftReminderItem } from '@/types/api';
import { apiFetch } from '@/config/api';

interface StudentsViewProps {
  onBackToChat: () => void;
  onSendChatMessage?: (msg: string) => void;
}

export const StudentsView: React.FC<StudentsViewProps> = ({ onBackToChat }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatch, setSelectedBatch] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & Drawers
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isDraftsModalOpen, setIsDraftsModalOpen] = useState(false);

  // New Student Form
  const [newStudent, setNewStudent] = useState({
    name: '',
    phone: '',
    email: '',
    course_batch: 'CS101-A',
    preferred_channel: 'whatsapp_deeplink'
  });

  // CSV Import Form
  const [csvContent, setCsvContent] = useState('');
  const [csvDefaultBatch, setCsvDefaultBatch] = useState('CS101-A');

  // Reminders Draft State
  const [draftReminders, setDraftReminders] = useState<DraftReminderItem[]>([]);
  const [isDrafting, setIsDrafting] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState<Record<string, string>>({});

  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedBatch !== 'all') {
        params.set('batch', selectedBatch);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }
      const path = `/api/students${params.toString() ? '?' + params.toString() : ''}`;
      const res = await apiFetch(path);
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students || []);
      }
    } catch (err) {
      console.error('Failed to load students:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedBatch, searchQuery]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudent.name || !newStudent.phone) return;

    try {
      const res = await apiFetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStudent)
      });
      if (res.ok) {
        setIsAddModalOpen(false);
        setNewStudent({
          name: '',
          phone: '',
          email: '',
          course_batch: 'CS101-A',
          preferred_channel: 'whatsapp_deeplink'
        });
        fetchStudents();
      }
    } catch (err) {
      console.error('Error creating student:', err);
    }
  };

  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvContent.trim()) return;

    try {
      const res = await apiFetch('/api/students/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv_text: csvContent,
          default_batch: csvDefaultBatch
        })
      });
      if (res.ok) {
        setIsCsvModalOpen(false);
        setCsvContent('');
        fetchStudents();
      }
    } catch (err) {
      console.error('Error importing CSV:', err);
    }
  };

  const handleDeleteStudent = async (id: string) => {
    if (!confirm('Are you sure you want to remove this student?')) return;
    try {
      const res = await apiFetch(`/api/students/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setStudents((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete student:', err);
    }
  };

  const handleGenerateDrafts = async () => {
    setIsDrafting(true);
    try {
      const res = await apiFetch('/api/students/draft-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_batch: selectedBatch === 'all' ? null : selectedBatch
        })
      });
      if (res.ok) {
        const data = await res.json();
        setDraftReminders(data.drafts || []);
        setIsDraftsModalOpen(true);
      }
    } catch (err) {
      console.error('Failed to draft reminders:', err);
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSendReminder = async (item: DraftReminderItem) => {
    setDispatchStatus((prev) => ({ ...prev, [item.student_id]: 'sending' }));
    try {
      const res = await apiFetch('/api/students/send-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: item.student_id,
          student_name: item.student_name,
          phone: item.phone,
          message: item.draft_message,
          channel: item.preferred_channel,
          assignment_ids: item.pending_assignments.map((a) => a.id)
        })
      });
      const data = await res.json();
      if (data.success) {
        setDispatchStatus((prev) => ({ ...prev, [item.student_id]: 'sent' }));
        fetchStudents();
      } else {
        setDispatchStatus((prev) => ({ ...prev, [item.student_id]: 'denied_or_failed' }));
      }
    } catch (err) {
      setDispatchStatus((prev) => ({ ...prev, [item.student_id]: 'error' }));
    }
  };

  const batches = Array.from(new Set(students.map((s) => s.course_batch))).filter(Boolean);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#121110] text-neutral-200 select-none overflow-hidden">
      {/* Top Header Bar */}
      <header className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between bg-[#161514]/90 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToChat}
            className="px-2 py-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 text-xs font-mono-telemetry border border-white/10"
            title="Back to Chat"
          >
            ← Back
          </button>
          <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-headline-md font-bold text-neutral-100">Student Roster</h2>
              <span className="text-[10px] font-mono-telemetry px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 font-bold">
                {students.length} ENROLLED
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 font-mono-telemetry">
              WhatsApp Cloud & Zero-Cost DeepLink Dispatcher with Zero-Trust Security
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateDrafts}
            disabled={isDrafting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500/20 to-purple-500/20 hover:from-amber-500/30 hover:to-purple-500/30 text-amber-300 border border-amber-500/35 text-xs font-mono-telemetry font-bold spring-pill transition-all active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{isDrafting ? 'Drafting...' : 'Draft Work Reminders'}</span>
          </button>
          <button
            onClick={() => setIsCsvModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 text-xs font-mono-telemetry spring-pill transition-all"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Import CSV</span>
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500 hover:bg-purple-600 text-white text-xs font-mono-telemetry font-bold spring-pill transition-all shadow-md active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Student</span>
          </button>
        </div>
      </header>

      {/* Filter and Search Sub-header */}
      <div className="px-5 py-2.5 border-b border-white/10 bg-[#141312]/60 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setSelectedBatch('all')}
            className={`px-3 py-1 rounded-lg text-xs font-mono-telemetry font-bold transition-all spring-pill ${
              selectedBatch === 'all'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
            }`}
          >
            All Batches
          </button>
          {batches.map((batch) => (
            <button
              key={batch}
              onClick={() => setSelectedBatch(batch)}
              className={`px-3 py-1 rounded-lg text-xs font-mono-telemetry font-bold transition-all spring-pill ${
                selectedBatch === batch
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              {batch}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex items-center w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 text-neutral-500" />
          <input
            type="text"
            placeholder="Search student or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#181716] pl-8 pr-3 py-1.5 rounded-lg text-xs text-neutral-200 placeholder-neutral-500 border border-white/10 focus:outline-none focus:border-purple-500/50"
          />
        </div>
      </div>

      {/* Roster Table */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-neutral-500 font-mono-telemetry text-xs">
            Loading enrolled students...
          </div>
        ) : students.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6 border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3">
              <img src="/assets/duck-avatar.svg" alt="Duckuu" className="w-7 h-7 object-contain" />
            </div>
            <h4 className="text-sm font-headline-md font-bold text-neutral-200">No Students Found</h4>
            <p className="text-xs text-neutral-400 max-w-sm mt-1 mb-4 font-mono-telemetry">
              Add individual students or import a batch via CSV to manage submissions and WhatsApp alerts.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-mono-telemetry font-bold"
              >
                + Add Student
              </button>
              <button
                onClick={() => setIsCsvModalOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 text-xs font-mono-telemetry"
              >
                Import CSV
              </button>
            </div>
          </div>
        ) : (
          <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#161514]/70 shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1C1B1A]/80 text-[10px] font-mono-telemetry font-bold uppercase tracking-wider text-neutral-400 border-b border-white/10">
                <tr>
                  <th className="py-2.5 px-4">Student Name</th>
                  <th className="py-2.5 px-4">Phone / WhatsApp</th>
                  <th className="py-2.5 px-4">Course Batch</th>
                  <th className="py-2.5 px-4">Pending Work</th>
                  <th className="py-2.5 px-4">Channel Mode</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono-telemetry">
                {students.map((s) => (
                  <tr key={s.id} className="hover:bg-white/[0.03] transition-colors group">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-[11px] font-bold text-purple-300">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-sans font-bold text-xs text-neutral-200">{s.name}</div>
                          {s.email && <div className="text-[10px] text-neutral-500">{s.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-neutral-300">
                      <span className="font-mono">{s.phone}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-neutral-300 text-[10px] font-bold">
                        {s.course_batch}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {(s.pending_assignments || 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-[10px]">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{s.pending_assignments} PENDING</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-[10px]">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          <span>ALL DONE</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-md border font-bold ${
                          s.preferred_channel === 'whatsapp_cloud'
                            ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        }`}
                      >
                        {s.preferred_channel === 'whatsapp_cloud' ? 'Meta Cloud API' : 'Zero-Cost DeepLink'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5 opacity-90 group-hover:opacity-100">
                        <button
                          onClick={async () => {
                            const res = await apiFetch('/api/students/draft-reminders', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ student_id: s.id })
                            });
                            if (res.ok) {
                              const data = await res.json();
                              setDraftReminders(data.drafts || []);
                              setIsDraftsModalOpen(true);
                            }
                          }}
                          className="px-2 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-bold spring-pill transition-all"
                          title="Draft reminder"
                        >
                          <MessageSquare className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteStudent(s.id)}
                          className="p-1 rounded-md text-neutral-500 hover:text-rose-400 hover:bg-rose-500/15 transition-colors"
                          title="Delete student"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Add Student */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#181716] border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-headline-md font-bold text-neutral-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                <span>Add New Student</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateStudent} className="space-y-3 text-xs font-mono-telemetry">
              <div>
                <label className="block text-neutral-400 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Morgan"
                  value={newStudent.name}
                  onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                  className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-neutral-400 mb-1">WhatsApp Phone (E.164 with Country Code) *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. +14155552671"
                  value={newStudent.phone}
                  onChange={(e) => setNewStudent({ ...newStudent, phone: e.target.value })}
                  className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-neutral-400 mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="e.g. alex@university.edu"
                  value={newStudent.email}
                  onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                  className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-neutral-400 mb-1">Course Batch</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CS101-A"
                    value={newStudent.course_batch}
                    onChange={(e) => setNewStudent({ ...newStudent, course_batch: e.target.value })}
                    className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-neutral-400 mb-1">Preferred Channel</label>
                  <select
                    value={newStudent.preferred_channel}
                    onChange={(e) => setNewStudent({ ...newStudent, preferred_channel: e.target.value })}
                    className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="whatsapp_deeplink">Zero-Cost DeepLink</option>
                    <option value="whatsapp_cloud">Meta Cloud API</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold"
                >
                  Create Student
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: CSV Import */}
      {isCsvModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-[#181716] border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-headline-md font-bold text-neutral-100 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span>Import Student List (CSV / Comma Separated)</span>
              </h3>
              <button
                onClick={() => setIsCsvModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleImportCsv} className="space-y-3 text-xs font-mono-telemetry">
              <p className="text-[11px] text-neutral-400">
                Paste student rows below. Format: <span className="text-amber-300">Name, Phone, Email, Batch, Channel</span>
              </p>
              <textarea
                rows={6}
                required
                placeholder="John Doe, +14155551234, john@univ.edu, CS101-A, whatsapp_deeplink&#10;Jane Smith, +14155555678, jane@univ.edu, CS101-A, whatsapp_cloud"
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                className="w-full bg-[#121110] border border-white/15 rounded-xl p-3 text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 font-mono text-[11px]"
              />
              <div>
                <label className="block text-neutral-400 mb-1">Default Batch if Missing in Row</label>
                <input
                  type="text"
                  value={csvDefaultBatch}
                  onChange={(e) => setCsvDefaultBatch(e.target.value)}
                  className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsCsvModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold"
                >
                  Parse & Import Students
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Drawer: Draft Reminders Queue */}
      {isDraftsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-xl h-full bg-[#161514] border-l border-white/15 p-5 shadow-2xl flex flex-col justify-between overflow-hidden">
            <div>
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-headline-md font-bold text-neutral-100">
                    Drafted WhatsApp Reminders ({draftReminders.length})
                  </h3>
                </div>
                <button
                  onClick={() => setIsDraftsModalOpen(false)}
                  className="p-1 text-neutral-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 mb-4 text-[11px] font-mono-telemetry text-amber-200 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Zero-Trust Approval Gate Active:</strong> Clicking dispatch triggers an interactive approval card. Messages will not send until authorized.
                </div>
              </div>
            </div>

            {/* List of drafts */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {draftReminders.length === 0 ? (
                <div className="text-center py-12 text-neutral-500 text-xs font-mono-telemetry">
                  No pending assignments found for selected batch.
                </div>
              ) : (
                draftReminders.map((item) => {
                  const status = dispatchStatus[item.student_id] || 'ready';
                  return (
                    <div
                      key={item.student_id}
                      className="p-3.5 rounded-xl bg-[#1C1B1A] border border-white/10 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-neutral-200">{item.student_name}</span>
                          <span className="text-[10px] text-neutral-500 font-mono">({item.phone})</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 font-bold font-mono-telemetry">
                            {item.course_batch}
                          </span>
                        </div>
                        <span className="text-[10px] text-amber-400 font-mono-telemetry font-bold">
                          {item.pending_count} PENDING
                        </span>
                      </div>

                      {/* Draft text preview */}
                      <div className="p-2.5 rounded-lg bg-[#121110] border border-white/5 text-[11px] text-neutral-300 font-sans leading-relaxed whitespace-pre-wrap">
                        {item.draft_message}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono-telemetry">
                          <span>Via: {item.preferred_channel === 'whatsapp_cloud' ? 'Meta Cloud' : 'Deep-Link'}</span>
                        </div>

                        {status === 'sent' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 font-mono-telemetry">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Sent / Opened</span>
                          </span>
                        ) : status === 'denied_or_failed' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-400 font-mono-telemetry">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Denied / Error</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSendReminder(item)}
                            disabled={status === 'sending'}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-mono-telemetry font-bold spring-pill transition-all"
                          >
                            <Send className="w-3 h-3 text-emerald-400" />
                            <span>{status === 'sending' ? 'Awaiting Approval...' : 'Dispatch Reminder'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-4 border-t border-white/10 flex justify-between items-center shrink-0">
              <span className="text-[11px] text-neutral-500 font-mono-telemetry">
                Duckuu Multi-Channel Reminder Engine
              </span>
              <button
                onClick={() => setIsDraftsModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-neutral-200 text-xs font-mono-telemetry"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
