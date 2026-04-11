import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, AlertCircle, Filter, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FunctionalGap, CoverageReport, GapType } from '../types';
import { functionalApi } from '../services/api';
import GapDrillDown from './GapDrillDown';
import FunctionalCoverageDashboard from './FunctionalCoverageDashboard';

interface GapExplorerProps {
  projectId: string;
  runId: string;
}

const GAP_TYPE_BADGE: Record<GapType, string> = {
  unchanged: 'bg-slate-100 text-slate-700 border-slate-200',
  modified:  'bg-amber-50 text-amber-700 border-amber-200',
  missing:   'bg-red-50 text-red-700 border-red-200',
  new:       'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function confidenceColor(c: number | null): string {
  if (c === null) return 'text-text-muted';
  if (c >= 0.8) return 'text-emerald-600';
  if (c >= 0.5) return 'text-amber-600';
  return 'text-red-500';
}

const GAP_FILTER_TABS: Array<{ key: GapType | 'all'; labelKey: string }> = [
  { key: 'all',       labelKey: 'gapAnalysis.gaps.all'       },
  { key: 'modified',  labelKey: 'gapAnalysis.gaps.modified'  },
  { key: 'missing',   labelKey: 'gapAnalysis.gaps.missing'   },
  { key: 'new',       labelKey: 'gapAnalysis.gaps.new'       },
  { key: 'unchanged', labelKey: 'gapAnalysis.gaps.unchanged' },
];

export default function GapExplorer({ projectId, runId }: GapExplorerProps) {
  const { t } = useTranslation();
  const [gaps, setGaps] = useState<FunctionalGap[]>([]);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState<GapType | 'all'>('all');
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);
  const [selectedGap, setSelectedGap] = useState<FunctionalGap | null>(null);

  const load = useCallback(async () => {
    try {
      const [gapData, coverageData] = await Promise.all([
        functionalApi.listGaps(projectId, runId),
        functionalApi.getCoverage(projectId, runId).catch(() => null),
      ]);
      setGaps(gapData);
      setCoverage(coverageData);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const countsByType = useMemo(() => {
    const counts: Partial<Record<GapType, number>> = {};
    for (const g of gaps) counts[g.gap_type] = (counts[g.gap_type] ?? 0) + 1;
    return counts;
  }, [gaps]);

  const countByType = (type: GapType | 'all') =>
    type === 'all' ? gaps.length : (countsByType[type] ?? 0);

  const filtered = useMemo(
    () =>
      gaps.filter(g => {
        if (filterType !== 'all' && g.gap_type !== filterType) return false;
        if (highConfidenceOnly && (g.confidence ?? 0) < 0.8) return false;
        return true;
      }),
    [gaps, filterType, highConfidenceOnly],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-text-muted">
        <Loader2 size={16} className="animate-spin text-purple-deep" />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-xs py-4">
        <AlertCircle size={13} /> {error}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {coverage && <FunctionalCoverageDashboard coverage={coverage} />}

        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">
            {t('gapAnalysis.gaps.title')}
          </h3>

          <div className="flex items-center gap-1 flex-wrap">
            {GAP_FILTER_TABS.map(({ key, labelKey }) => (
              <button
                key={key}
                onClick={() => setFilterType(key)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  filterType === key
                    ? 'bg-purple-deep text-white border-purple-deep'
                    : 'bg-white border-surface-border text-text-secondary hover:border-purple-deep/40'
                }`}
              >
                {t(labelKey as Parameters<typeof t>[0])}
                <span className="ml-1.5 opacity-70">({countByType(key)})</span>
              </button>
            ))}

            <label className="flex items-center gap-1.5 text-xs text-text-secondary ml-auto cursor-pointer">
              <input
                type="checkbox"
                checked={highConfidenceOnly}
                onChange={e => setHighConfidenceOnly(e.target.checked)}
                className="rounded border-surface-border text-purple-deep focus:ring-purple-deep/20"
              />
              <Filter size={11} />
              {t('gapAnalysis.gaps.filterByConfidence')}
            </label>
          </div>

          {filtered.length === 0 ? (
            <p className="text-xs text-text-muted py-4 text-center">
              {t('gapAnalysis.gaps.noGaps')}
            </p>
          ) : (
            <div className="divide-y divide-surface-border">
              {filtered.map(gap => (
                <button
                  key={gap.id}
                  onClick={() => setSelectedGap(gap)}
                  className="w-full flex items-center gap-3 py-3 text-left hover:bg-surface/50 transition-colors group"
                >
                  <span
                    className={`badge border text-[11px] shrink-0 ${GAP_TYPE_BADGE[gap.gap_type]}`}
                  >
                    {t(`gapAnalysis.gapTypes.${gap.gap_type}` as Parameters<typeof t>[0])}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">
                      {gap.explanation ?? gap.gap_type}
                    </p>
                    {gap.as_is_section && (
                      <p className="text-[11px] text-text-muted truncate mt-0.5">
                        § {gap.as_is_section}
                      </p>
                    )}
                  </div>
                  {gap.confidence !== null && (
                    <span
                      className={`text-xs font-medium shrink-0 ${confidenceColor(gap.confidence)}`}
                    >
                      {Math.round(gap.confidence * 100)}%
                    </span>
                  )}
                  <ChevronRight
                    size={13}
                    className="text-text-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedGap && (
        <GapDrillDown
          gap={selectedGap}
          projectId={projectId}
          runId={runId}
          onClose={() => setSelectedGap(null)}
        />
      )}
    </>
  );
}
