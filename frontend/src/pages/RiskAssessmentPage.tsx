import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Upload, Loader2, AlertCircle, CheckCircle2,
  Trash2, Clock, ShieldAlert, ShieldCheck, ShieldX, FileSpreadsheet
} from 'lucide-react';
import type { RiskAssessment, RiskAssessmentResult } from '../types';
import { riskApi } from '../services/api';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function RiskBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const cls = level === 'high' ? 'badge-high' : level === 'medium' ? 'badge-medium' : 'badge-low';
  const Icon = level === 'high' ? ShieldX : level === 'medium' ? ShieldAlert : ShieldCheck;
  return (
    <span className={`badge ${cls} gap-1`}>
      <Icon size={10} />
      {level.charAt(0).toUpperCase() + level.slice(1)} Risk
    </span>
  );
}

function HorizontalBar({ name, count, percentage, color }: { name: string; count: number; percentage: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-secondary w-44 shrink-0 truncate" title={name}>{name}</span>
      <div className="flex-1 bg-surface rounded-full h-5 overflow-hidden">
        <div
          className={`h-full ${color} rounded-full flex items-center justify-end pr-2 transition-all duration-500`}
          style={{ width: `${Math.max(percentage, 4)}%` }}
        >
          <span className="text-[10px] text-white font-semibold">{count}</span>
        </div>
      </div>
      <span className="text-xs text-text-muted w-10 text-right shrink-0">{percentage}%</span>
    </div>
  );
}

function priorityColor(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes('critical') || p.includes('blocker') || p.includes('high') || p === '1') return 'bg-red-500';
  if (p.includes('medium') || p.includes('major') || p === '2') return 'bg-amber-500';
  if (p.includes('minor') || p.includes('low') || p === '3') return 'bg-yellow-400';
  return 'bg-slate-400';
}

function RiskResults({ result }: { result: RiskAssessmentResult }) {
  return (
    <div className="space-y-6 max-w-4xl animate-fade-in">

      {/* Overall risk + summary */}
      <div className="card p-6 flex items-start gap-4">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
          result.overallRiskLevel === 'high' ? 'bg-red-50' :
          result.overallRiskLevel === 'medium' ? 'bg-amber-50' : 'bg-emerald-50'
        }`}>
          {result.overallRiskLevel === 'high' ? <ShieldX size={26} className="text-red-500" /> :
           result.overallRiskLevel === 'medium' ? <ShieldAlert size={26} className="text-amber-500" /> :
           <ShieldCheck size={26} className="text-emerald-500" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-sm font-semibold text-text-primary">Overall Risk Assessment</h3>
            <RiskBadge level={result.overallRiskLevel} />
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">{result.summary}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Defect categories */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-4">Defect Categories</h3>
          <div className="space-y-2.5">
            {result.defectCategories.map(cat => (
              <HorizontalBar
                key={cat.name}
                name={cat.name}
                count={cat.count}
                percentage={cat.percentage}
                color="bg-purple-deep"
              />
            ))}
          </div>
        </div>

        {/* Priority distribution */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-4">Priority Distribution</h3>
          <div className="space-y-2.5">
            {result.priorityDistribution.map(p => (
              <HorizontalBar
                key={p.priority}
                name={p.priority}
                count={p.count}
                percentage={p.percentage}
                color={priorityColor(p.priority)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Top defects */}
      {result.topDefects.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-border">
            <h3 className="text-sm font-semibold text-text-primary">Top Recurring Issues</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-text-muted">Issue</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Category</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Priority</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold text-text-muted">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {result.topDefects.map((d, i) => (
                <tr key={i} className="hover:bg-surface-hover transition-colors">
                  <td className="px-5 py-3 font-medium text-text-primary">{d.title}</td>
                  <td className="px-4 py-3 text-text-secondary text-xs">{d.category}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${priorityColor(d.priority)}`} />
                    <span className="text-xs text-text-secondary">{d.priority}</span>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-purple-deep">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
  );
}

