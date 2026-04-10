import { AlertTriangle, CheckCircle2, AlertCircle, TrendingUp, Shield, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { UATAnalysisResult, UATApplicationStat } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, string> = {
  Critical: 'bg-red-500',
  High:     'bg-orange-400',
  Medium:   'bg-amber-400',
  Low:      'bg-green-400',
  Unknown:  'bg-gray-300',
};
const PRIORITY_TEXT: Record<string, string> = {
  Critical: 'text-red-700 bg-red-50 border-red-200',
  High:     'text-orange-700 bg-orange-50 border-orange-200',
  Medium:   'text-amber-700 bg-amber-50 border-amber-200',
  Low:      'text-green-700 bg-green-50 border-green-200',
  Unknown:  'text-gray-600 bg-gray-50 border-gray-200',
};
const RISK_BADGE: Record<string, string> = {
  high:   'text-red-700 bg-red-50 border-red-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  low:    'text-green-700 bg-green-50 border-green-200',
};
const EFFORT_LABEL: Record<string, string> = {
  low: 'Quick win', medium: 'Medium effort', high: 'High effort',
};

function RiskBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const icon = level === 'high' ? <AlertTriangle size={11} /> : level === 'medium' ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${RISK_BADGE[level]}`}>
      {icon} {level}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold ${PRIORITY_TEXT[priority] ?? PRIORITY_TEXT.Unknown}`}>
      {priority}
    </span>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
    </div>
  );
}

/** Horizontal stacked bar showing Critical/High/Medium/Low */
function ApplicationBar({ stat, maxScore }: { stat: UATApplicationStat; maxScore: number }) {
  const total = stat.total || 1;
  const pCrit  = (stat.critical / total) * 100;
  const pHigh  = (stat.high / total) * 100;
  const pMed   = (stat.medium / total) * 100;
  const pLow   = Math.max(0, 100 - pCrit - pHigh - pMed);
  const widthPct = Math.max(8, Math.round((stat.riskScore / Math.max(maxScore, 1)) * 100));

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-28 shrink-0 text-xs font-medium text-text-primary truncate" title={stat.application}>
        {stat.application}
      </div>
      <div className="flex-1">
        <div className="flex h-4 rounded-md overflow-hidden gap-px" style={{ width: `${widthPct}%` }}>
          {pCrit  > 0 && <div className="bg-red-500"    style={{ width: `${pCrit}%` }} title={`Critical: ${stat.critical}`} />}
          {pHigh  > 0 && <div className="bg-orange-400" style={{ width: `${pHigh}%` }} title={`High: ${stat.high}`} />}
          {pMed   > 0 && <div className="bg-amber-400"  style={{ width: `${pMed}%` }}  title={`Medium: ${stat.medium}`} />}
          {pLow   > 0 && <div className="bg-green-400"  style={{ width: `${pLow}%` }}  title={`Low: ${stat.low}`} />}
        </div>
      </div>
      <div className="w-16 text-right text-[10px] text-text-muted shrink-0">
        {stat.total} defects
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  result: UATAnalysisResult;
  fileName: string | null;
}

