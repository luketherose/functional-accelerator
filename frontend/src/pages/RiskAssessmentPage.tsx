import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Upload, Loader2, AlertCircle,
  Trash2, Clock, ShieldAlert, ShieldCheck, ShieldX, FileSpreadsheet, ArrowLeft
} from 'lucide-react';
import type { RiskAssessment, RiskAssessmentResult } from '../types';
import { riskApi } from '../services/api';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function priorityGroup(label: string): 'critical' | 'high' | 'medium' | 'low' {
  const p = label.toLowerCase();
  if (p.includes('critical') || p.includes('blocker') || p === '1') return 'critical';
  if (p.includes('high') || p.includes('major') || p === '2') return 'high';
  if (p.includes('medium') || p === '3') return 'medium';
  return 'low';
}

const GROUP_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#10b981',
  low: '#3b82f6',
};

function parseResult(a: RiskAssessment): RiskAssessmentResult | null {
  if (!a.result_json) return null;
  try { return JSON.parse(a.result_json) as RiskAssessmentResult; } catch { return null; }
}

function countByLevel(result: RiskAssessmentResult, level: 'high' | 'medium' | 'low'): number {
  return result.priorityDistribution
    .filter(p => {
      const g = priorityGroup(p.priority);
      if (level === 'high') return g === 'high' || g === 'critical';
      return g === level;
    })
    .reduce((s, p) => s + p.count, 0);
}

function historyHighRisk(a: RiskAssessment): number | null {
  const r = parseResult(a);
  if (!r) return null;
  return countByLevel(r, 'high');
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RiskAssessment['status'] }) {
  if (status === 'done') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">Complete</span>;
  if (status === 'running') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 flex items-center gap-1"><Loader2 size={9} className="animate-spin" />Running</span>;
  if (status === 'error') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700">Failed</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">Pending</span>;
}

function RiskBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const cls = level === 'high' ? 'badge-high' : level === 'medium' ? 'badge-medium' : 'badge-low';
  const Icon = level === 'high' ? ShieldX : level === 'medium' ? ShieldAlert : ShieldCheck;
  return <span className={`badge ${cls} gap-1`}><Icon size={10} />{level.charAt(0).toUpperCase() + level.slice(1)} Risk</span>;
}

