import { useState } from 'react';
import { Clock, CheckCircle2, AlertCircle, Loader2, Trash2, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FunctionalAnalysisRun, FunctionalRunStatus } from '../types';

interface VersionTimelineProps {
  runs: FunctionalAnalysisRun[];
  selectedRunId: string | null;
  onSelectRun: (run: FunctionalAnalysisRun) => void;
  onDeleteRun: (runId: string) => void;
}

function StatusIcon({ status }: { status: FunctionalRunStatus }) {
  if (status === 'done') return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
  if (status === 'error') return <AlertCircle size={14} className="text-red-500 shrink-0" />;
  return <Loader2 size={14} className="animate-spin text-purple-deep shrink-0" />;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function VersionTimeline({ runs, selectedRunId, onSelectRun, onDeleteRun }: VersionTimelineProps) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState<string | null>(null);

  if (runs.length === 0) return null;

  const handleDelete = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    if (!confirm(t('gapAnalysis.deleteRunConfirm'))) return;
    setDeleting(runId);
    try { await onDeleteRun(runId); } finally { setDeleting(null); }
  };

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-3">{t('gapAnalysis.timeline.title')}</h3>
      <div className="space-y-2">
        {runs.map(run => {
          const isSelected = run.id === selectedRunId;
          const coveragePct =
            run.coverage_score !== null && run.coverage_score !== undefined
              ? Math.round(run.coverage_score * 100)
              : null;
          return (
            <div
              key={run.id}
              onClick={() => run.status === 'done' && onSelectRun(run)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-sm ${
                isSelected
                  ? 'border-purple-deep bg-brand-50'
                  : 'border-surface-border bg-white hover:border-brand-200 hover:shadow-card'
              } ${run.status === 'done' ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <StatusIcon status={run.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-text-primary">
                    {t('gapAnalysis.timeline.run')} {runs.length - runs.indexOf(run)}
                  </span>
                  {coveragePct !== null && run.status === 'done' && (
                    <span className="badge bg-purple-50 text-purple-deep border border-purple-200 text-[11px]">
                      {coveragePct}% {t('gapAnalysis.timeline.coverage').toLowerCase()}
                    </span>
                  )}
                  {run.confirmed_gap_count !== undefined && run.status === 'done' && (
                    <span className="text-[11px] text-text-muted">
                      {run.confirmed_gap_count} {t('gapAnalysis.timeline.gaps').toLowerCase()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-text-muted">
                  <Clock size={10} />
                  {formatDate(run.created_at)}
                  {run.progress_step && run.status !== 'done' && run.status !== 'error' && (
                    <span className="ml-1 text-purple-deep">· {run.progress_step}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {run.status === 'done' && (
                  <button
                    onClick={() => onSelectRun(run)}
                    className="text-text-muted hover:text-purple-deep transition-colors p-1"
                    title={t('gapAnalysis.timeline.viewRun')}
                  >
                    <Eye size={13} />
                  </button>
                )}
                <button
                  onClick={e => handleDelete(e, run.id)}
                  disabled={deleting === run.id}
                  className="text-text-muted hover:text-red-500 transition-colors p-1 disabled:opacity-50"
                  title={t('gapAnalysis.timeline.deleteRun')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
