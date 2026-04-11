import { useTranslation } from 'react-i18next';
import type { CoverageReport } from '../types';

interface FunctionalCoverageDashboardProps {
  coverage: CoverageReport;
}

const PCT = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

function MetricBar({
  label,
  count,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}) {
  const pct = PCT(count, total);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-text-secondary font-medium">{label}</span>
        <span className="text-text-muted">
          {count} <span className="text-text-muted/60">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 bg-surface rounded-full overflow-hidden border border-surface-border">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function FunctionalCoverageDashboard({
  coverage,
}: FunctionalCoverageDashboardProps) {
  const { t } = useTranslation();
  const scorePct = Math.round(coverage.coverage_score * 100);
  const total = coverage.total_as_is_components;

  const segments = [
    { key: 'unchanged', count: coverage.unchanged_count, color: 'bg-emerald-400' },
    { key: 'modified',  count: coverage.modified_count,  color: 'bg-amber-400'   },
    { key: 'missing',  count: coverage.missing_count,   color: 'bg-red-400'     },
    { key: 'new',      count: coverage.new_count,       color: 'bg-blue-400'    },
  ] as const;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t('gapAnalysis.coverage.title')}
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {t('gapAnalysis.coverage.subtitle')}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-purple-deep">{scorePct}%</div>
          <div className="text-xs text-text-muted">
            {t('gapAnalysis.coverage.score', { pct: scorePct })}
          </div>
        </div>
      </div>

      <div className="h-3 bg-surface rounded-full overflow-hidden border border-surface-border flex">
        {segments.map(({ key, count, color }) => (
          <div
            key={key}
            className={`h-full ${color} transition-all duration-500`}
            style={{ width: `${PCT(count, total)}%` }}
            title={t(`gapAnalysis.coverage.${key}` as Parameters<typeof t>[0])}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {segments.map(({ key, count, color }) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
            <span className="text-text-secondary">
              {t(`gapAnalysis.coverage.${key}` as Parameters<typeof t>[0])}
            </span>
            <span className="text-text-muted font-medium">{count}</span>
          </div>
        ))}
      </div>

      <div className="space-y-2 pt-1 border-t border-surface-border">
        {segments.map(({ key, count, color }) => (
          <MetricBar
            key={key}
            label={t(`gapAnalysis.coverage.${key}` as Parameters<typeof t>[0])}
            count={count}
            total={total}
            colorClass={color}
          />
        ))}
      </div>
    </div>
  );
}