export default function RiskAssessmentPage() {
  const { id } = useParams<{ id: string }>();

  const [assessments, setAssessments] = useState<RiskAssessment[]>([]);
  const [selected, setSelected] = useState<RiskAssessment | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [running, setRunning] = useState(false);

  // Upload form
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

  // Poll if there's a running assessment
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
        } else {
          // Update selected if it's the running one (to show progress_step)
          if (selected?.id === stillRunning.id) {
            setSelected(stillRunning);
          }
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

  const selectedResult: RiskAssessmentResult | null = (() => {
    if (!selected?.result_json) return null;
    try { return JSON.parse(selected.result_json) as RiskAssessmentResult; } catch { return null; }
  })();

  const currentRunning = assessments.find(a => a.status === 'running');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-surface-border bg-white px-8 py-5">
        <div className="flex items-center gap-1.5 text-xs text-text-muted mb-2">
          <Link to="/" className="hover:text-text-primary transition-colors">Projects</Link>
          <span>/</span>
          <Link to={`/projects/${id}`} className="hover:text-text-primary transition-colors">Project</Link>
          <span>/</span>
          <span className="text-text-secondary">Risk Assessment</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to={`/projects/${id}`} className="btn-secondary text-sm py-1.5 px-3">
              <ArrowLeft size={14} /> Back
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <ShieldAlert size={20} className="text-purple-deep" />
                Risk Assessment
              </h1>
              <p className="text-sm text-text-muted mt-0.5">Analyze historical defects to prevent issues in new deployments</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-80 xl:w-96 shrink-0 border-r border-surface-border overflow-y-auto bg-white">
          {/* Upload form */}
          <div className="p-5 border-b border-surface-border space-y-4">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">New Assessment</p>

            {/* File drop zone */}
            {!file ? (
              <label
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                  isDragging ? 'border-purple-deep bg-brand-50' : 'border-slate-200 bg-slate-50/50 hover:border-purple-deep/50'
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
                <Upload size={16} className="text-text-muted" />
                <p className="text-xs text-text-secondary text-center">
                  Drop your <strong>ALM defect export</strong> here<br />
                  <span className="text-text-muted">Excel (.xlsx, .xls) or CSV</span>
                </p>
              </label>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-surface-border text-sm">
                <FileSpreadsheet size={14} className="text-emerald-500 shrink-0" />
                <span className="flex-1 truncate text-text-secondary font-medium">{file.name}</span>
                <button onClick={() => setFile(null)} className="text-text-muted hover:text-red-500 transition-colors">
                  <AlertCircle size={13} />
                </button>
              </div>
            )}

            <div className="space-y-2">
              <div>
                <label className="label">Source (where defects come from)</label>
                <input
                  className="input text-sm"
                  placeholder="e.g. KFC Austria"
                  value={sourceContext}
                  onChange={e => setSourceContext(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Target (new deployment)</label>
                <input
                  className="input text-sm"
                  placeholder="e.g. KFC Slovakia"
                  value={targetContext}
                  onChange={e => setTargetContext(e.target.value)}
                />
              </div>
            </div>

            {uploadError && (
              <div className="flex items-center gap-2 text-red-500 text-xs">
                <AlertCircle size={13} /> {uploadError}
              </div>
            )}

            <button
              onClick={handleRun}
              disabled={!file || running}
              className="btn-primary w-full justify-center text-sm"
            >
              {running ? (
                <><Loader2 size={14} className="animate-spin" /> Running…</>
              ) : (
                <><ShieldAlert size={14} /> Run Risk Assessment</>
              )}
            </button>
          </div>

          {/* Past assessments */}
          <div className="p-5 space-y-2">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">History</p>
            {loadingList ? (
              <div className="flex items-center gap-2 text-text-muted text-xs py-3">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            ) : assessments.length === 0 ? (
              <p className="text-xs text-text-muted py-3">No assessments yet.</p>
            ) : (
              assessments.map(a => {
                const isSelected = selected?.id === a.id;
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
                      <span className="text-xs font-semibold text-text-primary">{a.version_name}</span>
                      <div className="flex items-center gap-1">
                        {a.status === 'done' && <CheckCircle2 size={13} className="text-emerald-500" />}
                        {a.status === 'running' && <Loader2 size={13} className="animate-spin text-amber-500" />}
                        {a.status === 'error' && <AlertCircle size={13} className="text-red-500" />}
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
                      {a.defect_count != null && <span className="ml-1">· {a.defect_count} defects</span>}
                    </div>
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

        {/* Right panel — results */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Running state */}
          {currentRunning && selected?.id === currentRunning.id && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-text-muted animate-fade-in">
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
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <AlertCircle size={28} className="text-red-400" />
              <p className="text-sm font-medium text-text-primary">Assessment failed</p>
              <p className="text-xs text-text-muted max-w-sm text-center">{selected.error_message}</p>
            </div>
          )}

          {/* Empty */}
          {!selected && !currentRunning && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-text-muted">
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
            <RiskResults result={selectedResult} />
          )}
        </div>
      </div>
    </div>
  );
}
