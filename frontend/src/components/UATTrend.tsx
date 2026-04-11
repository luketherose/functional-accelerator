import { useMemo, useState, useEffect } from 'react';
import { TrendingDown, TrendingUp, Minus, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UATAnalysis, UATAnalysisResult, ClusterTrendData } from '../types';
import { parseUATResult, uatApi } from '../services/api';
import DiagnosticInsights from './DiagnosticInsights';

interface Props {
  analyses: UATAnalysis[];
  projectId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const RISK_COLOR: Record<string, string> = {
  high: 'text-red-600 bg-red-50 border-red-200',
  medium: 'text-amber-600 bg-amber-50 border-amber-200',
  low: 'text-green-600 bg-green-50 border-green-200',
};
const PRIORITY_FILL: Record<string, string> = {
  Critical: '#ef4444',
  High:     '#fb923c',
  Medium:   '#fbbf24',
  Low:      '#4ade80',
};

interface RunPoint {
  label: string;
  date: string;
  totalDefects: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  riskLevel: 'high' | 'medium' | 'low';
  overallRiskScore: number;
  result: UATAnalysisResult;
}

function deltaIcon(prev: number, curr: number, lowerIsBetter = true) {
  const better = lowerIsBetter ? curr < prev : curr > prev;
  const worse  = lowerIsBetter ? curr > prev : curr < prev;
  if (better) return <TrendingDown size={13} className="text-emerald-500" />;
  if (worse)  return <TrendingUp   size={13} className="text-red-500" />;
  return <Minus size={13} className="text-text-muted" />;
}

function deltaText(prev: number, curr: number) {
  const diff = curr - prev;
  if (diff === 0) return '—';
  return (diff > 0 ? '+' : '') + diff;
}

function deltaClass(prev: number, curr: number, lowerIsBetter = true) {
  const better = lowerIsBetter ? curr < prev : curr > prev;
  const worse  = lowerIsBetter ? curr > prev : curr < prev;
  if (better) return 'text-emerald-600 font-semibold';
  if (worse)  return 'text-red-600 font-semibold';
  return 'text-text-muted';
}

// ─── Mini SVG line chart ───────────────────────────────────────────────────────

function LineChart({ points, color = '#7c3aed' }: { points: number[]; color?: string }) {
  if (points.length < 2) return null;
  const W = 240, H = 64, PAD = 8;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const xs = points.map((_, i) => PAD + (i / (points.length - 1)) * (W - PAD * 2));
  const ys = points.map(v => H - PAD - ((v - min) / range) * (H - PAD * 2));
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${ys[i]}`).join(' ');
  const area = `${d} L ${xs[xs.length - 1]} ${H} L ${xs[0]} ${H} Z`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trend-fill)" />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={3} fill="white" stroke={color} strokeWidth={1.5} />
      ))}
    </svg>
  );
}

// ─── Stacked bar chart ────────────────────────────────────────────────────────

function StackedBarChart({ runs }: { runs: RunPoint[] }) {
  const W = 400, H = 120, PAD_Y = 8, BAR_GAP = 4;
  const maxTotal = Math.max(...runs.map(r => r.totalDefects), 1);
  const barW = Math.max(16, Math.min(36, (W - (runs.length - 1) * BAR_GAP) / runs.length));
  const totalW = runs.length * barW + (runs.length - 1) * BAR_GAP;
  const startX = (W - totalW) / 2;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + PAD_Y}`} className="overflow-visible">
      {runs.map((r, i) => {
        const x = startX + i * (barW + BAR_GAP);
        const fullH = H - PAD_Y * 2;
        const scale = (n: number) => (n / maxTotal) * fullH;
        const segs = [
          { key: 'Critical', val: r.critical, fill: PRIORITY_FILL.Critical },
          { key: 'High',     val: r.high,     fill: PRIORITY_FILL.High },
          { key: 'Medium',   val: r.medium,   fill: PRIORITY_FILL.Medium },
          { key: 'Low',      val: r.low,      fill: PRIORITY_FILL.Low },
        ].filter(s => s.val > 0);
        let yOff = H - PAD_Y;
        return (
          <g key={r.label}>
            {segs.map(s => {
              const h = scale(s.val);
              yOff -= h;
              return <rect key={s.key} x={x} y={yOff} width={barW} height={h} fill={s.fill} rx={2} />;
            })}
            <text x={x + barW / 2} y={H + PAD_Y} textAnchor="middle" fontSize={8} fill="#9ca3af">
              {r.label.replace('UAT Analysis ', 'v')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UATTrend({ analyses, projectId }: Props) {
  const { t } = useTranslation();
  const [clusterTrend, setClusterTrend] = useState<ClusterTrendData | null>(null);

  useEffect(() => {
    uatApi.clusterTrend(projectId)
      .then(setClusterTrend)
      .catch(() => setClusterTrend(null));
  }, [projectId, analyses]);

  const runs = useMemo<RunPoint[]>(() => {
    return analyses
      .filter(a => a.status === 'done' && a.result_json)
      .map(a => {
        const result = parseUATResult(a)!;
        const critEntry  = result.byPriority.find(p => p.priority === 'Critical');
        const highEntry  = result.byPriority.find(p => p.priority === 'High');
        const medEntry   = result.byPriority.find(p => p.priority === 'Medium');
        const lowEntry   = result.byPriority.find(p => p.priority === 'Low');
        const critical   = critEntry?.count ?? 0;
        const high       = highEntry?.count ?? 0;
        const medium     = medEntry?.count ?? 0;
        const low        = lowEntry?.count ?? 0;
        const riskScore  = critical * 4 + high * 2 + medium;
        return {
          label: a.version_name,
          date: a.created_at,
          totalDefects: result.totalDefects,
          critical, high, medium, low,
          riskLevel: result.overallRiskLevel,
          overallRiskScore: riskScore,
          result,
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [analyses]);

  if (runs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted p-8">
        <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center">
          <TrendingDown size={22} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">{t('trend.noData')}</p>
          <p className="text-xs text-text-muted mt-1">{t('trend.noDataHint')}</p>
        </div>
      </div>
    );
  }

  if (runs.length === 1) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted p-8">
        <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center">
          <TrendingDown size={22} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">{t('trend.oneRun')}</p>
          <p className="text-xs text-text-muted mt-1">{t('trend.oneRunHint')}</p>
        </div>
      </div>
    );
  }

  const first = runs[0];
  const last  = runs[runs.length - 1];

  // Overall trend direction
  const riskDelta = last.overallRiskScore - first.overallRiskScore;
  const defectDelta = last.totalDefects - first.totalDefects;
  const trendPositive = riskDelta < 0 && defectDelta <= 0;
  const trendNegative = riskDelta > 0 || defectDelta > 0;

  // Per-application evolution: track which apps appear across runs
  const allApps = [...new Set(runs.flatMap(r => r.result.byApplication.map(a => a.application)))];

  return (
    <div className="flex-1 overflow-y-auto bg-surface/30 p-6 space-y-6">

      {/* ── Diagnostic Insights ───────────────────────────────────── */}
      {clusterTrend && clusterTrend.clusters.length > 0 && (
        <div className="card p-5">
          <DiagnosticInsights data={clusterTrend} />
        </div>
      )}

      {/* ── Overall trend summary ──────────────────────────────────── */}
      <div className={`card p-5 border-l-4 ${trendPositive ? 'border-l-emerald-400' : trendNegative ? 'border-l-red-400' : 'border-l-slate-300'}`}>
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${trendPositive ? 'bg-emerald-50' : trendNegative ? 'bg-red-50' : 'bg-surface'}`}>
            {trendPositive
              ? <TrendingDown size={18} className="text-emerald-500" />
              : trendNegative
              ? <TrendingUp   size={18} className="text-red-500" />
              : <Minus        size={18} className="text-text-muted" />}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary">
              {trendPositive
                ? t('trend.improving')
                : trendNegative
                ? t('trend.worsening')
                : t('trend.stable')}
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              {t('trend.summary', {
                first: first.label,
                last: last.label,
                abs: Math.abs(defectDelta),
                plural: Math.abs(defectDelta) !== 1 ? 's' : '',
                direction: defectDelta <= 0 ? t('trend.summaryFewer') : t('trend.summaryMore'),
                riskDir: riskDelta < 0 ? t('trend.summaryDecreased') : riskDelta > 0 ? t('trend.summaryIncreased') : t('trend.summaryUnchanged'),
                riskAbs: Math.abs(riskDelta),
              })}
            </p>
          </div>
          <span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${
            trendPositive ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
            : trendNegative ? 'text-red-600 bg-red-50 border-red-200'
            : 'text-text-muted bg-surface border-surface-border'
          }`}>
            {t('trend.runs', { count: runs.length })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ── Total defects line chart ─────────────────────────────── */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-1">{t('trend.totalDefectsChart')}</h3>
          <p className="text-xs text-text-muted mb-4">{t('trend.totalDefectsChartSub')}</p>
          <LineChart points={runs.map(r => r.totalDefects)} />
          <div className="mt-3 flex justify-between text-[10px] text-text-muted">
            {runs.map(r => (
              <span key={r.label} className="text-center truncate max-w-[60px]">
                {r.label.replace('UAT Analysis ', 'v')}
                <br />
                <span className="font-semibold text-text-secondary">{r.totalDefects}</span>
              </span>
            ))}
          </div>
        </div>

        {/* ── Risk score line chart ────────────────────────────────── */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-1">{t('trend.riskScoreChart')}</h3>
          <p className="text-xs text-text-muted mb-4">Critical×4 + High×2 + Medium×1</p>
          <LineChart points={runs.map(r => r.overallRiskScore)} color="#dc2626" />
          <div className="mt-3 flex justify-between text-[10px] text-text-muted">
            {runs.map(r => (
              <span key={r.label} className="text-center truncate max-w-[60px]">
                {r.label.replace('UAT Analysis ', 'v')}
                <br />
                <span className="font-semibold text-text-secondary">{r.overallRiskScore}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Priority stacked bar chart ───────────────────────────────── */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-1">{t('trend.priorityDistChart')}</h3>
        <p className="text-xs text-text-muted mb-4">{t('trend.priorityDistChartSub')}</p>
        <div className="flex gap-3 mb-4 flex-wrap">
          {[['#ef4444','Critical'],['#fb923c','High'],['#fbbf24','Medium'],['#4ade80','Low']].map(([fill,lbl]) => (
            <span key={lbl} className="flex items-center gap-1 text-[10px] text-text-muted">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: fill }} />{lbl}
            </span>
          ))}
        </div>
        <StackedBarChart runs={runs} />
      </div>

      {/* ── Run-by-run comparison table ──────────────────────────────── */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-4">{t('trend.runTable')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="text-left py-2 pr-4 font-semibold text-text-primary">{t('trend.colRun')}</th>
                <th className="text-right py-2 px-3 font-semibold text-text-primary">{t('trend.colDate')}</th>
                <th className="text-right py-2 px-3 font-semibold text-text-primary">{t('trend.colDefects')}</th>
                <th className="text-right py-2 px-3 font-semibold text-red-600">Critical</th>
                <th className="text-right py-2 px-3 font-semibold text-orange-500">High</th>
                <th className="text-right py-2 px-3 font-semibold text-amber-500">Medium</th>
                <th className="text-right py-2 px-3 font-semibold text-green-600">Low</th>
                <th className="text-right py-2 px-3 font-semibold text-text-primary">{t('trend.colRiskScore')}</th>
                <th className="text-center py-2 px-3 font-semibold text-text-primary">{t('trend.colLevel')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => {
                const prev = i > 0 ? runs[i - 1] : null;
                const isFirst = i === 0;
                return (
                  <tr key={r.label} className={`border-b border-surface-border/50 ${isFirst ? '' : 'hover:bg-surface/40'}`}>
                    <td className="py-2.5 pr-4 font-medium text-text-primary">{r.label}</td>
                    <td className="py-2.5 px-3 text-right text-text-muted">
                      {new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </td>
                    {/* Total defects */}
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {prev && deltaIcon(prev.totalDefects, r.totalDefects)}
                        <span className={prev ? deltaClass(prev.totalDefects, r.totalDefects) : 'text-text-primary font-semibold'}>
                          {r.totalDefects}
                        </span>
                        {prev && <span className="text-[10px] text-text-muted ml-1">({deltaText(prev.totalDefects, r.totalDefects)})</span>}
                      </div>
                    </td>
                    {/* Critical */}
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {prev && deltaIcon(prev.critical, r.critical)}
                        <span className={prev ? deltaClass(prev.critical, r.critical) : 'text-text-primary'}>{r.critical}</span>
                      </div>
                    </td>
                    {/* High */}
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {prev && deltaIcon(prev.high, r.high)}
                        <span className={prev ? deltaClass(prev.high, r.high) : 'text-text-primary'}>{r.high}</span>
                      </div>
                    </td>
                    {/* Medium */}
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {prev && deltaIcon(prev.medium, r.medium)}
                        <span className={prev ? deltaClass(prev.medium, r.medium) : 'text-text-primary'}>{r.medium}</span>
                      </div>
                    </td>
                    {/* Low */}
                    <td className="py-2.5 px-3 text-right">
                      <span className="text-text-primary">{r.low}</span>
                    </td>
                    {/* Risk score */}
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {prev && deltaIcon(prev.overallRiskScore, r.overallRiskScore)}
                        <span className={prev ? deltaClass(prev.overallRiskScore, r.overallRiskScore) : 'text-text-primary font-semibold'}>
                          {r.overallRiskScore}
                        </span>
                        {prev && <span className="text-[10px] text-text-muted ml-1">({deltaText(prev.overallRiskScore, r.overallRiskScore)})</span>}
                      </div>
                    </td>
                    {/* Risk level */}
                    <td className="py-2.5 px-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${RISK_COLOR[r.riskLevel]}`}>
                        {r.riskLevel === 'high' ? <AlertTriangle size={9} /> : r.riskLevel === 'medium' ? <AlertCircle size={9} /> : <CheckCircle2 size={9} />}
                        {RISK_LABEL[r.riskLevel]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Cluster evolution table ──────────────────────────────────── */}
      {clusterTrend && clusterTrend.clusters.length > 0 && clusterTrend.runs.length >= 1 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-1">{t('trend.clusterChart')}</h3>
          <p className="text-xs text-text-muted mb-4">{t('trend.clusterChartSub')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left py-2 pr-4 font-semibold text-text-primary min-w-[140px]">{t('trend.colCluster')}</th>
                  {clusterTrend.runs.map(r => (
                    <th key={r.analysisId} className="text-right py-2 px-3 font-semibold text-text-muted min-w-[60px]">
                      {r.versionName.replace('UAT Analysis ', 'v')}
                    </th>
                  ))}
                  <th className="text-right py-2 px-3 font-semibold text-text-primary">{t('trend.colDelta')}</th>
                </tr>
              </thead>
              <tbody>
                {[...clusterTrend.clusters]
                  .filter(c => c.points.some(p => p.defectCount > 0))
                  .sort((a, b) => (b.points[b.points.length - 1]?.riskScore ?? 0) - (a.points[a.points.length - 1]?.riskScore ?? 0))
                  .map(cluster => {
                    const pts = cluster.points;
                    const first = pts[0]?.defectCount ?? 0;
                    const latest = pts[pts.length - 1]?.defectCount ?? 0;
                    const overall = latest - first;
                    return (
                      <tr key={cluster.clusterKey} className="border-b border-surface-border/50 hover:bg-surface/40">
                        <td className="py-2.5 pr-4 font-medium text-text-primary">{cluster.clusterName}</td>
                        {pts.map((pt, i) => {
                          const prev = i > 0 ? pts[i - 1].defectCount : null;
                          const delta = prev !== null ? pt.defectCount - prev : null;
                          const cellClass = delta === null || delta === 0
                            ? 'text-text-primary'
                            : delta < 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold';
                          return (
                            <td key={i} className="py-2.5 px-3 text-right">
                              <span className={cellClass}>{pt.defectCount}</span>
                              {delta !== null && delta !== 0 && (
                                <span className="text-[10px] ml-1 text-text-muted">
                                  ({delta > 0 ? '+' : ''}{delta})
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {overall < 0
                              ? <TrendingDown size={12} className="text-emerald-500" />
                              : overall > 0
                              ? <TrendingUp size={12} className="text-red-500" />
                              : <Minus size={12} className="text-text-muted" />}
                            <span className={overall < 0 ? 'text-emerald-600 font-semibold' : overall > 0 ? 'text-red-600 font-semibold' : 'text-text-muted'}>
                              {overall === 0 ? '—' : `${overall > 0 ? '+' : ''}${overall}`}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Per-application evolution ────────────────────────────────── */}
      {allApps.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-1">{t('trend.appChart')}</h3>
          <p className="text-xs text-text-muted mb-4">{t('trend.appChartSub')}</p>
          <div className="space-y-4">
            {allApps.map(app => {
              const appPoints = runs.map(r => r.result.byApplication.find(a => a.application === app)?.total ?? 0);
              const firstVal  = appPoints[0];
              const lastVal   = appPoints[appPoints.length - 1];
              const delta     = lastVal - firstVal;
              return (
                <div key={app}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-text-primary">{app}</span>
                    <div className="flex items-center gap-1">
                      {deltaIcon(firstVal, lastVal)}
                      <span className={`text-[10px] ${deltaClass(firstVal, lastVal)}`}>
                        {delta === 0 ? t('trend.stableLabel') : `${delta > 0 ? '+' : ''}${delta} defect`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-end gap-1 h-6">
                    {runs.map((r, i) => {
                      const v = r.result.byApplication.find(a => a.application === app)?.total ?? 0;
                      const max = Math.max(...appPoints, 1);
                      const hPct = Math.max(4, (v / max) * 100);
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                          <div
                            className="w-full rounded-sm bg-purple-deep/60 transition-all"
                            style={{ height: `${hPct}%` }}
                            title={`${r.label}: ${v}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex mt-1 text-[9px] text-text-muted">
                    {runs.map((_r, i) => (
                      <span key={i} className="flex-1 text-center">{appPoints[i]}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