export default function UATDashboard({ result, fileName }: Props) {
  const [expandedDefect, setExpandedDefect] = useState<string | null>(null);

  const maxRiskScore = Math.max(...result.byApplication.map(a => a.riskScore), 1);

  return (
    <div className="flex-1 overflow-y-auto bg-surface/30 p-6 space-y-6">

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">Total Defects</p>
          <p className="text-2xl font-bold text-text-primary">{result.totalDefects}</p>
          {fileName && <p className="text-[10px] text-text-muted mt-1 truncate">{fileName}</p>}
        </div>
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">Overall Risk</p>
          <div className="mt-1"><RiskBadge level={result.overallRiskLevel} /></div>
        </div>
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">Critical + High</p>
          <p className="text-2xl font-bold text-red-600">
            {result.byPriority.filter(p => p.priority === 'Critical' || p.priority === 'High').reduce((s, p) => s + p.count, 0)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">Applications Impacted</p>
          <p className="text-2xl font-bold text-text-primary">{result.byApplication.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ── By application ────────────────────────────────────── */}
        <div className="card p-5">
          <SectionHeader
            title="Risk by Application"
            subtitle="Bar width = risk score (Critical×4 + High×2 + Medium×1)"
          />
          {/* Legend */}
          <div className="flex gap-3 mb-3 flex-wrap">
            {[['bg-red-500','Critical'],['bg-orange-400','High'],['bg-amber-400','Medium'],['bg-green-400','Low']].map(([cls,lbl]) => (
              <span key={lbl} className="flex items-center gap-1 text-[10px] text-text-muted">
                <span className={`w-2.5 h-2.5 rounded-sm ${cls}`} />{lbl}
              </span>
            ))}
          </div>
          <div className="space-y-0.5">
            {result.byApplication.map(stat => (
              <ApplicationBar key={stat.application} stat={stat} maxScore={maxRiskScore} />
            ))}
          </div>
        </div>

        {/* ── Priority distribution ─────────────────────────────── */}
        <div className="card p-5">
          <SectionHeader title="Priority Distribution" />
          <div className="space-y-3">
            {result.byPriority.map(p => (
              <div key={p.priority}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium text-text-primary">{p.priority}</span>
                  <span className="text-text-muted">{p.count} ({p.percentage}%)</span>
                </div>
                <div className="h-3 bg-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${PRIORITY_COLOR[p.priority] ?? 'bg-gray-300'}`}
                    style={{ width: `${p.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* By module */}
          <div className="mt-5 pt-4 border-t border-surface-border">
            <p className="text-xs font-semibold text-text-primary mb-3">Top Functional Modules</p>
            <div className="space-y-1.5">
              {result.byModule.slice(0, 8).map(m => (
                <div key={m.module} className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-text-secondary truncate">{m.module}</span>
                  <span className="text-[10px] text-red-600 font-medium w-16 text-right">{m.criticalCount} crit/high</span>
                  <span className="text-[10px] text-text-muted w-12 text-right">{m.count} total</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Executive summary ─────────────────────────────────────── */}
      <div className="card p-5">
        <SectionHeader title="Executive Summary" />
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{result.executiveSummary}</p>
        {result.qualityTrend && (
          <div className="mt-3 pt-3 border-t border-surface-border">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp size={13} className="text-purple-deep" />
              <p className="text-xs font-semibold text-text-primary">Quality Trend</p>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">{result.qualityTrend}</p>
          </div>
        )}
      </div>

      {/* ── Top defects ───────────────────────────────────────────── */}
      {result.topDefects.length > 0 && (
        <div className="card p-5">
          <SectionHeader
            title="Top Critical & High Defects"
            subtitle={`${result.topDefects.length} most impactful defects`}
          />
          <div className="space-y-2">
            {result.topDefects.map(d => {
              const isOpen = expandedDefect === d.id;
              return (
                <div
                  key={d.id}
                  className="border border-surface-border rounded-xl overflow-hidden"
                >
                  <button
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-surface/60 transition-colors"
                    onClick={() => setExpandedDefect(isOpen ? null : d.id)}
                  >
                    <PriorityBadge priority={d.priority} />
                    <span className="text-xs font-medium text-text-primary flex-1 truncate">{d.title}</span>
                    <span className="text-[10px] text-text-muted shrink-0 hidden sm:block">{d.application}</span>
                    <span className="text-[10px] text-text-muted shrink-0 hidden md:block ml-2">{d.module}</span>
                    {isOpen ? <ChevronUp size={13} className="text-text-muted shrink-0" /> : <ChevronDown size={13} className="text-text-muted shrink-0" />}
                  </button>
                  {isOpen && d.impact && (
                    <div className="px-3 pb-3 bg-surface/40 border-t border-surface-border">
                      <p className="text-xs text-text-secondary mt-2 leading-relaxed">{d.impact}</p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <span className="text-[10px] text-text-muted">#{d.id}</span>
                        <span className="text-[10px] text-text-muted">·</span>
                        <span className="text-[10px] text-purple-deep font-medium">{d.application}</span>
                        <span className="text-[10px] text-text-muted">·</span>
                        <span className="text-[10px] text-text-muted">{d.module}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ── Risk areas ────────────────────────────────────────────── */}
        {result.riskAreas.length > 0 && (
          <div className="card p-5">
            <SectionHeader title="Risk Areas" subtitle="Evidence-based risk assessment from defect patterns" />
            <div className="space-y-3">
              {result.riskAreas.map((area, i) => (
                <div key={i} className="rounded-xl border border-surface-border p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-text-primary flex-1">{area.area}</p>
                    <RiskBadge level={area.riskLevel} />
                  </div>
                  <p className="text-xs text-text-secondary leading-snug">{area.rationale}</p>
                  <div className="flex items-start gap-1.5 bg-surface rounded-lg p-2">
                    <Shield size={11} className="text-purple-deep mt-0.5 shrink-0" />
                    <p className="text-[11px] text-purple-deep leading-snug">{area.recommendation}</p>
                  </div>
                  {area.relatedApplications.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {area.relatedApplications.map(app => (
                        <span key={app} className="text-[10px] bg-brand-50 text-purple-deep px-1.5 py-0.5 rounded-full border border-brand-200">{app}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Prevention actions ────────────────────────────────────── */}
        {result.preventionActions.length > 0 && (
          <div className="card p-5">
            <SectionHeader title="Prevention Actions" subtitle="Prioritized recommendations to avoid recurrence" />
            <div className="space-y-2.5">
              {result.preventionActions.map((action, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-surface-border">
                  <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center ${
                    action.priority === 'high' ? 'bg-red-500' : action.priority === 'medium' ? 'bg-amber-400' : 'bg-green-400'
                  }`}>
                    <Zap size={13} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary leading-snug">{action.action}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[10px] text-purple-deep font-medium">{action.targetApplication}</span>
                      <span className="text-[10px] text-text-muted">·</span>
                      <span className={`text-[10px] font-medium ${
                        action.effort === 'low' ? 'text-green-600' : action.effort === 'medium' ? 'text-amber-600' : 'text-red-600'
                      }`}>{EFFORT_LABEL[action.effort]}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Recurring patterns ───────────────────────────────────────── */}
      {result.recurringPatterns.length > 0 && (
        <div className="card p-5">
          <SectionHeader title="Recurring Defect Patterns" subtitle="Issues that appeared multiple times across the UAT cycle" />
          <div className="space-y-2">
            {result.recurringPatterns.map((p, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-surface-border">
                <div className={`text-sm font-bold w-8 text-center shrink-0 ${
                  p.priority === 'high' ? 'text-red-600' : p.priority === 'medium' ? 'text-amber-600' : 'text-green-600'
                }`}>
                  ×{p.occurrences}
                </div>
                <p className="flex-1 text-xs text-text-primary">{p.pattern}</p>
                <div className="flex flex-wrap gap-1 shrink-0">
                  {p.applications.map(app => (
                    <span key={app} className="text-[10px] bg-surface text-text-muted px-1.5 py-0.5 rounded border border-surface-border">{app}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
