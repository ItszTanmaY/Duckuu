import React, { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap,
  Plus,
  BookOpen,
  Clock,
  FileText,
  Trash2,
  X,
  UploadCloud,
  MessageSquare,
  Sparkles
} from 'lucide-react';
import { Assignment, Subject, TriageItem } from '@/types/api';
import { apiFetch } from '@/config/api';

interface StudyHubViewProps {
  onBackToChat: () => void;
  onAskAboutAssignment: (query: string) => void;
  onUploadFile?: (file: File) => Promise<any>;
}

export const StudyHubView: React.FC<StudyHubViewProps> = ({
  onBackToChat,
  onAskAboutAssignment,
  onUploadFile
}) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [triageFeed, setTriageFeed] = useState<TriageItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Modals & Drawers
  const [isAddAssignmentOpen, setIsAddAssignmentOpen] = useState(false);
  const [isSubjectsModalOpen, setIsSubjectsModalOpen] = useState(false);
  const [isIngestModalOpen, setIsIngestModalOpen] = useState(false);
  const [isTriageDrawerOpen, setIsTriageDrawerOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);

  // Forms
  const [newAssignment, setNewAssignment] = useState({
    title: '',
    subject: 'Deep Learning',
    description: '',
    due_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 16),
    priority: 'medium',
    status: 'pending',
    notes: ''
  });

  const [newSubject, setNewSubject] = useState({
    name: '',
    code: '',
    semester: 'Sem 6',
    instructor: '',
    color: 'purple'
  });

  const [ingestText, setIngestText] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);

  // Fetch Assignments & Subjects
  const fetchStudyData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedSubject !== 'all') {
        params.set('subject', selectedSubject);
      }
      if (selectedStatus !== 'all') {
        params.set('status', selectedStatus);
      }
      const assignPath = `/api/assignments${params.toString() ? '?' + params.toString() : ''}`;
      const [assignRes, subRes] = await Promise.all([
        apiFetch(assignPath),
        apiFetch('/api/subjects')
      ]);

      if (assignRes.ok) {
        const data = await assignRes.json();
        setAssignments(data.assignments || []);
      }
      if (subRes.ok) {
        const subData = await subRes.json();
        setSubjects(subData.subjects || []);
      }
    } catch (err) {
      console.error('Failed to load study hub data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSubject, selectedStatus]);

  const fetchTriageFeed = useCallback(async () => {
    try {
      const res = await apiFetch('/api/assignments/triage/feed?status=pending');
      if (res.ok) {
        const data = await res.json();
        setTriageFeed(data.feed || []);
      }
    } catch (err) {
      console.error('Failed to load triage feed:', err);
    }
  }, []);

  useEffect(() => {
    fetchStudyData();
    fetchTriageFeed();
  }, [fetchStudyData, fetchTriageFeed]);

  // Create Assignment
  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssignment.title) return;

    try {
      const res = await apiFetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newAssignment,
          due_date: new Date(newAssignment.due_date).toISOString()
        })
      });
      if (res.ok) {
        setIsAddAssignmentOpen(false);
        setNewAssignment({
          title: '',
          subject: subjects[0]?.name || 'Deep Learning',
          description: '',
          due_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 16),
          priority: 'medium',
          status: 'pending',
          notes: ''
        });
        fetchStudyData();
      }
    } catch (err) {
      console.error('Error creating assignment:', err);
    }
  };

  // Toggle Status
  const handleToggleStatus = async (assignment: Assignment) => {
    const nextStatus =
      assignment.status === 'pending'
        ? 'in_progress'
        : assignment.status === 'in_progress'
        ? 'completed'
        : 'pending';

    try {
      const res = await apiFetch(`/api/assignments/${assignment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        setAssignments((prev) =>
          prev.map((a) => (a.id === assignment.id ? { ...a, status: nextStatus as any } : a))
        );
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  // Delete Assignment
  const handleDeleteAssignment = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this assignment?')) return;
    try {
      const res = await apiFetch(`/api/assignments/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setAssignments((prev) => prev.filter((a) => a.id !== id));
      }
    } catch (err) {
      console.error('Error deleting assignment:', err);
    }
  };

  // Add Subject
  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.name || !newSubject.code) return;
    try {
      const res = await apiFetch('/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSubject)
      });
      if (res.ok) {
        setNewSubject({ name: '', code: '', semester: 'Sem 6', instructor: '', color: 'purple' });
        fetchStudyData();
      }
    } catch (err) {
      console.error('Error creating subject:', err);
    }
  };

  // Ingest Group Chat Text
  const handleIngestGroupText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingestText.trim()) return;
    setIsIngesting(true);
    try {
      const res = await apiFetch('/api/assignments/triage/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: ingestText })
      });
      if (res.ok) {
        setIngestText('');
        setIsIngestModalOpen(false);
        fetchTriageFeed();
        fetchStudyData();
        setIsTriageDrawerOpen(true);
      }
    } catch (err) {
      console.error('Error ingesting group updates:', err);
    } finally {
      setIsIngesting(false);
    }
  };

  // Convert Triage item to Assignment
  const handleConvertTriage = async (triageId: string) => {
    try {
      const res = await apiFetch(`/api/assignments/triage/${triageId}/convert`, {
        method: 'POST'
      });
      if (res.ok) {
        fetchTriageFeed();
        fetchStudyData();
      }
    } catch (err) {
      console.error('Failed to convert triage item:', err);
    }
  };

  // Smart PDF File Drop onto an Assignment Card
  const handleCardFileDrop = async (e: React.DragEvent, assignmentId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer && e.dataTransfer.files.length > 0 && onUploadFile) {
      const file = e.dataTransfer.files[0];
      try {
        const uploadResult = await onUploadFile(file);
        if (uploadResult && uploadResult.library_id) {
          // Link this library item to the assignment
          await apiFetch(`/api/assignments/${assignmentId}/attachment`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attachment_id: uploadResult.library_id })
          });
          fetchStudyData();
        }
      } catch (err) {
        console.error('Failed to attach dropped file:', err);
      }
    }
  };

  const getSubjectColorBadge = (color?: string) => {
    switch (color) {
      case 'purple':
        return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      case 'sky':
        return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
      case 'emerald':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'rose':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      default:
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'high':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'low':
        return 'bg-neutral-500/20 text-neutral-400 border-neutral-500/40';
      default:
        return 'bg-sky-500/20 text-sky-300 border-sky-500/40';
    }
  };

  const formatDueDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = date.getTime() - now.getTime();
      const diffHrs = Math.round(diffMs / (1000 * 60 * 60));

      if (diffHrs < 0) {
        return { label: `Overdue (${Math.abs(diffHrs)}h ago)`, isOverdue: true };
      } else if (diffHrs < 24) {
        return { label: `Due in ${diffHrs}h`, isOverdue: false, isUrgent: true };
      } else {
        const diffDays = Math.round(diffHrs / 24);
        return { label: `Due in ${diffDays} day${diffDays > 1 ? 's' : ''}`, isOverdue: false };
      }
    } catch {
      return { label: dateStr, isOverdue: false };
    }
  };

  const pendingCount = assignments.filter((a) => a.status !== 'completed').length;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#121110] text-neutral-200 select-none overflow-hidden font-body-sm">
      {/* Top Header Bar */}
      <header className="px-5 py-3 border-b border-white/10 flex items-center justify-between bg-[#161514]/90 shrink-0 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/35 flex items-center justify-center text-purple-300 shadow-sm">
            <GraduationCap className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-headline-md font-bold text-neutral-100">Study & Assignments Hub</h2>
              <span className="text-[10px] font-mono-telemetry px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 font-bold">
                BTech CSE AI/ML
              </span>
              {pendingCount > 0 && (
                <span className="text-[10px] font-mono-telemetry px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
                  {pendingCount} PENDING
                </span>
              )}
            </div>
            <p className="text-[11px] text-neutral-400 font-mono-telemetry">
              Coursework Tracker • PyMuPDF Lab Linking • Autonomous Class Group Triage
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {triageFeed.length > 0 && (
            <button
              onClick={() => setIsTriageDrawerOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/35 text-xs font-mono-telemetry font-bold spring-pill transition-all animate-pulse"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Triage Feed ({triageFeed.length})</span>
            </button>
          )}

          <button
            onClick={() => setIsIngestModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 text-xs font-mono-telemetry spring-pill transition-all"
            title="Paste class WhatsApp or Telegram updates"
          >
            <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
            <span>Ingest Class Updates</span>
          </button>

          <button
            onClick={() => setIsSubjectsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 text-xs font-mono-telemetry spring-pill transition-all"
            title="Manage semester subjects"
          >
            <BookOpen className="w-3.5 h-3.5 text-purple-400" />
            <span>Subjects</span>
          </button>

          <button
            onClick={() => setIsAddAssignmentOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500 hover:bg-purple-600 text-white text-xs font-mono-telemetry font-bold spring-pill transition-all shadow-md active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Task</span>
          </button>
        </div>
      </header>

      {/* Subjects & Status Filter Bar */}
      <div className="px-5 py-2.5 border-b border-white/10 bg-[#141312]/70 flex items-center justify-between gap-4 shrink-0 font-mono-telemetry overflow-x-auto">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <button
            onClick={() => setSelectedSubject('all')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all spring-pill ${
              selectedSubject === 'all'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
            }`}
          >
            All Subjects
          </button>
          {subjects.map((sub) => (
            <button
              key={sub.id}
              onClick={() => setSelectedSubject(sub.name)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all spring-pill ${
                selectedSubject === sub.name
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              {sub.code}: {sub.name}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1 text-xs shrink-0">
          {['all', 'pending', 'in_progress', 'completed'].map((st) => (
            <button
              key={st}
              onClick={() => setSelectedStatus(st)}
              className={`px-2.5 py-1 rounded-lg uppercase tracking-wider text-[10px] font-bold transition-all ${
                selectedStatus === st
                  ? 'bg-white/10 text-white border border-white/20'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {st.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Assignment Cards */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-neutral-500 font-mono-telemetry text-xs">
            Loading coursework...
          </div>
        ) : assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6 border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3">
              <img src="/assets/duck-avatar.svg" alt="Duckuu" className="w-7 h-7 object-contain" />
            </div>
            <h4 className="text-sm font-headline-md font-bold text-neutral-200">No Coursework Found</h4>
            <p className="text-xs text-neutral-400 max-w-sm mt-1 mb-4 font-mono-telemetry">
              Track labs, projects, and assignments. Drag & drop a PDF directly onto any card for smart Duckuu summaries!
            </p>
            <button
              onClick={() => setIsAddAssignmentOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-mono-telemetry font-bold"
            >
              + Create Assignment
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assignments.map((a) => {
              const dueInfo = formatDueDate(a.due_date);
              const subjectObj = subjects.find((s) => s.name === a.subject);

              return (
                <div
                  key={a.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleCardFileDrop(e, a.id)}
                  onClick={() => setSelectedAssignment(a)}
                  className={`p-4 rounded-2xl bg-[#161514]/85 border transition-all cursor-pointer group flex flex-col justify-between shadow-sm relative overflow-hidden ${
                    selectedAssignment?.id === a.id
                      ? 'border-purple-500/80 ring-2 ring-purple-500/30'
                      : 'border-white/10 hover:border-purple-500/35'
                  }`}
                >
                  <div className="space-y-2">
                    {/* Top Row: Subject & Priority */}
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded-md border font-bold uppercase font-mono-telemetry ${getSubjectColorBadge(
                          subjectObj?.color
                        )}`}
                      >
                        {a.subject || 'General'}
                      </span>
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded-md border font-bold uppercase font-mono-telemetry ${getPriorityBadge(
                          a.priority
                        )}`}
                      >
                        {a.priority}
                      </span>
                    </div>

                    {/* Title & Description */}
                    <h3 className="font-bold text-sm text-neutral-100 group-hover:text-purple-300 transition-colors">
                      {a.title}
                    </h3>
                    {a.description && (
                      <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">
                        {a.description}
                      </p>
                    )}

                    {/* Attached PDF / Lab Notes Pill */}
                    {a.attachment_id ? (
                      <div className="p-2 rounded-xl bg-[#121110] border border-sky-500/25 flex items-center justify-between text-xs font-mono-telemetry mt-2">
                        <div className="flex items-center gap-2 truncate">
                          <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span className="truncate text-sky-200 text-[11px]">
                            {a.attachment_filename || a.attachment_title || 'Attached Notes'}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onBackToChat();
                            onAskAboutAssignment(
                              `Explain the key concepts and steps for this homework: "${a.title}" from ${a.subject}.`
                            );
                          }}
                          className="px-2 py-0.5 rounded-md bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/35 text-[10px] font-bold shrink-0 ml-2"
                        >
                          Ask Duckuu
                        </button>
                      </div>
                    ) : (
                      <div className="p-2 border border-dashed border-white/10 rounded-xl text-[10px] text-neutral-500 font-mono-telemetry flex items-center justify-center gap-1.5 group-hover:border-purple-500/30">
                        <UploadCloud className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Drop PDF/Notes here to summarize & link</span>
                      </div>
                    )}
                  </div>

                  {/* Bottom Footer: Due Date & Status Switcher */}
                  <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] font-mono-telemetry">
                    <div className="flex items-center gap-1.5">
                      <Clock className={`w-3.5 h-3.5 ${dueInfo.isOverdue ? 'text-rose-400' : 'text-neutral-400'}`} />
                      <span className={dueInfo.isOverdue ? 'text-rose-400 font-bold' : 'text-neutral-300'}>
                        {dueInfo.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleStatus(a);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold spring-pill transition-all ${
                          a.status === 'completed'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : a.status === 'in_progress'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-white/5 text-neutral-400 border border-white/10 hover:text-white'
                        }`}
                      >
                        {a.status === 'completed'
                          ? '✓ Completed'
                          : a.status === 'in_progress'
                          ? '⏳ In Progress'
                          : '○ Pending'}
                      </button>

                      <button
                        onClick={(e) => handleDeleteAssignment(a.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-neutral-500 hover:text-rose-400 transition-opacity"
                        title="Delete task"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Create Personal Assignment */}
      {isAddAssignmentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#181716] border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-headline-md font-bold text-neutral-100 flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-purple-400" />
                <span>Add Assignment / Homework</span>
              </h3>
              <button
                onClick={() => setIsAddAssignmentOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateAssignment} className="space-y-3 text-xs font-mono-telemetry">
              <div>
                <label className="block text-neutral-400 mb-1">Task Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Lab 4: Transformers & Attention Mechanism"
                  value={newAssignment.title}
                  onChange={(e) => setNewAssignment({ ...newAssignment, title: e.target.value })}
                  className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-neutral-400 mb-1">Subject</label>
                  <select
                    value={newAssignment.subject}
                    onChange={(e) => setNewAssignment({ ...newAssignment, subject: e.target.value })}
                    className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  >
                    {subjects.map((sub) => (
                      <option key={sub.id} value={sub.name}>
                        {sub.code}: {sub.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-neutral-400 mb-1">Priority</label>
                  <select
                    value={newAssignment.priority}
                    onChange={(e) => setNewAssignment({ ...newAssignment, priority: e.target.value })}
                    className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-neutral-400 mb-1">Due Date & Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={newAssignment.due_date}
                  onChange={(e) => setNewAssignment({ ...newAssignment, due_date: e.target.value })}
                  className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-neutral-400 mb-1">Description / Requirements</label>
                <textarea
                  rows={3}
                  placeholder="Problem statement, submission link, or lab guidelines..."
                  value={newAssignment.description}
                  onChange={(e) => setNewAssignment({ ...newAssignment, description: e.target.value })}
                  className="w-full bg-[#121110] border border-white/15 rounded-xl p-3 text-white placeholder-neutral-600 focus:outline-none focus:border-purple-500 font-sans text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAddAssignmentOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold"
                >
                  Save Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Subjects & Semester Courses Manager */}
      {isSubjectsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-[#181716] border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-headline-md font-bold text-neutral-100 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-purple-400" />
                <span>Manage Semester Subjects</span>
              </h3>
              <button
                onClick={() => setIsSubjectsModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List of Subjects */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1 font-mono-telemetry text-xs">
              {subjects.map((sub) => (
                <div
                  key={sub.id}
                  className="p-2.5 rounded-xl bg-[#121110] border border-white/10 flex items-center justify-between"
                >
                  <div>
                    <span className="font-bold text-neutral-200">{sub.code}: </span>
                    <span className="text-neutral-300">{sub.name}</span>
                    {sub.instructor && (
                      <span className="text-[10px] text-neutral-500 ml-2">({sub.instructor})</span>
                    )}
                  </div>
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${getSubjectColorBadge(
                      sub.color
                    )}`}
                  >
                    {sub.color}
                  </span>
                </div>
              ))}
            </div>

            {/* Add Subject Form */}
            <form onSubmit={handleCreateSubject} className="pt-3 border-t border-white/10 space-y-2 text-xs font-mono-telemetry">
              <span className="font-bold text-neutral-300 block mb-1">Add Subject</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Subject Name (e.g. Computer Networks)"
                  value={newSubject.name}
                  onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })}
                  className="bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
                <input
                  type="text"
                  required
                  placeholder="Code (e.g. CS406)"
                  value={newSubject.code}
                  onChange={(e) => setNewSubject({ ...newSubject, code: e.target.value })}
                  className="bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold"
                >
                  + Add Course
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Ingest Class Group Chat Updates */}
      {isIngestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-[#181716] border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-headline-md font-bold text-neutral-100 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-sky-400" />
                <span>Autonomous Class Group Updates Ingestion</span>
              </h3>
              <button
                onClick={() => setIsIngestModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleIngestGroupText} className="space-y-3 text-xs font-mono-telemetry">
              <p className="text-[11px] text-neutral-400">
                Paste announcements, group chat exports, or teacher emails. Duckuu automatically extracts assignments and deadlines into your triage feed.
              </p>
              <textarea
                rows={6}
                required
                placeholder="Example:&#10;Prof. Sharma: Attention students! Lab 4 on Neural Networks submission deadline is this Friday at 11:59 PM. Please make sure to submit your Jupyter notebooks."
                value={ingestText}
                onChange={(e) => setIngestText(e.target.value)}
                className="w-full bg-[#121110] border border-white/15 rounded-xl p-3 text-white placeholder-neutral-600 focus:outline-none focus:border-sky-500 font-sans text-xs"
              />
              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsIngestModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isIngesting}
                  className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold"
                >
                  {isIngesting ? 'Parsing...' : 'Ingest & Triage'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Drawer: Triage Feed */}
      {isTriageDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-lg h-full bg-[#161514] border-l border-white/15 p-5 shadow-2xl flex flex-col justify-between overflow-hidden">
            <div>
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-headline-md font-bold text-neutral-100">
                    Class Group Triage Feed ({triageFeed.length})
                  </h3>
                </div>
                <button
                  onClick={() => setIsTriageDrawerOpen(false)}
                  className="p-1 text-neutral-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-neutral-400 font-mono-telemetry mb-3">
                Detected assignments and deadlines from class group chats. Click &apos;Add to My Tasks&apos; to track in your dashboard.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 font-mono-telemetry">
              {triageFeed.length === 0 ? (
                <div className="text-center py-16 text-neutral-500 text-xs">
                  All caught up! No pending triage items.
                </div>
              ) : (
                triageFeed.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl bg-[#1C1B1A] border border-white/10 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-neutral-200">
                        {item.detected_title || 'Detected Homework'}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          item.urgency === 'urgent'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/35'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/35'
                        }`}
                      >
                        {item.urgency}
                      </span>
                    </div>

                    <div className="text-[10px] text-neutral-400">
                      Subject: <span className="text-purple-300 font-bold">{item.detected_subject || 'General'}</span>
                    </div>

                    <div className="p-2 rounded bg-[#121110] text-[11px] text-neutral-300 font-sans line-clamp-2">
                      &quot;{item.raw_text}&quot;
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        onClick={() => handleConvertTriage(item.id)}
                        className="px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold spring-pill transition-all"
                      >
                        + Add to My Tasks
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setIsTriageDrawerOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-white/10 text-neutral-200 text-xs font-mono-telemetry"
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
