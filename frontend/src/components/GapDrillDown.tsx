import { useState, useEffect } from 'react';
import { X, Copy, Check, Loader2, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FunctionalGap, GapImpact } from '../types';
import { functionalApi } from '../services/api';

const GAP_TYPE_BADGE: Record<string, string> = {
  unchanged: 'bg-slate-100 text-slate-700 border-slate-200',
  modified:  'bg-amber-50 text-amber-700 border-amber-200',
  missing:   'bg-red-50 text-red-700 border-red-200',
  new:       'bg-emerald-50 text-emerald-700 border-emerald-200',
};

interface GapDrillDownProps {
  gap: FunctionalGap;
  projectId: string;
  runId: string;
  onClose: () => void;
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
      title={t('gapAnalysis.drillDown.copyGap')}
    >
      {copied ? (
        <Check size={11} className="text-emerald-500" />
      ) : (
        <Copy size={11} />
      )}
      {t('gapAnalysis.drillDown.copyGap')}
    </button>
  );
}

function EvidenceBox({
  title,
  quote,
  section,
  absentLabel,
}: {
  title: string;
  quote: string | null;
  section: string | null;
  absentLabel?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{title}</p>
      {!quote ? (
        <p className="text-xs text-text-muted italic py-2">{absentLabel}</p>
      ) : (
        <div className="space-y-1">
          {section && <p className="text-[11px] text-text-muted">§ {section}</p>}
          <blockquote className="border-l-2 border-purple-deep/40 pl-3 py-1 bg-brand-50/30 rounded-r text-xs text-text-secondary leading-relaxed italic">
            "{quote}"
          </blockquote>
        </div>
      )}
    </div>
  );
}

function buildGapMarkdown(gap: FunctionalGap, t: (k: string) => string): string {
  const lines = [
    `## Gap: ${gap.gap_type.toUpperCase()}`,
    `**Explanation:** ${gap.explanation ?? 'N/A'}`,
    '',
    `### ${t('gapAnalysis.evidence.asIsEvidence')}`,
    gap.as_is_section ? `Section: ${gap.as_is_section}` : '',
    gap.as_is_quote ? `> "${gap.as_is_quote}"` : t('gapAnalysis.evidence.noAsIs'),
    '',
    `### ${t('gapAnalysis.evidence.toBeEvidence')}`,
    gap.to_be_section ? `Section: ${gap.to_be_section}` : '',
    gap.to_be_quote ? `> "${gap.to_be_quote}"` : t('gapAnalysis.evidence.noToBe'),
  ];

  if (gap.field_diffs.length > 0) {
    lines.push('', `### ${t('gapAnalysis.evidence.fieldChanges')}`);
    for (const d of gap.field_diffs) {
      lines.push(`- **${d.field}**: "${d.as_is_value}" → "${d.to_be_value}"`);
    }
  }

  return lines.join('\n');
}

export default function GapDrillDown({ gap, projectId, runId, onClose }: GapDrillDownProps) {
  const { t } = useTranslation();
  const [impacts, setImpacts] = useState<GapImpact[]>([]);
  const [loadingImpacts, setLoadingImpacts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingImpacts(true);
      try {
        const data = await functionalApi.getGapImpacts(projectId, runId, gap.id);
        if (!cancelled) setImpacts(data);
      } catch {
        if (!cancelled) setImpacts([]);
      } finally {
        if (!cancelled) setLoadingImpacts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gap.id, projectId, runId]);

  const badgeClass =
    GAP_TYPE_BADGE[gap.gap_type] ?? 'bg-surface text-text-muted border-surface-border';
  const gapTypeLabel = t(`gapAnalysis.gapTypes.${gap.gap_type}` as Parameters<typeof t>[0]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white shadow-dropdown overflow-y-auto flex flex-col animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-text-primary">
              {t('gapAnalysis.drillDown.title')}
            </h2>
            <span className={`badge border ${badgeClass}`}>{gapTypeLabel}</span>
            {gap.confidence !== null && (
              <span className="text-xs text-text-muted">
                {Math.round(gap.confidence * 100)}%{' '}
                {t('gapAnalysis.confidence.label').toLowerCase()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <CopyButton text={buildGapMarkdown(gap, t)} />
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition-colors p-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-6">
          {gap.explanation && (
            <div className="bg-brand-50/50 rounded-lg border border-brand-200 px-4 py-3">
              <p className="text-xs font-semibold text-purple-deep uppercase tracking-wide mb-1">
                {t('gapAnalysis.drillDown.explanation')}
              </p>
              <p className="text-sm text-text-secondary leading-relaxed">{gap.explanation}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <EvidenceBox
              title={t('gapAnalysis.evidence.asIsEvidence')}
              quote={gap.as_is_quote}
              section={gap.as_is_section}
              absentLabel={t('gapAnalysis.evidence.noAsIs')}
            />
            <EvidenceBox
              title={t('gapAnalysis.evidence.toBeEvidence')}
              quote={gap.to_be_quote}
              section={gap.to_be_section}
              absentLabel={t('gapAnalysis.evidence.noToBe')}
            />
          </div>

          {gap.field_diffs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                {t('gapAnalysis.evidence.fieldChanges')}
              </p>
              <div className="rounded-lg border border-surface-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-surface">
                    <tr>
                      <th className="text-left px-3 py-2 text-text-muted font-semibold">
                        {t('gapAnalysis.evidence.field')}
                      </th>
                      <th className="text-left px-3 py-2 text-text-muted font-semibold">
                        {t('gapAnalysis.evidence.asIsValue')}
                      </th>
                      <th className="text-left px-3 py-2 text-text-muted font-semibold">
                        {t('gapAnalysis.evidence.toBeValue')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {gap.field_diffs.map((diff, i) => (
                      <tr key={i} className="border-t border-surface-border">
                        <td className="px-3 py-2 font-medium text-text-secondary capitalize">
                          {diff.field.replaceAll('_', ' ')}
                        </td>
                        <td className="px-3 py-2 text-red-600 bg-red-50/30">
                          {diff.as_is_value || '—'}
                        </td>
                        <td className="px-3 py-2 text-emerald-600 bg-emerald-50/30">
                          {diff.to_be_value || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
              {t('gapAnalysis.impacts.title')}
            </p>
            {loadingImpacts ? (
              <div className="flex items-center gap-2 text-text-muted text-xs py-2">
                <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
              </div>
            ) : impacts.length === 0 ? (
              <p className="text-xs text-text-muted py-2">{t('gapAnalysis.impacts.noImpacts')}</p>
            ) : (
              <div className="space-y-1.5">
                {impacts.map(impact => (
                  <div
                    key={impact.id}
                    className="flex items-start gap-2 text-xs bg-surface rounded-lg px-3 py-2 border border-surface-border"
                  >
                    <ChevronRight size={11} className="text-text-muted mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium text-text-primary">
                        {impact.title ?? impact.affected_component_id.slice(0, 8)}
                      </span>
                      {impact.type && (
                        <span className="text-text-muted ml-1.5 capitalize">
                          ({impact.type.replaceAll('_', ' ')})
                        </span>
                      )}
                      {impact.relationship_path.length > 1 && (
                        <p className="text-text-muted text-[10px] mt-0.5">
                          {impact.relationship_path.join(' → ')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
