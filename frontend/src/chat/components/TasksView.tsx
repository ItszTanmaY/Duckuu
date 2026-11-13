import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckSquare,
  Plus,
  Clock,
  CheckCircle2,
  Trash2,
  X,
  BellRing,
  FileText
} from 'lucide-react';
import { Assignment, StudentAssignment } from '@/types/api';
import { apiFetch } from '@/config/api';

interface TasksViewProps {
  onBackToChat: () => void;
  onSendChatMessage?: (msg: string) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({ onBackToChat }) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedBatch, setSelectedBatch] = useState<string>('all');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedAssignmentDetails, setSelectedAssignmentDetails] = useState<{
    assignment: Assignment;
    students: StudentAssignment[];
    total_assigned?: number;
    pending_count?: number;
  } | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // New Assignment Form
  const [newAssignment, setNewAssignment] = useState({
    title: '',
    description: '',
    course_batch: 'CS101-A',
    due_date: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 16),
    priority: 'medium',
    status: 'pending'
  });

  const [checkingDeadlines, setCheckingDeadlines] = useState(false);
  const [deadlineAlertCount, setDeadlineAlertCount] = useState<number | null>(null);

  const fetchAssignments = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedBatch !== 'all') {
        params.set('batch', selectedBatch);
      }
      if (filterStatus !== 'all') {
        params.set('status', filterStatus);
      }
      const path = `/api/assignments${params.toString() ? '?' + params.toString() : ''}`;
      const res = await apiFetch(path);
      if (res.ok) {
        const data = await res.json();
        setAssignments(data.assignments || []);
      }
    } catch (err) {
      console.error('Failed to load assignments:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedBatch, filterStatus]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

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
        setIsAddModalOpen(false);
        setNewAssignment({
          title: '',
          description: '',
          course_batch: 'CS101-A',
          due_date: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 16),
          priority: 'medium',
          status: 'pending'
        });
        fetchAssignments();
      }
    } catch (err) {
      console.error('Error creating assignment:', err);
    }
  };

  const handleDeleteAssignment = async (id: string) => {
    if (!confirm('Are you sure you want to delete this assignment?')) return;
    try {
      const res = await apiFetch(`/api/assignments/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setAssignments((prev) => prev.filter((a) => a.id !== id));
        if (selectedAssignmentDetails?.assignment.id === id) {
          setIsDetailsOpen(false);
        }
      }
    } catch (err) {
      console.error('Failed to delete assignment:', err);
    }
  };

  const handleViewDetails = async (id: string) => {
    try {
      const res = await apiFetch(`/api/assignments/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedAssignmentDetails(data);
        setIsDetailsOpen(true);
      }
    } catch (err) {
      console.error('Failed to fetch assignment details:', err);
    }
  };

  const handleToggleSubmission = async (
    assignmentId: string,
    studentId: string,
    currentStatus: string
  ) => {
    const nextStatus = currentStatus === 'pending' ? 'submitted' : 'pending';
    try {
      const res = await apiFetch(
        `/api/assignments/${assignmentId}/students/${studentId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submission_status: nextStatus })
        }
      );
      if (res.ok) {
        // Update local detail state
        if (selectedAssignmentDetails) {
          setSelectedAssignmentDetails((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              students: prev.students.map((s) =>
                s.student_id === studentId ? { ...s, submission_status: nextStatus as any } : s
              ),
              pending_count:
                nextStatus === 'submitted'
                  ? (prev.pending_count || 1) - 1
                  : (prev.pending_count || 0) + 1
            };
          });
        }
        fetchAssignments();
      }
    } catch (err) {
      console.error('Failed to update submission status:', err);
    }
  };

  const handleTriggerDeadlineCheck = async () => {
    setCheckingDeadlines(true);
    try {
      const res = await apiFetch('/api/assignments/check-deadlines', {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setDeadlineAlertCount(data.alerts_found || 0);
        setTimeout(() => setDeadlineAlertCount(null), 5000);
      }
    } catch (err) {
      console.error('Error triggering deadline check:', err);
    } finally {
      setCheckingDeadlines(false);
    }
  };

  const batches = Array.from(new Set(assignments.map((a) => a.course_batch))).filter((b): b is string => Boolean(b));

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/35';
      case 'high':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/35';
      case 'low':
        return 'bg-neutral-500/20 text-neutral-400 border-neutral-500/35';
      default:
        return 'bg-sky-500/20 text-sky-300 border-sky-500/35';
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
        return { label: `Due in ${diffHrs} hours`, isOverdue: false, isUrgent: true };
      } else {
        const diffDays = Math.round(diffHrs / 24);
        return { label: `Due in ${diffDays} day${diffDays > 1 ? 's' : ''}`, isOverdue: false };
      }
    } catch {
      return { label: dateStr, isOverdue: false };
    }
  };

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
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <CheckSquare className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-headline-md font-bold text-neutral-100">Tasks & Assignments</h2>
              <span className="text-[10px] font-mono-telemetry px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                {assignments.length} ACTIVE
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 font-mono-telemetry">
              Coursework Tracker & Automated APScheduler Urgency Monitor
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleTriggerDeadlineCheck}
            disabled={checkingDeadlines}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10 text-xs font-mono-telemetry spring-pill transition-all"
            title="Scan assignments for upcoming deadlines (<24h)"
          >
            <BellRing className={`w-3.5 h-3.5 ${checkingDeadlines ? 'animate-spin text-amber-400' : 'text-amber-400'}`} />
            <span>
              {checkingDeadlines
                ? 'Scanning...'
                : deadlineAlertCount !== null
                ? `Alerts: ${deadlineAlertCount}`
                : 'Check Deadlines'}
            </span>
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-mono-telemetry font-bold spring-pill transition-all shadow-md active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Assignment</span>
          </button>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="px-5 py-2.5 border-b border-white/10 bg-[#141312]/60 flex items-center justify-between gap-4 shrink-0 font-mono-telemetry">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setSelectedBatch('all')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all spring-pill ${
              selectedBatch === 'all'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
            }`}
          >
            All Batches
          </button>
          {batches.map((batch) => (
            <button
              key={batch}
              onClick={() => setSelectedBatch(batch)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all spring-pill ${
                selectedBatch === batch
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              {batch}
            </button>
          ))}
        </div>

        {/* Priority / Status Selector */}
        <div className="flex items-center gap-1 text-xs">
          {['all', 'pending', 'completed'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-2.5 py-1 rounded-lg uppercase tracking-wider text-[10px] font-bold transition-all ${
                filterStatus === status
                  ? 'bg-white/10 text-white border border-white/20'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Assignments List */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-neutral-500 font-mono-telemetry text-xs">
            Loading assignments...
          </div>
        ) : assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6 border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
              <FileText className="w-6 h-6 text-emerald-400" />
            </div>
            <h4 className="text-sm font-headline-md font-bold text-neutral-200">No Assignments Found</h4>
            <p className="text-xs text-neutral-400 max-w-sm mt-1 mb-4 font-mono-telemetry">
              Create an assignment to automatically assign it to your student roster and monitor deadlines.
            </p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-mono-telemetry font-bold"
            >
              + Create Assignment
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {assignments.map((a) => {
              const dueInfo = formatDueDate(a.due_date);
              const total = a.total_students || 0;
              const pending = a.pending_count || 0;
              const submitted = a.submitted_count || 0;
              const percent = total > 0 ? Math.round((submitted / total) * 100) : 0;

              return (
                <div
                  key={a.id}
                  onClick={() => handleViewDetails(a.id)}
                  className="p-4 rounded-2xl bg-[#161514] border border-white/10 hover:border-white/20 transition-all cursor-pointer group flex flex-col justify-between shadow-sm"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded-md border font-bold uppercase font-mono-telemetry ${getPriorityBadge(
                          a.priority
                        )}`}
                      >
                        {a.priority}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-neutral-300 font-mono-telemetry font-bold">
                        {a.course_batch}
                      </span>
                    </div>

                    <h3 className="font-bold text-sm text-neutral-100 group-hover:text-emerald-300 transition-colors">
                      {a.title}
                    </h3>
                    {a.description && (
                      <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">
                        {a.description}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/5 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono-telemetry">
                      <div className="flex items-center gap-1.5">
                        <Clock className={`w-3.5 h-3.5 ${dueInfo.isOverdue ? 'text-rose-400' : 'text-neutral-400'}`} />
                        <span className={dueInfo.isOverdue ? 'text-rose-400 font-bold' : 'text-neutral-300'}>
                          {dueInfo.label}
                        </span>
                      </div>
                      <span className="text-neutral-400">
                        {submitted}/{total} Submitted ({percent}%, {pending} pending)
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          percent === 100 ? 'bg-emerald-400' : 'bg-emerald-500/80'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-neutral-500 font-mono-telemetry">
                        Click card to manage submissions
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAssignment(a.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-rose-400 text-neutral-500 transition-opacity"
                        title="Delete assignment"
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

      {/* Modal: Create Assignment */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#181716] border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-headline-md font-bold text-neutral-100 flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-emerald-400" />
                <span>Create New Assignment</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateAssignment} className="space-y-3 text-xs font-mono-telemetry">
              <div>
                <label className="block text-neutral-400 mb-1">Assignment Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Lab 4: Binary Search Trees"
                  value={newAssignment.title}
                  onChange={(e) => setNewAssignment({ ...newAssignment, title: e.target.value })}
                  className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-neutral-400 mb-1">Instructions / Description</label>
                <textarea
                  rows={3}
                  placeholder="Details, rubric, or submission requirements..."
                  value={newAssignment.description}
                  onChange={(e) => setNewAssignment({ ...newAssignment, description: e.target.value })}
                  className="w-full bg-[#121110] border border-white/15 rounded-xl p-3 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 font-sans text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-neutral-400 mb-1">Course Batch</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CS101-A or all"
                    value={newAssignment.course_batch}
                    onChange={(e) => setNewAssignment({ ...newAssignment, course_batch: e.target.value })}
                    className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-neutral-400 mb-1">Priority</label>
                  <select
                    value={newAssignment.priority}
                    onChange={(e) => setNewAssignment({ ...newAssignment, priority: e.target.value })}
                    className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
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
                  className="w-full bg-[#121110] border border-white/15 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
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
                  className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold"
                >
                  Create & Auto-Assign
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Drawer: Assignment Student Breakdown */}
      {isDetailsOpen && selectedAssignmentDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-lg h-full bg-[#161514] border-l border-white/15 p-5 shadow-2xl flex flex-col justify-between overflow-hidden">
            <div>
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
                <div>
                  <h3 className="text-sm font-headline-md font-bold text-neutral-100">
                    {selectedAssignmentDetails.assignment.title}
                  </h3>
                  <p className="text-[11px] text-neutral-400 font-mono-telemetry">
                    Batch: {selectedAssignmentDetails.assignment.course_batch} • Due:{' '}
                    {selectedAssignmentDetails.assignment.due_date.slice(0, 10)}
                  </p>
                </div>
                <button
                  onClick={() => setIsDetailsOpen(false)}
                  className="p-1 text-neutral-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[#1C1B1A] border border-white/5 mb-4 font-mono-telemetry text-xs">
                <div>
                  <span className="text-neutral-400">Total Enrolled: </span>
                  <span className="font-bold text-neutral-100">{selectedAssignmentDetails.total_assigned}</span>
                </div>
                <div>
                  <span className="text-amber-400 font-bold">
                    {selectedAssignmentDetails.pending_count} Pending
                  </span>
                </div>
              </div>
            </div>

            {/* Student Submission Rows */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono-telemetry">
              {selectedAssignmentDetails.students.map((student) => {
                const isSubmitted = student.submission_status === 'submitted' || student.submission_status === 'graded';
                return (
                  <div
                    key={student.student_id}
                    className="p-3 rounded-xl bg-[#1A1918] border border-white/5 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-sans font-bold text-neutral-200">{student.student_name}</div>
                      <div className="text-[10px] text-neutral-500">{student.phone}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          handleToggleSubmission(
                            selectedAssignmentDetails.assignment.id,
                            student.student_id,
                            student.submission_status
                          )
                        }
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold spring-pill transition-all ${
                          isSubmitted
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {isSubmitted ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>Submitted</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3 text-amber-400" />
                            <span>Mark as Done</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-white/10 flex justify-between items-center shrink-0">
              <span className="text-[11px] text-neutral-500 font-mono-telemetry">
                Click status button to toggle submission state
              </span>
              <button
                onClick={() => setIsDetailsOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-neutral-200 text-xs font-mono-telemetry"
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