function StatCard({ label, value, valueColor }: { label: string; value: number; valueColor?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueColor ?? 'text-text-primary'}`}>{value.toLocaleString()}</p>
    </div>
  );
}

const BAR_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

function VerticalBarChart({ categories }: { categories: { name: string; count: number }[] }) {
  const maxCount = Math.max(...categories.map(c => c.count), 1);
  const BAR_H = 100; // px

  return (
    <div>
      <div className="flex items-end justify-around gap-2 pt-4" style={{ height: BAR_H + 24 }}>
        {categories.map((cat, i) => (
          <div key={cat.name} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <span className="text-[10px] text-text-muted font-medium leading-none">{cat.count}</span>
            <div
              className="w-full rounded-t-sm transition-all duration-500"
              style={{
                height: `${Math.max((cat.count / maxCount) * BAR_H, 4)}px`,
                backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 justify-center">
        {categories.map((cat, i) => (
          <span key={cat.name} className="flex items-center gap-1 text-[10px] text-text-secondary">
            <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
            {cat.name.length > 14 ? cat.name.slice(0, 14) + '…' : cat.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function DonutChart({ segments }: { segments: { label: string; percentage: number; color: string }[] }) {
  const r = 44;
  const cx = 60;
  const cy = 60;
  const C = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth="16" />
        {segments.filter(s => s.percentage > 0).map((seg, i) => {
          const start = cumulative;
          cumulative += seg.percentage;
          return (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="16"
              strokeDasharray={`${(seg.percentage / 100) * C} ${C}`}
              strokeDashoffset={-((start / 100) * C)}
              transform="rotate(-90 60 60)"
            />
          );
        })}
      </svg>
      <div className="flex flex-col gap-2">
        {segments.map(seg => (
          <span key={seg.label} className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            {seg.label} ({seg.percentage}%)
          </span>
        ))}
      </div>
    </div>
  );
}

function priorityBadgeClass(priority: string): string {
  const g = priorityGroup(priority);
  if (g === 'critical' || g === 'high') return 'badge-high';
  if (g === 'medium') return 'badge-medium';
  return 'badge-low';
}

function RiskResults({ result, assessment }: { result: RiskAssessmentResult; assessment: RiskAssessment }) {
  const totalDefects = assessment.defect_count ?? result.defectCategories.reduce((s, c) => s + c.count, 0);
  const highCount = countByLevel(result, 'high');
  const medCount = countByLevel(result, 'medium');
  const lowCount = countByLevel(result, 'low');

  const donutSegments = result.priorityDistribution.map(d => ({
    label: d.priority,
    percentage: d.percentage,
    color: GROUP_COLOR[priorityGroup(d.priority)] ?? '#8b5cf6',
  }));

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Results header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border bg-white shrink-0">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{assessment.version_name} Results</h2>
          <p className="text-xs text-text-muted mt-0.5">Generated on {formatDate(assessment.created_at)}</p>
        </div>
        <RiskBadge level={result.overallRiskLevel} />
      </div>

      <div className="p-6 space-y-5">
        {/* Summary */}
        <p className="text-sm text-text-secondary leading-relaxed">{result.summary}</p>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total Defects" value={totalDefects} />
          <StatCard label="High Risk" value={highCount} valueColor="text-red-500" />
          <StatCard label="Medium Risk" value={medCount} valueColor="text-amber-500" />
          <StatCard label="Low Risk" value={lowCount} valueColor="text-emerald-500" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-1">Defects by Category</h3>
            <VerticalBarChart categories={result.defectCategories} />
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Risk Distribution</h3>
            <DonutChart segments={donutSegments} />
          </div>
        </div>

        {/* Top defects */}
        {result.topDefects.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-text-primary">Top Defects</h3>
            </div>
            <div className="divide-y divide-surface-border">
              {result.topDefects.map((d, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-hover transition-colors">
                  <div className="w-6 h-6 rounded-full bg-brand-50 border border-brand-200 text-purple-deep text-[10px] font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{d.title}</p>
                    <p className="text-[10px] text-text-muted">{d.category}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xl font-bold text-text-primary">{d.count}</span>
                    <span className={`badge text-[10px] py-0.5 ${priorityBadgeClass(d.priority)}`}>
                      {d.priority}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Patterns */}
        {result.patterns.length > 0 && (
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Observed Patterns & Root Causes</h3>
            <ul className="space-y-2">
              {result.patterns.map((p, i) => (
                <li key={i} className="flex gap-2 text-sm text-text-secondary">
                  <span className="text-purple-deep shrink-0 mt-0.5 font-bold">·</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Risk areas */}
        {result.riskAreas.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Risk Areas & Recommendations</h3>
            {result.riskAreas.map((area, i) => (
              <div key={i} className="card p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-text-primary flex-1">{area.area}</span>
                  <RiskBadge level={area.riskLevel} />
                </div>
                <p className="text-xs text-text-muted leading-relaxed">{area.rationale}</p>
                <div className="flex gap-2 pt-1">
                  <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide shrink-0 mt-0.5">Action</span>
                  <p className="text-xs text-text-secondary leading-relaxed">{area.recommendation}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RiskAssessmentPage() {
  const { id } = useParams<{ id: string }>();

  const [assessments, setAssessments] = useState<RiskAssessment[]>([]);
  const [selected, setSelected] = useState<RiskAssessment | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [running, setRunning] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [sourceContext, setSourceContext] = useState('');
  const [targetContext, setTargetContext] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAssessments = useCallback(async () => {
    if (!id) return;
    try {
      const list = await riskApi.list(id);
      setAssessments(list);
      if (!selected && list.length > 0 && list[0].status === 'done') {
        setSelected(list[0]);
      }
    } catch { /* ignore */ }
    finally { setLoadingList(false); }
  }, [id]);

  useEffect(() => { loadAssessments(); }, [loadAssessments]);

  useEffect(() => {
    const hasRunning = assessments.some(a => a.status === 'running');
    if (!hasRunning || !id) return;
    const interval = setInterval(async () => {
      try {
        const list = await riskApi.list(id);
        setAssessments(list);
        const stillRunning = list.find(a => a.status === 'running');
        if (!stillRunning) {
          setRunning(false);
          clearInterval(interval);
          const done = list.find(a => a.status === 'done');
          if (done) setSelected(done);
        } else if (selected?.id === stillRunning.id) {
          setSelected(stillRunning);
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [assessments, id, selected]);

  const handleRun = async () => {
    if (!id || !file) return;
    setRunning(true);
    setUploadError('');
    try {
      await riskApi.run(id, file, sourceContext.trim(), targetContext.trim());
      setFile(null);
      setSourceContext('');
      setTargetContext('');
      await loadAssessments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start assessment';
      setUploadError(msg);
      setRunning(false);
    }
  };

  const handleDelete = async (assessmentId: string) => {
    if (!id || !confirm('Delete this risk assessment?')) return;
    await riskApi.delete(id, assessmentId);
    if (selected?.id === assessmentId) setSelected(null);
    loadAssessments();
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const currentRunning = assessments.find(a => a.status === 'running');
  const selectedResult = selected ? parseResult(selected) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Minimal header */}
      <div className="border-b border-surface-border bg-white px-8 py-4 shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-text-muted mb-1.5">
          <Link to="/" className="hover:text-text-primary transition-colors">Projects</Link>
          <span>/</span>
          <Link to={`/projects/${id}`} className="hover:text-text-primary transition-colors">Project</Link>
          <span>/</span>
          <span className="text-text-secondary">Risk Assessment</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to={`/projects/${id}`} className="btn-secondary text-sm py-1.5 px-3">
            <ArrowLeft size={14} /> Back
          </Link>
          <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <ShieldAlert size={18} className="text-purple-deep" />
            Risk Assessment
          </h1>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel ── */}
        <div className="w-80 xl:w-96 shrink-0 border-r border-surface-border flex flex-col bg-white overflow-hidden">
          {/* Panel title */}
          <div className="px-5 py-4 border-b border-surface-border shrink-0">
            <h2 className="text-sm font-semibold text-text-primary">Risk Assessments</h2>
            <p className="text-xs text-text-muted mt-0.5">Upload files to analyze</p>
          </div>

          {/* Upload area */}
          <div className="px-5 py-4 border-b border-surface-border space-y-3 shrink-0">
            {!file ? (
              <label
                className={`flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                  isDragging ? 'border-purple-deep bg-brand-50' : 'border-slate-200 bg-slate-50/60 hover:border-purple-deep/50 hover:bg-brand-50/30'
                }`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); e.target.value = ''; }}
                />
                <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
                  <Upload size={18} className="text-purple-deep" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-text-secondary">Drop defect file here</p>
                  <p className="text-xs text-text-muted mt-0.5">CSV, XLSX, or JSON — Max 10MB</p>
                </div>
              </label>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-surface-border text-sm">
                <FileSpreadsheet size={14} className="text-emerald-500 shrink-0" />
                <span className="flex-1 truncate text-text-secondary font-medium text-xs">{file.name}</span>
                <button onClick={() => setFile(null)} className="text-text-muted hover:text-red-500 transition-colors">
                  <AlertCircle size={13} />
                </button>
              </div>
            )}

            {/* Context inputs — shown when file is selected */}
            {file && (
              <div className="space-y-2">
                <div>
                  <label className="label text-[10px]">Source (where defects come from)</label>
                  <input
                    className="input text-xs"
                    placeholder="e.g. KFC Austria"
                    value={sourceContext}
                    onChange={e => setSourceContext(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label text-[10px]">Target (new deployment)</label>
                  <input
                    className="input text-xs"
                    placeholder="e.g. KFC Slovakia"
                    value={targetContext}
                    onChange={e => setTargetContext(e.target.value)}
                  />
                </div>
              </div>
            )}

            {uploadError && (
              <div className="flex items-center gap-2 text-red-500 text-xs">
                <AlertCircle size={12} /> {uploadError}
              </div>
            )}

            <button
              onClick={handleRun}
              disabled={!file || running}
              className="btn-primary w-full justify-center text-sm"
            >
              {running
                ? <><Loader2 size={14} className="animate-spin" /> Running…</>
                : <><ShieldAlert size={14} /> Run Risk Assessment</>}
            </button>
          </div>

          {/* History */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">History</p>
            {loadingList ? (
              <div className="flex items-center gap-2 text-text-muted text-xs py-3">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            ) : assessments.length === 0 ? (
              <p className="text-xs text-text-muted py-3">No assessments yet.</p>
            ) : (
              assessments.map(a => {
                const isSelected = selected?.id === a.id;
                const highRisk = historyHighRisk(a);
                return (
                  <div
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-purple-deep bg-brand-50'
                        : 'border-surface-border bg-white hover:border-brand-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-text-primary truncate flex-1 mr-2">{a.version_name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <StatusBadge status={a.status} />
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(a.id); }}
                          className="text-text-muted hover:text-red-500 transition-colors ml-1"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-text-muted">
                      <Clock size={9} /> {formatDate(a.created_at)}
                    </div>
                    {a.defect_count != null && (
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-text-muted">
                        <span><span className="font-semibold text-text-secondary">{a.defect_count}</span> defects</span>
                        {highRisk != null && (
                          <span><span className="font-semibold text-red-500">{highRisk}</span> high risk</span>
                        )}
                      </div>
                    )}
                    {a.status === 'running' && a.progress_step && (
                      <p className="text-[10px] text-amber-600 mt-1">{a.progress_step}</p>
                    )}
                    {a.status === 'error' && a.error_message && (
                      <p className="text-[10px] text-red-500 mt-1 truncate">{a.error_message}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Running state */}
          {currentRunning && selected?.id === currentRunning.id && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center">
                <Loader2 size={26} className="animate-spin text-purple-deep" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-text-primary">Running risk assessment…</p>
                <p className="text-xs text-text-muted mt-1">{currentRunning.progress_step || 'Processing…'}</p>
              </div>
            </div>
          )}

          {/* Error */}
          {selected?.status === 'error' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <AlertCircle size={28} className="text-red-400" />
              <p className="text-sm font-medium text-text-primary">Assessment failed</p>
              <p className="text-xs text-text-muted max-w-sm text-center">{selected.error_message}</p>
            </div>
          )}

          {/* Empty */}
          {!selected && !currentRunning && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
              <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center">
                <ShieldAlert size={22} className="text-text-muted" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-text-primary">No assessment selected</p>
                <p className="text-xs text-text-muted mt-1 max-w-xs">
                  Upload an ALM defect export and run an assessment to preview risk.
                </p>
              </div>
            </div>
          )}

          {/* Results */}
          {selected?.status === 'done' && selectedResult && (
            <RiskResults result={selectedResult} assessment={selected} />
          )}
        </div>
      </div>
    </div>
  );
}
